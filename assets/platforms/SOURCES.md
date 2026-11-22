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
- V2.16: this file is no longer the badge for Xbox, Xbox 360, Xbox One, or Series X|S.
  Those platforms use the Micah-supplied marks listed below.
- V2.16.1: **retired** from the service-worker precache and unused by `PLATFORM_BADGES`.
  The file is kept in this folder because existing tests and this document still
  reference it.

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

These remain trademarked. Micah accepted the trademark risk of using these marks
for **personal use**.

Upstream origin (where Micah obtained each file) not recorded.

| File | Platform (app value) | Original filename | Trademark owner | sha256 of source PNG | Treatment |
| --- | --- | --- | --- | --- | --- |
| switch2.svg | Switch 2 | switch2.png | Nintendo | af63ee1cb5210028645f2b1cabaa129029687bc1ef132c7ee824e212abe99fe4 | Inverted to white; padding trimmed; potrace SVG. Check order is still Switch 2 before Switch. Micah-supplied, 2026-11-22 (black on transparent). |
| xbox-series-xs-trimmed.svg | Series X\|S | xbox-series-xs.png | Microsoft | bb63f872b1f512688638b2735667ae9165530c5f9c679da6be74def6f16ae4bf | X\|S glyphs only; the vertical SERIES stack is omitted. This is the mapped Series X\|S badge in V2.16.1. The trim is Micah-approved 2026-11-22 and is an alteration of Microsoft's mark. Inverted to white; padding trimmed; potrace SVG. Micah-supplied, 2026-11-22 (black on transparent). |
| xbox-series-xs-full.svg | (unmapped) | xbox-series-xs.png | Microsoft | bb63f872b1f512688638b2735667ae9165530c5f9c679da6be74def6f16ae4bf | Full mark, including the vertical SERIES stack. Kept in the repo but not mapped, so the badge can switch back to it. Inverted to white; padding trimmed; potrace SVG. Same source PNG as the trimmed file. |
| xbox-one.svg | Xbox One | xbox-one.png | Microsoft | 743c46e4bccfdf916b1b8a206efd55944580f0ecaaf917d616fc549afaba17ca | Already white; padding trimmed; potrace SVG. Micah-supplied, 2026-11-22 (white XBOX ONE wordmark). |
| xbox-360.svg | Xbox 360 | xbox-360-transparent.png | Microsoft | d4220ffc91e34f15147e3458cd327abbd111cac24219b558bb1ec9bb0e017b80 | Already white; padding trimmed; potrace SVG. Micah-supplied, 2026-11-22 (white on transparent). The grey-background `xbox-360.png` was not used. |
| xbox-original.svg | Xbox (original) | xbox-original.png | Microsoft | 3e7f41e6e9cc04cf29002d05efd334bdd14ca23d84a945ec5dfb2d85344f6759 | White field punched out; X inverted to white; padding trimmed; potrace SVG. Micah-supplied, 2026-11-22 (flat black X on a white field). In V2.16.1 the badge image is optically nudged in CSS so the X reads centered in the disc. |
| gamecube.svg | GameCube | gamecube.png | Nintendo | e02421331385f3a4c7b5ae0e90790baec281d47d4f481250882ed66d476ed7ef | Already white; padding trimmed; potrace SVG. Micah-supplied, 2026-11-22 (2048 px, white G and cube). |
| steam.svg | Steam | steam.png | Valve Corporation | 9122acb9d4e64dc209d9670e0d7fba353a64789756782be812638b9758499554 | Already white; padding trimmed; potrace SVG. Micah-supplied, 2026-11-22 (white circle with a cut-out piston). |

Ignored source files (not used): xbox-360.png, xbox-wordmark-modern.png, and preview-*.png.

Wordmark badges (Switch 2, Series X|S, Xbox One, Xbox 360) sit in a 24px-tall
pill with the same `rgba(0,0,0,.55)` scrim and 8px inset. From V2.16.1 they are
sized by height so cap height is about 9px, with a max width of 44px. Square
marks (GameCube, Steam, original Xbox) stay in the 24px disc at 18px.

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
