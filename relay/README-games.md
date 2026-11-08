# Video-game title lookup relay (local review build; not deployed)

## Verified primary documentation, read 2026-11-08

- https://api-docs.igdb.com/ : official `POST https://api.igdb.com/v4/games`, APICalypse title search, `Client-ID`/Bearer headers, cover image IDs, platform names; **4 requests/s, at most 8 open requests**, and HTTP 429 above limits. The documented Game fields have no UPC/EAN barcode field. The docs do **not** specify an IGDB daily request allowance.
- https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#client-credentials-grant-flow : confidential server-only POST to `https://id.twitch.tv/oauth2/token`, form-urlencoded client credentials, response `expires_in`. This implementation derives `expires_at` from that value and refreshes proactively; a 401 gets one renewed-token retry, never an unbounded retry loop. Tokens/secrets are neither browser data nor public responses, logs, KV data or backups.
- https://www.upcitemdb.com/wp/docs/main/development/api-rate-limits/ : the documentation calls the free tier **FREE**, 100 combined lookup/search requests/day, search subset 40/day, burst 6/minute, per IP. It documents `X-RateLimit-Reset`; the browser adapter also honors `Retry-After` if supplied. “Explorer” branding and that header's guaranteed availability were not established by this page. No new UPC plan or account is assumed.

Live IGDB search quality, noisy retail names and real-device behavior have NOT been verified by these mocked tests. No provider calls are required for the suite. Public Exa/Firecrawl integrations were unavailable here; primary documentation was read directly.

## Split path and deliberate selection

The existing browser barcode step remains Wikidata, then UPCitemdb. It returns a title, not an IGDB ID. Raw barcode-product names are retained; query normalization is only NFKC/whitespace plus validity bounds. No generic dash/edition-word chopping, no empty or numeric-only title query, no UPC/EAN query sent to IGDB, and no PriceCharting fallback in the new game path. No platform is silently changed from a barcode hit.

The relay accepts only `GET /game/search?title=...` (one title parameter, 2–160 normalized characters with a letter; URL/control/numeric-only inputs rejected). It constructs the fixed official IGDB request, limits fields/results, sanitizes IDs/text and constructs only IGDB cover URLs from validated image IDs. It is not a generic proxy.

Every result, including one result, requires a choice and **Use this match**. Choosing does not save. Filled fields retain the existing explicit Overwrite confirmation. Save while the choices are open is guarded; Cancel returns to manual entry. Selected platform mismatches/unknown compatibility are not auto-selected. Unknown custom platform labels require changing the selector to an understood platform or Other; store labels are not proof of platform compatibility.

New `igdbId` is additive and separate from `rawgId`, `externalId` and legacy cover source IDs. Old RAWG IDs, cover URLs and stored keys are not reinterpreted/deleted. Backups/exports keep both identities. The existing same-size no-cover tile handles legacy image failure. No image bytes are copied/cached by this relay. Tabletop BGG/GameUPC code and storage are unchanged.

## Required deployment configuration — missing, not provisioned

`wrangler-games.example.toml` is a review template, NOT an active deployment configuration. Before any approved deployment:

1. Provision/bind a real KV namespace as `GAME_LIMITS`; replace the explicit placeholder ID.
2. Bind the SQLite Durable Object namespace `GAME_COORDINATOR` to `GameCoordinator` and apply its migration. All requests must use the fixed singleton name `game-upstream-v1` through the entrypoint. Do not expose an alternate uncoordinated route.
3. Bind server secrets `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` through the platform's approved secret mechanism. Do not paste values into source, configuration, URLs, logs or a client-side environment file.
4. Set exact `ALLOWED_ORIGINS` (scheme/host/port origins, not path prefixes). Current template is `https://freerangeice.github.io`; local tests inject loopback origins only.
5. Review `IGDB_APP_DAILY_CAP`: default **500**, allowed 1–10000. This is an **application-owned conservative admission budget**, NOT an IGDB allowance, not BGG's 200 and not a UPCitemdb plan quota. Failed auth reservations can consume this safety budget without spending an IGDB request. Each actual 401 retry also reserves budget. Per-IP client throttle: 10 requests/minute; bounded start queue 16.
6. Only after deployment, endpoint verification and approval, set the browser `GAME_RELAY_URL` to the actual approved HTTPS relay origin. It is currently **empty**. Title search remains hidden without this usable configuration. There is a loopback-only test override `window.__FRM_GAME_RELAY__`; production origins cannot enable it.

The singleton serializes admissions, spaces **actual** IGDB starts by 260ms, and limits open IGDB requests to eight. A slow OAuth acquisition cannot release a burst of previously admitted requests. The authoritative daily counter is Durable Object storage; KV is a required fail-closed mirror. KV alone is eventually consistent and non-atomic: it would NOT enforce a distributed global cap. The singleton/storage design avoids relying on KV increments for atomicity. Rotating coordinator names, multiple separately deployed environments or other clients using the same Twitch app can still bypass aggregate coordination; do not share credentials across uncoordinated deployments. Old durable daily keys remain small counters and need an operational retention policy if long-lived.

429 is returned with bounded interpreted Retry-After and blocks new provider starts during that interval; no automatic 429/5xx retry. Token expiration uses `expires_in`, proactive skew up to 60s; refresh is shared, 401 retries once, persistent auth errors cool down. Provider fetch/body timeout 8s, response limit 256KiB, no redirect following, max 10 returned candidates. Secrets are held in server environment/memory only. Missing required KV/DO/secrets fails 503 before an IGDB request. Origin CORS is not authentication: a public client can be imitated; throttles/app caps bound abuse, not eliminate it.

The existing direct UPCitemdb browser call remains per-user-IP and subject to its provider free allowance; the IGDB KV cap does not purport to meter that separate provider. Browser cooldown prevents retries during Retry-After/reset windows. Centrally metering/proxying UPCitemdb would be separate architecture/configuration work, not something this patch silently invents.

## Review-only wording

Footer: **Game data from IGDB.com.** Same muted credit location. Settings explain the split path, server relay and no personal game key; legacy RAWG key controls/reference links are retired without deleting stored data. Berean wording/terms review is pending. The owner previously accepted the personal/noncommercial storage-terms concern; this is not a fresh legal assurance or authorization to publish.

## Tests

`node tests/game-relay.test.mjs` uses fake credentials, fetch, time and durable/KV storage. Browser suite `tests/game-igdb-ui.test.js` intercepts every provider request; no real writes or screenshots. Known-bad worker title-validation and retry-bound controls are external scratch modules, never committed. Existing strict suites remain required. No release version/cache bump yet.

### Native-runtime and cancelled-overwrite regressions

Run `node tests/game-lookup-transaction.test.cjs` from the repo root for the pure-Node lookup transaction tests. They execute the actual app functions without launching a browser. Conflicting IGDB fields and record ID stay unchanged until Overwrite is accepted; Cancel preserves the old record link.

Run `MINIFLARE_MODULE=/path/to/miniflare node tests/game-relay-runtime.test.cjs` for native workerd with dummy credentials and a mocked outbound service. It verifies successful token/game requests and rejects redirects without following them. `WORKER_COMPAT_DATE` selects the runtime compatibility date. The installed Miniflare 4.20260730.0 supports dates through 2026-08-06, which is the date locally tested; the template's 2026-11-08 compatibility date still needs verification on a supporting runtime before deployment. No browser or live provider traffic is used by these two tests.
