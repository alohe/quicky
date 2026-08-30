import fs from "fs-extra";
import path from "node:path";
import { PROJECTS_DIR, CONFIG_VERSION, readConfig, writeConfig } from "./config.js";
import { buildEcosystemFile, pm2DeleteIfExists, pm2StartEcosystem, pm2Save } from "./pm2.js";
import { stripTokenFromRemote } from "./git.js";
import {
	getProjectRoot,
	getReleasesDir,
	getSharedDir,
	getCurrentSymlink,
	ensureReleaseLayout,
	isReleaseLayout,
} from "./release.js";
import chalk from "chalk";

const DEFAULT_PERSIST = [".env", ".env.local", ".env.production", ".env.production.local"];

/**
 * Run one-time migration if configVersion < CONFIG_VERSION.
 * Converts old flat project dirs to the releases/current/shared layout.
 */
export function migrateIfNeeded() {
	const config = readConfig();

	if (config.configVersion >= CONFIG_VERSION) return;

	console.log(chalk.yellow("Migrating Quicky to new release layout..."));

	let migrated = 0;
	for (const project of config.projects || []) {
		try {
			if (migrateProject(project)) {
				migrated++;
			}
		} catch (err) {
			console.error(
				chalk.red(`Failed to migrate project ${project.repo}: ${err.message}`),
			);
		}
	}

	config.configVersion = CONFIG_VERSION;
	if (!config.domains) config.domains = [];

	writeConfig(config);

	if (migrated > 0) {
		pm2Save();
		console.log(chalk.green(`Migrated ${migrated} project(s) to new layout.`));
	} else {
		console.log(chalk.green("Migration complete (no projects to migrate)."));
	}
}

function migrateProject(project) {
	const root = getProjectRoot(project.repo);

	if (!fs.existsSync(root)) return false;
	if (isReleaseLayout(project.repo)) return false;

	const ts = new Date().toISOString().replace(/[:.]/g, "-");
	const releaseId = `${ts}-migrated`;

	const releasesDir = getReleasesDir(project.repo);
	const sharedDir = getSharedDir(project.repo);

	const tmpRoot = `${root}.migrating-${process.pid}`;
	fs.ensureDirSync(tmpRoot);
	fs.ensureDirSync(path.join(tmpRoot, "releases"));
	fs.ensureDirSync(path.join(tmpRoot, "shared"));

	const releaseDir = path.join(tmpRoot, "releases", releaseId);

	const entries = fs.readdirSync(root);
	for (const entry of entries) {
		if (entry.startsWith(".migrating")) continue;
		fs.moveSync(path.join(root, entry), path.join(releaseDir, entry), {
			overwrite: true,
		});
	}

	for (const envFile of DEFAULT_PERSIST) {
		const src = path.join(releaseDir, envFile);
		const dest = path.join(tmpRoot, "shared", envFile);
		if (fs.existsSync(src)) {
			fs.ensureDirSync(path.dirname(dest));
			fs.moveSync(src, dest, { overwrite: true });
			fs.symlinkSync(dest, src);
		}
	}

	if (fs.existsSync(path.join(releaseDir, ".git"))) {
		stripTokenFromRemote(releaseDir);
	}

	fs.symlinkSync(releaseDir, path.join(tmpRoot, "current"));

	fs.removeSync(root);
	fs.moveSync(tmpRoot, root, { overwrite: true });

	try {
		const ecosystemPath = buildEcosystemFile(project, releaseDir);
		pm2DeleteIfExists(project.repo);
		pm2StartEcosystem(ecosystemPath);
	} catch (err) {
		console.error(
			chalk.yellow(
				`Could not restart ${project.repo} after migration: ${err.message}`,
			),
		);
	}

	return true;
}
