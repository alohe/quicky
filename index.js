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
}) => {
  const project = {
    pid,
    owner,
    repo,
    port,
    created_at: new Date().toISOString(),
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

const program = new Command();

function help() {
  log(
    `${chalk.hex("#fe64fa").bold("Quicky")}${chalk.hex("#ffacfd")(
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
    `  ${chalk.blue.bold(
      "init"
    )}      Save your GitHub account details and install dependencies\n`
  );
  log(`  ${chalk.blue.bold("deploy")}    Deploy a Next.js project from GitHub`);
  log(`  ${chalk.blue.bold("update")}    Update a running project`);
  log(
    `  ${chalk.blue.bold(
      "delete"
    )}    Delete a project from the configuration and the file system`
  );
  log(
    `  ${chalk.blue.bold(
      "list"
    )}      List the current configuration and associated PM2 instances`
  );
  log(`  ${chalk.blue.bold("manage")}    Start, stop, or restart a project \n`);
  log(
    `  ${chalk.blue.bold(
      "domains"
    )}   Manage domains and subdomains for the projects`
  );
  log("");
  log("Options:");
  log("  --help    Display help for the command");
  log("");
  log("For more information, visit https://quicky.dev");
}

program.version("0.0.7").action(async () => {
  help();
});

program.option("--help", "Display help for the command").action(() => {
  help();
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

      const spinner = createSpinner(
        "Saving your GitHub account details and installing dependencies..."
      ).start();
      await sleep(1000);

      if (username && token) {
        config.github = { username, access_token: token };
        config.packageManager = packageManager;
        saveConfig(config);

        // Check if PM2 is already installed, if not, install it using npm
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

        log(
          `\n🚀 You can now deploy your Next.js projects using ${chalk.green(
            "quicky deploy"
          )}`
        );

        // ask use if they wannt deply a project now
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
              "update"
            )} command to update the project, the ${chalk.bold(
              "delete"
            )} command to delete the project, or the ${chalk.bold(
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
        log(
          `⚠️  The directory ${chalk
            .hex("#FFA500")
            .bold(
              repoPath
            )} already exists and is not empty. \n✨ Use the ${chalk.green(
            "update"
          )} or ${chalk.green("delete")} command to manage the project.`
        );
        process.exit(1);
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

      // Update the configuration file with the new project details
      updateProjectsConfig({ pid, owner, repo, port });

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

      const packageManager = config.packageManager || "npm";
      const installCommand =
        packageManager === "bun" ? "bun install" : "npm install";
      const buildCommand =
        packageManager === "bun" ? "bun run build" : "npm run build";
      const startCommand = `pm2 start npm --name "${repo}" -- start`;

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

      log(`Project deployed successfully on port ${port}`);
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
    }
  });

// Update a running project with the latest changes from the GitHub repository
program
  .command("update")
  .description("Update a running project")
  .action(async () => {
    try {
      if (!config.projects.length) {
        log(chalk.red("No projects found to update."));
        return;
      }

      const { selectedProject } = await inquirer.prompt([
        {
          type: "list",
          name: "selectedProject",
          message: "Select a project to update:",
          choices: config.projects.map((project) => project.repo),
        },
      ]);

      const project = config.projects.find((p) => p.repo === selectedProject);

      if (project) {
        const git = simpleGit();
        const repoPath = `${projectsDir}/${project.repo}`;
        const tempPath = `${tempDir}/${project.repo}`;

        // Clone into temporary directory
        await git.clone(
          `https://github.com/${project.owner}/${project.repo}.git`,
          tempPath
        );
        execSync(`cp -r ${tempPath}/* ${repoPath}`, { stdio: "inherit" });
        execSync(`rm -rf ${tempPath}`);

        execSync(`cd ${repoPath} && pm2 restart ${project.repo}`, {
          stdio: "inherit",
        });

        log(chalk.green(`Project ${project.repo} updated successfully.`));
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
    }
  });

