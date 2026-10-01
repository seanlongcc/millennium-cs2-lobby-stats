# CS2 Server Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the upstream Millennium plugin with a Shift+Tab player report, automatic current-player discovery, manual roster supplementation, and explainable unusual-stat highlights across CS2 modes.

**Architecture:** Preserve the upstream Lua providers and Steam profile card. A feature-detected Steam adapter captures current players into immutable report snapshots; a shared request coordinator fills a React overlay panel and evaluates a labeled Leetify-derived review rule. Quick review groups verified teams and provides Leetify-first source tabs. Missing or incomplete roster data remains visible and can be supplemented with pasted profile links.

**Tech Stack:** Windows Steam/Millennium, Lua, React/TypeScript 5.9.3, upstream `@steambrew/*`, pnpm 10.33.1, Node.js 24, Vitest 4, jsdom 27, Lua 5.4 test runner.

**Spec:** `docs/superpowers/specs/2026-09-30-cs2-server-report-design.md`

## Global Constraints

- Target Windows desktop Steam, CS2 app ID `730`, and the user's installed Millennium runtime after a compatibility check.
- Preserve upstream MIT license, attribution, profile cards, and existing settings.
- Use Steam's actual React components from `@steambrew/client` (or `millennium` for Starlight). Plain HTML is forbidden wherever Steam provides a suitable component. Document each missing-component exception before using custom markup; inherit Steam appearance and interaction states.
- Fork identity is `cs2-player-tracker`, display name `CS2 Player Tracker`, initial version `0.1.0`.
- Preserve upstream TypeScript `5.9.3`, pnpm `10.33.1`, and `@steambrew/*` dependency ranges; use Node.js `24` for development and CI.
- Use Steam `currentUsers` only for automatic discovery; never promote `recentUsers` into the live roster.
- SteamID64 values remain decimal strings; use `BigInt` for account-ID conversion.
- Support up to `128` unique human player IDs per report; report an explicit limit error rather than silently truncate.
- No mandatory API keys, telemetry, external report service, or persisted player-stat history.
- No CS2 process-memory access, game injection, input automation, or automatic player reporting.
- No claim of cheat probability, Valve Trust Factor, or confirmed cheating.
- Keep provider names, units, metric scales, timestamps, and sample sizes visible where relevant.
- A missing/private profile, missing statistic, bot, or low playtime alone never increases suspicion.
- Every click captures a new roster snapshot; late responses from an older scan cannot update a newer report.
- Quick review is the selected layout. Leetify is the primary statistics provider; profile tabs are Leetify, CSStats, FACEIT, and Steam.
- Use verified Leetify benchmarks only when their numeric cutoffs, cohort, direction, and sample window are available. Performance bands are not cheating thresholds; do not infer a percentile from an Aim score.
- Group by current teams only with verified current-match assignments. Unknown teams, spectators, and free-for-all modes remain explicit; never infer teams from row order or historical teammates.

## Review Focus

- Steam updates remove an interface or create multiple overlay windows: show a compatibility diagnostic; never mount twice or retain listeners after unload. Task 1.
- Current/recent coplay overlap, empty feed, a community roster larger than ten, or ambiguous pasted identities: retain only validated current/manual IDs and report unknown coverage. Task 2.
- Providers return private pages, malformed numeric strings, HTTP 429, or partial data: preserve usable providers, obey cooldowns, and never turn missing data into zero. Tasks 3 and 5.
- Extremely high ratios have too few matches or zero deaths: enforce the exact evidence sample, count valid zero-death matches correctly, and never substitute a lifetime count for a recent sample. Tasks 3 and 4.
- The user refreshes, changes servers, hides/closes the overlay, or unloads the plugin while requests are pending: invalidate the old generation and bound actual outstanding work. Task 5.

---

## Starting state and file map

Planning documents, `PRODUCT.md`, and exploratory mockups under `visualizations/` exist in the workspace. Do not run `git clone ... .` over them. Task 1 initializes Git in place, fetches the pinned upstream revision, checks it out without overwriting existing files, and records an `upstream` remote. Mockup HTML/CSS must not enter the plugin build or release archive. Do not create a hosted fork or push anything. A new isolated worktree is unnecessary for this empty checkout; if execution needs one later, inspect/reuse attached worktrees and use the managed worktree tool.

