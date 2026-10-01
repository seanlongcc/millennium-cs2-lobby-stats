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
