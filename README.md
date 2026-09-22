# Media Shelf

Personal tracker for **books**, **video games**, and **movies** — statuses, ratings, notes, tags, format (physical / digital / audiobook; Blu-ray / DVD / VHS for physical movies), plus optional **ISBN/barcode** and **cover images**.

Data lives in your browser (`localStorage` key `media-tracker-v1`). Export / Import JSON to back up or move devices (includes barcode + cover fields).

## Open locally

From this folder:

```bash
python3 -m http.server 8770
```

Then open [http://127.0.0.1:8770/](http://127.0.0.1:8770/).

A static file server is preferred so `seed.json` and the service worker load correctly (opening `index.html` as a `file://` URL may skip those).

## Covers & barcode scan

- **Books:** enter or scan an ISBN, then **Lookup** uses [Open Library](https://openlibrary.org) (no API key) for title, authors, year, and cover (`covers.openlibrary.org`).
- **Movies:** **Lookup** uses the public [iTunes Search API](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/) by **title** (no key). Movie UPC barcodes alone usually won’t match — search by title, or paste a cover URL.
- **Games:** best-effort iTunes `software` search by title; game UPCs are unreliable. Paste a cover URL anytime.
- **Scan:** uses `html5-qrcode` from jsDelivr and the device camera. Works best on **HTTPS** or **localhost**; plain HTTP on a LAN IP is often blocked by the browser.
- Cover URL can always be set manually; cards show a type-colored placeholder when missing.

## Features

- Library with type, creator, year, status, rating, progress, notes, tags, barcode, cover
- Format / edition: books (physical · digital · audiobook), games (physical · digital), movies (physical · digital + disc when physical)
- Filters: All / Books / Games / Movies + status; search (debounced); sort by updated, title, rating
- Add / edit / delete (confirm) via modal
- Stats strip by type and status
- Seed samples on first load (with real Open Library covers); clear samples anytime
- PWA basics: `manifest.webmanifest`, icons, `sw.js` (cache `media-shelf-v2`)
- Relative paths only — ready for GitHub Pages under a project path later

## Add to Home Screen

On iPhone or iPad, open the live site in Safari, tap **Share → Add to Home Screen**. Offline caching is handled by the service worker for the core shell assets. Your library still lives in that browser’s `localStorage` unless you Export JSON. Cover images and lookups need network when first loaded.

## GitHub Pages

Live at [freerangeice.github.io/media-shelf](https://freerangeice.github.io/media-shelf/). The app uses relative `./` paths so it works from the project site path.

## Privacy

No accounts, no cloud sync, no API keys. Library data stays in this browser unless you export a file. Optional lookups call Open Library or iTunes Search from your browser only when you press Lookup / after a scan.
