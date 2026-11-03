import { execFile } from 'node:child_process';
import * as vscode from 'vscode';

const signInCommand = 'github-sign-in.signIn';
const switchAccountCommand = 'github-sign-in.switchAccount';
const refreshCommand = 'github-sign-in.refresh';
const syncCommand = 'github-sign-in.syncWorkspace';
const defaultGitHubHost = 'github.com';
const loginTaskName = 'GitHub CLI: Sign In';
const switchTaskName = 'GitHub CLI: Switch Account';

type GitRepository = {
	rootUri: vscode.Uri;
	state: {
		remotes: readonly unknown[];
	};
	sync(): Promise<void>;
};

type GitApi = {
	repositories: readonly GitRepository[];
};

type GitExtension = {
	getAPI(version: 1): GitApi;
};

export type GitHubAccessState = {
	status: 'signed-in' | 'signed-out' | 'unavailable' | 'error';
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
	statusBarItem.name = 'GitHub CLI Sign In';
	statusBarItem.command = signInCommand;
	statusBarItem.text = '$(github) Sign in with GitHub CLI';
	statusBarItem.tooltip = 'Run gh auth login to sign in to GitHub';
	statusBarItem.accessibilityInformation = getStatusBarAccessibilityInfo();
	return statusBarItem;
}

export function getGitHubAccessState(accountLabel?: string, error?: unknown): GitHubAccessState {
	if (error) {
		const unavailable = isRecord(error) && error.code === 'ENOENT';
		return {
			status: unavailable ? 'unavailable' : 'error',
			text: unavailable ? '$(github) GitHub CLI not found' : '$(github) GitHub CLI status unavailable',
			tooltip: unavailable
				? 'Install GitHub CLI (gh) to sign in.'
				: `Could not read GitHub CLI authentication status: ${getErrorMessage(error)}`,
			command: signInCommand,
		};
	}

	if (accountLabel) {
		return {
			status: 'signed-in',
			text: `$(github) ${accountLabel}`,
			tooltip: `Signed in to GitHub CLI as ${accountLabel}. Click to switch account.`,
			command: switchAccountCommand,
			accountLabel,
		};
	}

	return {
		status: 'signed-out',
		text: '$(github) Sign in with GitHub CLI',
		tooltip: 'Run gh auth login to sign in to GitHub',
		command: signInCommand,
	};
}

export function getActiveGitHubAccount(output: string, host = defaultGitHubHost): string | undefined {
	const parsed: unknown = JSON.parse(output);
	if (!isRecord(parsed) || !isRecord(parsed.hosts)) {
		throw new Error('GitHub CLI returned an unexpected authentication status.');
	}

	const githubAccounts = parsed.hosts[host];
	if (!Array.isArray(githubAccounts)) {
		return undefined;
	}

	const activeUser = githubAccounts.find((user: unknown) =>
		isRecord(user) && user.active === true && user.state === 'success' && typeof user.login === 'string',
	);
	return isRecord(activeUser) && typeof activeUser.login === 'string' ? activeUser.login : undefined;
}

export function getErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return String(error ?? 'Unknown GitHub CLI error');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function getConfiguredGitHubHost(): string {
	const configuredHost = vscode.workspace.getConfiguration('github-sign-in').get<string>('host', defaultGitHubHost);
	return configuredHost.trim().replace(/\/$/, '') || defaultGitHubHost;
}

function getGhAuthStatus(host: string): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			'gh',
			['auth', 'status', '--hostname', host, '--json', 'hosts'],
			{ encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 },
			(error, stdout) => {
				if (error) {
					reject(error);
					return;
				}
				resolve(stdout);
			},
		);
	});
}

function runGhCommand(args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		execFile('gh', args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 }, error => {
			if (error) {
				reject(error);
				return;
			}
			resolve();
		});
	});
}

async function syncWorkspaceRepositories(showSuccess: boolean): Promise<void> {
	const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
	if (!gitExtension) {
		throw new Error('The built-in VS Code Git extension is unavailable.');
	}

	const repositories = (await gitExtension.activate()).getAPI(1).repositories;
	if (repositories.length === 0) {
		if (showSuccess) {
			vscode.window.showInformationMessage('No Git repositories are open in this workspace.');
		}
		return;
	}

	const failures: string[] = [];
	let syncedCount = 0;
	for (const repository of repositories) {
		if (repository.state.remotes.length === 0) {
			continue;
		}
		try {
			await repository.sync();
			syncedCount += 1;
		} catch (error) {
			failures.push(`${repository.rootUri.fsPath}: ${getErrorMessage(error)}`);
		}
	}

	if (failures.length > 0) {
		throw new Error(failures.join('; '));
	}
	if (showSuccess) {
		vscode.window.showInformationMessage(`Synced ${syncedCount} Git repositories.`);
	}
}

