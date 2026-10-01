import { expect, it } from 'vitest';
import { parseProviderResponse, parseVanityResponse, ProviderRequestError } from '../frontend/report/providers';
import { envelope, faceitFixture, leetifyFixture, steamFixture } from './fixtures/providers';
it('preserves Leetify units, negative ratings and literal player text without inventing benchmarks', () => {
	const result = parseProviderResponse('leetify', leetifyFixture(), 0);
	expect(result.fetchedAt).toBe(1700000000000);
	expect(result.data).toMatchObject({
		leetifyRating: -1.2,
		leetifyAim: 95,
		leetifyUtility: 62,
		leetifyPositioning: 71,
		timeToDamageMs: 400,
		crosshairPlacementDeg: 8,
		spottedAccuracyPct: 34.4,
		counterStrafingPct: 80.7,
		recentKd: 2,
		recentMatches: 20,
		name: '<img src=x onerror=alert(1)>',
	});
	expect(result.data).not.toHaveProperty('percentile');
	expect(result.data).not.toHaveProperty('benchmark');
});
it('does not use lifetime counts or another provider to fill unavailable Leetify fields', () => {
	expect(parseProviderResponse('leetify', envelope({ total_matches: 300, stats: {}, ranks: { faceit: 10 }, rating: { aim: 'NaN' } }), 0).data).toMatchObject({
		recentMatches: null,
		leetifyAim: null,
		timeToDamageMs: null,
	});
});
it('parses provider-specific numeric strings without converting absent or malformed fields into zero', () => {
	expect(parseProviderResponse('faceit', faceitFixture({ kd: '1.80', headshots: '70%', matches: '1,234', winrate: '55%' }), 0).data).toMatchObject({
		faceitKd: 1.8,
		faceitHeadshotsPct: 70,
		faceitMatches: 1234,
		faceitWinratePct: 55,
	});
	expect(parseProviderResponse('faceit', faceitFixture({ kd: 'NaN', headshots: '101%', matches: 'unknown', winrate: '' }), 0).data).toMatchObject({
		faceitKd: null,
		faceitHeadshotsPct: null,
		faceitMatches: null,
		faceitWinratePct: null,
	});
});
it('preserves private, not-found and rate-limited states and Retry-After seconds or HTTP dates', () => {
	for (const status of ['private', 'not_found', 'unauthorized', 'error'])
		expect(parseProviderResponse('leetify', envelope({ rating: { aim: 100 } }, status), 0)).toMatchObject({ status, data: null });
	expect(parseProviderResponse('leetify', JSON.stringify({ status: 'rate_limited', retry_after_seconds: 12 }), 0).retryAfterMs).toBe(12000);
	expect(parseProviderResponse('leetify', JSON.stringify({ status: 'rate_limited', retry_after: 'Thu, 01 Jan 1970 00:01:00 GMT' }), 0).retryAfterMs).toBe(60000);
	expect(parseProviderResponse('leetify', JSON.stringify({ status: 'rate_limited', retry_after: 'garbage' }), 0).retryAfterMs).toBe(60000);
	expect(parseProviderResponse('leetify', 'not-json', 0).status).toBe('error');
	expect(parseProviderResponse('leetify', envelope({ privacy_mode: 'private' }), 0).status).toBe('private');
});
it('parses Steam XML as XML, never exposes private games as zero hours, and rejects malformed XML', () => {
	expect(
		parseProviderResponse('steam', steamFixture('<gamesList><games><game><appID>730</appID><hoursOnRecord>1,234.5</hoursOnRecord></game></games></gamesList>'), 0).data,
	).toMatchObject({ cs2Hours: 1234.5, name: 'Synthetic <player>', memberSince: 'January 1, 2020' });
	expect(parseProviderResponse('steam', steamFixture('<gamesList><error>This profile is private</error></gamesList>'), 0).data?.cs2Hours).toBeNull();
	expect(parseProviderResponse('steam', steamFixture('<gamesList><games>'), 0).status).toBe('error');
	expect(parseProviderResponse('steam', envelope({ profile_xml: '<profile><privacyState>private</privacyState></profile>' }), 0).status).toBe('private');
});

it('keeps structured Steam rate-limit errors for the shared vanity coordinator', () => {
	try {
		parseVanityResponse(JSON.stringify({ status: 'rate_limited', retry_after: '120' }), 0);
		throw Error('Expected a rate-limit failure');
	} catch (error) {
		expect(error).toBeInstanceOf(ProviderRequestError);
		expect(error).toMatchObject({ status: 'rate_limited', retryAfterMs: 120000 });
	}
	expect(parseVanityResponse(JSON.stringify({ status: 'ok', steamId: '76561197960265729' }), 0)).toBe('76561197960265729');
});
