import type { Metrics, Provider, ProviderResult, ReportRow, ReportSnapshot, RosterSnapshot, SteamId } from '../../shared/report';
import type { SteamRuntime } from '../steam/runtime';
import { captureRoster, emptyRoster, MAX_PLAYERS } from '../steam/roster';
import { resolveManualRoster } from '../steam/manual-roster';
import { assess, emptyMetrics } from './rules';
type Result = ProviderResult<Partial<Metrics>>;
const providers: Provider[] = ['leetify', 'faceit', 'steam'];
const loading = (): Result => ({ status: 'loading', data: null, fetchedAt: null });
const terminal = (status: Result['status'], message?: string): Result => ({ status, data: null, fetchedAt: null, message });
type Job = { generation: number; provider: Provider; steamId: SteamId; timedOut?: boolean; timer?: ReturnType<typeof setTimeout> };
export interface ReportController {
	scan(): Promise<void>;
	addProfiles(text: string): Promise<void>;
	cancel(): void;
	close(): void;
	getSnapshot(): ReportSnapshot;
	subscribe(cb: () => void): () => void;
	dispose(): void;
}
export function createReportController(deps: {
	runtime: SteamRuntime;
	fetch: (provider: Provider, steamId: SteamId) => Promise<Result>;
	resolveVanity: (name: string) => Promise<SteamId>;
	now: () => number;
}): ReportController {
	let generation = 0,
		open = false,
		active = true,
		validated = true,
		disposed = false,
		checking = false;
	let account: SteamId | null = null;
	let snapshot: ReportSnapshot = { id: 0, roster: emptyRoster(deps.now()), rows: [], state: 'idle' };
	let queue: Job[] = [];
	const running = new Map<string, Job>(),
		cooldowns = new Map<Provider, number>();
	const listeners = new Set<() => void>();
	let buffered: { job: Job; result: Result }[] = [];
	let poll: ReturnType<typeof setInterval> | undefined;
	let pendingRoster: Promise<unknown> | null = null;
	const readRuntime: SteamRuntime = {
		...deps.runtime,
		readCoplay: () => {
			if (pendingRoster) return Promise.reject(Error('Roster request still pending.'));
			const request = Promise.resolve().then(() => deps.runtime.readCoplay());
			pendingRoster = request;
			void request
				.finally(() => {
					if (pendingRoster === request) pendingRoster = null;
				})
				.catch(() => {});
			return request;
		},
	};
	const rosterReads = new Set<AbortController>();
	const readRoster = async () => {
		const request = new AbortController();
		rosterReads.add(request);
		try {
			return await captureRoster(readRuntime, deps.now, request.signal);
		} finally {
			rosterReads.delete(request);
		}
	};
	const notify = () => {
		for (const cb of listeners) cb();
	};
	const set = (value: ReportSnapshot) => {
		snapshot = value;
		notify();
	};
	const accountValid = () => deps.runtime.currentUserId() === account;
	const current = (job: Job) => !disposed && open && job.generation === generation;
	const clearQueue = () => {
		generation++;
		queue = [];
		buffered = [];
		for (const request of rosterReads) request.abort();
	};
	function cancelCells(state: ReportSnapshot['state'], message?: string, clear = false) {
		clearQueue();
		set({
			...snapshot,
			state,
			message,
			roster: clear ? emptyRoster(deps.now(), 'empty', message) : snapshot.roster,
			rows: clear
				? []
				: snapshot.rows.map((row) => ({
						...row,
						providers: Object.fromEntries(
							providers.map((p) => [p, row.providers[p].status === 'loading' ? terminal('canceled') : row.providers[p]]),
						) as ReportRow['providers'],
					})),
		});
	}
	function apply(job: Job, result: Result) {
		if (!current(job)) return;
		if (!accountValid()) {
			cancelCells('stale', 'Steam account changed. Refresh report.', true);
			return;
		}
		if (!active || !validated) {
			buffered.push({ job, result });
			return;
		}
		const rows = snapshot.rows.map((row) => {
			if (row.player.steamId !== job.steamId) return row;
			const updated = { ...row.providers, [job.provider]: result };
			const metrics = emptyMetrics();
			// Apply source-specific values; identity preference is independent of arrival order.
			for (const p of ['steam', 'faceit', 'leetify'] as Provider[]) {
				const data = updated[p].status === 'ok' ? updated[p].data : null;
				if (data)
					for (const [key, value] of Object.entries(data)) if (value !== null && value !== undefined) (metrics as unknown as Record<string, unknown>)[key] = value;
			}
			return { ...row, providers: updated, metrics, assessment: assess(metrics) };
		});
		const complete = rows.every((row) => providers.every((p) => row.providers[p].status !== 'loading'));
		set({ ...snapshot, rows, state: complete ? 'complete' : 'loading' });
	}
	function pump() {
		if (disposed || !open || !active || !validated || !accountValid()) return;
		const still: Job[] = [];
		for (const job of queue) {
			const cooldown = cooldowns.get(job.provider) ?? 0;
			const blocked =
				[...running.values()].some((j) => j.provider === job.provider && j.timedOut) || (running.size >= 2 && [...running.values()].every((j) => j.timedOut));
			if (cooldown > deps.now()) apply(job, { ...terminal('rate_limited', 'Provider cooldown active.'), retryAfterMs: cooldown - deps.now() });
			else if (blocked) apply(job, terminal('error', 'Backend still responding. Refresh when it recovers.'));
			else still.push(job);
		}
		queue = still;
		while (running.size < 2) {
			const index = queue.findIndex((j) => ![...running.values()].some((r) => r.provider === j.provider));
			if (index < 0) break;
			const job = queue.splice(index, 1)[0],
				key = `${job.provider}:${job.steamId}`;
			running.set(key, job);
			job.timer = setTimeout(() => {
				job.timedOut = true;
				apply(job, terminal('error', 'Backend response timed out.'));
				pump();
			}, 45000);
			Promise.resolve()
				.then(() => deps.fetch(job.provider, job.steamId))
				.catch(() => terminal('error', 'Provider request failed.'))
				.then((result) => {
					if (result.retryAfterMs !== undefined || result.status === 'rate_limited')
						cooldowns.set(job.provider, Math.max(cooldowns.get(job.provider) ?? 0, deps.now() + (result.retryAfterMs ?? 60000)));
					if (!job.timedOut) apply(job, result);
				})
				.finally(() => {
					clearTimeout(job.timer);
					running.delete(key);
					pump();
				});
		}
	}
	const signature = (roster: RosterSnapshot) =>
		roster.players
			.filter((p) => p.origin !== 'manual')
			.map((p) => `${p.steamId}:${p.team}:${p.teamSource}:${p.teamObservedAt === null ? 'unknown' : 'verified'}`)
			.sort()
			.join('|');
	async function checkRoster() {
		if (checking || !open || !active || disposed || snapshot.state === 'idle' || snapshot.state === 'stale') return;
		if (!accountValid()) {
			cancelCells('stale', 'Steam account changed. Refresh report.', true);
			return;
		}
		checking = true;
		const token = generation;
		const roster = await readRoster();
		checking = false;
		if (token !== generation || !open || !active || disposed) return;
		if (!accountValid()) {
			cancelCells('stale', 'Steam account changed. Refresh report.', true);
			return;
		}
		if (roster.state === 'error' || roster.state === 'unavailable' || signature(roster) !== signature(snapshot.roster)) {
			validated = false;
			cancelCells('stale', roster.state === 'error' || roster.state === 'unavailable' ? 'Roster unavailable. Refresh report.' : 'Roster changed — refresh report');
			return;
		}
		validated = true;
		const ready = buffered;
		buffered = [];
		for (const entry of ready) apply(entry.job, entry.result);
		pump();
	}
	function polling() {
		clearInterval(poll);
		if (open && active && !disposed) poll = setInterval(() => void checkRoster(), 5000);
	}
	function begin(roster: RosterSnapshot, inputErrors: string[] = []) {
		clearQueue();
		const token = generation;
		validated = true;
		const rows = roster.players.map((player) => {
			const metrics = emptyMetrics();
			return { player, metrics, assessment: assess(metrics), providers: { leetify: loading(), faceit: loading(), steam: loading() } };
		});
		set({ id: token, roster, rows, state: rows.length ? 'loading' : roster.state === 'error' ? 'error' : 'complete', inputErrors });
		queue = rows.flatMap((row) => providers.map((provider) => ({ generation: token, provider, steamId: row.player.steamId })));
		pump();
		polling();
	}
	let vanityPending = 0;
	const resolveVanity = async (name: string) => {
		if (vanityPending >= 2) throw Error('Profile resolver is still responding.');
		vanityPending++;
		try {
			return await deps.resolveVanity(name);
		} finally {
			vanityPending--;
		}
	};
	const offActive = deps.runtime.onOverlayActive((value) => {
		active = value;
		validated = false;
		polling();
		if (value) void checkRoster();
	});
	const offExit = deps.runtime.onAppExit(() => {
		cancelCells('stale', 'CS2 closed.', true);
		open = false;
		polling();
	});
	const controller: ReportController = {
		async scan() {
			if (disposed) return;
			clearQueue();
			const token = generation;
			open = true;
			active = true;
			validated = false;
			account = deps.runtime.currentUserId();
			set({ id: token, roster: emptyRoster(deps.now()), rows: [], state: 'loading' });
			const roster = await readRoster();
			if (disposed || !open || token !== generation) return;
			if (!accountValid()) {
				cancelCells('stale', 'Steam account changed. Refresh report.', true);
				return;
			}
			begin(roster);
		},
		async addProfiles(text) {
			if (disposed || !open) return;
			cancelCells('canceled');
			const token = generation,
				original = snapshot.roster;
			const resolved = await resolveManualRoster(text, resolveVanity);
			if (disposed || !open || generation !== token) return;
			if (!accountValid()) {
				cancelCells('stale', 'Steam account changed. Refresh report.', true);
				return;
			}
			const players = new Map(original.players.map((p) => [p.steamId, p]));
			for (const player of resolved.players) if (!players.has(player.steamId)) players.set(player.steamId, player);
			if (players.size > MAX_PLAYERS) {
				set({ ...snapshot, inputErrors: ['Report limit: 128 players.'] });
				return;
			}
			begin({ ...original, players: [...players.values()] }, resolved.errors);
		},
		cancel() {
			cancelCells('canceled');
		},
		close() {
			clearQueue();
			open = false;
			clearInterval(poll);
			set({ id: generation, roster: emptyRoster(deps.now()), rows: [], state: 'idle' });
		},
		getSnapshot: () => snapshot,
		subscribe(cb) {
			listeners.add(cb);
			return () => {
				listeners.delete(cb);
			};
		},
		dispose() {
			controller.close();
			disposed = true;
			offActive();
			offExit();
			listeners.clear();
			for (const job of running.values()) clearTimeout(job.timer);
		},
	};
	return controller;
}
