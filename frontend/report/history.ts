import type { Metrics, ReportHistorySummary, ReportSnapshot, RosterSnapshot, SavedReport } from '../../shared/report';
import { MAX_PLAYERS, validSteamId } from '../steam/roster';
import { emptyMetrics } from './rules';

const MAX_REPORTS = 50;
// Leave room for other Steam UI storage. UTF-16 strings use two bytes per unit.
const MAX_CHARACTERS = 2 * 1024 * 1024;
const providerNames = ['leetify', 'faceit', 'steam'] as const;
const providerStatuses = ['unscanned', 'ok', 'private', 'not_found', 'unauthorized', 'rate_limited', 'error', 'canceled'];
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const optionalText = (value: unknown) => value === undefined || typeof value === 'string';
const metricsValid = (value: unknown, partial = false): value is Metrics => object(value) && Object.keys(emptyMetrics()).every(key => {
	const item = value[key];
	return (partial && item === undefined) || item === null ||
		(['name', 'memberSince'].includes(key) ? typeof item === 'string' : typeof item === 'number' && Number.isFinite(item));
});
function validSaved(value: unknown): value is SavedReport {
	if (!object(value) || typeof value.id !== 'string' || !/^[a-f0-9-]{36}$/.test(value.id)) return false;
	const s = value.snapshot;
	if (!object(s) || !Number.isFinite(s.id) || !['complete', 'canceled', 'stale', 'error'].includes(s.state) ||
		!object(s.roster) || !Number.isFinite(s.roster.capturedAt) || !Array.isArray(s.roster.players) ||
		!optionalText(s.message) || !optionalText(s.roster.message) || !optionalText(s.roster.map) ||
		(s.inputErrors !== undefined && (!Array.isArray(s.inputErrors) || !s.inputErrors.every((e: unknown) => typeof e === 'string'))) ||
		!Array.isArray(s.rows) || !s.rows.length || s.rows.length > MAX_PLAYERS || s.roster.players.length !== s.rows.length) return false;
	const validPlayer = (p: unknown) => object(p) && validSteamId(p.steamId) && ['self', 'steam', 'manual'].includes(p.origin) &&
		['your_team', 'opponents', 'spectators', 'unknown', 'free_for_all'].includes(p.team) &&
		['unavailable', 'verified_live'].includes(p.teamSource) && (p.teamObservedAt === null || Number.isFinite(p.teamObservedAt)) &&
		(p.displayName === undefined || typeof p.displayName === 'string') && (p.avatarUrl === undefined || typeof p.avatarUrl === 'string');
	return s.roster.players.every(validPlayer) && s.rows.every((row: unknown) => {
		if (!object(row) || !validPlayer(row.player) || !s.roster.players.some((p: any) => p.steamId === row.player.steamId) ||
			!metricsValid(row.metrics) || !object(row.assessment) || !['insufficient_data', 'no_flags', 'unusual'].includes(row.assessment.label) ||
			!Array.isArray(row.assessment.evidence) || !object(row.providers)) return false;
		return row.assessment.evidence.every((e: unknown) => object(e) && ['aim', 'ttd', 'kd'].includes(e.category) &&
			Number.isFinite(e.value) && Number.isFinite(e.threshold) && (e.category !== 'kd' || Number.isFinite(e.matches))) &&
			providerNames.every(p => object(row.providers[p]) && providerStatuses.includes(row.providers[p].status) &&
				optionalText(row.providers[p].message) && (row.providers[p].fetchedAt === null || Number.isFinite(row.providers[p].fetchedAt)) &&
				(row.providers[p].data === null || metricsValid(row.providers[p].data, true)));
	});
}

