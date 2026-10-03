// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { createReportHistory } from '../frontend/report/history';
import { emptyMetrics, assess } from '../frontend/report/rules';
import { normalizeCoplay } from '../frontend/steam/roster';
import type { ReportSnapshot } from '../shared/report';

const account = '76561197960265729';
function report(time = 1000): ReportSnapshot {
	const roster = normalizeCoplay({ currentUsers: [{ appid: 730, accountid: 1 }] }, account, time);
	const metrics = { ...emptyMetrics(), name: 'Captured name', leetifyAim: 98 };
	return { id: time, roster, state: 'loading', rows: [{
		player: { ...roster.players[0], displayName: 'Captured persona' }, metrics, assessment: assess(metrics),
		providers: { leetify: { status: 'ok', data: metrics, fetchedAt: time }, faceit: { status: 'loading', data: null, fetchedAt: null }, steam: { status: 'private', data: null, fetchedAt: null } },
	}] };
}
function setup() {
	vi.useFakeTimers();
	const data = new Map<string, string>();
	const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
	let user: string | null = account;
	const make = () => createReportHistory({ storage: () => storage, currentUserId: () => user });
	return { data, storage, make, history: make(), setUser: (id: string | null) => { user = id; } };
}
afterEach(() => vi.useRealTimers());

it('updates one saved report as results arrive, survives restart, and freezes old stats', () => {
	const h = setup(), current = report();
	h.history.capture(current);
	const id = h.history.list()[0].id;
	expect(h.history.get(id)?.snapshot.rows[0].providers.faceit.status).toBe('canceled');
	current.rows[0].providers.faceit = { status: 'ok', data: { faceitElo: 2000 }, fetchedAt: 1500 };
	current.rows[0].metrics.faceitElo = 2000;
	current.state = 'complete';
	h.history.capture(current);
	h.history.capture(report(2000));
	current.rows[0].metrics.faceitElo = 500;
	h.history.flush();
	const restored = h.make();
	expect(restored.list()).toHaveLength(2);
	expect(restored.list()[0].capturedAt).toBe(2000);
	expect(restored.get(id)?.snapshot.rows[0].metrics.faceitElo).toBe(2000);
	expect(restored.get(id)?.snapshot.rows[0].player.displayName).toBe('Captured persona');
	expect(restored.get(id)?.snapshot.rows[0].assessment.evidence[0].category).toBe('aim');
});
it('keeps the newest 50 reports without saving empty scans', () => {
	const h = setup();
	for (let i = 1; i <= 52; i++) h.history.capture(report(i * 1000));
	h.history.capture({ ...report(), rows: [], roster: { ...report().roster, players: [] } });
	expect(h.history.list()).toHaveLength(50);
	expect(h.history.list()[49].capturedAt).toBe(3000);
	h.history.flush();
});
it('skips unscanned rosters and preserves a partially scanned roster across restarts', () => {
	const h = setup(), current = report();
	current.state = 'ready';
	current.rows[0].metrics = emptyMetrics();
	current.rows[0].assessment = assess(current.rows[0].metrics);
	for (const provider of Object.values(current.rows[0].providers)) {
		provider.status = 'unscanned';
		provider.data = null;
		provider.fetchedAt = null;
	}
	h.history.capture(current);
	expect(h.history.list()).toEqual([]);
	current.rows[0].providers.leetify = { status: 'ok', data: { leetifyAim: 80 }, fetchedAt: 1000 };
	current.rows[0].metrics.leetifyAim = 80;
	h.history.capture(current);
	h.history.flush();
	const restored = h.make();
	expect(restored.list()).toHaveLength(1);
	expect(restored.list()[0].complete).toBe(false);
	expect(restored.get(restored.list()[0].id)?.snapshot.rows[0].providers.steam.status).toBe('unscanned');
});
it('keeps Steam accounts isolated, including account changes before pending writes', () => {
	const h = setup();
	h.history.capture(report());
	h.setUser('76561197960265730');
	expect(h.history.list()).toEqual([]);
	h.history.capture(report(2000));
	h.setUser(null);
	expect(h.history.list()).toEqual([]);
	h.setUser(account);
	expect(h.history.list().map(r => r.capturedAt)).toEqual([1000]);
	h.history.flush();
});
it('deletes reports persistently and does not resurrect them on the next live update', () => {
	const h = setup(), current = report();
	h.history.capture(current);
	h.history.remove(h.history.list()[0].id);
	h.history.capture(current);
	expect(h.history.list()).toEqual([]);
	h.history.capture(report(2000));
	h.history.clear();
	h.history.flush();
	expect(h.make().list()).toEqual([]);
});
it('handles malformed history and storage failures without interrupting the report', () => {
	const h = setup();
	h.history.capture(report());
	h.history.flush();
	const key = [...h.data.keys()][0];
	h.data.set(key, '{invalid');
	expect(h.make().list()).toEqual([]);
	h.storage.setItem = () => { throw Error('Quota exceeded'); };
	h.history.capture(report(2000));
	expect(() => h.history.flush()).not.toThrow();
	expect(h.history.list()).toHaveLength(2);
	expect(h.history.error()).toMatch(/save|storage/i);
});
it.each(['providers', 'metrics', 'inputErrors', 'message'])('ignores structurally invalid stored %s', field => {
	const h = setup();
	h.history.capture(report());
	h.history.flush();
	const key = [...h.data.keys()][0];
	const stored = JSON.parse(h.data.get(key)!);
	const saved = stored.reports[0].snapshot;
	if (field === 'providers') saved.rows[0].providers = null;
	if (field === 'metrics') saved.rows[0].metrics.leetifyAim = 'invalid';
	if (field === 'inputErrors') saved.inputErrors = 'invalid';
	if (field === 'message') saved.roster.message = { toString: null };
	h.data.set(key, JSON.stringify(stored));
	expect(h.make().list()).toEqual([]);
});
