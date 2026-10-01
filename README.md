# CS2 Player Tracker

A Windows Steam Millennium plugin built on [Shightrox's CS2 Profile Stats](https://github.com/Shightrox/millennium-cs2-profile-stats). Open CS2's **Shift+Tab** overlay and select **Scan players** for an on-demand report of public player history.

- Quick review with Leetify Rating, Aim, Time to Damage and recent derived K/D.
- Profile tabs: **Leetify → CSStats → FACEIT → Steam**.
- Leetify metrics retain their original units. CSStats is an external profile link; CSRep and CSTracker are persistent site links.
- Highlighting uses one labeled plugin rule: recent Leetify K/D ≥ 2.00 across at least 20 valid matches. This is not a Leetify benchmark or proof of cheating. The public API does not supply verified benchmark cutoffs.
- Community rosters up to 128 unique human IDs. Coverage stays unverified; Steam may omit players. **Add profile links** supplements the roster.
- Team sections are supported when assignments are verified. Steam's inspected current-player feed has no team data, so the initial adapter shows **Team unknown**.
- Original Steam Community profile cards, Premier, FACEIT, Steam activity, optional SCOPE fallback and optional Leetify key are preserved. Bulk reports skip SCOPE and inventory lookups.

## Install

1. Extract `dist/cs2-player-tracker-v0.1.0.zip`. Keep the entire `cs2-player-tracker` folder, including `.millennium`.
2. Run the installer from this repository in PowerShell, replacing the sample source path:

   ```powershell
   .\scripts\install.ps1 -PluginPath 'C:\Downloads\cs2-player-tracker'
   ```

   Default destination: `C:\Program Files (x86)\Steam\millennium\plugins\cs2-player-tracker`.
   Add `-WhatIf` to inspect the destination without writing. Existing installations are backed up under `Steam\millennium\backups`. Other plugins are untouched. The installer does not stop Steam.
3. Enable **CS2 Player Tracker** in Millennium's plugin settings. Restart Steam when ready if the new plugin is not listed or loaded.
4. Start CS2, join a game, open Shift+Tab, then select **Scan players**.

Alternatively, copy the extracted folder into Millennium's plugins directory. If the original **CS2 Profile Stats** plugin is enabled separately, disable that original plugin to avoid duplicate profile cards; this fork includes it.

To roll back, close Steam, move the current `cs2-player-tracker` directory aside, and restore its saved backup with that exact folder name. Restart Steam.

## Report controls

**Refresh report** always captures a fresh roster and removes manual additions. Provider results arrive independently. **Cancel** stops queued lookups; **Close** releases the report. Reopening Shift+Tab checks the roster before accepting pending results. A changed roster requires an explicit refresh.

Paste SteamID64, `[U:1:accountid]`, `STEAM_0/1:X:Y`, or HTTPS Steam Community `/profiles/` and `/id/` links. Input is limited to 32 KiB and 128 unique players. Bots have no public human profile. Unsupported, private and missing data stay neutral. Extra calculation notes are under **Data details**.

The only new setting is **Highlight unusual stats**. Existing Leetify API key and profile display settings remain available. No key is mandatory; the public providers may impose stricter anonymous rate limits.

Two report IPC calls may be outstanding, at most one per provider. Requests time out, and 429 responses cause a provider cooldown without automatic retries. If a backend call remains unresponsive, its slot stays reserved until it returns; refresh after recovery. Reports are memory-only, with no telemetry, exported player database, game-memory access or automatic player reporting.

## Validation status

Automated tests cover parsing, privacy, numeric normalization, evidence, cancellation, bounded concurrency, UI interactions and real Windows PowerShell installation/rollback. The UI imports actual Steam components; jsdom replaces only the unavailable Steam runtime boundary for interaction tests.

Detected locally: Millennium **v3.5.0**, Steam executable **10.96.30.42**. CS2 was not running during installation preparation. Native overlay appearance and roster completeness in Premier, Competitive, Wingman, Casual, Deathmatch, Arms Race, FACEIT and community servers remain **untested**. No all-mode completeness claim is made. See [live validation checklist](docs/validation/cs2-overlay.md) in the source repository.

## Development

Node 24, pnpm 10.33.1 and Lua 5.4:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm typecheck:tests
pnpm check:lua
lua5.4 tests/lua/run.lua
pnpm build
```

On Windows: `powershell -File scripts/package.ps1 -SkipBuild` after building.
Validate an extracted release with `node scripts/verify-package.mjs <path>/cs2-player-tracker`.
The build excludes tests, docs, mockups and development dependencies.

MIT license. Original work © Shightrox; upstream provenance is recorded in [UPSTREAM.md](UPSTREAM.md). Leetify data is attributed in the report and linked back to Leetify.
