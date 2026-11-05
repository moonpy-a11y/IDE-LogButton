import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';

const signInCommand = 'github-sign-in.signIn';
const switchAccountCommand = 'github-sign-in.switchAccount';
const refreshCommand = 'github-sign-in.refresh';
const syncCommand = 'github-sign-in.syncWorkspace';
const providerSignInCommand = 'github-sign-in.providerAccount';
const googleSignInCommand = 'github-sign-in.signInWithGoogle';
const appleSignInCommand = 'github-sign-in.signInWithApple';
const clearProviderAccountCommand = 'github-sign-in.clearProviderAccount';
const defaultGitHubHost = 'github.com';
const linkedAccountStorageKey = 'github-sign-in.linkedProviderAccounts';
const loginTaskName = 'GitHub CLI: Sign In';
const switchTaskName = 'GitHub CLI: Switch Account';
const extensionAuthority = 'moonpy-a11y.github-sign-in';
const vscodeCallbackPath = '/auth-callback';

type Provider = 'google' | 'apple';

type LinkedProviderAccount = {
	githubLogin: string;
	providers: Provider[];
};

type BrokerAuthResult = LinkedProviderAccount & {
	githubHost: string;
	provider: Provider;
};

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

	return String(error ?? 'Unknown error');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function getConfiguredGitHubHost(): string {
	const configuredHost = vscode.workspace.getConfiguration('github-sign-in').get<string>('host', defaultGitHubHost);
	const host = configuredHost.trim().replace(/\/$/, '').toLowerCase() || defaultGitHubHost;
	if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/.test(host)) {
		throw new Error('github-sign-in.host must be a hostname without a scheme or path.');
	}
	return host;
}

function getConfiguredAuthBrokerUrl(): URL {
	const configuredUrl = vscode.workspace.getConfiguration('github-sign-in').get<string>('authBrokerUrl', '').trim();
	if (!configuredUrl) {
		throw new Error('Set github-sign-in.authBrokerUrl to your deployed authentication broker URL.');
	}

	let url: URL;
	try {
		url = new URL(configuredUrl);
	} catch {
		throw new Error('github-sign-in.authBrokerUrl must be a valid HTTPS URL.');
	}
	const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
	if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback))
		|| url.username || url.password || url.search || url.hash) {
		throw new Error('The authentication broker URL must use HTTPS and must not contain credentials, a query, or a fragment.');
	}
	url.pathname = url.pathname.replace(/\/+$/, '');
	return url;
}

function isProvider(value: unknown): value is Provider {
	return value === 'google' || value === 'apple';
}

function getBrokerAuthResult(result: Record<string, unknown>, expectedProvider: Provider, expectedHost: string): BrokerAuthResult {
	if (!isProvider(result.provider)
		|| result.provider !== expectedProvider
		|| result.githubHost !== expectedHost
		|| typeof result.githubLogin !== 'string'
		|| !Array.isArray(result.providers)
		|| !result.providers.every(isProvider)) {
		throw new Error('The broker returned account information that does not match this sign-in.');
	}
	return {
		provider: result.provider,
		githubHost: result.githubHost,
		githubLogin: result.githubLogin,
		providers: result.providers,
	};
}

function getProviderErrorMessage(error: unknown): string {
	const message = getErrorMessage(error);
	const knownErrors: Record<string, string> = {
		github_host_mismatch: 'The broker is configured for a different GitHub host. Align github-sign-in.host with the broker GITHUB_HOST.',
		github_sign_in_cancelled: 'GitHub sign-in was cancelled.',
		github_verification_failed: 'The broker could not verify your GitHub account. Check the broker configuration and try again.',
		google_sign_in_cancelled: 'Google sign-in was cancelled.',
		apple_sign_in_cancelled: 'Apple sign-in was cancelled.',
		google_verification_failed: 'The broker could not verify your Google account. Check provider setup and try again.',
		apple_verification_failed: 'The broker could not verify your Apple account. Check provider setup and try again.',
		identity_already_linked: 'This provider identity is already linked to a different GitHub account.',
		invalid_or_expired_auth_code: 'The sign-in response expired. Start the sign-in flow again.',
	};
	return knownErrors[message] ?? message;
}

