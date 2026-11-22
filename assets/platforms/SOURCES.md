# Platform badge assets — sources and trademark notes

These files are used as small (up to 16px inside a 24px disc) badges on video-game
grid tiles. Original proportions are kept (`object-fit: contain`).

For V2.9 the five official marks are rendered as **white monochrome**: existing
fills in the files already in this repo were recolored to `#ffffff`. No new
files were downloaded. A CSS filter was not used.

Micah accepted the trademark risk of using these marks for **personal use**.
Berean had not cleared them for release. They remain trademarked; do not treat
this as a license to ship publicly without a further trademark review.

## Assets included (white monochrome, official artwork)

### xbox.svg — Xbox (2019 family mark; unused for badges as of V2.16)

- Source URL (Wikimedia Commons): https://commons.wikimedia.org/wiki/File:Xbox_logo_(2019).svg
- Documented origin: uploaded 7 May 2020 as a work by Microsoft Corporation from https://www.xbox.com/en-US/
- License note on Commons: public-domain text logo (threshold of originality); **trademarked** (Microsoft / Xbox).
- V2.9 treatment: the path had no explicit fill (browser default black). Fill set to `#ffffff`. Proportions unchanged.
- V2.16: this file stays in the folder and is still precached, but it is no longer
  the badge for Xbox, Xbox 360, Xbox One, or Series X|S. Those platforms use the
  Micah-supplied marks listed below.

### playstation.svg — PlayStation (PSN, PS1, PS2, PS3, PS4, PS5)

- Source URL (Wikimedia Commons): https://commons.wikimedia.org/wiki/File:PlayStation_logo.svg
- Documented origin: http://www.playstation.com ; author Sony Interactive Entertainment (Commons file page).
- License note on Commons: public-domain text logo (threshold of originality); **trademarked** (Sony Interactive Entertainment / PlayStation).
- V2.9 treatment: the official one-color mark is already a monochrome wordmark. The path fill was `#1f1f1f`; it was recolored to `#ffffff`. A family mark is used for every PlayStation-family platform in the app; no per-generation logo was invented.

### switch.svg — Nintendo Switch

- First-party source URL: https://www.nintendo.co.jp/common/v2/img/ncommon/_common/logo/switch.svg
- Retrieved in V2.8 from Nintendo's official site (HTTP 200, `image/svg+xml`). Also catalogued on Commons as File:Nintendo_Switch_logo.svg, which credits the same official URL.
- License / trademark: official Nintendo artwork; **trademarked** (Nintendo / Nintendo Switch). Copyright status is not treated as a free license.
- V2.9 treatment: official path artwork kept. The red (`#E60012`) background field from the official file was dropped (fill set to none and the field rect removed) so a white monochrome mark can sit on the dark disc — recoloring that field to white would have erased the mark. Path fills were already `#FFFFFF`. The viewBox was tightened to the artwork bounds after the field was removed; paths were not redrawn.

### wii.svg — Wii

- First-party source URL: https://www.nintendo.co.jp/common/v2/img/ncommon/_common/logo/wii.svg
- Retrieved in V2.8 from Nintendo's official site (HTTP 200, `image/svg+xml`).
- License / trademark: official Nintendo artwork; **trademarked** (Nintendo / Wii).
- V2.9 treatment: official one-color wordmark (was grey `#8C8C8C`) recolored to `#FFFFFF`. Proportions unchanged.

### wiiu.svg — Wii U

- First-party source URL: https://www.nintendo.co.jp/common/v2/img/ncommon/_common/logo/wiiu.svg
- Retrieved in V2.8 from Nintendo's official site (HTTP 200, `image/svg+xml`).
- License / trademark: official Nintendo artwork; **trademarked** (Nintendo / Wii U).
- V2.9 treatment: official one-color / limited-color wordmark — the grey Wii (`#8C8C8C`) and the cyan U (`#0096C8`) were both recolored to `#FFFFFF` so the mark is a single-color white version. Proportions unchanged.

## V2.16 assets (Micah-supplied, 2026-11-22)

Micah supplied raster marks so each of these platforms can have its own logo.
Each file was converted to a white monochrome mark on a transparent background,
trimmed of empty padding, and traced to SVG with potrace (even-odd fill, `#ffffff`).
PlayStation (PS1–PS5 share playstation.svg; PSP / PS Vita stay text) is unchanged.

These remain trademarked. Micah accepted the trademark risk of using official
marks for **personal use**. Berean should review sources and trademark use as
with the earlier logos.

| File | Platform (app value) | Original filename | Source | Treatment |
| --- | --- | --- | --- | --- |
| switch2.svg | Switch 2 | switch2.png | Micah-supplied, 2026-11-22 (black on transparent) | Inverted to white; trimmed; potrace SVG. Check order is still Switch 2 before Switch. |
| xbox-series-xs.svg | Series X\|S | xbox-series-xs.png | Micah-supplied, 2026-11-22 (black on transparent) | Inverted to white; trimmed; potrace SVG. |
| xbox-one.svg | Xbox One | xbox-one.png | Micah-supplied, 2026-11-22 (white XBOX ONE wordmark) | Already white; trimmed; potrace SVG. |
| xbox-360.svg | Xbox 360 | xbox-360-transparent.png | Micah-supplied, 2026-11-22 (white on transparent) | Already white; trimmed; potrace SVG. The grey-background `xbox-360.png` was not used. |
| xbox-original.svg | Xbox (original) | xbox-original.png | Micah-supplied, 2026-11-22 (flat black X on a white field) | White field punched out; X inverted to white; trimmed; potrace SVG. |
| gamecube.svg | GameCube | gamecube.png | Micah-supplied, 2026-11-22 (2048 px, white G and cube) | Already white; trimmed; potrace SVG. |
| steam.svg | Steam | steam.png | Micah-supplied, 2026-11-22 (white circle with a cut-out piston) | Already white; trimmed; potrace SVG. |

Ignored source files (not used): xbox-360.png, xbox-wordmark-modern.png, and preview-*.png.

Wordmark badges (Switch 2, Series X|S, Xbox One, Xbox 360) are sized by height
at 12px, with a max width of 44px, in a 24px-tall pill with the same
`rgba(0,0,0,.55)` scrim and 8px inset. Square marks (GameCube, Steam, original
Xbox) stay in the 24px disc at 18px.

## Text-abbreviation badges (no mark in this build)

These use the app's own font (`var(--font)`), neutral white text, on the same
`rgba(0,0,0,.55)` 24px disc. No logo lettering, shapes, or brand colors.

| Platform (app value) | Badge text | Reason |
| --- | --- | --- |
| PC | PC | There is no official "PC" platform logo. |
| Other | OTH | Catch-all; no brand mark. |
| PSP | PSP | Kept as text; not the PlayStation family mark (V2.11, Nathan QA). |
| PS Vita | PSV | Kept as text; not the PlayStation family mark (V2.11, Nathan QA). |

## Not used

- Wikimedia "Steam icon logo.svg" — source is a combination of other files, not official Valve artwork.
- Newly downloaded one-color brand packs (V2.9 recolors the files already in the repo).
- xbox-360.png, xbox-wordmark-modern.png, and preview-*.png from the 2026-11-22 drop (not the selected sources).
- Self-drawn or invented logos. V2.16 traces are of the Micah-supplied marks only.
