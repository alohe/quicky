#!/usr/bin/env node
import { Command } from "commander";
import inquirer from "inquirer";
import { execSync } from "child_process";
import simpleGit from "simple-git";
import fs from "fs-extra";
import chalk from "chalk";
import { createSpinner } from "nanospinner";
import chalkAnimation from "chalk-animation";
import os from "os";
import path from "path";
import Table from "cli-table3";
import net from "net";

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

const updateConfig = (project) => {
  const existing = config.projects.find((p) => p.repo === project.repo);

  if (existing) {
    existing.port = project.port;
    existing.owner = project.owner;
  } else {
    config.projects.push(project);
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
};

const program = new Command();

program
  .version("1.0.0")
  .description(
    "Quicky is your go-to CLI companion for effortlessly launching and managing Next.js project deployments. Say goodbye to complexity and hello to seamless setups!"
  )
  .action(async () => {
    const rainbowTitle = chalkAnimation.karaoke(`Quicky\n`);
    await sleep(1000);
    rainbowTitle.stop();
    program.help();
  });

// Add GitHub account
program
  .command("init")
  .description("Save your GitHub account details and install dependencies")
  .action(async () => {
    try {
      let { username, token, packageManager } = config.github || {};

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
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

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

        log(`Configuration files are stored at: ${chalk.green(configPath)}`);
        log(`Projects will be stored in: ${chalk.green(projectsDir)}`);

        log(
          `You can now deploy your projects using the ${chalk.green(
            "deploy"
          )} command and update them using the ${chalk.green(
            "update"
          )} command.`
        );
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
        console.log(chalk.red("Error: Missing required arguments."));
        process.exit(1);
      }

      if (owner.length === 0 || repo.length === 0 || port.length === 0) {
        console.log(chalk.red("Error: Arguments cannot be empty."));
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

      if (fs.existsSync(repoPath) && fs.readdirSync(repoPath).length > 0) {
        console.log(
          chalk.red(
            `Error: The directory ${repoPath} already exists and is not empty. please use the update or del command to manage the project.`
          )
        );
        process.exit(1);
      }

      if (!config.github || !config.github.access_token) {
        console.log(
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

      updateConfig({ owner, repo, port });

      const packageManager = config.packageManager || "npm";
      const installCommand =
        packageManager === "bun" ? "bun install" : "npm install";
      const runCommand = `pm2 start npm --name "${repo}" -- run dev -- --port=${port}`;

      execSync(`cd ${projectsDir}/${repo} && ${installCommand}`, {
        stdio: "inherit",
      });

      // Prompt user to paste in the .env file
      console.log(
        chalk.green(
          "Please paste in your .env file content. The nano editor will open."
        )
      );
      execSync(`nano ${projectsDir}/${repo}/.env`, { stdio: "inherit" });

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

      execSync(`cd ${projectsDir}/${repo} && ${runCommand}`, {
        stdio: "inherit",
      });

      console.log(`Project deployed successfully on port ${port}`);
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
    }
  });

// Update project
program
  .command("update")
  .description("Update a running project")
  .action(async () => {
    try {
      if (!config.projects.length) {
        console.log(chalk.red("No projects found to update."));
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

        console.log(
          chalk.green(`Project ${project.repo} updated successfully.`)
        );
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
    }
  });

// delete a project from the configuration and the file system
program
  .command("del")
  .description(
    "Delete one or more projects from the configuration and the file system"
  )
  .action(async () => {
    try {
      if (!config.projects.length) {
        console.log(chalk.red("No projects found to delete."));
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
        console.log(chalk.yellow("No projects selected for deletion."));
        return;
      }

      const { confirmDelete } = await inquirer.prompt([
        {
          type: "confirm",
          name: "confirmDelete",
          message: `Are you sure you want to delete the selected projects?`,
          default: false,
        },
      ]);

      if (confirmDelete) {
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
              console.log(
                chalk.yellow(
                  `Project ${project.repo} is not running on PM2. Skipping...`
                )
              );
            }

            // Remove the project directory
            execSync(`rm -rf ${repoPath}`);
            config.projects = config.projects.filter(
              (p) => p.repo !== project.repo
            );

            console.log(
              chalk.green(`Project ${project.repo} deleted successfully.`)
            );
          }
        });

        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

        // Remove any repo in the projects folder that's not in the config file
        const configRepos = new Set(config.projects.map((p) => p.repo));
        const projectFolders = fs.readdirSync(projectsDir);

        projectFolders.forEach((folder) => {
          if (!configRepos.has(folder)) {
            const folderPath = path.join(projectsDir, folder);
            execSync(`rm -rf ${folderPath}`);
            console.log(chalk.yellow(`Removed untracked folder: ${folder}`));
          }
        });
      } else {
        console.log(chalk.yellow("Project deletion cancelled."));
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
    }
  });

program
  .command("list")
  .description("List the current configuration")
  .action(() => {
    if (config.projects.length === 0) {
      console.log(chalk.yellow("No projects found."));
      return;
    }

    const table = new Table({
      head: [
        chalk.cyan.bold("ID"),
        chalk.cyan.bold("Owner"),
        chalk.cyan.bold("Repository"),
        chalk.cyan.bold("Port"),
      ],
      style: {
        head: ["cyan", "bold"],
        border: ["grey"],
      },
      colWidths: [5, 15, 20, 10],
    });

    config.projects.forEach((project, index) => {
      table.push([
        chalk.white(index),
        chalk.white(project.owner),
        chalk.white(project.repo),
        chalk.white(project.port),
      ]);
    });

    console.log(chalk.green("\nCurrent Configuration:"));
    console.log(table.toString());
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
