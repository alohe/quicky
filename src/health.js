import { execFileSync } from "node:child_process";
import http from "node:http";

const DEFAULT_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 2_000;

export async function waitForHealthy(project, timeoutMs = DEFAULT_TIMEOUT_MS) {
	const deadline = Date.now() + timeoutMs;
	let lastError = null;

	while (Date.now() < deadline) {
		try {
			const online = checkPm2Online(project.repo);
			if (!online) {
				lastError = "PM2 process is not online";
				await sleep(POLL_INTERVAL_MS);
				continue;
			}

			if (project.port) {
				const httpOk = await checkHttpReady(
					project.port,
					project.healthPath || "/",
				);
				if (!httpOk) {
					lastError = `HTTP check failed on port ${project.port}`;
					await sleep(POLL_INTERVAL_MS);
					continue;
				}
			}

			return { healthy: true };
		} catch (err) {
			lastError = err.message;
			await sleep(POLL_INTERVAL_MS);
		}
	}

	return { healthy: false, reason: lastError || "Health check timed out" };
}

export function checkPm2Online(name) {
	try {
		const raw = execFileSync("pm2", ["jlist"], {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		});
		const list = JSON.parse(raw);
		const inst = list.find((p) => p.name === name);
		return inst?.pm2_env?.status === "online";
	} catch {
		return false;
	}
}

export function checkHttpReady(port, urlPath = "/") {
	return new Promise((resolve) => {
		const req = http.get(
			{ hostname: "127.0.0.1", port, path: urlPath, timeout: 5_000 },
			(res) => {
				res.resume();
				resolve(res.statusCode < 500);
			},
		);
		req.on("error", () => resolve(false));
		req.on("timeout", () => {
			req.destroy();
			resolve(false);
		});
	});
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
