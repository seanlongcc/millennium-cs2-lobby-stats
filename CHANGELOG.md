# CS2 Lobby Stats 0.1.0

- Renames the project from CS2 Player Tracker to CS2 Lobby Stats, with plugin ID `cs2-lobby-stats` and repository `millennium-cs2-lobby-stats`.
- Adds native Steam overlay reports, manual roster supplementation, Leetify-first review and provider tabs.
- Adds bounded provider requests, privacy checks, explainable recent K/D flags and Windows installation with rollback.
- Forks upstream 0.4.5; original profile cards remain available.

# Changelog

All notable changes to this project are documented here. The project follows [Semantic Versioning](https://semver.org/).

## [0.4.5] - 2026-08-15

### Added

- Show the FACEIT nickname, lifetime match count, ELO, and K/D in a two-line compact profile summary.
- Replace the rectangular FACEIT level badge with a colored circular level indicator.

### Fixed

- Parse FACEIT's compact lifetime-stat keys so match count, K/D, ADR, headshots, win rate, and recent results continue to load.
- Keep the HTML lifetime-stat fallback available when the expected official API fields are missing.
- Position the FACEIT level-ring opening at the bottom to match FACEIT's visual language.

## [0.4.4] - 2026-08-14

### Fixed

- Point the plugin manifest at Millennium's current JSON schema location.

### Changed

- Replace cropped card previews with full Steam profile screenshots for the public listing.

## [0.4.3] - 2026-08-14

### Fixed

- Treat unavailable optional enrichment as informational output instead of a plugin warning.
- Prevent normal SCOPE.GG, FACEIT lifetime-stat, and recent K/D gaps from showing a yellow warning in Millennium.

### Added

- Public release documentation, real Steam screenshots, CI, and an installable archive script.

## [0.4.2] - 2026-08-14

### Fixed

- Keep match count and K/D inside narrow profile cards with responsive wrapping.

## [0.4.1] - 2026-08-14

### Changed

- Refined Aim presentation: `85–92` uses a target marker and values above `92` use an anomalous-rating marker.

## [0.4.0] - 2026-08-14

### Added

- Recent K/D and tracked-match count in the compact card.
- FACEIT level, match count, and rank colors.
- Premier rank colors and Aim rating markers.
- On-demand public CS2 inventory estimates using Steam Market prices.

### Fixed

- FACEIT lifetime-stat lookup now uses the discovered FACEIT nickname.

## [0.3.0] - 2026-08-14

### Changed

- Rebuilt the profile card with a Steam-native compact summary and detail tabs.

### Added

- Recent match form and match history.
- Graceful empty and partial-data states.
