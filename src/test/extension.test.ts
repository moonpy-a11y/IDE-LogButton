import * as assert from 'assert';

import * as vscode from 'vscode';

import {
	getActiveGitHubAccount,
	getGitHubAccessState,
} from '../extension';

suite('GitHub Sign In', () => {
	test('registers sign-in, account-switch, status-refresh, and sync commands', async () => {
		const extension = vscode.extensions.all.find(candidate => candidate.packageJSON.name === 'github-sign-in');
		assert.ok(extension, 'extension should be available in the test host');
		await extension.activate();

		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes('github-sign-in.signIn'));
		assert.ok(commands.includes('github-sign-in.switchAccount'));
		assert.ok(commands.includes('github-sign-in.refresh'));
		assert.ok(commands.includes('github-sign-in.syncWorkspace'));
	});

	test('handles the active GitHub CLI account', () => {
		const state = getGitHubAccessState('octocat');

		assert.strictEqual(state.status, 'signed-in');
		assert.strictEqual(state.text, '$(github) octocat');
		assert.strictEqual(state.command, 'github-sign-in.switchAccount');
		assert.strictEqual(state.accountLabel, 'octocat');
		assert.match(state.tooltip, /Signed in to GitHub CLI as octocat/);
	});

	test('reads the active account from GitHub CLI status JSON', () => {
		const output = JSON.stringify({
			hosts: {
				'github.com': [
					{ login: 'other', active: false, state: 'success' },
					{ login: 'octocat', active: true, state: 'success' },
				],
			},
		});

		assert.strictEqual(getActiveGitHubAccount(output), 'octocat');
		assert.strictEqual(getActiveGitHubAccount(output, 'ghe.example.com'), undefined);
		assert.strictEqual(getActiveGitHubAccount(JSON.stringify({
			hosts: {
				'ghe.example.com': [{ login: 'enterprise-user', active: true, state: 'success' }],
			},
		}), 'ghe.example.com'), 'enterprise-user');
		assert.strictEqual(getActiveGitHubAccount(JSON.stringify({ hosts: {} })), undefined);
	});

	test('ignores inactive and unsuccessful GitHub CLI accounts', () => {
		const output = JSON.stringify({
			hosts: {
				'github.com': [
					{ login: 'inactive', active: false, state: 'success' },
					{ login: 'expired', active: true, state: 'error' },
				],
			},
		});

		assert.strictEqual(getActiveGitHubAccount(output), undefined);
		assert.throws(() => getActiveGitHubAccount('not-json'));
	});

	test('shows a sign-in prompt when no GitHub CLI account is active', () => {
		const state = getGitHubAccessState(undefined);

		assert.strictEqual(state.status, 'signed-out');
		assert.strictEqual(state.text, '$(github) Sign in with GitHub CLI');
		assert.strictEqual(state.command, 'github-sign-in.signIn');
		assert.match(state.tooltip, /gh auth login/);
	});

	test('identifies when GitHub CLI is not installed', () => {
		const error = Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
		const state = getGitHubAccessState(undefined, error);

		assert.strictEqual(state.status, 'unavailable');
		assert.match(state.tooltip, /Install GitHub CLI/);
	});
});
