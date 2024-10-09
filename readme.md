# Quicky

A CLI tool for effortless Next.js deployment and management. Initialize, deploy from GitHub, update, delete, and manage projects. Handles PM2 instances and domain configuration. Streamlines the entire lifecycle of Next.js applications on remote servers.

## Features

- 🐙 **GitHub Integration**: Initialize, deploy, and manage Next.js projects directly from GitHub repositories.
- ⚙️ **Process Management**: Leverage PM2 for application lifecycle and monitoring.
- 🔄 **Project Maintenance**: Easily update or remove deployed projects.
- 🌐 **Domain & SSL Automation**: Configure Nginx for custom domains and SSL certificates.
- 📋 **Configuration Overview**: List and inspect details of all deployed projects.

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

Prompts you to select a project to delete from the configuration and the file system.

### 5. Manage Domains

```bash
quicky domains
```

Allows you to add, update, or remove domains and subdomains for your projects. Handles Nginx configuration and SSL certificates.

### 6. Start, Stop, or Restart Projects

```bash
quicky manage
```

Prompts you to select a project and choose an action (start, stop, or restart) to manage the project's PM2 instance.


## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

Feel free to reach out to me [on 𝕏](https://x.com/alemalohe) if you have any questions or feedback! 
