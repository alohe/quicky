#!/usr/bin/env node
import { Command } from "commander";
import inquirer from "inquirer";
import { execSync } from "child_process";
import simpleGit from "simple-git";
import fs from "fs-extra";
import chalk from "chalk";
import { createSpinner } from "nanospinner";
import os from "os";
import path from "path";
import Table from "cli-table3";
import net from "net";
import { v4 as uuidv4 } from "uuid";
import { formatDistanceToNow } from "date-fns";
import latestVersion from "latest-version";
import semver from "semver";
import { fileURLToPath } from "url";
import axios from "axios";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const program = new Command();

const packagePath = path.resolve(__dirname, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf-8"));

async function checkForUpdates() {
  try {
    const latest = await latestVersion("quicky");
    if (semver.gt(latest, packageJson.version)) {
      console.log(
        `\n🚀 A new version of Quicky (v${chalk.bold.blue(
          latest
        )}) is available!`
      );

      const { shouldUpgrade } = await inquirer.prompt([
        {
          type: "confirm",
          name: "shouldUpgrade",
          message:
            "Would you like to update quicky to the latest version? 🔒 Your configurations will be preserved.",
          default: true,
        },
      ]);

      if (shouldUpgrade) {
        try {
          execSync("sudo npm install -g quicky", { stdio: "inherit" });
          console.log(
            chalk.green("Quicky has been upgraded to the latest version.")
          );
        } catch (error) {
          console.error(
            chalk.red(`Failed to upgrade Quicky: ${error.message}`)
          );
        }
      } else {
        console.log(
          chalk.yellow("You can upgrade later by running 'quicky upgrade'.")
        );
      }
    }
  } catch (error) {
    console.error("Error checking for updates:", error);
  }
}

// Check for updates after the command execution
program.hook("postAction", async () => {
  const excludedCommands = ["upgrade", "uninstall"];
  const command = process.argv[2];

  if (!excludedCommands.includes(command)) {
    await checkForUpdates();
  }
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = console.log;
const homeDir = os.homedir();
const defaultFolder = path.join(homeDir, ".quicky");
const projectsDir = defaultFolder + "/projects";
const tempDir = defaultFolder + "/temp";
const configPath = defaultFolder + "/config.json";

// Ensure directories exist
if (!fs.existsSync(projectsDir)) {
  fs.mkdirSync(projectsDir, { recursive: true });
}

if (!fs.existsSync(configPath)) {
  fs.writeFileSync(configPath, JSON.stringify({ projects: [] }, null, 2));
}

// Read configuration file once
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

const saveConfig = (config) => {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
};

const updateProjectsConfig = ({
  pid = uuidv4().slice(0, 5),
  owner,
  repo,
  port,
  webhookId,
}) => {
  const project = {
    pid,
    owner,
    repo,
    port,
    webhookId,
    last_updated: new Date().toISOString(),
  };
  const existing = config.projects.find((p) => p.repo === repo);

  if (existing) {
    existing.port = port;
    existing.owner = owner;
  } else {
    config.projects.push(project);
  }

  saveConfig(config);
};

async function setupDomain(domain, port) {
  // Check if domain is pointing to the server's IP address using dig
  const checkDomainPointing = async (domain) => {
    let digResult = "";
    const spinner = createSpinner(
      `Checking if ${domain} points to this server...`
    ).start();
    while (!digResult) {
      digResult = execSync(`dig +short ${domain}`).toString().trim();
      if (!digResult) {
        spinner.update({
          text: `Waiting for ${domain} to point to this server...`,
        });
        await sleep(30000); // Wait for 30 seconds before checking again
      }
    }
    spinner.success({ text: `${domain} is now pointing to this server.` });
  };

  await checkDomainPointing(domain);

  const nginxConfigPath = `/etc/nginx/sites-available/${domain}`;
  const nginxSymlinkPath = `/etc/nginx/sites-enabled/${domain}`;

  // Check if the domain already exists in Nginx configuration
  if (fs.existsSync(nginxConfigPath) || fs.existsSync(nginxSymlinkPath)) {
    // Check if the domain exists in the config.json
    const domainExistsInConfig = (config.domains || []).some(
      (d) => d.domain === domain
    );
    if (!domainExistsInConfig) {
      log(
        chalk.yellow(
          `Warning: Domain ${domain} configuration files exist but domain is not in config.json.`
        )
      );
      log(`Overriding the existing configuration files for ${domain}.`);
    } else {
      log(chalk.red(`Error: Domain ${domain} already exists.`));
      log(
        `Please remove the existing configuration first or choose a different domain.`
      );
      log(
        `You can use the ${chalk.green(
          "quicky domains"
        )} command to manage domains.`
      );
      return;
    }
  }

  let zoneName = `zone_${uuidv4().slice(0, 5)}`;
  let nginxConfig = `
    limit_req_zone $binary_remote_addr zone=${zoneName}:10m rate=10r/s;

    server {
    listen 80;
    server_name ${domain};

    # Main location block for proxying to the Next.js application
    location / {
      # Enable rate limiting to prevent abuse
      limit_req zone=${zoneName} burst=5 nodelay;

      # Proxy settings for Next.js application
      proxy_pass http://localhost:${port};
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection 'upgrade';
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_set_header X-NginX-Proxy true;

      # Optimize buffering and memory limits for large requests
      proxy_busy_buffers_size 512k;
      proxy_buffers 4 512k;
      proxy_buffer_size 256k;

      # Disable buffering for real-time applications (like Next.js with WebSocket)
      proxy_buffering off;
      proxy_set_header X-Accel-Buffering no;

      # Caching control headers (prevents caching for dynamic content)
      add_header Cache-Control no-store;

      # Timeouts and keepalive settings to prevent disruptions
      proxy_connect_timeout 60s;
      proxy_send_timeout 60s;
      proxy_read_timeout 60s;
      keepalive_timeout 60s;

      # Handle large request bodies if needed
      client_max_body_size 50M;
    }

    # Logs for debugging and monitoring
    access_log /var/log/nginx/${domain}-access.log;
    error_log /var/log/nginx/${domain}-error.log;
    }

    # Additional security headers for best practices
    add_header X-Content-Type-Options "nosniff";
    add_header X-Frame-Options "DENY";
    add_header X-XSS-Protection "1; mode=block";
    add_header Referrer-Policy "no-referrer-when-downgrade";
    add_header Content-Security-Policy "default-src 'self'; img-src *; media-src * data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:";
    `;

  // Write Nginx config to the sites-available  and sites-enabled directories
  const tempFilePath = `/tmp/${domain}.conf`;
  fs.writeFileSync(tempFilePath, nginxConfig, { mode: 0o644 });

  execSync(`sudo mv ${tempFilePath} ${nginxConfigPath}`, {
    stdio: "inherit",
  });

  // Check if the symlink already exists
  if (!fs.existsSync(nginxSymlinkPath)) {
    // Create a symlink to the sites-enabled directory
    execSync(`sudo ln -s ${nginxConfigPath} ${nginxSymlinkPath}`, {
      stdio: "inherit",
    });
  } else {
    log(chalk.yellow(`Symlink already exists for ${domain}.`));
  }

  // Restart Nginx to apply the changes
  execSync(`sudo service nginx restart`, { stdio: "inherit" });

  log(chalk.green(`Nginx configuration created for ${domain}.`));

  if (!config.email) {
    const { email } = await inquirer.prompt([
      {
        type: "input",
        name: "email",
        message: "Enter your email address for SSL certificate:",
        validate: (input) => {
          const emailRegex = /\S+@\S+\.\S+/;
          return emailRegex.test(input) ? true : "Please enter a valid email.";
        },
      },
    ]);

    config.email = email;
    saveConfig(config);
  }

  // Obtain SSL certificate using Certbot
  try {
    execSync("which certbot", { stdio: "ignore" });
    execSync("which python3-certbot-nginx", { stdio: "ignore" });
  } catch (error) {
    execSync("sudo apt install certbot python3-certbot-nginx -y", {
      stdio: "inherit",
    });
  } finally {
    try {
      execSync(
        `sudo certbot --nginx -d ${domain} --non-interactive --agree-tos --email ${config.email}`,
        { stdio: "inherit" }
      );
    } catch (error) {
      console.error(
        chalk.red(`Failed to obtain SSL certificate: ${error.message}`)
      );
      process.exit(1);
    }
  }

  log(chalk.green(`SSL certificate obtained and configured for ${domain}.`));
}

async function setupWebhookServer() {
  const { webhookUrl } = await inquirer.prompt([
    {
      type: "input",
      name: "webhookUrl",
      message:
        "Enter the URL where the webhook will be received (e.g., quicky.example.com):",
      validate: (input) => {
        if (input.trim() === "") {
          return "URL is required.";
        }
        if (
          config.domains &&
          config.domains.some((d) => d.domain === input.trim())
        ) {
          return "This domain is already in use. Please enter a different URL.";
        }
        return true;
      },
    },
  ]);

  const isPortInUse = (port) => {
    return new Promise((resolve) => {
      const server = net.createServer();

      server.once("error", (err) => {
        if (err.code === "EADDRINUSE") {
          resolve(true);
        } else {
          resolve(false);
        }
      });

      server.once("listening", () => {
        server.close();
        resolve(false);
      });

      server.listen(port);
    });
  };

  const getRandomPort = () => {
    return Math.floor(Math.random() * (65535 - 1024 + 1)) + 1024;
  };

  const getAvailablePort = async () => {
    let port;
    do {
      port = getRandomPort();
    } while (await isPortInUse(port));
    return port;
  };

  const availablePort = await getAvailablePort();

  // Set up the webhook server
  const git = simpleGit();
  const webhookPath = `${defaultFolder}/webhook`; // .quicky/webhook

  // Check if the webhook directory already exists and is not empty
  if (fs.existsSync(webhookPath) && fs.readdirSync(webhookPath).length > 0) {
    log(
      chalk.yellow(
        `Directory ${webhookPath} already exists and is not empty. Deleting...`
      )
    );
    fs.removeSync(webhookPath);
  }

  // Clone the webhook repository
  await git.clone(`https://github.com/alohe/quicky-webhook.git`, webhookPath);

  // Set up the domain using the setupDomain function
  await setupDomain(webhookUrl, availablePort);

  // Generate a random secret for securing the webhook
  const webhookSecret = uuidv4();

  // Add a .env file to the webhook server
  const envFilePath = `${webhookPath}/.env`;
  fs.writeFileSync(
    envFilePath,
    `WEBHOOK_URL=${webhookUrl}\nWEBHOOK_PORT=${availablePort}\nWEBHOOK_SECRET=${webhookSecret}`,
    { flag: "wx" }
  );

  // Start the webhook server with PM2
  try {
    execSync(
      `pm2 start ${path.join(
        webhookPath,
        "index.js"
      )} --name "quicky-webhook-server"`,
      {
        stdio: "inherit",
      }
    );
  } catch (error) {
    if (error.message.includes("Script already launched")) {
      execSync(`pm2 restart "quicky-webhook-server"`, {
        stdio: "inherit",
      });
    } else {
      throw error;
    }
  }

  // Update the global config.json with the webhook server details
  config.webhook = {
    webhookUrl: `https://${webhookUrl}/webhook`,
    webhookPort: availablePort,
    secret: webhookSecret,
    pm2Name: "quicky-webhook-server",
  };
  saveConfig(config);

  log(
    chalk.green(
      `Webhook server set up and running at https://${webhookUrl}/webhook`
    )
  );
}

// Function to set up a webhook on a repository to be used during deployment
async function setupWebhook(repo) {
  // check if the webhook config is already set up in the config file
  if (
    !config.webhook ||
    !config.webhook.webhookUrl ||
    !config.webhook.webhookPort ||
    !config.webhook.secret
  ) {
    log(
      chalk.yellow(
        "Webhook server is not fully configured. Please set up the webhook server first."
      )
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
      return;
    }
  }

  const webhookConfig = {
    name: "web",
    active: true,
    events: ["push"], // Listen for push events
    config: {
      url: config.webhook.webhookUrl, // User’s local service URL
      content_type: "json",
      secret: config.webhook.secret, // Add the secret for securing the webhook
    },
  };

  // Create the webhook on the user's repository
  try {
    const response = await axios.post(
      `https://api.github.com/repos/${repo}/hooks`,
      webhookConfig,
      {
        headers: {
          Authorization: `Bearer ${config.github.access_token}`,
        },
      }
    );
    console.log(`Webhook created: ${response.data.id}`);
    return response.data.id; // Return the webhook ID
  } catch (error) {
    console.error(`Error creating webhook: ${error.message}`);
    return null; // Return null if there was an error
  }
}

// Function to remove a webhook from a repo to be used during project deletion
async function removeWebhook(repo, webhookId) {
  try {
    await axios.delete(
      `https://api.github.com/repos/${repo}/hooks/${webhookId}`,
      {
        headers: {
          Authorization: `Bearer ${config.github.access_token}`,
        },
      }
    );
    console.log(`Webhook ${webhookId} removed.`);
    return true;
  } catch (error) {
    console.error(`Error removing webhook: ${error.message}`);
    return false;
  }
}

// Funtion to update a project with the latest changes from the repository
async function updateProject(project) {
  try {
    const git = simpleGit();
    const repoPath = `${projectsDir}/${project.repo}`;
    const tempPath = `${tempDir}/${project.repo}`;

    const spinner = createSpinner("Updating the project...").start();
    await sleep(1000);

    try {
      // Clone into temporary directory
      spinner.update({ text: "Cloning the repository..." });
      // Ensure the tempPath directory exists
      fs.ensureDirSync(tempPath);

      await git.clone(
        `https://${config.github.access_token}@github.com/${project.owner}/${project.repo}.git`,
        tempPath
      );

      spinner.update({ text: "Copying files to project directory..." });
      execSync(`cp -r ${tempPath}/* ${repoPath}`, {
        stdio: "inherit",
      });

      await sleep(1000);
      spinner.update({ text: "Cleaning up temporary files..." });
      execSync(`rm -rf ${tempPath}`);
      spinner.success({ text: "Repository updated successfully." });
      await sleep(1000);

      // update .env file if it exists
      const envFilePath = `${repoPath}/.env`;
      if (fs.existsSync(envFilePath)) {
        const { updateEnv } = await inquirer.prompt([
          {
            type: "confirm",
            name: "updateEnv",
            message: `Do you want to update the .env file for ${project.repo}?`,
            default: false,
          },
        ]);

        if (updateEnv) {
          execSync(`nano ${envFilePath}`, { stdio: "inherit" });
        }
      } else {
        // prompt if user wants to add a .env file
        const { addEnv } = await inquirer.prompt([
          {
            type: "confirm",
            name: "addEnv",
            message: `Do you want to add a .env file for ${project.repo}?`,
            default: false,
          },
        ]);

        if (addEnv) {
          fs.writeFileSync(
            envFilePath,
            "# Add your environment variables below\n",
            { flag: "wx" }
          );
          execSync(`nano ${envFilePath}`, { stdio: "inherit" });
        }
      }

      // Install dependencies, build the project, and restart the PM2 instance
      const packageManager = config.packageManager || "npm";
      const installCommand =
        packageManager === "bun" ? "bun install" : "npm install";
      execSync(`cd ${repoPath} && ${installCommand}`, {
        stdio: "inherit",
      });

      await sleep(1000);
      spinner.update({ text: " Building the project...\n" });
      const buildCommand =
        packageManager === "bun" ? "bun run build" : "npm run build";
      execSync(`cd ${repoPath} && ${buildCommand}`, {
        stdio: "inherit",
      });

      await sleep(1000);
      spinner.update({ text: " Restarting the project..." });

      // Check if the PM2 instance exists
      try {
        execSync(`cd ${repoPath} && pm2 describe ${project.repo}`, {
          stdio: "ignore",
        });
        // If it exists, restart
        execSync(`cd ${repoPath} && pm2 restart ${project.repo}`, {
          stdio: "inherit",
        });
      } catch (error) {
        // If it doesn't exist, start it on its port
        execSync(
          `cd ${repoPath} && pm2 start npm --name "${project.repo}" -- start -- --port ${project.port}`,
          {
            stdio: "inherit",
          }
        );
      }

      // Update the last_updated timestamp
      project.last_updated = new Date().toISOString();

      saveConfig(config);

      spinner.success({
        text: ` Project ${chalk.green.bold(
          project.repo
        )} updated successfully.`,
      });
    } catch (error) {
      spinner.error({
        text: `Failed to update project: ${error.message}`,
      });
    }

    process.exit(0);
  } catch (error) {
    console.error(chalk.red(`Error: ${error.message}`));
  }
}

function help() {
  const rabbit = `
 (\\(\\ 
 ( -.-)
 o_(")(")
`;

  log(chalk.blue(rabbit)); // Change color to whatever fits your style
  log(
    `${chalk.hex("#fd6d4c").bold("Quicky")}${chalk.hex("#f39549")(
      " - A CLI tool to deploy Next.js projects"
    )}`
  );
  log("");
  log("Usage:");
  // use the chalk package to colorize the output
  log(
    `${chalk.blue("  quicky")} ${chalk.hex("#FFA500")(
      "<command>"
    )} ${chalk.green("[options]")}`
  );
  log("");
  log("Commands:");
  log(
    `  ${chalk
      .hex("#cea9fe")
      .bold(
        "init"
      )}      Save your GitHub account details and install dependencies\n`
  );
  log(`  ${chalk.blue.bold("deploy")}    Deploy a Next.js project from GitHub`);
  log(
    `  ${chalk.blue.bold(
      "list"
    )}      List the current configuration and associated PM2 instances`
  );
  log(
    `  ${chalk.blue.bold(
      "manage"
    )}    Start, stop, restart, update, or delete a project \n`
  );
  log(
    `  ${chalk.cyanBright.bold(
      "domains"
    )}   Manage domains and subdomains for the projects`
  );
  log("");
  log(`  ${chalk.hex("#fe64fa").bold("install")}   Install quicky globally`);
  log(
    `  ${chalk
      .hex("#fe64fa")
      .bold("upgrade")}   Upgrade quicky to the latest version`
  );
  log(
    `  ${chalk
      .hex("#fe64fa")
      .bold("uninstall")} Uninstall the CLI tool globally`
  );
  log("");
  log("Options:");
  log("  --help    Display help for the command");
  log("  -v, --version    Output the current version of Quicky");
  log("");
  log("For more information, visit https://quicky.dev");
}

program
  .version(
    `${packageJson.version}`,
    "-v, --version",
    "Output the current version of Quicky"
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
      console.error(chalk.red(`Failed to install Quicky: ${error.message}`));
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
          "All projects and configurations will be permanently deleted."
        )
      );
      const { confirmUninstall } = await inquirer.prompt([
        {
          type: "confirm",
          name: "confirmUninstall",
          message: `Are you sure you want to uninstall Quicky?`,
          default: false,
        },
      ]);

      if (confirmUninstall) {
        // Stop and delete all PM2 instances managed by Quicky
        try {
          const projectNames = config.projects.map((project) => project.repo);
          projectNames.forEach((name) => {
            execSync(`pm2 stop ${name} && pm2 delete ${name}`, {
              stdio: "inherit",
            });
          });

          // Stop and delete the webhook server if it exists
          if (config.webhook && config.webhook.pm2Name) {
            execSync(
              `pm2 stop ${config.webhook.pm2Name} && pm2 delete ${config.webhook.pm2Name}`,
              {
                stdio: "inherit",
              }
            );
          }

          log(
            chalk.green(
              "All PM2 instances managed by Quicky have been stopped and deleted."
            )
          );
        } catch (error) {
          log(chalk.red(`Failed to stop PM2 instances: ${error.message}`));
        }

        // Delete Nginx configurations managed by Quicky
        try {
          const domains = config.domains || [];
          domains.forEach((domain) => {
            const domainConfigPath = `/etc/nginx/sites-available/${domain.domain}`;
            const domainSymlinkPath = `/etc/nginx/sites-enabled/${domain.domain}`;
            if (fs.existsSync(domainConfigPath)) {
              execSync(`sudo rm ${domainConfigPath}`, { stdio: "inherit" });
            }
            if (fs.existsSync(domainSymlinkPath)) {
              execSync(`sudo rm ${domainSymlinkPath}`, { stdio: "inherit" });
            }
          });
          log(
            chalk.green(
              "Nginx configurations for all domains managed by Quicky have been deleted."
            )
          );
        } catch (error) {
          log(
            chalk.red(`Failed to delete Nginx configurations: ${error.message}`)
          );
        }

        // Delete the default folder where projects and configurations are stored
        try {
          fs.removeSync(defaultFolder);
          log(chalk.green("Quicky has been uninstalled successfully."));
        } catch (error) {
          log(chalk.red(`Failed to delete Quicky folder: ${error.message}`));
        }

        // Uninstall the CLI tool
        try {
          execSync("sudo npm uninstall -g quicky", { stdio: "inherit" });
          log(chalk.green("✔ Quicky has been uninstalled successfully."));
        } catch (error) {
          log(chalk.red(`Failed to uninstall Quicky: ${error.message}`));
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
  .description("Save your GitHub account details and install dependencies")
  .option("--username <username>", "GitHub username")
  .option("--token <token>", "GitHub personal access token")
  .option(
    "--packageManager <packageManager>",
    "Package manager to use (npm|bun)"
  )
  .action(async (cmd) => {
    try {
      let { username, token, packageManager } = cmd || config.github || {};
      if (!username || !token || !packageManager) {
        const answers = await inquirer.prompt([
          {
            name: "username",
            message: "Enter your GitHub username:",
            default: username,
          },
          {
            name: "token",
            message: "Enter your GitHub personal access token:",
            default: token,
          },
          {
            type: "list",
            name: "packageManager",
            message: "Choose your package manager:",
            choices: ["npm", "bun"],
            default: packageManager,
          },
        ]);

        username = answers.username;
        token = answers.token;
        packageManager = answers.packageManager;
      }

      if (username && token) {
        config.github = { username, access_token: token };
        config.packageManager = packageManager;
        saveConfig(config);

        // Stop and remove the webhook server if it exists
        if (config.webhook && config.webhook.pm2Name) {
          try {
            const pm2Status = execSync(
              `pm2 describe ${config.webhook.pm2Name}`,
              {
                stdio: "pipe",
              }
            ).toString();

            if (!pm2Status.includes("online")) {
              log(chalk.yellow("Webhook server is not running. Restarting..."));
              execSync(`pm2 restart ${config.webhook.pm2Name}`, {
                stdio: "inherit",
              });
              log(chalk.green("Webhook server restarted successfully."));
            } else {
              log(chalk.green("Webhook server is already running."));
            }
          } catch (error) {
            log(
              chalk.red(
                `Failed to check or restart webhook server: ${error.message}`
              )
            );
            log(chalk.yellow("Attempting to start webhook server..."));
            await setupWebhookServer();
          }
        } else {
          log("Webhook server is not configured. Setting up...");
          await setupWebhookServer();
        }

        // Check if PM2 is already installed, if not, install it using npm
        const spinner = createSpinner(
          "Saving your GitHub account details and installing dependencies..."
        ).start();
        await sleep(1000);
        try {
          execSync("pm2 -v", { stdio: "ignore" });
          spinner.success({
            text: "GitHub account details saved and dependencies installed successfully!",
          });
        } catch (error) {
          try {
            execSync("npm install -g pm2", { stdio: "inherit" });
            spinner.success({
              text: "GitHub account details saved and dependencies installed successfully!",
            });
          } catch (installError) {
            spinner.error({
              text: `Failed to install dependencies. Please ensure you have npm installed.`,
            });
          }
        }

        log(
          `\n📁 Configuration files are stored at: ${chalk.green(configPath)}`
        );
        log(`📂 Projects will be stored in: ${chalk.green(projectsDir)}`);

        // setup webhook server
        await setupWebhookServer();

        log(
          `\n🚀 You can now deploy your Next.js projects using ${chalk.green(
            "quicky deploy"
          )}`
        );

        // Ask user if they want to deploy a project now
        const { deployNow } = await inquirer.prompt([
          {
            type: "confirm",
            name: "deployNow",
            message: "Do you want to deploy a project now?",
            default: false,
          },
        ]);

        if (deployNow) {
          execSync(`quicky deploy`, { stdio: "inherit" });
        } else {
          process.exit(0);
        }
      } else {
        spinner.error({
          text: `Failed to save GitHub account details. Please ensure you have a valid personal access token. ${chalk.green(
            "https://github.com/settings/tokens"
          )}`,
        });
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
    }
  });

// Deploy project
program
  .command("deploy")
  .description("Deploy a Next.js project from GitHub")
  .option("--owner <owner>", "GitHub repository owner")
  .option("--repo <repo>", "GitHub repository name")
  .option("--port <port>", "Port to deploy the application")
  .action(async (cmd) => {
    try {
      let { owner, repo, port } = cmd;
      // Read stored username from config
      let defaultOwner = owner;
      if (config.github && config.github.username) {
        defaultOwner = owner || config.github.username;
      }
      if (!repo || !port) {
        const answers = await inquirer.prompt([
          {
            type: "input",
            name: "owner",
            message: "Enter the GitHub repository owner/org name:",
            default: defaultOwner,
            when: () => !owner,
          },
          {
            type: "input",
            name: "repo",
            message: "Enter the GitHub repository name:",
            when: () => !repo,
          },
          {
            type: "input",
            name: "port",
            message: "Enter the port to deploy the application:",
            when: () => !port,
            validate: (input) => {
              const portNumber = parseInt(input, 10);
              if (isNaN(portNumber) || portNumber <= 0 || portNumber > 65535) {
                return "Please enter a valid port number between 1 and 65535.";
              }
              return true;
            },
          },
        ]);

        owner = owner || answers.owner;
        repo = repo || answers.repo;
        port = port || answers.port;
      }

      if (!owner || !repo || !port) {
        log(chalk.red("Error: Missing required arguments."));
        process.exit(1);
      }

      if (owner.length === 0 || repo.length === 0 || port.length === 0) {
        log(chalk.red("Error: Arguments cannot be empty."));
        process.exit(1);
      }

      const existingProject = config.projects.find((p) => p.repo === repo);

      if (existingProject) {
        log(
          chalk.yellowBright(
            `\nProject ${chalk.bold(
              repo
            )} already exists. \nUse the ${chalk.bold(
              "manage"
            )} command to manage the project or the ${chalk.bold(
              "list"
            )} command to view all your deployed projects.\n`
          )
        );
        process.exit(1);
      }

      const isPortInUse = (port) => {
        return new Promise((resolve) => {
          const server = net.createServer();

          server.once("error", (err) => {
            if (err.code === "EADDRINUSE") {
              resolve(true);
            } else {
              resolve(false);
            }
          });

          server.once("listening", () => {
            server.close();
            resolve(false);
          });

          server.listen(port);
        });
      };

      const getAvailablePort = async (port) => {
        while (await isPortInUse(port)) {
          const answer = await inquirer.prompt([
            {
              type: "input",
              name: "port",
              message: `Port ${port} is already in use. Please enter another port:`,
              validate: (input) => {
                const portNumber = parseInt(input, 10);
                return Number.isInteger(portNumber) &&
                  portNumber > 0 &&
                  portNumber <= 65535
                  ? true
                  : "Please enter a valid port number (1-65535).";
              },
            },
          ]);
          port = answer.port;
        }
        return port;
      };

      port = await getAvailablePort(port);

      const git = simpleGit();
      const repoPath = `${projectsDir}/${repo}`;

      // Check if the directory already exists and is not empty
      if (fs.existsSync(repoPath) && fs.readdirSync(repoPath).length > 0) {
        const existingProject = config.projects.find((p) => p.repo === repo);
        if (!existingProject) {
          log(
            `⚠️  Directory ${chalk
              .hex("#FFA500")
              .bold(repoPath)} exists and is not linked to any project.`
          );
          const { deleteFolder } = await inquirer.prompt([
            {
              type: "confirm",
              name: "deleteFolder",
              message: `Delete ${repoPath} and continue?`,
              default: false,
            },
          ]);

          if (deleteFolder) {
            fs.removeSync(repoPath);
          } else {
            log(chalk.yellow("Operation cancelled."));
            process.exit(1);
          }
        } else {
          log(
            `⚠️ Directory ${chalk
              .hex("#FFA500")
              .bold(repoPath)} exists and is not empty. Use ${chalk.green(
              "manage"
            )} to manage the project.`
          );
          process.exit(1);
        }
      }

      if (!config.github || !config.github.access_token) {
        log(
          chalk.red(
            "Error: GitHub access token not found. Please run the init command first."
          )
        );
        log(
          `You can run the ${chalk.green(
            "quicky init"
          )} command to save your GitHub account details.`
        );
        process.exit(1);
      }

      await git.clone(
        `https://${config.github.access_token}@github.com/${owner}/${repo}.git`,
        repoPath
      );

      let pid = uuidv4().slice(0, 5);

      pid =
        config.projects.filter((p) => p.pid === pid).length > 0
          ? uuidv4().slice(0, 5)
          : pid;

      // Prompt user to add a .env file or not
      const { addEnv } = await inquirer.prompt([
        {
          type: "confirm",
          name: "addEnv",
          message: "Do you want to add a .env file?",
          default: false,
        },
      ]);

      if (addEnv) {
        const envFilePath = `${projectsDir}/${repo}/.env`;
        fs.writeFileSync(
          envFilePath,
          "# Add your environment variables below\n",
          { flag: "wx" }
        );
        execSync(`nano ${envFilePath}`, { stdio: "inherit" });
      }

      log(
        chalk.green(
          `✔ Project ${chalk.bold(repo)} cloned successfully. Deploying...`
        )
      );

      const packageManager = config.packageManager || "npm";

      // If package manager is bun, install bun and run bun install
      if (packageManager === "bun") {
        try {
          execSync("bun -v", { stdio: "ignore" });
        } catch (error) {
          try {
            execSync("unzip -v", { stdio: "ignore" });
          } catch (error) {
            log(chalk.yellow("Unzip is not installed. Installing unzip..."));
            execSync("sudo apt-get install -y unzip", { stdio: "inherit" });
          } finally {
            await execSync("curl -fsSL https://bun.sh/install | bash", {
              stdio: "inherit",
            });

            execSync("source ~/.bashrc", { stdio: "inherit" });
          }
        }
      } else {
        try {
          execSync("npm -v", { stdio: "ignore" });
        } catch (error) {
          log(
            chalk.red(
              "Error: npm is not installed. Please install Node.js to use npm."
            )
          );
          process.exit(1);
        }
      }

      // Check if swap space is already enabled
      const checkSwap = () => {
        try {
          const swapInfo = execSync("swapon --show", { encoding: "utf-8" });
          return swapInfo.includes("/swapfile");
        } catch (error) {
          return false;
        }
      };

      // Create and enable swap space if not already enabled
      const createSwap = () => {
        try {
          log(chalk.yellow("Creating swap space..."));
          execSync("sudo fallocate -l 1G /swapfile", { stdio: "inherit" });
          execSync("sudo chmod 600 /swapfile", { stdio: "inherit" });
          execSync("sudo mkswap /swapfile", { stdio: "inherit" });
          execSync("sudo swapon /swapfile", { stdio: "inherit" });
          execSync(
            "echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab",
            { stdio: "inherit" }
          );
          log(chalk.green("✔ Swap space created and enabled successfully."));
        } catch (error) {
          console.error(
            chalk.red(`Failed to create swap space: ${error.message}`)
          );
          process.exit(1);
        }
      };

      if (!checkSwap()) {
        createSwap();
      }

      const installCommand =
        packageManager === "bun" ? "bun install" : "npm install";
      const buildCommand =
        packageManager === "bun" ? "bun run build" : "npm run build";
      const startCommand = `pm2 start npm --name "${repo}" -- start -- --port ${port}`;

      // Install dependencies and build the project
      try {
        execSync(`cd ${projectsDir}/${repo} && ${installCommand}`, {
          stdio: "inherit",
        });
      } catch (error) {
        console.error(
          chalk.red(`Failed to install dependencies: ${error.message}`)
        );
        process.exit(1);
      }

      try {
        execSync(`cd ${projectsDir}/${repo} && ${buildCommand}`, {
          stdio: "inherit",
        });
      } catch (error) {
        console.error(
          chalk.red(`Failed to build the project: ${error.message}`)
        );
        process.exit(1);
      }

      try {
        try {
          execSync("pm2 -v", { stdio: "ignore" });
        } catch (error) {
          execSync("npm install -g pm2", { stdio: "inherit" });
        }
      } catch (error) {
        console.error(
          chalk.red(
            "PM2 is not installed. Please install it using `npm install -g pm2`"
          )
        );
        process.exit(1);
      }

      execSync(`cd ${projectsDir}/${repo} && ${startCommand}`, {
        stdio: "inherit",
      });

      // Set up the webhook for the repository
      const webhookId = await setupWebhook(`${owner}/${repo}`);

      // Save the webhook ID to the project configuration
      updateProjectsConfig({ pid, owner, repo, port, webhookId });

      log(`Project deployed successfully on port ${port}`);
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
    }
  });

// list all projects and domains
const status = () => {
  const table = new Table({
    head: [
      chalk.cyan.bold("PID"),
      chalk.cyan.bold("Owner"),
      chalk.cyan.bold("Repository"),
      chalk.cyan.bold("Port"),
      chalk.cyan.bold("Status"),
      chalk.cyan.bold("Last Updated"),
    ],
    style: {
      head: ["cyan", "bold"],
    },
    wordWrap: true,
    colWidths: [10, 15, 15, 10, 15, 20],
  });

  config.projects.forEach((project) => {
    let pm2Status = "Not Running";
    try {
      const pm2List = execSync(`pm2 jlist`, { encoding: "utf-8" });
      const pm2Instances = JSON.parse(pm2List);
      const instance = pm2Instances.find((inst) => inst.name === project.repo);
      if (instance) {
        pm2Status = instance.pm2_env.status;
      }
    } catch (error) {
      pm2Status = "Error";
    }

    table.push([
      chalk.yellow.bold(project.pid),
      chalk.white(project.owner),
      chalk.white(project.repo),
      chalk.greenBright.bold(project.port),
      pm2Status === "online" ? chalk.green(pm2Status) : chalk.red(pm2Status),
      chalk.white(
        formatDistanceToNow(new Date(project.last_updated), {
          addSuffix: true,
        })
      ),
    ]);
  });

  log(table.toString());
};

program
  .command("list")
  .description(
    "List the current configuration, associated PM2 instances, and domains"
  )
  .action(() => {
    if (config.projects.length === 0) {
      log(chalk.yellow("No projects found."));
      return;
    }

    status();

    log(
      `\nTo manage your projects, use the ${chalk.blue(
        "quicky manage"
      )} command. You can ${chalk.blue("start")}, ${chalk.blue(
        "stop"
      )}, ${chalk.blue("restart")}, ${chalk.blue("update")}, or ${chalk.red(
        "delete"
      )} your projects.`
    );
    log(`For more details, visit ${chalk.green("https://quicky.dev")}\n`);
  });

// start / stop / restart projects (pm2 wrapper) also delete projects
program
  .command("manage")
  .description("start, stop, restart, update, or delete a project")
  .action(async () => {
    try {
      if (!config.projects.length) {
        log(chalk.red("No projects found to manage."));
        return;
      }

      // List all projects and their status
      status();

      const { selectedProject, action } = await inquirer.prompt([
        {
          type: "list",
          name: "selectedProject",
          message: "Select a project to manage:",
          choices: config.projects.map((project) => project.repo),
        },
        {
          type: "list",
          name: "action",
          message: "What action would you like to perform?",
          choices: ["start", "stop", "restart", "update", "delete"],
        },
      ]);

      const project = config.projects.find((p) => p.repo === selectedProject);

      if (!project) {
        log(chalk.red("Error: Selected project not found."));
        return;
      }

      if (action === "update") {
        // Update a running project with the latest changes from the GitHub repository
        updateProject(project);
      } else if (action === "delete") {
        try {
          if (!config.projects.length) {
            log(chalk.yellowBright("No projects found to delete."));
            return;
          }

          const { confirmDelete } = await inquirer.prompt([
            {
              type: "confirm",
              name: "confirmDelete",
              message: `Are you sure you want to delete the project ${chalk.redBright(
                selectedProject
              )}?`,
              default: false,
            },
          ]);

          if (confirmDelete) {
            const spinner = createSpinner("Deleting the project...").start();
            await sleep(1000);

            const project = config.projects.find(
              (p) => p.repo === selectedProject
            );
            if (project) {
              const repoPath = `${projectsDir}/${project.repo}`;

              // Stop and delete the project from PM2 if it exists
              try {
                execSync(`pm2 stop ${project.repo}`, { stdio: "ignore" });
                execSync(`pm2 delete ${project.repo}`, { stdio: "ignore" });
              } catch (error) {
                log(
                  chalk.yellow(
                    `\nProject ${project.repo} is not running on PM2. Skipping...`
                  )
                );
              }

              // Remove the project directory
              execSync(`rm -rf ${repoPath}`);

              log(
                chalk.green(`\n✔ Project ${project.repo} deleted successfully.`)
              );

              // Remove the project from the configuration file
              config.projects = config.projects.filter(
                (p) => p.repo !== selectedProject
              );

              // Remove associated domains
              if (config.domains && config.domains.length > 0) {
                config.domains = config.domains.filter(
                  (domain) => domain.pid !== project.pid
                );
              }

              // Delete the nginx config file and restart nginx
              const nginxConfigFile = `/etc/nginx/sites-available/${selectedProject}`;
              const nginxSymlinkFile = `/etc/nginx/sites-enabled/${selectedProject}`;

              if (fs.existsSync(nginxConfigFile)) {
                execSync(`sudo rm -f ${nginxConfigFile}`, { stdio: "inherit" });
              }

              if (fs.existsSync(nginxSymlinkFile)) {
                execSync(`sudo rm -f ${nginxSymlinkFile}`, {
                  stdio: "inherit",
                });
              }

              execSync(`sudo service nginx restart`, { stdio: "inherit" });

              // Remove webhook if it exists
              if (project.webhookId) {
                await removeWebhook(
                  `${project.owner}/${project.repo}`,
                  project.webhookId
                );
              }

              saveConfig(config);
            }

            spinner.success({
              text: `Project ${selectedProject} deleted successfully.`,
            });

            process.exit(0);
          } else {
            log(chalk.yellow("Project deletion cancelled."));
            process.exit(0);
          }
        } catch (error) {
          console.error(chalk.red(`Error: ${error.message}`));
        }
      } else {
        const pm2Command = `pm2 ${action} ${project.repo}`;

        try {
          execSync(pm2Command, { stdio: "inherit" });
          log(chalk.green(`Project ${project.repo} ${action}ed successfully.`));
        } catch (error) {
          console.error(
            chalk.red(
              `Failed to ${action} project ${project.repo}: ${error.message}`
            )
          );
        }
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
    }
  });

program
  .command("update <pid>")
  .description("Update a project by its PID")
  .action(async (pid) => {
    try {
      const project = config.projects.find((p) => p.pid === pid);
      if (!project) {
        console.error(chalk.red(`Project with PID ${pid} not found.`));
        process.exit(1);
      }

      await updateProject(project);

      process.exit(0);
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

// Manage domains and subdomains for the projects
program
  .command("domains")
  .description("Manage domains and subdomains for the projects")
  .action(async () => {
    try {
      // Install Nginx and Certbot if not already installed
      try {
        execSync("nginx -v", { stdio: "ignore" });
      } catch (error) {
        execSync("sudo apt install nginx -y", { stdio: "inherit" });
      }

      try {
        // Check if certbot and the nginx plugin are installed
        execSync("certbot --version && certbot plugins | grep nginx", {
          stdio: "ignore",
        });
      } catch (error) {
        // If not installed, install certbot and the nginx plugin
        execSync("sudo apt install certbot python3-certbot-nginx -y", {
          stdio: "inherit",
        });
      }

      // Read project list to get a list of existing projects and their ports.
      const projects = config.projects;

      if (projects.length === 0) {
        log(chalk.yellow("No projects found. Please deploy a project first."));
        return;
      } else {
        // check if there are any domains already associated with the projects
        if (config.domains && config.domains.length > 0) {
          await handleListDomains(projects);
        }
      }

      const { action } = await inquirer.prompt([
        {
          type: "list",
          name: "action",
          message: "What would you like to do?",
          choices: ["Add Domain", "Remove Domain"],
        },
      ]);

      if (action === "Add Domain") {
        await handleAddDomain(projects);
      } else if (action === "Remove Domain") {
        await handleRemoveDomain(projects);
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
    }
  });

// Function to add a new domain or subdomain and configure Nginx and SSL
async function handleAddDomain(projects) {
  try {
    const { project, domain } = await inquirer.prompt([
      {
        type: "list",
        name: "project",
        message: "Select a project to associate the domain with:",
        choices: projects.map((p) => p.repo),
      },
      {
        type: "input",
        name: "domain",
        message: "Enter the domain or subdomain you want to add:",
        validate: (input) => {
          // Basic domain validation
          const domainRegex = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
          return domainRegex.test(input)
            ? true
            : "Please enter a valid domain.";
        },
      },
    ]);

    const selectedProject = projects.find((p) => p.repo === project);
    if (!selectedProject) {
      log(chalk.red("Error: Selected project not found."));
      return;
    }

    // a function for domain setup
    await setupDomain(domain, selectedProject.port);

    // Update the config file with the new domain
    const projectPid = selectedProject.pid;

    if (!config.domains) {
      config.domains = [];
    }

    if (config.domains.some((d) => d.domain === domain)) {
      log(chalk.red(`Domain ${domain} already exists.`));
      return;
    }

    config.domains.push({ pid: projectPid, domain });
    saveConfig(config);
    log(
      chalk.green(
        `Domain ${domain} added successfully to project ${selectedProject.repo}.`
      )
    );
    log(chalk.green(`You can now access your project at https://${domain}`));
    log(
      `Please make sure your domain is pointing to this server's IP address. It may take up to 48 hours for DNS changes to take effect.`
    );
  } catch (error) {
    console.error(chalk.red(`Failed to add domain: ${error.message}`));
  }
}

// Function to remove a domain or subdomain and delete Nginx and Certbot configuration files
async function handleRemoveDomain(projects) {
  try {
    const { project } = await inquirer.prompt([
      {
        type: "list",
        name: "project",
        message: "Select the project you want to remove a domain from:",
        choices: projects.map((p) => p.repo),
      },
    ]);

    const selectedProject = projects.find((p) => p.repo === project);
    if (!selectedProject) {
      log(chalk.red("Error: Selected project not found."));
      return;
    }

    const projectDomains = config.domains.filter(
      (d) => d.pid === selectedProject.pid
    );
    if (projectDomains.length === 0) {
      log(chalk.red("Error: Selected project has no associated domains."));
      return;
    }

    const { domain } = await inquirer.prompt([
      {
        type: "list",
        name: "domain",
        message: "Select the domain you want to remove:",
        choices: projectDomains.map((d) => d.domain),
      },
    ]);

    // Remove Nginx configuration
    const nginxConfigPath = `/etc/nginx/sites-available/${domain}`;
    if (fs.existsSync(nginxConfigPath)) {
      const command = `sudo rm -f ${nginxConfigPath} /etc/nginx/sites-enabled/${domain}`;
      execSync(command, { stdio: "inherit" });
      execSync(`sudo service nginx restart`, { stdio: "inherit" });
      log(chalk.green(`Nginx configuration removed for ${domain}.`));
    }

    // Remove SSL certificate using Certbot
    const certbotCommand = `sudo certbot delete --cert-name ${domain}`;
    execSync(certbotCommand, { stdio: "inherit" });
    log(chalk.green(`SSL certificate removed for ${domain}.`));

    // Update the config file and remove the domain from the config
    config.domains = config.domains.filter((d) => d.domain !== domain);
    saveConfig(config);
    log(
      chalk.green(
        `Domain ${domain} removed successfully from project ${project}.`
      )
    );
  } catch (error) {
    console.error(chalk.red(`Failed to remove domain: ${error.message}`));
  }
}

// Function to list all domains and their associated projects
async function handleListDomains(projects) {
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
      style: {
        head: ["cyan", "bold"],
        border: ["grey"],
      },
      colWidths: [20, 30, 10],
    });

    projects.forEach((project) => {
      const projectDomains = config.domains.filter(
        (d) => d.pid === project.pid
      );
      projectDomains.forEach((domain) => {
        table.push([
          chalk.white(project.repo),
          chalk.blue(domain.domain),
          chalk.white(project.port),
        ]);
      });
    });

    log(chalk.green.bold("\nDomains Configuration:"));
    log(table.toString());
  } catch (error) {
    console.error(chalk.red(`Failed to list domains: ${error.message}`));
  }
}

// Upgrade the CLI to the latest version
program
  .command("upgrade")
  .description("Upgrade the CLI to the latest version")
  .action(() => {
    try {
      // Get the currently installed version
      const currentVersion = execSync("npm list -g quicky --depth=0", {
        encoding: "utf-8",
      }).match(/quicky@([\d.]+)/)[1];

      // Get the latest version available in the npm registry
      const latestVersion = execSync("npm show quicky version", {
        encoding: "utf-8",
      }).trim();

      if (currentVersion === latestVersion) {
        console.log(
          chalk.yellow(
            `Quicky CLI is already at the latest version (${currentVersion}).`
          )
        );
        return;
      }

      // Proceed to upgrade
      console.log(chalk.blue("Upgrading Quicky CLI to the latest version..."));
      execSync("sudo npm install -g quicky", { stdio: "inherit" });

      console.log(
        chalk.green(
          `Quicky CLI upgraded successfully to version ${latestVersion}.`
        )
      );
    } catch (error) {
      console.error(chalk.red(`Failed to upgrade the CLI: ${error.message}`));
    }
  });

// Global error handling
process.on("unhandledRejection", (reason, promise) => {
  console.error(
    chalk.red(`Unhandled Rejection at: ${promise}, reason: ${reason}`)
  );
  process.exit(1);
});

process.on("uncaughtException", (error) => {
  console.error(chalk.red(`Uncaught Exception: ${error.message}`));
  process.exit(1);
});

program.parse(process.argv);
