import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { URL, URLSearchParams } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
	createRemoteJWKSet,
	customFetch,
	importPKCS8,
	jwtVerify,
	SignJWT,
} from 'jose';

const flowLifetimeMs = 5 * 60 * 1000;
const resultLifetimeMs = 60 * 1000;
const supportedProviders = new Set(['google', 'apple']);
const googleIssuer = 'https://accounts.google.com';
const appleIssuer = 'https://appleid.apple.com';
const githubApiVersion = '2022-11-28';

export function getConfig(env = process.env) {
	const githubHost = (env.GITHUB_HOST || 'github.com').trim().toLowerCase();
	if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/.test(githubHost)) {
		throw new Error('GITHUB_HOST must be a hostname without a scheme or path.');
	}

	if (!env.PUBLIC_BASE_URL) {
		throw new Error('PUBLIC_BASE_URL is required.');
	}
	const publicBaseUrl = new URL(env.PUBLIC_BASE_URL);
	if (publicBaseUrl.protocol !== 'https:' && !isLoopback(publicBaseUrl.hostname)) {
		throw new Error('PUBLIC_BASE_URL must use HTTPS except on localhost.');
	}
	if (publicBaseUrl.username || publicBaseUrl.password || publicBaseUrl.search || publicBaseUrl.hash) {
		throw new Error('PUBLIC_BASE_URL must not include credentials, a query, or a fragment.');
	}

	const callbackUri = new URL(env.VSCODE_CALLBACK_URI || 'vscode://moonpy-a11y.github-sign-in/auth-callback');
	if (!['vscode:', 'vscode-insiders:'].includes(callbackUri.protocol)) {
		throw new Error('VSCODE_CALLBACK_URI must use the VS Code URI scheme.');
	}

	const config = {
		port: Number(env.PORT || 8787),
		publicBaseUrl: publicBaseUrl.href.replace(/\/$/, ''),
		callbackUri: callbackUri.href,
		databasePath: env.DATABASE_PATH || './data/auth-links.sqlite',
		githubHost,
		githubClientId: env.GITHUB_CLIENT_ID || '',
		githubClientSecret: env.GITHUB_CLIENT_SECRET || '',
		googleClientId: env.GOOGLE_CLIENT_ID || '',
		googleClientSecret: env.GOOGLE_CLIENT_SECRET || '',
		appleClientId: env.APPLE_CLIENT_ID || '',
		appleTeamId: env.APPLE_TEAM_ID || '',
		appleKeyId: env.APPLE_KEY_ID || '',
		applePrivateKey: (env.APPLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
	};
	if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
		throw new Error('PORT must be a valid TCP port.');
	}
	for (const [name, value] of Object.entries({
		GITHUB_CLIENT_ID: config.githubClientId,
		GITHUB_CLIENT_SECRET: config.githubClientSecret,
		GOOGLE_CLIENT_ID: config.googleClientId,
		GOOGLE_CLIENT_SECRET: config.googleClientSecret,
		APPLE_CLIENT_ID: config.appleClientId,
		APPLE_TEAM_ID: config.appleTeamId,
		APPLE_KEY_ID: config.appleKeyId,
		APPLE_PRIVATE_KEY: config.applePrivateKey,
	})) {
		if (!value) {
			throw new Error(`${name} is required.`);
		}
	}
	return config;
}

