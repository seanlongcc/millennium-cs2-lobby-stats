import { useState } from 'react';
import { constSysfsExpr, DialogBodyText, DialogButtonSecondary, DialogControlsSection, DialogControlsSectionHeader, Field, Focusable, Navigation } from '@steambrew/client';
import type { ProviderTab, ReportRow } from '../../shared/report';
import { assessmentSummary, evidenceDescription } from '../../shared/assessment';
import { validSteamId } from '../steam/roster';
import { value } from './PlayerRow';
const badge = `data:image/png;base64,${constSysfsExpr('leetify-badge-white-small.png', { basePath: '../../static', encoding: 'base64' }).content}`;
const tabs: { id: ProviderTab; label: string }[] = [
	{ id: 'leetify', label: 'Leetify' },
	{ id: 'csstats', label: 'CSStats' },
	{ id: 'faceit', label: 'FACEIT' },
	{ id: 'steam', label: 'Steam' },
];
function Source({ label, url, disabled = false }: { label: string; url: string; disabled?: boolean }) {
	return (
		<DialogButtonSecondary disabled={disabled} onClick={() => Navigation.NavigateToExternalWeb(url)}>
			{label}
		</DialogButtonSecondary>
	);
}
export function PlayerProfile({
	row,
	providerTab,
	onProviderTab,
	highlightEnabled = true,
}: {
	row: ReportRow;
	providerTab: ProviderTab;
	onProviderTab: (tab: ProviderTab) => void;
	highlightEnabled?: boolean;
}) {
	const [details, setDetails] = useState(false);
	const m = row.metrics,
		id = row.player.steamId,
		valid = validSteamId(id);
	const selected = providerTab === 'csstats' ? null : row.providers[providerTab];
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
	const metric = (label: string, number: number | null | undefined, digits = 0, suffix = '') => (
		<Field key={label} padding="compact" label={label}>
			<DialogBodyText>{value(number, digits, suffix)}</DialogBodyText>
		</Field>
	);
	return (
		<DialogControlsSection>
			<DialogControlsSectionHeader>{m.name ?? id}</DialogControlsSectionHeader>
			<Focusable className="cs2-tracker-actions">
				<Source label="CSRep" url="https://csrep.gg/" />
				<Source label="CSTracker" url="https://cstracker.gg/" />
			</Focusable>
			<Focusable role="tablist" aria-label="Stats provider" className="cs2-tracker-tabs">
				{tabs.map((tab, i) => (
					<DialogButtonSecondary
						key={tab.id}
						id={`cs2-tab-${tab.id}`}
						role="tab"
						aria-selected={providerTab === tab.id}
						aria-controls="cs2-provider-panel"
						tabIndex={providerTab === tab.id ? 0 : -1}
						onClick={() => onProviderTab(tab.id)}
						onKeyDown={(event) => {
							const next =
								event.key === 'ArrowRight' ? (i + 1) % 4 : event.key === 'ArrowLeft' ? (i + 3) % 4 : event.key === 'Home' ? 0 : event.key === 'End' ? 3 : null;
							if (next !== null) {
								event.preventDefault();
								onProviderTab(tabs[next].id);
								event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus();
							}
						}}
					>
						{tab.label}
					</DialogButtonSecondary>
				))}
			</Focusable>
			<Focusable role="tabpanel" id="cs2-provider-panel" aria-labelledby={`cs2-tab-${providerTab}`} tabIndex={0}>
				{selected && selected.status !== 'ok' && <DialogBodyText role="status">{statuses[selected.status]}</DialogBodyText>}
				{providerTab === 'leetify' && (
					<>
						{metric('Leetify Rating', m.leetifyRating, 2)}
						{metric('Aim', m.leetifyAim)}
						{metric('Utility', m.leetifyUtility)}
						{metric('Positioning', m.leetifyPositioning)}
						{metric('Time to Damage', m.timeToDamageMs, 0, ' ms')}
						{metric('Crosshair placement', m.crosshairPlacementDeg, 1, '°')}
						{metric('Accuracy (Enemy Spotted)', m.spottedAccuracyPct, 1, '%')}
						{metric('Proper Counter-Strafing', m.counterStrafingPct, 1, '%')}
						{metric('Premier', m.premier)}
						<Field padding="compact" label="K/D · Last 30 games">
							<DialogBodyText>
								{value(m.recentKd, 2)}
								{m.recentMatches !== null ? ` · ${m.recentMatches} matches` : ''}
							</DialogBodyText>
						</Field>
						{highlightEnabled && row.assessment.evidence.map(evidence => (
							<DialogBodyText key={evidence.ruleId} className="cs2-tracker-flag">{evidenceDescription(evidence)}</DialogBodyText>
						))}
						<Focusable className="cs2-tracker-actions">
							<Source label="View on Leetify" url={`https://leetify.com/app/profile/${id}`} disabled={!valid} />
							<DialogButtonSecondary aria-label="Data provided by Leetify" onClick={() => Navigation.NavigateToExternalWeb('https://leetify.com/')}>
								<img src={badge} alt="Leetify" height={20} />
							</DialogButtonSecondary>
						</Focusable>
					</>
				)}
				{providerTab === 'csstats' && <Source label="View on CSStats" url={`https://csstats.gg/player/${id}`} disabled={!valid} />}
				{providerTab === 'faceit' && (
					<>
						{metric('Level', m.faceitLevel)}
						{metric('ELO', m.faceitElo)}
						{metric('Lifetime K/D', m.faceitKd, 2)}
						{metric('Headshots', m.faceitHeadshotsPct, 1, '%')}
						{metric('Win rate', m.faceitWinratePct, 1, '%')}
						{metric('Lifetime matches', m.faceitMatches)}
						<Source
							label="View on FACEIT"
							url={
								row.providers.faceit.data?.name
									? `https://www.faceit.com/en/players/${encodeURIComponent(row.providers.faceit.data.name)}`
									: 'https://www.faceit.com/'
							}
						/>
					</>
				)}
				{providerTab === 'steam' && (
					<>
						<Field padding="compact" label="SteamID64">
							<DialogBodyText>{id}</DialogBodyText>
						</Field>
						{metric('CS2 hours', m.cs2Hours, 1)}
						<Field padding="compact" label="Member since">
							<DialogBodyText>{m.memberSince ?? 'Unavailable'}</DialogBodyText>
						</Field>
						<Source label="Steam profile" url={`https://steamcommunity.com/profiles/${id}`} disabled={!valid} />
					</>
				)}
			</Focusable>
			<DialogButtonSecondary aria-expanded={details} onClick={() => setDetails(!details)}>
				Data details
			</DialogButtonSecondary>
			{details && (
				<DialogBodyText>
					{assessmentSummary(row.assessment)}. Recent K/D
					uses total kills ÷ total deaths within the latest 30 tracked games returned by Leetify. Missing records reduce the sample; older games do not fill gaps. Leetify benchmark comparison unavailable.
					Bots have no public human profile. Team assignments are unavailable from Steam coplay.
					{selected?.fetchedAt ? ` Updated ${new Date(selected.fetchedAt).toLocaleString()}.` : ''}
					{selected?.message ? ` ${selected.message}` : ''}
				</DialogBodyText>
			)}
		</DialogControlsSection>
	);
}
