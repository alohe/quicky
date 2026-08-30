import fs from "fs-extra";
import path from "node:path";
import os from "node:os";

const homeDir = os.homedir();
export const DEFAULT_FOLDER = path.join(homeDir, ".quicky");
export const PROJECTS_DIR = path.join(DEFAULT_FOLDER, "projects");
export const TEMP_DIR = path.join(DEFAULT_FOLDER, "temp");
export const CACHE_DIR = path.join(DEFAULT_FOLDER, "cache");
export const CONFIG_PATH = path.join(DEFAULT_FOLDER, "config.json");
const LOCK_DIR = path.join(DEFAULT_FOLDER, ".config.lock");
const LOCK_STALE_MS = 30_000;

export const CONFIG_VERSION = 2;

fs.ensureDirSync(PROJECTS_DIR);
fs.ensureDirSync(TEMP_DIR);
fs.ensureDirSync(CACHE_DIR);

if (!fs.existsSync(CONFIG_PATH)) {
	const initial = { configVersion: CONFIG_VERSION, projects: [], domains: [] };
	const tmp = `${CONFIG_PATH}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(initial, null, 2), { mode: 0o600 });
	fs.renameSync(tmp, CONFIG_PATH);
}

export function readConfig() {
	return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
}

export function writeConfig(data) {
	const tmp = `${CONFIG_PATH}.tmp`;
	const bak = `${CONFIG_PATH}.bak`;

	if (fs.existsSync(CONFIG_PATH)) {
		fs.copyFileSync(CONFIG_PATH, bak);
	}

	const json = JSON.stringify(data, null, 2);
	fs.writeFileSync(tmp, json, { mode: 0o600 });
	fs.renameSync(tmp, CONFIG_PATH);
}

function acquireLock() {
	const maxWait = LOCK_STALE_MS + 5_000;
	const start = Date.now();

	while (true) {
		try {
			fs.mkdirSync(LOCK_DIR);
			fs.writeFileSync(path.join(LOCK_DIR, "pid"), `${process.pid}`, "utf-8");
			return;
		} catch (err) {
			if (err.code !== "EEXIST") throw err;

			const pidFile = path.join(LOCK_DIR, "pid");
			try {
				const stat = fs.statSync(LOCK_DIR);
				if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
					fs.removeSync(LOCK_DIR);
					continue;
				}
			} catch {
				continue;
			}

			if (Date.now() - start > maxWait) {
				fs.removeSync(LOCK_DIR);
				continue;
			}

			const waitMs = 50 + Math.random() * 100;
			const waitUntil = Date.now() + waitMs;
			while (Date.now() < waitUntil) {
				/* spin */
			}
		}
	}
}

function releaseLock() {
	try {
		fs.removeSync(LOCK_DIR);
	} catch {
		/* best-effort */
	}
}

/**
 * Atomic read-modify-write with advisory locking.
 * `fn` receives the current config, mutates it (or returns a new one),
 * and the result is written back atomically.
 */
export function withConfig(fn) {
	acquireLock();
	try {
		const config = readConfig();
		const result = fn(config);
		const updated = result !== undefined ? result : config;
		writeConfig(updated);
		return updated;
	} finally {
		releaseLock();
	}
}
