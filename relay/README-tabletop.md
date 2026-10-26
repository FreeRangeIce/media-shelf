# Tabletop lookup relay (source only — not deployed, app not wired)

`relay/tabletop-worker.js` is a Cloudflare Worker, modelled on the frm-gcd relay. The app
does **not** call it yet: `LOOKUP_RELAY_URL` in `tabletop.js` is empty, so the Lookup button
only says "BoardGameGeek lookup isn’t connected yet" and makes no network call.

## Needs before it can go live
1. **BGG token.** Register a non-commercial application at https://boardgamegeek.com/applications
   (BGG says approval "may be a week or more"), then create a token there. Set it with
   `wrangler secret put BGG_TOKEN`. Sent as `Authorization: Bearer <token>` to
   `https://boardgamegeek.com/xmlapi2` (no `www`). Docs: https://boardgamegeek.com/using_the_xml_api
2. **GameUPC key.** `/test` works with the public test key (`test_test_test_test_test`) but
   is wiped periodically; `/v1` (production) needs a key by email. `wrangler secret put GAMEUPC_KEY`,
   and `GAMEUPC_BASE = "v1"` in `[vars]` once a production key exists. Spec: https://gameupc.com/gameupc-oas.yaml
3. Optional KV namespace bound as `TT_CACHE` (otherwise cache is per isolate, in memory).
4. A `wrangler.toml` (name e.g. `frm-tabletop`), then set `LOOKUP_RELAY_URL` and add the host
   to `RELAY_HOSTS` in `sw.js` so answers are never cached by the service worker.
5. The official "Powered by BGG" logo file, linked to boardgamegeek.com (footer TODO).

## Behaviour
- Origin-locked (`ALLOWED_ORIGINS`), own CORS, GET only. Never POSTs (GameUPC `update_url` is never called).
- BGG calls are serialised with `CONFIG.BGG_GAP_MS` (5000 ms; wiki guidance, not a published limit).
- BGG 202 / 500 / 503 (and 429) and GameUPC 429 → `503 {error:"busy"}` + `Retry-After`. GameUPC 400 → bad UPC.
- Search: three single-type searches (boardgame, boardgameexpansion, rpgitem) one at a time;
  `CONFIG.BGG_COMBINED_SEARCH = true` switches to one comma-list call (off; untested).
- Thing pulls batched ≤20 ids, from boardgamegeek.com only (never GameUPC's `data_url` on api.geekdo.com).
- GameUPC `verified` → first match; `choose_from_bgg_info_or_search` → list for the user to pick.
- BGG numeric `0` → empty. Parent-of-expansion mapping (`link type=boardgameexpansion inbound=true`)
  and all rpgitem field mappings are **UNVERIFIED** (nothing tested without a token).
