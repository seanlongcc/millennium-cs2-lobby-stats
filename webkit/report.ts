import { callable } from '@steambrew/webkit';
import type { ReportSnapshot } from '../shared/report';
import { escapeHtml, providerTabs, renderBrowserReport, type ReportViewState } from './report-view';

// Lua receives object values in sorted-key order. Use an array for positional arguments.
const requestBackend = callable<[[token: string, action: string, input: string]], string>('report_browser_request');
const request = ({ token, action, input }: { token: string; action: string; input: string }) => requestBackend([token, action, input]);

export function isReportPage(location: Location) {
	return location.origin === 'https://millennium.ftp' && location.pathname.endsWith('/static/cs2-report.html');
}

export function mountBrowserReport(root: HTMLElement, token: string, badge: string, rpc = request) {
	const doc = root.ownerDocument,
		win = doc.defaultView!;
	const state: ReportViewState = { selectedId: null, tab: 'leetify', details: false };
	let snapshot: ReportSnapshot | undefined,
		highlight = true,
		lastResponse = '',
		stopped = false,
		pending = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const actions: { action: string; input: string }[] = [];
	const failedAvatars = new Set<string>();
	const view = doc.createElement('div');
	const form = doc.createElement('form');
	form.className = 'manual';
	form.hidden = true;
	form.innerHTML =
		'<div class="manual-heading"><label for="cs2-profile-input">Steam profiles or custom IDs</label><button type="button" class="icon-action" data-action="add-close" aria-label="Close profile input" title="Close profile input">×</button></div><p id="cs2-profile-help">Paste profile links, Steam IDs, or custom names (for example, steamcommunity.com/id/name or just name), one per line. Replace list removes Steam’s old players. Refresh report reads Steam’s list again.</p><textarea id="cs2-profile-input" aria-describedby="cs2-profile-help" placeholder="Steam profile link, Steam ID, or custom name"></textarea><div class="action-row"><button class="action" type="submit" value="add">Add players</button><button class="action" type="submit" value="replace">Replace list</button></div>';
	root.replaceChildren(form, view);
	const closeInput = () => {
		form.hidden = true;
		view.querySelector<HTMLButtonElement>('[data-action=add-toggle]')?.focus({ preventScroll: true });
	};
	const render = () => {
		if (!snapshot) return;
		const focused = doc.activeElement as HTMLElement | null;
		const focusKey = focused && ['action', 'tab', 'select', 'refresh-player'].find((key) => focused.getAttribute(`data-${key}`));
		const focusValue = focusKey ? focused!.getAttribute(`data-${focusKey}`) : null;
		view.innerHTML = renderBrowserReport(snapshot, state, highlight, badge);
		for (const image of view.querySelectorAll<HTMLImageElement>('.avatar img')) if (failedAvatars.has(image.src)) image.remove();
		if (focusKey && focusValue) view.querySelector<HTMLElement>(`[data-${focusKey}="${focusValue}"]`)?.focus({ preventScroll: true });
	};
	const close = () => {
		if (stopped) return;
		stopped = true;
		clearTimeout(timer);
		actions.length = 0;
		form.hidden = true;
		view.innerHTML = '<div class="empty"><h1>Report closed</h1><p>Close this browser tab to return to Steam, or select Scan players for a new report.</p></div>';
		void rpc({ token, action: 'close', input: '' }).catch(() => {});
	};
	const send = async (action = 'snapshot', input = '') => {
		if (stopped) return;
		if (pending) {
			if (action !== 'snapshot') actions.push({ action, input });
			return;
		}
		pending = true;
		clearTimeout(timer);
		try {
			const raw = await rpc({ token, action, input });
			if (stopped) return;
			const result = JSON.parse(raw) as { error?: string; snapshot?: ReportSnapshot; highlightEnabled: boolean };
			if (result.error || !result.snapshot) {
				stopped = true;
				form.hidden = true;
				view.innerHTML = `<div class="empty"><h1>Report unavailable</h1><p role="alert">${escapeHtml(result.error ?? 'Select Scan players again.')}</p></div>`;
				return;
			}
			if (snapshot?.id !== result.snapshot.id) {
				state.tab = 'leetify';
				state.selectedId = null;
				state.details = false;
			}
			snapshot = result.snapshot;
			highlight = result.highlightEnabled;
			if (raw !== lastResponse || action === 'refresh-player') {
				lastResponse = raw;
				render();
			}
		} catch {
			view.innerHTML = '<div class="empty"><h1>Connection interrupted</h1><p role="alert">Reconnecting to the plugin…</p></div>';
			lastResponse = '';
		} finally {
			pending = false;
			if (!stopped) {
				const next = actions.shift();
				if (next) void send(next.action, next.input);
				else timer = setTimeout(() => void send(), 1000);
			}
		}
	};
	const click = (event: MouseEvent) => {
		const target = event.target as HTMLElement;
		const refresh = target.closest<HTMLButtonElement>('[data-refresh-player]');
		if (refresh) {
			if (!refresh.disabled) {
				refresh.disabled = true;
				refresh.textContent = 'Loading…';
				void send('refresh-player', refresh.dataset.refreshPlayer!);
			}
			return;
		}
		const tab = target.closest<HTMLElement>('[data-tab]')?.dataset.tab;
		if (tab && providerTabs.includes(tab as typeof state.tab)) {
			state.tab = tab as typeof state.tab;
			render();
			return;
		}
		const selected = target.closest<HTMLElement>('[data-player]')?.dataset.player;
		if (selected) {
			state.selectedId = selected;
			render();
			return;
		}
		const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
		if (action === 'close') close();
		else if (action === 'add-close') closeInput();
		else if (action === 'details') {
			state.details = !state.details;
			render();
		} else if (action === 'add-toggle') {
			form.hidden = !form.hidden;
			if (!form.hidden) form.querySelector('textarea')!.focus();
		} else if (action === 'refresh' || action === 'cancel') void send(action);
	};
	const keydown = (event: KeyboardEvent) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			if (!form.hidden) closeInput();
			else close();
			return;
		}
		if (!(event.target as HTMLElement).matches('[role=tab]')) return;
		const index = providerTabs.indexOf(state.tab);
		const next = event.key === 'ArrowRight' ? (index + 1) % 4 : event.key === 'ArrowLeft' ? (index + 3) % 4 : event.key === 'Home' ? 0 : event.key === 'End' ? 3 : null;
		if (next !== null) {
			event.preventDefault();
			state.tab = providerTabs[next];
			render();
			view.querySelector<HTMLElement>(`[data-tab="${state.tab}"]`)?.focus();
		}
	};
	const submit = (event: SubmitEvent) => {
		event.preventDefault();
		void send((event.submitter as HTMLButtonElement | null)?.value === 'replace' ? 'replace' : 'add', form.querySelector('textarea')!.value);
	};
	const imageError = (event: Event) => {
		const target = event.target as HTMLImageElement | null;
		if (!target?.matches?.('.avatar img')) return;
		failedAvatars.add(target.src);
		target.remove();
	};
	root.addEventListener('click', click);
	root.addEventListener('keydown', keydown);
	root.addEventListener('error', imageError, true);
	form.addEventListener('submit', submit);
	win.addEventListener('pagehide', close, { once: true });
	void send();
	return () => {
		close();
		root.removeEventListener('click', click);
		root.removeEventListener('keydown', keydown);
		root.removeEventListener('error', imageError, true);
		form.removeEventListener('submit', submit);
		win.removeEventListener('pagehide', close);
	};
}
