import type { Assessment, Evidence } from './report';

export const SUSPICIOUS_AIM_THRESHOLD = 97;
export const validAim = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
export const SUSPICIOUS_TTD_THRESHOLD_MS = 475;
export const validTimeToDamage = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export const suspiciousTimeToDamage = (value: unknown): value is number => validTimeToDamage(value) && value <= SUSPICIOUS_TTD_THRESHOLD_MS;

export function assessmentSummary(assessment: Assessment): string {
	if (assessment.label === 'insufficient_data') return 'Insufficient data';
	if (assessment.label === 'no_flags') return 'No rule triggered';
	return assessment.evidence.map(e => {
		switch (e.ruleId) {
			case 'high-aim': return 'Suspicious aim';
			case 'low-ttd': return 'Suspicious Time to Damage';
			case 'recent-kd': return 'High K/D';
		}
	}).join(' · ');
}

export function evidenceDescription(evidence: Evidence): string {
	switch (evidence.ruleId) {
		case 'high-aim': return `Plugin rule: Aim ≥ ${evidence.threshold}`;
		case 'low-ttd': return `Plugin rule: Time to Damage ≤ ${evidence.threshold} ms`;
		case 'recent-kd': return `Plugin rule: ≥ ${evidence.threshold.toFixed(2)} K/D · min. 20 matches`;
	}
}
