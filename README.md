# FreeRangeMedia

FreeRangeMedia (formerly Media Shelf) is a personal tracker for **books**, **comics**, **video games**, **movies**, and **music** — statuses, ratings, notes, tags, format (physical / digital / audiobook; Blu-ray / DVD / VHS for physical movies, cart / disc / code for physical games, CD / vinyl / cassette for physical music), plus optional **ISBN/barcode** and **cover images**.

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
- Backup format: `{ "app": "freerangemedia", "version": 3, "exportedAt": "<ISO>", "items": [...] }` with every item field (format, disc, barcode, coverUrl, coverSource, dates, comic fields, …). **API keys are never included.** Back up and Export always write this object form. Restore also accepts version 2 backups, Media Shelf backups (`"app": "media-shelf"`, version 1), older Export files and plain item arrays. Version 3 exists because of comics: apps that only know version 2 refuse a version 3 file instead of silently turning comics into books; the older Media Shelf app likewise refuses anything above version 1.
- If a save doesn't fit in this browser's storage, nothing changes: the library on screen goes back to what is saved and a message says so.
- Comics also keep a small shadow copy (`localStorage` key `media-tracker-v1:comics`). If an older version of the app saves the library and drops or changes comics, this version puts them back on the next load (comics you deleted here stay deleted).
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

