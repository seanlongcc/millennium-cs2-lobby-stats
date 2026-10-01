import { callable, constSysfsExpr, Millennium } from '@steambrew/webkit';
import { isReportPage, mountBrowserReport } from './report';
import { SUSPICIOUS_AIM_THRESHOLD, SUSPICIOUS_TTD_THRESHOLD_MS, suspiciousTimeToDamage, validAim } from '../shared/assessment';

const styles = constSysfsExpr('cs2-profile-stats.css', {
	basePath: '../static',
	encoding: 'utf8',
}).content;

const leetifyBadge = `data:image/png;base64,${
	constSysfsExpr('leetify-badge-white-small.png', {
		basePath: '../static',
		encoding: 'base64',
	}).content
}`;

type ProviderStatus = 'loading' | 'ok' | 'not_found' | 'private' | 'unauthorized' | 'rate_limited' | 'error';

type ProviderResponse<T> = {
	status: ProviderStatus;
	message?: string;
	data?: T;
	fetched_at?: number;
};

type LeetifyProfile = {
	name?: string;
	steam64_id: string;
	profile_id?: string;
	privacy_mode?: string;
	winrate?: number;
	total_matches?: number;
	first_match_date?: string;
	ranks: {
		premier?: number;
		faceit?: number;
		faceit_elo?: number;
		leetify?: number;
	};
	rating: {
		aim?: number;
		positioning?: number;
		utility?: number;
		clutch?: number;
		opening?: number;
	};
	stats: {
		kd?: number;
		kd_matches?: number;
		reaction_time_ms?: number;
		damage_time_min_ms?: number;
		damage_time_max_ms?: number;
		damage_time_source_url?: string;
		preaim?: number;
		spray_accuracy?: number;
		counter_strafing?: number;
	};
	recent_matches: Array<{
		outcome?: string;
		map_name?: string;
		finished_at?: string;
		score?: number[];
		data_source?: string;
	}>;
};

type FaceitProfile = {
	nickname?: string;
	country?: string;
	player_id?: string;
	level?: number;
	elo?: number;
	region?: string;
	stats: {
		matches?: string;
		kd?: string;
		adr?: string;
		headshots?: string;
		winrate?: string;
		recent_results: string[];
	};
};

type SteamProfile = {
	status: ProviderStatus;
	message?: string;
	steamId: string;
	memberSince?: string;
	hours?: string;
	recentHours?: string;
};

type InventoryState = {
	status: 'idle' | 'loading' | 'ok' | 'private' | 'too_large' | 'error';
	valueUsd?: number;
	totalItems?: number;
	marketableItems?: number;
	pricedItems?: number;
	message?: string;
};

type Preferences = {
	show_steam_details: boolean;
	expand_details: boolean;
};

type DetailTab = 'overview' | 'matches' | 'faceit' | 'steam';

type ViewState = {
	leetify: ProviderResponse<LeetifyProfile>;
	faceit: ProviderResponse<FaceitProfile>;
	steam: SteamProfile;
	inventory: InventoryState;
	preferences: Preferences;
	expanded: boolean;
	activeTab: DetailTab;
};

const getLeetifyProfile = callable<[{ steamId: string }], string>('get_leetify_profile');
const getFaceitProfile = callable<[{ steamId: string }], string>('get_faceit_profile');
const getPreferences = callable<[], string>('get_preferences');

const PROVIDER_TIMEOUT_MS = 15_000;
const STEAM_TIMEOUT_MS = 8_000;

const isProfilePage = () => window.location.hostname === 'steamcommunity.com' && /^\/(id|profiles)\/[^/]+\/?$/i.test(window.location.pathname);

const profileBaseUrl = () => {
	const url = new URL(window.location.href);
	url.search = '';
	url.hash = '';
	return url.href.replace(/\/$/, '');
};

function parseJson<T>(raw: string): T {
	return JSON.parse(raw) as T;
}

const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> =>
	new Promise((resolve, reject) => {
		const timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
		promise.then(
			(value) => {
				window.clearTimeout(timeoutId);
				resolve(value);
			},
			(error) => {
				window.clearTimeout(timeoutId);
				reject(error);
			},
		);
	});

const fetchWithTimeout = async (input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = STEAM_TIMEOUT_MS) => {
	const controller = new AbortController();
	const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(input, { ...init, signal: controller.signal });
	} finally {
		window.clearTimeout(timeoutId);
	}
};

const escapeHtml = (value: unknown) =>
	String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');

const finiteNumber = (value: unknown): number | undefined => {
	const parsed = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
};

const formatInteger = (value: unknown) => {
	const parsed = finiteNumber(value);
	return parsed === undefined ? '—' : new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(parsed);
};

const formatMetric = (value: unknown, maximumFractionDigits = 1) => {
	const parsed = finiteNumber(value);
	return parsed === undefined ? '—' : new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(parsed);
};

const formatLeetifyRating = (value: unknown) => {
	const parsed = finiteNumber(value);
	if (parsed === undefined) return '—';
	return `${parsed > 0 ? '+' : ''}${formatMetric(parsed, 2)}`;
};

const formatWinrate = (value: unknown) => {
	const parsed = finiteNumber(value);
	if (parsed === undefined) return '—';
	return `${formatMetric(parsed <= 1 ? parsed * 100 : parsed, 1)}%`;
};

