import { callable } from '@steambrew/client';
import type { Provider, SteamId } from '../../shared/report';
import { validSteamId } from '../steam/roster';
import { parseProviderResponse, parseVanityResponse } from './providers';
const getReportProvider = callable<[{ provider: string; steamId: string }], string>('get_report_provider');
const resolveProfile = callable<[{ vanity: string }], string>('resolve_steam_profile');
export async function fetchProvider(provider: Provider, steamId: SteamId) {
	if (!validSteamId(steamId)) throw Error('Invalid SteamID64.');
	return parseProviderResponse(provider, await getReportProvider({ provider, steamId }), Date.now());
}
export async function resolveVanity(vanity: string): Promise<SteamId> {
	return parseVanityResponse(await resolveProfile({ vanity }), Date.now());
}
