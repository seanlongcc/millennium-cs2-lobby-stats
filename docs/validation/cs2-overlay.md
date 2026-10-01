# CS2 overlay validation

## Baseline

Pinned upstream: 7e484ddb86ad4160d92106c2ad9a3e95faa97627. Node 24.15.0,
pnpm 10.33.1, TypeScript 5.9.3. Frozen lock resolves @steambrew/client 5.8.5,
TTC 3.3.7. Upstream typecheck and production build passed on 2026-09-30.

## Native UI boundary

All new controls use @steambrew/client exports. `Tabs` 5.8.5 falls back to an
unbounded wait for DeckyPluginLoader routes. Until this desktop adapter is verified,
provider switching uses native DialogButtonSecondary with tab semantics, as allowed
by the design. Layout uses Focusable and Dialog components.

DOM exception: one empty `div` per overlay host is the React mount container.
Steam exports no plugin root registration container. It has no product content,
controls, or cloned Steam styles. A `style` node supplies scoped layout only.
An `img` inside a native source button displays the required Leetify attribution
badge. The client 5.8.5 component catalog has no standalone image component;
DialogButtonSecondary provides its action/focus behavior. Compatibility diagnostics use a native text component; a plain paragraph is reserved for a Steam build where all three native text/container fallbacks are absent.

The existing upstream Community card runs in the separate webkit context, where
@steambrew/client React components are unavailable. Its existing HTML renderer and
CSS are preserved for that context only; they are not reused in the new report.

## Live validation coverage

- CS2 overlay toolbar click and browser window association were observed through
  Steam's dev endpoint on 2026-09-30; see the final live verification below.
- Report layout, provider tabs and hover label were observed. Keyboard focus,
  Escape and unload cleanup still need broader live coverage.
- GetCoplayData currentUsers/recentUsers shape and counts against visible human roster.
- Any supported current-session team source, including provenance/timestamp.
  The inspected CoplayUser contract has none; production reports Team unknown.
- Provider results, manual fallback, leave/rejoin, hidden-overlay resume and responsiveness.

| Mode | Status | Detected / observed | Notes |
| --- | --- | --- | --- |
| Premier | Untested | — | Requires gameplay session |
| Competitive | Untested | — | Requires gameplay session |
| Wingman | Untested | — | Requires gameplay session |
| Casual | Untested | — | Requires gameplay session |
| Deathmatch | Untested | — | Requires gameplay session |
| Arms Race | Untested | — | Requires gameplay session |
| FACEIT | Untested | — | Requires gameplay session |
| Community server | Untested | — | Requires gameplay session |

Automated checks do not prove native Steam compatibility or complete discovery.

## Installed environment observation, 2026-09-30

PowerShell FileVersionInfo reports Millennium **v3.5.0** and Steam executable
**10.96.30.42**. Steam was running; CS2 was not. No active game was interrupted.
The automatic team source remains unavailable. All gameplay-mode matrix entries
remain untested until a user-started session is available.

## Automated release evidence

- 88 TypeScript/React tests passed, including real Windows PowerShell archive,
  dry-run, replacement, backup and injected-rename-failure rollback tests.
- 14 Lua behavioral tests passed; syntax is checked for every backend Lua file
  with pinned luaparse, in addition to the Lua 5.4 runtime checks.
- Frontend and original webkit typechecks pass. Test typechecking uses the same
  ES2020 target; package test escaping was corrected to avoid ES2021-only methods.
- Production build retains external Steam React and generates index.js/webkit.js.
- Package verifier checks the extracted archive, required artifacts, identity,
  version, links and accidental development/private files.

UI interaction tests use native-component boundary doubles because Steam webpack
is not available to jsdom. They do not establish actual theme/focus parity.

## Installation

The PowerShell installer installed the validated archive into
`C:\Program Files (x86)\Steam\millennium\plugins\cs2-player-tracker`.
The initial installation had no predecessor. The final review fixes replace that candidate with an automatic backup outside the active plugins directory.
The installed package passed verification. Extendium's manifest SHA-256 was
unchanged. Steam remained running; the plugin has not been enabled or observed
inside a live CS2 overlay. Enable it in Millennium and restart Steam when ready.

