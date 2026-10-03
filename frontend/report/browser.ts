import type { OverlayHost, SteamRuntime } from '../steam/runtime';
import type { ReportController } from './controller';
import type { ReportHistory } from './history';
import type { BrowserReportResponse, SavedReport } from '../../shared/report';

export function createBrowserReport(deps: { runtime: SteamRuntime; controller: ReportController; history: ReportHistory; getUrl: () => Promise<string>; highlightEnabled: () => boolean }) {
	let token = '',
		active = true,
		generation = 0;
	let host: OverlayHost | undefined;
	let account: string | null = null;
	let view: 'live' | 'history' | 'saved' = 'live';
	let selected: SavedReport | undefined;
	const liveSnapshot = () => {
		const snapshot = deps.controller.getSnapshot();
		const rows = snapshot.rows.map(row => ({ ...row, player: { ...row.player, ...deps.runtime.playerInfo?.(row.player.steamId) } }));
		return { ...snapshot, rows };
	};
	const capture = () => {
		if (token && account === deps.runtime.currentUserId()) deps.history.capture(liveSnapshot());
	};
	const unsubscribeSnapshot = deps.controller.subscribe(capture);
	const close = () => {
		capture();
		deps.history.flush();
		token = '';
		host = undefined;
		view = 'live';
		selected = undefined;
		generation++;
		deps.controller.close();
	};
	const unsubscribeActive = deps.runtime.onOverlayActive((value) => {
		active = value;
	});
	const unsubscribeExit = deps.runtime.onAppExit(close);
	const timer = setInterval(() => {
		// Browser polling shares Lua IPC with slow provider requests. Silence does
		// not mean the tab closed; pagehide, explicit close and app exit release it.
		if (token && active && !deps.runtime.overlayHosts().some((h) => h.window === host?.window)) close();
	}, 1000);
	return {
		async open(nextHost: OverlayHost) {
			close();
			const current = generation;
			// Millennium returns Lua strings as JSON text, including the surrounding quotes.
			const url = new URL(JSON.parse(await deps.getUrl()));
			if (current !== generation) return;
			if (url.origin !== 'https://millennium.ftp' || !url.pathname.endsWith('/static/cs2-report.html')) throw Error('Invalid local report URL.');
			if (!deps.runtime.openBrowser) throw Error('Steam overlay browser is unavailable.');
			token = crypto.randomUUID();
			account = deps.runtime.currentUserId();
			host = nextHost;
			url.hash = token;
			try {
				deps.runtime.openBrowser(nextHost, url.href);
			} catch (error) {
				close();
				throw error;
			}
			void deps.controller.loadRoster();
		},
		// Keep this synchronous: Lua calls back into Steam while holding its IPC lane.
		// Provider/vanity work is queued without waiting for another backend response.
		request(suppliedToken: string, action: string, input: string): string {
			if (token && account !== deps.runtime.currentUserId()) close();
			if (!token || suppliedToken !== token) return JSON.stringify({ error: 'Report closed. Select Scan players in the overlay to open a new report.' });
			if (action === 'close') {
				close();
				return JSON.stringify({ closed: true });
			}
			if (action === 'history') {
				capture();
				view = 'history';
				selected = undefined;
			} else if (action === 'history-open') {
				selected = deps.history.get(input);
				view = selected ? 'saved' : 'history';
			} else if (action === 'history-live') {
				view = 'live';
				selected = undefined;
			} else if (action === 'history-delete' || action === 'history-clear') {
				if (action === 'history-clear') deps.history.clear();
				else deps.history.remove(input);
				selected = undefined;
				view = 'history';
			} else if (['scan-all', 'refresh', 'refresh-player', 'add', 'replace', 'cancel'].includes(action)) {
				// Archived reports are read-only even if an old button queues an action.
				if (view === 'live') {
					capture();
					if (action === 'refresh') void deps.controller.scan();
					else if (action === 'scan-all') deps.controller.scanAll();
					else if (action === 'refresh-player') deps.controller.refreshPlayer(input);
					else if (action === 'add' && input.length <= 32768) void deps.controller.addProfiles(input);
					else if (action === 'replace' && input.length <= 32768) void deps.controller.addProfiles(input, 'replace');
					else if (action === 'cancel') deps.controller.cancel();
				}
			} else if (action !== 'snapshot') return JSON.stringify({ error: 'Invalid report action.' });
			const response: BrowserReportResponse = {
				snapshot: selected?.snapshot ?? liveSnapshot(), highlightEnabled: deps.highlightEnabled(), view,
				savedId: selected?.id, history: view === 'history' ? deps.history.list() : undefined, historyError: deps.history.error(),
			};
			return JSON.stringify(response);
		},
		dispose() {
			close();
			clearInterval(timer);
			unsubscribeActive();
			unsubscribeExit();
			unsubscribeSnapshot();
		},
	};
}
