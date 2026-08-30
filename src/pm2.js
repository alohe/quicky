import { execFileSync } from "node:child_process";
import fs from "fs-extra";
import path from "node:path";

/**
 * Build a PM2 ecosystem config file for a project and write it to disk.
 * Returns the absolute path to the generated file.
 */
export function buildEcosystemFile(project, releaseDir) {
	const ecosystemPath = path.join(releaseDir, "ecosystem.config.cjs");

	const env = {};
	if (project.port) {
		env.PORT = String(project.port);
	}

	let app;
	if (project.type === "next.js") {
		app = {
			name: project.repo,
			script: "npm",
			args: "start",
			cwd: releaseDir,
			env,
		};
	} else {
		const pkgPath = path.join(releaseDir, "package.json");
		let mainFile = "index.js";
		if (fs.existsSync(pkgPath)) {
			const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
			mainFile = pkg.main || "index.js";
		}
		const entryFile = path.join(releaseDir, mainFile);
		if (!fs.existsSync(entryFile)) {
			throw new Error(
				`Entry file ${mainFile} not found in ${releaseDir}. Check the "main" field in package.json.`,
			);
		}
		app = {
			name: project.repo,
			script: mainFile,
			cwd: releaseDir,
			env,
		};
	}

	const content = `module.exports = { apps: [${JSON.stringify(app, null, 2)}] };\n`;
	fs.writeFileSync(ecosystemPath, content);
	return ecosystemPath;
}

export function pm2Save() {
	try {
		execFileSync("pm2", ["save"], { stdio: "pipe" });
	} catch {
		/* pm2 save can fail if pm2 isn't daemonized yet; non-fatal */
	}
}

export function pm2Startup() {
	try {
		const output = execFileSync("pm2", ["startup"], {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		});
		const sudoLine = output
			.split("\n")
			.find((l) => l.trim().startsWith("sudo"));
		if (sudoLine) {
			return sudoLine.trim();
		}
	} catch {
		/* non-fatal */
	}
	return null;
}

export function getPm2Status(name) {
	try {
		const raw = execFileSync("pm2", ["jlist"], {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		});
		const list = JSON.parse(raw);
		const inst = list.find((p) => p.name === name);
		if (!inst) return null;
		return {
			status: inst.pm2_env?.status,
			memory: inst.monit?.memory,
			restarts: inst.pm2_env?.restart_time,
			errLogPath: inst.pm2_env?.pm_err_log_path,
		};
	} catch {
		return null;
	}
}

export function pm2DeleteIfExists(name) {
	try {
		execFileSync("pm2", ["delete", name], { stdio: "ignore" });
	} catch {
		/* process may not exist */
	}
}

export function pm2StartEcosystem(ecosystemPath) {
	execFileSync("pm2", ["start", ecosystemPath, "--update-env"], {
		stdio: "inherit",
	});
}

export function pm2Reload(ecosystemPath) {
	execFileSync("pm2", ["startOrReload", ecosystemPath, "--update-env"], {
		stdio: "inherit",
	});
}