## Final review pass

A fresh whole-branch reviewer identified five important issues. Regression tests
first reproduced canceled vanity requests continuing, independent IPC/cooldown
limits, stale roster reuse, FACEIT HTML fallback after a 429, and silent Steam
compatibility failures. The fix pass covers each, including combined hung
provider/vanity slots. Native API diagnostics are visible in plugin settings and
the report; failed mounts remove partial DOM and styles.

Resolved in the user-requested follow-up: malformed optional Steam games XML
now leaves valid public profile name/member-since data available. CS2 hours are
unavailable; malformed or private profile XML still exposes no profile data.
Regression coverage includes truncated XML, wrong roots, disallowed document
types and non-string games payloads.

Final archive/install verification: all 24 installed files match the extracted
release; all 22 Extendium files are unchanged. Backup before the Steam XML fix:
`C:\Program Files (x86)\Steam\millennium\backups\cs2-player-tracker-20260930-221157-634-067230b9`.
Archive SHA-256: `fea91a0c157289faea678b45c643dce3e64a56f79406cfc174b9f6c9563c80fe`.

See [implementation record](implementation-record.md) for task evidence, review
fixes, rulings and remaining limits.

## Browser report correction, 2026-09-30

The screenshot exposed the default Steam modal presentation. The prior production
panel used stacked native Fields rather than the selected mockup's roster table;
its layout stylesheet was attached to the launcher document instead of being
owned by the report surface. No live evidence had established modal/style parity.

The new launcher uses the clicked overlay router's NavigateToSteamWeb. The report
is a packaged local page served through Millennium's virtual filesystem, with its
own stylesheet and isolated WebKit renderer. A session-scoped frontend handler
preserves the existing controller, provider scheduling, roster checks and manual
input validation. Closing, unloading or losing the browser heartbeat releases the
session; hidden-overlay time does not expire it. New scans invalidate old tabs.
Browser input and provider strings are escaped; outgoing links omit the referrer.
The user-requested browser surface supersedes the original React-only report rule.

Verified against installed Steam source: NavigateToSteamWeb delegates to the
overlay Navigator.SteamWeb, which calls AddWebPageRequest. Verified against
Millennium v3.5.0 source (765aa8802f8a4d942ad8ac8323a9e0f233a50fa8):
https://millennium.ftp/ serves local paths; a URL-scoped browser CSS hook opts the
page into isolated WebKit injection; call_frontend_method dispatches exported
frontend functions. Requests stay synchronous at that bridge to avoid waiting for
nested backend calls while Lua is serving a browser request.

Chromium fixture preview verified 1250px two-column and 680px stacked layouts,
all 10 sample rows, provider switching, refresh reset and no horizontal overflow
or page errors. Samples do not establish live provider availability. Steam tab
launch and the full installed frontend/Lua/WebKit round trip still require a live
user scan after plugin reload; no Steam or CS2 restart was performed here.

Release verification: 97 TypeScript/React tests and 16 Lua behavioral tests pass;
frontend, WebKit and test typechecks pass; all 11 backend Lua files parse; the
production build succeeds. The WebKit build now pins its rootDir explicitly so
TTC can compile imports shared with the report controller types and roster code.

Both renamed-source and compatibility archives passed extracted-package checks.
The installed update retains the existing `cs2-player-tracker` ID and settings,
using an isolated compatibility build of the current source. All 26 installed
files byte-match its verified package; all 22 Extendium files are unchanged.
Backup: `C:\Program Files (x86)\Steam\millennium\backups\cs2-player-tracker-20260930-223122-273-fac28a58`.
Installed archive SHA-256: `d4a847b5c648e65c80546ac0e80cdc890c466fbd65a33734701b0d4c3b4b4197`.
The running Steam instance was not reloaded; these files take effect after plugin
reload or a Steam restart when the current gameplay session is finished.

## Live browser verification and IPC fixes, 2026-09-30

