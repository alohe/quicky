#!/usr/bin/env node
import { Command } from "commander";
import inquirer from "inquirer";
import { execSync, execFileSync } from "node:child_process";
import fs from "fs-extra";
import chalk from "chalk";
import { createSpinner } from "nanospinner";
import os from "node:os";
import path from "node:path";
import Table from "cli-table3";
import net from "node:net";
import { v4 as uuidv4 } from "uuid";
import { formatDistanceToNow } from "date-fns";
import latestVersion from "latest-version";
import semver from "semver";
import { fileURLToPath } from "node:url";
import axios from "axios";
import bcryptjs from "bcryptjs";

import {
	DEFAULT_FOLDER,
	PROJECTS_DIR,
	TEMP_DIR,
	CONFIG_PATH,
	readConfig,
	writeConfig,
	withConfig,
} from "./src/config.js";

import { validateName, validatePort } from "./src/validate.js";

import {
	buildEcosystemFile,
	pm2Save,
	pm2Startup,
	getPm2Status,
	pm2DeleteIfExists,
	pm2StartEcosystem,
	pm2Reload,
} from "./src/pm2.js";

import {
	ensureReleaseLayout,
	createReleaseDir,
	linkSharedPaths,
	swapRelease,
	rollbackRelease,
	pruneReleases,
	getCurrentRelease,
	getProjectRoot,
	getSharedDir,
	getCurrentSymlink,
} from "./src/release.js";

import { waitForHealthy } from "./src/health.js";

import {
	ensureMirror,
	checkoutFromMirror,
	getMirrorHeadSha,
	cloneWithAskPass,
} from "./src/git.js";

import { migrateIfNeeded } from "./src/migration.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const program = new Command();

const packagePath = path.resolve(__dirname, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf-8"));

migrateIfNeeded();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = console.log;

// ---------------------------------------------------------------------------
// Self-update check (skipped in non-TTY, with 24h cache + request timeout)
// ---------------------------------------------------------------------------

const UPDATE_CACHE_PATH = path.join(DEFAULT_FOLDER, ".update-check");
const UPDATE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function updateCLI() {
	try {
		execSync("sudo npm install -g quicky", { stdio: "inherit" });
		console.log(
			chalk.green("Quicky has been upgraded to the latest version."),
		);
	} catch (error) {
		console.error(chalk.red(`Failed to upgrade Quicky: ${error.message}`));
	}
}

async function checkForUpdates() {
	if (!process.stdout.isTTY) return;

	try {
		const now = Date.now();
		if (fs.existsSync(UPDATE_CACHE_PATH)) {
			const cached = JSON.parse(
				fs.readFileSync(UPDATE_CACHE_PATH, "utf-8"),
			);
			if (now - cached.ts < UPDATE_CACHE_TTL_MS) return;
		}
	} catch {
		/* corrupted cache, proceed with check */
	}

	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 5_000);
		const latest = await latestVersion("quicky");
		clearTimeout(timer);

		fs.writeFileSync(
			UPDATE_CACHE_PATH,
			JSON.stringify({ ts: Date.now(), version: latest }),
		);

		if (semver.gt(latest, packageJson.version)) {
			console.log(
				`\n🚀 A new version of Quicky (v${chalk.bold.blue(latest)}) is available!`,
			);

			const { shouldUpgrade } = await inquirer.prompt([
				{
					type: "confirm",
					name: "shouldUpgrade",
					message:
						" Would you like to update quicky to the latest version? Your configurations will be preserved.",
					default: true,
				},
			]);

			if (shouldUpgrade) {
				updateCLI();
			} else {
				console.log(
					chalk.yellow(
						"You can upgrade later by running 'quicky upgrade'.",
					),
				);
			}
		}
	} catch {
		/* network errors are non-fatal */
	}
}

program.hook("postAction", async () => {
	const excludedCommands = ["upgrade", "uninstall"];
	const command = process.argv[2];
	if (!excludedCommands.includes(command)) {
		await checkForUpdates();
	}
});

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

async function removeDomain(domain) {
	const nginxConfigPath = `/etc/nginx/sites-available/${domain}`;
	if (fs.existsSync(nginxConfigPath)) {
		execFileSync("sudo", ["rm", "-f", nginxConfigPath, `/etc/nginx/sites-enabled/${domain}`], { stdio: "inherit" });
		execSync("sudo service nginx restart", { stdio: "inherit" });
		log(chalk.green(`Nginx configuration removed for ${domain}.`));
	}

	try {
		execFileSync("sudo", ["certbot", "delete", "--cert-name", domain, "--non-interactive"], { stdio: "pipe" });
		log(chalk.green(`SSL certificate removed for ${domain}.`));
	} catch {
		/* certificate may not exist */
	}

	withConfig((config) => {
		config.domains = (config.domains || []).filter(
			(d) => d.domain !== domain,
		);
	});
	log(chalk.green(`Domain ${domain} removed successfully.`));
}

