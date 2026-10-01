import { afterEach, expect, it, vi } from 'vitest';
const transport = vi.hoisted(() => vi.fn());
vi.mock('@steambrew/webkit', () => ({ callable: () => transport }));
import { mountBrowserReport } from '../webkit/report';
import { renderBrowserReport } from '../webkit/report-view';
import { emptyMetrics, assess } from '../frontend/report/rules';
import { normalizeCoplay } from '../frontend/steam/roster';
import type { ReportSnapshot } from '../shared/report';

function snapshot(): ReportSnapshot {
	const roster = normalizeCoplay({ currentUsers: [{ appid: 730, accountid: 1 }] }, null, 1000);
	const metrics = { ...emptyMetrics(), name: '<img src=x onerror=alert(1)>', leetifyRating: 2, leetifyAim: 95, timeToDamageMs: 400, recentKd: 2.1, recentMatches: 20 };
	return {
		id: 1,
		state: 'complete',
		roster,
		rows: [
			{
				player: roster.players[0],
				metrics,
				assessment: assess(metrics),
				providers: {
					leetify: { status: 'ok', data: metrics, fetchedAt: 1000 },
					faceit: { status: 'private', data: null, fetchedAt: null },
					steam: { status: 'error', data: null, fetchedAt: null },
				},
			},
		],
	};
}
afterEach(() => {
	vi.useRealTimers();
	transport.mockReset();
	document.body.innerHTML = '';
});
it('preserves Lua positional argument order through Millennium IPC', async () => {
	vi.useFakeTimers();
	const root = document.createElement('main');
	document.body.append(root);
	transport.mockImplementation(async (args: Record<string, string> | string[]) => {
		// Lua receives arrays in order, but object values in alphabetical key order.
		const [token, action, input] = Array.isArray(args) ? args : Object.keys(args).sort().map((key) => args[key]);
		if (token !== '12345678-1234-1234-1234-123456789012' || action !== 'snapshot' || input !== '') return JSON.stringify({ error: 'Invalid report request.' });
		return JSON.stringify({ snapshot: snapshot(), highlightEnabled: true });
	});
	const stop = mountBrowserReport(root, '12345678-1234-1234-1234-123456789012', 'badge');
	try {
		await vi.advanceTimersByTimeAsync(0);
		expect(root.querySelectorAll('tbody tr[data-player]')).toHaveLength(1);
	} finally {
		stop();
	}
});
it('renders mockup roster columns and inspector, escaping names and keeping metric units', () => {
	document.body.innerHTML = renderBrowserReport(snapshot(), { selectedId: null, tab: 'leetify', details: false }, true, 'badge');
	expect(document.querySelectorAll('thead th')).toHaveLength(5);
	expect(document.querySelectorAll('tbody tr[data-player]')).toHaveLength(1);
	expect(document.querySelector('.inspector [role=tabpanel]')).not.toBeNull();
	expect(document.querySelector('img[src=x]')).toBeNull();
	expect(document.body.textContent).toContain('<img src=x onerror=alert(1)>');
	expect(document.body.textContent).toContain('400 ms');
	expect(document.body.textContent).not.toContain('95%');
	expect([...document.querySelectorAll('[role=tab]')].map((el) => el.textContent)).toEqual(['Leetify', 'CSStats', 'FACEIT', 'Steam']);
	expect(document.body.textContent).toContain('may include players from previous matches');
});
it('renders safe Steam avatars in both roster and inspector, retaining initials for unavailable images', () => {
	const current = snapshot();
	current.rows[0].player = { ...current.rows[0].player, displayName: 'Steam name', avatarUrl: `https://avatars.steamstatic.com/${'a'.repeat(40)}_medium.jpg` };
	document.body.innerHTML = renderBrowserReport(current, { selectedId: null, tab: 'leetify', details: false }, true, 'badge');
	expect(document.querySelectorAll('.avatar img')).toHaveLength(2);
	expect(document.querySelector('.avatar img')?.getAttribute('referrerpolicy')).toBe('no-referrer');
	expect(document.querySelector('.avatar')?.textContent).toBe('S');
	expect(document.querySelector('.player-name')?.textContent).toBe('Steam name');
	current.rows[0].player.avatarUrl = 'https://untrusted.example/avatar.jpg';
	document.body.innerHTML = renderBrowserReport(current, { selectedId: null, tab: 'leetify', details: false }, true, 'badge');
	expect(document.querySelector('.avatar img')).toBeNull();
});
it('labels the 30-game K/D window and discloses a smaller usable sample', () => {
	document.body.innerHTML = renderBrowserReport(snapshot(), { selectedId: null, tab: 'leetify', details: true }, true, 'badge');
	expect(document.querySelector('thead')!.textContent).toContain('K/D · Last 30');
	expect(document.querySelector('tbody tr td:last-child')!.textContent).toContain('20/30 games');
	expect(document.querySelector('.data-notes')!.textContent).toContain('latest 30 tracked games');
	expect(document.querySelector('.data-notes')!.textContent).not.toContain('Aggregate window unavailable');
});
it.each([null, 2.1])('shows the Aim reason and highlights only qualifying metrics with K/D %s', (recentKd) => {
	const current = snapshot();
	const row = current.rows[0];
	row.metrics = { ...row.metrics, leetifyAim: 97, recentKd };
	row.assessment = assess(row.metrics);
	const view = { selectedId: null, tab: 'leetify' as const, details: true };
	document.body.innerHTML = renderBrowserReport(current, view, true, 'badge');
	expect(document.querySelector('.player-state')!.textContent).toContain('Suspicious aim');
	expect(document.querySelector('tbody td:nth-child(3)')!.classList.contains('hot')).toBe(true);
	expect(document.querySelector('tbody td:last-child')!.classList.contains('hot')).toBe(recentKd !== null);
	expect(document.querySelector('.inspector')!.textContent).toContain('Plugin rule: Aim ≥ 97');
	expect(document.querySelector('.data-notes')!.textContent).toContain('Suspicious aim');
	expect(document.querySelector('.inspector')!.textContent!.includes('Plugin rule: ≥ 2.00 K/D')).toBe(recentKd !== null);
	document.body.innerHTML = renderBrowserReport(current, view, false, 'badge');
	expect(document.querySelector('.hot')).toBeNull();
	expect(document.querySelector('.player-state')).toBeNull();
});
it.each([474, 475, 475.01, null])('flags only the Time to Damage cell when %s ms qualifies and respects highlighting', (timeToDamageMs) => {
	const current = snapshot();
	const row = current.rows[0];
	row.metrics = { ...emptyMetrics(), timeToDamageMs };
	row.assessment = assess(row.metrics);
	const view = { selectedId: null, tab: 'leetify' as const, details: false };
	document.body.innerHTML = renderBrowserReport(current, view, true, 'badge');
	const flagged = timeToDamageMs === 474 || timeToDamageMs === 475;
	expect(document.querySelector('tbody td:nth-child(4)')!.classList.contains('hot')).toBe(flagged);
	expect(document.querySelector('tbody td:nth-child(3)')!.classList.contains('hot')).toBe(false);
	expect(document.querySelector('tbody td:last-child')!.classList.contains('hot')).toBe(false);
	expect(document.querySelector('.player-state')?.textContent ?? '').toBe(flagged ? 'Suspicious Time to Damage' : '');
	expect(document.querySelector('.inspector')!.textContent!.includes('Plugin rule: Time to Damage ≤ 475 ms')).toBe(flagged);
	document.body.innerHTML = renderBrowserReport(current, view, false, 'badge');
	expect(document.querySelector('.hot')).toBeNull();
	expect(document.querySelector('.player-state')).toBeNull();
});
it('closes only profile input using X or Escape, restores focus and retains the draft', async () => {
	vi.useFakeTimers();
	const root = document.createElement('main');
	document.body.append(root);
	const rpc = vi.fn(async () => JSON.stringify({ snapshot: snapshot(), highlightEnabled: true }));
	const stop = mountBrowserReport(root, 'token', 'badge', rpc);
	try {
		await vi.advanceTimersByTimeAsync(0);
		root.querySelector<HTMLButtonElement>('[data-action=add-toggle]')!.click();
		const input = root.querySelector('textarea')!;
		input.value = 'sample_name';
		const closeInput = root.querySelector<HTMLButtonElement>('form button[aria-label="Close profile input"]');
		expect(closeInput).not.toBeNull();
		closeInput!.click();
		expect(root.querySelector('form')!.hidden).toBe(true);
		expect(root.querySelector('.roster-table')).not.toBeNull();
		expect(document.activeElement).toBe(root.querySelector('[data-action=add-toggle]'));
		root.querySelector<HTMLButtonElement>('[data-action=add-toggle]')!.click();
		expect(input.value).toBe('sample_name');
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(root.querySelector('form')!.hidden).toBe(true);
		expect(root.querySelector('.roster-table')).not.toBeNull();
	} finally { stop(); }
});
it('shows unavailable providers inside their own tab and keeps all site links usable', () => {
	document.body.innerHTML = renderBrowserReport(snapshot(), { selectedId: null, tab: 'faceit', details: false }, true, 'badge');
	expect(document.querySelector('[role=tabpanel]')!.textContent).toContain('Private');
	expect(document.querySelector('a[href="https://csrep.gg/"]')).not.toBeNull();
	document.body.innerHTML = renderBrowserReport(snapshot(), { selectedId: null, tab: 'csstats', details: false }, false, 'badge');
	expect(document.querySelector('a[href="https://csstats.gg/player/76561197960265729"]')).not.toBeNull();
	expect(document.querySelector('.hot')).toBeNull();
});
it('retains provider tab across player updates, preserves pasted input, and routes browser actions', async () => {
	vi.useFakeTimers();
	const root = document.createElement('main');
	document.body.append(root);
	let current = snapshot();
	const rpc = vi.fn(async () => JSON.stringify({ snapshot: current, highlightEnabled: true }));
	const stop = mountBrowserReport(root, 'token', 'badge', rpc);
	const click = (selector: string) => root.querySelector<HTMLElement>(selector)!.click();
	try {
		await vi.advanceTimersByTimeAsync(0);
		click('[data-tab=faceit]');
		click('[data-action=add-toggle]');
		root.querySelector('textarea')!.value = '[U:1:10]\n[U:1:20]';
		current = { ...current, message: 'Updated' };
		await vi.advanceTimersByTimeAsync(1000);
		expect(root.querySelector('[data-tab=faceit]')!.getAttribute('aria-selected')).toBe('true');
		expect(root.querySelector('textarea')!.value).toBe('[U:1:10]\n[U:1:20]');
		root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
		await vi.advanceTimersByTimeAsync(0);
		expect(rpc).toHaveBeenLastCalledWith({ token: 'token', action: 'add', input: '[U:1:10]\n[U:1:20]' });
		click('[data-action=close]');
		const calls = rpc.mock.calls.length;
		await vi.advanceTimersByTimeAsync(5000);
		expect(rpc).toHaveBeenCalledTimes(calls);
		expect(root.textContent).toContain('Report closed');
	} finally {
		stop();
	}
});
it('does not drop a user refresh while a snapshot request is pending', async () => {
	vi.useFakeTimers();
	const root = document.createElement('main');
	document.body.append(root);
	const payload = JSON.stringify({ snapshot: snapshot(), highlightEnabled: true });
	let release!: (value: string) => void;
	const rpc = vi.fn(async (_args: { token: string; action: string; input: string }) => payload);
	const stop = mountBrowserReport(root, 'token', 'badge', rpc);
	try {
		await vi.advanceTimersByTimeAsync(0);
		rpc.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = resolve;
				}),
		);
		await vi.advanceTimersByTimeAsync(1000);
		root.querySelector<HTMLElement>('[data-action=refresh]')!.click();
		release(payload);
		await vi.advanceTimersByTimeAsync(0);
		expect(rpc).toHaveBeenLastCalledWith({ token: 'token', action: 'refresh', input: '' });
	} finally {
		stop();
	}
});
it('sends replacement input and falls back from broken avatar images across updates', async () => {
	vi.useFakeTimers();
	const root = document.createElement('main');
	document.body.append(root);
	const current = snapshot();
	current.rows[0].player.avatarUrl = `https://avatars.steamstatic.com/${'a'.repeat(40)}_medium.jpg`;
	const rpc = vi.fn(async () => JSON.stringify({ snapshot: current, highlightEnabled: true }));
	const stop = mountBrowserReport(root, 'token', 'badge', rpc);
	try {
		await vi.advanceTimersByTimeAsync(0);
		root.querySelector<HTMLImageElement>('.avatar img')!.dispatchEvent(new Event('error'));
		current.message = 'Changed';
		await vi.advanceTimersByTimeAsync(1000);
		expect(root.querySelector('.avatar img')).toBeNull();
		root.querySelector<HTMLButtonElement>('[data-action=add-toggle]')!.click();
		root.querySelector('textarea')!.value = 'https://steamcommunity.com/profiles/76561199249862155/';
		root.querySelector<HTMLButtonElement>('button[value=replace]')!.click();
		await vi.advanceTimersByTimeAsync(0);
		expect(rpc).toHaveBeenLastCalledWith({ token: 'token', action: 'replace', input: 'https://steamcommunity.com/profiles/76561199249862155/' });
	} finally {
		stop();
	}
});
it('refreshes a row without selecting it or resetting the provider tab, and disables loading/stale rows', async () => {
	vi.useFakeTimers();
	const root = document.createElement('main');
	document.body.append(root);
	const current = snapshot();
	const second = { ...current.rows[0], player: { ...current.rows[0].player, steamId: '76561197960265730', displayName: 'Second player' } };
	current.rows.push(second);
	current.roster.players.push(second.player);
	const rpc = vi.fn(async () => JSON.stringify({ snapshot: current, highlightEnabled: true }));
	const stop = mountBrowserReport(root, 'token', 'badge', rpc);
	try {
		await vi.advanceTimersByTimeAsync(0);
		root.querySelector<HTMLButtonElement>('[data-tab=faceit]')!.click();
		const button = root.querySelector<HTMLButtonElement>('[data-refresh-player="76561197960265730"]');
		expect(button).not.toBeNull();
		expect(button!.getAttribute('aria-label')).toBe('Refresh stats for Second player');
		button!.click();
		await vi.advanceTimersByTimeAsync(0);
		expect(rpc).toHaveBeenLastCalledWith({ token: 'token', action: 'refresh-player', input: '76561197960265730' });
		expect(root.querySelector<HTMLButtonElement>('[data-refresh-player="76561197960265730"]')!.disabled).toBe(false);
		expect(root.querySelector('tr.selected')?.getAttribute('data-player')).toBe('76561197960265729');
		expect(root.querySelector('[data-tab=faceit]')?.getAttribute('aria-selected')).toBe('true');
		current.rows[1] = { ...second, providers: { ...second.providers, steam: { status: 'loading', data: null, fetchedAt: null } } };
		await vi.advanceTimersByTimeAsync(1000);
		expect(root.querySelector<HTMLButtonElement>('[data-refresh-player="76561197960265730"]')!.disabled).toBe(true);
		current.state = 'stale';
		await vi.advanceTimersByTimeAsync(1000);
		expect([...root.querySelectorAll<HTMLButtonElement>('[data-refresh-player]')].every(b => b.disabled)).toBe(true);
	} finally { stop(); }
});