| Files | Responsibility |
| --- | --- |
| `plugin.json`, `package.json`, `pnpm-lock.yaml`, `.github/workflows/ci.yml` | Fork identity, pinned tooling, verification |
| `shared/report.ts` | Serializable provider/report contracts |
| `frontend/steam/runtime.ts`, `overlay-host.tsx` | Steam compatibility, overlay mounting and cleanup |
| `frontend/steam/roster.ts`, `manual-roster.ts` | Live roster validation, explicit unknown teams, and pasted identities |
| `backend/steam.lua` | Explicit Steam profile/playtime and vanity requests |
| `backend/report.lua`, `backend/main.lua` | Report provider dispatch, deadlines and upstream integration |
| `frontend/report/providers.ts` | Runtime response validation and normalization |
| `frontend/report/rules.ts` | Pure versioned anomaly rules |
| `frontend/report/controller.ts` | Shared scheduler, snapshot state, cancellation |
| `frontend/report/ReportPanel.tsx`, `PlayerRow.tsx`, `PlayerProfile.tsx` | Quick review, team sections, and provider tabs |
| `frontend/index.tsx`, `static/cs2-player-tracker.css` | Settings, lifecycle and scoped styling |
| `scripts/package.ps1`, `install.ps1`, `verify-package.mjs` | Windows release and installation |
| `tests/`, `vitest.config.ts`, `tsconfig.test.json` | Behavioral tests and fixtures |
| `docs/validation/cs2-overlay.md`, `README.md`, `UPSTREAM.md` | Runtime evidence, install steps and provenance |

Do not split the entire upstream profile renderer as unrelated cleanup. Only export its provider types into `shared/report.ts` when needed, retaining its existing field names. Report types below are additional normalized contracts.

## Contract decisions

Task 1 creates `shared/report.ts`; later tasks add their named types there. All timestamps in TypeScript contracts use epoch milliseconds; Lua provider `fetched_at` seconds are converted at the boundary.

```ts
type SteamId = string;
type Provider = 'leetify' | 'faceit' | 'steam';
type ProviderTab = Provider | 'csstats'; // CSStats is link-only, never queued.
type TeamGroup = 'your_team' | 'opponents' | 'spectators' | 'unknown' | 'free_for_all';
type ProviderStatus = 'loading' | 'ok' | 'not_found' | 'private'
  | 'unauthorized' | 'rate_limited' | 'error' | 'canceled';
type PlayerIdentity = {
  steamId: SteamId; origin: 'steam' | 'manual' | 'self';
  team: TeamGroup; teamSource: 'unavailable' | 'verified_live';
  teamObservedAt: number | null;
};
type RosterSnapshot = {
  capturedAt: number;
  players: PlayerIdentity[];
  state: 'ready' | 'empty' | 'unavailable' | 'error';
  coverage: 'unknown';
  rejectedCount: number;
  message?: string;
};
type ProviderResult<T> = {
  status: ProviderStatus; data: T | null; fetchedAt: number | null;
  message?: string; retryAfterMs?: number;
};
type Metrics = {
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
type Evidence = {
  ruleId: 'recent-kd'; category: 'kd'; provider: 'leetify';
  thresholdSource: 'plugin';
  value: number; threshold: number; matches: number; window: 'recent';
};
type Assessment = {
  version: 'rules-v2-leetify';
  label: 'insufficient_data' | 'no_flags' | 'unusual';
  evidence: Evidence[];
};
type ReportRow = {
  player: PlayerIdentity; metrics: Metrics; assessment: Assessment;
  providers: Record<Provider, ProviderResult<Partial<Metrics>>>;
};
type ReportSnapshot = {
  id: number; roster: RosterSnapshot; rows: ReportRow[];
  state: 'idle' | 'loading' | 'complete' | 'canceled' | 'stale' | 'error';
};
```

`ProviderTab` is separate from `Provider`: CSStats opens its profile URL and never creates a loading cell or an HTTP job. Leetify benchmark comparison is explicitly unavailable in this build because no supported raw cutoff source was verified. Do not fabricate a percentile, benchmark payload, or aggregate sample window. A future verified source requires a contract revision.

`PlayerIdentity.team` defaults to `unknown`, `teamSource` to `unavailable`, and `teamObservedAt` to null. The known coplay adapter cannot populate teams. The live probe may establish a supported source, but until then production must honestly show Team unknown. Rendering accepts verified assignments for capability tests; synthetic fixtures do not establish live availability.

`Metrics` intentionally allows null fields. A displayed provider status and a rule's eligibility are separate decisions. When providers supply the same rank/name, prefer successful Leetify Premier/name and successful FACEIT level/ELO; use Steam name as the identity display fallback, finally SteamID64. Do not let an error overwrite a successful value from another source.

### Task 1: Import upstream and prove the Steam overlay boundary