async function setupDomain(domain, port) {
	try {
		execSync("nginx -v", { stdio: "ignore" });
	} catch {
		execSync("sudo apt install nginx -y", { stdio: "inherit" });
	}

	try {
		execSync("certbot --version && certbot plugins | grep nginx", {
			stdio: "ignore",
		});
	} catch {
		execSync("sudo apt install certbot python3-certbot-nginx -y", {
			stdio: "inherit",
		});
	}

	const config = readConfig();
	const domainExists = (config.domains || []).some(
		(d) => d.domain === domain,
	);

	if (domainExists) {
		const { overwrite } = await inquirer.prompt([
			{
				type: "confirm",
				name: "overwrite",
				message: `Domain ${domain} already exists. Do you want to overwrite and reconfigure it?`,
				default: false,
			},
		]);

		if (!overwrite) {
			throw new Error("Domain configuration cancelled by user");
		}

		await removeDomain(domain);
		log(
			chalk.green(
				`Existing configuration for ${domain} has been removed. Proceeding with new setup...`,
			),
		);
	} else {
		const nginxConfigPath = `/etc/nginx/sites-available/${domain}`;
		const nginxSymlinkPath = `/etc/nginx/sites-enabled/${domain}`;

		if (
			fs.existsSync(nginxConfigPath) ||
			fs.existsSync(nginxSymlinkPath)
		) {
			log(
				chalk.yellow(
					`Found existing Nginx configuration for ${domain}, removing...`,
				),
			);
			try {
				fs.unlinkSync(nginxSymlinkPath);
				fs.unlinkSync(nginxConfigPath);
			} catch {
				/* files may not exist */
			}
		}

		try {
			execFileSync("certbot", ["delete", "--cert-name", domain, "--non-interactive"], {
				stdio: "ignore",
			});
			log(chalk.yellow(`Removed existing SSL certificate for ${domain}`));
		} catch {
			/* certificate may not exist */
		}
	}

	log(
		chalk.yellow(
			`Please ensure that ${domain} is pointing to this server's IPv4 address before proceeding.`,
		),
	);
	log(
		chalk.yellow(
			"You can do this by updating your domain's DNS A record.",
		),
	);

	const nginxConfigPath = `/etc/nginx/sites-available/${domain}`;
	const nginxSymlinkPath = `/etc/nginx/sites-enabled/${domain}`;

	if (
		fs.existsSync(nginxConfigPath) ||
		fs.existsSync(nginxSymlinkPath)
	) {
		log(
			chalk.yellow(
				`Found existing Nginx configuration for ${domain}, removing...`,
			),
		);
		try {
			fs.unlinkSync(nginxSymlinkPath);
			fs.unlinkSync(nginxConfigPath);
		} catch (error) {
			log(chalk.yellow(`Error removing existing files: ${error.message}`));
			log(chalk.yellow("Continuing with setup..."));
		}
	}

	const zoneName = `zone_${uuidv4().slice(0, 5)}`;
	const nginxConfig = `
    limit_req_zone $binary_remote_addr zone=${zoneName}:10m rate=30r/s;

    server {
      listen 80;
      server_name ${domain};

      location / {
        limit_req zone=${zoneName} burst=10 delay=10;
        proxy_pass http://localhost:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-NginX-Proxy true;
        proxy_buffering on;
        proxy_buffer_size 256k;
        proxy_buffers 8 256k;
        proxy_busy_buffers_size 512k;
        proxy_temp_file_write_size 512k;
        proxy_max_temp_file_size 1024m;
        proxy_cache_bypass $http_upgrade;
        proxy_cache_use_stale error timeout http_500 http_502 http_503 http_504;
        proxy_cache_valid 200 60m;
        proxy_cache_valid 404 1m;
      }

      location /_next/static {
        proxy_pass http://localhost:${port};
        proxy_cache_bypass $http_upgrade;
        expires 365d;
        access_log off;
        add_header Cache-Control "public, no-transform, must-revalidate";
      }

      location /static {
        proxy_pass http://localhost:${port};
        proxy_cache_bypass $http_upgrade;
        expires 365d;
        access_log off;
        add_header Cache-Control "public, no-transform, must-revalidate";
      }

      location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        proxy_pass http://localhost:${port};
        proxy_cache_bypass $http_upgrade;
        expires 7d;
        add_header Cache-Control "public, no-transform, must-revalidate";
        etag on;
        if_modified_since exact;
        access_log off;
        log_not_found off;
      }

      gzip on;
      gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
      gzip_comp_level 6;
      gzip_min_length 1000;

      proxy_connect_timeout 60s;
      proxy_send_timeout 60s;
      proxy_read_timeout 60s;
      keepalive_timeout 65s;
      keepalive_requests 100;

      client_max_body_size 50M;

      access_log /var/log/nginx/${domain}-access.log combined buffer=512k flush=1m;
      error_log /var/log/nginx/${domain}-error.log warn;

      add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
      add_header X-Content-Type-Options "nosniff" always;
      add_header X-Frame-Options "SAMEORIGIN" always;
      add_header X-XSS-Protection "1; mode=block" always;
      add_header Referrer-Policy "strict-origin-when-cross-origin" always;
      add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;
      add_header Content-Security-Policy "default-src 'self' *; script-src 'self' 'unsafe-inline' 'unsafe-eval' *; style-src 'self' 'unsafe-inline' *; img-src 'self' data: https: *; font-src 'self' data: *; connect-src 'self' https: *; frame-ancestors 'none';" always;
    }
  `;

	const tempFilePath = `/tmp/${domain}.conf`;
	fs.writeFileSync(tempFilePath, nginxConfig, { mode: 0o644 });

	execFileSync("sudo", ["mv", tempFilePath, nginxConfigPath], {
		stdio: "inherit",
	});

	if (!fs.existsSync(nginxSymlinkPath)) {
		execFileSync("sudo", ["ln", "-s", nginxConfigPath, nginxSymlinkPath], {
			stdio: "inherit",
		});
	} else {
		log(chalk.yellow(`Symlink already exists for ${domain}.`));
	}

	execSync("sudo service nginx restart", { stdio: "inherit" });
	log(chalk.green(`Nginx configuration created for ${domain}.`));

	let currentConfig = readConfig();
	if (!currentConfig.email) {
		const { email } = await inquirer.prompt([
			{
				type: "input",
				name: "email",
				message: "Enter your email address for SSL certificate:",
				validate: (input) => {
					const emailRegex = /\S+@\S+\.\S+/;
					return emailRegex.test(input)
						? true
						: "Please enter a valid email.";
				},
			},
		]);

		withConfig((c) => {
			c.email = email;
		});
		currentConfig = readConfig();
	}

	try {
		execSync("which certbot", { stdio: "ignore" });
	} catch {
		execSync("sudo apt install certbot python3-certbot-nginx -y", {
			stdio: "inherit",
		});
	}

	try {
		execSync(
			`sudo certbot --nginx -d ${domain} --non-interactive --agree-tos --email ${currentConfig.email}`,
			{ stdio: "inherit" },
		);
	} catch (error) {
		console.error(
			chalk.red(`Failed to obtain SSL certificate: ${error.message}`),
		);
		process.exit(1);
	}

	log(
		chalk.green(
			`SSL certificate obtained and configured for ${domain}.`,
		),
	);
}

// ---------------------------------------------------------------------------
// Port helpers
// ---------------------------------------------------------------------------

function isPortInUse(port) {
	return new Promise((resolve) => {
		const server = net.createServer();
		server.once("error", (err) => {
			resolve(err.code === "EADDRINUSE");
		});
		server.once("listening", () => {
			server.close();
			resolve(false);
		});
		server.listen(port);
	});
}

async function getAvailablePort(port) {
	let current = port;
	while (await isPortInUse(current)) {
		const answer = await inquirer.prompt([
			{
				type: "input",
				name: "port",
				message: `Port ${current} is already in use. Please enter another port:`,
				validate: (input) => {
					const n = Number.parseInt(input, 10);
					return Number.isInteger(n) && n > 0 && n <= 65535
						? true
						: "Please enter a valid port number (1-65535).";
				},
			},
		]);
		current = Number.parseInt(answer.port, 10);
	}
	return current;
}

function getRandomAvailablePort() {
	return new Promise((resolve) => {
		const server = net.createServer();
		server.listen(0, () => {
			const { port } = server.address();
			server.close(() => resolve(port));
		});
	});
}

// ---------------------------------------------------------------------------
// Webhook helpers
// ---------------------------------------------------------------------------

async function setupWebhookServer() {
	const config = readConfig();

	const { webhookUrl } = await inquirer.prompt([
		{
			type: "input",
			name: "webhookUrl",
			message:
				"Enter the URL where the webhook will be received (e.g., quicky.example.com):",
			validate: (input) => {
				if (input.trim() === "") return "URL is required.";
				if (
					(config.domains || []).some(
						(d) => d.domain === input.trim(),
					)
				)
					return "This domain is already in use. Please enter a different URL.";
				return true;
			},
		},
	]);

	const availablePort = await getRandomAvailablePort();

	const webhookPath = path.join(DEFAULT_FOLDER, "webhook");

	if (
		fs.existsSync(webhookPath) &&
		fs.readdirSync(webhookPath).length > 0
	) {
		log(
			chalk.yellow(
				`Directory ${webhookPath} already exists and is not empty. Deleting...`,
			),
		);

		try {
			execFileSync("pm2", ["stop", "quicky-webhook-server"], { stdio: "pipe" });
			execFileSync("pm2", ["delete", "quicky-webhook-server"], { stdio: "pipe" });
		} catch {
			/* may not exist */
		}

		fs.removeSync(webhookPath);
	}

	execFileSync("git", ["clone", "https://github.com/alohe/quicky-webhook.git", webhookPath], {
		stdio: "inherit",
	});

	execSync(`cd ${webhookPath} && npm install`, { stdio: "inherit" });

	await setupDomain(webhookUrl, availablePort);

	const webhookSecret = uuidv4();

	const envFilePath = path.join(webhookPath, ".env");
	const envContent = `WEBHOOK_URL=${webhookUrl}\nWEBHOOK_PORT=${availablePort}\nWEBHOOK_SECRET=${webhookSecret}`;
	fs.writeFileSync(envFilePath, envContent);

	const currentConfig = readConfig();
	if (currentConfig.projects && currentConfig.projects.length > 0) {
		for (const project of currentConfig.projects) {
			if (project.webhookId) {
				const webhookConfig = {
					config: {
						url: `https://${webhookUrl}/webhook`,
						content_type: "json",
						secret: webhookSecret,
					},
				};

				try {
					await axios.patch(
						`https://api.github.com/repos/${project.owner}/${project.repo}/hooks/${project.webhookId}`,
						webhookConfig,
						{
							headers: {
								Authorization: `Bearer ${currentConfig.github.access_token}`,
							},
						},
					);
					console.log(
						`Webhook updated for project: ${project.repo}`,
					);
				} catch (error) {
					console.error(
						`Error updating webhook for project ${project.repo}: ${error.message}`,
					);
				}
			}
		}
	}

	try {
		execFileSync(
			"pm2",
			["start", path.join(webhookPath, "index.js"), "--name", "quicky-webhook-server"],
			{ stdio: "inherit" },
		);
	} catch (error) {
		if (error.message.includes("Script already launched")) {
			try {
				execFileSync("pm2", ["restart", "quicky-webhook-server"], {
					stdio: "inherit",
				});
			} catch (restartError) {
				console.error(
					"Failed to restart the webhook server:",
					restartError.message,
				);
				throw restartError;
			}
		} else {
			console.error(
				"Failed to start the webhook server:",
				error.message,
			);
			throw error;
		}
	}

	withConfig((c) => {
		c.webhook = {
			webhookUrl: `https://${webhookUrl}/webhook`,
			webhookPort: availablePort,
			secret: webhookSecret,
			pm2Name: "quicky-webhook-server",
		};
	});

	pm2Save();

	log(
		chalk.green(
			`Webhook server set up and running at https://${webhookUrl}/webhook`,
		),
	);
}

