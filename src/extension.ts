import * as vscode from 'vscode';

const signInCommand = 'github-sign-in.signIn';
const switchAccountCommand = 'github-sign-in.switchAccount';
const providerId = 'github';
const scopes: string[] = [];

export function activate(context: vscode.ExtensionContext) {
	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarItem.name = 'GitHub Sign In';
	statusBarItem.command = signInCommand;
	statusBarItem.text = '$(github) Sign in to GitHub';
	statusBarItem.tooltip = 'Sign in to GitHub using VS Code authentication';
	statusBarItem.show();
	context.subscriptions.push(statusBarItem);

	const updateStatusBar = async () => {
		try {
			const session = await vscode.authentication.getSession(providerId, scopes, { silent: true });
			if (session) {
				statusBarItem.text = `$(github) ${session.account.label}`;
				statusBarItem.tooltip = `Signed in to GitHub as ${session.account.label}. Click to switch account.`;
				statusBarItem.command = switchAccountCommand;
			} else {
				statusBarItem.text = '$(github) Sign in to GitHub';
				statusBarItem.tooltip = 'Sign in to GitHub using VS Code authentication';
				statusBarItem.command = signInCommand;
			}
		} catch {
			statusBarItem.text = '$(github) Sign in to GitHub';
			statusBarItem.tooltip = 'Sign in to GitHub using VS Code authentication';
			statusBarItem.command = signInCommand;
		}
	};

	const signIn = vscode.commands.registerCommand(signInCommand, async () => {
		try {
			const session = await vscode.authentication.getSession(providerId, scopes, {
				createIfNone: { detail: 'Sign in to GitHub from VS Code.' }
			});
			vscode.window.showInformationMessage(`Signed in to GitHub as ${session.account.label}.`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			vscode.window.showErrorMessage(`GitHub sign-in failed: ${message}`);
		} finally {
			void updateStatusBar();
		}
	});

	const switchAccount = vscode.commands.registerCommand(switchAccountCommand, async () => {
		try {
			const session = await vscode.authentication.getSession(providerId, scopes, {
				forceNewSession: { detail: 'Choose a GitHub account to use in VS Code.' }
			});
			vscode.window.showInformationMessage(`Using GitHub account ${session.account.label}.`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			vscode.window.showErrorMessage(`Could not switch GitHub accounts: ${message}`);
		} finally {
			void updateStatusBar();
		}
	});

	const sessionChanges = vscode.authentication.onDidChangeSessions(() => {
		void updateStatusBar();
	});

	context.subscriptions.push(signIn, switchAccount, sessionChanges);
	void updateStatusBar();
}