**Files:**
- Import the pinned upstream repository; modify `plugin.json`, `package.json`, `backend/main.lua`, `frontend/index.tsx`, `scripts/package.ps1` for fork identity.
- Create `UPSTREAM.md`, `shared/report.ts`, `frontend/steam/runtime.ts`, `frontend/steam/overlay-host.tsx`.
- Create `tests/runtime.test.ts`, `vitest.config.ts`, `tsconfig.test.json`, `docs/validation/cs2-overlay.md`.

**Interfaces:**
- `OverlayHost = { key: string; appId: number; window: Window }`.
- `SteamRuntime = { readCoplay(): Promise<unknown>; currentUserId(): SteamId | null; overlayHosts(): OverlayHost[]; onOverlayActive(cb: (active: boolean) => void): () => void; onAppExit(cb: () => void): () => void }`.
- `createSteamRuntime(globals: unknown): SteamRuntime` and `startOverlayHosts(runtime: SteamRuntime, onScan: () => void): () => void`.
- Unsupported methods return explicit capability errors; no invented empty successful data.

- [ ] **Step 1: Establish the pinned base.** Run `git init`, `git remote add upstream https://github.com/Shightrox/millennium-cs2-profile-stats.git`, `git fetch upstream 7e484ddb86ad4160d92106c2ad9a3e95faa97627`, and `git switch -c feat/cs2-server-report FETCH_HEAD`. Preserve these docs. Record revision/version/license in `UPSTREAM.md`; install the upstream locked dependencies and run `pnpm typecheck && pnpm build` as a baseline.
- [ ] **Step 2: Write `runtime.test.ts`.** Add Vitest `^4.0.0`, jsdom `^27.0.0`, React/ReactDOM `19.1.1` as test/dev dependencies, updating the lockfile without changing the host's external React bundling. Add `test`, `test:watch`, and `typecheck:tests` scripts. Assert:

```ts
expect(() => createSteamRuntime({}).readCoplay()).toThrow(/unavailable/i);
// startOverlayHosts over two app-730 hosts and one other-game host:
expect(cs2Window.document.querySelectorAll('[data-cs2-tracker-button]')).toHaveLength(1);
expect(otherWindow.document.querySelector('[data-cs2-tracker-button]')).toBeNull();
dispose();
expect(cs2Window.document.querySelector('[data-cs2-tracker-button]')).toBeNull();
expect(activeTimerCount()).toBe(0);
```

Define the fake runtime/window and timer-count helpers in this test; also assert adding/removing hosts after initialization and repeated scans do not double-mount.
- [ ] **Step 3: Run `pnpm exec vitest run tests/runtime.test.ts`.** Expected: failing missing runtime/host implementation, not a broken test environment.
- [ ] **Step 4: Implement the runtime and mounting signatures.** Read `Router.WindowStore.OverlayWindows`; validate each router's `params.browserInfo.m_unAppID` and `BrowserWindow`, feature-detecting every internal access. Confirm app identity against `GetOverlayBrowserInfo()` if router metadata is absent. Use the current-user `App.m_CurrentUser.strSteamID` when valid. A one-second host reconciliation timer while CS2 is running mounts/unmounts one React root per host; `definePlugin.onDismount` disposes everything. Use additive overlay activation/app lifetime subscriptions. Never replace `RegisterOverlayBrowserInfoChanged`, which the package warns will break Steam's own overlay. Rename only plugin-owned identities, preserving upstream attribution and CSS selectors used by its profile card.
- [ ] **Step 5: Verify `pnpm exec vitest run tests/runtime.test.ts && pnpm typecheck && pnpm typecheck:tests && pnpm build`.** Expected: all pass. Record that these checks do not establish actual overlay compatibility. `docs/validation/cs2-overlay.md` must list the runtime probe needed after installation: actual Millennium version, CS2 host identification, current/recent array shape, button click, cleanup, and whether a supported current-session source actually provides team assignments. Inspect native Tabs resolution; the pinned wrapper contains runtime discovery assumptions, so prove its desktop availability. Do not write “verified” before observing it.
- [ ] **Step 6: Commit** with `git add .` after checking only intended files; `git commit -m "feat: establish CS2 tracker overlay integration"`.

### Task 2: Capture current rosters and resolve pasted profile links

**Files:**
- Create `frontend/steam/roster.ts`, `frontend/steam/manual-roster.ts`, `backend/steam.lua`.
- Modify `shared/report.ts`, `backend/main.lua` to expose vanity resolution.
- Create `tests/roster.test.ts`, `tests/manual-roster.test.ts`, `tests/lua/steam.test.lua`, `tests/lua/run.lua`.

