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
DialogButtonSecondary provides its action/focus behavior.

The existing upstream Community card runs in the separate webkit context, where
@steambrew/client React components are unavailable. Its existing HTML renderer and
CSS are preserved for that context only; they are not reused in the new report.

## Required live probe (not yet observed)

- Installed Millennium and Steam versions.
- CS2 overlay host metadata/window association; button visibility and click.
- Native component resolution, typography, theme, focus, Escape and unload cleanup.
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

- 64 TypeScript/React tests passed, including real Windows PowerShell archive,
  dry-run, replacement, backup and injected-rename-failure rollback tests.
- 13 Lua behavioral tests passed; syntax is checked for every backend Lua file
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
No previous tracker directory existed, so no replacement backup was needed.
The installed package passed verification. Extendium's manifest SHA-256 was
unchanged. Steam remained running; the plugin has not been enabled or observed
inside a live CS2 overlay. Enable it in Millennium and restart Steam when ready.
