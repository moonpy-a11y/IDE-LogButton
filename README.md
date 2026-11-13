<div align="right">
  <img alt="License: Apache 2.0" src="https://img.shields.io/badge/License-Apache%202.0-blue.svg">
  <img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-green.svg">
</div>

# IDE LogButton

Codespaces stack for IDE login buttons. This repository currently includes a VS Code extension that signs in to GitHub through GitHub CLI.

## Overview

This repo provides a lightweight authentication flow for developers working inside VS Code. The primary component is a VS Code extension that lets users sign in to GitHub using the GitHub CLI, shows the active account in the status bar, and synchronizes open repositories with the authenticated GitHub identity.

The project also includes an optional authentication broker for Google and Apple sign-in. That broker verifies the user's GitHub account through OAuth and links external identities to the GitHub account in a secure, self-hosted setup.

## Repository structure

- `src/extension.ts`: main VS Code extension implementation
- `backend/`: backend service for OAuth-based Google/Apple linking and account broker functionality
- `docs/`: project guidance and supporting documentation
- `images/`: screenshots and UI examples
- `package.json`: extension metadata, commands, configuration, and scripts

## VS Code

- Install [GitHub CLI](https://cli.github.com/) and make sure `gh` is available on the VS Code extension host's `PATH`.
- Select **Sign in with GitHub CLI** in the status bar, or run **GitHub CLI: Sign In** from the Command Palette. The extension runs `gh auth login` in a VS Code terminal.
- After signing in, the extension configures Git credential access with `gh auth setup-git` and syncs open Git repositories. The status bar shows the active GitHub CLI account. Select it or run **GitHub CLI: Refresh Status** to refresh the status bar.
- By default, authenticated open repositories sync when VS Code launches. Run **Git: Sync Workspace Repositories** to sync manually. Set `github-sign-in.syncOnLaunch` to `false` to disable launch-time sync.
- For GitHub Enterprise, set `github-sign-in.host` to the enterprise hostname before signing in.
- To sign out, run `gh auth logout` in a terminal. The status bar refreshes when VS Code regains focus or when you run **GitHub CLI: Refresh Status**.

The extension reads `gh auth status` to show the active account. It does not store or handle authentication tokens; GitHub CLI manages authentication and credentials.

### Google and Apple account linking

Google and Apple sign-in require a separately deployed authentication broker. The broker verifies the user's GitHub account through GitHub OAuth before linking a Google or Apple identity; repositories can then be synced and managed under the same GitHub identity.

Run the broker with a current Node.js release that supports `node:sqlite`:

```sh
node backend/auth-broker.mjs
```

Configure these environment variables in the broker's hosting environment (do not commit secrets):

- `PUBLIC_BASE_URL`: public HTTPS origin of the broker.
- `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`: a GitHub OAuth App whose callback URL is `${PUBLIC_BASE_URL}/oauth/github/callback`.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: Google OAuth credentials with `${PUBLIC_BASE_URL}/oauth/google/callback` registered as a redirect URI.
- `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, and `APPLE_PRIVATE_KEY`: Sign in with Apple credentials with `${PUBLIC_BASE_URL}/oauth/apple/callback` registered as a return URL. Supply the private key in PEM format.
- `GITHUB_HOST`: optional GitHub or GitHub Enterprise hostname; defaults to `github.com`.
- `PORT` and `DATABASE_PATH`: optional listener port and SQLite path; default to `8787` and `./data/auth-links.sqlite`.

In VS Code, set `github-sign-in.authBrokerUrl` to the broker's HTTPS base URL and set `github-sign-in.host` to the same GitHub host configured in the broker. The broker supports one GitHub host per deployment.

## Development

Run `npm install`, then `npm test`. In a headless Linux container, run `xvfb-run -a npm test`. Press `F5` to launch an Extension Development Host and try the status-bar button.

[![F5 button view](<images/F5 button view.png>)](<images/F5 button view.png>)

[![VS Code Login Button UI](<images/VS Code Login Button UI.png>)](<images/VS Code Login Button UI.png>)