**Interfaces:**
- `normalizeCoplay(raw: unknown, selfId: SteamId | null, now: number): RosterSnapshot`.
- `groupRoster(players: PlayerIdentity[]): Array<{team: TeamGroup; players: PlayerIdentity[]}>` preserves each member exactly once; order opponents, your_team, spectators, free_for_all, unknown, omitting empty groups.
- `captureRoster(runtime: SteamRuntime, now: () => number): Promise<RosterSnapshot>` with a 5-second deadline.
- `parseManualRoster(text: string): { steamIds: SteamId[]; vanityNames: string[]; errors: string[] }`.
- Lua `steam.resolve_vanity(vanity: string): table`; IPC `resolve_steam_profile(vanity: string): string` returns `{status, steamId?, message?}` JSON.
- `resolveManualRoster(text: string, resolveVanity: (name: string) => Promise<SteamId>): Promise<{players: PlayerIdentity[]; errors: string[]}>`.

- [ ] **Step 1: Write identity/roster tests.** Use local synthetic account IDs; no real user fixtures. Assert:

```ts
const r = normalizeCoplay({currentUsers: [{appid:730,accountid:1},
  {appid:730,accountid:1},{appid:440,accountid:2}],
  recentUsers:[{appid:730,accountid:3}]}, null, 1000);
expect(r.players.map(p => p.steamId)).toEqual(['76561197960265729']);
expect(r.coverage).toBe('unknown');
expect(normalizeCoplay({currentUsers:[],recentUsers:[]}, '76561197960265729', 0).state).toBe('empty');
expect(parseManualRoster('[U:1:1]\nSTEAM_1:1:0\nhttps://steamcommunity.com/profiles/76561197960265729').steamIds)
  .toEqual(['76561197960265729']);
expect(parseManualRoster('https://steamcommunity.com.evil.test/id/me').errors).toHaveLength(1);
```

Assert coplay-derived and manually added identities have unknown teams; historical teammates and row order cannot supply assignments. Test `groupRoster` with verified synthetic 7/9-player teams, spectators, unknown players, and free-for-all; no member may be dropped or duplicated. Add named cases for 32 players, 128/129 unique IDs, `4294967295` versus `4294967296`, negatives/floats, malformed arrays, self deduplication, no speculative self-only match, 32 KiB overflow, vanity deduplication, malicious URLs, and unresolved names. Lua tests stub HTTP/JSON/Millennium modules and assert only constructed HTTPS Steam URLs are fetched, redirect destinations are checked, and a private valid profile can still resolve identity.
- [ ] **Step 2: Run `pnpm exec vitest run tests/roster.test.ts tests/manual-roster.test.ts` and `lua tests/lua/run.lua steam`.** Expected: failures for missing functions; test runner errors must be resolved first.
- [ ] **Step 3: Implement the signatures.** Follow the spec's exact conversion/bounds/input limits and unknown-team defaults. `groupRoster` groups only explicit assignment fields and does not infer them. Keep automatic team capability unavailable unless the live probe verifies a supported source; any resulting adapter must document provenance and invalidate team-only changes. HTTP vanity resolution uses `https://steamcommunity.com/id/<encoded-vanity>/?xml=1`, validates the returned SteamID64, and never requests an input URL verbatim. A 404, private missing ID, malformed XML, or wrong redirect destination returns a typed error. Use at most two concurrent vanity lookups with a 10-second timeout each.
- [ ] **Step 4: Rerun Step 2 plus `pnpm typecheck`.** Expected: all tests pass, including timeout/rejection distinct from empty roster. Add a deterministic Lua module stub harness in `tests/lua/run.lua`; no live provider calls in unit tests.
- [ ] **Step 5: Commit** as `feat: discover current CS2 players and accept profile links`.

### Task 3: Reuse providers for bounded multi-player lookup

**Files:**
- Create `backend/report.lua`, `frontend/report/providers.ts`, `tests/providers.test.ts`, `tests/lua/report.test.lua`, `tests/fixtures/providers/`.
- Modify `backend/steam.lua`, `backend/main.lua`, `shared/report.ts`, `package.json`, `pnpm-lock.yaml`.

**Interfaces:**
- Lua `report.fetch(provider: string, steam_id: string): table`; IPC `get_report_provider(provider: string, steamId: string): string`.
- Lua `steam.summary(steam_id: string, deadline: number): table` returns profile XML and games XML in a status envelope; parse them in TypeScript with `DOMParser`, without fetching arbitrary frontend URLs.
- `parseProviderResponse(provider: Provider, raw: string, now: number): ProviderResult<Partial<Metrics>>`.
- `fetchProvider(provider: Provider, steamId: SteamId): Promise<ProviderResult<Partial<Metrics>>>` wraps the typed Millennium callable.

