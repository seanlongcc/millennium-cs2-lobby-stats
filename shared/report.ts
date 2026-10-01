export type SteamId = string;
export type Provider = 'leetify' | 'faceit' | 'steam';
export type ProviderTab = Provider | 'csstats'; // CSStats is link-only, never queued.
export type TeamGroup = 'your_team' | 'opponents' | 'spectators' | 'unknown' | 'free_for_all';
export type ProviderStatus = 'loading' | 'ok' | 'not_found' | 'private'
  | 'unauthorized' | 'rate_limited' | 'error' | 'canceled';
export type PlayerIdentity = {
  steamId: SteamId; origin: 'steam' | 'manual' | 'self';
  team: TeamGroup; teamSource: 'unavailable' | 'verified_live';
  teamObservedAt: number | null;
};
export type RosterSnapshot = {
  capturedAt: number;
  players: PlayerIdentity[];
  state: 'ready' | 'empty' | 'unavailable' | 'error';
  coverage: 'unknown';
  rejectedCount: number;
  message?: string;
};
export type ProviderResult<T> = {
  status: ProviderStatus; data: T | null; fetchedAt: number | null;
  message?: string; retryAfterMs?: number;
};
export type Metrics = {
  leetifyRating: number | null; leetifyAim: number | null;
  leetifyUtility: number | null; leetifyPositioning: number | null;
  timeToDamageMs: number | null; crosshairPlacementDeg: number | null;
  spottedAccuracyPct: number | null; counterStrafingPct: number | null;
  name: string | null; premier: number | null; faceitLevel: number | null;
  faceitElo: number | null; recentKd: number | null; recentMatches: number | null;
  faceitKd: number | null; faceitHeadshotsPct: number | null;
  faceitWinratePct: number | null; faceitMatches: number | null;
  cs2Hours: number | null; memberSince: string | null;
};
export type Evidence = {
  ruleId: 'recent-kd'; category: 'kd'; provider: 'leetify';
  thresholdSource: 'plugin';
  value: number; threshold: number; matches: number; window: 'recent';
};
export type Assessment = {
  version: 'rules-v2-leetify';
  label: 'insufficient_data' | 'no_flags' | 'unusual';
  evidence: Evidence[];
};
export type ReportRow = {
  player: PlayerIdentity; metrics: Metrics; assessment: Assessment;
  providers: Record<Provider, ProviderResult<Partial<Metrics>>>;
};
export type ReportSnapshot = {
  inputErrors?: string[];
  message?: string;
  id: number; roster: RosterSnapshot; rows: ReportRow[];
  state: 'idle' | 'loading' | 'complete' | 'canceled' | 'stale' | 'error';
};
