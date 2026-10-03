# CS2 Lobby Stats

A Windows Steam Millennium plugin built on [Shightrox's CS2 Profile Stats](https://github.com/Shightrox/millennium-cs2-profile-stats). Open CS2's **Shift+Tab** overlay and select **Scan players** to open the report and load players. Select **Scan All** when ready to fetch public player stats.

- A local report tab in Steam’s built-in overlay browser, with the Quick review roster and player inspector.
- Quick review with Leetify Rating, Aim, Time to Damage and derived K/D over the latest 30 games tracked by Leetify.
- Profile tabs: **Leetify → CSStats → FACEIT → Steam**.
- Leetify metrics retain their original units. CSStats is an external profile link; CSRep and CSTracker link to the selected player's profile across every provider tab.
- Highlighting uses three independent plugin rules: Leetify Aim ≥ 97, Time to Damage ≤ 475 ms (including exactly 475), or K/D ≥ 2.00 across at least 20 valid matches within the latest 30 tracked games. Aim 97+ is labeled “Suspicious aim” and Time to Damage at or below 475 ms is labeled “Suspicious Time to Damage”, even when recent K/D is unavailable; each flagged metric shows its own reason. Missing or invalid timing values do not trigger the rule. These are plugin thresholds, not Leetify benchmarks or proof of cheating. The public API does not supply verified benchmark cutoffs.
- Community rosters up to 128 unique human IDs. Coverage stays unverified; Steam may omit players. **Add profile links** supplements the roster.
- Team sections are supported when assignments are verified. Steam's inspected current-player feed has no team data, so the initial adapter shows **Team unknown**.
- Original Steam Community profile cards, Premier, FACEIT, Steam activity, optional SCOPE fallback and optional Leetify key are preserved. Bulk reports skip SCOPE and inventory lookups.

## Install

1. Extract `dist/cs2-lobby-stats-v0.1.0.zip`. Keep the entire `cs2-lobby-stats` folder, including `.millennium`.
2. Run the installer from this repository in PowerShell, replacing the sample source path:

   ```powershell
   .\scripts\install.ps1 -PluginPath 'C:\Downloads\cs2-lobby-stats'
   ```

   Default destination: `C:\Program Files (x86)\Steam\millennium\plugins\cs2-lobby-stats`.
   Add `-WhatIf` to inspect the destination without writing. Existing installations are backed up under `Steam\millennium\backups`. Other plugins are untouched. The installer does not stop Steam.
3. Enable **CS2 Lobby Stats** in Millennium's plugin settings. Restart Steam when ready if the new plugin is not listed or loaded.
4. Start CS2, join a game, open Shift+Tab, then select **Scan players**. The player list loads automatically; select **Scan All** to start stats lookups.

Alternatively, copy the extracted folder into Millennium's plugins directory. If the original **CS2 Profile Stats** plugin is enabled separately, disable that original plugin to avoid duplicate profile cards; this fork includes it.

Previously installed **CS2 Player Tracker**? Disable it before enabling **CS2 Lobby Stats** to avoid duplicate scans and profile cards. The new plugin ID is `cs2-lobby-stats`; the installer leaves the old `cs2-player-tracker` installation and its settings in place. Re-enter any optional API key and preferred settings in the new plugin.

To roll back, close Steam, move the current `cs2-lobby-stats` directory aside, and restore its saved backup with that exact folder name. Restart Steam.

## Report controls

The report opens in the clicked CS2 overlay’s built-in browser. Its HTML and styles are packaged locally; no report website or external browser is required. Provider links open browser tabs.

Opening the report only loads player identities from Steam. Players show **Not scanned** until you choose **Scan All** or a player's **Scan** button. **Scan All** scans the displayed list, including manual additions, without replacing it with a fresh Steam roster. It is disabled while loading, with an empty list, or when the roster is stale. Loading a roster alone does not create a saved report.

Steam's `GetCoplayData().currentUsers` was frozen across multiple live matches. For official Competitive/Premier, scans now estimate the roster from the newest two-minute group in `recentUsers`, plus the signed-in player and friends sharing their Steam party. The union of recent players and known party members must total ten, and latest activity must be under two hours old. Party members who are not Steam friends can come from recent activity; Steam need not expose their party presence separately. Observed lobby/map transitions reject older entries. This is labelled **Estimated match**, not verified scoreboard data: Steam supplies no match ID, and closely spaced matches, reconnects or missing friends can still prevent or confuse detection. Other modes retain the explicitly unverified Steam current-player source.

If the estimate is wrong or unavailable, use **Add profile links → Replace list** with links from your scoreboard. **Add players** appends; both actions prepare the list for **Scan All** without starting stats lookups. **Refresh report** reads Steam again and scans the refreshed list. Profile pictures and display names come from Steam's persona cache, with initials as a fallback.

Each player has a **Scan** button, changing to **Refresh** after scanning, that loads only their Leetify, FACEIT and Steam results, keeping the roster, other players and selected provider tab in place. It is disabled while that player is loading or the roster is stale, and respects provider cooldowns. **Refresh report** reads Steam again and removes manual additions after a successful capture. A failed refresh retains the last captured players and available stats with a warning. Provider results arrive independently. **Cancel** stops queued lookups; **Close** releases the report. Reopening Shift+Tab checks the roster before accepting pending results. Estimated match rosters update automatically while the report is open and the overlay is visible; changed rosters wait for **Scan All** before fetching stats. Temporary Steam errors or incomplete presence retain captured players with a warning while checks continue; a confirmed departure from the match clears old players. Other roster sources require an explicit refresh when changed.

**History** opens saved reports, newest first, with capture time, map when available, player count, and finished/partial status. Each nonempty scan saves automatically as its stats arrive. Saved reports retain captured names, provider results, and flags; viewing them makes no new stats requests. **Current report** returns to the live scan and its selected player/provider. **Delete** removes one saved report; **Clear history** asks before deleting all reports for the signed-in Steam account. History begins with scans made after this update; previously discarded reports cannot be recovered.

Up to 50 reports per Steam account are kept in Steam's local browser storage across restarts. A 4 MiB history budget may retain fewer unusually large reports. Plugin updates preserve this storage; clearing Steam browser data removes it. Storage failures show a warning and leave available reports in memory. History stays on this computer, with no upload or account synchronization.

Paste SteamID64, `[U:1:accountid]`, `STEAM_0/1:X:Y`, Steam Community `/profiles/` and `/id/` links, or a bare custom profile name. Links also work without `https://`, and `/id/name` is accepted; resolution always uses Steam over HTTPS. The input panel matches the report width; its **×** button or **Escape** closes it while preserving your draft. Input is limited to 32 KiB and 128 unique players. Bots have no public human profile. Unsupported, private and missing data stay neutral. K/D sums kills and deaths from valid records inside the latest 30 tracked games; it shows the actual sample (such as 20/30) if fewer are available and never fills gaps with older games. FACEIT lifetime K/D remains separately labelled. Extra calculation notes are under **Data details**.

The only new setting is **Highlight unusual stats**. Existing Leetify API key and profile display settings remain available. No key is mandatory; the public providers may impose stricter anonymous rate limits.

Two IPC calls may be outstanding across report providers and manual profile resolution, at most one per provider. Manual profile resolution shares the Steam request slot and cooldown. Closing, canceling, refreshing, hiding the overlay or leaving CS2 cancels queued manual lookups. A stale roster must be refreshed before adding profiles. Requests time out, and 429 responses cause a provider cooldown without automatic retries. If a backend call remains unresponsive, its slot stays reserved until it returns; refresh after recovery. Saved report history is local only, with no telemetry, exported player database, game-memory access or automatic player reporting.

If **Scan players** is absent, open the plugin settings for compatibility diagnostics. Missing overlay lifecycle support blocks scans. Missing roster discovery still allows manual profiles when the overlay lifecycle is available.

## Validation status

Automated tests cover parsing, privacy, numeric normalization, evidence, cancellation, bounded concurrency, UI interactions and real Windows PowerShell installation/rollback. The UI imports actual Steam components; jsdom replaces only the unavailable Steam runtime boundary for interaction tests.

Detected locally: Millennium **v3.5.0**, Steam executable **10.96.30.42**. CS2 was not running during installation preparation. Native overlay appearance and roster completeness in Premier, Competitive, Wingman, Casual, Deathmatch, Arms Race, FACEIT and community servers remain **untested**. No all-mode completeness claim is made. See [live validation checklist](docs/validation/cs2-overlay.md) in the source repository.

## Development

Node 24, pnpm 10.33.1 and Lua 5.4:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm typecheck
pnpm typecheck:tests
pnpm check:lua
lua5.4 tests/lua/run.lua
```

On Windows: `powershell -File scripts/package.ps1 -SkipBuild` after building.
Validate an extracted release with `node scripts/verify-package.mjs <path>/cs2-lobby-stats`.
The build excludes tests, docs, mockups and development dependencies. Run it before tests: the IPC smoke test executes the compiled frontend to catch missing plugin IDs. Keep `@steambrew/client` namespace imports named `client`; TTC 3.3 uses that name when injecting plugin IDs into IPC and configuration calls.

MIT license. Original work © Shightrox; upstream provenance is recorded in [UPSTREAM.md](UPSTREAM.md). Leetify data is attributed in the report and linked back to Leetify.