- [ ] **Step 1: Write provider fixtures and tests.** Cover public/legacy Leetify with all eight primary metrics, private Leetify, FACEIT partial response, public/private games XML, 404, 429 with both Retry-After formats, invalid JSON/XML, and embedded markup in names. Assert:

```ts
expect(parseProviderResponse('faceit', faceitFixture({kd:'1.80',headshots:'70%',matches:'30'}), 0).data)
  .toMatchObject({faceitKd:1.8,faceitHeadshotsPct:70,faceitMatches:30});
expect(parseProviderResponse('faceit', faceitFixture({kd:'NaN',headshots:'101%',matches:'unknown'}), 0).data)
  .toMatchObject({faceitKd:null,faceitHeadshotsPct:null,faceitMatches:null});
expect(parseProviderResponse('steam', privateGamesFixture, 0).data?.cs2Hours).toBeNull();
```

Assert Aim `95` stays `95`, Time to Damage `400` stays `400 ms`, and negative Leetify ratings remain valid. Missing/invalid fields normalize to null, and `total_matches` never becomes an aggregate window or recent sample count. Assert profile metrics never acquire an invented benchmark band/percentile. Define the fixture factory and raw XML strings in `tests/fixtures/providers`; dates/identities are synthetic. Lua assertions must prove 403/private never calls legacy, bulk calls never request SCOPE/inventory, invalid SteamID makes zero HTTP calls, each request gets the remaining budget, and 20 valid recent matches including one zero-death match count as 20. All-zero-death samples yield missing K/D rather than infinity.
- [ ] **Step 2: Run `pnpm exec vitest run tests/providers.test.ts` and `lua tests/lua/run.lua report`.** Expected: failing unimplemented provider boundaries.
- [ ] **Step 3: Implement report dispatch without duplicating providers.** Move existing Leetify/FACEIT functions into a reusable module only as needed; if extracted, use `backend/providers.lua`, keep global IPC wrappers in `main.lua`, and add it to Lua parsing/tests/package. Add optional report context `{deadline, include_scope=false}` internally while preserving existing profile-call defaults. Enforce 10-second HTTP and 40-second route budgets, privacy and redirects, and return retry metadata. Correct derived recent K/D aggregation to include valid zero-death matches. Map `ranks.leetify`, `rating.aim/utility/positioning`, and the four `stats` fields identified in the spec into the explicit Metrics fields, preserving source units after verifying raw public/legacy formats. Missing Leetify fields cannot inherit FACEIT values. Parse public Steam XML in the frontend; sanitize numeric ranges without changing original Leetify metric scales. CSStats remains link-only, with no network dispatch or automated scraping.
- [ ] **Step 4: Run all provider tests, `pnpm typecheck`, and Lua syntax parsing for every backend `.lua` file.** Expected: pass. Confirm normal profile calls retain their original normalized response shape and optional SCOPE behavior with regression fixtures. No bulk inventory requests.
- [ ] **Step 5: Commit** as `feat: add bounded report lookups using existing stats providers`.

### Task 4: Explain the Leetify-derived review flag

**Files:**
- Create `frontend/report/rules.ts`, `tests/rules.test.ts`.
- Modify `shared/report.ts` for `Evidence`/`Assessment` contracts.

**Interfaces:**
- `assess(metrics: Metrics): Assessment` implements exactly `rules-v2-leetify`.
- `emptyMetrics(): Metrics` returns all null fields for safe initialization and test fixtures.

- [ ] **Step 1: Write threshold and missing-data tests.** Assert:

```ts
expect(assess(emptyMetrics()).label).toBe('insufficient_data');
expect(assess({...emptyMetrics(),recentKd:4,recentMatches:19}).evidence).toEqual([]);
expect(assess({...emptyMetrics(),recentKd:2,recentMatches:20}).label).toBe('unusual');
expect(assess({...emptyMetrics(),recentKd:1.99,recentMatches:20}).label).toBe('no_flags');
expect(assess({...emptyMetrics(),faceitKd:5,faceitMatches:300,faceitHeadshotsPct:99}).evidence).toEqual([]);
expect(assess({...emptyMetrics(),leetifyAim:100,timeToDamageMs:100}).evidence).toEqual([]);
expect(assess({...emptyMetrics(),cs2Hours:0}).label).toBe('insufficient_data');
expect(assess({...emptyMetrics(),recentKd:2,recentMatches:20}).evidence[0])
  .toMatchObject({provider:'leetify',thresholdSource:'plugin',threshold:2,matches:20,window:'recent'});
```