// Delete a project from the configuration and the file system
program
  .command("delete")
  .description(
    "Delete one or more projects from the configuration and the file system"
  )
  .action(async () => {
    try {
      if (!config.projects.length) {
        log(chalk.yellowBright("No projects found to delete."));
        return;
      }
      const { selectedProjects } = await inquirer.prompt([
        {
          type: "checkbox",
          name: "selectedProjects",
          message: "Select projects to delete:",
          choices: config.projects.map((project) => project.repo),
        },
      ]);

      if (selectedProjects.length === 0) {
        log(chalk.yellow("No projects selected for deletion."));
        return;
      }

      const { confirmDelete } = await inquirer.prompt([
        {
          type: "confirm",
          name: "confirmDelete",
          message: `Are you sure you want to delete the selected ${
            selectedProjects.length > 1 ? "projects" : "project"
          }?`,
          default: false,
        },
      ]);

      if (confirmDelete) {
        const spinner = createSpinner("Deleting selected projects...").start();
        await sleep(1000);

        selectedProjects.forEach((selectedProject) => {
          const project = config.projects.find(
            (p) => p.repo === selectedProject
          );
          if (project) {
            const repoPath = `${projectsDir}/${project.repo}`;

            // Stop and delete the project from PM2 if it exists if not skip
            try {
              execSync(`pm2 stop ${project.repo}`, { stdio: "ignore" });
              execSync(`pm2 delete ${project.repo}`, { stdio: "ignore" });
            } catch (error) {
              log(
                chalk.yellow(
                  `Project ${project.repo} is not running on PM2. Skipping...`
                )
              );
            }

            // Remove the project directory
            execSync(`rm -rf ${repoPath}`);

            log(
              chalk.green(`\n✔ Project ${project.repo} deleted successfully.`)
            );
          }
        });

        spinner.success({
          text: `Deleted ${selectedProjects.length} ${
            selectedProjects.length > 1 ? "projects" : "project"
          } successfully.`,
        });

        // check if project has domains and remove them
        // so domains is gonna be an array of objects with pid, domain, isDefault
        const selectedProjectPIDs = config.projects
          .filter((project) => selectedProjects.includes(project.repo))
          .map((project) => project.pid);

        config.domains = config.domains.filter(
          (domain) => !selectedProjectPIDs.includes(domain.pid)
        );

        // delete the nginx config file and restart nginx
        const nginxConfigPath = "/etc/nginx/sites-available";
        const nginxSymlinkPath = "/etc/nginx/sites-enabled";

        selectedProjects.forEach((selectedProject) => {
          const project = config.projects.find(
            (p) => p.repo === selectedProject
          );

          if (project) {
            const domain = config.domains.find((d) => d.pid === project.pid);
            if (domain) {
              const nginxConfigFile = `${nginxConfigPath}/${domain.domain}`;
              const nginxSymlinkFile = `${nginxSymlinkPath}/${domain.domain}`;

              if (fs.existsSync(nginxConfigFile)) {
                execSync(`sudo rm -f ${nginxConfigFile}`, { stdio: "inherit" });
              }

              if (fs.existsSync(nginxSymlinkFile)) {
                execSync(`sudo rm -f ${nginxSymlinkFile}`, {
                  stdio: "inherit",
                });
              }
            }
          }
        });

        execSync(`sudo service nginx restart`, { stdio: "inherit" });

        // update config file
        config.projects = config.projects.filter(
          (project) => !selectedProjects.includes(project.repo)
        );

        saveConfig(config);

        // Remove project directories that are not listed in the config file
        const configRepos = new Set(config.projects.map((p) => p.repo));
        const projectFolders = fs.readdirSync(projectsDir);

        projectFolders.forEach((folder) => {
          if (!configRepos.has(folder)) {
            const folderPath = path.join(projectsDir, folder);
            execSync(`rm -rf ${folderPath}`);
            log(chalk.yellow(`Removed untracked folder: ${folder}`));
          }
        });
      } else {
        log(chalk.yellow("Project deletion cancelled."));
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
    }
  });

program
  .command("list")
  .description("List the current configuration and associated PM2 instances")
  .action(() => {
    if (config.projects.length === 0) {
      log(chalk.yellow("No projects found."));
      return;
    }

    const table = new Table({
      head: [
        chalk.cyan.bold("ID"),
        chalk.cyan.bold("PID"),
        chalk.cyan.bold("Owner"),
        chalk.cyan.bold("Repository"),
        chalk.cyan.bold("Port"),
        chalk.cyan.bold("PM2 Status"),
        chalk.cyan.bold("Domains"),
        chalk.cyan.bold("Created At"),
      ],
      style: {
        head: ["cyan", "bold"],
        border: ["grey"],
      },
      colWidths: [5, 10, 15, 20, 10, 15, 30, 25],
    });

    config.projects.forEach((project, index) => {
      let pm2Status = "Not Running";
      try {
        const pm2List = execSync(`pm2 jlist`, { encoding: "utf-8" });
        const pm2Instances = JSON.parse(pm2List);
        const instance = pm2Instances.find(
          (inst) => inst.name === project.repo
        );
        if (instance) {
          pm2Status = instance.pm2_env.status;
        }
      } catch (error) {
        pm2Status = "Error";
      }

      const projectDomains =
        config.domains
          .filter((d) => d.pid === project.pid)
          .map((d) => d.domain)
          .join(", ") || "None";

      table.push([
        chalk.white(index + 1),
        chalk.yellow.bold(project.pid),
        chalk.white(project.owner),
        chalk.white(project.repo),
        chalk.greenBright.bold(project.port),
        pm2Status === "online" ? chalk.green(pm2Status) : chalk.red(pm2Status),
        chalk.white(projectDomains),
        chalk.white(
          formatDistanceToNow(new Date(project.created_at), {
            addSuffix: true,
          })
        ),
      ]);
    });

    log(chalk.green("\nCurrent Configuration:"));
    log(table.toString());
  });

// start / stop / restart projects (pm2 wrapper)
program
  .command("manage")
  .description("Start, stop, or restart a project")
  .action(async () => {
    try {
      if (!config.projects.length) {
        log(chalk.red("No projects found to manage."));
        return;
      }

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
          choices: ["start", "stop", "restart"],
        },
      ]);

      const project = config.projects.find((p) => p.repo === selectedProject);

      if (!project) {
        log(chalk.red("Error: Selected project not found."));
        return;
      }

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
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
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
        execSync("certbot --version", { stdio: "ignore" });
      } catch (error) {
        execSync("sudo apt install certbot python3-certbot-nginx -y", {
          stdio: "inherit",
        });
      }

      // Read project list to get a list of existing projects and their ports.
      const projects = config.projects;

      if (projects.length === 0) {
        log(chalk.yellow("No projects found. Please deploy a project first."));
        return;
      }

      const { action } = await inquirer.prompt([
        {
          type: "list",
          name: "action",
          message: "What would you like to do?",
          choices: ["Add Domain", "List Domains", "Remove Domain"],
        },
      ]);

      if (action === "Add Domain") {
        await handleAddDomain(projects);
      } else if (action === "Remove Domain") {
        await handleRemoveDomain(projects);
      } else if (action === "List Domains") {
        await handleListDomains(projects);
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
    }
  });