async function setupWebhook(repo) {
	const config = readConfig();

	if (
		!config.webhook ||
		!config.webhook.webhookUrl ||
		!config.webhook.webhookPort ||
		!config.webhook.secret
	) {
		log(
			chalk.yellow(
				"Webhook server is not fully configured. Please set up the webhook server first.",
			),
		);

		const { confirmWebhookSetup } = await inquirer.prompt([
			{
				type: "confirm",
				name: "setupWebhookServer",
				message: "Do you want to set up the webhook server now?",
				default: true,
			},
		]);

		if (confirmWebhookSetup) {
			await setupWebhookServer();
		} else {
			log(chalk.yellow("Operation cancelled."));
			return null;
		}
	}

	const latestConfig = readConfig();
	const webhookConfig = {
		name: "web",
		active: true,
		events: ["push"],
		config: {
			url: latestConfig.webhook.webhookUrl,
			content_type: "json",
			secret: latestConfig.webhook.secret,
		},
	};

	try {
		const response = await axios.post(
			`https://api.github.com/repos/${repo}/hooks`,
			webhookConfig,
			{
				headers: {
					Authorization: `Bearer ${latestConfig.github.access_token}`,
				},
			},
		);
		console.log(`Webhook created: ${response.data.id}`);
		return response.data.id;
	} catch (error) {
		console.error(`Error creating webhook: ${error.message}`);
		return null;
	}
}

async function removeWebhook(repo, webhookId) {
	const config = readConfig();
	try {
		await axios.delete(
			`https://api.github.com/repos/${repo}/hooks/${webhookId}`,
			{
				headers: {
					Authorization: `Bearer ${config.github.access_token}`,
				},
			},
		);
		console.log(`Webhook ${webhookId} removed.`);
		return true;
	} catch (error) {
		console.error(`Error removing webhook: ${error.message}`);
		return false;
	}
}

// ---------------------------------------------------------------------------
// Deploy & Update (atomic releases + health check)
// ---------------------------------------------------------------------------

async function deployOrUpdate(project, { promptEnv = false, isInitialDeploy = false } = {}) {
	const config = readConfig();

	validateName(project.owner, "owner");
	validateName(project.repo, "repo");

	if (project.type === "next.js" && !project.port) {
		throw new Error("A port is required for a Next.js project");
	}

	const spinner = createSpinner(
		isInitialDeploy
			? `Deploying ${project.repo}...`
			: `Updating ${project.repo}...`,
	).start();
	await sleep(500);

	ensureReleaseLayout(project.repo);

	const previousRelease = getCurrentRelease(project.repo);

	spinner.update({ text: "Fetching repository..." });

	let releaseDir;
	try {
		const mirror = ensureMirror(
			project.owner,
			project.repo,
			config.github.access_token,
		);
		const sha = getMirrorHeadSha(mirror);
		const release = createReleaseDir(project.repo, sha);
		releaseDir = release.dir;

		checkoutFromMirror(mirror, releaseDir, "HEAD");
	} catch (fetchError) {
		spinner.error({ text: `Fetch failed: ${fetchError.message}` });
		throw fetchError;
	}

	spinner.stop();

	const persist = project.persist || [
		".env",
		".env.local",
		".env.production",
		".env.production.local",
	];

	if (promptEnv) {
		const sharedDir = getSharedDir(project.repo);
		const sharedEnv = path.join(sharedDir, ".env");

		if (fs.existsSync(sharedEnv)) {
			const { updateEnv } = await inquirer.prompt([
				{
					type: "confirm",
					name: "updateEnv",
					message: "Would you like to update the .env file?",
					default: false,
				},
			]);

			if (updateEnv) {
				execSync(`nano ${sharedEnv}`, { stdio: "inherit" });
			}
		} else {
			const { createEnv } = await inquirer.prompt([
				{
					type: "confirm",
					name: "createEnv",
					message: "Would you like to create a .env file?",
					default: false,
				},
			]);

			if (createEnv) {
				fs.ensureDirSync(sharedDir);
				fs.writeFileSync(
					sharedEnv,
					"# Add your environment variables below\n",
				);
				execSync(`nano ${sharedEnv}`, { stdio: "inherit" });
			}
		}
	}

	linkSharedPaths(project.repo, releaseDir, persist);

	spinner.start();
	spinner.update({ text: "Installing dependencies..." });

	const packageManager = config.packageManager || "npm";
	const installCmd =
		packageManager === "bun" ? "bun install" : "npm install";
	const buildCmd =
		packageManager === "bun" ? "bun run build" : "npm run build";

	try {
		execSync(`cd "${releaseDir}" && ${installCmd}`, {
			stdio: "inherit",
		});
	} catch (error) {
		spinner.error({ text: `Install failed: ${error.message}` });
		fs.removeSync(releaseDir);
		throw new Error(`Failed to install dependencies: ${error.message}`);
	}

	try {
		const releasePkg = JSON.parse(
			fs.readFileSync(path.join(releaseDir, "package.json"), "utf8"),
		);
		if (releasePkg.scripts?.build) {
			spinner.update({ text: "Building the project..." });
			execSync(`cd "${releaseDir}" && ${buildCmd}`, {
				stdio: "inherit",
			});

			if (
				project.type === "next.js" &&
				!fs.existsSync(path.join(releaseDir, ".next"))
			) {
				throw new Error(
					"Next.js build did not generate .next directory",
				);
			}
		}
	} catch (error) {
		spinner.error({ text: `Build failed: ${error.message}` });
		fs.removeSync(releaseDir);
		throw new Error(`Failed to build project: ${error.message}`);
	}

	spinner.update({ text: "Building PM2 ecosystem..." });

	const ecosystemPath = buildEcosystemFile(project, releaseDir);

	spinner.update({ text: "Switching to new release..." });

	swapRelease(project.repo, releaseDir);

	pm2DeleteIfExists(project.repo);
	try {
		pm2StartEcosystem(ecosystemPath);
	} catch (startError) {
		log(
			chalk.red(
				`Failed to start project: ${startError.message}`,
			),
		);
		if (previousRelease) {
			log(chalk.yellow("Rolling back to previous release..."));
			rollbackRelease(project.repo, previousRelease);
			const prevEcosystem = path.join(
				previousRelease,
				"ecosystem.config.cjs",
			);
			if (fs.existsSync(prevEcosystem)) {
				try {
					pm2StartEcosystem(prevEcosystem);
				} catch {
					/* best effort */
				}
			}
			log(
				chalk.yellow(
					`Project ${project.repo} has been rolled back due to startup failure.`,
				),
			);
		}
		spinner.error({ text: `Startup failed: ${startError.message}` });
		throw new Error(
			`Failed to start project: ${startError.message}`,
		);
	}

	spinner.update({ text: "Running health checks..." });

	const health = await waitForHealthy(project);

	if (!health.healthy) {
		log(
			chalk.red(
				`Health check failed: ${health.reason}`,
			),
		);
		if (previousRelease) {
			log(chalk.yellow("Rolling back to previous release..."));
			rollbackRelease(project.repo, previousRelease);
			pm2DeleteIfExists(project.repo);
			const prevEcosystem = path.join(
				previousRelease,
				"ecosystem.config.cjs",
			);
			if (fs.existsSync(prevEcosystem)) {
				try {
					pm2StartEcosystem(prevEcosystem);
				} catch {
					/* best effort */
				}
			}
			log(
				chalk.yellow(
					`Project ${project.repo} has been rolled back.`,
				),
			);
		}
		spinner.error({ text: `Health check failed: ${health.reason}` });
		throw new Error(`Health check failed: ${health.reason}`);
	}

	pruneReleases(project.repo);
	pm2Save();

	withConfig((c) => {
		const proj = c.projects.find((p) => p.repo === project.repo);
		if (proj) {
			proj.last_updated = new Date().toISOString();
		}
	});

	spinner.success({
		text: `Project ${chalk.green.bold(project.repo)} ${isInitialDeploy ? "deployed" : "updated"} successfully.`,
	});
}