const formatMilliseconds = (value: unknown) => {
	const parsed = finiteNumber(value);
	return parsed === undefined ? '—' : `${formatInteger(parsed)} ms`;
};

const formatSecondsRange = (minimum: unknown, maximum: unknown) => {
	const parsedMinimum = finiteNumber(minimum);
	const parsedMaximum = finiteNumber(maximum);
	if (parsedMinimum === undefined || parsedMaximum === undefined) return '—';
	return `${formatMetric(parsedMinimum / 1000, 2)}–${formatMetric(parsedMaximum / 1000, 2)} s`;
};

const formatPercent = (value: unknown) => {
	const parsed = finiteNumber(value);
	return parsed === undefined ? '—' : `${formatMetric(parsed, 1)}%`;
};

const formatUsd = (value: unknown) => {
	const parsed = finiteNumber(value);
	return parsed === undefined ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(parsed);
};

const statusMessage = (provider: 'Leetify' | 'FACEIT', response: ProviderResponse<unknown>) => {
	if (response.status === 'loading') return `Loading ${provider}…`;
	if (response.message) return response.message;
	if (response.status === 'not_found') return `${provider} profile not found.`;
	if (response.status === 'private') return `${provider} profile is private.`;
	if (response.status === 'rate_limited') return `${provider} rate limit reached.`;
	return `${provider} data is unavailable.`;
};

type MetricIcon = 'aim' | 'reaction' | 'winrate' | 'premier';

const metricIcon = (name: MetricIcon) => {
	const icons: Record<MetricIcon, string> = {
		aim: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5"></circle><path d="M12 2v4M12 18v4M2 12h4M18 12h4"></path><circle cx="12" cy="12" r="1"></circle></svg>',
		reaction: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 5.5 13h6L11 22l7.5-12h-6L13 2Z"></path></svg>',
		winrate: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16.5 9 11l4 3 7-8"></path><path d="M15 6h5v5"></path></svg>',
		premier: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 7 3v5c0 4.7-2.8 8-7 10-4.2-2-7-5.3-7-10V6l7-3Z"></path></svg>',
	};
	return icons[name];
};

const hasValue = (value: unknown) => value !== undefined && value !== null && String(value).trim() !== '';

const formatSignedMetric = (value: unknown, maximumFractionDigits = 1) => {
	const parsed = finiteNumber(value);
	if (parsed === undefined) return '—';
	return `${parsed > 0 ? '+' : ''}${formatMetric(parsed, maximumFractionDigits)}`;
};

const compactMetric = (icon: MetricIcon, label: string, value: string, modifier = '', marker = '', markerLabel = '') => `
	<div class="cs2ps-metric ${modifier}">
		<span class="cs2ps-metric-label"><span class="cs2ps-metric-icon">${metricIcon(icon)}</span>${escapeHtml(label)}</span>
		<strong class="cs2ps-metric-value">${escapeHtml(value)}${marker ? `<span class="cs2ps-metric-marker" role="img" aria-label="${escapeHtml(markerLabel)}" title="${escapeHtml(markerLabel)}">${marker}</span>` : ''}</strong>
	</div>
`;

const aimPresentation = (value: unknown) => {
	const aim = finiteNumber(value);
	if (!validAim(aim)) return { modifier: '', marker: '', label: '' };
	if (aim < 10) return { modifier: 'cs2ps-aim-awful', marker: '💩', label: 'Very low aim rating' };
	if (aim < 25) return { modifier: 'cs2ps-aim-poor', marker: '🤡', label: 'Low aim rating' };
	if (aim < 45) return { modifier: 'cs2ps-aim-developing', marker: '😬', label: 'Developing aim rating' };
	if (aim < 60) return { modifier: 'cs2ps-aim-average', marker: '😐', label: 'Average aim rating' };
	if (aim < 75) return { modifier: 'cs2ps-aim-good', marker: '👍', label: 'Good aim rating' };
	if (aim < 85) return { modifier: 'cs2ps-aim-great', marker: '🔥', label: 'Great aim rating' };
	if (aim < SUSPICIOUS_AIM_THRESHOLD) return { modifier: 'cs2ps-aim-elite', marker: '🎯', label: 'Elite aim rating' };
	return { modifier: 'cs2ps-aim-suspicious', marker: '💀', label: 'Unusually high aim rating' };
};

const premierTierClass = (value: number) => {
	if (value < 5_000) return 'cs2ps-premier-grey';
	if (value < 10_000) return 'cs2ps-premier-cyan';
	if (value < 15_000) return 'cs2ps-premier-blue';
	if (value < 20_000) return 'cs2ps-premier-purple';
	if (value < 25_000) return 'cs2ps-premier-pink';
	if (value < 30_000) return 'cs2ps-premier-red';
	return 'cs2ps-premier-gold';
};

const faceitLevelClass = (value: unknown) => {
	const level = finiteNumber(value);
	if (level === undefined || level <= 1) return 'cs2ps-faceit-level-grey';
	if (level <= 3) return 'cs2ps-faceit-level-green';
	if (level <= 6) return 'cs2ps-faceit-level-yellow';
	if (level <= 8) return 'cs2ps-faceit-level-orange';
	return 'cs2ps-faceit-level-red';
};

const faceitCompactStat = (value: string, label: string) => `
	<span class="cs2ps-faceit-stat"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></span>
`;

