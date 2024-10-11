# Quicky

A CLI tool that streamlines the deployment and management of self-hosted Next.js projects, enabling initialization, deployment from GitHub, updating, deleting, and managing applications, along with effortless setup of domains and SSL certificates, simplifying the entire lifecycle of Next.js apps on remote servers.

## Features

- 🐙 **GitHub Integration**: Initialize, deploy, and manage Next.js projects from private and public GitHub repositories.

- ⚙️ **Process Management**: Leverage PM2 for application lifecycle and monitoring.

- 🔄 **Project Maintenance**: Easily update or remove deployed projects.

- 🌐 **Domain & SSL Automation**: Automatically configure Nginx for custom domains and SSL certificates, allowing you to add/remove domains from your projects.

- 📝 **Configuration Overview**: List and inspect details of all deployed projects and their domains.

## Prerequisites

Quicky requires Node.js and npm to be installed on your system. You can install them using the following commands:

```bash
sudo apt update
sudo apt install -y nodejs npm
```

## Installation

You can install Quicky globally using npx or npm:

```bash
npx quicky@latest install
```

or

```bash
sudo npm install -g quicky
```

**Note**: Using `sudo` is required to install Quicky globally and to avoid permission issues while configuring domains.

## Usage

### 1. Initialize Quicky

```bash
quicky init
```

Prompts you to enter your GitHub credentials and basic configurations for setting up your projects.

Quicky requires your GitHub access token and username to interact with your repositories. To create a new token, follow these steps:
1. Visit your [GitHub Personal Access Tokens page](https://github.com/settings/tokens) and make sure to use **Tokens (classic)**.
2. Click **Generate new token**.
3. Select the required scopes for repository access.
4. Click **Generate token**.
5. Copy the token and provide it to Quicky as your GitHub access token which will be stored locally for future use.

### 2. Deploy a Project

```bash
quicky deploy
```

This command will prompt you to provide:

- Your GitHub username or any organization name
- The repository name
- The port number on which the project should run (e.g., 3000)

**Environment Variables** - During deployment, you'll be asked whether you'd like to add environment variables to your project.

### 3. Manage Projects

```bash
quicky manage
```

Lists all deployed projects and allows you to **start**, **stop**, **restart**, **update**, or **delete** a specific project.

### 4. Configuration Overview

```bash
quicky list
```

Displays an overview of all deployed projects, including the following details:

- **PID**: Project ID.
- **Owner**: GitHub username or organization name.
- **Repository**: Name of the GitHub repository.
- **Port**: Port number on which the project is running.
- **PM2 Status**: Current status of the PM2 process.
- **Last updated**: Date and time of the last deployment/update.

### 5. Domains

Before adding a domain to your project, you need to:

1. Purchase a domain name (e.g., [Namecheap](https://www.namecheap.com/), [GoDaddy](https://www.godaddy.com/), etc.)
2. Purchase a Linux Ubuntu server (e.g., [Hetzner](https://www.hetzner.com/cloud/), [DigitalOcean](https://www.digitalocean.com/), etc.)
3. Create an `A` DNS record pointing to your servers **IPv4** address

```bash
quicky domains
```
Effortlessly **add** and **remove** domains and subdomains for your projects. Seamlessly manages Nginx configurations and automates SSL certificate provisioning, ensuring your applications are always secure and accessible.

### 6. Upgrade Quicky

```bash
quicky upgrade
```

Upgrades Quicky to the latest version.

### 8. Uninstall Quicky

```bash
quicky uninstall
```

Removes Quicky from your system.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Author

- [Alohe](https://x.com/alemalohe) 

Feel free to reach out to me on 𝕏 [@alemalohe](https://x.com/alemalohe) if you have any questions or feedback! 

## Contributing

Contributions are welcome! Please read the [CONTRIBUTING](CONTRIBUTING.md) file for guidelines on how to get started.