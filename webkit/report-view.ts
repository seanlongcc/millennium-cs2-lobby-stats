import type { ProviderTab, ReportRow, ReportSnapshot, TeamGroup } from '../shared/report';
import { groupRoster, validSteamId } from '../frontend/steam/roster';
import { steamAvatarUrl } from '../shared/steam-avatar';
import { assessmentSummary, evidenceDescription } from '../shared/assessment';

export type ReportViewState = { selectedId: string | null; tab: ProviderTab; details: boolean };
export const providerTabs: ProviderTab[] = ['leetify', 'csstats', 'faceit', 'steam'];
export const escapeHtml = (value: unknown) =>
	String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const value = (n: number | null | undefined, digits = 0, suffix = '') =>
	n == null ? 'Unavailable' : `${n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}${suffix}`;
const summary = (n: number | null | undefined, digits = 0, suffix = '') => (n == null ? '<abbr title="Unavailable">N/A</abbr>' : value(n, digits, suffix));
const names: Record<TeamGroup, string> = { opponents: 'Opponents', your_team: 'Your team', spectators: 'Spectators', unknown: 'Team unknown', free_for_all: 'Free-for-all' };
const labels: Record<ProviderTab, string> = { leetify: 'Leetify', csstats: 'CSStats', faceit: 'FACEIT', steam: 'Steam' };
const link = (label: string, url: string) => `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)} ↗</a>`;
const fact = (label: string, data: string) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(data)}</dd></div>`;
function identity(row: ReportRow, highlight: boolean) {
	const name = row.player.displayName ?? row.metrics.name ?? row.player.steamId;
	const avatar = steamAvatarUrl(row.player.avatarUrl);
	return `<span class="who"><span class="avatar" aria-hidden="true">${escapeHtml(name[0]?.toUpperCase())}${avatar ? `<img src="${escapeHtml(avatar)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}</span><span class="who-text"><span class="player-name">${escapeHtml(name)}${row.player.origin === 'self' ? ' · You' : ''}</span>${highlight && row.assessment.label === 'unusual' ? `<span class="player-state hot">${escapeHtml(assessmentSummary(row.assessment))}</span>` : ''}</span></span>`;
}
function profile(row: ReportRow, state: ReportViewState, highlight: boolean) {
	const m = row.metrics,
		id = row.player.steamId,
		valid = validSteamId(id);
	const provider = state.tab === 'csstats' ? null : row.providers[state.tab];
	const statuses = {
		loading: 'Loading…',
		not_found: 'No public data',
		private: 'Private',
		unauthorized: 'Access unavailable',
		rate_limited: 'Rate limited',
		error: 'Unavailable',
		canceled: 'Canceled',
		ok: '',
	};
	let content = provider && provider.status !== 'ok' ? `<p class="source-context" role="status">${statuses[provider.status]}</p>` : '';
	if (state.tab === 'leetify') {
		content += `<p class="source-context">Profile aggregates · K/D from last 30 tracked games</p><dl class="facts">${[
			fact('Leetify Rating', value(m.leetifyRating, 2)),
			fact('Aim', value(m.leetifyAim)),
			fact('Utility', value(m.leetifyUtility)),
			fact('Positioning', value(m.leetifyPositioning)),
			fact('Time to Damage', value(m.timeToDamageMs, 0, ' ms')),
			fact('Crosshair placement', value(m.crosshairPlacementDeg, 1, '°')),
			fact('Accuracy (Enemy Spotted)', value(m.spottedAccuracyPct, 1, '%')),
			fact('Proper Counter-Strafing', value(m.counterStrafingPct, 1, '%')),
			fact('Premier', value(m.premier)),
			fact('K/D · Last 30 games', `${value(m.recentKd, 2)}${m.recentMatches !== null ? ` · ${m.recentMatches}/30 games` : ''}`),
		].join('')}</dl>`;
		if (highlight) content += row.assessment.evidence.map(evidence => `<p class="review-note hot">${escapeHtml(evidenceDescription(evidence))}</p>`).join('');
		if (valid) content += `<div class="data-actions">${link('View on Leetify', `https://leetify.com/app/profile/${id}`)}</div>`;
	} else if (state.tab === 'faceit') {
		content += `<p class="source-context">Lifetime statistics</p><dl class="facts">${[
			fact('Level', value(m.faceitLevel)),
			fact('ELO', value(m.faceitElo)),
			fact('Lifetime K/D', value(m.faceitKd, 2)),
			fact('Headshots', value(m.faceitHeadshotsPct, 1, '%')),
			fact('Win rate', value(m.faceitWinratePct, 1, '%')),
			fact('Lifetime matches', value(m.faceitMatches)),
		].join(
			'',
		)}</dl><div class="data-actions">${link('View on FACEIT', row.providers.faceit.data?.name ? `https://www.faceit.com/en/players/${encodeURIComponent(row.providers.faceit.data.name)}` : 'https://www.faceit.com/')}</div>`;
	} else if (state.tab === 'steam') {
		content += `<dl class="facts">${fact('SteamID64', id)}${fact('CS2 hours', value(m.cs2Hours, 1))}${fact('Member since', m.memberSince ?? 'Unavailable')}</dl>`;
		if (valid) content += `<div class="data-actions">${link('Steam profile', `https://steamcommunity.com/profiles/${id}`)}</div>`;
	} else {
		content += `<div class="provider-empty"><h3>View this player on CSStats</h3><p>CSStats statistics are available on its website.</p>${valid ? link('View on CSStats', `https://csstats.gg/player/${id}`) : ''}</div>`;
	}
	return `<p class="eyebrow">Player profile</p>${identity(row, highlight)}
		<div class="external-links">${link('CSRep', 'https://csrep.gg/')}${link('CSTracker', 'https://cstracker.gg/')}</div>
		<div class="provider-tabs" role="tablist" aria-label="Stats provider">${providerTabs.map((tab) => `<button type="button" class="provider-tab" id="cs2-tab-${tab}" role="tab" aria-selected="${state.tab === tab}" aria-controls="cs2-provider-panel" tabindex="${state.tab === tab ? 0 : -1}" data-tab="${tab}">${labels[tab]}</button>`).join('')}</div>
		<div role="tabpanel" id="cs2-provider-panel" aria-labelledby="cs2-tab-${state.tab}" tabindex="0">${content}</div>
		<button class="data-toggle" type="button" data-action="details" aria-expanded="${state.details}">Data details</button>
		${state.details ? `<p class="data-notes">${escapeHtml(assessmentSummary(row.assessment))}. K/D uses total kills ÷ total deaths within the latest 30 tracked games returned by Leetify. Missing records reduce the displayed sample; older games are not used to fill gaps. Other profile aggregates use Leetify’s own windows. Leetify benchmark comparison unavailable. Team assignments are unavailable from Steam coplay.${provider?.fetchedAt ? ` Updated ${escapeHtml(new Date(provider.fetchedAt).toLocaleString())}.` : ''}${provider?.message ? ` ${escapeHtml(provider.message)}` : ''}</p>` : ''}`;
}