Also cover above-threshold values, finite-domain validation, and missing recent sample count even with successful FACEIT lifetime data. No performance percentile or band is inferred from a rating.
- [ ] **Step 2: Run `pnpm exec vitest run tests/rules.test.ts`.** Expected: missing implementation failures.
- [ ] **Step 3: Implement `assess` and `emptyMetrics`.** Only recent K/D `2.0` with `20` valid matches can flag. FACEIT and other Leetify metrics are display-only. Preserve the exact provider/window/threshold/count/source in evidence. No numeric suspicion score, Leetify-endorsed threshold claim, or hardcoded benchmark classification.
- [ ] **Step 4: Rerun rules tests and `pnpm typecheck`.** Expected: pass without fetching data or depending on the DOM.
- [ ] **Step 5: Commit** as `feat: explain Leetify-derived review flags with sample context`.

### Task 5: Coordinate snapshots and render the complete overlay report

**Files:**
- Create `frontend/report/controller.ts`, `ReportPanel.tsx`, `PlayerRow.tsx`, `PlayerProfile.tsx`, `static/cs2-player-tracker.css`.
- Modify `frontend/steam/overlay-host.tsx`, `frontend/index.tsx`, `shared/report.ts`.
- Create `tests/controller.test.ts`, `tests/report-panel.test.tsx`.

**Interfaces:**
- `ReportController = { scan(): Promise<void>; addProfiles(text: string): Promise<void>; cancel(): void; getSnapshot(): ReportSnapshot; subscribe(cb: () => void): () => void; dispose(): void }`.
- `createReportController(deps: {runtime: SteamRuntime; fetch: typeof fetchProvider; resolveVanity: (name: string) => Promise<SteamId>; now: () => number}): ReportController`.
- `ReportPanel({controller, onClose, highlightEnabled}: {controller: ReportController; onClose: () => void; highlightEnabled: boolean})`.
- `PlayerRow({row, highlightEnabled}: {row: ReportRow; highlightEnabled: boolean})`.
- `PlayerProfile({row, providerTab, onProviderTab}: {row: ReportRow; providerTab: ProviderTab; onProviderTab: (tab: ProviderTab) => void})`.
- One shared coordinator instance per loaded plugin; its in-flight slots/cooldowns outlive a closed panel until pending work settles.

- [ ] **Step 1: Write fake-timer/deferred-promise controller tests.** Define controllable provider promises in this test. Assert maximum outstanding calls `2`, per-provider `1`, duplicate in-flight deduplication, and:

```ts
expect(afterOldResponse.id).toBe(newReportId);
expect(afterOldResponse.rows.some(r => r.player.steamId === oldOnlyId)).toBe(false);
expect(after429.rows[0].providers.leetify.status).toBe('rate_limited');
expect(faceitCompletedDuringLeetifyCooldown).toBe(true);
expect(afterRosterChange.state).toBe('stale');
expect(callsStartedAfterCancel).toBe(0);
expect(concurrencySlotReleasedBeforeTimedOutIpcSettles).toBe(false);
```

