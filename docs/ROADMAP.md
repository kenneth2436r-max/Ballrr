# Ballrr — Vision & Roadmap

## The gap

Grassroots football in India has plenty of one-off tournament trackers (fixtures, tables, brackets) and plenty of general fitness trackers, but nothing that combines tournament management, player-level performance tracking, and a community/group layer in one place — for football specifically. Cricket already has this: CricHeroes built a huge, sticky product around exactly that combination for grassroots cricket. Football doesn't have an equivalent at that scale in India yet. That's the opening.

Ballrr is already structurally positioned to be that product: shared tournaments, live tables, brackets, player stats, archetypes, synergy, rotational players, a trophy cabinet/archive, RSVP and check-in, a fee ledger — the tournament + performance + community pieces are already there, running on manually (and voice-) entered data.

## Where accuracy currently comes from, and where it could go

Right now, data quality depends on whoever's recording the match — that's normal for grassroots sport and is exactly how CricHeroes and every other grassroots app starts too. The long-term vision is to make data collection progressively more automated and accurate, without waiting for full automation before the app is useful. That means treating automation as a series of phases, not one leap.

## Phase 0 — Done

Shared, real-time tournament tracking (league/knockout/hybrid formats, custom brackets); player stats, ratings, archetypes, synergy, rotational players; RSVP, QR check-in, fee ledger; voice-logged match events; PWA install on iOS, native Android app; themed UI throughout; live on Firebase with auto-deploy from GitHub.

This phase proves the "tournament + performance + community" concept works end-to-end. It's the foundation everything else builds on.

## Phase 1 — Smarter assisted entry (near-term, buildable in the current app)

The highest-leverage next step isn't full automation — it's making *manual* entry faster and more accurate. Ideas in rough priority order:

- Expand voice logging (already exists) to cover more event types with less friction.
- Photo-based scoresheet capture: snap a photo of a handwritten scoresheet, OCR extracts scores/scorers for confirmation rather than typing everything.
- Lightweight in-match prompts that reduce ambiguity at the point of entry (e.g. confirming who's on the pitch before logging a goal, rather than correcting it after).
- Public/discoverable tournament directory so strangers can find and join local grassroots tournaments, not just people with a share code — this is a growth lever, not a data-accuracy one, but it's what turns this from "an app for my friend group" into "the app for grassroots football in my area."
- Deeper performance analytics on top of data that's already being collected (trend lines, head-to-head history, form guides) — squeezing more value out of existing data before chasing new data sources.

This phase needs no new technical discipline — it's an extension of what's already built, at the pace of normal feature development.

## Phase 2 — AI-assisted video analysis (medium-term, real R&D)

A phone camera watching a match and automatically detecting goals, tracking rough ball position, and generating highlight clips. This category already exists commercially (Veo, for club/academy football abroad) — it's proven possible, but it's genuinely hard at grassroots level: uneven pitches, inconsistent lighting, camera shake, players occluding the ball. This is a computer-vision engineering project in its own right — it needs dedicated ML/CV expertise, a video processing pipeline (almost certainly server-side, not something that runs in this single-file web app), and real compute cost per video processed.

Realistic entry point: start narrow. A simple audio-spike or crowd-noise detector that auto-clips a few seconds around likely "big moments" is a much smaller, achievable slice of this problem than full event detection, and it's a natural first experiment before committing to full video understanding.

## Phase 3 — Physical sensors (long-term, a different business)

Wearables or sensor-embedded balls (in the spirit of FIFA World Cup 26's connected ball) for automated positional and event data. This is not a software feature — it's hardware manufacturing, firmware, Bluetooth/data pipelines, per-unit cost, and multi-year iteration. Products like Playermaker (a wearable boot sensor) already exist in this space commercially. If Ballrr ever goes here, it would effectively be a hardware/IoT startup built on top of the software product, with its own funding and team requirements — not an extension of the current app.

## AR — a presentation layer, not an accuracy fix

AR (player cards, live stat overlays) is worth keeping in mind as a fun, comparatively cheap engagement feature at any phase, but it doesn't solve the data-accuracy problem by itself — that's what Phases 2 and 3 are for. Think of AR as decoration on top of good data, not a source of it.

## How to sequence this

Don't chase Phase 2 or 3 before Phase 1 has real usage and feedback behind it. The value of nailing "tournament + performance + community" for grassroots Indian football, with good manual/assisted data, stands on its own — it's the CricHeroes-for-football play, and it doesn't need AI or hardware to matter. Phase 2 and 3 are legitimate future bets, best pursued once there's a real, engaged user base whose feedback can point at which automation would actually move the needle for them.