export function renderBrowserReport(snapshot: ReportSnapshot, state: ReportViewState, highlight: boolean, badge: string) {
	const selected = snapshot.rows.find((row) => row.player.steamId === state.selectedId) ?? snapshot.rows[0];
	const auto = snapshot.roster.players.filter((p) => p.origin !== 'manual').length,
		manual = snapshot.roster.players.length - auto;
	const estimated = snapshot.roster.source === 'steam_recent_estimate';
	const coverage = [auto ? `${auto} ${estimated ? 'players · Estimated match' : 'Steam-reported players'}` : '', manual ? `${manual} added manually` : '', 'Current match unverified'].filter(Boolean).join(' · ');
	const completed = snapshot.rows.filter((row) => Object.values(row.providers).every((p) => p.status !== 'loading')).length;
	const unavailable = snapshot.rows.reduce((n, row) => n + Object.values(row.providers).filter((p) => !['ok', 'loading', 'canceled'].includes(p.status)).length, 0);
	const flagged = highlight ? snapshot.rows.filter((row) => row.assessment.label === 'unusual').length : 0;
	const groups = groupRoster(snapshot.roster.players)
		.map((group) => {
			const rows = group.players
				.map((player) => snapshot.rows.find((row) => row.player.steamId === player.steamId))
				.filter((row): row is ReportRow => !!row)
				.sort((a, b) => Number(highlight && b.assessment.label === 'unusual') - Number(highlight && a.assessment.label === 'unusual'));
			return `<section aria-label="${names[group.team]}"><div class="team-heading"><h3>${names[group.team]} · ${group.players.length}</h3></div>
			<table class="roster-table"><thead><tr><th scope="col">Player</th><th scope="col">Leetify Rating</th><th scope="col">Aim</th><th scope="col">Time to Damage</th><th scope="col">K/D · Last 30</th></tr></thead><tbody>${rows
				.map((row) => {
					const m = row.metrics,
						isSelected = selected?.player.steamId === row.player.steamId;
					const loading = Object.values(row.providers).some((provider) => provider.status === 'loading');
					const refreshLabel = escapeHtml(`Refresh stats for ${row.player.displayName ?? m.name ?? row.player.steamId}`);
					const refresh = `<button type="button" class="player-refresh" data-refresh-player="${escapeHtml(row.player.steamId)}" aria-label="${refreshLabel}" title="${refreshLabel}" ${loading || snapshot.state === 'stale' ? 'disabled' : ''}>${loading ? 'Loading…' : 'Refresh'}</button>`;
					return `<tr data-player="${escapeHtml(row.player.steamId)}" class="${isSelected ? 'selected' : ''}"><th scope="row"><div class="player-cell"><button type="button" class="player-select" data-select="${escapeHtml(row.player.steamId)}" aria-pressed="${isSelected}">${identity(row, highlight)}</button>${refresh}</div></th><td>${summary(m.leetifyRating, 2)}</td><td class="${highlight && row.assessment.evidence.some(e => e.category === 'aim') ? 'hot' : ''}">${summary(m.leetifyAim)}</td><td class="${highlight && row.assessment.evidence.some(e => e.category === 'ttd') ? 'hot' : ''}">${summary(m.timeToDamageMs, 0, ' ms')}</td><td class="${highlight && row.assessment.evidence.some(e => e.category === 'kd') ? 'hot' : ''}">${summary(m.recentKd, 2)}${m.recentMatches === null ? '' : `<small>${m.recentMatches}/30 games</small>`}</td></tr>`;
				})
				.join('')}</tbody></table></section>`;
		})
		.join('');
	return `<div class="report"><header class="titlebar"><div><p class="eyebrow">Counter-Strike 2 · Historical stats</p><h1>CS2 player report</h1><p class="subtitle">Captured ${escapeHtml(new Date(snapshot.roster.capturedAt).toLocaleTimeString())}</p></div><div class="action-row"><button class="action primary" data-action="refresh">Refresh report</button><button class="action" data-action="add-toggle">Add profile links</button>${snapshot.state === 'loading' ? '<button class="action" data-action="cancel">Cancel</button>' : ''}<button class="action" data-action="close">Close</button></div></header>
		<div class="coverage">${coverage}</div>
		${auto ? `<p class="roster-warning">${estimated ? `${escapeHtml(snapshot.roster.message)}${snapshot.roster.observedAt ? ` Latest Steam activity: ${escapeHtml(new Date(snapshot.roster.observedAt).toLocaleTimeString())}.` : ''}` : 'Steam’s list may include players from previous matches. For this match, paste profile links from the scoreboard and choose Replace list.'}</p>` : ''}
		<div class="progress-line"><span role="status">${escapeHtml(snapshot.message ?? `${completed}/${snapshot.rows.length} ready${unavailable ? ` · ${unavailable} provider results unavailable` : ''}`)}</span><span>${flagged} flagged</span></div>
		${snapshot.state === 'loading' ? `<progress aria-label="Report progress" max="${snapshot.rows.length || 1}" value="${completed}"></progress>` : ''}
		${snapshot.inputErrors?.length ? `<div class="input-errors" role="alert">${snapshot.inputErrors.map(escapeHtml).join('<br>')}</div>` : ''}
		<div class="split"><div class="roster" aria-label="Players">${groups || `<div class="empty"><h2>${snapshot.state === 'loading' ? 'Finding players…' : 'No roster available'}</h2><p>${escapeHtml(snapshot.roster.message ?? 'Retry or add profile links.')}</p></div>`}</div><aside class="inspector" aria-label="Player profile">${selected ? profile(selected, state, highlight) : '<p class="muted">Select a player to inspect their statistics.</p>'}</aside></div>
		<footer class="report-footer"><span>Flags are not proof of cheating.</span><a href="https://leetify.com/" target="_blank" rel="noreferrer" aria-label="Data provided by Leetify"><img alt="Leetify" height="20" src="${escapeHtml(badge)}"></a></footer></div>`;
}
