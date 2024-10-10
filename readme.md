# Quicky
A CLI tool for effortless Next.js deployment and management. Initialize, deploy from GitHub, update, delete, and manage projects. Handles PM2 instances and domain configuration. Streamlines the entire lifecycle of Next.js applications on remote servers.

## Features

- 🐙 **GitHub Integration**: Initialize, deploy, and manage Next.js projects from private and public GitHub repositories.
- ⚙️ **Process Management**: Leverage PM2 for application lifecycle and monitoring.
- 🔄 **Project Maintenance**: Easily update or remove deployed projects.
- 🌐 **Domain & SSL Automation**: Automatically configure Nginx for custom domains and SSL certificates.
- 📋 **Configuration Overview**: List and inspect details of all deployed projects and their domains.

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

**Note**: Using `sudo` is required to install Quicky globally and to avoid permission issues while configuring Nginx.

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

**Environment Variables** - During deployment, you’ll be asked if you want to add environment variables to your project or not.

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
- **Domains**: Associated domains for the project.
- **Last updated**: Date and time of the last deployment/update.

### 5. Domains

**Prerequisites** - Before adding a domain to your project, you need to:

1. Purchase a domain name (e.g., [Namecheap](https://www.namecheap.com/), [GoDaddy](https://www.godaddy.com/), etc.)
2. Purchase a Linux Ubuntu server (e.g., [Hetzner](https://www.hetzner.com/cloud/), [DigitalOcean](https://www.digitalocean.com/), etc.)
3. Create an `A` DNS record pointing to your server IPv4 address

```bash
quicky domains
```

Allows you to **add** and **remove** domains and subdomains for your projects effortlessly. Handles Nginx configuration and SSL certificates.

### 6. Install Quicky

```bash
quicky install
```

Installs Quicky globally.

### 7. Upgrade Quicky

```bash
quicky upgrade
```

Upgrades Quicky to the latest version.

### 8. Uninstall Quicky

```bash
quicky uninstall
```

Uninstalls Quicky globally.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Author

- [Alohe](https://x.com/alemalohe) 

Feel free to reach out to me on 𝕏 [@alemalohe](https://x.com/alemalohe) if you have any questions or feedback! 

## Contributing

Contributions are welcome! Please read the [CONTRIBUTING](CONTRIBUTING.md) file for guidelines on how to get started.

Feel free to reach out to me on 𝕏 [@alemalohe](https://x.com/alemalohe) if you have any questions or feedback! 