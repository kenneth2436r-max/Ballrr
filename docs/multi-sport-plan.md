# Multi-Sport Support (Phase 4) -- wiring plan

Status: **not implemented**. `SPORT_CONFIGS` (in `public/index.html`, right above `POSITIONS`)
is a data scaffold only -- nothing in the app reads from it yet. This document is the plan for
actually wiring it in, written so that work can be picked up as its own dedicated effort rather
than rushed alongside everything else in this pass.

## Why this is separate from Phases 1-3

Football is hardcoded throughout a large (~13,700 line), single-file, live production app:
position labels, the pitch/formation view, the auto-rating algorithm's per-position weighting,
defensive-stat and card tally fields, PDF report templates, the balanced-draft algorithm, and
match-length defaults all assume football specifically, not "whatever `state.sport` is." Real
users have real tournaments running on this today. Generalizing all of that safely means changing
a lot of load-bearing code, and every step needs to be verified as byte-identical for football
before moving to the next -- that's a multi-session effort in its own right, not something to fold
into a broader pass without the risk of breaking the sport the app already serves well.

## Recommended sequencing

1. **Add `state.sport` (default `'football'`), still fully inert.** Every tournament created
   before this field existed, and every one created without explicitly choosing a sport, must
   behave exactly as today. No UI exposes this yet.
2. **Position labels.** Repoint the 8 existing `POSITIONS` call sites (`getPlayerPositions`,
   `setPlayerPositions`-equivalents, the two voice-log position-parsing sites, the position-chip
   picker, and the position `<select>` options -- see `grep -n "\bPOSITIONS\b" public/index.html`)
   to a `currentPositions()` helper that reads `SPORT_CONFIGS[state.sport||'football'].positions`.
   Verify with a test that `currentPositions()` returns the exact same array as the old constant
   when `state.sport` is unset or `'football'`.
3. **Stat/card tally fields.** `CONTRIB_STAT_KEYS`/`CARD_STAT_KEYS`/`DEF_STAT_TALLY_FIELDS`/
   `DISCIPLINE_TALLY_FIELDS` become sport-aware the same way, reading from
   `SPORT_CONFIGS[...].statFields`/`cardFields`. This is the biggest blast radius -- these feed
   `bumpContribAndRender`/`bumpCardAndRender` (including this session's targeted-DOM-update code),
   `aggregateContribTotals`, career/host/verified-card builders, and both PDF report generators.
   Each of those needs its own before/after test proving football output is unchanged.
4. **Match length default.** `t.targetMinutes` in `matchTimerHtml`/`koTimerHtml` currently
   defaults to `90`; read `SPORT_CONFIGS[state.sport||'football'].defaultMatchMinutes` instead.
   Low risk, but do it after steps 2-3 are proven so any regression is easy to isolate.
5. **Rating algorithm.** `computePlayerMatchRating`'s per-position weighting is football-specific
   (goalkeeper clean-sheet weighting, defender vs forward weighting, etc.) and has no
   straightforward generic form -- this likely needs a `SPORT_CONFIGS[sport].ratingFn` per sport
   rather than one generalized formula. Treat as its own design problem, not a mechanical
   extraction like steps 2-4.
6. **PDF report templates.** `generatePlayerReportPdf`/`generateTournamentReportPdf` render
   football-specific section titles and stat tables. A sport-aware report needs its own template
   per sport (reusing the shared layout/branding helpers -- `pdfSafeText`, `pdfFooter`,
   `barColor` -- but not the football-specific section builders).
7. **Draft balancing.** The balanced-draft algorithm currently reasons about football positions
   directly (ensuring each team gets a GK, etc.). This needs to read `SPORT_CONFIGS[sport]`'s
   positions and a sport-specific "what does a balanced team need" rule, which will differ
   meaningfully between, say, football (needs exactly one recognized GK per side) and basketball
   (no equivalent constraint).
8. **Only after 1-7 are done and tested**, expose a "Sport" choice somewhere a tournament is
   created (Settings or the initial setup flow), gated so switching sport on an
   already-started tournament is either disallowed or handled deliberately (position/stat data
   from one sport showing up in another's UI would be a real bug, not just a cosmetic one).

## Suggested pilot sport

Basketball (already sketched in `SPORT_CONFIGS`) over cricket or another football-adjacent sport,
specifically because its stat model (rebounds/steals/blocks/turnovers, foul limits instead of
card colors) is different enough from football to prove the abstraction actually generalizes,
while its match structure (two teams, a running clock, a single score each) is close enough to
football's that steps 1-4 above don't also need to solve a structurally different match format
(e.g. innings-based cricket) at the same time.

## What NOT to do

Do not attempt to make `POSITIONS`, the stat tally fields, and the PDF templates sport-aware in
one combined change. Each of steps 2-6 above touches a different, independently-testable surface
of the app; bundling them removes the ability to isolate which change caused a regression if one
shows up in a football tournament someone is using live.
