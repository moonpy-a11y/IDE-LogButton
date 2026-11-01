# GitHub authentication support runbook

This runbook is for support and triage of sign-in problems in the IDE LogButton extension. The extension relies on VS Code's built-in GitHub authentication provider and does not request custom scopes or store user tokens itself.

## Scope

Use this checklist when a user reports one of the following:

- "Sign in to GitHub" never completes
- the status bar stays signed out after a successful VS Code sign-in
- the button shows an expired or restricted session state
- switching accounts fails or the wrong GitHub account is active
- a private repository appears inaccessible even though the user is signed in
- VS Code reports a GitHub authentication or authorization error during login

## Known behavior

The extension intentionally does the following:

- uses `vscode.authentication.getSession('github', [], { ... })`
- requests no custom OAuth scopes
- shows the signed-in account name from the VS Code auth session
- treats session expiry and repository access restrictions as separate states

This means many problems are actually VS Code account-state problems rather than extension bugs.

## Quick triage

1. Confirm the user is signed in to GitHub from VS Code itself.
   - Open the Accounts menu in VS Code.
   - Check whether GitHub appears as a signed-in account.
2. Confirm the repo visibility and access level.
   - Public repos should be accessible without extra permissions.
   - Private repos may require a valid GitHub account with repo access.
3. Ask whether the problem is reproducible after reload.
   - If it clears after reload, the issue is likely a stale session or transient VS Code auth state.
4. Check whether the user can sign in from another VS Code workspace or after sign-out.
   - If the problem only affects one workspace, the issue is more likely a local VS Code state problem than a repo or extension issue.

## Decision tree

### Symptom: button remains signed out

1. Open Command Palette and run `GitHub: Sign In`.
2. If the UI prompts for account selection, complete it.
3. Verify the account appears under VS Code Accounts.
4. Reload the window and re-check the status bar.
5. If it still stays signed out, capture the exact error message and continue to the debugging section below.

### Symptom: session is marked expired

This usually means the underlying VS Code auth session is invalid or expired.

1. Sign out from the GitHub account in VS Code Accounts.
2. Sign back in.
3. Reload the window.
4. Re-run the status bar action.
5. If the issue persists, collect the exact login failure message and confirm whether the same account works in another VS Code environment.

### Symptom: repository access is restricted

This usually means one of the following:

- the account is valid but lacks access to a private repository
- the repo visibility is not what the user expects
- the token/session is valid but cannot access the requested repository

Troubleshooting:

1. Check whether the repo is public or private.
2. Confirm the user account has access to the repository.
3. If the repo is private, ask the user to confirm they are signed in with the correct GitHub account.
4. Try `GitHub: Switch Account` and select the correct account.
5. If the account has access but the state still says restricted, collect the repo URL and account label.

## Debugging steps

### 1. Verify environment

Ask for:

- VS Code version
- OS and architecture
- the repo URL being accessed
- whether the repo is public or private
- the exact error message from the notification dialog
- whether the user is able to sign in to GitHub in a different VS Code window

### 2. Check VS Code authentication state

In VS Code:

- open the Accounts menu
- check if a GitHub account is present and not expired
- use the sign-out/sign-in flow to clear stale state
- reload the window after re-authentication

If a user is signed in to GitHub in the browser but not in VS Code, the extension cannot use the browser session unless VS Code has its own authenticated session.

### 3. Check extension logs

Use the VS Code Developer Tools and extension host logs:

- open the Command Palette
- run `Developer: Toggle Developer Tools`
- run `Developer: Set Log Level` and choose `Trace`
- retry the sign-in or switch-account action
- capture the relevant logs for the GitHub authentication request and any exceptions

Look for:

- `401` or `403` responses
- token/session expiration errors
- access denied or forbidden messages
- provider-level auth failures

### 4. Confirm the extension is not the source of custom auth state

The extension does not:

- request extra scopes
- hold a custom token cache
- persist GitHub credentials in project files

If the problem appears after a reinstall or a clean window, the likely root cause is VS Code session state, account state, or repo permissions rather than this extension.

## Escalation criteria

Escalate to the engineering owner or repository maintainer when:

- the user cannot sign in even after removing and re-adding the GitHub account in VS Code
- the extension repeatedly reports expired or restricted state despite valid credentials
- the auth flow fails in multiple workspaces or accounts
- the issue reproduces with a public repository and a valid GitHub account
- logs show provider errors or repeated auth exceptions that are not resolved by sign-out/sign-in
- the issue requires product or platform-level investigation outside the extension code

## Information to include in an escalation

Collect the following before escalating:

- VS Code version
- OS and architecture
- GitHub account email or username
- repo URL and whether it is public or private
- exact notification text or error message
- whether the user can sign in using VS Code outside this repo/workspace
- screenshots or logs from Developer Tools
- relevant timestamps

## Recommended support response

A concise support response is:

> This extension uses VS Code's built-in GitHub authentication. Please verify the account is signed in from VS Code, then sign out and sign back in to refresh the session. If the issue persists, we will need the exact error text, repo visibility, and VS Code version to determine whether this is a VS Code auth-state problem or an extension bug.

## Related references

- `README.md` in this repository for the basic sign-in flow
- VS Code authentication documentation for GitHub accounts and account management
- the extension's `src/extension.ts` file for sign-in and account-switch logic

This runbook should be updated as new auth failure modes are identified or as VS Code changes its GitHub authentication behavior.

## Support checklist

- [ ] Verified the user is signed in through VS Code Accounts
- [ ] Confirmed repo visibility and account access
- [ ] Attempted sign-out and sign-in cycle
- [ ] Reloaded the VS Code window
- [ ] Captured exact error text
- [ ] Reviewed Developer Tools or extension logs
- [ ] Confirmed whether the problem is workspace-specific or global
- [ ] Escalated with the required evidence if unresolved

This checklist gives the frontline support team a repeatable way to resolve common auth issues without changing the extension implementation.
