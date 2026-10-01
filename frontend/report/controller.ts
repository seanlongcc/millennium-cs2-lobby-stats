import type { Metrics, Provider, ProviderResult, ReportRow, ReportSnapshot, RosterSnapshot, SteamId } from '../../shared/report';
import type { SteamRuntime } from '../steam/runtime';
import { captureRoster, emptyRoster, MAX_PLAYERS } from '../steam/roster';
import { resolveManualRoster } from '../steam/manual-roster';
import { assess, emptyMetrics } from './rules';
import { ProviderRequestError } from './providers';
type Result = ProviderResult<Partial<Metrics>>;
const providers: Provider[] = ['leetify', 'faceit', 'steam'];
const loading = (): Result => ({ status: 'loading', data: null, fetchedAt: null });
const terminal = (status: Result['status'], message?: string): Result => ({ status, data: null, fetchedAt: null, message });
type Job = { generation: number; provider: Provider; steamId: SteamId; timedOut?: boolean; timer?: ReturnType<typeof setTimeout> };
type VanityJob = {
	name: string;
	generation: number;
	signal: AbortSignal;
	done: boolean;
	timedOut: boolean;
	timer?: ReturnType<typeof setTimeout>;
	abort?: () => void;
	resolve: (id: string) => void;
	reject: (error: Error) => void;
};
export interface ReportController {
	scan(): Promise<void>;
	refreshPlayer(steamId: SteamId): void;
	addProfiles(text: string, mode?: 'append' | 'replace'): Promise<void>;
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
	let manualOnly = false;
	let snapshot: ReportSnapshot = { id: 0, roster: emptyRoster(deps.now()), rows: [], state: 'idle' };
	let queue: Job[] = [];
	let vanityQueue: VanityJob[] = [];
	let vanityRunning: VanityJob | null = null;
	const manualBatches = new Set<AbortController>();
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
		for (const batch of manualBatches) batch.abort();
		for (const job of vanityQueue) finishVanity(job, new Error('Request canceled.'));
		vanityQueue = [];
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
	function finishVanity(job: VanityJob, error?: Error, id?: string) {
		if (job.done) return;
		job.done = true;
		clearTimeout(job.timer);
		if (job.abort) job.signal.removeEventListener('abort', job.abort);
		if (error) job.reject(error);
		else job.resolve(id!);
	}
	function enqueueVanity(name: string, signal: AbortSignal): Promise<SteamId> {
		return new Promise((resolve, reject) => {
			const job: VanityJob = { name, signal, generation, resolve, reject, done: false, timedOut: false };
			job.abort = () => {
				job.timedOut = true;
				finishVanity(job, new Error('Request canceled.'));
			};
			signal.addEventListener('abort', job.abort, { once: true });
			job.timer = setTimeout(() => finishVanity(job, new Error('Backend queue timed out.')), 45000);
			vanityQueue.push(job);
			if (signal.aborted) job.abort();
			pump();
		});
	}
	function pumpVanity() {
		while (vanityQueue.length) {
			const job = vanityQueue[0];
			if (job.done) {
				vanityQueue.shift();
				continue;
			}
			if (job.generation !== generation || job.signal.aborted) {
				vanityQueue.shift();
				finishVanity(job, new Error('Request canceled.'));
				continue;
			}
			const cooldown = cooldowns.get('steam') ?? 0;
			if (cooldown > deps.now()) {
				vanityQueue.shift();
				finishVanity(job, new ProviderRequestError('rate_limited', 'Steam cooldown active.', cooldown - deps.now()));
				continue;
			}
			if (vanityRunning || running.size >= 2 || [...running.values()].some((j) => j.provider === 'steam')) return;
			vanityQueue.shift();
			vanityRunning = job;
			clearTimeout(job.timer);
			job.timer = setTimeout(() => {
				job.timedOut = true;
				finishVanity(job, new Error('Profile request timed out.'));
				pump();
			}, 10000);
			Promise.resolve()
				.then(() => {
					if (job.done || job.signal.aborted || job.generation !== generation || disposed || !open || !active || !accountValid()) throw Error('Request canceled.');
					return deps.resolveVanity(job.name);
				})
				.then((id) => finishVanity(job, undefined, id))
				.catch((error) => {
					if (error instanceof ProviderRequestError && error.status === 'rate_limited')
						cooldowns.set('steam', Math.max(cooldowns.get('steam') ?? 0, deps.now() + (error.retryAfterMs ?? 60000)));
					finishVanity(job, error instanceof Error ? error : new Error('Profile unavailable.'));
				})
				.finally(() => {
					clearTimeout(job.timer);
					if (vanityRunning === job) vanityRunning = null;
					pump();
				});
			return;
		}
	}
	function pump() {
		if (disposed || !open || !active || !validated || !accountValid() || deps.runtime.canRunReports?.() === false) return;
		pumpVanity();
		const still: Job[] = [];
		for (const job of queue) {
			const cooldown = cooldowns.get(job.provider) ?? 0;
			const blocked =
				(job.provider === 'steam' && !!vanityRunning?.timedOut) ||
				[...running.values()].some((j) => j.provider === job.provider && j.timedOut) ||
				(running.size + Number(!!vanityRunning) >= 2 && [...running.values()].every((j) => j.timedOut) && (!vanityRunning || vanityRunning.timedOut));
			if (cooldown > deps.now()) apply(job, { ...terminal('rate_limited', 'Provider cooldown active.'), retryAfterMs: cooldown - deps.now() });
			else if (blocked) apply(job, terminal('error', 'Backend still responding. Refresh when it recovers.'));
			else still.push(job);
		}
		queue = still;
		while (running.size + Number(!!vanityRunning) < 2) {
			const index = queue.findIndex((j) => !(j.provider === 'steam' && vanityRunning) && ![...running.values()].some((r) => r.provider === j.provider));
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
		(roster.contextKey ?? '') + ':' + roster.players
			.filter((p) => p.origin !== 'manual')
			.map((p) => `${p.steamId}:${p.team}:${p.teamSource}:${p.teamObservedAt === null ? 'unknown' : 'verified'}`)
			.sort()
			.join('|');
	async function checkRoster() {
		if (checking || !open || !active || disposed || snapshot.state === 'idle' || snapshot.state === 'stale') return;
		// Activation can arrive while scan() is still capturing. Its result already
		// validates the account; a second read would cancel it as "still pending".
		if (rosterReads.size) return;
		if (!accountValid()) {
			cancelCells('stale', 'Steam account changed. Refresh report.', true);
			return;
		}
		checking = true;
		const token = generation;
		const roster = manualOnly ? snapshot.roster : await readRoster();
		checking = false;
		if (token !== generation || !open || !active || disposed) return;
		if (!accountValid()) {
			cancelCells('stale', 'Steam account changed. Refresh report.', true);
			return;
		}
		// A recent-player estimate can move to the next match while the tab stays open.
		// Clear old rows as soon as it becomes unavailable; keep polling for recovery.
		const estimated = snapshot.roster.source === 'steam_recent_estimate' || roster.source === 'steam_recent_estimate';
		if (!manualOnly && estimated && snapshot.state !== 'canceled') {
			if (signature(roster) !== signature(snapshot.roster) || roster.state !== snapshot.roster.state || roster.message !== snapshot.roster.message) {
				begin({ ...roster, source: roster.source ?? 'steam_recent_estimate' });
				return;
			}
			if (roster.state === 'error' || roster.state === 'unavailable') return;
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
	const offActive = deps.runtime.onOverlayActive((value) => {
		active = value;
		if (!value && manualBatches.size) cancelCells('canceled', 'Profile lookup canceled. Retry while the overlay is open.');
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
		refreshPlayer(steamId) {
			if (disposed || !open || !active || !validated || !accountValid() || manualBatches.size || snapshot.state === 'stale' || deps.runtime.canRunReports?.() === false) return;
			const row = snapshot.rows.find((entry) => entry.player.steamId === steamId);
			// A loading row already has queued/running work. Reuse the report generation
			// so other players' responses remain valid, and never duplicate this row's jobs.
			if (!row || providers.some((provider) => row.providers[provider].status === 'loading')) return;
			const metrics = emptyMetrics();
			set({
				...snapshot,
				state: 'loading',
				message: undefined,
				rows: snapshot.rows.map((entry) => entry === row
					? { ...row, metrics, assessment: assess(metrics), providers: { leetify: loading(), faceit: loading(), steam: loading() } }
					: entry),
			});
			queue.push(...providers.map((provider) => ({ generation, provider, steamId })));
			pump();
		},
		async scan() {
			if (disposed) return;
			if (deps.runtime.canRunReports?.() === false) {
				cancelCells('error', deps.runtime.compatibilityErrors?.().join(' ') || 'Steam overlay lifecycle unavailable.', true);
				return;
			}
			clearQueue();
			const token = generation;
			open = true;
			manualOnly = false;
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
		async addProfiles(text, mode = 'append') {
			if (disposed || !open) return;
			if (!active || (snapshot.state === 'stale' && mode !== 'replace') || deps.runtime.canRunReports?.() === false) {
				set({ ...snapshot, inputErrors: ['Refresh the report in the active overlay before adding profiles.'] });
				return;
			}
			cancelCells('canceled');
			const token = generation,
				original = snapshot.roster;
			const batch = new AbortController();
			manualBatches.add(batch);
			let resolved: Awaited<ReturnType<typeof resolveManualRoster>>;
			try {
				resolved = await resolveManualRoster(text, (name) => enqueueVanity(name, batch.signal), { signal: batch.signal, managedDeadline: true });
			} finally {
				manualBatches.delete(batch);
			}
			if (disposed || !open || generation !== token) return;
			if (!accountValid()) {
				cancelCells('stale', 'Steam account changed. Refresh report.', true);
				return;
			}
			if (mode === 'replace' && (resolved.errors.length || !resolved.players.length)) {
				set({ ...snapshot, inputErrors: resolved.errors.length ? resolved.errors : ['Paste at least one Steam profile or ID to replace the list.'] });
				return;
			}
			const players = new Map((mode === 'replace' ? [] : original.players).map((p) => [p.steamId, p]));
			for (const player of resolved.players) if (!players.has(player.steamId)) players.set(player.steamId, player);
			if (players.size > MAX_PLAYERS) {
				set({ ...snapshot, inputErrors: ['Report limit: 128 players.'] });
				return;
			}
			if (mode === 'replace') manualOnly = true;
			begin({ ...(mode === 'replace' ? emptyRoster(deps.now()) : original), state: players.size ? 'ready' : original.state, players: [...players.values()] }, resolved.errors);
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
