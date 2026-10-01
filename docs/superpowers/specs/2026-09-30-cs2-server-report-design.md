# CS2 Server Report Design

Status: approved for implementation. Final provider order: Leetify, CSStats, FACEIT, Steam.

## Intent and agreed scope

Extend [Shightrox/millennium-cs2-profile-stats](https://github.com/Shightrox/millennium-cs2-profile-stats) with a **Scan players** button in CS2's Steam desktop overlay. After joining a server, the user opens Shift+Tab and clicks the button. The plugin reads the current roster, fetches available public statistics, and highlights unusual statistical patterns with specific explanations.

The user explicitly selected:

- All game modes, including community servers; do not assume a ten-player roster.
- When automatic discovery is incomplete, show coverage and allow pasted Steam profile links.
- Quick review is the preferred layout, with Leetify statistics first, provider tabs in the selected player's profile, and roster groups by team.

The report is an on-demand view of public player history. It does not require real-time enemy game state. It must distinguish historical statistics from the current match. “Suspicious” means a configurable statistical flag, not a finding that someone cheated.

## Inspected baseline

The workspace was empty and was not a Git repository on 2026-09-30. The upstream source was inspected at commit `7e484ddb86ad4160d92106c2ad9a3e95faa97627`, version `0.4.5`. A research copy exists outside the workspace at `/tmp/cs2-player-tracker-research/Shightrox-millennium-cs2-profile-stats-7e484dd`; implementation must fetch the pinned Git revision rather than rely on that temporary copy.

Upstream has a Lua backend in `backend/main.lua`, a small React settings UI in `frontend/index.tsx`, and an 850-line profile renderer in `webkit/index.tsx`. Its providers expose Leetify, Premier, FACEIT, and optional SCOPE.GG data. Steam profile and playtime extraction currently happen inside the viewed profile page; these requests need an explicit target Steam ID for a multi-player report.

Confirmed local paths:

- Plugin destination: `C:\Program Files (x86)\Steam\millennium\plugins`.
- Existing plugin: `extendium`; the upstream stats plugin is not currently installed there.
- CS2 installation: `C:\Program Files (x86)\Steam\steamapps\common\Counter-Strike Global Offensive\game\csgo`.
- Steam UI source: `C:\Program Files (x86)\Steam\steamui\chunk~2dcc5aaf7.js`.

That installed Steam UI calls `SteamClient.Friends.GetCoplayData()` and uses **`currentUsers`** for the overlay's current-player section. Its Players dialog merges current and recent users, so scraping the entire dialog would include old opponents. The installed chunk's SHA-256 was `f9606b111203c9140dcdd6fc016a0ee00e4c8406aeb786187c42873f08d071fb`.

The pinned `@steambrew/client@5.8.4` types also expose `GetCoplayData`, `Router.WindowStore.OverlayWindows`, `SteamClient.Overlay.GetOverlayBrowserInfo`, and overlay activation events. The installed Millennium runtime version and real CS2 roster completeness have **not** been tested. Presence of the API does not establish that every server supplies every player.

## Approach and alternatives

**Selected: extend the existing plugin with a Steam current-player adapter.** Preserve the profile card and Lua providers, add a React overlay report, and isolate Steam's internal interfaces behind feature detection. No separate runtime or mandatory API key is needed. This best matches the requested Shift+Tab workflow.

**Alternative: CS2 Game State Integration.** Useful for local map/session metadata, but all-player data is restricted by spectator context. Do not base live-playing roster completeness on `allplayers`. A listener and game configuration would add setup without resolving arbitrary-server discovery.

**Alternative: server-side roster feed.** A server plugin can identify its own players accurately, but requires server ownership and cannot cover arbitrary Premier, FACEIT, and community servers. Not part of this build.

## Global constraints

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

## User flow and overlay

1. CS2 starts. The plugin detects CS2's desktop overlay window and adds one **Scan players** button. Existing windows and windows created later both work. Other games do not receive the button.
2. Clicking opens the report panel immediately and reads `GetCoplayData()` afresh. There is no automatic third-party lookup merely because a match starts or Shift+Tab opens.
3. A roster shell appears first. Provider results then fill rows independently. The header shows snapshot time, detected-player count, manually added count, loading/completed player counts, and provider failures.
4. Highlighted rows explain which metrics crossed which thresholds. Selecting a row updates the adjacent player profile. Native provider tabs switch its source-specific metrics, windows/sample counts, unavailable fields, and profile links. The selected provider stays selected when inspecting another player; a new report starts on Leetify.
5. **Add profile links** accepts a pasted list; **Refresh report** starts a fresh scan. **Cancel** stops queued lookups and marks incomplete cells as canceled. Closing the panel cancels work and releases report data.

The report uses Steam's desktop dialog and field components in the existing overlay, with a selectable player list and details area. It fits a 1280×720 overlay and larger screens. Native focus, hover, disabled, scrolling, and theme behavior remain intact. Tab reaches every control. Escape closes the report and restores focus to its button without forcing Steam's overlay closed. Statistical flags use restrained labeled emphasis; private or missing data remains neutral.

### Minimal visible copy

Keep the default view focused on players and metrics. Omit routine “No rule triggered” row subtitles, repeated sample/team notes, repeated source descriptions, and redundant “Player profile” or “More sources” headings. Retain one global Sample data label in mockups, the timestamp and historical-data context, coverage uncertainty, source attribution, provider tabs/links, missing/private states, and the recent-match sample count. Healthy rows do not need a status sentence. A missing numeric field remains visibly unavailable.

For a flagged player, show **High K/D** and **“Plugin rule: ≥ 2.00 K/D · min. 20 matches”** beside the recent K/D value and its sample. Keep one footer sentence, **“Flags are not proof of cheating.”** Do not repeat it in each source tab. Put assessment status, calculation provenance, unavailable profile window, and unavailable Leetify benchmarks under a keyboard-accessible native **Data details** disclosure. These facts remain inspectable without filling the default profile with caveats. FACEIT retains its lifetime window and count once. CSStats needs only its external source action. CSRep/CSTracker links remain visible above all provider tabs.

### Mandatory native component mapping

| Report surface | Steam component |
| --- | --- |
| Heading, snapshot, coverage, explanatory copy | `DialogHeader`, `DialogSubHeader`, `DialogBodyText` |
| Content, grouping, footer | `DialogBody`, `DialogControlsSection`, `DialogControlsSectionHeader`, `DialogFooter` |
| Scan, refresh, add, cancel, close, source actions | `DialogButtonPrimary`, `DialogButtonSecondary` / `Button` |
| Provider switching | `Tabs`, verified in the installed desktop runtime; native `DialogButtonSecondary` selectors if the exported Tabs adapter cannot resolve |
| Player rows and metric label/value rows | `Field`, with native activation/focus behavior |
| Keyboard navigation and layout groups | `Focusable`; add only necessary layout CSS |
| Search and pasted profile links | `TextField`; accept multiple links/IDs through the existing parser and preserve pasted separators in state |
| Loading and completion | `SteamSpinner` / `ProgressBar` |
| Highlighting setting | `ToggleField` |
| Scrollable roster | `ScrollPanel` / `ScrollPanelGroup`, verified in the desktop overlay |

The desktop report uses `Dialog*` components; do not substitute the QAM-specific `PanelSection` styling merely because it is exported. Do not ship hand-styled HTML buttons/inputs, cloned Steam CSS, invented native export names, or a replacement component library. The research package discovers these components from Steam's runtime, so browser-only mockups cannot establish native compatibility. Confirm each export and interaction inside Steam before release. If an expected component is missing after a Steam update, show the compatibility state rather than silently replacing it with a custom control.

For any layout or data structure with no suitable native component, record its exact markup, the checked package/runtime version, alternatives considered, and why the exception is necessary in `docs/validation/cs2-overlay.md`. A custom table is not preapproved: the first report can expose every metric through native `Field` rows. Plugin CSS is limited to report positioning, layout, and restrained statistical emphasis; it must not restyle native controls, typography, or focus rings. Existing upstream UI is reviewed for the same requirement wherever it is carried into the fork.

The selected **Quick review** layout has grouped player rows on the left and one player profile on the right. Roster summary values are **Leetify Rating**, **Aim**, **Time to Damage (ms)**, and **Recent K/D (derived from Leetify match records)**, with the recent sample size. Keep Leetify fields visible as unavailable when that provider fails; never silently replace them with FACEIT values. At narrower widths, stack the profile beneath the roster and put the four summary metrics on a second row beneath each player. Keep Time to Damage visible; missing values stay unavailable. Although the API field is named `reaction_time_ms`, label it Time to Damage because it measures first damage after seeing an enemy, not pure human reaction time.

The profile tabs, in order, are **Leetify**, **CSStats**, **FACEIT**, and **Steam**. Start each new report on Leetify and retain the active tab while selecting other players. A provider's private, empty, rate-limited, or failed state appears inside its tab without disabling the other sources. Switching tabs does not trigger a new report or duplicate provider requests.

- **Leetify:** Leetify Rating, Aim, Utility, Positioning, Time to Damage (ms), Crosshair placement (degrees), Accuracy (Enemy Spotted), Proper Counter-Strafing, Premier rating, and recent derived K/D with its match count. Preserve original names/scales. Aim is a score such as `95`, never `95%` and never a 95th-percentile claim. Distinguish profile aggregates from the recent K/D window. If an aggregate window/count is not supplied, say so; `total_matches` does not establish the sample used for profile aggregate metrics.
- **CSStats:** an external-profile tab in the first build, with **View on CSStats** pointing to `https://csstats.gg/player/<validated-SteamID64>`. The research pass did not verify a supported public API. Do not invent imported values or ship a scraper: the provider's current terms prohibit automated collection without authorization. Direct data integration remains an explicit capability gap until a supported, authorized source is documented. This does not block other providers or report completion.
- **FACEIT:** level/ELO, lifetime K/D, headshots, win rate, and lifetime matches, as supplementary context. These values do not trigger the new report's assessment.
- **Steam:** identity and available CS2 hours/profile metadata, with private/unavailable states. No assessment from hours or privacy.

A persistent **More sources** row above the provider tabs offers **CSRep** and **CSTracker** links, visible regardless of the active provider or missing statistics. Use Steam-native source-action buttons to open exactly `https://csrep.gg/` and `https://cstracker.gg/` in the approved browser flow. These are clearly site links rather than claimed player-specific deep links. No credentials, match codes, player data, or user input are appended to either URL. They do not add network jobs or change the report assessment.

CSRep's indexed documentation advertises a public API, while an earlier official post describes future access. Direct requests to `/docs` and `/docs/inventory` returned HTTP 403 during research on 2026-09-30; usable player-stat endpoints, authentication requirements, and limits could not be verified. Use the user's explicitly accepted link fallback, not a guessed endpoint or scraped data. If official documentation becomes accessible, direct integration needs verified contracts and a separate implementation revision.

The published Leetify profile schema exposes `ranks.leetify`, `rating.aim`, `rating.utility`, `rating.positioning`, `stats.reaction_time_ms`, `stats.preaim`, `stats.accuracy_enemy_spotted`, and `stats.counter_strafing_good_shots_ratio`. Confirm public-versus-legacy mappings and units against schema examples; validate numeric domains at the provider boundary. `reaction_time_ms` is displayed as **Time to Damage**, not human reaction time. The current public schema does not expose benchmark cutoffs, percentile comparisons, or the aggregate sample window. Show neutral values and **“Leetify benchmark comparison unavailable”** until a verified source supplies a compatible comparison. A profile rating must never be recalculated from unrelated fields.

Display the existing Leetify attribution badge, linked to Leetify, and **View on Leetify** links. Preserve the upstream profile card and its optional inventory/SCOPE features; these costly optional lookups are not part of bulk reporting.

## Roster integrity and coverage

The adapter validates the raw response before interpreting it. Select only `currentUsers` rows whose `appid === 730`. Accept integer account IDs from `1` through `4294967295`; convert using `(76561197960265728n + BigInt(accountid)).toString()`. Deduplicate by SteamID64. Reject malformed values and non-individual IDs. Account names do not establish identity.

When a nonempty current CS2 roster exists, include the signed-in user if its identity can be read through Steam's current-user context; label this row **You**. Do not fabricate an active match from the signed-in user alone. Bots have no resolvable public human profile; explain that limitation rather than scoring them.

Coverage copy is **“N detected by Steam · Coverage unverified”**; manual additions insert **“M added manually”** as a separate count. Counts reflect valid automatic IDs, plus a separate manual count. Never show “10/10” or “all players” from an assumed server size. If there is no live roster, show **“No roster available”** with **“Retry or add profiles.”** If the interface is absent, show **“Automatic roster discovery is unavailable on this Steam version.”** A rejection or timeout is an error, not an empty successful roster.

While the panel is open and the overlay is active, recheck the roster every `5` seconds with one request at a time and a `5`-second deadline. A membership change marks the report **“Roster changed — refresh report”**, cancels queued stats requests, and prevents late results from altering the displayed snapshot. App exit/account change invalidates the report immediately; adapters that cannot observe account change must compare the current user before each scan. Resume from a hidden overlay by rechecking before accepting further results. No network lookup runs merely because the roster changed.

An unchanged set of Steam IDs is not a reliable match identifier. Do not claim map or server-switch detection from an ID-set hash. Each click still starts a fresh snapshot, even when the same people remain together. The automatic result reflects Steam's current-player feed; live-mode testing must record whether that feed lags or is incomplete.

Pasted input accepts SteamID64, SteamID3 (`[U:1:...]`), SteamID2 (`STEAM_0/1:X:Y`), and HTTPS Steam Community `/profiles/<id>` or `/id/<vanity>` URLs. Resolve vanity names only through a constructed Steam Community URL. Do not fetch arbitrary pasted URLs, names, or malformed IDs. Limit input to `32 KiB` and `128` unique IDs, deduplicate against automatic entries, and display per-item validation/resolution errors. Manual additions are explicitly user supplied, do not establish completeness, and expire on refresh/close.

### Team grouping and its discovery limit

Show **Opponents** and **Your team** when the signed-in player's current team and each roster member's assignment are verified. If relative team membership is not verified, use **Team unknown**. Put verified spectators in **Spectators** and use **Free-for-all** only when the current mode is verified as teamless. Never label unknown users as opponents. Keep all players visible, including more than five per team, unknown assignments, and pasted identities. Sort unusual rows within each group without mixing teams. Counts describe known report members, never an assumed full five-player team.

The inspected `CoplayUser` contract contains only `accountid`, `rtTimePlayed`, and `appid`; it provides no team IDs. Consequently an adapter based only on that inspected contract must return **Team unknown** for every player. During the live runtime probe, inspect whether a supported current-session source exposes authenticated team assignments. Record the source and observation timestamp before enabling automatic groups; no process-memory reads, injected game code, past-match inference, friendship inference, or guessed row ordering. The mockup's team assignments are synthetic and are not proof of discovery support. Pasted links remain unassigned. A team-only change or side switch invalidates prior assignments even if membership is unchanged; clear stale assignments on refresh, app exit, and session change. Do not claim automatic team support before this probe succeeds.

## Providers and report scheduling

Keep the existing Lua provider routes. Add report-specific routes that reuse the same provider functions, skip SCOPE fallback for bulk requests, and provide Steam XML summaries for an explicit SteamID64. Leetify legacy fallback remains restricted to a public API `404`; never fall back around a private/unauthorized response. Validate privacy on the legacy response as well as the public one before returning data.

Backend responses use `status`, optional `message`, optional `data`, `fetched_at` (Unix seconds), and optional `retry_after_seconds`. Distinguish `ok`, `not_found`, `private`, `unauthorized`, `rate_limited`, and `error`. Frontend states additionally include `loading` and `canceled`. Malformed metrics normalize to `null`, not zero. A private games list does not become zero CS2 hours. Parse XML with a real XML parser and use provider-specific numeric parsing for separators and percentages.

Use a global maximum of `2` pending report IPC calls and at most `1` per provider. Enforce these bounds in a shared service across settings and overlay mounts. Schedule providers round-robin across players so one failure does not block unrelated rows. Existing Lua HTTP calls are synchronous; measure real latency and do not promise that two IPC promises mean two simultaneous Lua requests.

Individual HTTP requests have a maximum `10`-second timeout; report routes have a total `40`-second request budget and the UI has a `45`-second deadline. Each additional upstream request uses the remaining route budget. On timeout, the UI shows a terminal error but retains that call's concurrency slot until the IPC promise settles, preventing orphan work from exceeding the limit. Cancel clears queued calls; already running calls may finish but their results are discarded. If IPC never settles, show backend-unresponsive diagnostics and do not spawn unbounded replacement calls.

A provider `429` starts a shared cooldown using `Retry-After` (seconds or HTTP date), or `60` seconds when missing/invalid. Queued calls to that provider become `rate_limited`; other providers continue. No automatic retry loop and no rate-limit evasion through fallbacks. Refresh respects active cooldowns. Deduplicate in-flight `(provider, SteamID64)` calls; retain fetched data only in the currently open report, with no reusable persisted cache. Leetify's guidelines ask clients not to store its data.

## Leetify benchmarks and explainable flags

Use two distinct concepts: Leetify's performance comparisons and the plugin's review flags. Leetify's published percentile bands are Poor (bottom 10%), Subpar (10–30%), Average (30–70%), Good (70–90%), and Great (top 10%). Many raw-stat benchmarks depend on the comparison rank; Leetify Rating, Aim, Utility, Positioning, ADR, and K/D are described as rank-independent. These are performance bands, not cheating probabilities or suspicious-player cutoffs.

Use a provider-supplied band or percentile only with documented direction, comparison cohort, sample window and source/version. Do not turn “Aim 95” into “95th percentile,” copy unsupported numeric thresholds from screenshots, or treat an unavailable benchmark as average. Research on 2026-09-30 found the band definitions but no benchmark endpoint or numeric cutoff fields in the public OpenAPI schema. Initial production comparison state is therefore **unavailable**, with original metrics displayed neutrally. If a supported benchmark source is later verified, revise normalization and tests before enabling the comparison; do not silently enable new flag rules.

For the original requested unusual-stat feature, retain one explicitly plugin-authored fallback rule (`rules-v2-leetify`):

| Rule ID | Evidence | Minimum sample | Threshold |
| --- | --- | --- | --- |
| `recent-kd` | Kills/deaths aggregated from public recent Leetify match records | 20 valid matches | K/D ≥ 2.0 |

This replaces the earlier FACEIT-led `rules-v1` proposal. FACEIT K/D/headshots/win rate no longer contribute flags. Aim, Utility, Positioning, Time to Damage and other raw Leetify values do not trigger guessed thresholds. The fallback is a product default, not empirically calibrated, and must be labeled **“Plugin rule”** with its exact threshold, sample and provider. It is not attributed to Leetify's benchmark system. No LLM, probability score, or automatic player reporting. The setting may disable highlighting; numerical customization remains deferred.

For derived recent K/D, include zero-death matches in kills and match count; if total deaths is zero, render unavailable and do not flag it. Never use `total_matches` or another provider's count to meet the 20-match requirement. One eligible threshold crossing yields **“High K/D”** (restrained amber); eligible data below the threshold yields **“No rule triggered”**; no eligible data yields **“Insufficient data”**. These labels do not declare guilt or safety. Show the individual games' window when dates are available; otherwise say “recent records returned by Leetify.” Profile aggregates have a separate, possibly unknown window.

Steam hours, account age, rank, privacy, bans, unavailable data, and current-match performance never increase the review flag. Do not assess a current round against historical thresholds.

## Boundaries and persistence

`shared/` owns provider/report contracts and validation types. `frontend/steam/` owns the compatibility boundary, roster parsing, and overlay lifecycle. `frontend/report/` owns normalization, rules, request coordination, and rendering. `backend/` retains provider access and adds Steam XML/vanity routes. The existing `webkit/` profile renderer remains functional.

Render names and all provider-controlled text as text, never raw HTML. Construct profile links from validated IDs. Permit only exact approved provider destinations; reject unexpected redirect targets and non-HTTPS input. Keys remain in Millennium configuration and are never added to report rows or logs. The optional Leetify key keeps its current settings behavior.

Reports exist only in memory while open. No saved reports, exports, historical opponent database, game config changes, companion service, or new external account are required for version one.

## Packaging and acceptance

Produce `dist/cs2-player-tracker-v0.1.0.zip`, containing a `cs2-player-tracker/` folder with `plugin.json`, built `.millennium/Dist` files, Lua modules, static assets, README, and MIT attribution. Provide a PowerShell installer that stages/validates the package, backs up an existing destination, and only replaces `cs2-player-tracker`. It must leave Extendium and other plugins untouched and must not kill Steam automatically. Activation or restarting Steam is a separate user-visible step.

Automated acceptance covers runtime feature detection/cleanup, roster/manual parsing, invalid source data, boundaries of each rule, concurrent cancellation/rate limits, UI accessibility and literal text rendering, and package contents. Source review must verify native component imports and every raw-markup exception; DOM snapshots alone cannot establish native component usage. Live acceptance also compares the report's controls, typography, theme, focus, and keyboard behavior with Steam's own desktop dialogs. Upstream typecheck/build/Lua parsing remain required. Preserve a regression fixture for the original profile card with and without Premier data.

Live acceptance on this user's installation must separately verify button visibility/click behavior, data collection, and overlay responsiveness in Premier, Competitive, Wingman, Casual, Deathmatch, Arms Race, FACEIT, and at least one community server. Record the Steam/Millennium versions, detected count versus observed human roster, leave/rejoin behavior, and failures. A mode is **untested** until observed; unit tests do not establish live support. If a mode cannot expose the full roster, report its limitation and exercise the approved manual fallback rather than claiming the original all-player automation goal was fully achieved.

## Evidence and research limits

- [Pinned upstream README](https://github.com/Shightrox/millennium-cs2-profile-stats/blob/7e484ddb86ad4160d92106c2ad9a3e95faa97627/README.md), `backend/main.lua`, `frontend/index.tsx`, `webkit/index.tsx`, manifests, and packaging script were read directly from GitHub.
- [`@steambrew/client` 5.8.4 package](https://registry.npmjs.org/@steambrew/client/5.8.4): inspected declared coplay, overlay, window, and lifecycle interfaces, plus Router implementation.
- [Millennium environment documentation](https://docs.steambrew.app/plugins/introduction/environment): UI code runs in SharedJSContext, while child windows own their DOM.
- [Leetify developer guidelines](https://leetify.com/blog/leetify-api-developer-guidelines/): attribution, metric identity/scales, and data-storage expectations.
- [Leetify CS2 benchmarks](https://leetify.com/blog/cs2-benchmarks/): performance percentile band definitions and rank-dependent comparisons; not cheating thresholds.
- [Leetify public OpenAPI](https://api-public-docs.cs-prod.leetify.com/), including `swagger-ui-init.js`: profile metrics and match endpoints were inspected; no benchmark endpoint/cutoff or aggregate-window fields found.
- [Leetify stats glossary](https://leetify.com/blog/leetify-stats-glossary/): Time to Damage meaning and metric definitions.
- [CSStats terms](https://csstats.gg/terms-of-use): automated collection restrictions; first version uses profile links only.
- [CSRep documentation](https://csrep.gg/docs/inventory): indexed public API mention; direct documentation access returned 403, so endpoint/auth/limit contracts remain unverified.
- [CSRep API plans](https://csrep.gg/blog/csrep-data-in-house-parsing-update): earlier announcement described future API access.
- [CSTracker](https://cstracker.gg/): public player-search site; included as a fixed external link.
- [Steamworks ISteamFriends](https://partner.steamgames.com/doc/api/ISteamFriends): public coplay interfaces concern played-with history; they do not document the internal JavaScript feed as an authoritative server roster.
- [CS2 GSI implementation configuration](https://github.com/st0nie/gsi-cs2-rs/blob/main/gsi_cfg/gamestate_integration_normal.cfg): its author marks all-player subscriptions spectator-only. Valve's GSI wiki could not be fetched in this session; no live GSI experiment was performed.

No gameplay session, live private player data, installed-plugin mutation, or product build was used during this planning pass.
