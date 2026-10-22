<div align="right">
  <img alt="License: Apache 2.0" src="https://img.shields.io/badge/License-Apache%202.0-blue.svg">
  <img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-green.svg">
</div>

# IDE LogButton

Codespaces stack for IDE login buttons. This repository currently includes a VS Code extension that signs in to GitHub through VS Code's built-in authentication provider.

## VS Code

- Select **Sign in to GitHub** in the status bar, or run **GitHub: Sign In** from the Command Palette.
- After signing in, the status bar shows the active account. Select it or run **GitHub: Switch Account** to choose another account.
- To sign out, use the GitHub account entry in VS Code's Accounts menu. The status bar updates when the session changes.

The extension requests no additional scopes and does not store or handle authentication tokens. VS Code manages account consent, sign-in, and credentials.

## Development

Run `npm install`, then `npm test`. In a headless Linux container, run `xvfb-run -a npm test`. Press `F5` to launch an Extension Development Host and try the status-bar button.

[![F5 button view](<images/F5 button view.png>)](<images/F5 button view.png>)
