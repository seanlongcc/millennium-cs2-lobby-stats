// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { ProviderRequestError } from '../frontend/report/providers';
import { createReportController } from '../frontend/report/controller';
import type { Metrics, Provider, ProviderResult } from '../shared/report';
import type { SteamRuntime } from '../frontend/steam/runtime';
type Result = ProviderResult<Partial<Metrics>>;
const ok = (data: Partial<Metrics> = {}): Result => ({ status: 'ok', data, fetchedAt: 1000 });
const flush = async () => {
	for (let i = 0; i < 12; i++) await Promise.resolve();
};
const cleanups: (() => void)[] = [];
afterEach(() => {
	cleanups.splice(0).forEach((fn) => fn());
	vi.useRealTimers();
});
function harness(count = 3) {
	vi.useFakeTimers();
	vi.setSystemTime(1000);
	let roster = { currentUsers: Array.from({ length: count }, (_, i) => ({ appid: 730, accountid: i + 1 })) };
	let user: string | null = null;
	let activation: (active: boolean) => void = () => {},
		exit: () => void = () => {};
	const runtime: SteamRuntime = {
		readCoplay: vi.fn(async () => roster),
		currentUserId: () => user,
		overlayHosts: () => [],
		onOverlayActive: (cb) => {
			activation = cb;
			return () => {};
		},
		onAppExit: (cb) => {
			exit = cb;
			return () => {};
		},
	};
	const jobs: { provider: Provider; id: string; resolve: (r: Result) => void; done: boolean }[] = [];
	let active = 0,
		max = 0;
	const fetch = vi.fn((provider: Provider, id: string) => {
		active++;
		max = Math.max(max, active);
		return new Promise<Result>((resolve) => {
			const job = {
				provider,
				id,
				done: false,
				resolve: (r: Result) => {
					active--;
					job.done = true;
					resolve(r);
				},
			};
			jobs.push(job);
		});
	});
	let resolver: (name: string) => Promise<string> = async () => '76561197960265799';
	const controller = createReportController({ runtime, fetch, resolveVanity: (name) => resolver(name), now: () => Date.now() });
	cleanups.push(() => controller.dispose());
	return {
		resolveWith: (next: typeof resolver) => {
			resolver = next;
		},
		controller,
		jobs,
		fetch,
		runtime,
		activation: (v: boolean) => activation(v),
		exit: () => exit(),
		setUser: (v: string) => {
			user = v;
		},
		roster: (ids: number[]) => {
			roster = { currentUsers: ids.map((accountid) => ({ appid: 730, accountid })) };
		},
		max: () => max,
	};
}
it('loads players without provider work, including after polling and overlay resume', async () => {
	const h = harness(2);
	await h.controller.loadRoster();
	expect(h.controller.getSnapshot().state).toBe('ready');
	expect(h.controller.getSnapshot().rows).toHaveLength(2);
	expect(h.controller.getSnapshot().rows.every(row => Object.values(row.providers).every(p => p.status === 'unscanned'))).toBe(true);
	await vi.advanceTimersByTimeAsync(10000);
	h.activation(false);
	h.activation(true);
	await flush();
	expect(h.fetch).not.toHaveBeenCalled();
});
it('Scan All scans the displayed manual roster once without recapturing Steam players', async () => {
	const h = harness(2);
	await h.controller.loadRoster();
	await h.controller.addProfiles('[U:1:90]', 'replace');
	expect(h.fetch).not.toHaveBeenCalled();
	const rosterReads = vi.mocked(h.runtime.readCoplay).mock.calls.length;
	h.controller.scanAll();
	h.controller.scanAll();
	for (let i = 0; i < 6; i++) {
		await flush();
		for (const job of h.jobs.filter(j => !j.done)) job.resolve(ok());
	}
	await flush();
	expect(h.jobs.map(j => [j.id, j.provider])).toEqual([
		['76561197960265818', 'leetify'], ['76561197960265818', 'faceit'], ['76561197960265818', 'steam'],
	]);
	expect(h.runtime.readCoplay).toHaveBeenCalledTimes(rosterReads);
	expect(h.controller.getSnapshot().state).toBe('complete');
});
it('does not scan an empty, stale, hidden or closed roster', async () => {
	const h = harness(0);
	await h.controller.loadRoster();
	h.controller.scanAll();
	h.roster([1]);
	await h.controller.loadRoster();
	h.activation(false);
	h.controller.scanAll();
	h.activation(true);
	await flush();
	h.roster([2]);
	await vi.advanceTimersByTimeAsync(5000);
	expect(h.controller.getSnapshot().state).toBe('stale');
	h.controller.scanAll();
	h.controller.close();
	h.controller.scanAll();
	await flush();
	expect(h.fetch).not.toHaveBeenCalled();
});
it('caps actual outstanding work at two and one per provider through refresh and completion', async () => {
	const h = harness();
	await h.controller.scan();
	expect(h.jobs).toHaveLength(2);
	expect(new Set(h.jobs.map((j) => j.provider)).size).toBe(2);
	for (let i = 0; i < 15; i++) {
		const pending = h.jobs.filter((j) => !j.done);
		expect(new Set(pending.map((j) => j.provider)).size).toBe(pending.length);
		for (const j of pending) j.resolve(ok());
		await flush();
	}
	expect(h.max()).toBe(2);
	expect(h.jobs).toHaveLength(9);
	expect(h.controller.getSnapshot().state).toBe('complete');
});
it('never applies old results to a new scan and expires manual entries on refresh', async () => {
	const h = harness(1);
	await h.controller.scan();
	const old = h.controller.getSnapshot().id;
	await h.controller.addProfiles('[U:1:99]');
	expect(h.controller.getSnapshot().rows).toHaveLength(2);
	h.roster([2]);
	await h.controller.scan();
	const id = h.controller.getSnapshot().id;
	expect(id).toBeGreaterThan(old);
	h.jobs[0].resolve(ok({ name: 'Old', recentKd: 9, recentMatches: 50 }));
	await flush();
	expect(h.controller.getSnapshot().id).toBe(id);
	expect(h.controller.getSnapshot().rows.map((r) => r.player.steamId)).toEqual(['76561197960265730']);
	expect(h.controller.getSnapshot().rows[0].metrics.name).toBeNull();
});
it('uses a new scan ID for an identical roster and deduplicates unfinished keys', async () => {
	const h = harness(1);
	await h.controller.scan();
	const old = h.controller.getSnapshot().id;
	await h.controller.scan();
	expect(h.controller.getSnapshot().id).toBeGreaterThan(old);
	expect(h.jobs).toHaveLength(2);
});
it('replaces stale Steam players with a manual roster and keeps it through polling and overlay resume', async () => {
	const h = harness(2);
	await h.controller.scan();
	await h.controller.addProfiles('https://steamcommunity.com/profiles/76561199249862155/', 'replace');
	expect(h.controller.getSnapshot().rows.map((r) => r.player.steamId)).toEqual(['76561199249862155']);
	h.roster([3, 4]);
	await vi.advanceTimersByTimeAsync(5000);
	expect(h.controller.getSnapshot().state).not.toBe('stale');
	h.activation(false);
	h.activation(true);
	await flush();
	expect(h.controller.getSnapshot().state).not.toBe('stale');
	await h.controller.addProfiles('[U:1:90]');
	expect(h.controller.getSnapshot().rows).toHaveLength(2);
	await h.controller.scan();
	expect(h.controller.getSnapshot().rows.map((r) => r.player.steamId)).toEqual(['76561197960265731', '76561197960265732']);
});
it('does not clear the existing roster when replacement input is empty or invalid', async () => {
	const h = harness(1);
	await h.controller.scan();
	await h.controller.addProfiles('', 'replace');
	expect(h.controller.getSnapshot().rows).toHaveLength(1);
	expect(h.controller.getSnapshot().inputErrors?.length).toBeGreaterThan(0);
	await h.controller.addProfiles('https://example.com/no-player', 'replace');
	expect(h.controller.getSnapshot().rows).toHaveLength(1);
});
it('holds timed-out IPC slots until promises actually settle, even after close and reopen', async () => {
	const h = harness();
	await h.controller.scan();
	await vi.advanceTimersByTimeAsync(45000);
	expect(h.jobs).toHaveLength(2);
	expect(h.controller.getSnapshot().rows[0].providers.leetify.status).toBe('error');
	h.controller.close();
	expect(h.controller.getSnapshot().rows).toHaveLength(0);
	await h.controller.scan();
	expect(h.jobs).toHaveLength(2);
	h.jobs[0].resolve(ok());
	await flush();
	expect(h.jobs).toHaveLength(2);
	await h.controller.scan();
	expect(h.jobs).toHaveLength(3);
	expect(h.max()).toBe(2);
});
it('cancels queued work and discards running responses', async () => {
	const h = harness();
	await h.controller.scan();
	h.controller.cancel();
	for (const j of h.jobs) j.resolve(ok({ name: 'Ignored' }));
	await flush();
	expect(h.jobs).toHaveLength(2);
	expect(h.controller.getSnapshot().state).toBe('canceled');
	expect(h.controller.getSnapshot().rows[0].metrics.name).toBeNull();
});
it('shares cooldowns across refresh while allowing other providers and never automatically retries', async () => {
	const h = harness();
	await h.controller.scan();
	h.jobs.find((j) => j.provider === 'leetify')!.resolve({ status: 'rate_limited', data: null, fetchedAt: null, retryAfterMs: 60000 });
	await flush();
	expect(h.controller.getSnapshot().rows.every((r) => r.providers.leetify.status === 'rate_limited')).toBe(true);
	h.jobs.find((j) => j.provider === 'faceit')!.resolve(ok({ faceitElo: 1800 }));
	await flush();
	expect(h.controller.getSnapshot().rows[0].metrics.faceitElo).toBe(1800);
	await h.controller.scan();
	expect(h.controller.getSnapshot().rows.every((r) => r.providers.leetify.status === 'rate_limited')).toBe(true);
	await vi.advanceTimersByTimeAsync(61000);
	expect(h.jobs.filter((j) => j.provider === 'leetify')).toHaveLength(1);
});
it('pauses hidden work and validates roster before accepting buffered results', async () => {
	const h = harness();
	await h.controller.scan();
	h.activation(false);
	h.jobs[0].resolve(ok({ name: 'Hidden' }));
	await flush();
	expect(h.jobs).toHaveLength(2);
	expect(h.controller.getSnapshot().rows[0].metrics.name).toBeNull();
	h.roster([20]);
	h.activation(true);
	await flush();
	expect(h.controller.getSnapshot().state).toBe('stale');
	expect(h.controller.getSnapshot().rows[0].metrics.name).toBeNull();
	expect(h.jobs).toHaveLength(2);
});
it('accepts buffered results only after unchanged-roster resume', async () => {
	const h = harness(1);
	await h.controller.scan();
	h.activation(false);
	h.jobs[0].resolve(ok({ name: 'Current' }));
	await flush();
	h.activation(true);
	await flush();
	expect(h.controller.getSnapshot().rows[0].metrics.name).toBe('Current');
});
it('marks membership changes stale without automatic stats scans', async () => {
	const h = harness();
	await h.controller.scan();
	h.roster([8]);
	await vi.advanceTimersByTimeAsync(5000);
	expect(h.controller.getSnapshot().state).toBe('stale');
	expect(h.jobs).toHaveLength(2);
});
it('invalidates on app exit and checks signed-in identity before accepting results', async () => {
	const h = harness(1);
	await h.controller.scan();
	h.setUser('76561197960265790');
	h.jobs[0].resolve(ok({ name: 'Wrong account' }));
	await flush();
	expect(h.controller.getSnapshot().rows).toHaveLength(0);
	await h.controller.scan();
	h.exit();
	expect(h.controller.getSnapshot().rows).toHaveLength(0);
});
it('keeps provider failures isolated and name precedence independent of response order', async () => {
	const h = harness(1);
	await h.controller.scan();
	h.jobs[1].resolve(ok({ name: 'FACEIT', faceitKd: 5 }));
	await flush();
	h.jobs[0].resolve(ok({ name: 'Leetify', leetifyAim: 95, recentKd: 1, recentMatches: 20 }));
	await flush();
	h.jobs.find((j) => j.provider === 'steam')!.resolve({ status: 'private', data: null, fetchedAt: null });
	await flush();
	expect(h.controller.getSnapshot().rows[0].metrics).toMatchObject({ name: 'Leetify', leetifyAim: 95, faceitKd: 5 });
	expect(h.controller.getSnapshot().rows[0].assessment.label).toBe('no_flags');
});
it('never overlaps unresolved roster reads and removes deadlines on unload', async () => {
	const h = harness();
	h.runtime.readCoplay = vi.fn(() => new Promise(() => {}));
	const first = h.controller.scan();
	await flush();
	await vi.advanceTimersByTimeAsync(5000);
	await first;
	const refresh = h.controller.scan();
	await vi.advanceTimersByTimeAsync(5000);
	await refresh;
	expect(h.runtime.readCoplay).toHaveBeenCalledTimes(1);
	expect(h.controller.getSnapshot().state).toBe('error');
	h.controller.dispose();
	expect(vi.getTimerCount()).toBe(0);
});
it('removes an in-progress roster deadline when disposed before Steam answers', async () => {
	const h = harness();
	h.runtime.readCoplay = () => new Promise(() => {});
	void h.controller.scan();
	await flush();
	h.controller.dispose();
	expect(vi.getTimerCount()).toBe(0);
});
it.each(['close', 'dispose', 'cancel', 'hide', 'refresh', 'exit'] as const)('stops queued vanity IPC after %s', async (action) => {
	const h = harness(0);
	const raw: ((value: string) => void)[] = [];
	const resolve = vi.fn(() => new Promise<string>((done) => raw.push(done)));
	h.resolveWith(resolve);
	await h.controller.scan();
	const add = h.controller.addProfiles('https://steamcommunity.com/id/one https://steamcommunity.com/id/two https://steamcommunity.com/id/three');
	await flush();
	if (action === 'hide') h.activation(false);
	else if (action === 'refresh') await h.controller.scan();
	else if (action === 'exit') h.exit();
	else h.controller[action]();
	for (const done of raw) done('76561197960265790');
	await add;
	await flush();
	expect(resolve.mock.calls.length).toBeLessThanOrEqual(2);
	expect(h.controller.getSnapshot().rows).toHaveLength(0);
});
it('shares the two actual IPC slots and Steam lane between providers and vanity resolution', async () => {
	const h = harness(1);
	const raw: ((value: string) => void)[] = [];
	const resolve = vi.fn(() => new Promise<string>((done) => raw.push(done)));
	h.resolveWith(resolve);
	await h.controller.scan();
	const add = h.controller.addProfiles('https://steamcommunity.com/id/one');
	await flush();
	expect(resolve).not.toHaveBeenCalled();
	h.jobs[0].resolve(ok());
	await flush();
	expect(resolve).toHaveBeenCalledTimes(1);
	await h.controller.scan();
	expect(h.jobs.filter((j) => !j.done).length + raw.length).toBe(2);
	h.controller.close();
	raw[0]('76561197960265790');
	await add;
	await flush();
	expect(h.jobs).toHaveLength(2);
});
it('shares Steam cooldowns with vanity lookups and does not dispatch later names after a vanity 429', async () => {
	const h = harness(0);
	const resolve = vi.fn(async () => {
		throw new ProviderRequestError('rate_limited', 'Steam rate limited.', 120000);
	});
	h.resolveWith(resolve);
	await h.controller.scan();
	await h.controller.addProfiles('https://steamcommunity.com/id/one https://steamcommunity.com/id/two https://steamcommunity.com/id/three');
	expect(resolve).toHaveBeenCalledTimes(1);
	await h.controller.addProfiles('[U:1:90]');
	h.controller.scanAll();
	expect(h.controller.getSnapshot().rows[0].providers.steam.status).toBe('rate_limited');
	await h.controller.addProfiles('https://steamcommunity.com/id/four');
	expect(resolve).toHaveBeenCalledTimes(1);
	await vi.advanceTimersByTimeAsync(130000);
	expect(resolve).toHaveBeenCalledTimes(1);
});
it('requires refresh before manual additions to a known-stale roster', async () => {
	const h = harness(1);
	await h.controller.scan();
	h.roster([2]);
	await vi.advanceTimersByTimeAsync(5000);
	expect(h.controller.getSnapshot().state).toBe('stale');
	await h.controller.addProfiles('[U:1:99]');
	expect(h.controller.getSnapshot().state).toBe('stale');
	expect(h.controller.getSnapshot().inputErrors?.join(' ')).toMatch(/refresh/i);
	expect(h.jobs).toHaveLength(2);
});
it('blocks lookup work when required Steam lifecycle support is missing', async () => {
	const h = harness(1);
	h.runtime.canRunReports = () => false;
	h.runtime.compatibilityErrors = () => ['Overlay activation unavailable.'];
	await h.controller.scan();
	expect(h.jobs).toHaveLength(0);
	expect(h.controller.getSnapshot().state).toBe('error');
	expect(h.controller.getSnapshot().message).toMatch(/unavailable/i);
});
it('shares a report Steam 429 with subsequent manual profile lookups', async () => {
	const h = harness(1);
	const resolve = vi.fn(async () => '76561197960265790');
	h.resolveWith(resolve);
	await h.controller.scan();
	h.jobs[0].resolve(ok());
	await flush();
	h.jobs.find((j) => j.provider === 'steam')!.resolve({ status: 'rate_limited', data: null, fetchedAt: null, retryAfterMs: 90000 });
	await flush();
	await h.controller.addProfiles('https://steamcommunity.com/id/one');
	expect(resolve).not.toHaveBeenCalled();
	expect(h.controller.getSnapshot().inputErrors?.join(' ')).toMatch(/rate limited/i);
});
it('removes manual deadlines on unload without releasing the actual request early', async () => {
	const h = harness(0);
	h.resolveWith(() => new Promise(() => {}));
	await h.controller.scan();
	const add = h.controller.addProfiles('https://steamcommunity.com/id/one https://steamcommunity.com/id/two');
	await flush();
	h.controller.dispose();
	await add;
	expect(vi.getTimerCount()).toBe(0);
});
it('finishes all queued cells when a hung vanity request and provider occupy both slots', async () => {
	const h = harness(1);
	let done!: (id: string) => void;
	h.resolveWith(
		() =>
			new Promise((resolve) => {
				done = resolve;
			}),
	);
	await h.controller.scan();
	const add = h.controller.addProfiles('https://steamcommunity.com/id/one');
	h.jobs[0].resolve(ok());
	await flush();
	await vi.advanceTimersByTimeAsync(45000);
	await add;
	h.controller.scanAll();
	expect(h.controller.getSnapshot().state).toBe('complete');
	expect(h.jobs).toHaveLength(2);
	done('76561197960265790');
	await flush();
	expect(h.jobs).toHaveLength(2);
});
it('updates estimated match rosters while open and discards old-player responses', async () => {
	const h = harness();
	h.setUser('76561197960266228');
	let start = 1000;
	let state = 'game';
	const recent = (offset: number) => ({ currentUsers: [{ appid: 730, accountid: 1 }], recentUsers: Array.from({ length: 9 }, (_, i) => ({ appid: 730, accountid: i + offset, rtTimePlayed: 1 })) });
	let data = recent(100);
	h.runtime.readCoplay = async () => data;
	h.runtime.matchContext = () => ({ state, mode: 'competitive', server: 'kv', map: 'de_mirage', partyIds: ['76561197960266228'], partySize: 1, notBefore: 0, key: String(start) });
	// Controller copies runtime methods on creation, so use its existing read function
	// through a fresh instance for this integration case.
	const controller = createReportController({ runtime: h.runtime, fetch: h.fetch, resolveVanity: async () => '', now: Date.now });
	cleanups.push(() => controller.dispose());
	await controller.scan();
	expect(controller.getSnapshot().rows).toHaveLength(10);
	data = recent(200);
	start++;
	await vi.advanceTimersByTimeAsync(5000);
	expect(controller.getSnapshot().rows[0].player.steamId).toBe('76561197960265928');
	expect(controller.getSnapshot().state).toBe('ready');
	h.jobs[0].resolve(ok({ name: 'Old match' }));
	await flush();
	expect(h.jobs).toHaveLength(2);
	expect(controller.getSnapshot().rows.every(r => r.metrics.name !== 'Old match')).toBe(true);
	expect(h.max()).toBe(2);
	state = 'lobby';
	await vi.advanceTimersByTimeAsync(5000);
	expect(controller.getSnapshot().rows).toEqual([]);
});
it('does not interrupt initial capture when overlay activation arrives before coplay resolves', async () => {
	const h = harness(1);
	let resolve!: (value: unknown) => void;
	h.runtime.readCoplay = () => new Promise(r => { resolve = r; });
	const scan = h.controller.scan();
	await flush();
	h.activation(true);
	await flush();
	resolve({ currentUsers: [{ appid: 730, accountid: 9 }] });
	await scan;
	expect(h.controller.getSnapshot().rows.map(r => r.player.steamId)).toEqual(['76561197960265737']);
	expect(h.controller.getSnapshot().state).not.toBe('stale');
});
it('refreshes successfully while the previous roster read is still pending', async () => {
	const h = harness(1);
	let resolve!: (value: unknown) => void;
	h.runtime.readCoplay = vi.fn(() => new Promise(r => { resolve = r; }));
	const first = h.controller.scan();
	await flush();
	const refresh = h.controller.scan();
	await flush();
	resolve({ currentUsers: [{ appid: 730, accountid: 9 }] });
	await Promise.all([first, refresh]);
	expect(h.controller.getSnapshot().rows.map(r => r.player.steamId)).toEqual(['76561197960265737']);
	expect(h.controller.getSnapshot().state).toBe('loading');
	expect(h.runtime.readCoplay).toHaveBeenCalledTimes(1);
});
it.each(['read error', 'incomplete cohort', 'missing presence'])('retains an estimated report through a temporary %s and resumes loading', async (failure) => {
	const h = harness();
	h.setUser('76561197960266228');
	const data = { recentUsers: Array.from({ length: 9 }, (_, i) => ({ appid: 730, accountid: i + 100, rtTimePlayed: 1 })) };
	let failing = false;
	h.runtime.readCoplay = async () => {
		if (failing && failure === 'read error') throw Error('Temporary Steam failure.');
		return failing && failure === 'incomplete cohort' ? { recentUsers: data.recentUsers.slice(1) } : data;
	};
	h.runtime.matchContext = () => failing && failure === 'missing presence' ? null : ({ state: 'game', mode: 'competitive', server: 'kv', map: 'de_mirage', partyIds: ['76561197960266228'], partySize: 1, notBefore: 0, key: 'match' });
	const controller = createReportController({ runtime: h.runtime, fetch: h.fetch, resolveVanity: async () => '', now: Date.now });
	cleanups.push(() => controller.dispose());
	await controller.scan();
	const before = controller.getSnapshot();
	failing = true;
	await vi.advanceTimersByTimeAsync(5000);
	expect(controller.getSnapshot().rows).toEqual(before.rows);
	expect(controller.getSnapshot().id).toBe(before.id);
	expect(controller.getSnapshot().message).toMatch(/retained|last|retry|check/i);
	failing = false;
	await vi.advanceTimersByTimeAsync(5000);
	h.jobs[0].resolve(ok({ leetifyAim: 80 }));
	await flush();
	expect(controller.getSnapshot().id).toBe(before.id);
	expect(controller.getSnapshot().rows[0].metrics.leetifyAim).toBe(80);
	expect(controller.getSnapshot().message).toBeUndefined();
});
it('retains captured players when an explicit refresh fails and recovers on retry', async () => {
	const h = harness(1);
	await h.controller.scan();
	h.jobs[0].resolve(ok({ leetifyAim: 80 }));
	await flush();
	const previous = h.controller.getSnapshot();
	h.runtime.readCoplay = async () => { throw Error('Temporary Steam failure.'); };
	await h.controller.scan();
	const failed = h.controller.getSnapshot();
	expect(failed.rows.map(r => r.player.steamId)).toEqual(['76561197960265729']);
	expect(failed.roster).toEqual(previous.roster);
	expect(failed.rows[0].metrics.leetifyAim).toBe(80);
	expect(failed.state).toBe('error');
	expect(failed.message).toMatch(/refresh|retained/i);
	expect(Object.values(failed.rows[0].providers).every(p => p.status !== 'loading')).toBe(true);
	h.runtime.readCoplay = async () => ({ currentUsers: [{ appid: 730, accountid: 9 }] });
	await h.controller.scan();
	expect(h.controller.getSnapshot().rows.map(r => r.player.steamId)).toEqual(['76561197960265737']);
});
it('refreshes only the requested player without recapturing the roster or replacing other rows', async () => {
	const h = harness(2);
	await h.controller.scan();
	for (let i = 0; i < 6; i++) {
		for (const job of h.jobs.filter(j => !j.done)) job.resolve(ok({ name: `Original ${job.id}`, cs2Hours: 123 }));
		await flush();
	}
	const before = h.controller.getSnapshot();
	const rosterReads = vi.mocked(h.runtime.readCoplay).mock.calls.length;
	h.controller.refreshPlayer('76561197960265729');
	h.controller.refreshPlayer('76561197960265729'); // A double click must not duplicate work.
	await flush();
	const pending = h.controller.getSnapshot();
	expect(pending.id).toBe(before.id);
	expect(pending.roster).toBe(before.roster);
	expect(pending.rows[1]).toBe(before.rows[1]);
	expect(Object.values(pending.rows[0].providers).every(p => p.status === 'loading')).toBe(true);
	for (let i = 0; i < 4; i++) {
		for (const job of h.jobs.filter(j => !j.done)) job.resolve(ok({ name: 'Refreshed', cs2Hours: 456 }));
		await flush();
	}
	expect(h.jobs.slice(6).map(j => [j.id, j.provider])).toEqual([
		['76561197960265729', 'leetify'], ['76561197960265729', 'faceit'], ['76561197960265729', 'steam'],
	]);
	expect(h.controller.getSnapshot().rows[0].metrics.cs2Hours).toBe(456);
	expect(h.controller.getSnapshot().rows[1]).toBe(before.rows[1]);
	expect(h.controller.getSnapshot().state).toBe('complete');
	expect(h.runtime.readCoplay).toHaveBeenCalledTimes(rosterReads);
	expect(h.max()).toBe(2);
});
it('individual refresh respects provider cooldowns and refuses unknown or stale players', async () => {
	const h = harness(1);
	await h.controller.scan();
	h.jobs.find(j => j.provider === 'leetify')!.resolve({ status: 'rate_limited', data: null, fetchedAt: null, retryAfterMs: 60000 });
	for (let i = 0; i < 4; i++) {
		for (const job of h.jobs.filter(j => !j.done)) job.resolve(ok());
		await flush();
	}
	h.controller.refreshPlayer('76561197960265799');
	expect(h.jobs).toHaveLength(3);
	h.controller.refreshPlayer('76561197960265729');
	await flush();
	expect(h.jobs.filter(j => j.provider === 'leetify')).toHaveLength(1);
	expect(h.controller.getSnapshot().rows[0].providers.leetify.status).toBe('rate_limited');
	expect(h.jobs.slice(3).map(j => j.provider)).toEqual(['faceit', 'steam']);
	h.roster([2]);
	await vi.advanceTimersByTimeAsync(5000);
	const stale = h.controller.getSnapshot();
	h.controller.refreshPlayer('76561197960265729');
	expect(h.controller.getSnapshot()).toBe(stale);
});
