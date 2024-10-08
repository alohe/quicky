# Quicky
Quicky is a Node.js-based command-line tool designed to make deploying and managing Next.js projects seamless and fast. It offers a streamlined way to set up GitHub-based projects, configure environments, and deploy applications with just a few commands, all in one simple CLI.

## Features

- **Initialize Projects**: Save your GitHub credentials and set up projects for deployment.
- **Deploy Projects**: Quicky clones, builds, and runs your Next.js projects from GitHub on specified ports.
- **Environment Management**: Easily add your environment variables to your projects.
- **Process Management**: Uses PM2 to manage application lifecycles and monitoring.
- **Nginx & SSL Setup**: Automatically configure Nginx to route custom domains and handle SSL certificates.
- **Update & Delete**: Keep your projects up-to-date or remove them as needed.
- **View Project Configurations**: List and view details of all deployed projects and their configurations.

## Prerequisites

Quicky requires Node.js and npm to be installed on your system. You can install them using the following commands:

```bash
sudo apt update
sudo apt install -y nodejs npm
```

## Installation

You can install Quicky globally using npm:

```bash
sudo npm install -g quicky
```

## Usage

### 1. Initialize Quicky

```bash
quicky init
```

Prompts you to enter your GitHub credentials and basic configurations for setting up your projects.

### 2. Deploy a Project

```bash
quicky deploy
```

Prompts you to enter your GitHub username or organization name, repository name, and the port number for deployment.

### 3. Add Environment Variables

During deployment, you’ll be asked if you want to add environment variables to your project.

### 4. Manage Projects

```bash
quicky list
```

Displays all deployed projects along with their configurations, active ports, and associated PM2 instances.

```bash
quicky update
```

Lists all deployed projects and prompts you to select a project to update with the latest changes from GitHub.

```bash
quicky delete
```

Lists all deployed projects and prompts you to select multiple projects to delete.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

Feel free to reach out to me [on 𝕏](https://x.com/alemalohe) if you have any questions or feedback! 