// Function to add a new domain or subdomain and configure Nginx and SSL
async function handleAddDomain(projects) {
  try {
    const { project, domain, isDefault } = await inquirer.prompt([
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
      {
        type: "confirm",
        name: "isDefault",
        message: "Is this the default domain (listening on port 80)?",
        default: false,
      },
    ]);

    const selectedProject = projects.find((p) => p.repo === project);
    if (!selectedProject) {
      log(chalk.red("Error: Selected project not found."));
      return;
    }

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

    // Check if the domain already exists
    if (fs.existsSync(nginxConfigPath) || fs.existsSync(nginxSymlinkPath)) {
      log(chalk.red(`Error: Domain ${domain} already exists.`));
      return;
    }

    let nginxConfig = `
server {
    server_name ${domain};
    location / {
        proxy_pass http://localhost:${selectedProject.port};
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Host $proxy_host;
        proxy_set_header X-NginX-Proxy true;
        proxy_busy_buffers_size   5000k;
        proxy_buffers   4 5000k;
        proxy_buffer_size   5000k;
    }
}`;

    // If this is the default domain, add listen 80 directive
    if (isDefault) {
      nginxConfig = `
server {
    listen 80;
    server_name ${domain};
    location / {
        proxy_pass http://localhost:${selectedProject.port};
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Host $proxy_host;
        proxy_set_header X-NginX-Proxy true;
        proxy_busy_buffers_size   5000k;
        proxy_buffers   4 5000k;
        proxy_buffer_size   5000k;
    }
}`;
    }

    // Write Nginx config to the sites-available  and sites-enabled directories
    const tempFilePath = `/tmp/${domain}.conf`;
    fs.writeFileSync(tempFilePath, nginxConfig, { mode: 0o644 });

    execSync(`sudo mv ${tempFilePath} ${nginxConfigPath}`, {
      stdio: "inherit",
    });

    execSync(`sudo ln -s ${nginxConfigPath} ${nginxSymlinkPath}`, {
      stdio: "inherit",
    });

    // Restart Nginx to apply the changes
    execSync(`sudo service nginx restart`, { stdio: "inherit" });
    log(chalk.green(`Nginx configuration created for ${domain}.`));

    // Obtain SSL certificate using Certbot
    execSync(
      `sudo certbot --nginx -d ${domain} --non-interactive --agree-tos --email ${config.email}`,
      { stdio: "inherit" }
    );
    log(chalk.green(`SSL certificate obtained and configured for ${domain}.`));

    // Update the config file with the new domain
    const projectPid = selectedProject.pid;

    if (!config.domains) {
      config.domains = [];
    }

    if (config.domains.some((d) => d.domain === domain)) {
      log(chalk.red(`Domain ${domain} already exists.`));
      return;
    }

    config.domains.push({ pid: projectPid, domain, isDefault });
    saveConfig(config);
    log(
      chalk.green(
        `Domain ${domain} added successfully to project ${selectedProject.repo}.`
      )
    );
    log(
      chalk.green(
        `You can now access your project at ${
          isDefault ? "http" : "https"
        }://${domain}`
      )
    );
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
        chalk.cyan.bold("Default"),
      ],
      style: {
        head: ["cyan", "bold"],
        border: ["grey"],
      },
      colWidths: [20, 30, 10, 10],
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
          domain.isDefault ? chalk.green("Yes") : chalk.red("No"),
        ]);
      });
    });

    log(chalk.green("\nDomains Configuration:"));
    log(table.toString());
  } catch (error) {
    console.error(chalk.red(`Failed to list domains: ${error.message}`));
  }
}

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
