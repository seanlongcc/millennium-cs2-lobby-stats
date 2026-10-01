import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

it('production frontend binds backend calls to the packaged plugin identity', () => {
	const { name } = JSON.parse(readFileSync('plugin.json', 'utf8'));
	const calls: unknown[][] = [];
	const api = {
		callable: (...args: unknown[]) => {
			calls.push(args);
			return () => Promise.resolve('');
		},
		// Inspect module registration without mounting Steam UI in this build smoke test.
		definePlugin: () => () => ({}),
	};
	runInNewContext(readFileSync('.millennium/Dist/index.js', 'utf8'), {
		window: { MILLENNIUM_API: api, SP_REACT: { Component: class {} }, SP_REACTDOM: {} },
		SP_JSX_FACTORY: {},
		MILLENNIUM_BACKEND_IPC: { postMessage: () => {} },
	});
	expect(calls).toEqual([
		[name, 'get_report_provider'],
		[name, 'resolve_steam_profile'],
		[name, 'get_report_browser_url'],
	]);
});