const renderFaceitSummary = (
	status: { modifier: string; text: string },
	found: boolean,
	level: number | undefined,
	faceit: FaceitProfile | undefined,
	leetify: LeetifyProfile | undefined,
) => {
	if (!found) {
		return `
			<div class="cs2ps-faceit-status ${status.modifier}">
				<span class="cs2ps-faceit-mark">F</span><span class="cs2ps-faceit-copy">${escapeHtml(status.text)}</span>
			</div>
		`;
	}

	const elo = finiteNumber(faceit?.elo) ?? finiteNumber(leetify?.ranks.faceit_elo);
	const matches = hasValue(faceit?.stats.matches) ? faceit!.stats.matches! : '—';
	const kd = hasValue(faceit?.stats.kd) ? faceit!.stats.kd! : '—';
	const nickname = faceit?.nickname;

	return `
		<div class="cs2ps-faceit-status ${status.modifier}">
			<span class="cs2ps-faceit-mark">F</span>
			<div class="cs2ps-faceit-main">
				<div class="cs2ps-faceit-title">
					<span class="cs2ps-faceit-copy">${escapeHtml(status.text)}</span>
					${nickname ? `<span class="cs2ps-faceit-nickname" title="${escapeHtml(nickname)}">${escapeHtml(nickname)}</span>` : ''}
				</div>
				<div class="cs2ps-faceit-meta">
					${faceitCompactStat(matches, 'matches')}
					${faceitCompactStat(formatInteger(elo), 'ELO')}
					${faceitCompactStat(kd, 'K/D')}
				</div>
			</div>
			${level !== undefined ? `<strong class="cs2ps-faceit-level ${faceitLevelClass(level)}" aria-label="FACEIT level ${escapeHtml(formatInteger(level))}" title="FACEIT level ${escapeHtml(formatInteger(level))}"><span>${escapeHtml(formatInteger(level))}</span></strong>` : ''}
		</div>
	`;
};

const detailStat = (label: string, value: string) => `
	<div class="cs2ps-detail-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
`;

const detailedRow = (label: string, value: string) => `
	<div class="cs2ps-detail-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
`;

const formatMapName = (value: string | undefined) => {
	if (!value) return 'Unknown map';
	const normalized = value.toLowerCase().replace(/^de_/, '');
	const names: Record<string, string> = {
		dust2: 'Dust II',
		mirage: 'Mirage',
		inferno: 'Inferno',
		nuke: 'Nuke',
		ancient: 'Ancient',
		anubis: 'Anubis',
		overpass: 'Overpass',
		vertigo: 'Vertigo',
		train: 'Train',
		cache: 'Cache',
	};
	return names[normalized] || normalized.replace(/(^|[_-])([a-z])/g, (_, separator: string, letter: string) => `${separator ? ' ' : ''}${letter.toUpperCase()}`);
};

