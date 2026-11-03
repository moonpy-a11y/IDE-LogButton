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

## Development

Run `npm install`, then `npm test`. In a headless Linux container, run `xvfb-run -a npm test`. Press `F5` to launch an Extension Development Host and try the status-bar button.

[![F5 button view](<images/F5 button view.png>)](<images/F5 button view.png>)

[![VS Code Login Button UI](<images/VS Code Login Button UI.png>)](<images/VS Code Login Button UI.png>)
