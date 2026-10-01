import { afterEach, expect, it, vi } from 'vitest';
import { createBrowserReport } from '../frontend/report/browser';
import { createSteamRuntime } from '../frontend/steam/runtime';
import { createReportController } from '../frontend/report/controller';

afterEach(() => vi.useRealTimers());
function setup() {
	vi.useFakeTimers();
	const navigate = vi.fn();
	const persona = {
		m_strPlayerName: 'Steam name',
		avatar_url_medium: `https://avatars.steamstatic.com/${'a'.repeat(40)}_medium.jpg`,
		m_unGamePlayedAppID: 730,
		m_mapRichPresence: new Map([['game:state', 'game'], ['game:mode', 'deathmatch']]),
	};
	const router = { BrowserWindow: window, params: { browserInfo: { m_unAppID: 730 } }, NavigateToSteamWeb: navigate };
	const runtime = createSteamRuntime({
		App: { m_CurrentUser: { strSteamID: '76561197960265729' } },
		friendStore: { GetFriendState: () => ({ persona }) },
		Router: { WindowStore: { OverlayWindows: [router] } },
		SteamClient: {
			Friends: { GetCoplayData: async () => ({ currentUsers: [{ appid: 730, accountid: 1 }] }) },
			Overlay: { RegisterForOverlayActivated: () => ({ unregister() {} }) },
			GameSessions: { RegisterForAppLifetimeNotifications: () => ({ unregister() {} }) },
		},
	});
	const controller = createReportController({
		runtime,
		now: Date.now,
		resolveVanity: async () => '',
		fetch: async () => ({ status: 'private', data: null, fetchedAt: null }),
	});
	// Millennium serializes primitive Lua return values as JSON text.
	const browser = createBrowserReport({ runtime, controller, getUrl: async () => JSON.stringify('https://millennium.ftp/C%3A/Steam/static/cs2-report.html'), highlightEnabled: () => true });
	return { runtime, controller, browser, navigate, router, persona };
}
it('opens the local report in the clicked CS2 overlay browser and shares the real scan', async () => {
	const h = setup();
	try {
		await h.browser.open(h.runtime.overlayHosts()[0]);
		expect(h.navigate).toHaveBeenCalledTimes(1);
		const url = new URL(h.navigate.mock.calls[0][0]);
		expect(url.origin).toBe('https://millennium.ftp');
		const token = url.hash.slice(1);
		expect(token).toMatch(/^[a-f0-9-]{36}$/);
		await vi.advanceTimersByTimeAsync(10);
		const result = JSON.parse(h.browser.request(token, 'snapshot', ''));
		expect(result.snapshot.rows).toHaveLength(1);
		expect(result.snapshot.rows[0].player.steamId).toBe('76561197960265729');
		expect(result.snapshot.rows[0].player.displayName).toBe('Steam name');
		expect(result.snapshot.rows[0].player.avatarUrl).toBe(`https://avatars.steamstatic.com/${'a'.repeat(40)}_medium.jpg`);
		expect(result.highlightEnabled).toBe(true);
		expect(JSON.parse(h.browser.request('wrong', 'snapshot', '')).error).toBeTruthy();
		h.browser.request(token, 'close', '');
		expect(JSON.parse(h.browser.request(token, 'snapshot', '')).error).toBeTruthy();
	} finally {
		h.browser.dispose();
		h.controller.dispose();
	}
});
it('refreshes delayed Steam avatars and routes manual replacement without keeping old players', async () => {
	const h = setup();
	try {
		await h.browser.open(h.runtime.overlayHosts()[0]);
		const token = new URL(h.navigate.mock.calls[0][0]).hash.slice(1);
		await vi.advanceTimersByTimeAsync(10);
		h.persona.avatar_url_medium = '';
		expect(JSON.parse(h.browser.request(token, 'snapshot', '')).snapshot.rows[0].player.avatarUrl).toBeUndefined();
		h.persona.avatar_url_medium = `https://avatars.steamstatic.com/${'b'.repeat(40)}_medium.jpg`;
		expect(JSON.parse(h.browser.request(token, 'snapshot', '')).snapshot.rows[0].player.avatarUrl).toBe(h.persona.avatar_url_medium);
		h.browser.request(token, 'replace', 'https://steamcommunity.com/profiles/76561199249862155/');
		await vi.advanceTimersByTimeAsync(10);
		const result = JSON.parse(h.browser.request(token, 'snapshot', ''));
		expect(result.snapshot.rows.map((r: any) => r.player.steamId)).toEqual(['76561199249862155']);
	} finally {
		h.browser.dispose();
		h.controller.dispose();
	}
});
it('reports unavailable browser routing without creating a modal or starting provider work', async () => {
	const h = setup();
	try {
		(h.router as any).NavigateToSteamWeb = undefined;
		await expect(h.browser.open(h.runtime.overlayHosts()[0])).rejects.toThrow(/browser/i);
		expect(h.controller.getSnapshot().rows).toHaveLength(0);
	} finally {
		h.browser.dispose();
		h.controller.dispose();
	}
});
it('expires a closed or unloaded browser and invalidates the preceding tab on another scan', async () => {
	const h = setup();
	try {
		await h.browser.open(h.runtime.overlayHosts()[0]);
		const old = new URL(h.navigate.mock.calls[0][0]).hash.slice(1);
		await h.browser.open(h.runtime.overlayHosts()[0]);
		expect(JSON.parse(h.browser.request(old, 'refresh', '')).error).toBeTruthy();
		const token = new URL(h.navigate.mock.calls[1][0]).hash.slice(1);
		await vi.advanceTimersByTimeAsync(31_000);
		expect(JSON.parse(h.browser.request(token, 'snapshot', '')).error).toBeTruthy();
	} finally {
		h.browser.dispose();
		h.controller.dispose();
	}
});
it('routes a player refresh to the existing report without reopening or rescanning it', async () => {
	const h = setup();
	try {
		await h.browser.open(h.runtime.overlayHosts()[0]);
		const token = new URL(h.navigate.mock.calls[0][0]).hash.slice(1);
		await vi.advanceTimersByTimeAsync(10);
		const before = JSON.parse(h.browser.request(token, 'snapshot', '')).snapshot;
		const result = JSON.parse(h.browser.request(token, 'refresh-player', '76561197960265729'));
		expect(result.error).toBeUndefined();
		expect(result.snapshot.id).toBe(before.id);
		expect(result.snapshot.roster).toEqual(before.roster);
		expect(result.snapshot.rows[0].providers.leetify.status).toBe('loading');
		expect(h.navigate).toHaveBeenCalledTimes(1);
	} finally { h.browser.dispose(); h.controller.dispose(); }
});
