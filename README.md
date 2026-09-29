# FreeRangeMedia

FreeRangeMedia (formerly Media Shelf) is a personal tracker for **books**, **video games**, **movies**, and **music** — statuses, ratings, notes, tags, format (physical / digital / audiobook; Blu-ray / DVD / VHS for physical movies, cart / disc / code for physical games, CD / vinyl / cassette for physical music), plus optional **ISBN/barcode** and **cover images**.

Your library is saved in this browser (`localStorage` key `media-tracker-v1`). Use **Back up** (saves a backup file — on iPhone through the share sheet, e.g. Save to Files → iCloud Drive) or **Settings → Export / Import** (JSON) to keep a copy or move devices (includes barcode + cover fields). See [Backup & restore](#backup--restore).

## Open locally

From this folder:

```bash
python3 -m http.server 8770
```

Then open [http://127.0.0.1:8770/](http://127.0.0.1:8770/).

A static file server is preferred so `seed.json` and the service worker load correctly (opening `index.html` as a `file://` URL may skip those).

## Backup & restore

A web app can’t write to iCloud Drive directly, so FreeRangeMedia hands a backup file to the iPhone share sheet. **Backups are manual — there is no automatic sync.** The app can’t see where the file ends up (the Web Share API doesn’t report the chosen target), so check that it landed in iCloud Drive or Files.

**Back up (iPhone):** tap **Back up** in the header (or **Settings → Back up**) → choose **Save to Files** → pick **iCloud Drive** and a folder → **Save**. The file is named `freerangemedia-backup-YYYY-MM-DD.json` (Export in Settings saves `freerangemedia-export-YYYY-MM-DD.json`; backups made before v1.2 are named `media-shelf-backup-YYYY-MM-DD.json`). Restore reads the file’s contents, so any of these names works. Then open Files to check the file is there.

**Restore (iPhone):** **Settings → Restore from file** (or **Settings → Import**) → in Files, **Browse → iCloud Drive** → pick the backup → choose:
- **Merge** — keeps your current library, adds items whose `id` isn’t present, and for items in both keeps whichever has the newer `dateUpdated`.
- **Replace** — overwrites the library with the backup.

Details:
- Backup format: `{ "app": "freerangemedia", "version": 2, "exportedAt": "<ISO>", "items": [...] }` with every item field (format, disc, barcode, coverUrl, coverSource, dates, …). **API keys are never included.** Back up and Export always write this object form. Restore also accepts Media Shelf backups (`"app": "media-shelf"`, version 1), older Export files and plain item arrays. The older Media Shelf app refuses version 2 files instead of silently dropping new fields.
- Uses `navigator.share({ files })` when `navigator.canShare({ files })` allows it (iOS/iPadOS Safari and Home Screen app, Chrome on Android; some desktop browsers such as Safari on Mac may also show a share menu). Otherwise the file downloads instead; move it somewhere safe yourself.
- **Settings** shows “Last backup file created: …” (`localStorage` key `media-shelf-last-backup`). It’s set when the share sheet reports success, when the file downloads, or on Export — it records that a file was created, not that it was saved to iCloud.
- A small reminder banner appears when you have your own (non-sample) items and either your last backup file is more than 14 days old, or you’ve never backed up and your first own item was added more than 14 days ago. No reminder on day one. **Not now** snoozes it for 7 days (`media-shelf-backup-reminder-dismissed`).

## Covers & Lookup (multi-source waterfall)

**Lookup** tries sources in order and stops on the first strong match (prefer a cover; otherwise title + creator). The form stores `coverSource` (`openlibrary` | `googlebooks` | `omdb` | `rawg` | `musicbrainz` | `coverartarchive` | `manual`; books saved before v1.3 may also carry `wikipedia`) and shows a status such as “Matched via Google Books”. A failing source is skipped so the next can run, and the status tells refusals/errors (HTTP 401/403/429/5xx, network or blocked) apart from a genuine “No match”. A rejected OMDb key is reported even when another source matches.

Optional API keys (OMDb, RAWG) live in **Settings → Improve Lookup**, a short wizard with signup links and Save / Clear / Test for each key. Keys are saved only in this browser’s `localStorage` (`media-shelf-omdb-key`, `media-shelf-rawg-key`), are never included in backups, and are sent directly from your browser to OMDb or RAWG when you use Lookup or Test (there is no FreeRangeMedia server). Book Lookup needs no keys; movie and game Lookup without keys is limited: Wikipedia can fill the title, year and director, but covers come only from OMDb (movies) and RAWG (games).

### Books
1. [Open Library](https://openlibrary.org) — ISBN and title search; covers via `covers.openlibrary.org`
2. [Google Books](https://developers.google.com/books) — ISBN or `intitle` / `inauthor`; the API’s own thumbnail link (only switched to https); results show the “powered by Google” mark and a “View on Google Books” link, per Google’s branding rules
3. [Wikipedia REST summary](https://en.wikipedia.org/api/rest_v1/) — title and year only when a title is available, no cover (disambiguation pages are skipped)

**ISFDB** (Internet Speculative Fiction Database) is **reference-only**: the Add/Edit modal and cards link to  
`https://www.isfdb.org/cgi-bin/se.cgi?arg={title}&type=Fiction+Titles`.  
ISFDB serves HTML without CORS for browser apps, so Lookup does not scrape it.

### Movies
1. **OMDb** (optional key) — title/year lookup with poster, year and director. Free key = 1,000 requests/day, emailed after signup at [omdbapi.com/apikey.aspx](https://www.omdbapi.com/apikey.aspx) (OMDb isn’t affiliated with IMDb). A bad key (HTTP 401) is reported in Test and in Lookup. `coverSource: omdb`
2. Wikipedia (details only, no cover) — one MediaWiki query tries `{title} ({year} film)`, `{title} (film)`, then the bare title only if its description is a film; disambiguation pages are skipped; OpenSearch fallback ranks “(film)” titles first. The director is read from the short description (“2023 film by Christopher Nolan”) or the article’s first sentence (“… film directed by Denis Villeneuve …”); the “(film)” part of the page title isn’t copied into your item.

**IMDb** reference link: `https://www.imdb.com/find/?q={title}` (and year when set). Movie UPC barcodes alone usually will not match — use a title or paste a cover URL.

### Games
1. **RAWG** (optional key) — `https://api.rawg.io/api/games?key=…&search=…` plus detail for `background_image` / developers. Free for personal projects with credit to RAWG (up to 20,000 requests/month); key via [rawg.io/apidocs](https://rawg.io/apidocs) → Get API Key. `coverSource: rawg`. **Caveat:** RAWG’s 401 for a bad key carries no CORS header, so the browser can’t tell a rejected key from a blocked request; Test says exactly that. Browser (CORS) access with a valid key: Verified Sep 27, 2026 (Test and a Lookup worked in iPhone Safari on the live site).
2. Wikipedia (details only, no cover) — tries `{title} ({year} video game)`, `{title} (video game)`, then the bare title only if its description is a game; disambiguation pages are skipped
3. Open Library (details only, no cover) — only when the barcode looks like an ISBN

Movie covers come only from OMDb and game covers only from RAWG. Without a key there's no cover; paste a cover URL if you have one.

Reference links (no keys): **RAWG** (`https://rawg.io/search?query=…`), **IGDB** (`https://www.igdb.com/search?type=games&q=…`, search UI only — IGDB’s API needs Twitch OAuth and is not used), and **IMDb** when useful.

### Scan & manual covers
- **Scan:** `html5-qrcode` from jsDelivr + device camera. The camera needs a secure page (**HTTPS** or **localhost**) and camera permission; on plain HTTP (e.g. a LAN address) the browser blocks it.
- Cover URL can always be set manually (`coverSource: manual`); cards show a neutral placeholder when missing.

## Features

- Library with type, creator, year, status, rating, progress, notes, tags, barcode, cover
- Format / edition: books (physical · digital · audiobook), games (physical · digital), movies (physical · digital + disc when physical)
- Filters: All / Books / Games / Movies + status; search (debounced); sort by updated, title, rating
- Back up a file (iPhone share sheet → Save to Files; download elsewhere) and Restore from file with Merge / Replace; “last backup file created” indicator and 14-day reminder (14-day grace after your first item if you’ve never backed up)
- Add / edit / delete (confirm) via modal; Settings wizard for optional OMDb + RAWG keys (status, Show/Hide, Get free key, Test)
- Reference links: IMDb, ISFDB, RAWG, IGDB (by type)
- Stats strip by type and status
- Sample items on first load only (`media-shelf-seeded`); once cleared — or once every item is deleted — they don’t come back
- PWA basics: `manifest.webmanifest`, icons, `sw.js` (cache `media-shelf-v16`)
- Relative paths only — works from the GitHub Pages project path

## Add to Home Screen

On iPhone or iPad, open the live site in Safari, tap **Share → Add to Home Screen**. Offline caching is handled by the service worker for the core shell assets. Your library still lives in that browser’s `localStorage` — use **Back up** to save a copy (for example to iCloud Drive via Save to Files). Cover images and lookups need network when first loaded.

## GitHub Pages

Live at [freerangeice.github.io/media-shelf](https://freerangeice.github.io/media-shelf/). The app uses relative `./` paths so it works from the project site path.

## Privacy

No accounts, no cloud sync, no FreeRangeMedia server. Your library and optional OMDb/RAWG keys are saved in this browser’s `localStorage` (backups/exports contain your library only, never API keys). When you press Lookup (or after a scan), your browser sends the title or barcode (plus the author for books and the year for movies and games, when set) to Open Library, Google Books and Wikipedia, and — when configured — the title plus your key to OMDb / RAWG. Music Lookup sends the barcode, or the album title and artist, to MusicBrainz, and loads covers from the Cover Art Archive. Reference links open IMDb, ISFDB, RAWG, or IGDB in a new tab. Note: `localStorage` is per origin, and GitHub Pages project sites under one account share the origin `https://freerangeice.github.io`.
