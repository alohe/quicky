import { execFileSync } from "node:child_process";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { CACHE_DIR } from "./config.js";

/**
 * Create a temporary GIT_ASKPASS script that echoes the token.
 * Returns { scriptPath, env } where env should be spread into execFile options.
 */
function makeAskPassEnv(token) {
	const script = path.join(os.tmpdir(), `.quicky-askpass-${process.pid}`);
	fs.writeFileSync(script, `#!/bin/sh\necho "${token}"\n`, { mode: 0o700 });
	return {
		scriptPath: script,
		env: {
			...process.env,
			GIT_ASKPASS: script,
			GIT_TERMINAL_PROMPT: "0",
		},
	};
}

function cleanupAskPass(scriptPath) {
	try {
		fs.removeSync(scriptPath);
	} catch {
		/* best-effort */
	}
}

function mirrorPath(owner, repo) {
	return path.join(CACHE_DIR, `${owner}-${repo}.git`);
}

/**
 * Ensure a bare mirror exists for owner/repo. Creates on first use,
 * fetches on subsequent calls. Returns the mirror path.
 */
export function ensureMirror(owner, repo, token) {
	const mirror = mirrorPath(owner, repo);
	const remoteUrl = `https://quicky-token@github.com/${owner}/${repo}.git`;
	const { scriptPath, env } = makeAskPassEnv(token);

	try {
		if (fs.existsSync(mirror)) {
			execFileSync("git", ["fetch", "--prune"], {
				cwd: mirror,
				env,
				stdio: "pipe",
			});
		} else {
			execFileSync(
				"git",
				["clone", "--mirror", remoteUrl, mirror],
				{ env, stdio: "pipe" },
			);
		}
	} finally {
		cleanupAskPass(scriptPath);
	}

	return mirror;
}

/**
 * Checkout a ref from the bare mirror into a release directory.
 * Uses git archive + tar for a clean export without .git.
 */
export function checkoutFromMirror(mirrorDir, releaseDir, ref = "HEAD") {
	fs.ensureDirSync(releaseDir);

	const archive = execFileSync(
		"git",
		["archive", "--format=tar", ref],
		{ cwd: mirrorDir, stdio: ["pipe", "pipe", "pipe"], maxBuffer: 200 * 1024 * 1024 },
	);

	execFileSync("tar", ["xf", "-"], {
		cwd: releaseDir,
		input: archive,
		stdio: ["pipe", "pipe", "pipe"],
	});
}

/**
 * Get the HEAD sha of a bare mirror.
 */
export function getMirrorHeadSha(mirrorDir) {
	return execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: mirrorDir,
		encoding: "utf-8",
		stdio: ["pipe", "pipe", "pipe"],
	}).trim();
}

/**
 * Clone a repo using GIT_ASKPASS (no token in URL).
 * Used for initial webhook repo clone and similar one-offs.
 */
export function cloneWithAskPass(owner, repo, dest, token) {
	const remoteUrl = `https://quicky-token@github.com/${owner}/${repo}.git`;
	const { scriptPath, env } = makeAskPassEnv(token);

	try {
		execFileSync("git", ["clone", remoteUrl, dest], {
			env,
			stdio: "inherit",
		});
	} finally {
		cleanupAskPass(scriptPath);
	}
}

/**
 * Rewrite a .git/config remote to strip embedded tokens.
 */
export function stripTokenFromRemote(repoPath, remoteName = "origin") {
	const gitConfig = path.join(repoPath, ".git", "config");
	if (!fs.existsSync(gitConfig)) return;

	let content = fs.readFileSync(gitConfig, "utf-8");
	content = content.replace(
		/https:\/\/[^@]+@github\.com\//g,
		"https://github.com/",
	);
	fs.writeFileSync(gitConfig, content);
}
