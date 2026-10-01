// @vitest-environment node
import { expect, it } from 'vitest';
import { assess, emptyMetrics } from '../frontend/report/rules';
it.each([
	[4, 19, 'insufficient_data'],
	[2, 20, 'unusual'],
	[1.99, 20, 'no_flags'],
	[2.01, 21, 'unusual'],
	[Infinity, 20, 'insufficient_data'],
	[NaN, 20, 'insufficient_data'],
	[-1, 20, 'insufficient_data'],
	[3, 20.5, 'insufficient_data'],
	[2, null, 'insufficient_data'],
] as const)('assesses K/D %s only with an eligible recent sample %s', (recentKd, recentMatches, label) => {
	expect(assess({ ...emptyMetrics(), recentKd, recentMatches }).label).toBe(label);
});
it('explains the exact source, plugin threshold and sample without a suspicion score', () => {
	expect(assess({ ...emptyMetrics(), recentKd: 2, recentMatches: 20 })).toEqual({
		version: 'rules-v4-leetify',
		label: 'unusual',
		evidence: [{ ruleId: 'recent-kd', category: 'kd', provider: 'leetify', thresholdSource: 'plugin', value: 2, threshold: 2, matches: 20, window: 'recent' }],
	});
});
it.each([
	[96.99, 'no_flags'], [97, 'unusual'], [100, 'unusual'],
	[null, 'insufficient_data'], [NaN, 'insufficient_data'], [Infinity, 'insufficient_data'],
	[-1, 'insufficient_data'], [101, 'insufficient_data'],
] as const)('assesses Aim %s independently of K/D availability', (leetifyAim, label) => {
	expect(assess({ ...emptyMetrics(), leetifyAim }).label).toBe(label);
});
it('explains the inclusive Aim rule without inventing a match sample', () => {
	expect(assess({ ...emptyMetrics(), leetifyAim: 97, recentKd: 4, recentMatches: 19 }).evidence).toEqual([
		{ ruleId: 'high-aim', category: 'aim', provider: 'leetify', thresholdSource: 'plugin', value: 97, threshold: 97 },
	]);
});
it.each([
	[0, 'unusual'], [474.99, 'unusual'], [475, 'unusual'],
	[475.01, 'no_flags'], [600, 'no_flags'],
	[null, 'insufficient_data'], [NaN, 'insufficient_data'], [Infinity, 'insufficient_data'],
	[-1, 'insufficient_data'],
] as const)('assesses Time to Damage %s independently with an inclusive 475 ms threshold', (timeToDamageMs, label) => {
	expect(assess({ ...emptyMetrics(), timeToDamageMs }).label).toBe(label);
});
it('explains the Time to Damage rule without borrowing the K/D sample', () => {
	expect(assess({ ...emptyMetrics(), timeToDamageMs: 475, recentKd: 4, recentMatches: 19 }).evidence).toEqual([
		{ ruleId: 'low-ttd', category: 'ttd', provider: 'leetify', thresholdSource: 'plugin', value: 475, threshold: 475 },
	]);
});
it('retains every reason when Aim, Time to Damage and K/D qualify', () => {
	expect(assess({ ...emptyMetrics(), leetifyAim: 98, timeToDamageMs: 475, recentKd: 2, recentMatches: 30 }).evidence.map(e => e.ruleId).sort()).toEqual(['high-aim', 'low-ttd', 'recent-kd']);
});
it('never flags missing data, low hours or FACEIT lifetime statistics', () => {
	expect(assess(emptyMetrics()).label).toBe('insufficient_data');
	for (const metrics of [
		{ faceitKd: 5, faceitMatches: 300, faceitHeadshotsPct: 99 },
		{ cs2Hours: 0 },
		{ recentKd: 4, faceitMatches: 300 },
	])
		expect(assess({ ...emptyMetrics(), ...metrics }).evidence).toEqual([]);
});