The user enabled Steam's debugger at `http://127.0.0.1:8080/`. Actual toolbar
clicks exposed three transport/build errors that the original runtime doubles
did not model:

- Millennium returns primitive Lua strings as JSON text. The browser URL must be
  decoded before URL validation/navigation.
- Millennium passes Lua object arguments in alphabetical key order. The browser
  bridge now sends an array to preserve token/action/input order.
- TTC 3.3.7 injects plugin IDs by matching the `client` namespace identifier.
  Importing that namespace as `Native` left frontend IPC/config calls unbound,
  producing `Millennium Error: plugin not running: `. All frontend namespace
  imports now use `client`. A smoke test executes the production bundle and
  checks the actual registered IPC calls against the package identity.

The first two regressions failed before their fixes. The production bundle smoke
test also failed with the missing IDs and passed after rebuilding. The toolbar
now renders a CSS hover/focus label because Steam did not display its plain
`title` attribute. Live pointer movement verified the label's opacity becomes 1.

Steam's SharedJSContext was reloaded after installation, without stopping CS2.
A real toolbar click opened the local report inside the CS2 overlay browser.
The report reached 14/14 processed players, with real Steam names and Leetify
values; 20 individual provider results were unavailable. Provider availability
and Steam's roster completeness remain separate limitations. No gameplay mode
or team completeness claim is made.

Live DOM checks verified all five roster columns, all four provider tabs, manual
input form visibility, and no horizontal overflow at the observed viewport.
The captured two-column report is saved locally at
`artifacts/steam-live/report.png`. This is a real report, not the fixture preview.
The Codex browser runtime could not initialize under the WSL workspace path;
verification used Steam's own CDP endpoint through Windows Node instead.

Final checks: 99 TypeScript/React/build tests, frontend/WebKit/test typechecks,
production build and diff whitespace checks pass. Earlier unchanged backend
verification remains 16 Lua behavioral tests and 11 parsed backend files.
The installed compatibility package retains `cs2-player-tracker` and existing
settings; all 26 files byte-match its extracted archive. All 22 Extendium files
remain unchanged.

Backup: `C:\Program Files (x86)\Steam\millennium\backups\cs2-player-tracker-20260930-224557-627-a19be63b`.
Installed archive SHA-256: `3cad19cff44f44a02af345abbf1b3cc65f39ca288ca1ac979ec6b95bdb16ad4e`.

## Stale Steam roster and avatars, 2026-09-30

