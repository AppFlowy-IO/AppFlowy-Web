## 🎯 Overview

AppFlowy Web requires AppFlowy Cloud as its backend. You can set up this pair in two ways:

- **🛠️ Development Mode** (`dev.env`) - For local development and testing
- **🚀 Production Mode** (`deploy.env`) - For production deployments with Docker

## 📋 Prerequisites

Before you begin, ensure you have:

- **Node.js** ≥18.0.0
- **pnpm** ≥10.9.0  
- **Docker & Docker Compose** (required for both modes)

## 🛠️ Development Mode Setup

**Best for:** Local development, testing, and debugging individual services.

### Step-by-Step Setup

#### 1. Set Up AppFlowy Cloud (Development)

> 💡 **Tip**: The `generate_env.sh` script creates a proper `.env` file with all necessary configurations. Check the [AppFlowy Cloud README](https://github.com/AppFlowy-IO/AppFlowy-Cloud/blob/main/README.md) for more details.
```bash
# Clone AppFlowy Cloud repository
git clone https://github.com/AppFlowy-IO/AppFlowy-Cloud.git
cd AppFlowy-Cloud

# Use development configuration
# The `generate_env.sh` script creates a proper `.env` file with all necessary configurations. 
./script/generate_env.sh 

# Start development server
# For new setup - RECOMMENDED FOR FIRST TIME
./script/run_local_server.sh --reset

# Or run (interactive prompts for container management)
./script/run_local_server.sh
```

#### 2. Set Up AppFlowy Web (Development)

```bash
# In a new terminal, navigate to your AppFlowy Web directory
cd /path/to/appflowy-web
cp dev.env .env

# Install dependencies and start
corepack enable
pnpm install
pnpm run dev
```

### Testing Timeline workspace access

Official production builds disable Timeline creation in non-Pro workspaces and show a Pro-workspace
tooltip in the new-page and database add-view menus. The check uses the current workspace's
subscription; Team and AI add-ons do not qualify. Self-hosted instances are exempt.

Web development/test mode bypasses this client check. To test creation without Pro, also run a
debug Cloud server (`debug_assertions` enabled); a release Cloud server still enforces Pro.
Production-policy tests explicitly disable the development bypass.


## 🚀 Production Mode Setup

**Best for:** Production deployments, staging environments, and containerized setups.


#### 1. Set Up AppFlowy Cloud (Production)

```bash
# Clone AppFlowy Cloud repository
git clone https://github.com/AppFlowy-IO/AppFlowy-Cloud.git
cd AppFlowy-Cloud

# Use production configuration
# The `generate_env.sh` script creates a proper `.env` file with all necessary configurations. 
./script/generate_env.sh 

# Start with Docker Compose
docker compose up -d
```

#### 2. Set Up AppFlowy Web (Production)

```bash
# In a new terminal, navigate to your AppFlowy Web directory
cd /path/to/appflowy-web

# Use matching production configuration
cp deploy.env .env

# Install dependencies and start
corepack enable
pnpm install
pnpm run dev
```

## Confluence import formats

The Confluence import option accepts single-space HTML and CSV export ZIPs. Choose it from a
page's import dialog to add content below that page, or from **Settings → Manage data → Import**
to create a workspace. Upload the complete export ZIP, including its attachments. The separate
CSV option imports ordinary CSV files as databases.

The web client uploads both export formats through the existing Confluence task APIs. AppFlowy
Cloud detects the archive format and converts the content. CSV exports require the native CSV
importer in [Cloud PR #1188](https://github.com/AppFlowy-IO/AppFlowy-Cloud-Premium/pull/1188);
servers with only the HTML importer cannot process CSV exports. Site backup ZIPs are unsupported.

For a real export sample, download XWiki's unmodified
[csv-RJTest.zip](https://github.com/xwiki-contrib/confluence/blob/7e8f8fc4ebd7cb735c233c4c3fa124c45102f9e1/confluence-xml/src/test/resources/confluencexml/csv-RJTest.zip).
The backend fixture test verifies 19 imported documents, page relationships, internal links,
and the current spreadsheet attachment. Web regressions cover selection, drag-and-drop,
Confluence routing, and preserving the original file through single and multipart uploads;
archive decoding is tested by the backend.

## 🔗 Additional Resources

- **[AppFlowy Cloud Repository](https://github.com/AppFlowy-IO/AppFlowy-Cloud)** - Backend setup and configuration
- **[AppFlowy Web README](../README.md)** - Frontend development guide  
- **[AppFlowy Documentation](https://appflowy.com/docs)** - Official product documentation
- **[AppFlowy GitHub Discussions](https://github.com/AppFlowy-IO/AppFlowy/discussions)** - Community support
