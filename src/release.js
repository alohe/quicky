import fs from "fs-extra";
import path from "node:path";
import { PROJECTS_DIR } from "./config.js";

const DEFAULT_PERSIST = [".env", ".env.local", ".env.production", ".env.production.local"];
const MAX_RELEASES = 5;

export function getProjectRoot(repo) {
	return path.join(PROJECTS_DIR, repo);
}

export function getReleasesDir(repo) {
	return path.join(getProjectRoot(repo), "releases");
}

export function getSharedDir(repo) {
	return path.join(getProjectRoot(repo), "shared");
}

export function getCurrentSymlink(repo) {
	return path.join(getProjectRoot(repo), "current");
}

export function getCurrentRelease(repo) {
	const link = getCurrentSymlink(repo);
	if (!fs.existsSync(link)) return null;
	try {
		return fs.readlinkSync(link);
	} catch {
		return null;
	}
}

export function createReleaseDir(repo, sha = "head") {
	const ts = new Date().toISOString().replace(/[:.]/g, "-");
	const shortSha = sha.slice(0, 7);
	const id = `${ts}-${shortSha}`;
	const dir = path.join(getReleasesDir(repo), id);
	fs.ensureDirSync(dir);
	return { id, dir };
}

/**
 * Create symlinks from shared/ into the release directory for persisted paths.
 * If a file exists in the release but not in shared, move it to shared first.
 */
export function linkSharedPaths(repo, releaseDir, persist = DEFAULT_PERSIST) {
	const sharedDir = getSharedDir(repo);
	fs.ensureDirSync(sharedDir);

	for (const relPath of persist) {
		const sharedPath = path.join(sharedDir, relPath);
		const releasePath = path.join(releaseDir, relPath);

		if (fs.existsSync(releasePath) && !fs.existsSync(sharedPath)) {
			fs.ensureDirSync(path.dirname(sharedPath));
			fs.moveSync(releasePath, sharedPath, { overwrite: true });
		}

		if (fs.existsSync(sharedPath)) {
			if (fs.existsSync(releasePath)) {
				fs.removeSync(releasePath);
			}
			fs.ensureDirSync(path.dirname(releasePath));
			fs.symlinkSync(sharedPath, releasePath);
		}
	}
}

/**
 * Atomically swap the `current` symlink to point at a new release.
 * Uses rename-over-tmplink for atomicity.
 */
export function swapRelease(repo, releaseDir) {
	const current = getCurrentSymlink(repo);
	const tmpLink = `${current}.tmp-${process.pid}`;

	try {
		fs.removeSync(tmpLink);
	} catch {
		/* ignore */
	}

	fs.symlinkSync(releaseDir, tmpLink);
	fs.renameSync(tmpLink, current);
}

/**
 * Roll back to a previous release by repointing the symlink.
 */
export function rollbackRelease(repo, previousReleaseDir) {
	if (previousReleaseDir && fs.existsSync(previousReleaseDir)) {
		swapRelease(repo, previousReleaseDir);
		return true;
	}
	return false;
}

export function pruneReleases(repo, keep = MAX_RELEASES) {
	const releasesDir = getReleasesDir(repo);
	if (!fs.existsSync(releasesDir)) return;

	const currentTarget = getCurrentRelease(repo);
	const entries = fs.readdirSync(releasesDir).sort();

	if (entries.length <= keep) return;

	const toRemove = entries.slice(0, entries.length - keep);
	for (const entry of toRemove) {
		const full = path.join(releasesDir, entry);
		if (currentTarget && full === currentTarget) continue;
		fs.removeSync(full);
	}
}

/**
 * Initialize the release layout for a project if not already present.
 */
export function ensureReleaseLayout(repo) {
	const root = getProjectRoot(repo);
	fs.ensureDirSync(root);
	fs.ensureDirSync(getReleasesDir(repo));
	fs.ensureDirSync(getSharedDir(repo));
}

export function isReleaseLayout(repo) {
	return fs.existsSync(getReleasesDir(repo)) && fs.existsSync(getSharedDir(repo));
}
