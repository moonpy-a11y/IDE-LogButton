import * as assert from 'assert';

import * as vscode from 'vscode';


suite('GitHub Sign In', () => {
	test('registers sign-in and account-switch commands', async () => {
		const extension = vscode.extensions.all.find(candidate => candidate.packageJSON.name === 'github-sign-in');
		assert.ok(extension, 'extension should be available in the test host');
		await extension.activate();

		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes('github-sign-in.signIn'));
		assert.ok(commands.includes('github-sign-in.switchAccount'));
	});
});