### Comics
- **Lookup** goes only to our comic relay (a Cloudflare Worker, not deployed yet): `GET …/comic?series=&issue=[&publisher=]` and `GET …/comic-barcode?upc=`. The browser never calls the comic database itself. Until `COMIC_RELAY_URL` in `app.js` is set, comic Lookup is inert and always says “No match. What you typed is kept.”
- Barcode first, then series + issue. A barcode that doesn't match is kept on the comic, and series + issue still match.
- **Cover picker:** variant covers can share a barcode, so after a match you pick the cover of your copy (variants are marked), paste a photo URL, or choose No cover. Save stays off, with the reason shown, until you do. A single cover is preselected but still shown; several are never picked for you. Covers show two per row on phones and three from 420px wide. While the picker is open the form's own Cover URL field is hidden, so the cover is set only in the picker.
- A barcode alone can't find a comic (GCD has no barcode search). The status says “Comic lookup can’t search by barcode alone. Your barcode is kept. Add the series and issue number, then look up again.” and the code stays on the form.
- Errors never change the form and never say “No match”. Only a 429, a 503 with Retry-After, or a partial answer says “Comic lookup is busy right now. Try again later. What you typed is kept.” Every other failure (the relay's 502, any other 4xx/5xx, a 200 that isn't JSON, a timeout or a network failure) says “Comic lookup isn't working right now. What you typed is kept.”
- Credits: a comic's `sourceId` prefix picks its credit (`gcd-` → Grand Comics Database, `cv-` → Comic Vine), shown as plain text in the cover picker, on the comic's form, in Settings and in the footer. GCD (wording cleared): “Comic details from the Grand Comics Database™, licensed under CC BY-SA 4.0. Cover images are © their respective copyright holders and shown for identification only.”, plus a link to the issue's comics.org page. The Comic Vine text is still “PLACEHOLDER: Comic Vine credit”. Sources are named only in `COMIC_SOURCES` in `app.js`.
- Covers: only the cover URL the relay returns is stored and shown, unchanged (no size rewrite). Image bytes are never copied into storage or backups (no data:/blob: URLs; a comic's data: cover is dropped). The service worker never handles comics.org or files1.comics.org requests and caches same-origin files only. `COMIC_COVER_IMAGES` (default `true`) switches the picker to names only: one variant per row with a link to its comics.org issue page and no images.
- “Show all N covers” appears when an issue has more than 5 covers; it loads the rest from `…/comic-covers` (13 per request). Errors there follow the same busy versus isn't-working split (shown under the covers, not at the top of the form), and covers that already arrived stay shown.
- Prices are never requested, stored or shown.
- Duplicates: if both comics carry a source issue id (at GCD each variant/printing is its own record), the same id is a duplicate and a different id is a different comic. Otherwise series + issue + cover when both covers are set; otherwise series + issue. Whatever matched, more than one matching copy is named with its count and never updated automatically (the prompt leads with Separate copy). Never title or barcode. When several comics match, the prompt says “{n} comics you have match this one. Update changes {copy}, last edited {when}. Or add this as a separate copy.”, where {copy} is the title plus the cover name (or plus Physical/Digital when there's no cover name) and {when} is that copy's own last edit (“today at 10:02”, “on Sep 25 at 10:02”; left out if the copy has no edit date). The prompt shows each side's cover thumbnail (the stored URL, in names-only mode the cover name) and only what's on the shelf (“Comic, Bag/board”).
- Digital comics: no Signed toggle, and Condition offers only Unread or Read (Fine and Damaged are for Physical). Switching to Digital and back before saving loses nothing; saving as Digital drops a Fine/Damaged condition (it becomes blank, never Unread) and any signed names. Loading, restoring and importing apply the same rule.

### Import from CLZ
**Settings → Import CLZ** reads a CSV exported from CLZ (Books, Comics, Games, Movies or Music). Pick the type and the file, and FreeRangeMedia shows a preview: how many items will be added, the first 5 rows, rows skipped and why, and possible duplicates (update the one you have or add a separate copy: “Default for items you already have” sets all of them, and each row's “This row:” buttons override it for that row). A row matching several copies says “You already have {n} copies of “{name}”. Update changes {copy}, last edited {when}.” A comic row that matches more than one of yours always starts on Skip, and the default never changes it. If the columns aren't recognized, a mapping screen asks which column is which; the mapping is remembered (`freerangemedia-clz-mapping`). Price, value, cost and paid columns are always ignored. After importing there's Undo, and **Remove last import** stays available in Settings. The CLZ column names in `CLZ_HEADER_ALIASES` (`app.js`) are unconfirmed until checked against a real CLZ export.

### Scan & manual covers
- **Scan:** `html5-qrcode` from jsDelivr + device camera. The camera needs a secure page (**HTTPS** or **localhost**) and camera permission; on plain HTTP (e.g. a LAN address) the browser blocks it.
- Cover URL can always be set manually (`coverSource: manual`); cards show a neutral placeholder when missing.

## Features

- Library with type, creator, year, status, rating, progress, notes, tags, barcode, cover
- Format / edition: books (physical · digital · audiobook), comics (physical · digital; Comic / Bag-board / Case for physical), games (physical · digital), movies (physical · digital + disc when physical)
- Comics: series, issue, publisher, writer, artist, condition, signed names, cover variant
- Import from CLZ (CSV) for every type
- Filters: All / Books / Comics / Games / Movies / Music + status; search (debounced); sort by updated, title, rating
- Back up a file (iPhone share sheet → Save to Files; download elsewhere) and Restore from file with Merge / Replace; “last backup file created” indicator and 14-day reminder (14-day grace after your first item if you’ve never backed up)
- Add / edit / delete (confirm) via modal; Settings wizard for optional OMDb + RAWG keys (status, Show/Hide, Get free key, Test)
- Reference links: IMDb, ISFDB, RAWG, IGDB (by type)
- Stats strip by type and status
- Sample items on first load only (`media-shelf-seeded`); once cleared — or once every item is deleted — they don’t come back
- PWA basics: `manifest.webmanifest`, icons, `sw.js` (cache `media-shelf-v25`; only same-origin files are cached, never cover images, and comics.org / files1.comics.org requests bypass the worker)
- Relative paths only — works from the GitHub Pages project path

## Add to Home Screen

On iPhone or iPad, open the live site in Safari, tap **Share → Add to Home Screen**. Offline caching is handled by the service worker for the core shell assets. Your library still lives in that browser’s `localStorage` — use **Back up** to save a copy (for example to iCloud Drive via Save to Files). Cover images and lookups need network when first loaded.

## GitHub Pages

Live at [freerangeice.github.io/media-shelf](https://freerangeice.github.io/media-shelf/). The app uses relative `./` paths so it works from the project site path.

## Privacy

No accounts, no cloud sync, no FreeRangeMedia server (apart from the comic Lookup relay, which only passes lookups through). Your library and optional OMDb/RAWG keys are saved in this browser’s `localStorage` (backups/exports contain your library only, never API keys). When you press Lookup (or after a scan), your browser sends the title or barcode (plus the author for books and the year for movies and games, when set) to Open Library, Google Books and Wikipedia, and — when configured — the title plus your key to OMDb / RAWG. Music Lookup sends the barcode, or the album title and artist, to MusicBrainz, and loads covers from the Cover Art Archive. Comic Lookup (once the relay is set up) sends the series, issue number, publisher if filled, or the barcode to the FreeRangeMedia comic relay, which asks the comic database. Reference links open IMDb, ISFDB, RAWG, or IGDB in a new tab. Note: `localStorage` is per origin, and GitHub Pages project sites under one account share the origin `https://freerangeice.github.io`.
