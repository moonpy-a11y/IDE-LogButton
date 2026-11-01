import * as assert from 'assert';

import * as vscode from 'vscode';

import {
	getAccessFailureReason,
	getGitHubAccessState,
} from '../extension';

suite('GitHub Sign In', () => {
	const createSession = (label: string): vscode.AuthenticationSession => ({
		id: `${label}-session`,
		accessToken: 'token',
		account: {
			id: `${label}-account`,
			label,
		},
		scopes: [],
	});

	test('registers sign-in and account-switch commands', async () => {
		const extension = vscode.extensions.all.find(candidate => candidate.packageJSON.name === 'github-sign-in');
		assert.ok(extension, 'extension should be available in the test host');
		await extension.activate();

		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes('github-sign-in.signIn'));
		assert.ok(commands.includes('github-sign-in.switchAccount'));
	});

	test('handles the happy-path signed-in state from VS Code authentication', () => {
		const session = createSession('octocat');
		const state = getGitHubAccessState(session);

		assert.strictEqual(state.status, 'signed-in');
		assert.strictEqual(state.text, '$(github) octocat');
		assert.strictEqual(state.command, 'github-sign-in.switchAccount');
		assert.strictEqual(state.accountLabel, 'octocat');
		assert.match(state.tooltip, /Signed in to GitHub as octocat/);
	});

	test('treats expired and restricted GitHub sessions as actionable auth failures', () => {
		assert.strictEqual(getAccessFailureReason(new Error('GitHub session expired')), 'expired');
		assert.strictEqual(getAccessFailureReason(new Error('Repository access restricted')), 'restricted');

		const expired = getGitHubAccessState(undefined, 'unknown', new Error('GitHub session expired'));
		const restricted = getGitHubAccessState(undefined, 'private', new Error('Repository access restricted'));

		assert.strictEqual(expired.status, 'expired');
		assert.strictEqual(expired.command, 'github-sign-in.signIn');
		assert.strictEqual(restricted.status, 'restricted');
		assert.strictEqual(restricted.command, 'github-sign-in.signIn');
		assert.strictEqual(restricted.text, '$(github) Private repo access required');
	});

	test('shows a sign-in prompt when no GitHub auth session is active', () => {
		const state = getGitHubAccessState(undefined);

		assert.strictEqual(state.status, 'signed-out');
		assert.strictEqual(state.text, '$(github) Sign in to GitHub');
		assert.strictEqual(state.command, 'github-sign-in.signIn');
		assert.match(state.tooltip, /Sign in to GitHub using VS Code authentication/);
	});
});