Add tests for no extra calls while overlay is hidden, recheck on activation, identical roster still receiving a new scan ID on refresh, no old manual IDs or stale team assignments carried over, team-only changes from any verified team source, app exit/account switch, no storage writes, no automatic retry, and closing/reopening while an IPC call remains pending. Account identity must be rechecked before accepting results if there is no usable account-change event.
- [ ] **Step 2: Write jsdom UI tests.** Assert a 32-player roster renders 32 native player rows, missing data reads “Unavailable,” low hours/private profiles have no flag, malicious player names remain literal text, provider errors do not erase other fields, progress increments as provider results arrive, and the exact coverage/empty/unsupported messages match the spec. Assert **Scan players**, **Refresh report**, **Add profile links**, **Cancel**, close, source links, expanded evidence, and highlighting toggle behavior. Assert keyboard focus/escape restoration and the linked Leetify badge. Assert Quick review has Leetify Rating/Aim/Time to Damage (ms)/recent K/D summaries; switching native provider tabs preserves the selected player and creates no fetches. Selecting another player retains the tab; a new scan defaults to Leetify. Test unknown/teamless/spectator groups and uneven verified teams, preserving all players. CSStats opens only a constructed HTTPS `/player/<SteamID64>` destination, shows the external-only state, and cannot hold report completion open. No unavailable Leetify cell inherits FACEIT values. Assert a visible plugin-rule label and an initially collapsed Data details disclosure exposing unavailable benchmarks, aggregate window and calculation provenance when opened. Normal rows must omit routine assessment subtitles while unavailable metrics remain visible. Assert Aim without `%`, and Time to Damage in ms. Assert CSRep/CSTracker actions are visible across all four tabs and for missing/private players, open only the two exact HTTPS homepages, and neither invoke a provider lookup nor change flags. Verify the overview Time to Damage column shows `400 ms` for a raw value of `400`, unavailable for missing data, and remains visible in narrow layouts without being labeled pure reaction time. Test that pasted multi-line links remain separate identities through the TextField paste handler. Review component imports and raw JSX exceptions separately from jsdom, since native components themselves render DOM elements.
- [ ] **Step 3: Run `pnpm exec vitest run tests/controller.test.ts tests/report-panel.test.tsx`.** Expected: failures at missing coordinator/panel behavior.
- [ ] **Step 4: Implement the controller.** Use monotonic generation IDs and immutable roster snapshots; guard every callback by generation, account identity, overlay activation validation, and disposal state. Poll roster every 5 seconds only while active/open; mark changed snapshots stale. Run the shared bounded queue with 45-second UI deadlines, route cooldowns, canceled terminal states, and the non-settled IPC rule. `complete` means every cell has a terminal provider state, not every provider succeeded. Manual additions cancel the old generation, retain current roster identities plus validated additions, and build a new generation without carrying provider data across privacy transitions.
- [ ] **Step 5: Implement Quick review, the provider profile, and settings integration.** Use the spec's mandatory native component mapping: `Dialog*` for report structure/actions, `Field` for player/metric rows, `Tabs` for provider tabs (or native `DialogButtonSecondary` selectors only if the runtime Tabs export cannot resolve), `Focusable` for navigation/layout, `TextField` for input, `ScrollPanel` for scrolling, `SteamSpinner`/`ProgressBar` for loading, and `ToggleField` for highlighting. Import the actual exports from the runtime-compatible package. Do not ship HTML replicas or copy the preview's CSS. Native components retain their own styling and interaction states; plugin CSS only positions the report, arranges content, and adds restrained evidence emphasis. Record any proven missing-component markup exception in `docs/validation/cs2-overlay.md`; custom table markup is not preapproved. Review retained upstream UI against the same requirement without deleting existing features. Render opponents/your team/spectators/unknown/free-for-all groups according to verified identity metadata, without hiding missing assignments. Show Leetify Rating, Aim, Time to Damage (ms), and recent derived K/D in roster rows; keep the selected profile beside them. Implement the four tabs in spec order, source-specific fields/statuses, timestamp/window distinctions, attribution and source actions. A new report starts on Leetify. Apply the spec's minimal-copy rules: retain the compact coverage line and one disclaimer; show the plugin-authored rule beside flagged evidence; put benchmark/window/calculation notes behind a native Data details disclosure. Do not print routine no-flag subtitles or duplicate explanatory paragraphs. CSStats is an external link state, not a simulated provider response. Add the persistent More sources row above the tabs with Steam-native actions opening exactly `https://csrep.gg/` and `https://cstracker.gg/`. CSRep API contracts are unverified; use the authorized site-link fallback and add no CSRep/CSTracker fetch jobs. Preserve pasted link separators before browser input normalization. `highlight_enabled` defaults true and is the only new preference. Close clears report data and restores button focus. Preserve the optional Leetify key and original profile settings. Never insert provider text using `innerHTML`. Review JSX/imports for native usage; a mock returning an HTML button is test scaffolding only and must never be bundled.
- [ ] **Step 6: Run the complete TS/Lua suite, `pnpm typecheck`, `pnpm typecheck:tests`, and `pnpm build`.** Expected: all pass. A jsdom pass does not establish Steam overlay usability; retain the live check in Task 6.
- [ ] **Step 7: Commit** as `feat: show current-player reports in the CS2 Steam overlay`.

### Task 6: Package, install, and record real-mode verification

**Files:**
- Modify `scripts/package.ps1`, `.github/workflows/ci.yml`, `README.md`.
- Create `scripts/install.ps1`, `scripts/verify-package.mjs`, `tests/package.test.ts`.
- Update `docs/validation/cs2-overlay.md`.

