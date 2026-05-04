# `data/sounds/` provenance

This directory is the source-of-truth for the urgency-loop audio bank
(SPEC §6.12). At session start, the focus shell picks one MP3 file at
random from this directory and loops it after the per-question target.

The build-time script `scripts/copy-sounds-to-public.ts` copies the
top-level `*.mp3` files into `public/audio/sounds/` and emits the
runtime manifest at `src/config/sound-bank.ts`. Subdirectories under
`data/sounds/` (e.g., `success/`, `failure/`, `ticks/`) are NOT
enumerated; the bank is the top-level files only.

## CC0 / public-domain placeholder samples

Added on commit 2 of the focus-shell post-overhaul-fixes round
(2026-05-03). Both files are sourced from Wikimedia Commons under
explicit public-domain release. They exist only to verify the
random-pick playback path; they are NOT a curated bank.

| File | Source | License | Notes |
|---|---|---|---|
| `cc0-clock-tick.mp3` | https://commons.wikimedia.org/wiki/File:LA2_kitchen_clock.ogg | Public domain (released worldwide by author, see source page) | Trimmed to 10s, mono, 64 kbps, MP3-encoded via ffmpeg. Original is a 20-second OGG kitchen-clock recording by Wikimedia user LA2. |
| `cc0-school-bell.mp3` | https://commons.wikimedia.org/wiki/File:Old_school_bell_1.ogg | Public domain (released worldwide by author "ezwa", see source page) | Trimmed to 10s, mono, 64 kbps, MP3-encoded via ffmpeg. Original is a 20-second OGG school-bell ring sourced from pdsounds.org and republished on Wikimedia Commons. |

## Other files

Other MP3 files at the top level of `data/sounds/` (and within the
subdirectory collections) were added in earlier commits with
unverified provenance. They are accepted as placeholder content for
internal dogfooding only. Before any public release:

- Verify each file's license and credit it here OR remove it.
- Replace anything not CC0 or owned-content with curated samples.

The two `cc0-*.mp3` files above are safe to ship publicly as-is.
