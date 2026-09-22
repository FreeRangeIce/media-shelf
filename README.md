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

## Covers & Lookup (multi-source waterfall)

**Lookup** tries free sources in order and stops on the first strong match (prefer a cover; otherwise title + creator). The form stores `coverSource` (`openlibrary` | `googlebooks` | `itunes` | `wikipedia` | `omdb` | `rawg` | `manual`) and shows a status such as “Matched via Google Books”. Failures on one source are skipped so the next can run.

Optional API keys (OMDb, RAWG) live in **Settings** → stored only in this browser’s `localStorage`. No keys are required for the default waterfall.

### Books
1. [Open Library](https://openlibrary.org) — ISBN and title search; covers via `covers.openlibrary.org`
2. [Google Books](https://developers.google.com/books) — ISBN or `intitle` / `inauthor`; thumbnail/large (zoom upgraded when possible)
3. [Wikipedia REST summary](https://en.wikipedia.org/api/rest_v1/) — cover fallback when a title is available

**ISFDB** (Internet Speculative Fiction Database) is **reference-only**: the Add/Edit modal and cards link to  
`https://www.isfdb.org/cgi-bin/se.cgi?arg={title}&type=Fiction+Titles`.  
ISFDB serves HTML without CORS for browser apps, so Lookup does not scrape it.

### Movies
1. **OMDb** (optional key) — IMDb-backed title/year lookup and poster; key from [omdbapi.com](https://www.omdbapi.com/apikey.aspx). `coverSource: omdb`
2. [iTunes Search](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/) — `entity=movie`
3. Wikipedia — exact title summary; on miss, OpenSearch then summary (prefers film-like titles)

**IMDb** reference link: `https://www.imdb.com/find/?q={title}` (and year when set). Movie UPC barcodes alone usually will not match — use a title or paste a cover URL.

### Games
1. **RAWG** (optional key, preferred deep source) — `https://api.rawg.io/api/games?key=…&search=…` plus detail for `background_image` / developers; free key from [rawg.io/apidocs](https://rawg.io/apidocs). `coverSource: rawg`
2. iTunes — `entity=software` by title (best-effort)
3. Wikipedia — OpenSearch + summary (prefers video-game-like titles)
4. Open Library — only when the barcode looks like an ISBN

Reference links (no keys): **RAWG** (`https://rawg.io/search?query=…`), **IGDB** (`https://www.igdb.com/search?type=games&q=…`, search UI only — IGDB’s API needs Twitch OAuth and is not used), and **IMDb** when useful.

### Scan & manual covers
- **Scan:** `html5-qrcode` from jsDelivr + device camera. Best on **HTTPS** or **localhost**.
- Cover URL can always be set manually (`coverSource: manual`); cards show a type-colored placeholder when missing.

## Features

- Library with type, creator, year, status, rating, progress, notes, tags, barcode, cover
- Format / edition: books (physical · digital · audiobook), games (physical · digital), movies (physical · digital + disc when physical)
- Filters: All / Books / Games / Movies + status; search (debounced); sort by updated, title, rating
- Add / edit / delete (confirm) via modal; Settings for optional OMDb + RAWG keys
- Reference links: IMDb, ISFDB, RAWG, IGDB (by type)
- Stats strip by type and status
- Seed samples on first load; clear samples anytime
- PWA basics: `manifest.webmanifest`, icons, `sw.js` (cache `media-shelf-v3`)
- Relative paths only — works from the GitHub Pages project path

## Add to Home Screen

On iPhone or iPad, open the live site in Safari, tap **Share → Add to Home Screen**. Offline caching is handled by the service worker for the core shell assets. Your library still lives in that browser’s `localStorage` unless you Export JSON. Cover images and lookups need network when first loaded.

## GitHub Pages

Live at [freerangeice.github.io/media-shelf](https://freerangeice.github.io/media-shelf/). The app uses relative `./` paths so it works from the project site path.

## Privacy

No accounts, no cloud sync. Library data and optional OMDb/RAWG keys stay in this browser unless you export a file. Lookups call Open Library, Google Books, iTunes, Wikipedia, and (when configured) OMDb / RAWG from your browser only when you press Lookup / after a scan. Reference links open IMDb, ISFDB, RAWG, or IGDB in a new tab.
