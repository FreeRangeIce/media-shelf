# Tabletop lookup relay (Cloudflare Worker frm-tabletop)

`relay/tabletop-worker.js` is a Cloudflare Worker, modelled on the frm-gcd relay. The app
calls it for barcode lookup since v43 (`GAMEUPC_LOOKUP.relay` in `tabletop.js`). Searching
BoardGameGeek by title isn't connected yet (`LOOKUP_RELAY_URL` is empty), so its button is hidden
and it makes no network call.

## How it was set up
- Worker name `frm-tabletop` on the freerangeice workers.dev subdomain: https://frm-tabletop.freerangeice.workers.dev
- KV binding `TT_CACHE`.
- Secrets (names only, set with `wrangler secret put`): `GAMEUPC_KEY`, `BGG_API_TOKEN`.
- Var `GAMEUPC_BASE = "v1"`.
- Deployed with wrangler 3 (the box has Node 20).
- Deployed Nov 2, 2026.

## Behaviour
- Origin-locked (`ALLOWED_ORIGINS`), own CORS, GET only. Never POSTs (GameUPC `update_url` is never called).
- BGG calls are serialised with `CONFIG.BGG_GAP_MS` (5000 ms; wiki guidance, not a published limit).
- BGG 202 / 500 / 503 (and 429) and GameUPC 429 → `503 {error:"busy"}` + `Retry-After`. GameUPC 400 → bad UPC.
- Search: three single-type searches (boardgame, boardgameexpansion, rpgitem) one at a time;
  `CONFIG.BGG_COMBINED_SEARCH = true` switches to one comma-list call (off; untested).
- Thing pulls batched ≤20 ids, from boardgamegeek.com only (never GameUPC's `data_url` on api.geekdo.com).
- GameUPC `verified` → first match; `choose_from_bgg_info_or_search` → list for the user to pick.
- BGG numeric `0` → empty. Parent-of-expansion mapping (`link type=boardgameexpansion inbound=true`)
  and all rpgitem field mappings are **UNVERIFIED** (not yet tested live).

## Barcode lookup (GameUPC v1) — design/frm-gameupc-lookup
Page side: `GAMEUPC_LOOKUP = { enabled: true, relay: "https://frm-tabletop.freerangeice.workers.dev" }`
in `tabletop.js` since v43; the host is in `RELAY_HOSTS` in `sw.js`, so answers are never cached
there. Setting `enabled: false` turns it off: no barcode UI is built and no relay request is made
(identical to v39).

Three cases (GameUPC `bgg_info_status`):
- `verified` → status `verified`: fills empty title / BGG id / year. **Never posted.**
- `choose_from_bgg_info_or_search` with entries → `choose`: Micah picks a row → "Is this your game?"
  (Confirm / Cancel) → fields filled → on **Save** the relay POSTs `/upc/{upc}/bgg_id/{bgg_id}`.
- anything else (v1 answers `choose_from_bgg_info_or_search` with an empty `bgg_info` for no data)
  → `none`: hand entry. On Save, only if the form has a BGG id, "Send this barcode match?"
  (Save and send / Save only / Cancel). **No BGG id → nothing is posted.** "None of these" in the
  suggestion list joins this path.
- A POST failure never blocks: the game is already saved locally; a toast says it wasn't sent.
- The relay refuses (409) a confirm unless it served a `choose` / `none` answer for that UPC to the
  same client IP (`CF-Connecting-IP`) within the last 10 minutes (recorded in KV; one confirm per
  lookup). So a `verified` UPC, or a UPC this client never looked up, is never posted.
- Global cap: at most `CONFIRM_DAILY_CAP` (var, default 10) confirms go upstream per UTC day, across
  all clients, counted in KV. Over it: 429 + `Retry-After` (seconds to the next UTC midnight), no
  upstream POST; the page saves anyway and shows "Saved. The barcode match wasn’t sent." KV is
  eventually consistent across locations, so the cap is exact per location, soft globally. A
  counted confirm stays counted even if GameUPC then fails.
  Within one isolate, confirm admission (same-IP/10-minute check, consuming the one-confirm-per-lookup
  marker, cap check, day-count write) runs one at a time and finishes before the POST; the isolate
  also keeps its own day count and admits on max(memory, KV), so a slow KV can't let extras in.
- BGG cap: at most `BGG_DAILY_CAP` (var, default 200) upstream BGG XML API calls (`/search`,
  `/thing`) per UTC day, across all clients, counted in KV (`tt1:bgg:YYYY-MM-DD`). Each upstream
  call counts (a `/search` with separate types is up to 3 calls); cache hits never count and are
  still served after the cap. At the cap: 503 `{"error":"bgg daily cap reached"}` + `Retry-After`
  (seconds to the next UTC midnight), no BGG call. Without the `TT_CACHE` KV binding every
  uncached BGG lookup fails closed (503 `not configured`, no BGG call). Same admission pattern as
  the confirm cap: counted before the call, never decremented, max(isolate memory, KV).
- **KV `TT_CACHE` is required for confirms**: without the binding, `/barcode/confirm` answers 503 and
  never POSTs. GameUPC barcode lookups still work (isolate memory / Cache API); uncached BGG lookups answer 503.
- POST body `{"user_id": userId}`. Each device makes its own random id (`crypto.randomUUID()`) the
  first time it sends a match and keeps it under its own storage key `frm-gameupc-device-id`, which
  backups and exports never include. The page sends it as `userId`; the relay answers 400 unless it
  is 8 to 64 letters, digits or dashes, checked before the same-IP record or the day's cap is
  touched, and there is no shared fallback id. The cap and the same-IP check don't depend on it.
  The spec (https://gameupc.com/gameupc-oas.yaml, POST `/upc/{upc}/bgg_id/{bgg_id}`) requires "a
  unique (but consistent) user_id for each user" and says "If one of your users goes bad, we can go
  back and clear out any updates they've made."


Cache / throttle: relay memory → KV `TT_CACHE` (if bound) → Workers Cache API. TTLs: verified 30 d,
choose 7 d, none 12 h; a confirm drops the UPC's entry. One in-flight upstream request per UPC;
all GameUPC calls serialised ≥ 1 s apart; per client IP 10 upstream lookups/min and 5 confirms/min
(429 + Retry-After; cache hits are free). Page: 600 ms debounce, fires only for a complete
8/12/13-digit code with a valid check digit; per-page answer cache; one request per code at a time.

Local testing (no wrangler, no account): `relay/dev-shim.mjs` (secrets from the environment,
POSTs mocked, KV in a JSON file outside the repo, in memory, or absent with `NO_KV=1`; `MOCK_GET=1`
mocks GETs too), `tests/tabletop-relay.test.mjs` (relay rules, node only) and
`tests/tabletop-gameupc.test.js`.
Secrets: `wrangler secret put GAMEUPC_KEY` at deploy time; never committed. (No user_id secret: each device sends its own.)
