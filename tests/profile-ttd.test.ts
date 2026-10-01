// @vitest-environment-options {"url":"https://steamcommunity.com/profiles/76561197960265729/"}
import { afterEach, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@steambrew/webkit', () => ({
	callable: (method: string) => () => rpc(method),
	constSysfsExpr: () => ({ content: '' }),
	Millennium: { findElement: async (root: Document, selector: string) => root.querySelectorAll(selector) },
}));
import WebkitMain from '../webkit/index';

afterEach(() => {
	vi.unstubAllGlobals();
	rpc.mockReset();
	document.body.innerHTML = '';
	document.getElementById('cs2-profile-stats-styles')?.remove();
});

it.each([
	{ ttd: 0, scope: false, suspicious: true },
	{ ttd: 474, scope: false, suspicious: true },
	{ ttd: 475, scope: false, suspicious: true },
	{ ttd: 475.01, scope: false, suspicious: false },
	{ ttd: null, scope: false, suspicious: false },
	{ ttd: -1, scope: false, suspicious: false },
	{ ttd: 475, scope: true, suspicious: false },
])('marks the profile card for $ttd ms without applying Leetify thresholds to SCOPE: $scope', async ({ ttd, scope, suspicious }) => {
	document.body.innerHTML = '<div class="profile_rightcol"></div>';
	vi.stubGlobal('fetch', vi.fn(async (input: string) => new Response(input.includes('/games')
		? '<games></games>'
		: '<profile><steamID64>76561197960265729</steamID64></profile>', { status: 200 })));
	rpc.mockImplementation(async (method: string) => {
		if (method === 'get_preferences') return JSON.stringify({ show_steam_details: false, expand_details: false });
		if (method === 'get_faceit_profile') return JSON.stringify({ status: 'not_found' });
		if (method === 'get_leetify_profile') return JSON.stringify({
			status: 'ok',
			data: {
				steam64_id: '76561197960265729', ranks: {}, rating: { aim: 80 }, recent_matches: [],
				stats: { reaction_time_ms: ttd, ...(scope ? { damage_time_min_ms: 100, damage_time_max_ms: 200 } : {}) },
			},
		});
		throw new Error(`Unexpected method: ${method}`);
	});
	await WebkitMain();
	await vi.waitFor(() => expect(document.querySelector('.cs2ps-summary-grid')).not.toBeNull());
	const metric = document.querySelector('.cs2ps-summary-grid .cs2ps-metric:nth-child(2)')!;
	expect(metric.classList.contains('cs2ps-ttd-suspicious')).toBe(suspicious);
	expect(metric.querySelector('[role=img]')?.getAttribute('aria-label') ?? '').toBe(suspicious ? 'Suspicious Time to Damage (≤ 475 ms)' : '');
	if (scope) expect(metric.textContent).toContain('AWP damage');
});
