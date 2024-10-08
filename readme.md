# Quicky

Quicky is a powerful Node.js CLI that makes server management and deployment a breeze. It's a simple and easy-to-use tool that allows you to manage your servers and deploy your projects with ease.

## Features

- 🐙 **Initialize & Deploy Projects**: Save your GitHub credentials, set up projects for deployment, and quickly clone, build, and run your Next.js projects from GitHub on specified ports.
- ⚙️ **Process Management**: Uses PM2 to manage application lifecycles and monitoring.
- 🌐 **Nginx & SSL Setup**: Automatically configure Nginx to route custom domains and handle SSL certificates.
- 🔄 **Update & Delete Projects**: Keep your projects up-to-date or remove them as needed.
- 📋 **View Project Configurations**: List and view details of all deployed projects and their configurations.

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
