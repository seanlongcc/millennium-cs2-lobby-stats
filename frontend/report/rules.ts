import type { Assessment, Evidence, Metrics } from '../../shared/report';
import { SUSPICIOUS_AIM_THRESHOLD, SUSPICIOUS_TTD_THRESHOLD_MS, suspiciousTimeToDamage, validAim, validTimeToDamage } from '../../shared/assessment';
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
	const { recentKd: kd, recentMatches: matches, leetifyAim: aim, timeToDamageMs: ttd } = metrics;
	const eligible = typeof kd === 'number' && Number.isFinite(kd) && kd >= 0 && typeof matches === 'number' && Number.isInteger(matches) && matches >= 20;
	const evidence: Evidence[] = [];
	if (validAim(aim) && aim >= SUSPICIOUS_AIM_THRESHOLD) {
		evidence.push({ ruleId: 'high-aim', category: 'aim', provider: 'leetify', thresholdSource: 'plugin', value: aim, threshold: SUSPICIOUS_AIM_THRESHOLD });
	}
	if (suspiciousTimeToDamage(ttd)) {
		evidence.push({ ruleId: 'low-ttd', category: 'ttd', provider: 'leetify', thresholdSource: 'plugin', value: ttd, threshold: SUSPICIOUS_TTD_THRESHOLD_MS });
	}
	if (eligible && kd >= 2) {
		evidence.push({ ruleId: 'recent-kd', category: 'kd', provider: 'leetify', thresholdSource: 'plugin', value: kd, threshold: 2, matches, window: 'recent' });
	}
	return {
		version: 'rules-v4-leetify',
		label: evidence.length ? 'unusual' : eligible || validAim(aim) || validTimeToDamage(ttd) ? 'no_flags' : 'insufficient_data',
		evidence,
	};
}
