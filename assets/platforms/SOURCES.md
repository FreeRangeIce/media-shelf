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

### xbox.svg — Xbox (also Xbox 360, Xbox One, Series X|S)

- Source URL (Wikimedia Commons): https://commons.wikimedia.org/wiki/File:Xbox_logo_(2019).svg
- Documented origin: uploaded 7 May 2020 as a work by Microsoft Corporation from https://www.xbox.com/en-US/
- License note on Commons: public-domain text logo (threshold of originality); **trademarked** (Microsoft / Xbox).
- V2.9 treatment: the path had no explicit fill (browser default black). Fill set to `#ffffff`. Proportions unchanged.

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

## Text-abbreviation badges (no official mark in this build)

These use the app's own font (`var(--font)`), neutral white text, on the same
`rgba(0,0,0,.55)` 24px disc. No logo lettering, shapes, or brand colors.

| Platform (app value) | Badge text | Reason |
| --- | --- | --- |
| Steam | Steam | Official first-party wordmark exists at https://community.steamstatic.com/public/shared/images/header/logo_steam.svg (Steam/Valve CDN). That lockup is a wide wordmark, not a square mark. Wikimedia's "Steam icon logo.svg" is documented as a *combination* of other files, so it was not used (not official artwork; the brief forbids inventing or compositing a logo). |
| Switch 2 | NS2 | No official logo file was found at Nintendo's first-party logo path (`…/logo/switch2.svg` and `…/logo/switch-2.svg` both 404). |
| GameCube | GCN | Left as text until Berean clears an asset. No official logo file was found at Nintendo's first-party logo path (`…/logo/gamecube.svg` 404). |
| PC | PC | There is no official "PC" platform logo. |
| Other | OTH | Catch-all; no brand mark. |

## Not used

- Wikimedia "Steam icon logo.svg" — source is a combination of other files, not official Valve artwork.
- Any self-drawn or traced logo.
- Newly downloaded one-color brand packs (V2.9 recolors the files already in the repo).