const formatMatchDate = (value: string | undefined) => {
	if (!value) return '';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '';
	return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

const formatDataSource = (value: string | undefined) => {
	if (!value) return '';
	const normalized = value.toLowerCase();
	if (normalized.includes('faceit')) return 'FACEIT';
	if (normalized.includes('matchmaking')) return 'Matchmaking';
	return value.replace(/[_-]+/g, ' ');
};

const formatScore = (score: number[] | undefined) => (Array.isArray(score) && score.length >= 2 ? `${formatInteger(score[0])}:${formatInteger(score[1])}` : '—');

const renderForm = (matches: LeetifyProfile['recent_matches'] | undefined) => {
	if (!matches?.length) return '<span class="cs2ps-form-empty">No recent matches</span>';

	return matches
		.slice(0, 5)
		.map((match) => {
			const outcome = match.outcome?.toLowerCase();
			const result = outcome === 'win' ? 'W' : outcome === 'loss' ? 'L' : '•';
			const title = [formatMapName(match.map_name), formatMatchDate(match.finished_at)].filter(Boolean).join(' · ');
			return `<span class="cs2ps-form-result cs2ps-form-${outcome === 'win' ? 'win' : outcome === 'loss' ? 'loss' : 'unknown'}" title="${escapeHtml(title)}">${result}</span>`;
		})
		.join('');
};

const providerState = (provider: 'Leetify' | 'FACEIT', response: ProviderResponse<unknown>) => `
	<div class="cs2ps-provider-state cs2ps-provider-${escapeHtml(response.status)}">
		<span class="cs2ps-provider-dot"></span><span>${escapeHtml(statusMessage(provider, { ...response, message: undefined }))}</span>
	</div>
`;

const ratingMetadata = (profile: LeetifyProfile) => `
	<span class="cs2ps-rating-meta">
		<span><strong>${escapeHtml(formatInteger(profile.total_matches))}</strong> matches</span>
		${hasValue(profile.stats.kd) ? `<span title="K/D over ${escapeHtml(formatInteger(profile.stats.kd_matches))} valid games from the latest 30 tracked games"><strong>${escapeHtml(formatMetric(profile.stats.kd, 2))}</strong> K/D</span>` : ''}
	</span>
`;

const renderRating = (profile: LeetifyProfile) => {
	const premier = finiteNumber(profile.ranks.premier);
	const leetify = finiteNumber(profile.ranks.leetify);
	if (premier !== undefined) {
		return `
			<div class="cs2ps-rating cs2ps-rating-premier">
				<div class="cs2ps-premier-emblem ${premierTierClass(premier)}"><span class="cs2ps-premier-icon">${metricIcon('premier')}</span><span>Premier</span><strong>${escapeHtml(formatInteger(premier))}</strong></div>
				<div class="cs2ps-secondary-rating"><span>Leetify rating</span><strong>${escapeHtml(formatLeetifyRating(leetify))}</strong>${ratingMetadata(profile)}</div>
			</div>
		`;
	}

	const ratingPosition = leetify === undefined ? 50 : Math.max(3, Math.min(97, ((leetify + 10) / 20) * 100));
	return `
		<div class="cs2ps-rating cs2ps-rating-leetify">
			<div class="cs2ps-rating-copy"><span>Leetify rating</span><strong>${escapeHtml(formatLeetifyRating(leetify))}</strong>${ratingMetadata(profile)}</div>
			<div class="cs2ps-rating-scale" aria-label="Leetify rating scale from minus 10 to plus 10">
				<span class="cs2ps-scale-line"></span><span class="cs2ps-scale-zero"></span><span class="cs2ps-scale-dot" style="left:${ratingPosition}%"></span>
				<span class="cs2ps-scale-labels"><span>−10</span><span>0</span><span>+10</span></span>
			</div>
		</div>
	`;
};

const renderMatchList = (matches: LeetifyProfile['recent_matches']) => `
	<div class="cs2ps-match-list">
		${matches
			.slice(0, 5)
			.map((match) => {
				const outcome = match.outcome?.toLowerCase();
				const result = outcome === 'win' ? 'W' : outcome === 'loss' ? 'L' : '•';
				const meta = [formatMatchDate(match.finished_at), formatDataSource(match.data_source)].filter(Boolean).join(' · ');
				return `
					<div class="cs2ps-match">
						<span class="cs2ps-match-result cs2ps-form-${outcome === 'win' ? 'win' : outcome === 'loss' ? 'loss' : 'unknown'}">${result}</span>
						<span class="cs2ps-match-copy"><strong>${escapeHtml(formatMapName(match.map_name))}</strong><small>${escapeHtml(meta || 'Recent match')}</small></span>
						<strong class="cs2ps-match-score">${escapeHtml(formatScore(match.score))}</strong>
					</div>
				`;
			})
			.join('')}
	</div>
`;

const renderInventoryValue = (inventory: InventoryState, steamId: string) => {
	const inventoryUrl = `https://steamcommunity.com/profiles/${encodeURIComponent(steamId)}/inventory/#730`;
	if (inventory.status === 'idle') {
		return `
			<button class="cs2ps-inventory-action" type="button" data-inventory-action>
				<span><strong>CS2 inventory</strong><small>Estimate using lowest Steam Market prices</small></span><b>Check value</b>
			</button>
		`;
	}
	if (inventory.status === 'loading') {
		return `<div class="cs2ps-inventory-state"><span class="cs2ps-spinner"></span><span>Pricing public inventory…</span></div>`;
	}
	if (inventory.status === 'private') {
		return `<div class="cs2ps-inventory-state"><span>CS2 inventory is private</span><a href="${inventoryUrl}" target="_blank" rel="noopener">Open ↗</a></div>`;
	}
	if (inventory.status === 'too_large') {
		return `<div class="cs2ps-inventory-state cs2ps-inventory-large"><span><strong>${escapeHtml(formatInteger(inventory.totalItems))} items</strong><small>Too many unique items for safe Steam pricing</small></span><a href="${inventoryUrl}" target="_blank" rel="noopener">Open ↗</a></div>`;
	}
	if (inventory.status === 'error') {
		return `<div class="cs2ps-inventory-state"><span>Inventory value unavailable</span><button type="button" data-inventory-action>Retry</button></div>`;
	}

	return `
		<div class="cs2ps-inventory-value">
			<span><strong>CS2 inventory</strong><small>${escapeHtml(formatInteger(inventory.pricedItems))}/${escapeHtml(formatInteger(inventory.marketableItems))} marketable priced · ${escapeHtml(formatInteger(inventory.totalItems))} items</small></span>
			<span class="cs2ps-inventory-price"><strong>≈ ${escapeHtml(formatUsd(inventory.valueUsd))}</strong><a href="${inventoryUrl}" target="_blank" rel="noopener">Steam prices ↗</a></span>
		</div>
	`;
};

const renderDetails = (state: ViewState, steamId: string) => {
	const leetify = state.leetify.data;
	const faceit = state.faceit.data;
	const leetifyUrl = `https://leetify.com/app/profile/${encodeURIComponent(steamId)}`;
	const faceitUrl = faceit?.nickname ? `https://www.faceit.com/en/players/${encodeURIComponent(faceit.nickname)}` : undefined;
	const tabs: Array<{ id: DetailTab; label: string }> = [{ id: 'overview', label: 'Overview' }];
	if (leetify?.recent_matches.length) tabs.push({ id: 'matches', label: 'Matches' });
	if (state.faceit.status === 'ok' && faceit) tabs.push({ id: 'faceit', label: 'FACEIT' });
	if (state.preferences.show_steam_details) tabs.push({ id: 'steam', label: 'Steam' });
	if (!tabs.some((tab) => tab.id === state.activeTab)) state.activeTab = tabs[0].id;

	const supplementalStats = leetify
		? [
				hasValue(leetify.rating.positioning) ? detailStat('Positioning', formatMetric(leetify.rating.positioning)) : '',
				hasValue(leetify.rating.utility) ? detailStat('Utility', formatMetric(leetify.rating.utility)) : '',
				hasValue(leetify.rating.opening) ? detailStat('Opening', formatSignedMetric(leetify.rating.opening, 2)) : '',
				hasValue(leetify.rating.clutch) ? detailStat('Clutch', formatSignedMetric(leetify.rating.clutch, 1)) : '',
				hasValue(leetify.stats.preaim) ? detailStat('Preaim', formatMetric(leetify.stats.preaim)) : '',
				hasValue(leetify.stats.spray_accuracy) ? detailStat('Spray accuracy', formatPercent(leetify.stats.spray_accuracy)) : '',
				hasValue(leetify.stats.counter_strafing) ? detailStat('Counter-strafing', formatPercent(leetify.stats.counter_strafing)) : '',
			]
				.filter(Boolean)
				.join('')
		: '';
	const hasScopeDamageTime = hasValue(leetify?.stats.damage_time_min_ms) && hasValue(leetify?.stats.damage_time_max_ms);
	const overviewPanel = `
		<section class="cs2ps-panel ${state.activeTab === 'overview' ? 'cs2ps-panel-active' : ''}" data-panel="overview">
			${
				state.leetify.status === 'ok' && leetify
					? `<div class="cs2ps-panel-heading"><span>Performance details</span><a href="${leetifyUrl}" target="_blank" rel="noopener">Leetify ↗</a></div>
					${supplementalStats ? `<div class="cs2ps-detail-stats">${supplementalStats}</div>` : '<p class="cs2ps-detail-note">No additional public metrics for this player.</p>'}
					<div class="cs2ps-sources">
						<a class="cs2ps-leetify-attribution" href="https://leetify.com/" target="_blank" rel="noopener"><img src="${leetifyBadge}" alt="Data Provided by Leetify"></a>
						${hasScopeDamageTime && leetify.stats.damage_time_source_url ? `<a class="cs2ps-scope-source" href="${escapeHtml(leetify.stats.damage_time_source_url)}" target="_blank" rel="noopener">AWP timing · SCOPE.GG ↗</a>` : ''}
					</div>`
					: providerState('Leetify', state.leetify)
			}
		</section>
	`;
	const matchesPanel = leetify?.recent_matches.length
		? `<section class="cs2ps-panel ${state.activeTab === 'matches' ? 'cs2ps-panel-active' : ''}" data-panel="matches">${renderMatchList(leetify.recent_matches)}</section>`
		: '';
	const faceitStats = faceit
		? [
				detailStat('Level', formatInteger(faceit.level)),
				detailStat('ELO', formatInteger(faceit.elo)),
				hasValue(faceit.region || faceit.country) ? detailStat('Region', (faceit.region || faceit.country || '').toUpperCase()) : '',
				hasValue(faceit.stats.kd) ? detailStat('K/D', faceit.stats.kd!) : '',
				hasValue(faceit.stats.adr) ? detailStat('ADR', faceit.stats.adr!) : '',
				hasValue(faceit.stats.headshots) ? detailStat('HS', faceit.stats.headshots!) : '',
				hasValue(faceit.stats.winrate) ? detailStat('Win rate', faceit.stats.winrate!) : '',
				hasValue(faceit.stats.matches) ? detailStat('Matches', faceit.stats.matches!) : '',
			]
				.filter(Boolean)
				.join('')
		: '';
	const faceitPanel =
		state.faceit.status === 'ok' && faceit
			? `<section class="cs2ps-panel ${state.activeTab === 'faceit' ? 'cs2ps-panel-active' : ''}" data-panel="faceit"><div class="cs2ps-panel-heading"><span>${escapeHtml(faceit.nickname || 'FACEIT player')}</span>${faceitUrl ? `<a href="${faceitUrl}" target="_blank" rel="noopener">FACEIT ↗</a>` : ''}</div><div class="cs2ps-detail-stats">${faceitStats}</div></section>`
			: '';
	const steamPanel = state.preferences.show_steam_details
		? `<section class="cs2ps-panel ${state.activeTab === 'steam' ? 'cs2ps-panel-active' : ''}" data-panel="steam"><div class="cs2ps-detail-list">${detailedRow('CS2 hours', state.steam.hours || 'Private')}${detailedRow('Last 2 weeks', state.steam.recentHours || (state.steam.status === 'loading' ? 'Loading…' : 'Private'))}${detailedRow('Member since', state.steam.memberSince || (state.steam.status === 'loading' ? 'Loading…' : 'Unknown'))}</div>${renderInventoryValue(state.inventory, steamId)}</section>`
		: '';

	return `
		<div class="cs2ps-details" ${state.expanded ? '' : 'hidden'}>
			<div class="cs2ps-tabs cs2ps-tabs-${tabs.length}">${tabs.map((tab) => `<button class="cs2ps-tab ${state.activeTab === tab.id ? 'cs2ps-tab-active' : ''}" type="button" data-tab="${tab.id}">${tab.label}</button>`).join('')}</div>
			${overviewPanel}${matchesPanel}${faceitPanel}${steamPanel}
		</div>
	`;
};

const renderCard = (root: HTMLElement, state: ViewState, steamId: string) => {
	const leetify = state.leetify.data;
	const faceit = state.faceit.data;
	const isLoading = state.leetify.status === 'loading' || state.faceit.status === 'loading';
	const hasPerformanceData = state.leetify.status === 'ok' && Boolean(leetify);
	const providersFinished = state.leetify.status !== 'loading' && state.faceit.status !== 'loading';
	const faceitFound = state.faceit.status === 'ok' || Boolean(faceit?.level) || Boolean(leetify?.ranks.faceit);
	const hasScopeDamageTime = hasValue(leetify?.stats.damage_time_min_ms) && hasValue(leetify?.stats.damage_time_max_ms);
	const reactionValue = hasScopeDamageTime
		? formatSecondsRange(leetify?.stats.damage_time_min_ms, leetify?.stats.damage_time_max_ms)
		: formatMilliseconds(leetify?.stats.reaction_time_ms);
	const aimStyle = aimPresentation(leetify?.rating.aim);
	const suspiciousTtd = !hasScopeDamageTime && suspiciousTimeToDamage(leetify?.stats.reaction_time_ms);
	const faceitLevel = finiteNumber(faceit?.level) ?? finiteNumber(leetify?.ranks.faceit);
	const faceitStatus = faceitFound
		? { modifier: 'cs2ps-faceit-found', text: 'FACEIT' }
		: !providersFinished
			? { modifier: 'cs2ps-faceit-loading', text: 'Checking FACEIT account…' }
			: state.faceit.status === 'not_found'
				? { modifier: 'cs2ps-faceit-missing', text: 'No FACEIT account' }
				: { modifier: 'cs2ps-faceit-unknown', text: 'FACEIT status unavailable' };
	const emptyMessage =
		state.leetify.status === 'not_found'
			? 'Leetify has no public matches for this Steam account.'
			: state.leetify.status === 'private'
				? 'This player’s Leetify profile is private.'
				: statusMessage('Leetify', { ...state.leetify, message: undefined });
	const subtitle =
		hasPerformanceData && leetify?.total_matches !== undefined
			? `${formatInteger(leetify.total_matches)} tracked matches`
			: state.leetify.status === 'loading'
				? 'Loading public stats…'
				: hasPerformanceData
					? 'Public performance summary'
					: 'Public profile overview';
	const performanceSummary =
		state.leetify.status === 'loading'
			? '<div class="cs2ps-loading-summary"><span class="cs2ps-spinner"></span><span>Loading CS2 performance…</span></div>'
			: !hasPerformanceData || !leetify
				? `<div class="cs2ps-empty-state"><span class="cs2ps-empty-icon">${metricIcon('aim')}</span><span class="cs2ps-empty-copy"><strong>No tracked CS2 performance data</strong><span>${escapeHtml(emptyMessage)}</span>${state.steam.hours ? `<small>Steam playtime: ${escapeHtml(state.steam.hours)} h</small>` : ''}</span></div>`
				: `
				${renderRating(leetify)}
				<div class="cs2ps-summary-grid">
					${compactMetric('aim', 'Aim', formatMetric(leetify.rating.aim), aimStyle.modifier, aimStyle.marker, aimStyle.label)}
					${compactMetric('reaction', hasScopeDamageTime ? 'AWP damage' : 'Time to Damage', reactionValue, suspiciousTtd ? 'cs2ps-ttd-suspicious' : '', suspiciousTtd ? '💀' : '', suspiciousTtd ? `Suspicious Time to Damage (≤ ${SUSPICIOUS_TTD_THRESHOLD_MS} ms)` : '')}
					${compactMetric('winrate', 'Win rate', formatWinrate(leetify.winrate))}
				</div>
				<div class="cs2ps-form-row"><span class="cs2ps-form-label">Last matches</span><div class="cs2ps-form">${renderForm(leetify.recent_matches)}</div></div>
			`;

	root.innerHTML = `
		<div class="cs2ps-card ${state.expanded ? 'cs2ps-is-expanded' : ''}">
			<button class="cs2ps-header" type="button" aria-expanded="${state.expanded}">
				<span class="cs2ps-title-mark">${metricIcon('aim')}</span>
				<span class="cs2ps-title-copy"><strong>CS2 stats</strong><small>${escapeHtml(subtitle)}</small></span>
				<span class="cs2ps-header-meta">${isLoading ? '<span class="cs2ps-spinner"></span>' : ''}<span>${state.expanded ? 'Hide' : 'Details'}</span><span class="cs2ps-chevron">⌃</span></span>
			</button>
			${performanceSummary}
			${renderFaceitSummary(faceitStatus, faceitFound, faceitLevel, faceit, leetify)}
			${renderDetails(state, steamId)}
		</div>
	`;

	root.querySelector<HTMLButtonElement>('.cs2ps-header')?.addEventListener('click', () => {
		state.expanded = !state.expanded;
		renderCard(root, state, steamId);
	});
	root.querySelectorAll<HTMLButtonElement>('.cs2ps-tab').forEach((tab) => {
		tab.addEventListener('click', () => {
			state.activeTab = tab.dataset.tab as DetailTab;
			renderCard(root, state, steamId);
		});
	});
	root.querySelector<HTMLButtonElement>('[data-inventory-action]')?.addEventListener('click', () => {
		if (!/^\d{17}$/.test(steamId) || state.inventory.status === 'loading') return;
		state.inventory = { status: 'loading' };
		renderCard(root, state, steamId);
		void getInventoryValue(steamId)
			.then((inventory) => {
				state.inventory = inventory;
			})
			.catch((error) => {
				state.inventory = { status: 'error', message: error instanceof Error ? error.message : String(error) };
			})
			.finally(() => renderCard(root, state, steamId));
	});
};

type SteamInventoryPage = {
	success?: number;
	total_inventory_count?: number;
	more_items?: boolean;
	last_assetid?: string;
	assets?: Array<{ classid?: string; instanceid?: string; amount?: string }>;
	descriptions?: Array<{ classid?: string; instanceid?: string; marketable?: number; market_hash_name?: string }>;
};

const inventoryValueCache = new Map<string, Promise<InventoryState>>();
const INVENTORY_PAGE_SIZE = 2_000;
const MAX_INVENTORY_PAGES = 3;
const MAX_UNIQUE_MARKET_ITEMS = 60;
const MARKET_PRICE_CONCURRENCY = 4;

const parseUsdPrice = (value: unknown) => {
	if (typeof value !== 'string') return undefined;
	const parsed = Number(value.replace(/[^\d.,-]/g, '').replace(/,/g, ''));
	return Number.isFinite(parsed) ? parsed : undefined;
};

const fetchMarketPriceUsd = async (marketHashName: string) => {
	const url = new URL('/market/priceoverview/', window.location.origin);
	url.searchParams.set('appid', '730');
	url.searchParams.set('currency', '1');
	url.searchParams.set('market_hash_name', marketHashName);
	const response = await fetchWithTimeout(url, { credentials: 'same-origin' }, 8_000);
	if (!response.ok) return undefined;
	const payload = (await response.json()) as { success?: boolean; lowest_price?: string; median_price?: string };
	if (!payload.success) return undefined;
	return parseUsdPrice(payload.lowest_price) ?? parseUsdPrice(payload.median_price);
};

const fetchInventoryValue = async (steamId: string): Promise<InventoryState> => {
	const quantities = new Map<string, number>();
	const descriptions = new Map<string, NonNullable<SteamInventoryPage['descriptions']>[number]>();
	let totalItems = 0;
	let lastAssetId = '';
	let hasMoreItems = false;

	for (let pageIndex = 0; pageIndex < MAX_INVENTORY_PAGES; pageIndex += 1) {
		const url = new URL(`/inventory/${steamId}/730/2`, window.location.origin);
		url.searchParams.set('l', 'english');
		url.searchParams.set('count', String(INVENTORY_PAGE_SIZE));
		if (lastAssetId) url.searchParams.set('start_assetid', lastAssetId);
		const response = await fetchWithTimeout(url, { credentials: 'same-origin' }, 10_000);
		if (response.status === 401 || response.status === 403) return { status: 'private' };
		if (!response.ok) throw new Error(`Steam inventory returned HTTP ${response.status}.`);
		const payload = (await response.json()) as SteamInventoryPage;
		if (payload.success !== 1) return { status: 'private' };
		totalItems = finiteNumber(payload.total_inventory_count) ?? totalItems;
		for (const asset of payload.assets || []) {
			const key = `${asset.classid || ''}_${asset.instanceid || '0'}`;
			quantities.set(key, (quantities.get(key) || 0) + (finiteNumber(asset.amount) ?? 1));
		}
		for (const description of payload.descriptions || []) {
			const key = `${description.classid || ''}_${description.instanceid || '0'}`;
			descriptions.set(key, description);
		}
		hasMoreItems = payload.more_items === true;
		lastAssetId = payload.last_assetid || '';
		if (!hasMoreItems || !lastAssetId) break;
	}

	if (hasMoreItems) {
		return { status: 'too_large', totalItems };
	}

	const marketItems = new Map<string, number>();
	for (const [key, description] of descriptions) {
		if (description.marketable !== 1 || !description.market_hash_name) continue;
		marketItems.set(description.market_hash_name, (marketItems.get(description.market_hash_name) || 0) + (quantities.get(key) || 0));
	}
	const marketableItems = Array.from(marketItems.values()).reduce((sum, quantity) => sum + quantity, 0);
	if (marketItems.size > MAX_UNIQUE_MARKET_ITEMS) {
		return { status: 'too_large', totalItems, marketableItems };
	}

	const entries = Array.from(marketItems.entries());
	let cursor = 0;
	let valueUsd = 0;
	let pricedItems = 0;
	const worker = async () => {
		while (cursor < entries.length) {
			const entry = entries[cursor];
			cursor += 1;
			const [marketHashName, quantity] = entry;
			const price = await fetchMarketPriceUsd(marketHashName);
			if (price !== undefined) {
				valueUsd += price * quantity;
				pricedItems += quantity;
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(MARKET_PRICE_CONCURRENCY, Math.max(entries.length, 1)) }, () => worker()));
	if (marketableItems > 0 && pricedItems === 0) throw new Error('Steam Market prices are temporarily unavailable.');

	return { status: 'ok', valueUsd, totalItems, marketableItems, pricedItems };
};

const getInventoryValue = (steamId: string) => {
	const cached = inventoryValueCache.get(steamId);
	if (cached) return cached;
	const request = fetchInventoryValue(steamId).catch((error) => {
		inventoryValueCache.delete(steamId);
		throw error;
	});
	inventoryValueCache.set(steamId, request);
	return request;
};

const fetchSteamProfile = async (): Promise<SteamProfile> => {
	const baseUrl = profileBaseUrl();
	const parser = new DOMParser();
	const profileResponse = await fetchWithTimeout(`${baseUrl}?xml=1`, { credentials: 'same-origin' });
	if (!profileResponse.ok) throw new Error(`Steam profile returned HTTP ${profileResponse.status}.`);

	const profileXml = parser.parseFromString(await profileResponse.text(), 'application/xml');
	const steamId = profileXml.querySelector('steamID64')?.textContent || document.querySelector<HTMLInputElement>('input[name="abuseID"]')?.value || '';
	if (!/^\d{17}$/.test(steamId)) throw new Error('Could not determine SteamID64.');

	return {
		status: 'ok',
		steamId,
		memberSince: profileXml.querySelector('memberSince')?.textContent || undefined,
	};
};

const fetchSteamPlaytime = async (): Promise<Pick<SteamProfile, 'hours' | 'recentHours'>> => {
	const parser = new DOMParser();
	const gamesResponse = await fetchWithTimeout(`${profileBaseUrl()}/games?tab=all&xml=1`, { credentials: 'same-origin' }, 6_000);
	if (!gamesResponse.ok) return {};

	const gamesXml = parser.parseFromString(await gamesResponse.text(), 'application/xml');
	const cs2 = Array.from(gamesXml.querySelectorAll('game')).find((game) => game.querySelector('appID')?.textContent === '730');
	return {
		hours: cs2?.querySelector('hoursOnRecord')?.textContent || undefined,
		recentHours: cs2?.querySelector('hoursLast2Weeks')?.textContent || undefined,
	};
};

const injectStyles = () => {
	if (document.getElementById('cs2-profile-stats-styles')) return;
	const style = document.createElement('style');
	style.id = 'cs2-profile-stats-styles';
	style.textContent = styles;
	document.head.appendChild(style);
};

export default async function WebkitMain() {
	if (isReportPage(window.location)) {
		const roots = await Millennium.findElement(document, '#cs2-browser-report', 8_000);
		const root = roots.item(0) as HTMLElement | null;
		if (root && !root.dataset.mounted) {
			root.dataset.mounted = 'true';
			mountBrowserReport(root, window.location.hash.slice(1), leetifyBadge);
		}
		return;
	}
	if (!isProfilePage() || document.getElementById('cs2-profile-stats')) return;

	injectStyles();

	const rightColumns = await Millennium.findElement(document, '.profile_rightcol', 8_000);
	const rightColumn = rightColumns.item(0);
	if (!rightColumn) return;

	const root = document.createElement('div');
	root.id = 'cs2-profile-stats';
	root.className = 'cs2ps-root';
	rightColumn.insertBefore(root, rightColumn.children.item(1));

	const state: ViewState = {
		leetify: { status: 'loading' },
		faceit: { status: 'loading' },
		steam: { status: 'loading', steamId: '' },
		inventory: { status: 'idle' },
		preferences: { show_steam_details: true, expand_details: false },
		expanded: false,
		activeTab: 'overview',
	};

	renderCard(root, state, '');

	try {
		state.preferences = parseJson<Preferences>(await getPreferences());
		state.expanded = state.preferences.expand_details;
	} catch (error) {
		console.warn('[CS2 Profile Stats] Could not load preferences:', error);
	}

	try {
		state.steam = await fetchSteamProfile();
	} catch (error) {
		const fallbackSteamId = document.querySelector<HTMLInputElement>('input[name="abuseID"]')?.value || '';
		state.steam = { status: 'error', steamId: fallbackSteamId, message: error instanceof Error ? error.message : String(error) };
	}

	const steamId = state.steam.steamId;
	if (!/^\d{17}$/.test(steamId)) {
		state.leetify = { status: 'error', message: 'SteamID64 is unavailable.' };
		state.faceit = { status: 'error', message: 'SteamID64 is unavailable.' };
		renderCard(root, state, steamId);
		return;
	}

	renderCard(root, state, steamId);

	void fetchSteamPlaytime()
		.then((playtime) => {
			state.steam = { ...state.steam, ...playtime };
		})
		.catch((error) => {
			console.warn('[CS2 Profile Stats] Steam games are unavailable:', error);
		})
		.finally(() => renderCard(root, state, steamId));

	void withTimeout(getLeetifyProfile({ steamId }), PROVIDER_TIMEOUT_MS, 'Leetify request timed out.')
		.then((raw) => {
			state.leetify = parseJson<ProviderResponse<LeetifyProfile>>(raw);
		})
		.catch((error) => {
			state.leetify = { status: 'error', message: error instanceof Error ? error.message : String(error) };
		})
		.finally(() => renderCard(root, state, steamId));

	void withTimeout(getFaceitProfile({ steamId }), PROVIDER_TIMEOUT_MS, 'FACEIT request timed out.')
		.then((raw) => {
			state.faceit = parseJson<ProviderResponse<FaceitProfile>>(raw);
		})
		.catch((error) => {
			state.faceit = { status: 'error', message: error instanceof Error ? error.message : String(error) };
		})
		.finally(() => renderCard(root, state, steamId));
}
