import { DialogBodyText, DialogButtonSecondary, Field, Focusable } from '@steambrew/client';
import type { ReportRow } from '../../shared/report';
export const value = (n: number | null | undefined, digits = 0, suffix = '') => (n == null ? 'Unavailable' : `${n.toFixed(digits)}${suffix}`);
export function PlayerRow({ row, highlightEnabled, selected = false, onSelect }: { row: ReportRow; highlightEnabled: boolean; selected?: boolean; onSelect?: () => void }) {
	const m = row.metrics,
		flag = highlightEnabled && row.assessment.label === 'unusual';
	return (
		<Focusable role="listitem" data-cs2-player={row.player.steamId} className={`cs2-tracker-player${flag ? ' cs2-tracker-flag' : ''}`}>
			<Field
				padding="compact"
				label={
					<DialogButtonSecondary aria-pressed={selected} onClick={onSelect}>
						{m.name ?? row.player.steamId}
						{row.player.origin === 'self' ? ' · You' : ''}
					</DialogButtonSecondary>
				}
			>
				{flag && <DialogBodyText>High K/D</DialogBodyText>}
			</Field>
			<Focusable className="cs2-tracker-overview">
				<Field padding="compact" label="Leetify Rating">
					<DialogBodyText>{value(m.leetifyRating, 2)}</DialogBodyText>
				</Field>
				<Field padding="compact" label="Aim">
					<DialogBodyText>{value(m.leetifyAim)}</DialogBodyText>
				</Field>
				<Field padding="compact" label="Time to Damage">
					<DialogBodyText>{value(m.timeToDamageMs, 0, ' ms')}</DialogBodyText>
				</Field>
				<Field padding="compact" label="Recent K/D">
					<DialogBodyText>
						{value(m.recentKd, 2)}
						{m.recentMatches !== null ? ` · ${m.recentMatches} matches` : ''}
					</DialogBodyText>
				</Field>
			</Focusable>
		</Focusable>
	);
}
