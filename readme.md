# Quicky CLI

A CLI tool that streamlines the deployment and management of self-hosted Next.js and Node.js projects, enabling initialization, deployment from GitHub, updating, deleting, and managing applications, along with effortless setup of domains and SSL certificates, simplifying the entire lifecycle of web applications on remote servers.

## Features

- 🐙 **GitHub Integration**: Initialize, deploy, and manage Next.js and Node.js projects from private and public GitHub repositories.
- ⚙️ **Process Management**: Leverage PM2 for application lifecycle and monitoring.
- 🔄 **Project Maintenance**: Easily update or remove deployed projects.
- 🌐 **Domain & SSL Automation**: Automatically configure Nginx for custom domains and SSL certificates, allowing you to add/remove domains from your projects.
- 📝 **Configuration Overview**: List and inspect details of all deployed projects and their domains.
- 🔧 **Webhook Management**: Set up, manage, and update webhooks for automated deployments.
- 📊 **Dashboard Access**: Manage and monitor your webhook server through a web-based dashboard.
- 🔍 **Log Management**: View output and error logs for your webhook server.

## Prerequisites

To install Quicky, first acquire a Linux Ubuntu server from a provider such as [DigitalOcean](https://m.do.co/c/9b7ccf30c0bd) or [Hetzner](https://www.hetzner.com/cloud/).

After setting up your server, connect to it (e.g., via SSH) and install Node.js and npm by executing the following commands:

```bash
sudo apt update
sudo apt install -y nodejs npm
```

## Installation

Install Quicky globally using either `npx` or `npm`:

```bash
npx quicky@latest install
```

or

```bash
sudo npm install -g quicky
```

**Note**: The `sudo` command is necessary for global installation and to prevent permission issues when configuring domains.

## Usage

### 1. Initialize Quicky

```bash
quicky init
```

This command will prompt you to enter your GitHub credentials and basic configurations for setting up your projects.

Quicky requires your GitHub access token and username to interact with your repositories. To create a new token, follow these steps:
1. Visit your [GitHub Personal Access Tokens page](https://github.com/settings/tokens) and make sure to use **Tokens (classic)**.
2. Click **Generate new token**.
3. Select the required scopes for repository access.
4. Click **Generate token**.
5. Copy the token and provide it to Quicky as your GitHub access token. This token will be stored locally for future use.

To enable Continuous Deployment, Quicky requests a webhook URL for automated deployments. 
It uses your GitHub token to set up a webhook listener and create webhooks dynamically. 
You'll need to create a subdomain (e.g., `webhook.example.com`) pointing to your server's IP address. This can be done by adding an `A` DNS record with the IPv4 address of your server.

### 2. Deploy a Project

```bash
quicky deploy
```

Quicky now supports deploying both **Next.js** and **Node.js** projects. During the deployment process, you will be prompted to select the project type:

- **Next.js**
- **Node.js**

#### Deploying a Next.js Project

Follow the prompts to select your Next.js repository. Quicky will handle the deployment and configuration automatically.

#### Deploying a Node.js Project

Before deploying a Node.js project, ensure that your main application file is named `index.js`. You have the option to specify whether your project will use a port:

- **With Port**: Provide the port number (e.g., 3000). Quicky will save it in the `.env` file, allowing you to point domains to your project.
- **Without Port**: Without specifying a port, domains cannot be directed to the project, causing it to operate solely as a background service.

This command will prompt you to provide:

- Your GitHub username or any organization name
- The repository name
- Project type (**Next.js** or **Node.js**)
- If **Node.js** is selected:
  - Whether your project uses a port
    - If yes, the port number on which the project should run (e.g., 3000)

**Environment Variables** - During deployment, you'll be asked whether you'd like to add environment variables to your project. Quicky will handle saving the port number in the `.env` file of your project if applicable.

### 3. Manage Projects

```bash
quicky manage
```

Lists all deployed projects and allows you to **start**, **stop**, **restart**, **update**, or **delete** a specific project.

### 4. Update a Project by PID

```bash
quicky update <pid>
```

Updates a specific project by its PID with the latest changes from the GitHub repository.


### 5. Configuration Overview

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

### 6. Domains

Before adding a domain to your project, you need to:

1. 🛒 **Purchase a domain name** from a registrar like [Namecheap](https://www.namecheap.com/) or [GoDaddy](https://www.godaddy.com/).
2. 🌐 **Create an `A` DNS record** pointing to your server's **IPv4** address.

Once you have your domain, you can easily manage it with the following command:

```bash
quicky domains
```

This command allows you to effortlessly **add** and **remove** domains and subdomains for your projects.

### 7. Webhooks

Quicky provides a built-in webhook server to automatically update your projects when changes are pushed to GitHub. Here's how to set it up:

#### Setting Up the Webhook Server

1. **Prerequisites**
   - Ensure you have a subdomain (e.g., webhook.example.com) pointing to your server's IP address
   - Add an A DNS record with your server's IPv4 address

2. **Initial Setup**
   ```bash
   quicky webhooks
   ```
   This command will:
   - Check if the webhook server is running
   - Guide you through the setup process if needed
   - Prompt for webhook configuration

3. **Configuration**
   - You'll need to provide a webhook URL (format: https://<your-subdomain>/webhook)
   - The webhook server will start automatically after setup

4. **Verify Setup**
   ```bash
   quicky webhooks status
   ```
   This shows:
   - Server running status
   - Options to restart/stop server
   - Access to server logs

#### Webhook Dashboard

1. **Setup Dashboard Access**
   ```bash
   quicky webhooks dashboard
   ```
   - Set up username and password
   - Credentials are securely stored

2. **Access Dashboard**
   - Open your browser to https://<your-subdomain>/dashboard
   - Log in with your credentials
   - Monitor webhook status
   - View webhook logs

#### Managing Webhooks

Use `quicky webhooks` with these commands:
- `status` - Check webhook server status
- `restart` - Restart the webhook server
- `stop` - Stop the webhook server
- `logs` - View webhook server logs
- `dashboard` - Access the webhook dashboard

### 8. Upgrade Quicky

```bash
quicky upgrade
```

Upgrades Quicky to the latest version.

### 9. Uninstall Quicky

```bash
quicky uninstall
```

Removes Quicky from your system.

## License

This project is licensed under the MIT License - see the [`LICENSE`](LICENSE) file for details.

## Author

- [Alohe](https://x.com/alemalohe) 

Feel free to reach out to me on 𝕏 [@alemalohe](https://x.com/alemalohe) if you have any questions or feedback! 

## Contributing

Contributions are welcome! Please read the CONTRIBUTING file for guidelines on how to get started.
