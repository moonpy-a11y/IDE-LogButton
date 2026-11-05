<div align="right">
  <img alt="License: Apache 2.0" src="https://img.shields.io/badge/License-Apache%202.0-blue.svg">
  <img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-green.svg">
</div>

# IDE LogButton

Codespaces stack for IDE login buttons. This repository currently includes a VS Code extension that signs in to GitHub through GitHub CLI.

## VS Code

- Install [GitHub CLI](https://cli.github.com/) and make sure `gh` is available on the VS Code extension host's `PATH`.
- Select **Sign in with GitHub CLI** in the status bar, or run **GitHub CLI: Sign In** from the Command Palette. The extension runs `gh auth login` in a VS Code terminal.
- After signing in, the extension configures Git credential access with `gh auth setup-git` and syncs open Git repositories. The status bar shows the active GitHub CLI account. Select it or run **GitHub CLI: Switch Account** to run `gh auth switch`.
- By default, authenticated open repositories sync when VS Code launches. Run **Git: Sync Workspace Repositories** to sync manually. Set `github-sign-in.syncOnLaunch` to `false` to disable launch sync.
- For GitHub Enterprise, set `github-sign-in.host` to the enterprise hostname before signing in.
- To sign out, run `gh auth logout` in a terminal. The status bar refreshes when VS Code regains focus or when you run **GitHub CLI: Refresh Status**.

The extension reads `gh auth status` to show the active account. It does not store or handle authentication tokens; GitHub CLI manages authentication and credentials.

### Google and Apple account linking

Google and Apple sign-in require a separately deployed authentication broker. The broker verifies the user's GitHub account through GitHub OAuth before linking a Google or Apple identity; repository sync and Git credentials continue to use GitHub CLI. The extension stores only the linked account name and provider names in VS Code global state. The broker stores identity-link records in SQLite, not provider or GitHub access tokens.

Run the broker with a current Node.js release that supports `node:sqlite`:

```sh
node backend/auth-broker.mjs
```

Configure these environment variables in the broker's hosting environment (do not commit secrets):

- `PUBLIC_BASE_URL`: public HTTPS origin of the broker.
- `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`: a GitHub OAuth App whose callback URL is `${PUBLIC_BASE_URL}/oauth/github/callback`.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: Google OAuth credentials with `${PUBLIC_BASE_URL}/oauth/google/callback` registered as a redirect URI.
- `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, and `APPLE_PRIVATE_KEY`: Sign in with Apple credentials with `${PUBLIC_BASE_URL}/oauth/apple/callback` registered as a return URL. Supply the private key in PEM format; escaped `\n` line breaks are supported.
- `GITHUB_HOST`: optional GitHub or GitHub Enterprise hostname; defaults to `github.com`.
- `PORT` and `DATABASE_PATH`: optional listener port and SQLite path; default to `8787` and `./data/auth-links.sqlite`.

In VS Code, set `github-sign-in.authBrokerUrl` to the broker's HTTPS base URL and set `github-sign-in.host` to the same GitHub host configured in the broker. The broker supports one GitHub host per deployment. Keep the database persistent and restrict access to it; it contains provider subject identifiers and linked GitHub account records.

## Development

Run `npm install`, then `npm test`. In a headless Linux container, run `xvfb-run -a npm test`. Press `F5` to launch an Extension Development Host and try the status-bar button.

[![F5 button view](<images/F5 button view.png>)](<images/F5 button view.png>)

[![VS Code Login Button UI](<images/VS Code Login Button UI.png>)](<images/VS Code Login Button UI.png>)