function isLoopback(hostname) {
	return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function createAuthBroker(config, { fetchImpl = fetch, databasePath = config.databasePath } = {}) {
	const absoluteDatabasePath = resolve(databasePath);
	mkdirSync(dirname(absoluteDatabasePath), { recursive: true, mode: 0o700 });
	const database = new DatabaseSync(absoluteDatabasePath);
	chmodSync(absoluteDatabasePath, 0o600);
	database.exec(`
		CREATE TABLE IF NOT EXISTS identity_links (
			provider TEXT NOT NULL CHECK (provider IN ('google', 'apple')),
			provider_subject TEXT NOT NULL,
			github_host TEXT NOT NULL,
			github_id TEXT NOT NULL,
			github_login TEXT NOT NULL,
			linked_at TEXT NOT NULL,
			PRIMARY KEY (provider, provider_subject),
			UNIQUE (provider, github_host, github_id)
		)
	`);

	const githubStates = new Map();
	const providerStates = new Map();
	const pendingResults = new Map();
	const jwks = new Map();

	function json(response, status, value) {
		response.writeHead(status, {
			'content-type': 'application/json; charset=utf-8',
			'cache-control': 'no-store',
			'pragma': 'no-cache',
			'x-content-type-options': 'nosniff',
			'referrer-policy': 'no-referrer',
		});
		response.end(JSON.stringify(value));
	}

	function redirect(response, location) {
		response.writeHead(302, {
			location,
			'cache-control': 'no-store',
			'referrer-policy': 'no-referrer',
			'x-content-type-options': 'nosniff',
		});
		response.end();
	}

	function callbackUrl(params) {
		const url = new URL(config.callbackUri);
		url.search = new URLSearchParams(params).toString();
		return url.href;
	}

	function removeFlow(flow) {
		githubStates.delete(flow.githubState);
		if (flow.providerState) {
			providerStates.delete(flow.providerState);
		}
	}

	function failFlow(response, flow, error) {
		removeFlow(flow);
		redirect(response, callbackUrl({ state: flow.clientState, error }));
	}

	function githubAuthorizeUrl(state) {
		const url = new URL(`https://${config.githubHost}/login/oauth/authorize`);
		url.search = new URLSearchParams({
			client_id: config.githubClientId,
			redirect_uri: `${config.publicBaseUrl}/oauth/github/callback`,
			scope: 'read:user',
			state,
		}).toString();
		return url.href;
	}

	function providerAuthorizeUrl(flow) {
		const url = flow.provider === 'google'
			? new URL('https://accounts.google.com/o/oauth2/v2/auth')
			: new URL('https://appleid.apple.com/auth/authorize');
		const params = {
			client_id: flow.provider === 'google' ? config.googleClientId : config.appleClientId,
			redirect_uri: `${config.publicBaseUrl}/oauth/${flow.provider}/callback`,
			response_type: 'code',
			scope: flow.provider === 'google' ? 'openid email profile' : 'openid email',
			state: flow.providerState,
			nonce: flow.nonce,
		};
		if (flow.provider === 'apple') {
			params.response_mode = 'form_post';
		}
		url.search = new URLSearchParams(params).toString();
		return url.href;
	}

	async function exchangeGitHubCode(code) {
		const response = await fetchImpl(`https://${config.githubHost}/login/oauth/access_token`, {
			method: 'POST',
			headers: { accept: 'application/json', 'content-type': 'application/json' },
			body: JSON.stringify({
				client_id: config.githubClientId,
				client_secret: config.githubClientSecret,
				code,
				redirect_uri: `${config.publicBaseUrl}/oauth/github/callback`,
			}),
			signal: AbortSignal.timeout(10_000),
		});
		const body = await response.json();
		if (!response.ok || typeof body.access_token !== 'string') {
			throw new Error('GitHub authorization could not be completed.');
		}
		return body.access_token;
	}

	async function getGitHubUser(accessToken) {
		const apiBase = config.githubHost === 'github.com'
			? 'https://api.github.com'
			: `https://${config.githubHost}/api/v3`;
		const response = await fetchImpl(`${apiBase}/user`, {
			headers: {
				accept: 'application/vnd.github+json',
				authorization: `Bearer ${accessToken}`,
				'X-GitHub-Api-Version': githubApiVersion,
				'user-agent': 'IDE-LogButton-auth-broker',
			},
			signal: AbortSignal.timeout(10_000),
		});
		const user = await response.json();
		if (!response.ok || (typeof user.id !== 'number' && typeof user.id !== 'string')
			|| typeof user.login !== 'string') {
			throw new Error('GitHub did not return a valid account.');
		}
		return { id: String(user.id), login: user.login };
	}

	async function createAppleClientSecret() {
		return new SignJWT({})
			.setProtectedHeader({ alg: 'ES256', kid: config.appleKeyId })
			.setIssuer(config.appleTeamId)
			.setIssuedAt()
			.setExpirationTime('5m')
			.setAudience(appleIssuer)
			.setSubject(config.appleClientId)
			.sign(await importPKCS8(config.applePrivateKey, 'ES256'));
	}

	async function exchangeProviderCode(flow, code) {
		const endpoint = flow.provider === 'google'
			? 'https://oauth2.googleapis.com/token'
			: 'https://appleid.apple.com/auth/token';
		const params = new URLSearchParams({
			client_id: flow.provider === 'google' ? config.googleClientId : config.appleClientId,
			client_secret: flow.provider === 'google' ? config.googleClientSecret : await createAppleClientSecret(),
			code,
			grant_type: 'authorization_code',
			redirect_uri: `${config.publicBaseUrl}/oauth/${flow.provider}/callback`,
		});
		const response = await fetchImpl(endpoint, {
			method: 'POST',
			headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
			body: params,
			signal: AbortSignal.timeout(10_000),
		});
		const body = await response.json();
		if (!response.ok || typeof body.id_token !== 'string') {
			throw new Error(`${flow.provider} authorization could not be completed.`);
		}
		return body.id_token;
	}

	async function verifyProviderIdentity(provider, token, nonce) {
		const issuer = provider === 'google' ? googleIssuer : appleIssuer;
		const audience = provider === 'google' ? config.googleClientId : config.appleClientId;
		const jwksUrl = provider === 'google'
			? new URL('https://www.googleapis.com/oauth2/v3/certs')
			: new URL('https://appleid.apple.com/auth/keys');
		let keySet = jwks.get(provider);
		if (!keySet) {
			keySet = createRemoteJWKSet(jwksUrl, { [customFetch]: fetchImpl });
			jwks.set(provider, keySet);
		}
		const { payload } = await jwtVerify(token, keySet, {
			issuer: provider === 'google' ? [issuer, 'accounts.google.com'] : issuer,
			audience,
			algorithms: ['RS256'],
		});
		if (typeof payload.sub !== 'string' || payload.nonce !== nonce) {
			throw new Error('The identity provider returned an invalid account or nonce.');
		}
		if (provider === 'google' && payload.email_verified !== true) {
			throw new Error('The Google account must have a verified email address.');
		}
		return payload.sub;
	}

	function saveIdentityLink(flow, subject) {
		const existing = database.prepare(
			'SELECT github_host, github_id FROM identity_links WHERE provider = ? AND provider_subject = ?',
		).get(flow.provider, subject);
		if (existing && (existing.github_host !== config.githubHost || existing.github_id !== flow.githubUser.id)) {
			throw new Error('identity_link_conflict');
		}
		try {
			database.prepare(`
				INSERT INTO identity_links (provider, provider_subject, github_host, github_id, github_login, linked_at)
				VALUES (?, ?, ?, ?, ?, ?)
				ON CONFLICT (provider, provider_subject) DO UPDATE SET
					github_login = excluded.github_login,
					linked_at = excluded.linked_at
			`).run(
				flow.provider,
				subject,
				config.githubHost,
				flow.githubUser.id,
				flow.githubUser.login,
				new Date().toISOString(),
			);
		} catch (error) {
			if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) {
				throw new Error('identity_link_conflict');
			}
			throw error;
		}
		return database.prepare(
			'SELECT provider FROM identity_links WHERE github_host = ? AND github_id = ? ORDER BY provider',
		).all(config.githubHost, flow.githubUser.id).map(row => row.provider);
	}

	async function handleStart(request, response, requestUrl) {
		if (request.method !== 'GET') {
			json(response, 405, { error: 'method_not_allowed' });
			return;
		}
		const provider = requestUrl.searchParams.get('provider');
		const clientState = requestUrl.searchParams.get('client_state');
		const host = requestUrl.searchParams.get('host')?.toLowerCase();
		if (!supportedProviders.has(provider) || !/^[A-Za-z0-9_-]{32,128}$/.test(clientState || '')) {
			json(response, 400, { error: 'invalid_auth_request' });
			return;
		}
		if (host !== config.githubHost) {
			json(response, 400, { error: 'github_host_mismatch', expected_host: config.githubHost });
			return;
		}
		const flow = {
			provider,
			clientState,
			githubState: randomBytes(32).toString('base64url'),
			createdAt: Date.now(),
		};
		githubStates.set(flow.githubState, flow);
		json(response, 200, { authorizationUrl: githubAuthorizeUrl(flow.githubState) });
	}

	async function handleGitHubCallback(response, requestUrl) {
		const state = requestUrl.searchParams.get('state');
		const flow = githubStates.get(state);
		if (!flow) {
			json(response, 400, { error: 'invalid_or_expired_state' });
			return;
		}
		if (requestUrl.searchParams.has('error') || !requestUrl.searchParams.get('code')) {
			failFlow(response, flow, 'github_sign_in_cancelled');
			return;
		}
		try {
			const token = await exchangeGitHubCode(requestUrl.searchParams.get('code'));
			flow.githubUser = await getGitHubUser(token);
			flow.providerState = randomBytes(32).toString('base64url');
			flow.nonce = randomBytes(32).toString('base64url');
			providerStates.set(flow.providerState, flow);
			githubStates.delete(flow.githubState);
			redirect(response, providerAuthorizeUrl(flow));
		} catch (error) {
			console.error('GitHub account verification failed:', error instanceof Error ? error.message : 'unknown error');
			failFlow(response, flow, 'github_verification_failed');
		}
	}

	async function handleProviderCallback(request, response, requestUrl, provider) {
		const params = request.method === 'POST'
			? new URLSearchParams(await readBody(request))
			: requestUrl.searchParams;
		const state = params.get('state');
		const flow = providerStates.get(state);
		if (!flow || flow.provider !== provider) {
			json(response, 400, { error: 'invalid_or_expired_state' });
			return;
		}
		if (params.has('error') || !params.get('code')) {
			failFlow(response, flow, `${provider}_sign_in_cancelled`);
			return;
		}
		try {
			const token = await exchangeProviderCode(flow, params.get('code'));
			const subject = await verifyProviderIdentity(provider, token, flow.nonce);
			const providers = saveIdentityLink(flow, subject);
			const code = randomBytes(32).toString('base64url');
			pendingResults.set(code, {
				clientState: flow.clientState,
				provider,
				githubHost: config.githubHost,
				githubLogin: flow.githubUser.login,
				providers,
				expiresAt: Date.now() + resultLifetimeMs,
			});
			removeFlow(flow);
			redirect(response, callbackUrl({ state: flow.clientState, code }));
		} catch (error) {
			const conflict = error instanceof Error && error.message === 'identity_link_conflict';
			console.error(`${provider} account linking failed:`, conflict ? 'identity link conflict' : 'provider verification failed');
			failFlow(response, flow, conflict ? 'identity_already_linked' : `${provider}_verification_failed`);
		}
	}

	async function handleRedeem(request, response) {
		if (request.method !== 'POST') {
			json(response, 405, { error: 'method_not_allowed' });
			return;
		}
		let body;
		try {
			body = JSON.parse(await readBody(request));
		} catch {
			json(response, 400, { error: 'invalid_request_body' });
			return;
		}
		if (typeof body.code !== 'string' || typeof body.client_state !== 'string') {
			json(response, 400, { error: 'invalid_auth_code' });
			return;
		}
		const result = pendingResults.get(body.code);
		pendingResults.delete(body.code);
		if (!result || result.expiresAt < Date.now() || !constantTimeEqual(result.clientState, body.client_state)) {
			json(response, 400, { error: 'invalid_or_expired_auth_code' });
			return;
		}
		json(response, 200, {
			provider: result.provider,
			githubHost: result.githubHost,
			githubLogin: result.githubLogin,
			providers: result.providers,
		});
	}

	const server = createServer(async (request, response) => {
		try {
			const requestUrl = new URL(request.url || '/', 'http://localhost');
			if (requestUrl.pathname === '/healthz' && request.method === 'GET') {
				json(response, 200, { status: 'ok' });
			} else if (requestUrl.pathname === '/auth/start') {
				await handleStart(request, response, requestUrl);
			} else if (requestUrl.pathname === '/oauth/github/callback' && request.method === 'GET') {
				await handleGitHubCallback(response, requestUrl);
			} else if (requestUrl.pathname === '/oauth/google/callback') {
				await handleProviderCallback(request, response, requestUrl, 'google');
			} else if (requestUrl.pathname === '/oauth/apple/callback') {
				await handleProviderCallback(request, response, requestUrl, 'apple');
			} else if (requestUrl.pathname === '/auth/redeem') {
				await handleRedeem(request, response);
			} else {
				json(response, 404, { error: 'not_found' });
			}
		} catch (error) {
			console.error('Auth broker request failed:', error instanceof Error ? error.message : 'unknown error');
			json(response, 500, { error: 'authentication_service_error' });
		}
	});

	const cleanup = setInterval(() => {
		const now = Date.now();
		for (const [state, flow] of githubStates) {
			if (now - flow.createdAt > flowLifetimeMs) {
				githubStates.delete(state);
			}
		}
		for (const [state, flow] of providerStates) {
			if (now - flow.createdAt > flowLifetimeMs) {
				providerStates.delete(state);
			}
		}
		for (const [code, result] of pendingResults) {
			if (result.expiresAt < now) {
				pendingResults.delete(code);
			}
		}
	}, 30_000);
	cleanup.unref();
	server.on('close', () => {
		clearInterval(cleanup);
		database.close();
	});

	return server;
}

async function readBody(request) {
	let body = '';
	for await (const chunk of request) {
		body += chunk;
		if (body.length > 16_384) {
			throw new Error('Request body is too large.');
		}
	}
	return body;
}

function constantTimeEqual(left, right) {
	const leftBuffer = Buffer.from(left);
	const rightBuffer = Buffer.from(right);
	return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const config = getConfig();
	const server = createAuthBroker(config);
	server.listen(config.port, () => {
		console.info(`Authentication broker listening on port ${config.port}.`);
	});
}
