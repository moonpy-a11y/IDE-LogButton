import * as vscode from 'vscode';

const signInCommand = 'github-sign-in.signIn';
const switchAccountCommand = 'github-sign-in.switchAccount';
const providerId = 'github';
const scopes: string[] = [];

export type RepoVisibility = 'public' | 'private' | 'unknown';

export type GitHubAccessState = {
	status: 'signed-in' | 'signed-out' | 'expired' | 'restricted';
	text: string;
	tooltip: string;
	command: string;
	accountLabel?: string;
};

export function getStatusBarAccessibilityInfo(accountLabel?: string): vscode.AccessibilityInformation {
	return {
		label: accountLabel ? `GitHub account ${accountLabel} button` : 'GitHub sign in button',
		role: 'button',
	};
}

export function createStatusBarItem(): vscode.StatusBarItem {
	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarItem.name = 'GitHub Sign In';
	statusBarItem.command = signInCommand;
	statusBarItem.text = '$(github) Sign in to GitHub';
	statusBarItem.tooltip = 'Sign in to GitHub using VS Code authentication';
	statusBarItem.accessibilityInformation = getStatusBarAccessibilityInfo();
	return statusBarItem;
}

export function getGitHubAccessState(
	session: vscode.AuthenticationSession | undefined,
	repoVisibility: RepoVisibility = 'unknown',
	error?: unknown,
): GitHubAccessState {
	const failureReason = error ? getAccessFailureReason(error) : undefined;

	if (failureReason === 'expired') {
		return {
			status: 'expired',
			text: '$(github) Sign in to GitHub',
			tooltip: 'Your GitHub session expired. Sign in again to continue.',
			command: signInCommand,
		};
	}

	if (failureReason === 'restricted') {
		if (repoVisibility === 'private') {
			return {
				status: 'restricted',
				text: '$(github) Private repo access required',
				tooltip: 'This GitHub session cannot access private or non-public repositories. Sign in with a valid account and try again.',
				command: signInCommand,
			};
		}

		return {
			status: 'restricted',
			text: '$(github) Repository access unavailable',
			tooltip: 'GitHub access is restricted for this repository. Check whether the repo is public, private, or the session is still valid.',
			command: signInCommand,
		};
	}

	if (session) {
		const state: GitHubAccessState = {
			status: 'signed-in',
			text: `$(github) ${session.account.label}`,
			tooltip: `Signed in to GitHub as ${session.account.label}. Click to switch account.`,
			command: switchAccountCommand,
			accountLabel: session.account.label,
		};

		if (repoVisibility === 'private') {
			state.tooltip = `Signed in to GitHub as ${session.account.label}. Private repository access may still require additional repository permissions.`;
		}

		return state;
	}

	return {
		status: 'signed-out',
		text: '$(github) Sign in to GitHub',
		tooltip: 'Sign in to GitHub using VS Code authentication',
		command: signInCommand,
	};
}

export function getAccessFailureReason(error: unknown): 'expired' | 'restricted' | 'unknown' {
	const value = error instanceof Error ? error.message : String(error ?? '');
	const normalized = value.toLowerCase();

	if (/expired|invalid.*token|token.*expired|session.*expired|401|unauthorized/.test(normalized)) {
		return 'expired';
	}

	if (/private|permission|forbidden|access.*denied|not.*authorized|repo.*not.*found|restricted/.test(normalized)) {
		return 'restricted';
	}

	return 'unknown';
}

export function getErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return String(error ?? 'Unknown GitHub sign-in error');
}

export function activate(context: vscode.ExtensionContext) {
	const statusBarItem = createStatusBarItem();
	statusBarItem.show();
	context.subscriptions.push(statusBarItem);

	const updateStatusBar = async () => {
		try {
			const session = await vscode.authentication.getSession(providerId, scopes, { silent: true });
			const state = getGitHubAccessState(session, 'unknown');
			statusBarItem.text = state.text;
			statusBarItem.tooltip = state.tooltip;
			statusBarItem.command = state.command;
			statusBarItem.accessibilityInformation = getStatusBarAccessibilityInfo(state.accountLabel);
		} catch (error) {
			const state = getGitHubAccessState(undefined, 'unknown', error);
			statusBarItem.text = state.text;
			statusBarItem.tooltip = state.tooltip;
			statusBarItem.command = state.command;
			statusBarItem.accessibilityInformation = getStatusBarAccessibilityInfo();
		}
	};

	const signIn = vscode.commands.registerCommand(signInCommand, async () => {
		try {
			const session = await vscode.authentication.getSession(providerId, scopes, {
				createIfNone: { detail: 'Sign in to GitHub from VS Code.' }
			});
			vscode.window.showInformationMessage(`Signed in to GitHub as ${session.account.label}.`);
		} catch (error) {
			const message = getErrorMessage(error);
			const failure = getGitHubAccessState(undefined, 'unknown', error);
			if (failure.status === 'expired') {
				vscode.window.showWarningMessage('Your GitHub session expired. Sign in again to continue.');
			} else if (failure.status === 'restricted') {
				vscode.window.showWarningMessage('GitHub access is restricted for this repository or account. Check the repo visibility and permissions.');
			} else {
				vscode.window.showErrorMessage(`GitHub sign-in failed: ${message}`);
			}
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
			const message = getErrorMessage(error);
			const failure = getGitHubAccessState(undefined, 'unknown', error);
			if (failure.status === 'expired') {
				vscode.window.showWarningMessage('Your GitHub session expired. Sign in again to continue.');
			} else if (failure.status === 'restricted') {
				vscode.window.showWarningMessage('GitHub access is restricted for this repository or account. Check the repo visibility and permissions.');
			} else {
				vscode.window.showErrorMessage(`Could not switch GitHub accounts: ${message}`);
			}
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
