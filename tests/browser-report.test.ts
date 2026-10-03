import { afterEach, expect, it, vi } from 'vitest';
import { createBrowserReport } from '../frontend/report/browser';
import { createSteamRuntime } from '../frontend/steam/runtime';
import { createReportController } from '../frontend/report/controller';
import { createReportHistory } from '../frontend/report/history';

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
	const fetch = vi.fn(async () => ({ status: 'private' as const, data: null, fetchedAt: null }));
	const controller = createReportController({
		runtime,
		now: Date.now,
		resolveVanity: async () => '',
		fetch,
	});
	const stored = new Map<string, string>();
	const history = createReportHistory({ currentUserId: runtime.currentUserId, storage: () => ({ getItem: key => stored.get(key) ?? null, setItem: (key, value) => { stored.set(key, value); } }) });
	// Millennium serializes primitive Lua return values as JSON text.
	const browser = createBrowserReport({ runtime, controller, history, getUrl: async () => JSON.stringify('https://millennium.ftp/C%3A/Steam/static/cs2-report.html'), highlightEnabled: () => true });
	return { runtime, controller, browser, navigate, router, persona, history, fetch };
}
it('opens the local report and discovers players without scanning until Scan All is requested', async () => {
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
		expect(result.snapshot.state).toBe('ready');
		expect(result.snapshot.rows[0].providers.leetify.status).toBe('unscanned');
		await vi.advanceTimersByTimeAsync(10000);
		expect(h.fetch).not.toHaveBeenCalled();
		expect(h.history.list()).toEqual([]);
		expect(JSON.parse(h.browser.request('wrong', 'snapshot', '')).error).toBeTruthy();
		expect(JSON.parse(h.browser.request('wrong', 'scan-all', '')).error).toBeTruthy();
		h.browser.request(token, 'scan-all', '');
		await vi.advanceTimersByTimeAsync(10);
		expect(h.fetch).toHaveBeenCalledTimes(3);
		expect(JSON.parse(h.browser.request(token, 'snapshot', '')).snapshot.state).toBe('complete');
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
it('keeps an open report refreshable when backend work delays browser polling', async () => {
	const h = setup();
	try {
		await h.browser.open(h.runtime.overlayHosts()[0]);
		const old = new URL(h.navigate.mock.calls[0][0]).hash.slice(1);
		await h.browser.open(h.runtime.overlayHosts()[0]);
		expect(JSON.parse(h.browser.request(old, 'refresh', '')).error).toBeTruthy();
		const token = new URL(h.navigate.mock.calls[1][0]).hash.slice(1);
		await vi.advanceTimersByTimeAsync(120_000);
		expect(JSON.parse(h.browser.request(token, 'snapshot', '')).snapshot.rows).toHaveLength(1);
		expect(JSON.parse(h.browser.request(token, 'refresh', '')).error).toBeUndefined();
		await vi.advanceTimersByTimeAsync(10);
		expect(JSON.parse(h.browser.request(token, 'snapshot', '')).snapshot.rows).toHaveLength(1);
		h.router.BrowserWindow = null as unknown as typeof window;
		await vi.advanceTimersByTimeAsync(1000);
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
it('browses saved reports without changing the live scan or reloading stats', async () => {
	const h = setup();
	try {
		await h.browser.open(h.runtime.overlayHosts()[0]);
		const token = new URL(h.navigate.mock.calls[0][0]).hash.slice(1);
		await vi.advanceTimersByTimeAsync(10);
		h.browser.request(token, 'scan-all', '');
		await vi.advanceTimersByTimeAsync(10);
		const listing = JSON.parse(h.browser.request(token, 'history', ''));
		expect(listing.view).toBe('history');
		expect(listing.history).toHaveLength(1);
		const id = listing.history[0].id;
		const live = h.controller.getSnapshot();
		const archived = JSON.parse(h.browser.request(token, 'history-open', id));
		expect(archived.view).toBe('saved');
		expect(archived.snapshot.rows[0].player.displayName).toBe('Steam name');
		h.persona.m_strPlayerName = 'New name';
		for (const action of ['scan-all', 'refresh', 'refresh-player', 'cancel', 'replace']) h.browser.request(token, action, '76561197960265729');
		expect(h.controller.getSnapshot()).toBe(live);
		expect(JSON.parse(h.browser.request(token, 'snapshot', '')).snapshot.rows[0].player.displayName).toBe('Steam name');
		expect(JSON.parse(h.browser.request(token, 'history-live', '')).view).toBe('live');
		expect(h.controller.getSnapshot()).toBe(live);
		h.browser.request(token, 'history-delete', id);
		expect(JSON.parse(h.browser.request(token, 'history', '')).history).toEqual([]);
	} finally { h.browser.dispose(); h.controller.dispose(); }
});
