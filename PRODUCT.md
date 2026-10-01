# Product

## Register

product

## Users

A CS2 player checking the people on their current server through Steam's Shift+Tab overlay. They have a short pause between rounds, a mouse and keyboard, and limited attention. All modes matter, including community servers with larger rosters. The user selected Quick review and requested Leetify-first statistics, provider tabs, and team groups before implementation.

## Product Purpose

Turn an on-demand current-player scan into a readable public-statistics report. Help the player spot unusual patterns, inspect the supporting evidence, and return to the game quickly. Show what data is available and how the roster was obtained. Allow pasted profile links when Steam's current-player feed is incomplete.

## Brand Personality

Direct, measured, familiar. Use normal concise product copy. The assistant's caveman conversation style does not apply to interface labels or documentation.

## Anti-references

Avoid cheat-detector theatrics, unsupported risk percentages, security dashboard decoration, neon gaming HUDs, bright warning-colored screens, and oversized KPI cards. Do not imply a private profile, low hours, or missing statistics indicate cheating. Avoid a separate website feel inside Steam.

## Design Principles

1. Help the player scan the roster in seconds, then inspect one player in depth.
2. Explain every flag with the source, metric, threshold, and sample size.
3. Distinguish unknown data from ordinary data; never infer full roster coverage.
4. Use Steam's actual React components from `@steambrew/client` (or `millennium` for Starlight), preserving their appearance, interaction states, and the route back to the game. Plain HTML is permitted only when Steam has no suitable component, with the missing component documented.
5. Make historical statistics and sample/mock data explicit.
6. Lead with Leetify Rating, Aim, Time to Damage (ms), and recent K/D; give each provider its own profile tab. Keep FACEIT secondary and CSStats external-only until supported import is verified. Provide persistent CSRep and CSTracker site links; CSRep API contracts remain unverified.
7. Use Leetify benchmark comparisons only with verified cohort/cutoff data. Never present performance bands as cheating thresholds or Aim as a percentile.
8. Split verified current teams; show unknown assignments and free-for-all honestly. The inspected Steam roster interface does not expose teams.

9. Minimize default subtext: no routine status subtitles or repeated explanations. Keep counts, units, coverage, and flag evidence; disclose secondary data notes on demand.

## Accessibility & Inclusion

Pair color with readable labels and icons. Target WCAG AA contrast, visible keyboard focus, usable pointer targets, tabular numbers, and reduced-motion support. Keep unavailable values explicit. The desktop overlay must work at 1280×720 and above; design previews must also reflow in the conversation.

## Current Design Context

Scene: a player in a dim room opens Steam's dark overlay during a brief break in a CS2 match and needs a calm, low-glare report before returning to play. This calls for opaque dark surfaces and restrained action color, with amber reserved for unusual-stat evidence.

The proposed design spec is `docs/superpowers/specs/2026-09-30-cs2-server-report-design.md`. Steam-native appearance and component reuse are mandatory. Production must inherit Steam's typography, controls, surfaces, focus treatment, and theme rather than recreate them with plugin CSS. Inline mockups approximate appearance outside Steam; their HTML and CSS are not production components. Quick review is the selected visual direction. The revised preview uses synthetic teams and data; it does not prove automatic team discovery, benchmark availability, or approval of product implementation.