async function fetchBrokerJson(url: URL, init?: RequestInit): Promise<Record<string, unknown>> {
	let response: Response;
	try {
		response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
	} catch (error) {
		throw new Error(`Could not reach the authentication broker: ${getErrorMessage(error)}`);
	}

	let result: unknown;
	try {
		result = await response.json();
	} catch {
		throw new Error('The authentication broker returned an invalid response.');
	}
	if (!isRecord(result)) {
		throw new Error('The authentication broker returned an invalid response.');
	}
	if (!response.ok) {
		throw new Error(typeof result.error === 'string' ? result.error : `Authentication broker request failed (${response.status}).`);
	}
	return result;
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

	const providerStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
	providerStatusBarItem.name = 'Google and Apple Account';
	providerStatusBarItem.command = providerSignInCommand;
	providerStatusBarItem.show();
	context.subscriptions.push(providerStatusBarItem);
	const pendingProviderSignIns = new Map<string, { provider: Provider; expiresAt: number }>();

	const getLinkedProviderAccounts = () =>
		context.globalState.get<Record<string, LinkedProviderAccount>>(linkedAccountStorageKey, {});

	const updateProviderStatusBar = () => {
		let host: string;
		try {
			host = getConfiguredGitHubHost();
		} catch (error) {
			providerStatusBarItem.text = '$(warning) Invalid GitHub host';
			providerStatusBarItem.tooltip = getErrorMessage(error);
			providerStatusBarItem.accessibilityInformation = {
				label: 'Invalid GitHub host configuration',
				role: 'button',
			};
			return;
		}
		const account = getLinkedProviderAccounts()[host];
		providerStatusBarItem.text = account
			? `$(account) ${account.githubLogin} (${account.providers.join(', ')})`
			: '$(account) Sign in with Google/Apple';
		providerStatusBarItem.tooltip = account
			? `Google/Apple identities linked to ${account.githubLogin} on ${host}. Git and repository sync use GitHub CLI credentials separately.`
			: 'Sign in with Google or Apple and link the identity to a GitHub account.';
		providerStatusBarItem.accessibilityInformation = {
			label: account
				? `Provider identities linked to GitHub account ${account.githubLogin}`
				: 'Google or Apple sign in button',
			role: 'button',
		};
	};

	const signInWithProvider = async (provider: Provider) => {
		let brokerUrl: URL;
		try {
			brokerUrl = getConfiguredAuthBrokerUrl();
		} catch (error) {
			vscode.window.showErrorMessage(`${provider} sign-in failed: ${getErrorMessage(error)}`);
			return;
		}

		const clientState = randomBytes(32).toString('base64url');
		const startUrl = new URL(`${brokerUrl.href.replace(/\/$/, '')}/auth/start`);
		startUrl.searchParams.set('provider', provider);
		try {
			startUrl.searchParams.set('host', getConfiguredGitHubHost());
		} catch (error) {
			vscode.window.showErrorMessage(`${provider} sign-in failed: ${getErrorMessage(error)}`);
			return;
		}
		startUrl.searchParams.set('client_state', clientState);

		try {
			const start = await fetchBrokerJson(startUrl);
			if (typeof start.authorizationUrl !== 'string') {
				throw new Error('The authentication broker did not provide an authorization URL.');
			}
			const authorizationUrl = new URL(start.authorizationUrl);
			const expectedGitHubUrl = new URL(`https://${getConfiguredGitHubHost()}/login/oauth/authorize`);
			if (authorizationUrl.origin !== expectedGitHubUrl.origin
				|| authorizationUrl.pathname !== expectedGitHubUrl.pathname) {
				throw new Error('The authentication broker returned an insecure authorization URL.');
			}

			for (const [state, pending] of pendingProviderSignIns) {
				if (pending.expiresAt < Date.now()) {
					pendingProviderSignIns.delete(state);
				}
			}
			pendingProviderSignIns.set(clientState, { provider, expiresAt: Date.now() + 5 * 60 * 1000 });
			const opened = await vscode.env.openExternal(vscode.Uri.parse(authorizationUrl.href));
			if (!opened) {
				pendingProviderSignIns.delete(clientState);
				throw new Error('Could not open the sign-in page in your browser.');
			}
			void vscode.window.showInformationMessage(`Complete ${provider} and GitHub sign-in in your browser.`);
		} catch (error) {
			pendingProviderSignIns.delete(clientState);
			vscode.window.showErrorMessage(`${provider} sign-in failed: ${getProviderErrorMessage(error)}`);
		}
	};

	const googleSignIn = vscode.commands.registerCommand(googleSignInCommand, () => signInWithProvider('google'));
	const appleSignIn = vscode.commands.registerCommand(appleSignInCommand, () => signInWithProvider('apple'));
	const providerAccount = vscode.commands.registerCommand(providerSignInCommand, async () => {
		const selection = await vscode.window.showQuickPick([
			{ label: 'Sign in with Google', provider: 'google' as const },
			{ label: 'Sign in with Apple', provider: 'apple' as const },
			{ label: 'Clear local linked account status', provider: 'clear' as const },
		], { placeHolder: 'Manage linked provider identity' });
		if (!selection) {
			return;
		}
		if (selection.provider === 'clear') {
			await vscode.commands.executeCommand(clearProviderAccountCommand);
		} else {
			await signInWithProvider(selection.provider);
		}
	});

	const clearProviderAccount = vscode.commands.registerCommand(clearProviderAccountCommand, async () => {
		const confirmation = await vscode.window.showWarningMessage(
			'Clear the linked account shown in VS Code? This does not unlink the identity from the authentication broker.',
			{ modal: true },
			'Clear local status',
		);
		if (confirmation !== 'Clear local status') {
			return;
		}
		const host = getConfiguredGitHubHost();
		const accounts = getLinkedProviderAccounts();
		delete accounts[host];
		await context.globalState.update(linkedAccountStorageKey, accounts);
		updateProviderStatusBar();
	});

	const uriHandler = vscode.window.registerUriHandler({
		handleUri: async uri => {
			if (uri.scheme !== vscode.env.uriScheme
				|| uri.authority !== extensionAuthority
				|| uri.path !== vscodeCallbackPath) {
				return;
			}
			const params = new URLSearchParams(uri.query);
			const clientState = params.get('state');
			const pending = clientState ? pendingProviderSignIns.get(clientState) : undefined;
			if (!clientState || !pending || pending.expiresAt < Date.now()) {
				if (clientState) {
					pendingProviderSignIns.delete(clientState);
				}
				vscode.window.showErrorMessage('Sign-in response was not expected or has expired. Start again from VS Code.');
				return;
			}
			const expectedProvider = pending.provider;
			pendingProviderSignIns.delete(clientState);
			const callbackError = params.get('error');
			if (callbackError) {
				vscode.window.showErrorMessage(`${expectedProvider} sign-in failed: ${getProviderErrorMessage(callbackError)}`);
				return;
			}
			const code = params.get('code');
			if (!code) {
				vscode.window.showErrorMessage(`${expectedProvider} sign-in failed: the broker returned no authorization code.`);
				return;
			}
			try {
				const brokerUrl = getConfiguredAuthBrokerUrl();
				const response = await fetchBrokerJson(
					new URL(`${brokerUrl.href.replace(/\/$/, '')}/auth/redeem`),
					{
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ code, client_state: clientState }),
					},
				);
				const result = getBrokerAuthResult(response, expectedProvider, getConfiguredGitHubHost());
				const accounts = getLinkedProviderAccounts();
				accounts[result.githubHost] = {
					githubLogin: result.githubLogin,
					providers: result.providers,
				};
				await context.globalState.update(linkedAccountStorageKey, accounts);
				updateProviderStatusBar();
				void vscode.window.showInformationMessage(
					`${expectedProvider} identity linked to GitHub account ${result.githubLogin} on ${result.githubHost}. Git credentials remain managed by GitHub CLI.`,
				);
			} catch (error) {
				vscode.window.showErrorMessage(`${expectedProvider} sign-in failed: ${getProviderErrorMessage(error)}`);
			}
		},
	});
	context.subscriptions.push(googleSignIn, appleSignIn, providerAccount, clearProviderAccount, uriHandler);
	updateProviderStatusBar();

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
			.catch(error => {
				vscode.window.showErrorMessage(`Git sync on launch failed: ${getErrorMessage(error)}`);
			});
	}
}
