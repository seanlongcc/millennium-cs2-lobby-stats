import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
vi.mock('react-dom/client', async (importOriginal) => {
	const real = await importOriginal<typeof import('react-dom/client')>();
	return { ...real, createRoot: vi.fn(real.createRoot) };
});
import { afterEach, expect, it, vi } from 'vitest';
import type { ReportSnapshot } from '../shared/report';
import { emptyMetrics, assess } from '../frontend/report/rules';
import { normalizeCoplay } from '../frontend/steam/roster';
// Steam webpack is unavailable in jsdom. Replace only the native rendering boundary;
// these tests exercise our panel behavior, not the look or discovery of Steam components.
vi.mock('@steambrew/client', () => ({
	classMapList: [
		{ Toolbar: 'inactive-toolbar', ToolbarContainer: 'inactive-container', ToolbarButton: 'inactive-button' },
		{ Toolbar: 'steam-toolbar', ToolbarContainer: 'steam-toolbar-container', ToolbarButton: 'steam-toolbar-button' },
	],
	IconsModule: { Search: () => <svg viewBox="0 0 24 24" /> },
	showModal: vi.fn(),
	ModalRoot: ({ children }: any) => <>{children}</>,
	DialogHeader: ({ children, ...props }: any) => <h2 {...props}>{children}</h2>,
	DialogSubHeader: ({ children, ...props }: any) => <div {...props}>{children}</div>,
	DialogBody: ({ children, ...props }: any) => <div {...props}>{children}</div>,
	DialogBodyText: ({ children, ...props }: any) => <div {...props}>{children}</div>,
	DialogControlsSection: ({ children, ...props }: any) => <section {...props}>{children}</section>,
	DialogControlsSectionHeader: ({ children, ...props }: any) => <h3 {...props}>{children}</h3>,
	DialogFooter: ({ children, ...props }: any) => <footer {...props}>{children}</footer>,
	DialogButtonPrimary: ({ children, ...props }: any) => <button {...props}>{children}</button>,
	DialogButtonSecondary: ({ children, ...props }: any) => <button {...props}>{children}</button>,
	Focusable: React.forwardRef(({ children, ...props }: any, ref: any) => (
		<div ref={ref} {...props}>
			{children}
		</div>
	)),
	Field: ({ label, children, className, onActivate, onClick }: any) => (
		<div className={className} onClick={onClick ?? onActivate}>
			{label}
			{children}
		</div>
	),
	TextField: ({ label, ...props }: any) => (
		<label>
			{label}
			<input {...props} />
		</label>
	),
	ScrollPanel: ({ children }: any) => <div>{children}</div>,
	ScrollPanelGroup: ({ children }: any) => <div>{children}</div>,
	ProgressBar: ({ nProgress }: any) => <progress value={nProgress} max="100" />,
	SteamSpinner: () => null,
	Navigation: { NavigateToExternalWeb: vi.fn() },
	constSysfsExpr: (name: string) => ({ content: name.endsWith('.css') ? '' : 'badge' }),
}));
import { CompatibilityNotice, createDiagnostics, nativeComponentErrors } from '../frontend/steam/compatibility';
import { startOverlayHosts } from '../frontend/steam/overlay-host';
import { ReportPanel } from '../frontend/report/ReportPanel';
import { Navigation } from '@steambrew/client';
import type { ReportController } from '../frontend/report/controller';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(() => {
	act(() => root?.unmount());
	root = undefined;
	document.body.innerHTML = '';
	vi.clearAllMocks();
});
function mount(count = 32) {
	const roster = normalizeCoplay({ currentUsers: Array.from({ length: count }, (_, i) => ({ appid: 730, accountid: i + 1 })) }, null, 1000);
	let snapshot: ReportSnapshot = {
		id: 1,
		roster,
		state: 'complete',
		rows: roster.players.map((player, i) => {
			const metrics = {
				...emptyMetrics(),
				name: i === 0 ? '<img src=x onerror=alert(1)>' : `Player ${i + 1}`,
				leetifyRating: 2,
				leetifyAim: 95,
				timeToDamageMs: i === 0 ? 400 : null,
				recentKd: i === 0 ? 2 : 1,
				recentMatches: 20,
			};
			return {
				player,
				metrics,
				assessment: assess(metrics),
				providers: {
					leetify: { status: 'ok', data: metrics, fetchedAt: 1000 },
					faceit: { status: 'private', data: null, fetchedAt: null },
					steam: { status: 'ok', data: { cs2Hours: 0 }, fetchedAt: 1000 },
				},
			};
		}),
	};
	const listeners = new Set<() => void>();
	const controller: ReportController = {
		getSnapshot: () => snapshot,
		subscribe: (cb) => {
			listeners.add(cb);
			return () => {
				listeners.delete(cb);
			};
		},
		scan: vi.fn(async () => {}),
		refreshPlayer: vi.fn(),
		addProfiles: vi.fn(async () => {}),
		cancel: vi.fn(),
		close: vi.fn(),
		dispose: vi.fn(),
	};
	const opener = document.createElement('button');
	opener.textContent = 'Scan players';
	document.body.append(opener);
	opener.focus();
	const container = document.createElement('div');
	document.body.append(container);
	root = createRoot(container);
	const onClose = vi.fn();
	act(() => root!.render(<ReportPanel controller={controller} onClose={onClose} highlightEnabled />));
	return {
		controller,
		onClose,
		opener,
		update: (next: ReportSnapshot) =>
			act(() => {
				snapshot = next;
				listeners.forEach((fn) => fn());
			}),
		snapshot: () => snapshot,
		render: (highlight: boolean) => act(() => root!.render(<ReportPanel controller={controller} onClose={onClose} highlightEnabled={highlight} />)),
	};
}
const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === label)!;
const click = async (label: string) => {
	await act(async () => button(label).click());
};
it('renders every player, compact coverage and explicit metric units with literal names', () => {
	mount();
	expect(document.querySelectorAll('[data-cs2-player]')).toHaveLength(32);
	expect(document.body.textContent).toContain('32 detected by Steam · Coverage unverified');
	expect(document.body.textContent).toContain('Team unknown');
	expect(document.body.textContent).toContain('400 ms');
	expect(document.body.textContent).toContain('Unavailable');
	expect(document.body.textContent).toContain('<img src=x onerror=alert(1)>');
	expect(document.querySelector('img[src="x"]')).toBeNull();
	expect(document.body.textContent).not.toContain('95%');
	expect(document.body.textContent).not.toContain('No rule triggered');
});
it('shows a standalone Time to Damage flag at 475 ms and clears it above the threshold', () => {
	const h = mount(1);
	const updateTime = (timeToDamageMs: number) => {
		const current = h.snapshot();
		const metrics = { ...emptyMetrics(), timeToDamageMs };
		h.update({ ...current, rows: [{ ...current.rows[0], metrics, assessment: assess(metrics) }] });
	};
	updateTime(475);
	expect(document.querySelector('[data-cs2-player]')!.classList.contains('cs2-tracker-flag')).toBe(true);
	expect(document.body.textContent).toContain('Suspicious Time to Damage');
	expect(document.querySelector('[role=tabpanel]')!.textContent).toContain('Plugin rule: Time to Damage ≤ 475 ms');
	h.render(false);
	expect(document.querySelector('.cs2-tracker-flag')).toBeNull();
	h.render(true);
	updateTime(476);
	expect(document.querySelector('.cs2-tracker-flag')).toBeNull();
	expect(document.body.textContent).not.toContain('Suspicious Time to Damage');
});
it('keeps provider order and selection, preserves tab across players, resets it on refresh', async () => {
	const h = mount(2);
	expect([...document.querySelectorAll('[role=tab]')].map((x) => x.textContent)).toEqual(['Leetify', 'CSStats', 'FACEIT', 'Steam']);
	await click('FACEIT');
	expect(document.body.textContent).toContain('Private');
	await act(async () => document.querySelectorAll<HTMLElement>('[data-cs2-player] button')[1].click());
	expect(button('FACEIT').getAttribute('aria-selected')).toBe('true');
	expect(h.controller.scan).not.toHaveBeenCalled();
	h.update({ ...h.snapshot(), id: 2 });
	expect(button('Leetify').getAttribute('aria-selected')).toBe('true');
});
it('keeps fixed site actions across every tab and constructs CSStats only from validated IDs', async () => {
	mount(1);
	for (const tab of ['Leetify', 'CSStats', 'FACEIT', 'Steam']) {
		await click(tab);
		await click('CSRep');
		await click('CSTracker');
	}
	expect(Navigation.NavigateToExternalWeb).toHaveBeenCalledWith('https://csrep.gg/');
	expect(Navigation.NavigateToExternalWeb).toHaveBeenCalledWith('https://cstracker.gg/');
	await click('CSStats');
	await click('View on CSStats');
	expect(Navigation.NavigateToExternalWeb).toHaveBeenLastCalledWith('https://csstats.gg/player/76561197960265729');
});
it('discloses provenance on demand and toggles highlighting without changing metrics', async () => {
	const h = mount(1);
	expect(document.body.textContent).toContain('Plugin rule: ≥ 2.00 K/D · min. 20 matches');
	expect(document.body.textContent).not.toContain('Leetify benchmark comparison unavailable');
	await click('Data details');
	expect(document.body.textContent).toContain('Leetify benchmark comparison unavailable');
	expect(document.body.textContent).toContain('latest 30 tracked games');
	expect(document.querySelector('img[alt="Leetify"]')).not.toBeNull();
	h.render(false);
	expect(document.querySelector('.cs2-tracker-flag')).toBeNull();
});
it('preserves multiline pasted identities and routes actions to controller', async () => {
	const h = mount(1);
	await click('Add profile links');
	const input = document.querySelector('input')!;
	const e = new Event('paste', { bubbles: true, cancelable: true });
	Object.defineProperty(e, 'clipboardData', { value: { getData: () => '[U:1:10]\n[U:1:20]' } });
	await act(async () => input.dispatchEvent(e));
	await click('Add players');
	expect(h.controller.addProfiles).toHaveBeenCalledWith('[U:1:10]\n[U:1:20]');
	await click('Refresh report');
	expect(h.controller.scan).toHaveBeenCalledTimes(1);
	h.update({ ...h.snapshot(), state: 'loading' });
	await click('Cancel');
	expect(h.controller.cancel).toHaveBeenCalledTimes(1);
});
it('closes on Escape without propagating to Steam, then restores launcher focus', async () => {
	const h = mount(1);
	const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
	await act(async () => button('Refresh report').dispatchEvent(e));
	expect(e.defaultPrevented).toBe(true);
	expect(h.onClose).toHaveBeenCalledTimes(1);
	expect(h.controller.close).toHaveBeenCalledTimes(1);
	act(() => root!.unmount());
	root = undefined;
	expect(document.activeElement).toBe(h.opener);
});
it('renders empty and unavailable roster states without claiming completeness', () => {
	const h = mount(0);
	expect(document.body.textContent).toContain('No roster available');
	expect(document.body.textContent).toContain('Retry or add profiles.');
	h.update({ ...h.snapshot(), roster: { ...h.snapshot().roster, state: 'unavailable', message: 'Automatic roster discovery is unavailable on this Steam version.' } });
	expect(document.body.textContent).toContain('Automatic roster discovery is unavailable on this Steam version.');
});
it('keeps uneven verified teams, spectators and unknown players visible', () => {
	const h = mount(19);
	const s = h.snapshot();
	const teams = s.roster.players.map((p, i) => ({
		...p,
		team: (i < 7 ? 'your_team' : i < 16 ? 'opponents' : i === 16 ? 'spectators' : i === 17 ? 'free_for_all' : 'unknown') as typeof p.team,
		teamSource: (i === 18 ? 'unavailable' : 'verified_live') as typeof p.teamSource,
		teamObservedAt: i === 18 ? null : 1000,
	}));
	h.update({ ...s, roster: { ...s.roster, players: teams } });
	expect(document.querySelectorAll('[data-cs2-player]')).toHaveLength(19);
	for (const label of ['Your team · 7', 'Opponents · 9', 'Spectators · 1', 'Free-for-all · 1', 'Team unknown · 1']) expect(document.body.textContent).toContain(label);
});
it('shows completion progress and supports arrow-key provider navigation', async () => {
	const h = mount(2);
	const s = h.snapshot();
	h.update({
		...s,
		state: 'loading',
		rows: [s.rows[0], { ...s.rows[1], providers: { ...s.rows[1].providers, leetify: { status: 'loading', data: null, fetchedAt: null } } }],
	});
	expect(document.querySelector('progress')?.value).toBe(50);
	expect(document.body.textContent).toContain('1/2 ready');
	await act(async () => button('Leetify').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
	expect(button('CSStats').getAttribute('aria-selected')).toBe('true');
	expect(document.activeElement).toBe(button('CSStats'));
});

it('shows compatibility failures in a native diagnostic and removes partial host mounts', () => {
	const diagnostics = createDiagnostics();
	const el = document.createElement('div');
	document.body.append(el);
	root = createRoot(el);
	act(() => root!.render(<CompatibilityNotice diagnostics={diagnostics} />));
	act(() => diagnostics.set(['Overlay activation unavailable.']));
	expect(document.body.textContent).toContain('Overlay activation unavailable.');
	expect(nativeComponentErrors({}).join(' ')).toMatch(/DialogButtonSecondary/);
	const runtime = {
		overlayHosts: () => [{ key: 'cs2', appId: 730, window }],
		readCoplay: async () => ({ currentUsers: [] }),
		currentUserId: () => null,
		onOverlayActive: () => () => {},
		onAppExit: () => () => {},
	};
	const styles = document.head.querySelectorAll('style').length;
	vi.mocked(createRoot).mockImplementationOnce(() => {
		throw Error('Root unavailable');
	});
	const stop = startOverlayHosts(
		runtime,
		() => {},
		(message) => diagnostics.set([message]),
	);
	expect(document.querySelector('[data-cs2-tracker-button]')).toBeNull();
	expect(document.head.querySelectorAll('style')).toHaveLength(styles);
	expect(diagnostics.getSnapshot().join(' ')).toContain('Root unavailable');
	stop();
});

function overlayRuntime() {
	return {
		overlayHosts: () => [{ key: 'cs2', appId: 730, window }],
		readCoplay: async () => ({ currentUsers: [] }),
		currentUserId: () => null,
		onOverlayActive: () => () => {},
		onAppExit: () => () => {},
	};
}
function steamToolbar() {
	const shell = document.createElement('div');
	shell.className = 'steam-toolbar-container';
	shell.innerHTML = '<div class="steam-toolbar"><button class="steam-toolbar-button">Settings</button><button class="steam-toolbar-button">Minimize</button></div>';
	document.body.append(shell);
	return shell.firstElementChild as HTMLElement;
}
it('places an accessible scan icon in the native toolbar and removes it on unload', async () => {
	const toolbar = steamToolbar();
	const runtime = overlayRuntime();
	const onScan = vi.fn();
	const styleCount = document.head.querySelectorAll('style').length;
	let stop = () => {};
	await act(async () => {
		stop = startOverlayHosts(runtime, onScan);
	});
	try {
		const scan = toolbar.querySelector<HTMLButtonElement>('button[aria-label="Scan players"]');
		expect(scan).not.toBeNull();
		expect(scan!.querySelector('svg')).not.toBeNull();
		expect(scan!.textContent).toBe('');
		expect(scan!.title).toBe('Scan players');
		expect(scan!.classList.contains('steam-toolbar-button')).toBe(true);
		expect(toolbar.lastElementChild!.textContent).toBe('Minimize');
		await act(async () => scan!.click());
		expect(onScan).toHaveBeenCalledExactlyOnceWith(runtime.overlayHosts()[0]);
	} finally {
		act(stop);
	}
	expect(document.querySelector('[data-cs2-tracker-button]')).toBeNull();
	expect(toolbar.querySelectorAll('button')).toHaveLength(2);
	expect(document.head.querySelectorAll('style')).toHaveLength(styleCount);
});
it('waits for Steam toolbar creation and reattaches once after toolbar replacement', async () => {
	let stop = () => {};
	await act(async () => {
		stop = startOverlayHosts(overlayRuntime(), () => {});
	});
	try {
		expect(document.querySelector('[data-cs2-tracker-button]')).toBeNull();
		let toolbar: HTMLElement;
		await act(async () => {
			toolbar = steamToolbar();
		});
		const scan = document.querySelector('button[aria-label="Scan players"]');
		expect(scan).not.toBeNull();
		await act(async () => {
			toolbar.parentElement!.remove();
			toolbar = steamToolbar();
		});
		expect(toolbar!.contains(scan)).toBe(true);
		expect(document.querySelectorAll('[data-cs2-tracker-button]')).toHaveLength(1);
	} finally {
		act(stop);
	}
	await act(async () => {
		steamToolbar();
	});
	expect(document.querySelector('[data-cs2-tracker-button]')).toBeNull();
});
