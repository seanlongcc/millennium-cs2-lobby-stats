import type { Assessment, Metrics } from '../../shared/report';
export function emptyMetrics(): Metrics {
	return {
		leetifyRating: null,
		leetifyAim: null,
		leetifyUtility: null,
		leetifyPositioning: null,
		timeToDamageMs: null,
		crosshairPlacementDeg: null,
		spottedAccuracyPct: null,
		counterStrafingPct: null,
		name: null,
		premier: null,
		faceitLevel: null,
		faceitElo: null,
		recentKd: null,
		recentMatches: null,
		faceitKd: null,
		faceitHeadshotsPct: null,
		faceitWinratePct: null,
		faceitMatches: null,
		cs2Hours: null,
		memberSince: null,
	};
}
export function assess(metrics: Metrics): Assessment {
	const { recentKd: kd, recentMatches: matches } = metrics;
	const eligible = typeof kd === 'number' && Number.isFinite(kd) && kd >= 0 && typeof matches === 'number' && Number.isInteger(matches) && matches >= 20;
	if (!eligible) return { version: 'rules-v2-leetify', label: 'insufficient_data', evidence: [] };
	if (kd < 2) return { version: 'rules-v2-leetify', label: 'no_flags', evidence: [] };
	return {
		version: 'rules-v2-leetify',
		label: 'unusual',
		evidence: [{ ruleId: 'recent-kd', category: 'kd', provider: 'leetify', thresholdSource: 'plugin', value: kd, threshold: 2, matches, window: 'recent' }],
	};
}