export function activate(context: vscode.ExtensionContext) {
	const statusBarItem = createStatusBarItem();
	statusBarItem.show();
	context.subscriptions.push(statusBarItem);

	let activeTaskName: string | undefined;
	let activeTaskExitCode: number | undefined;
	const updateStatusBar = async () => {
		if (activeTaskName) {
			return;
		}

		try {
			const host = getConfiguredGitHubHost();
			const output = await getGhAuthStatus(host);
			if (activeTaskName) {
				return;
			}
			const state = getGitHubAccessState(getActiveGitHubAccount(output, host));
			statusBarItem.text = state.text;
			statusBarItem.tooltip = state.tooltip;
			statusBarItem.command = state.command;
			statusBarItem.accessibilityInformation = getStatusBarAccessibilityInfo(state.accountLabel);
		} catch (error) {
			if (activeTaskName) {
				return;
			}
			const state = getGitHubAccessState(undefined, error);
			statusBarItem.text = state.text;
			statusBarItem.tooltip = state.tooltip;
			statusBarItem.command = state.command;
			statusBarItem.accessibilityInformation = getStatusBarAccessibilityInfo();
		}
	};

	const runAuthTask = async (name: string, args: string[]) => {
		if (activeTaskName) {
			vscode.window.showInformationMessage('A GitHub CLI authentication task is already running.');
			return;
		}

		const task = new vscode.Task(
			{ type: 'shell' },
			vscode.TaskScope.Global,
			name,
			'GitHub CLI',
			new vscode.ShellExecution('gh', args),
		);
		activeTaskName = name;
		activeTaskExitCode = undefined;
		statusBarItem.text = '$(sync~spin) GitHub CLI authentication';
		statusBarItem.tooltip = 'Complete the authentication flow in the terminal.';

		try {
			await vscode.tasks.executeTask(task);
		} catch (error) {
			activeTaskName = undefined;
			vscode.window.showErrorMessage(`Could not start GitHub CLI authentication: ${getErrorMessage(error)}`);
			void updateStatusBar();
		}
	};

	const signIn = vscode.commands.registerCommand(signInCommand, async () => {
		await runAuthTask(loginTaskName, ['auth', 'login', '--hostname', getConfiguredGitHubHost()]);
	});

	const switchAccount = vscode.commands.registerCommand(switchAccountCommand, async () => {
		await runAuthTask(switchTaskName, ['auth', 'switch', '--hostname', getConfiguredGitHubHost()]);
	});

	const refresh = vscode.commands.registerCommand(refreshCommand, updateStatusBar);

	const sync = vscode.commands.registerCommand(syncCommand, async () => {
		try {
			const host = getConfiguredGitHubHost();
			await runGhCommand(['auth', 'setup-git', '--hostname', host]);
			await syncWorkspaceRepositories(true);
		} catch (error) {
			vscode.window.showErrorMessage(`Git sync failed: ${getErrorMessage(error)}`);
		}
	});

	const windowStateChanged = vscode.window.onDidChangeWindowState(state => {
		if (state.focused) {
			void updateStatusBar();
		}
	});

	const taskEnded = vscode.tasks.onDidEndTask(event => {
		if (event.execution.task.source !== 'GitHub CLI' || event.execution.task.name !== activeTaskName) {
			return;
		}
		const shouldSync = activeTaskExitCode === 0;
		activeTaskName = undefined;
		activeTaskExitCode = undefined;
		void updateStatusBar();
		if (shouldSync) {
			void (async () => {
				try {
					const host = getConfiguredGitHubHost();
					await runGhCommand(['auth', 'setup-git', '--hostname', host]);
					await syncWorkspaceRepositories(true);
				} catch (error) {
					vscode.window.showErrorMessage(`Git sync failed: ${getErrorMessage(error)}`);
				}
			})();
		}
	});

	const taskProcessEnded = vscode.tasks.onDidEndTaskProcess(event => {
		if (event.execution.task.source === 'GitHub CLI'
			&& event.execution.task.name === activeTaskName
			&& event.exitCode !== 0) {
			activeTaskExitCode = event.exitCode ?? 1;
			vscode.window.showErrorMessage(
				`GitHub CLI authentication failed with exit code ${event.exitCode ?? 'unknown'}. Check the terminal for details.`,
			);
		} else if (event.execution.task.source === 'GitHub CLI' && event.execution.task.name === activeTaskName) {
			activeTaskExitCode = 0;
		}
	});

	context.subscriptions.push(signIn, switchAccount, refresh, sync, windowStateChanged, taskEnded, taskProcessEnded);
	void updateStatusBar();
	if (vscode.workspace.getConfiguration('github-sign-in').get<boolean>('syncOnLaunch', true)) {
		const host = getConfiguredGitHubHost();
		void getGhAuthStatus(host)
			.then(async output => {
				if (getActiveGitHubAccount(output, host)) {
					await runGhCommand(['auth', 'setup-git', '--hostname', host]);
					return syncWorkspaceRepositories(false);
				}
				return undefined;
			})
			.catch(() => undefined);
	}
}