**Interfaces:**
- `scripts/package.ps1` creates `dist/cs2-player-tracker-v0.1.0.zip`.
- `scripts/install.ps1 -PluginPath <path> [-SteamPath <path>] [-WhatIf]` stages, verifies and installs only this plugin, with a timestamped backup and rollback on failed replacement.
- `node scripts/verify-package.mjs <unpacked-plugin-directory>` exits nonzero for missing artifacts, mismatched identity/version, or development-only secrets/files.

- [ ] **Step 1: Write package/install tests.** Temporary Steam trees contain a sentinel `millennium/plugins/extendium/keep.txt` and an older tracker installation. Assert manifest/build/Lua/static/license inclusion, version `0.1.0`, root folder `cs2-player-tracker`, sentinel preservation, dry-run no writes, backup exact contents, and failed replacement restoring the original. Invoke real PowerShell against the temporary tree; use a CI Windows job rather than claiming Linux string inspection tests Windows behavior.
- [ ] **Step 2: Run `pnpm exec vitest run tests/package.test.ts`.** Expected: missing packaging/installer behavior fails; mark Windows-only execution explicitly when PowerShell is unavailable locally.
- [ ] **Step 3: Implement packaging and the installer.** Preserve upstream generated layout. Default Steam path is `C:\Program Files (x86)\Steam`; validate the target basename. Stage on the same volume and never remove unrelated directories. Include documented installation/enablement/restart and rollback steps. Do not auto-stop Steam. Add CI jobs for Node 24/pnpm, unit tests/typecheck/build, Lua 5.4 behavioral tests, every backend file's syntax parse, and Windows packaging/install tests.
- [ ] **Step 4: Run the release checks.** `pnpm test`, `lua tests/lua/run.lua`, `pnpm typecheck`, `pnpm typecheck:tests`, `pnpm build`, `git diff --check`, PowerShell packaging, archive extraction, and `node scripts/verify-package.mjs <extracted-root>/cs2-player-tracker`. Expected: all pass, with archive path/contents recorded. Pin a local `luaparse` dev dependency for reproducible syntax checks rather than a changing `pnpm dlx` download.
- [ ] **Step 5: Install the validated package in the user's supplied plugin directory.** Installation is within the requested local setup; retain the backup. Ask only if an actual protected-path permission or a disruptive Steam restart requires user action. Do not terminate Steam or an active game automatically. Report enablement/restart steps if the user must perform them.
- [ ] **Step 6: Run the real overlay probe and mode matrix.** Record actual Millennium/Steam versions, button appearance and click behavior, actual native component and provider-tab resolution, team-assignment availability/provenance and behavior on side/team-only changes, parity with Steam desktop typography/control/focus/theme states, documented raw-markup exceptions, source provenance, counts compared with the observed human scoreboard, profile card regression, provider failures, close/reopen/unload, and a server switch. Rows: Premier, Competitive, Wingman, Casual, Deathmatch, Arms Race, FACEIT, community server. Use an already-running user session when available; do not autonomously queue competitive games or change accounts. For inaccessible modes record `untested`, the exact missing observation, and the required user check. In an incomplete-roster mode verify pasted links work and coverage stays unknown. Never call the all-mode automation requirement proven by mocks or by a single mode.
- [ ] **Step 7: Commit** as `build: package and verify the CS2 player tracker` after recording honest results. Provide archive/install paths, passing checks, mode limitations, and any remaining activation/live verification step.

## Plan self-review

Spec coverage: overlay lifecycle → Tasks 1/5; mode-agnostic discovery, honest team availability/grouping, and approved fallback → Tasks 1/2; existing-provider reuse/privacy/limits → Task 3; Leetify-derived flags with no fabricated benchmarks → Task 4; Leetify-first provider tabs and CSStats link-only state → Task 5; progress/cancellation/accessibility → Task 5; install, rollback, attribution and actual compatibility → Task 6. No separate cloud service or game-state subsystem is required.

Interface check: Steam IDs are strings throughout; `ProviderResult` timestamps convert once; Lua IPC uses encoded JSON strings; `Assessment` labels are distinct from provider states; `ReportSnapshot.id` is a generation, never a claimed CS2 match ID. Review Focus items each have named owning tests. The live-mode matrix deliberately remains unverified until execution.

## Execution handoff

Recommended: **Native**. These six tasks share the Steam adapter, provider contracts, and report lifecycle closely; implementing them in one context is efficient. Follow the selected execution skill and obtain one independent whole-branch review before final completion. Subagent-driven execution remains an alternative with a fresh implementer/reviewer per task.

Wait for user review of this concrete plan and selection of Native or Subagent-driven execution before product implementation, as required by the explicitly requested writing-plans skill.
