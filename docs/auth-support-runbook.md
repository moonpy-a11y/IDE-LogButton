# GitHub CLI authentication support runbook

This runbook covers sign-in problems in the IDE LogButton extension. The extension delegates authentication to GitHub CLI (`gh`) and does not request, store, or handle authentication tokens.

## Scope

Use this checklist when:

- the sign-in or switch-account button does not start
- the status bar does not show the active GitHub CLI account
- GitHub CLI reports an authentication or authorization error
- a private repository appears inaccessible

## Known behavior

- The extension runs `gh auth login --hostname github.com` for sign-in.
- The extension runs `gh auth switch --hostname github.com` to change accounts.
- It reads `gh auth status --hostname github.com --json hosts` to display the active account.
- The GitHub CLI handles account consent, sign-in, and credential storage. VS Code's built-in GitHub authentication session is not used.

## Quick triage

1. Confirm GitHub CLI is installed and available on the VS Code extension host's `PATH` by running `gh --version` in a VS Code terminal.
2. Run `gh auth status --hostname github.com` to verify the active account and authentication state.
3. If signed out, use **GitHub CLI: Sign In** from the Command Palette or the status-bar button.
4. If the wrong account is active, use **GitHub CLI: Switch Account**.
5. For a private repository, confirm the active account has access to that repository.
6. To refresh after changing CLI auth outside the extension, run **GitHub CLI: Refresh Status**.

## Troubleshooting

### GitHub CLI is not found

Install [GitHub CLI](https://cli.github.com/) and ensure the `gh` executable is on the extension host's `PATH`. If `gh` was installed while VS Code was open, restart VS Code so the extension host receives the updated environment.

### The button does not complete sign-in

The extension starts `gh auth login` in a VS Code terminal. Complete any prompts in that terminal, including the browser/device authorization flow. Check the terminal output for GitHub CLI errors. After the task finishes, the status bar refreshes automatically.

### The account or repository is not available

1. Run `gh auth status --hostname github.com`.
2. Confirm that the expected account is active and authenticated.
3. Use **GitHub CLI: Switch Account** if another account should be active.
4. Confirm the selected account has access to the repository.

## Information to include in an escalation

- VS Code version, OS, and architecture
- GitHub CLI version (`gh --version`)
- exact notification or terminal error text
- whether `gh auth status --hostname github.com` succeeds
- repository URL and whether it is public or private

Do not include access tokens or credential-store contents in support reports.
