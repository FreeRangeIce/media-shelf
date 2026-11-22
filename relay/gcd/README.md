# frm-gcd: Grand Comics Database relay (with Metron cover links) for FreeRangeMedia

A small Cloudflare Worker that looks up comics in the [Grand Comics Database](https://www.comics.org/)
(GCD) API for [FreeRangeMedia](https://freerangeice.github.io/media-shelf/). GCD's API needs no key but
sends no CORS headers, so the browser app cannot call it directly. The relay calls GCD **anonymously**.
After the GCD match it asks [Metron](https://metron.cloud/) for the same issue's cover **link**, using
one secret, `METRON_API_TOKEN` (Micah's Metron API token, set with `wrangler secret put`; never in
`wrangler.toml`, this folder or any log).

**Status: deployed** as the Cloudflare Worker `frm-gcd` at `https://frm-gcd.freerangeice.workers.dev`
(first deployed Oct 6, 2026; KV cache added the same day; Metron cover links and GCD cover URLs
removed on Oct 10, 2026, version `c69c5fd2-6ab1-497f-9f37-bf165098dba6`). The app's `COMIC_RELAY_URL` points here on
branch `design/frm-comics-lookup` (not on the live site yet). The Comic Vine relay in
`../frm-comicvine-relay/` stays as a fallback.

Data comes from the Grand Comics Database™ and is licensed under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Pages that show it should credit
and link GCD (each match carries a `sourceUrl`). **GCD cover URLs are never sent any more**: GCD's image
server `files1.comics.org` answers a Cloudflare 403 to everyone outside comics.org.

Metron's data is also CC BY-SA 4.0. Cover pictures come from Metron as **links only**: the relay passes
Metron's `image` URL on exactly as Metron returns it (only `https://static.metron.cloud/...`), and
never fetches, proxies, caches or stores image bytes. When a Metron image was used the answer carries
`imagesFrom: "metron"`, and the app then shows Metron's credit as well as GCD's: "Comic details from
Metron, licensed under CC BY-SA 4.0. Cover images are © their respective copyright holders and shown
for identification only." If Metron objects or blocks, remove the secret (or let it fail): the relay
falls back to GCD names only.

## Endpoints (GET only)

### `GET /comic?series=<name>&issue=<number>[&year=<YYYY>]`

- `series`: 2 to 120 characters.
- `issue`: up to 10 characters. A leading `#` and leading zeros are dropped. `/` and `,` are refused.
- `year`: optional 4 digits, matched against the issue's key date. Strongly recommended for common
  names, because GCD's name search is a "contains" match. "Batman" without a year returns hundreds
  of records.

Cost when nothing is cached: **one** GCD search call (`/api/series/name/<name>/issue/<n>/[year/<y>/]`)
plus **one** GCD detail call for the base (title, publisher, credits, key date), plus **one** call for
the base's series record (`/api/series/<id>/`, for the full variant list, see `variants`), so **at most
3** GCD calls (it was 4: the 2 variant details only ever supplied cover scans). Then **at most 3** Metron calls
(see below). Anything already in KV costs nothing: a repeat of the same lookup is answered whole from
KV with **0** GCD and **0** Metron calls.

```json
{
  "match": {"series":"Absolute Batman","issue":"1","title":null,"publisher":"DC Comics","year":2024,
            "writer":["Scott Snyder"],"artist":["Nick Dragotta"],"sourceId":"gcd-issue-2663120",
            "sourceName":"Grand Comics Database","sourceUrl":"https://www.comics.org/issue/2663120/"},
  "candidates": [{"series":"…","year":2012,"publisher":null,"sourceId":"gcd-issue-…"}],
  "covers":   [{"sourceId":"gcd-issue-2663120","url":"https://static.metron.cloud/media/issue/2024/09/23/2db9a60d7a4a41b180cd9017f3430b27.jpg","label":"Nick Dragotta Cover","variant":false}],
  "variants": [{"sourceId":"gcd-issue-2663120","label":"Nick Dragotta Cover","variant":false,
                "image":"https://static.metron.cloud/media/issue/2024/09/23/2db9a60d7a4a41b180cd9017f3430b27.jpg"},
               {"sourceId":"gcd-issue-2665657","label":"Wes Craig Cardstock Variant Cover","variant":true}],
  "total": 18,
  "imagesFrom": "metron"
}
```

- **Metron cover links** (after the GCD match; skipped for a stand-in base):
  1. `GET https://metron.cloud/api/issue/?gcd_id=<GCD base id>` (`Authorization: Bearer <token>`).
     Metron's `gcd_id` filter works (checked live Oct 10: `gcd_id=123992` -> Metron 34702, Batman #608;
     an unknown id -> `count: 0`). Exactly one result is the candidate; 2+ is ambiguous (no picture).
  2. Only when step 1 finds nothing: `issue/?series_name=<GCD series>&number=<n>&cover_year=<GCD year>`,
     filtered again locally; exactly one agreeing result or no picture.
  3. `issue/<metron id>/` only when GCD lists variants (Metron's `variants` live only there) or when
     the issue was found by name (so Metron's own `gcd_id` can veto it).
  - **A picture is attached only when Metron's issue agrees with GCD's base** on series name
    (normalised: case, punctuation, "&"/"and", a leading "The"), issue number (leading zeros
    ignored) and year (Metron `cover_date` year **exactly** equal to GCD's key-date year; both are
    cover dates, so no ±1 is allowed), and Metron's `gcd_id`, when set, is GCD's base id.
    Otherwise no picture: a wrong picture is worse than none.
  - Metron's main image goes **only** on GCD's base row (`variants[0]`). A Metron variant image goes
    on a GCD variant row only when the names match exactly after lower-casing and turning
    punctuation into spaces, and that name is unique on both sides. Anything else stays names-only.
  - `variants[i].image` is set only for matched rows; `covers` lists exactly those rows (GCD
    `sourceId` and `label`, Metron `url`). `imagesFrom: "metron"` is present only when at least one
    image was attached. No Metron price, UPC, SKU or id is passed on. Metron's UPC search is not used.
  - **Metron trouble is never an error**: busy (429/503, or the relay's 15/min budget), down, a
    non-JSON page or a timeout (6 s) -> GCD names with no images and `imagesPending: true`; 401/403
    (token refused) -> GCD names, no images, and Metron is not asked again by that isolate for 15 min.
    In all these cases the answer is not stored whole, so the next lookup asks Metron again (GCD's
    parts come from KV at no cost). Without the secret the relay never calls Metron.

- **Picking the issue.** Search results are grouped into logical issues (a base plus its
  `variant_of` records). They are ranked by exact series name (case, punctuation and a leading "The"
  ignored), then earliest series start year, then the issue with more variant records, then GCD's
  own order.
- **`variants`** lists **all** records for the chosen issue, base first. GCD's issue record has no
  variant list, and the year-filtered search only returns records whose key date starts with that
  year (Batman #608's New York Post Exclusive is dated later, so `year/2002/` leaves it out). So the
  relay also reads the base's series record once: its `active_issues` (API links) and
  `issue_descriptors` (same order) give every record of the series; the ones sharing the base's
  issue descriptor (`608` in `608 [Newsstand]`) are its variants, in GCD's order. The year-filtered
  and the unfiltered lookup therefore list the same variants. The series list is not used (search
  hits only) when the hits hold another logical issue of that series with the same number, when the
  two lists differ in length or don't contain the base, when the series record is a 404 (kept 1 day)
  or when the budget ran out first (partial). Only ids and names are kept from it. Labels are GCD's own bracketed variant name from the descriptor, e.g.
  `1 [Wes Craig Cardstock Variant Cover]`. A base with no name is labeled "Cover A". GCD's own
  `[unnamed variant]` wording is kept. `total` is the length of `variants`.
- **`covers`**: only rows with a Metron picture (see above). GCD scans are never listed.
- `writer`: script credits. `artist`: pencils, then inks. Both come from the "comic story" and
  "cover" sequences and are deduped. Notes in `[...]` and `(...)`, a trailing `?`, and non-names
  such as `None`, `?` and `typeset` are removed.
- `publisher`: the issue's indicia publisher (e.g. "Image Comics Inc."), else its brand.
- `year`: key date, then on-sale date, then publication date.
- `candidates`: up to 5 other logical issues. `publisher` is `null` because finding it would
  cost extra calls.
- A miss returns `match: null`. It counts as a miss **only** when the search route answers 200 with
  JSON whose `results` is an array. A 404 on the search route, a 200 without a `results` array, or a
  non-JSON reply is an error (502 `GCD lookup failed`, which the app shows as "isn't working"). Errors
  are never cached, so the next call goes upstream again. A 404 on a single issue detail only skips
  that issue's cover. When GCD had more than one page of results and none was an exact name
  match, the miss also carries `reason: "add-year"`. When an exact match was found but GCD had
  more pages, `truncated: true` means `variants` may be incomplete. The relay never pages.
- **Partial**: if the budget runs out (or GCD throttles) after the search call, the answer still has
  the match (year from the search), **every** variant name and any Metron pictures, plus `partial: true` and a
  `Retry-After` header. A partial answer is never turned into a miss. It is not cached as a whole,
  but its search result (the base + variant list) and the issues it fetched are, so a retry makes no
  new search and only asks for the details still missing. The app opens the picker on a partial
  answer that has a match.
- **No price field is ever returned.**

### `GET /comic-covers?ids=gcd-issue-1,gcd-issue-2,…`

Kept only so older app builds don't break. GCD's scans can't be shown and Metron's pictures come with
`/comic`, so it validates the ids (up to 13, each `gcd-issue-<number>`) and answers `{"covers":[]}` at
once with **no** upstream call. The current app never calls it.

### `GET /comic-barcode?upc=<8–17 digits>`

GCD's API has no barcode route. Barcode search exists only on GCD's HTML site, which sits behind a
Cloudflare bot challenge, so the relay does not use it. The relay answers at once with no
upstream call (and Metron's UPC search is deliberately not used):

```json
{ "match": null, "reason": "barcode-unsupported" }
```

### Errors

| Status | Body | When |
|---|---|---|
| 400 | `{error:"..."}` | Bad or missing input |
| 403 | `{error:"origin not allowed"}` | Origin not on the allowlist (preflight gets a bare 403) |
| 404 | `{error:"not found"}` | Another path or method |
| 502 | `{error:"GCD lookup failed"}` | Upstream error, timeout (8 s) or non-JSON reply |
| 503 | `{error:"busy"}` + `Retry-After` | Over budget before anything could be fetched, or GCD said 429/503 |

## Protection

- **Origin allowlist**: `https://freerangeice.github.io` and `http://127.0.0.1:8790`. This only keeps
  other websites from using the relay from a browser. The `Origin` header is trivially spoofed, so it
  does **not** stop scripts, curl or any non-browser caller. The budget and cache are what limit the
  load on GCD.
- **Budget**: at most **25 upstream calls per rolling hour**. GCD's own code throttles anonymous
  clients at 30/hour (`'anon': '30/hour'` in gcd-django `settings.py`), and we stay under that.
  The count is **in memory, per isolate**. Separate isolates and data centers keep their own counts,
  so the true total can be higher. GCD also counts by the IP it sees. Cloudflare Workers'
  outbound requests may share addresses with other Workers, so GCD may throttle earlier than our
  count suggests. Either way the relay backs off.
- **Busy can appear well under 25 calls per hour.** The budget counter is per isolate, and GCD
  throttles by the outbound IP it sees, which may be shared with other Workers on Cloudflare.
- **Back-off**: on HTTP 429 or 503, all calls in this isolate pause. The pause honors `Retry-After`,
  otherwise it lasts 10 minutes. Answers are 503 `busy` with `Retry-After`, or `partial` (see above).
- **Metron budget**: Metron allows 20 calls/min and 5,000/day per account; the relay stops at
  **15/min per isolate** and honours `Retry-After` on 429 (else 60 s pause). Each cold lookup costs at
  most 3 Metron calls; cached ones cost 0.
- **Cache: Workers KV** (binding `GCD_CACHE`, namespace `frm-gcd-GCD_CACHE`,
  id `4ef1dd290ef64ae78b9a147d2068c2cc`). Stored as JSON, never with a price field:
  - each GCD issue record (the relay's own summary, not GCD's raw JSON, no cover URL): **7 days**; an
    issue GCD answers 404 for: 1 day;
  - the Metron issue for a GCD base (`metron:<GCD id>`: Metron id, series, number, cover date, image
    link, Metron gcd_id, variant names + image links; no price/UPC): **7 days**; none found: **1 day**;
    Metron errors, busy and 401 are never stored;
  - a `/comic` search result (the chosen base + every variant name + candidates): **7 days**, kept
    even when a cover detail call failed, so a partial answer never repeats its search;
  - the base's variant list from its series record (`variants:<series id>|<base id>`, ids + names):
    **7 days**; a series record that is missing or unusable: **1 day**;
  - a complete `/comic` answer **with** a Metron picture: **7 days**; without one: **1 day**
    (`TTL_METRON_MISS_S`, so a picture Metron adds later shows within a day; GCD's parts stay in KV
    for 7 days, so the re-ask costs only Metron calls). A 404 detail still counts as complete; an
    answer where Metron was busy, down or refused the token, or the series record failed, does not;
  - a `/comic` miss (including `reason: "add-year"`): **1 day**;
  - errors (502, busy, a 5xx on a detail call) are **never** stored.

  KV is global and eventually consistent (a write is usually visible at once in the data center that
  made it, and within about 60 s elsewhere). KV read or write failures are treated as a miss, never an
  error. Without the binding the relay still works, uncached. Keys start with `v5:` (bumped Oct 10 again
when `/comic` answers started carrying the series record's full variant list; `v4:` was when cover
URLs left the stored data); bump
  `KV_PREFIX` in `worker.js` to start afresh after changing what is stored.
- **Why not `caches.default`:** Cloudflare's Cache API docs say "Workers deployed to custom domains
  have access to functional `cache` operations" (and that the dashboard editor and Playground have
  no effect); `*.workers.dev` is not listed, so on this Worker's `*.workers.dev` host it most
  likely stored nothing. The relay no longer uses it.
- **Response headers** (for checking, not used by the app): `X-Relay-Cache: hit` when the whole
  `/comic` answer came from KV, else `miss`; `X-Relay-Upstream: <n>` = GCD calls this request made;
  `X-Relay-Metron-Calls: <n>` = Metron calls this request made; `X-Relay-Metron` = the Metron step's
  outcome (`hit` from KV, `fetched`, `off` without the secret, `busy`, `auth`, `error`, `none` for a
  stand-in base; absent when the whole answer came from KV).
- **Cover images are never fetched, proxied or cached by the relay.** It passes Metron's
  `static.metron.cloud` URLs through as strings, and the browser loads the images straight from Metron.
  `files1.comics.org` URLs are never sent.
- **Timeout** 8 s per GCD call, 6 s per Metron call. The relay code writes no logs. Cloudflare's own request logs aren't controlled here. Error answers never include upstream URLs.
- **User-Agent**: `FreeRangeMedia-relay/1.0 (personal, non-commercial; +https://freerangeice.github.io/media-shelf/)`.

## Local testing (Node 18+)

```sh
npm run test:offline   # fake GCD built from responses recorded live on 2026-10-05, plus synthetic cases;
                       # fake Metron (gcd_id match, name search, year/series mismatch, variants,
                       # 401, 429, 500, network error, HTML page, budget); fake KV (test/kv-shim.mjs),
                       # including a second "isolate" sharing it
npm run test:live      # real anonymous calls, capped by MAX_LIVE (default 5); recorded paths are replayed
```

`test/fixtures/gcd-recorded.json` holds real GCD API responses (CC BY-SA 4.0 data, price
fields removed) used for offline tests and replay.

## Deploying

Node on this box is v20, so wrangler 3 is used (installed in `/tmp/wr`); `node_modules/.cache` must
exist in this folder. `CLOUDFLARE_API_TOKEN` comes from the environment (never print it).

Worker secret (done Oct 10, 2026; repeat only to change the token). Wrangler 3 reads the value from
stdin when it isn't a terminal, so the token never appears in a command line or file:
`printf %s "$METRON_API_TOKEN" | CLOUDFLARE_ACCOUNT_ID=<account id> /tmp/wr/node_modules/.bin/wrangler secret put METRON_API_TOKEN`.
To turn Metron off: `wrangler secret delete METRON_API_TOKEN` (the relay then answers GCD names only).

1. `npm run test:offline` passes.
2. One-time, already done (Oct 6, 2026): `wrangler kv namespace create GCD_CACHE` created
   `frm-gcd-GCD_CACHE` (id `4ef1dd290ef64ae78b9a147d2068c2cc`), bound in `wrangler.toml`.
3. Deploy:
   `cd /workspace/frm-gcd-relay && CLOUDFLARE_ACCOUNT_ID=<account id> /tmp/wr/node_modules/.bin/wrangler deploy`
   (the account id is not kept in `wrangler.toml`).
4. Smoke test, sparingly (GCD allows 30 anonymous calls an hour per IP, and Cloudflare's outbound
   IPs may be shared, so throttling can start after only a few cold lookups):
   `curl -si -H 'Origin: https://freerangeice.github.io' 'https://frm-gcd.freerangeice.workers.dev/comic?series=Saga&issue=1&year=2012'`
   Expect `match.sourceId` `gcd-issue-911609`. For Metron:
   `curl -si -H 'Origin: https://freerangeice.github.io' 'https://frm-gcd.freerangeice.workers.dev/comic?series=Batman&issue=608&year=2002'`
   should give `imagesFrom: "metron"` and one image, on `gcd-issue-123992` (Direct Sales). Repeat it: the second answer should carry
   `X-Relay-Cache: hit` and `X-Relay-Upstream: 0`. A 502 `GCD lookup failed` most likely means GCD
   is challenging or blocking the Worker; a 503 with `Retry-After` means GCD (or the relay's budget)
   is throttling.


## Production and review workers

The production Worker is **frm-gcd** (`https://frm-gcd.freerangeice.workers.dev`). This folder's
`wrangler.toml` is that Worker: `name = "frm-gcd"` and the production KV namespace
`frm-gcd-GCD_CACHE`. Deploy production only from this directory, and only when a production deploy
is intended:

```
cd relay/gcd && wrangler deploy
```

`METRON_API_TOKEN` is set on that Worker with `wrangler secret put METRON_API_TOKEN` (never stored
in this folder).

The review Worker is **frm-gcd-review** (`https://frm-gcd-review.freerangeice.workers.dev`). It runs
the same `worker.js` but must use a *separate* Wrangler config with `name = "frm-gcd-review"` and a
separate KV namespace — never the production KV id in this `wrangler.toml`. Put `METRON_API_TOKEN`
on `frm-gcd-review` with `wrangler secret put` against that review config. Do not deploy this
folder's `wrangler.toml` as the review Worker, and do not point a review deploy at the Worker name
`frm-gcd` or at production KV.