// ---------------------------------------------------------------------------
// Status display
// ---------------------------------------------------------------------------

function status() {
	const config = readConfig();

	const table = new Table({
		head: [
			chalk.cyan.bold("PID"),
			chalk.cyan.bold("Owner"),
			chalk.cyan.bold("Repository"),
			chalk.cyan.bold("Port"),
			chalk.cyan.bold("Status"),
			chalk.cyan.bold("Memory"),
			chalk.cyan.bold("Disk Space"),
			chalk.cyan.bold("Last Updated"),
			chalk.cyan.bold("Errors"),
		],
		style: { head: ["cyan", "bold"] },
		wordWrap: true,
		colWidths: [8, 12, 15, 8, 12, 12, 12, 15, 25],
	});

	const errorProjects = [];

	for (const project of config.projects) {
		let pm2Status = "Not Running";
		let memory = "N/A";
		let diskSpace = "N/A";
		let errorMsg = "";

		const info = getPm2Status(project.repo);
		if (info) {
			pm2Status = info.status || "unknown";
			if (info.memory) {
				memory = `${Math.round(info.memory / (1024 * 1024))}MB`;
			}

			const projectPath = getProjectRoot(project.repo);
			if (fs.existsSync(projectPath)) {
				try {
					const size = execSync(
						`du -sh "${projectPath}" | cut -f1`,
						{ encoding: "utf-8" },
					).trim();
					diskSpace = size;
				} catch {
					/* ignore */
				}
			}

			if (info.status !== "online" && info.errLogPath && fs.existsSync(info.errLogPath)) {
				try {
					const errors = fs.readFileSync(info.errLogPath, "utf-8").split("\n").filter(Boolean).pop() || "";
					if (errors) {
						errorMsg =
							errors.substring(0, 25) +
							(errors.length > 25 ? "..." : "");
						errorProjects.push({
							repo: project.repo,
							error: errors,
						});
					}
				} catch {
					/* ignore */
				}
			}
		}

		table.push([
			chalk.yellow.bold(project.pid),
			chalk.white(project.owner),
			chalk.white(project.repo),
			project.port
				? chalk.greenBright.bold(project.port)
				: chalk.gray("N/A"),
			pm2Status === "online"
				? chalk.green(pm2Status)
				: chalk.red(pm2Status),
			chalk.white(memory),
			chalk.white(diskSpace),
			chalk.white(
				formatDistanceToNow(new Date(project.last_updated), {
					addSuffix: true,
				}),
			),
			errorMsg ? chalk.red(errorMsg) : chalk.gray("-"),
		]);
	}

	log(table.toString());

	if (errorProjects.length > 0) {
		inquirer
			.prompt([
				{
					type: "confirm",
					name: "viewErrors",
					message: `${errorProjects.length} project(s) have errors. View full logs?`,
					default: false,
				},
			])
			.then((answer) => {
				if (answer.viewErrors) {
					for (const { repo, error } of errorProjects) {
						console.log(
							chalk.red(`\n--- ${repo} ---`),
						);
						console.log(error);
					}
				}
			});
	}
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function help() {
	const rabbit = `
 (\\(\\${" "}
 ( -.-)
 o_(")(")
`;

	log(chalk.blue(rabbit));
	log(
		`${chalk.hex("#fd6d4c").bold("Quicky")}${chalk.hex("#f39549")(" - A CLI tool to deploy Next.js and Node.js projects")}`,
	);
	log("");
	log("Usage:");
	log(
		`${chalk.blue("  quicky")} ${chalk.hex("#FFA500")("<command>")} ${chalk.green("[options]")}`,
	);
	log("");
	log("Commands:");
	log(
		`  ${chalk.hex("#cea9fe").bold("init")}      Save your GitHub account details and install dependencies\n`,
	);
	log(
		`  ${chalk.blue.bold("deploy")}    Deploy a Next.js or Node.js project from GitHub`,
	);
	log(
		`  ${chalk.blue.bold("list")}      List the current configuration and associated PM2 instances`,
	);
	log(
		`  ${chalk.blue.bold("manage")}    Start, stop, restart, update, or delete a project \n`,
	);
	log(
		`  ${chalk.blue.bold("update")}    Update a project by its PID, primarily used by the webhook server\n`,
	);
	log(
		`  ${chalk.cyanBright.bold("domains")}   Manage domains and subdomains for the projects`,
	);
	log(
		`  ${chalk.cyanBright.bold("webhooks")}  Manage the webhook server for your projects`,
	);
	log(
		`  ${chalk.cyanBright.bold("persist")}   Manage persisted files for a project`,
	);
	log("");
	log(`  ${chalk.hex("#fe64fa").bold("install")}   Install quicky globally`);
	log(
		`  ${chalk.hex("#fe64fa").bold("upgrade")}   Upgrade quicky to the latest version`,
	);
	log(
		`  ${chalk.hex("#fe64fa").bold("uninstall")} Uninstall the CLI tool globally`,
	);
	log("");
	log("Options:");
	log("  --help    Display help for the command");
	log("  -v, --version    Output the current version of Quicky");
	log("");
	log("For more information, visit https://quicky.dev");
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

program
	.version(
		`${packageJson.version}`,
		"-v, --version",
		"Output the current version of Quicky",
	)
	.action(async () => {
		help();
	});

program.option("-h, --help", "Display help for the command").action(() => {
	help();
});

program
	.command("install")
	.description("Install the CLI tool globally")
	.action(() => {
		try {
			execSync("sudo npm install -g quicky", { stdio: "inherit" });
			log(chalk.green("Quicky has been installed globally."));
		} catch (error) {
			console.error(
				chalk.red(`Failed to install Quicky: ${error.message}`),
			);
		}
	});

program
	.command("uninstall")
	.description("Uninstall the CLI tool globally")
	.action(async () => {
		try {
			log(chalk.red.bold("\n⚠️  WARNING: This action is irreversible!"));
			log(
				chalk.red.bold(
					"All projects and configurations will be permanently deleted.",
				),
			);
			const { confirmUninstall } = await inquirer.prompt([
				{
					type: "confirm",
					name: "confirmUninstall",
					message: "Are you sure you want to uninstall Quicky?",
					default: false,
				},
			]);

			if (confirmUninstall) {
				const config = readConfig();

				try {
					for (const project of config.projects) {
						pm2DeleteIfExists(project.repo);
					}

					if (config.webhook?.pm2Name) {
						pm2DeleteIfExists(config.webhook.pm2Name);
					}

					log(
						chalk.green(
							"All PM2 instances managed by Quicky have been stopped and deleted.",
						),
					);
				} catch (error) {
					log(
						chalk.red(
							`Failed to stop PM2 instances: ${error.message}`,
						),
					);
				}

				try {
					const domains = config.domains || [];
					for (const domain of domains) {
						const domainConfigPath = `/etc/nginx/sites-available/${domain.domain}`;
						const domainSymlinkPath = `/etc/nginx/sites-enabled/${domain.domain}`;
						if (fs.existsSync(domainConfigPath)) {
							execFileSync("sudo", ["rm", domainConfigPath], {
								stdio: "inherit",
							});
						}
						if (fs.existsSync(domainSymlinkPath)) {
							execFileSync("sudo", ["rm", domainSymlinkPath], {
								stdio: "inherit",
							});
						}
					}
					log(
						chalk.green(
							"Nginx configurations for all domains managed by Quicky have been deleted.",
						),
					);
				} catch (error) {
					log(
						chalk.red(
							`Failed to delete Nginx configurations: ${error.message}`,
						),
					);
				}

				try {
					fs.removeSync(DEFAULT_FOLDER);
					log(
						chalk.green(
							"Quicky has been uninstalled successfully.",
						),
					);
				} catch (error) {
					log(
						chalk.red(
							`Failed to delete Quicky folder: ${error.message}`,
						),
					);
				}

				try {
					execSync("sudo npm uninstall -g quicky", {
						stdio: "inherit",
					});
					log(
						chalk.green(
							"✔ Quicky has been uninstalled successfully.",
						),
					);
				} catch (error) {
					log(
						chalk.red(
							`Failed to uninstall Quicky: ${error.message}`,
						),
					);
				}
			} else {
				log(chalk.yellow("Uninstallation of projects cancelled."));
			}
		} catch (error) {
			console.error(chalk.red(`Error: ${error.message}`));
		}
	});

program
	.command("init")
	.description(
		"Save your GitHub account details and install dependencies",
	)
	.option("--username <username>", "GitHub username")
	.option("--token <token>", "GitHub personal access token")
	.option(
		"--packageManager <packageManager>",
		"Package manager to use (npm|bun)",
	)
	.action(async (cmd) => {
		let spinner = null;
		try {
			let { username, token, packageManager } = cmd || {};
			const config = readConfig();
			let wantsUpdate = false;

			if (
				config.github?.username &&
				config.github?.access_token &&
				config.packageManager
			) {
				const { updateConfig } = await inquirer.prompt([
					{
						type: "list",
						name: "updateConfig",
						message:
							"GitHub details are already configured. What would you like to do?",
						choices: [
							"Keep existing configuration",
							"Update configuration",
						],
					},
				]);

				if (updateConfig === "Keep existing configuration") {
					return;
				}
				wantsUpdate = true;
			}

			if (
				!username ||
				!token ||
				!packageManager ||
				wantsUpdate
			) {
				const answers = await inquirer.prompt([
					{
						name: "username",
						message: "Enter your GitHub username:",
						default:
							username || config.github?.username,
					},
					{
						name: "token",
						message:
							"Enter your GitHub personal access token:",
						default:
							token || config.github?.access_token,
					},
					{
						type: "list",
						name: "packageManager",
						message: "Choose your package manager:",
						choices: ["npm", "bun"],
						default:
							packageManager ||
							config.packageManager,
					},
				]);

				username = answers.username;
				token = answers.token;
				packageManager = answers.packageManager;
			}

			if (!username || !token) {
				console.error(
					chalk.red(
						`Failed to save GitHub account details. Please ensure you have a valid personal access token. ${chalk.green("https://github.com/settings/tokens")}`,
					),
				);
				return;
			}

			withConfig((c) => {
				c.github = {
					username,
					access_token: token,
				};
				c.packageManager = packageManager;
			});

			try {
				execSync("git --version", { stdio: "ignore" });
			} catch {
				log(chalk.yellow("Git is not installed. Installing..."));
				execSync("sudo apt install git -y", {
					stdio: "inherit",
				});
			}

			try {
				execSync("curl --version", { stdio: "ignore" });
			} catch {
				log(
					chalk.yellow(
						"curl is not installed. Installing...",
					),
				);
				execSync("sudo apt install curl -y", {
					stdio: "inherit",
				});
			}

			if (packageManager === "bun") {
				try {
					execSync("bun --version", { stdio: "ignore" });
				} catch {
					log(
						chalk.yellow(
							"Bun is not installed. Installing...",
						),
					);
					execSync(
						"curl -fsSL https://bun.sh/install | bash",
						{ stdio: "inherit" },
					);
				}
			} else {
				try {
					execSync("npm --version", { stdio: "ignore" });
				} catch {
					log(
						chalk.yellow(
							"npm is not installed. Installing Node.js and npm...",
						),
					);
					execSync(
						"curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -",
						{ stdio: "inherit" },
					);
					execSync("sudo apt install -y nodejs", {
						stdio: "inherit",
					});
				}
			}

			try {
				execSync("pm2 --version", { stdio: "ignore" });
			} catch {
				log(
					chalk.yellow(
						"PM2 is not installed. Installing...",
					),
				);
				execSync("sudo npm install -g pm2", {
					stdio: "inherit",
				});
			}

			try {
				execSync("nginx -v", { stdio: "ignore" });
			} catch {
				log(
					chalk.yellow(
						"nginx is not installed. Installing...",
					),
				);
				execSync("sudo apt install nginx -y", {
					stdio: "inherit",
				});
			}

			try {
				execSync("certbot --version", { stdio: "ignore" });
			} catch {
				log(
					chalk.yellow(
						"certbot is not installed. Installing...",
					),
				);
				execSync(
					"sudo apt install certbot python3-certbot-nginx -y",
					{ stdio: "inherit" },
				);
			}

			const startupCmd = pm2Startup();
			if (startupCmd) {
				log(
					chalk.yellow(
						`\nTo enable PM2 on startup, run:\n  ${startupCmd}`,
					),
				);
			}

			const freshConfig = readConfig();
			if (freshConfig.webhook?.pm2Name) {
				try {
					const pm2Info = getPm2Status(
						freshConfig.webhook.pm2Name,
					);
					if (!pm2Info || pm2Info.status !== "online") {
						log(
							chalk.yellow(
								"Webhook server is not running. Restarting...",
							),
						);
						execFileSync("pm2", ["restart", freshConfig.webhook.pm2Name], {
							stdio: "inherit",
						});
						log(
							chalk.green(
								"Webhook server restarted successfully.",
							),
						);
					} else {
						log(
							chalk.green(
								"Webhook server is already running.",
							),
						);
					}
				} catch {
					log(
						chalk.yellow(
							"Attempting to start webhook server...",
						),
					);
					await setupWebhookServer();
				}
			} else {
				log(
					"Webhook server is not configured. Setting up...",
				);
				await setupWebhookServer();
			}

			spinner = createSpinner(
				"Saving your GitHub account details and installing dependencies...",
			).start();
			await sleep(1000);

			try {
				execSync("pm2 -v", { stdio: "ignore" });
				spinner.success({
					text: "GitHub account details saved and dependencies installed successfully!",
				});
			} catch {
				try {
					execSync("npm install -g pm2", {
						stdio: "inherit",
					});
					spinner.success({
						text: "GitHub account details saved and dependencies installed successfully!",
					});
				} catch {
					spinner.error({
						text: "Failed to install dependencies. Please ensure you have npm installed.",
					});
				}
			}

			pm2Save();

			log(
				`\n📁 Configuration files are stored at: ${chalk.green(CONFIG_PATH)}`,
			);
			log(
				`📂 Projects will be stored in: ${chalk.green(PROJECTS_DIR)}`,
			);
			log(
				`\n🚀 You can now deploy your Next.js projects using ${chalk.green("quicky deploy")}`,
			);

			const { deployNow } = await inquirer.prompt([
				{
					type: "confirm",
					name: "deployNow",
					message: "Do you want to deploy a project now?",
					default: false,
				},
			]);

			if (deployNow) {
				execSync("quicky deploy", { stdio: "inherit" });
			} else {
				process.exit(0);
			}
		} catch (error) {
			console.error(chalk.red(`Error: ${error.message}`));
		}
	});

// ---------------------------------------------------------------------------
// Webhooks command
// ---------------------------------------------------------------------------

program
	.command("webhooks")
	.description("Manage the webhook server for your projects")
	.action(async () => {
		const webhookPath = path.join(DEFAULT_FOLDER, "webhook");

		try {
			execSync("pm2 -v", { stdio: "pipe" });
		} catch {
			log(
				chalk.yellow(
					"PM2 is not installed. Installing PM2...",
				),
			);
			try {
				execSync("npm install -g pm2", { stdio: "inherit" });
				log(chalk.green("PM2 installed successfully."));
			} catch {
				log(
					chalk.red(
						"Failed to install PM2. Please install it manually using 'npm install -g pm2'",
					),
				);
				process.exit(1);
			}
		}

		const config = readConfig();

		const isWebhookServerRunning = () => {
			if (!config.webhook?.pm2Name) return false;
			const info = getPm2Status(config.webhook.pm2Name);
			return info?.status === "online";
		};

		const handleRestart = async () => {
			try {
				if (
					!fs.existsSync(
						path.join(webhookPath, "node_modules"),
					)
				) {
					log(
						chalk.yellow(
							"node_modules not found. Running npm install...",
						),
					);
					execSync(
						`cd ${webhookPath} && npm install`,
						{ stdio: "inherit" },
					);
				}

				try {
					execFileSync("pm2", ["describe", config.webhook.pm2Name], { stdio: "pipe" });
					execFileSync("pm2", ["restart", config.webhook.pm2Name], {
						stdio: "inherit",
					});
				} catch {
					await setupWebhookServer();
				}

				pm2Save();
				log(
					chalk.green(
						"Webhook server restarted successfully.",
					),
				);
				log(
					chalk.green(
						`Dashboard available at: http://localhost:${config.webhook.webhookPort}/dashboard`,
					),
				);
			} catch (error) {
				log(
					chalk.red(
						`Failed to restart webhook server: ${error.message}`,
					),
				);
			}
		};

		const handleCheckStatus = async () => {
			const info = getPm2Status(
				config.webhook?.pm2Name,
			);
			if (info?.status === "online") {
				log(chalk.green("Webhook server is running."));
				log(
					chalk.green(
						`Dashboard available at: http://localhost:${config.webhook.webhookPort}/dashboard`,
					),
				);
			} else {
				log(chalk.red("Webhook server is not running."));
			}
		};

		const handleStop = async () => {
			if (config.webhook?.pm2Name) {
				pm2DeleteIfExists(config.webhook.pm2Name);
				pm2Save();
				log(
					chalk.green(
						"Webhook server stopped successfully.",
					),
				);
			} else {
				log(
					chalk.yellow("Webhook server is not running."),
				);
			}
		};

		const handleShowLogs = async () => {
			try {
				execFileSync("pm2", ["describe", config.webhook.pm2Name], { stdio: "pipe" });

				const { logType } = await inquirer.prompt([
					{
						type: "list",
						name: "logType",
						message:
							"Which logs would you like to see?",
						choices: ["Output Logs", "Error Logs"],
					},
				]);

				const logCommand =
					logType === "Output Logs"
						? `pm2 logs ${config.webhook.pm2Name} --lines 100`
						: `pm2 logs ${config.webhook.pm2Name} --err --lines 100`;

				execSync(logCommand, { stdio: "inherit" });
			} catch {
				log(
					chalk.yellow(
						"Webhook server is not running. No logs available.",
					),
				);
			}
		};

		const handleDashboardCredentials = async () => {
			const { username, password } = await inquirer.prompt([
				{
					type: "input",
					name: "username",
					message: "Enter dashboard username:",
					default:
						config.dashboard?.username || "admin",
				},
				{
					type: "password",
					name: "password",
					message: "Enter dashboard password:",
				},
			]);

			const hashedPassword = await bcryptjs.hash(
				password,
				10,
			);
			withConfig((c) => {
				c.dashboard = {
					username,
					password: hashedPassword,
				};
			});
			log(
				chalk.green(
					"Dashboard credentials saved successfully.",
				),
			);
		};

		const handleDashboard = async () => {
			if (
				!config.dashboard?.username ||
				!config.dashboard?.password
			) {
				const { setupDashboard } = await inquirer.prompt([
					{
						type: "confirm",
						name: "setupDashboard",
						message:
							"Dashboard credentials not found. Would you like to set them up now?",
						default: true,
					},
				]);

				if (setupDashboard) {
					await handleDashboardCredentials();
				} else {
					log(
						chalk.yellow(
							"Dashboard access requires credentials to be set up.",
						),
					);
					return;
				}
			} else {
				const { updateCredentials } =
					await inquirer.prompt([
						{
							type: "confirm",
							name: "updateCredentials",
							message:
								"Would you like to update the dashboard credentials?",
							default: false,
						},
					]);

				if (updateCredentials) {
					await handleDashboardCredentials();
				}
			}
		};

		const handleUpdate = async () => {
			try {
				log(
					chalk.yellow("Updating webhook server..."),
				);
				execSync(
					`cd ${webhookPath} && git pull`,
					{ stdio: "inherit" },
				);
				execSync(
					`cd ${webhookPath} && npm install`,
					{ stdio: "inherit" },
				);
				await handleRestart();
				log(
					chalk.green(
						"Webhook server updated successfully.",
					),
				);
			} catch (error) {
				log(
					chalk.red(
						`Failed to update webhook server: ${error.message}`,
					),
				);
			}
		};

		if (isWebhookServerRunning()) {
			const actionHandlers = {
				Restart: handleRestart,
				"Check Status": handleCheckStatus,
				Stop: handleStop,
				"Show Logs": handleShowLogs,
				Dashboard: handleDashboard,
				Update: handleUpdate,
			};

			const { action } = await inquirer.prompt([
				{
					type: "list",
					name: "action",
					message:
						"Webhook server is running. What would you like to do?",
					choices: Object.keys(actionHandlers),
				},
			]);

			await actionHandlers[action]();
		} else {
			await setupWebhookServer();
		}
	});

// ---------------------------------------------------------------------------
// Deploy command
// ---------------------------------------------------------------------------

program
	.command("deploy")
	.description("Deploy a Next.js or Node.js project from GitHub")
	.option("--owner <owner>", "GitHub repository owner")
	.option("--repo <repo>", "GitHub repository name")
	.option("--port <port>", "Port to deploy the application")
	.action(async (cmd) => {
		try {
			let { owner, repo, port } = cmd;
			const config = readConfig();

			let defaultOwner = owner;
			if (config.github?.username) {
				defaultOwner = owner || config.github.username;
			}

			const answers = await inquirer.prompt([
				{
					type: "input",
					name: "owner",
					message:
						"Enter the GitHub repository owner/org name:",
					default: defaultOwner,
					when: () => !owner,
				},
				{
					type: "input",
					name: "repo",
					message:
						"Enter the GitHub repository name:",
					when: () => !repo,
				},
				{
					type: "list",
					name: "projectType",
					message: "What type of project is this?",
					choices: ["Next.js", "Node.js"],
				},
				{
					type: "confirm",
					name: "needsPort",
					message:
						"Do you want to specify a port for this Node.js application?",
					default: false,
					when: (a) =>
						a.projectType === "Node.js" && !port,
				},
				{
					type: "input",
					name: "port",
					message:
						"Enter the port to deploy the application:",
					when: (a) =>
						(!port &&
							a.projectType === "Next.js") ||
						a.needsPort,
					validate: (input) => {
						const n = Number.parseInt(input, 10);
						if (
							Number.isNaN(n) ||
							n <= 0 ||
							n > 65535
						) {
							return "Please enter a valid port number between 1 and 65535.";
						}
						return true;
					},
				},
			]);

			owner = owner || answers.owner;
			repo = repo || answers.repo;
			const projectType = answers.projectType;
			port = port || answers.port;

			if (!owner || !repo) {
				log(
					chalk.red("Error: Missing required arguments."),
				);
				process.exit(1);
			}

			validateName(owner, "owner");
			validateName(repo, "repo");

			if (projectType === "Next.js" && !port) {
				log(
					chalk.red(
						"Error: Port is required for Next.js projects.",
					),
				);
				process.exit(1);
			}

			const existingProject = config.projects.find(
				(p) => p.repo === repo,
			);
			if (existingProject) {
				log(
					chalk.yellowBright(
						`\nProject ${chalk.bold(repo)} already exists. \nUse the ${chalk.bold("manage")} command to manage the project or the ${chalk.bold("list")} command to view all your deployed projects.\n`,
					),
				);
				process.exit(1);
			}

			if (port) {
				port = await getAvailablePort(port);
			}

			if (!config.github || !config.github.access_token) {
				log(
					chalk.red(
						"Error: GitHub access token not found. Please run the init command first.",
					),
				);
				log(
					`You can run the ${chalk.green("quicky init")} command to save your GitHub account details.`,
				);
				process.exit(1);
			}

			const packageManager = config.packageManager || "npm";
			if (packageManager === "bun") {
				try {
					execSync("bun -v", { stdio: "ignore" });
				} catch {
					try {
						execSync("unzip -v", {
							stdio: "ignore",
						});
					} catch {
						log(
							chalk.yellow(
								"Unzip is not installed. Installing unzip...",
							),
						);
						execSync(
							"sudo apt-get install -y unzip",
							{ stdio: "inherit" },
						);
					}
					execSync(
						"curl -fsSL https://bun.sh/install | bash",
						{ stdio: "inherit" },
					);
				}
			} else {
				try {
					execSync("npm -v", { stdio: "ignore" });
				} catch {
					log(
						chalk.red(
							"Error: npm is not installed. Please install Node.js to use npm.",
						),
					);
					process.exit(1);
				}
			}

			try {
				const swapInfo = execSync("swapon --show", {
					encoding: "utf-8",
				});
				if (!swapInfo.includes("/swapfile")) {
					throw new Error("no swap");
				}
			} catch {
				try {
					log(
						chalk.yellow("Creating swap space..."),
					);
					execSync(
						"sudo fallocate -l 1G /swapfile",
						{ stdio: "inherit" },
					);
					execSync("sudo chmod 600 /swapfile", {
						stdio: "inherit",
					});
					execSync("sudo mkswap /swapfile", {
						stdio: "inherit",
					});
					execSync("sudo swapon /swapfile", {
						stdio: "inherit",
					});
					execSync(
						"echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab",
						{ stdio: "inherit" },
					);
					log(
						chalk.green(
							"✔ Swap space created and enabled successfully.",
						),
					);
				} catch (error) {
					log(
						chalk.yellow(
							`Failed to create swap space: ${error.message}`,
						),
					);
					log(
						chalk.yellow(
							"Continuing without swap space...",
						),
					);
				}
			}

			try {
				execSync("pm2 -v", { stdio: "ignore" });
			} catch {
				try {
					execSync("npm install -g pm2", {
						stdio: "inherit",
					});
				} catch {
					console.error(
						chalk.red(
							"PM2 is not installed. Please install it using `npm install -g pm2`",
						),
					);
					process.exit(1);
				}
			}

			let pid = uuidv4().slice(0, 5);
			if (config.projects.some((p) => p.pid === pid)) {
				pid = uuidv4().slice(0, 5);
			}

			const project = {
				pid,
				owner,
				repo,
				port: port ? Number(port) : undefined,
				type: projectType.toLowerCase(),
				last_updated: new Date().toISOString(),
			};

			const { addEnv } = await inquirer.prompt([
				{
					type: "confirm",
					name: "addEnv",
					message: "Do you want to add a .env file?",
					default: false,
				},
			]);

			if (addEnv) {
				ensureReleaseLayout(repo);
				const sharedDir = getSharedDir(repo);
				const envFilePath = path.join(sharedDir, ".env");
				if (!fs.existsSync(envFilePath)) {
					fs.writeFileSync(
						envFilePath,
						"# Add your environment variables below\n",
					);
				}
				execSync(`nano ${envFilePath}`, {
					stdio: "inherit",
				});
			}

			log(
				chalk.green(
					`✔ Deploying ${chalk.bold(repo)}...`,
				),
			);

			await deployOrUpdate(project, {
				promptEnv: false,
				isInitialDeploy: true,
			});

			const webhookId = await setupWebhook(
				`${owner}/${repo}`,
			);

			withConfig((c) => {
				project.webhookId = webhookId;
				const existing = c.projects.find(
					(p) => p.repo === repo,
				);
				if (existing) {
					Object.assign(existing, project);
				} else {
					c.projects.push(project);
				}
			});

			pm2Save();

			log(
				`${projectType} project deployed successfully${port ? ` on port ${port}` : ""}`,
			);
		} catch (error) {
			console.error(chalk.red(`Error: ${error.message}`));
		}
	});

// ---------------------------------------------------------------------------
// List command
// ---------------------------------------------------------------------------

program
	.command("list")
	.description(
		"List the current configuration, associated PM2 instances, and domains",
	)
	.action(() => {
		const config = readConfig();
		if (config.projects.length === 0) {
			log(chalk.yellow("No projects found."));
			return;
		}

		status();

		log(
			`\nTo manage your projects, use the ${chalk.blue("quicky manage")} command. You can ${chalk.blue("start")}, ${chalk.blue("stop")}, ${chalk.blue("restart")}, ${chalk.blue("update")}, or ${chalk.red("delete")} your projects.`,
		);
		log(
			`For more details, visit ${chalk.green("https://quicky.dev")}\n`,
		);
	});

// ---------------------------------------------------------------------------
// Manage command
// ---------------------------------------------------------------------------

program
	.command("manage")
	.description(
		"start, stop, restart, update, or delete a project",
	)
	.action(async () => {
		try {
			const config = readConfig();

			if (!config.projects.length) {
				log(chalk.red("No projects found to manage."));
				return;
			}

			status();

			const { selectedProject, action } =
				await inquirer.prompt([
					{
						type: "list",
						name: "selectedProject",
						message: "Select a project to manage:",
						choices: config.projects.map(
							(project) => project.repo,
						),
					},
					{
						type: "list",
						name: "action",
						message:
							"What action would you like to perform?",
						choices: [
							"start",
							"stop",
							"restart",
							"update",
							"delete",
						],
					},
				]);

			const project = config.projects.find(
				(p) => p.repo === selectedProject,
			);

			if (!project) {
				log(
					chalk.red(
						"Error: Selected project not found.",
					),
				);
				return;
			}

			if (action === "update") {
				await deployOrUpdate(project, {
					promptEnv: true,
				});
			} else if (action === "delete") {
				const { confirmDelete } = await inquirer.prompt([
					{
						type: "confirm",
						name: "confirmDelete",
						message: `Are you sure you want to delete the project ${chalk.redBright(selectedProject)}?`,
						default: false,
					},
				]);

				if (confirmDelete) {
					const spinner = createSpinner(
						"Deleting the project...",
					).start();
					await sleep(1000);

					pm2DeleteIfExists(project.repo);

					const projectRoot = getProjectRoot(
						project.repo,
					);
					fs.removeSync(projectRoot);

					log(
						chalk.green(
							`\n✔ Project ${project.repo} deleted successfully.`,
						),
					);

					withConfig((c) => {
						c.projects = c.projects.filter(
							(p) => p.repo !== selectedProject,
						);
						if (c.domains && c.domains.length > 0) {
							c.domains = c.domains.filter(
								(domain) =>
									domain.pid !== project.pid,
							);
						}
					});

					const nginxConfigFile = `/etc/nginx/sites-available/${selectedProject}`;
					const nginxSymlinkFile = `/etc/nginx/sites-enabled/${selectedProject}`;

					if (fs.existsSync(nginxConfigFile)) {
						execFileSync("sudo", ["rm", "-f", nginxConfigFile], {
							stdio: "inherit",
						});
					}
					if (fs.existsSync(nginxSymlinkFile)) {
						execFileSync("sudo", ["rm", "-f", nginxSymlinkFile], {
							stdio: "inherit",
						});
					}

					try {
						execSync(
							"sudo service nginx restart",
							{ stdio: "inherit" },
						);
					} catch {
						/* nginx may not be installed locally */
					}

					if (project.webhookId) {
						await removeWebhook(
							`${project.owner}/${project.repo}`,
							project.webhookId,
						);
					}

					pm2Save();

					spinner.success({
						text: `Project ${selectedProject} deleted successfully.`,
					});

					process.exit(0);
				} else {
					log(
						chalk.yellow(
							"Project deletion cancelled.",
						),
					);
					process.exit(0);
				}
			} else {
				try {
					execFileSync("pm2", [action, project.repo], {
						stdio: "inherit",
					});
					pm2Save();
					log(
						chalk.green(
							`Project ${project.repo} ${action}ed successfully.`,
						),
					);
				} catch (error) {
					console.error(
						chalk.red(
							`Failed to ${action} project ${project.repo}: ${error.message}`,
						),
					);
				}
			}
		} catch (error) {
			console.error(chalk.red(`Error: ${error.message}`));
		}
	});

// ---------------------------------------------------------------------------
// Update command
// ---------------------------------------------------------------------------

program
	.command("update <pid>")
	.description("Update a project by its PID")
	.action(async (pid) => {
		try {
			const config = readConfig();
			const project = config.projects.find(
				(p) => p.pid === pid,
			);
			if (!project) {
				console.error(
					chalk.red(`Project with PID ${pid} not found.`),
				);
				process.exit(1);
			}

			await deployOrUpdate(project, { promptEnv: false });

			process.exit(0);
		} catch (error) {
			console.error(chalk.red(`Error: ${error.message}`));
			process.exit(1);
		}
	});

// ---------------------------------------------------------------------------
// Domains command
// ---------------------------------------------------------------------------

program
	.command("domains")
	.description(
		"Manage domains and subdomains for the projects",
	)
	.action(async () => {
		try {
			const config = readConfig();
			const projects = config.projects;

			if (projects.length === 0) {
				log(
					chalk.yellow(
						"No projects found. Please deploy a project first.",
					),
				);
				return;
			}

			if ((config.domains || []).length > 0) {
				await handleListDomains(projects, config);
			}

			const { action } = await inquirer.prompt([
				{
					type: "list",
					name: "action",
					message: "What would you like to do?",
					choices: [
						"Add Domain",
						"Remove Domain",
					],
				},
			]);

			if (action === "Add Domain") {
				const { project, domain } =
					await inquirer.prompt([
						{
							type: "list",
							name: "project",
							message:
								"Select a project to associate the domain with:",
							choices: projects.map(
								(p) => p.repo,
							),
						},
						{
							type: "input",
							name: "domain",
							message:
								"Enter domain to add to the project:",
							validate: (input) => {
								const domainRegex =
									/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
								return domainRegex.test(input)
									? true
									: "Please enter a valid domain.";
							},
						},
					]);

				const selectedProject = projects.find(
					(p) => p.repo === project,
				);
				if (!selectedProject) {
					log(
						chalk.red(
							"Error: Selected project not found.",
						),
					);
					return;
				}

				await setupDomain(domain, selectedProject.port);

				withConfig((c) => {
					if (!c.domains) c.domains = [];
					c.domains.push({
						pid: selectedProject.pid,
						domain,
					});
				});

				log(
					chalk.green(
						`Domain ${domain} added successfully to project ${selectedProject.repo}.`,
					),
				);
				log(
					chalk.green(
						`You can now access your project at https://${domain}`,
					),
				);
				log(
					"Please make sure your domain is pointing to this server's IP address. It may take up to 48 hours for DNS changes to take effect.",
				);
			} else if (action === "Remove Domain") {
				const { project } = await inquirer.prompt([
					{
						type: "list",
						name: "project",
						message:
							"Select the project you want to remove a domain from:",
						choices: projects.map((p) => p.repo),
					},
				]);

				const selectedProject = projects.find(
					(p) => p.repo === project,
				);

				if (!selectedProject) {
					log(
						chalk.red(
							"Error: Selected project not found.",
						),
					);
					return;
				}

				const projectDomains = (
					config.domains || []
				).filter((d) => d.pid === selectedProject.pid);
				if (projectDomains.length === 0) {
					log(
						chalk.red(
							"Error: Selected project has no associated domains.",
						),
					);
					return;
				}

				const { domain } = await inquirer.prompt([
					{
						type: "list",
						name: "domain",
						message:
							"Select the domain you want to remove:",
						choices: projectDomains.map(
							(d) => d.domain,
						),
					},
				]);

				await removeDomain(domain);
			}
		} catch (error) {
			console.error(chalk.red(`Error: ${error.message}`));
		}
	});

async function handleListDomains(projects, config) {
	try {
		if (projects.length === 0) {
			log(chalk.yellow("No projects found."));
			return;
		}

		const table = new Table({
			head: [
				chalk.cyan.bold("Project"),
				chalk.cyan.bold("Domain"),
				chalk.cyan.bold("Port"),
			],
			style: { head: ["cyan", "bold"], border: ["grey"] },
			colWidths: [20, 30, 10],
		});

		for (const project of projects) {
			const projectDomains = (config.domains || []).filter(
				(d) => d.pid === project.pid,
			);
			for (const domain of projectDomains) {
				table.push([
					chalk.white(project.repo),
					chalk.blue(domain.domain),
					chalk.white(project.port),
				]);
			}
		}

		log(chalk.green.bold("\nDomains Configuration:"));
		log(table.toString());
	} catch (error) {
		console.error(
			chalk.red(`Failed to list domains: ${error.message}`),
		);
	}
}

// ---------------------------------------------------------------------------
// Persist command
// ---------------------------------------------------------------------------

program
	.command("persist <pid>")
	.description("Manage persisted files for a project")
	.argument("[action]", "add or remove", "list")
	.argument("[filePath]", "relative path to persist")
	.action(async (pid, action, filePath) => {
		const config = readConfig();
		const project = config.projects.find(
			(p) => p.pid === pid,
		);
		if (!project) {
			console.error(
				chalk.red(`Project with PID ${pid} not found.`),
			);
			process.exit(1);
		}

		if (!project.persist) {
			project.persist = [
				".env",
				".env.local",
				".env.production",
				".env.production.local",
			];
		}

		if (action === "list" || !action) {
			log(chalk.cyan.bold(`\nPersisted paths for ${project.repo}:`));
			for (const p of project.persist) {
				log(`  ${chalk.green("•")} ${p}`);
			}
			return;
		}

		if (action === "add") {
			if (!filePath) {
				console.error(
					chalk.red("Please specify a file path to persist."),
				);
				process.exit(1);
			}
			if (!project.persist.includes(filePath)) {
				project.persist.push(filePath);
				withConfig((c) => {
					const p = c.projects.find(
						(p) => p.pid === pid,
					);
					if (p) p.persist = project.persist;
				});
				log(
					chalk.green(
						`Added "${filePath}" to persisted paths for ${project.repo}.`,
					),
				);
			} else {
				log(
					chalk.yellow(
						`"${filePath}" is already persisted.`,
					),
				);
			}
		} else if (action === "remove") {
			if (!filePath) {
				console.error(
					chalk.red(
						"Please specify a file path to remove.",
					),
				);
				process.exit(1);
			}
			project.persist = project.persist.filter(
				(p) => p !== filePath,
			);
			withConfig((c) => {
				const p = c.projects.find(
					(p) => p.pid === pid,
				);
				if (p) p.persist = project.persist;
			});
			log(
				chalk.green(
					`Removed "${filePath}" from persisted paths for ${project.repo}.`,
				),
			);
		} else {
			console.error(
				chalk.red(
					`Unknown action "${action}". Use "add", "remove", or "list".`,
				),
			);
		}
	});

// ---------------------------------------------------------------------------
// Upgrade command
// ---------------------------------------------------------------------------

program
	.command("upgrade")
	.description("Upgrade the CLI to the latest version")
	.action(() => {
		try {
			let currentVersion;
			try {
				const output = execSync(
					"npm list -g quicky --depth=0",
					{ encoding: "utf-8" },
				);
				const match = output.match(/quicky@([\d.]+)/);
				currentVersion = match ? match[1] : packageJson.version;
			} catch {
				currentVersion = packageJson.version;
			}

			const registryVersion = execSync(
				"npm show quicky version",
				{ encoding: "utf-8" },
			).trim();

			if (currentVersion === registryVersion) {
				console.log(
					chalk.yellow(
						`Quicky CLI is already at the latest version (${currentVersion}).`,
					),
				);
				return;
			}

			console.log(
				chalk.blue(
					"Upgrading Quicky CLI to the latest version...",
				),
			);
			updateCLI();
		} catch (error) {
			console.error(
				chalk.red(
					`Failed to upgrade the CLI: ${error.message}`,
				),
			);
		}
	});

// ---------------------------------------------------------------------------
// Global error handling (don't exit during config writes)
// ---------------------------------------------------------------------------

let isWriting = false;

const originalWriteConfig = writeConfig;

process.on("unhandledRejection", (reason, promise) => {
	console.error(
		chalk.red(
			`Unhandled Rejection at: ${promise}, reason: ${reason}`,
		),
	);
	if (!isWriting) process.exit(1);
});

process.on("uncaughtException", (error) => {
	console.error(
		chalk.red(`Uncaught Exception: ${error.message}`),
	);
	if (!isWriting) process.exit(1);
});

program.parse(process.argv);