The user reported that the displayed roster belonged to an earlier match and
provided current player `76561199249862155` (fml). A fresh live
`SteamClient.Friends.GetCoplayData()` call still returned the same 13 non-self
entries in `currentUsers`; fml was absent there and present in `recentUsers`.
The Steam response itself was stale. The current entries contain neither match
identity nor an observation timestamp, so polling them cannot verify membership
in the current CS2 match. Steam's own overlay reads the same API. Valve describes
coplay as played-with tracking in the
[ISteamFriends documentation](https://partner.steamgames.com/doc/api/ISteamFriends#SetPlayedWith).

Automatic rows are now labeled Steam-reported, with a warning that previous-match
players may remain. Recent history is not silently promoted to a live roster.
The manual form adds Replace list: valid pasted profiles replace old players;
empty/invalid replacement input retains the existing list. Manual replacement
survives polling and overlay resume, while Refresh report explicitly returns to
Steam discovery. This is a manual fallback, not a fix for automatic current-match
discovery. Gameplay-mode completeness remains unverified.

Report snapshots now decorate rows with Steam's cached persona display name and
avatar through `friendStore.GetFriendState(accountid).persona`. Missing personas
can arrive on later browser polls, independently of public stats availability.
Only recognized Steam avatar CDN URLs render; names are escaped, image requests
omit referrers, and failed images fall back to initials without repeated retries
on each render. Both roster and inspector use the avatar.

Live verification: all 15 image elements (14 players plus selected inspector)
loaded successfully. Replacement through the actual browser form left exactly
fml's SteamID, name and loaded avatar, with no old rows or input errors. Screenshot:
`artifacts/steam-live/report-avatars.png` (the Steam-reported list before replacement).
104 TypeScript/React/build tests, all typechecks, production builds and whitespace
checks pass. Installed package: 26 matching files; Extendium: 22 unchanged files.

Backup: `C:\Program Files (x86)\Steam\millennium\backups\cs2-player-tracker-20260930-225858-760-e6b5b08e`.
Installed archive SHA-256: `928ea43ee4ad27a3019c3952cf27dc2e51631febac74efc4ae0999e2a523cb3f`.

Follow-up after the user said fml's match had ended: another fresh read still
returned the identical 13 `currentUsers`, while fml's `recentUsers.rtTimePlayed`
advanced to 1790823464. The displayed list therefore cannot be identified as the
last match; its match association is unknown. Refresh reads `currentUsers` only,
so it excludes fml even though the recent history updated. Calling the API through
the CS2 overlay window is not an alternative: that window's SteamClient does not
expose `Friends.GetCoplayData`; the shared context is also where Steam's own UI
calls it. No reliable automatic current-match replacement source has been verified.

### Screenshot-guided roster investigation (2026-10-01)

The supplied Premier Mirage scoreboard let us identify the actual source split:
all eight non-party opponents/teammates were in the newest `recentUsers` cohort,
with timestamps 89 seconds apart. FANTAZMA was absent from that list but present
in `friendStore.GetFriendsInGame(730)`, sharing the user's `steam_player_group`.
Adding that friend and the signed-in player produced the ten scoreboard IDs.
The unrelated 13 `currentUsers` remained unchanged throughout another match.

Official Competitive/Premier scans now use a **labelled estimate**: the entire
newest two-minute coplay cohort plus self and matching party friends. Require all
reported party members, exactly ten unique IDs, valid timestamps no older than
two hours, and activity after any observed lobby/map transition. Never take the
first nine history entries or pad a short cohort with old `currentUsers`. These
bounds are heuristics, not an API guarantee: coplay has no match ID, so close
matches, long joins/reconnects and missing friend data remain limitations.
Unknown/community modes still use the old unverified source without a ten-player
cap. Team assignment remains unknown.

While the report is open and the overlay visible, estimated rosters update when
membership/context changes, clearing old rows when detection becomes unavailable
or the player returns to the lobby. Canceled scans and manual replacements stay
under user control. Provider concurrency limits and generation isolation remain
in place. Persona photos work for the new roster through the existing path.

Live source probing observed the user's next lobby/map-veto state and correctly
returned no active-match roster. On joining the following match, new recent
players arrived in batches while the old current list remained frozen; the
selector initially refused the incomplete cohort rather than reusing old rows.

After that cohort completed, the selector returned ten players on Nuke: eight
new coplay entries, the same-party friend, and self. The user independently
confirmed sweetiebot, aiden, Marvz and MuADib against the new scoreboard. This
verifies the estimate on this match, not all modes or every future match.

Verification: 113 tests across 12 files pass, frontend/WebKit and test typechecks
pass, source and installed-identity production builds pass. The two browser test
fixtures initially lacked signed-in identity/rich presence; supplying the real
runtime contract fixed those fixtures without weakening the production checks.
26 installed files match the verified package and all 22 Extendium files remain
unchanged. Steam UI reloaded through its developer endpoint; CS2 stayed running.

Backup: `C:\Program Files (x86)\Steam\millennium\backups\cs2-player-tracker-20261001-004231-496-4a3ecc0d`.
Installed archive SHA-256: `5a415bdc849f737ae38bf2f74ec8d36dc190dc3e49ccacd8599052509aeebe7e`.

The first installed browser check exposed a separate controller race: an overlay
activation callback during the initial async capture launched another roster read.
The pending-read guard rejected it; revalidation then canceled the original scan
and left an empty stale report. A regression test reproduced this exact ordering.
Revalidation now waits while capture is in flight, so the original scan can finish.

Final verification after the race fix: 114 tests across 12 files pass, all
TypeScript checks and both production builds pass. After reinstall and Steam UI
reload, the first scan populated the actual native Steam browser report with ten
current Nuke players; no manual refresh was required. Native compatibility
diagnostics were empty. All ten row avatars plus the inspector avatar loaded.
Screenshot: `artifacts/steam-live/report-current-match.png`.

Final package: 26 installed files verified; Extendium's 22 files unchanged.
Backup: `C:\Program Files (x86)\Steam\millennium\backups\cs2-player-tracker-20261001-004609-291-e4edb22a`.
Final archive SHA-256: `145c3e8ceab921ddaf77d3115c8e9676556cb58d13c2c9cbc1c898f7ffe57ea3`.

### Individual player refresh (2026-10-01)

Each browser roster row now has a Refresh button. It queues fresh Leetify,
FACEIT and Steam requests only for that existing player, without recapturing the
roster or changing the report ID. Other rows retain their results and the selected
player/provider tab stays in place. Loading rows and known-stale rosters disable
the control; the controller also rejects unknown IDs, hidden/unvalidated reports,
and duplicate clicks while that player is loading. The existing two-request limit,
per-provider serialization, timeout handling and cooldowns still apply. CSStats
remains link-only.

Regression coverage exercises row isolation, duplicate clicks, fresh metrics,
unchanged roster capture count, cooldowns, stale/unknown players, IPC routing,
and clicking Refresh without triggering the row's selection handler.

Verification: 118 tests across 12 files pass; frontend/WebKit and test typechecks
pass; source and installed-identity production builds pass. Installed files match
the verified 26-file package; Extendium's 22 files remain unchanged. The live
Steam report rendered ten individual controls before the match ended.

Backup: `C:\Program Files (x86)\Steam\millennium\backups\cs2-player-tracker-20261001-010050-289-7c4b3350`.
Archive SHA-256: `a12880de7ae3ba39a10447c59c68da2d3b21e03934708a18bc4dc73519b1edb0`.

Live check: the row button entered Loading and issued new provider lookups with
new fetched-at timestamps. This check overlapped a report restart/cancellation,
so report-ID/other-row invariants in that run were inconclusive; automated tests
verify those invariants separately. Screenshot:
`artifacts/steam-live/report-player-refresh.png` captured the subsequent empty
automatic report, not the refresh controls. Temporary profile input was
cleared. The report closed before the restore action; reopening Scan players
starts automatic discovery and clears any manual replacement state.

### Last-30 K/D and custom profile input — 2026-10-01

- Leetify K/D now selects the newest 30 match records by finish time, on both public and legacy paths, before validating kills/deaths. Invalid stats reduce the displayed sample; older games do not fill gaps. Legacy K/D no longer inherits the other ratings' `gamesPlayed` window. Zero deaths still returns unavailable rather than infinity. Report labels show the 30-game window and actual sample; FACEIT lifetime statistics remain separately labelled.
- Manual input accepts bare custom profile names, `/id/name`, full Steam profile URLs, and schemeless Steam URLs alongside existing numeric Steam ID formats. HTTP input URLs are parsed as identities only; backend resolution still constructs an HTTPS Steam URL. Untrusted hosts, credentials, non-default ports and malformed identifiers remain rejected.
- The input panel shares the report's max width and responsive margins. Its accessible × button or Escape closes only the input panel, restores focus to Add profile links and preserves the draft.
- Verification: 125 Vitest tests across 12 files, 18 Lua tests, frontend/WebKit/test type checks, Lua parse checks and both production builds passed. The old native panel's test expectation for an unknown K/D window was updated to the now-known 30-game window. Headless Chromium checked matching panel/report bounds and no horizontal overflow at widths 1600, 1100, 600 and 390; X, Escape and draft preservation passed with no page errors. Screenshot with synthetic data: `artifacts/report-ui-check/report-input.png`.
- Installed compatibility package `artifacts/report-release-source/dist/cs2-player-tracker-v0.1.0.zip`, SHA256 `002fe24481c7d588ce9c84572bc537b6a39617721b786f773ac08d9707f043e7`. All 26 installed files matched; Extendium's 22 files were unchanged. Backup: `C:\Program Files (x86)\Steam\millennium\backups\cs2-player-tracker-20261001-011827-511-c09dd018`.
- Millennium v3.5.0 exposes a frontend reload menu but does not register `Core_ReloadPlugin` in the installed backend. Reload succeeded using `Core_ChangePluginStatus` with disable/enable for this plugin in one request; its backend was confirmed running afterward. CS2 stayed running. A live installed-backend check resolved the signed-in player's custom ID `dukeorange` to `76561198061575263`; Leetify returned K/D `1.2428940568475` with `kd_matches=30`. No match roster was replaced during this check. UI interaction/width verification used the real report code with a synthetic provider response, not a current-match claim.

### Scan returned no roster with a non-friend party member — 2026-10-01

- Reproduced from the real Scan players button: report opened but showed zero rows and “Steam party information is incomplete.” Steam's Dust II presence reported a party size of three, while friend presence exposed only the signed-in player and FANTAZMA. Eight current recent-player records plus these two known identities formed ten. The user confirmed Decepticon, fluffyz, shmir and Leynad were current players.
- Root cause: roster selection required every party member to be known through Steam friend presence. This incorrectly rejected a complete recent-player union when one party member was not a Steam friend. The selector now allows that member to come from recent activity. The union must still have exactly ten unique players; freshness, observed-transition and oversized/incomplete-cohort checks remain.
- Regression reproduced before the change and passed afterward. All 126 frontend tests, frontend/WebKit/test type checks, source and compatibility builds passed. Installed package matched all 26 files; Extendium's 22 files were unchanged. Archive SHA256: `783c2e04058fb834009deca96ae761958cfd9c9c7af1fde942b8c65e3fd1b920`. Backup: `C:\Program Files (x86)\Steam\millennium\backups\cs2-player-tracker-20261001-012747-396-eed46fd5`.
- Reloaded Steam's SharedJSContext and clicked the actual overlay Scan players button. The installed report rendered ten rows: shmir, Decepticon, Leynad, ✭ m1𝕂z, Dianne713, Average Counter Strike Enjoyer, DreShez, fluffyz, uppy and FANTAZMA, with the new K/D · Last 30 column. Compatibility diagnostics were empty. Initial provider results remained loading with no pending IPC; requested an overlay-visible check because provider work pauses when the overlay is hidden.
- User then confirmed: “Yes, stats appear” with the overlay visible. Scan-to-roster-to-provider display was therefore confirmed in the current match.

### Suspicious Aim at 97 or higher — 2026-10-01

- Added an independent Leetify Aim ≥ 97 rule, including exactly 97, with “Suspicious aim” labels and a separate Aim threshold explanation. Missing/invalid Aim does not trigger it. K/D still requires ≥ 2.00 across at least 20 usable records within the latest 30 games; both qualifying reasons are retained. The Aim cell is highlighted independently of K/D, and the existing highlighting toggle applies to both. The original Steam Community profile card now uses the same 97 threshold instead of >92.
- New tests first reproduced the absent rule and incorrect K/D-only presentation. Verification then passed: 138 tests across 12 files, frontend/WebKit/test type checks, and source/compatibility production builds. Coverage includes 96.99, 97, 100, invalid values, missing/insufficient K/D samples, both rules together, correct metric highlighting and the toggle.
- Installed the verified 26-file compatibility package; Extendium's 22 files were unchanged. Archive SHA256: `34d8f8e01341e067d10d28cd814aab863e5bda830ba3618597537b1ab89b1e2e`. Backup: `C:\Program Files (x86)\Steam\millennium\backups\cs2-player-tracker-20261001-014015-448-febfd9d4`.
- Reloaded Steam's SharedJSContext without restarting CS2. The plugin loaded with empty compatibility diagnostics, and the real Scan players control was clicked to reopen the report. Aim boundary verification used controlled test data; no current player's Aim rating was invented or modified.