export function createReportHistory(deps: {
	storage: () => Pick<Storage, 'getItem' | 'setItem'>;
	currentUserId: () => string | null;
}) {
	let account: string | null = null, reports: SavedReport[] = [], dirty = false, warning: string | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let ids = new WeakMap<RosterSnapshot, string>();
	const deleted = new Set<string>();
	const storageKey = (id: string) => `cs2-lobby-stats:report-history:v1:${id}`;
	function flush() {
		clearTimeout(timer);
		if (!dirty || !account) return;
		let raw = JSON.stringify({ version: 1, reports });
		while (raw.length > MAX_CHARACTERS && reports.length > 1) {
			reports.pop();
			raw = JSON.stringify({ version: 1, reports });
		}
		try {
			if (raw.length > MAX_CHARACTERS) throw Error('Report exceeds storage limit.');
			deps.storage().setItem(storageKey(account), raw);
			dirty = false;
			warning = undefined;
		} catch {
			warning = 'Could not save report history to local storage. Reports remain available until Steam closes.';
		}
	}
	function load() {
		const next = deps.currentUserId();
		const valid = validSteamId(next) ? next : null;
		if (account === valid) return;
		flush();
		account = valid;
		reports = [];
		dirty = false;
		warning = undefined;
		ids = new WeakMap();
		deleted.clear();
		if (!account) return;
		try {
			const raw = deps.storage().getItem(storageKey(account));
			if (!raw) return;
			if (raw.length > MAX_CHARACTERS) throw Error('History exceeds storage limit.');
			const value = JSON.parse(raw);
			if (!object(value) || value.version !== 1 || !Array.isArray(value.reports)) throw Error('Invalid history.');
			reports = value.reports.filter(validSaved).slice(0, MAX_REPORTS);
			if (reports.length !== value.reports.length) warning = 'Some saved reports could not be read.';
		} catch {
			warning = 'Saved report history could not be read. New reports can still be saved.';
		}
	}
	function capture(snapshot: ReportSnapshot) {
		load();
		if (!account || !snapshot.rows.length || snapshot.state === 'idle' ||
			snapshot.rows.every(row => providerNames.every(p => row.providers[p].status === 'unscanned'))) return;
		let id = ids.get(snapshot.roster);
		if (!id) { id = crypto.randomUUID(); ids.set(snapshot.roster, id); }
		if (deleted.has(id)) return;
		const saved: ReportSnapshot = JSON.parse(JSON.stringify(snapshot));
		delete saved.inputErrors;
		if (saved.state === 'loading' || saved.state === 'ready') saved.state = 'canceled';
		for (const row of saved.rows) for (const p of providerNames) {
			if (row.providers[p].status === 'loading') row.providers[p] = { status: 'canceled', data: null, fetchedAt: null, message: 'Not completed in this report.' };
		}
		const index = reports.findIndex(report => report.id === id);
		if (index >= 0 && JSON.stringify(reports[index].snapshot) === JSON.stringify(saved)) return;
		if (index >= 0) reports[index] = { id, snapshot: saved };
		else reports.unshift({ id, snapshot: saved });
		reports = reports.slice(0, MAX_REPORTS);
		dirty = true;
		clearTimeout(timer);
		timer = setTimeout(flush, 500);
	}
	return {
		capture, flush,
		list(): ReportHistorySummary[] {
			load();
			return reports.map(({ id, snapshot: s }) => ({ id, capturedAt: s.roster.capturedAt, map: s.roster.map, players: s.rows.length,
				names: s.rows.slice(0, 3).map(r => r.player.displayName ?? r.metrics.name ?? r.player.steamId),
				flagged: s.rows.filter(r => r.assessment.label === 'unusual').length, complete: s.state === 'complete' }));
		},
		get(id: string): SavedReport | undefined {
			load();
			const report = reports.find(report => report.id === id);
			return report ? JSON.parse(JSON.stringify(report)) : undefined;
		},
		remove(id: string) {
			load();
			deleted.add(id);
			reports = reports.filter(report => report.id !== id);
			dirty = true;
			flush();
		},
		clear() {
			load();
			for (const report of reports) deleted.add(report.id);
			reports = [];
			dirty = true;
			flush();
		},
		error() { load(); return warning; },
	};
}
export type ReportHistory = ReturnType<typeof createReportHistory>;
