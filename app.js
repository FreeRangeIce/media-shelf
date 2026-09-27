/* FreeRangeMedia (formerly Media Shelf) — vanilla SPA, localStorage persistence */
(() => {
  "use strict";

  const STORAGE_KEY = "media-tracker-v1";
  const OMDB_KEY_STORAGE = "media-shelf-omdb-key";
  const RAWG_KEY_STORAGE = "media-shelf-rawg-key";
  const LAST_BACKUP_STORAGE = "media-shelf-last-backup";
  const BACKUP_REMINDER_DISMISSED_STORAGE = "media-shelf-backup-reminder-dismissed";
  /** New key (B3): set once samples have been offered, so clearing them is permanent. */
  const SEEDED_STORAGE = "media-shelf-seeded";
  /**
   * Backup guard (v1.2): every file we write is an object with app "freerangemedia" and
   * version 2. Live Media Shelf (f8427ef) only accepts app names matching
   * /^media[\s-]?shelf$/i, plain arrays, or objects with no app field — so it refuses
   * these files with its clear "isn’t a Media Shelf backup" error instead of silently
   * stripping music / component / signed data. Never write a bare array or omit app.
   */
  const BACKUP_APP_ID = "freerangemedia";
  const BACKUP_VERSION = 2;
  /** Restore still accepts the old name (v1) and the new one (v2). */
  const LEGACY_BACKUP_APP_RE = /^media[\s-]?shelf$/i;
  const BACKUP_APP_RE = /^free[\s-]?range[\s-]?media$/i;
  const BACKUP_STALE_DAYS = 14;
  const BACKUP_SNOOZE_DAYS = 7;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
  const HTML5_QRCODE_CDN =
    "https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js";
  const TYPE_LABELS = { book: "Book", game: "Game", movie: "Movie", music: "Music" };
  const STATUS_LABELS = {
    want: "Want",
    in_progress: "In progress",
    done: "Done",
    dropped: "Dropped",
  };
  const FORMAT_LABELS = {
    physical: "Physical",
    digital: "Digital",
    audiobook: "Audiobook",
  };
  const DISC_LABELS = {
    "blu-ray": "Blu-ray",
    dvd: "DVD",
    vhs: "VHS",
    cart: "Cart",
    disc: "Disc",
    code: "Code",
    cd: "CD",
    vinyl: "Vinyl",
    cassette: "Cassette",
  };
  /** Label of the reused `disc` select per type. PLACEHOLDER copy (Berean) except "Disc". */
  const DISC_FIELD_LABELS = {
    movie: "Disc",
    game: "Cart / disc / code",
    music: "CD / vinyl / cassette",
  };
  const PLATFORM_LABELS = {
    steam: "Steam",
    psn: "PlayStation",
    xbox: "Xbox",
    nintendo: "Nintendo",
    gog: "GOG",
    epic: "Epic",
    battlenet: "Battle.net",
    ea: "EA",
    ubisoft: "Ubisoft",
    amazon: "Amazon",
    itch: "itch.io",
    humble: "Humble",
    rockstar: "Rockstar",
    other: "Other",
  };
  const CREATOR_HINTS = {
    book: "Author",
    game: "Developer / publisher",
    movie: "Director / studio",
    music: "Artist",
  };
  const CREATOR_PLACEHOLDERS = {
    book: "e.g. Andy Weir",
    game: "e.g. Supergiant Games",
    movie: "e.g. Denis Villeneuve",
    music: "e.g. Fleetwood Mac", // PLACEHOLDER example (Berean)
  };

  /**
   * Count wording: [singular, plural]. English plural is "other" for 0 and 2+.
   * Status labels are adjectives/verb labels, not count nouns, so they don't take an -s:
   * "1 done / 2 done", "1 in progress / 2 in progress", "1 want / 2 want" ("2 wants" would
   * read as desires). "dropped" is listed for completeness.
   */
  const COUNT_NOUNS = {
    book: ["book", "books"],
    game: ["game", "games"],
    movie: ["movie", "movies"],
    music: ["album", "albums"], // PLACEHOLDER count noun for the stats strip (Berean)
    item: ["item", "items"],
    want: ["want", "want"],
    in_progress: ["in progress", "in progress"],
    done: ["done", "done"],
    dropped: ["dropped", "dropped"],
  };

  function countNoun(n, key) {
    const forms = COUNT_NOUNS[key] || [key, `${key}s`];
    return Number(n) === 1 ? forms[0] : forms[1];
  }

  function countLabel(n, key) {
    return `${n} ${countNoun(n, key)}`;
  }

  /** @type {Array<object>} */
  let items = [];
  let filterType = "all";
  let filterStatus = "all";
  let sortMode = "updated";
  let searchQuery = "";
  let searchTimer = null;
  let editingId = null;
  /** Copy of the item as it was when the edit form opened (two-tab merge base). */
  let editingSnapshot = null;
  /** Add form: the user already chose "Add as a separate copy" for this existing item. */
  let dupAcceptedSeparateId = null;
  let lastFocus = null;
  let confirmCallback = null;
  let confirmAltCallback = null;
  let confirmReturnFocus = null;
  let toastTimer = null;
  let html5QrCodeLibPromise = null;
  /** @type {any} */
  let activeScanner = null;
  let lookupBusy = false;
  /** B10: per-lookup record of sources that refused / errored (label -> issue). */
  let lookupIssues = null;
  let lookupSource = "";
  /** Music Lookup's year is a fallback or blank: the duplicate check ignores year (N2b). */
  let lookupYearLoose = false;
  let apiHintDismissed = false;
  try {
    apiHintDismissed = sessionStorage.getItem("media-shelf-api-hint-dismissed") === "1";
  } catch {
    /* private mode */
  }

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const els = {
    list: $("#item-list"),
    empty: $("#empty-state"),
    stats: $("#stats"),
    seedBanner: $("#seed-banner"),
    search: $("#search"),
    statusFilter: $("#status-filter"),
    sortSelect: $("#sort-select"),
    modal: $("#modal"),
    confirm: $("#confirm"),
    scanModal: $("#scan-modal"),
    form: $("#item-form"),
    modalTitle: $("#modal-title"),
    btnDelete: $("#btn-delete"),
    fieldId: $("#field-id"),
    fieldType: $("#field-type"),
    fieldBarcode: $("#field-barcode"),
    fieldTitle: $("#field-title"),
    fieldCreator: $("#field-creator"),
    labelCreator: $("#label-creator"),
    fieldYear: $("#field-year"),
    fieldStatus: $("#field-status"),
    fieldFormat: $("#field-format"),
    fieldDisc: $("#field-disc"),
    labelDisc: $("#label-disc"),
    discRow: $("#disc-row"),
    fieldRating: $("#field-rating"),
    fieldProgress: $("#field-progress"),
    fieldTags: $("#field-tags"),
    fieldNotes: $("#field-notes"),
    fieldCover: $("#field-cover"),
    fieldCoverSource: $("#field-cover-source"),
    coverPreview: $("#cover-preview"),
    coverPreviewPlaceholder: $("#cover-preview-placeholder"),
    lookupStatus: $("#lookup-status"),
    gbAttr: $("#gb-attr"),
    gbLink: $("#gb-link"),
    gbCoverNote: $("#gb-cover-note"),
    fieldGbUrl: $("#field-gb-url"),
    apiKeyHint: $("#api-key-hint"),
    btnScan: $("#btn-scan"),
    btnLookup: $("#btn-lookup"),
    scanStatus: $("#scan-status"),
    qrReader: $("#qr-reader"),
    toast: $("#toast"),
    importFile: $("#import-file"),
    confirmOk: $("#confirm-ok"),
    confirmAlt: $("#confirm-alt"),
    confirmPanel: $("#confirm-panel"),
    confirmDetail: $("#confirm-detail"),
    confirmOptionRow: $("#confirm-option-row"),
    confirmOption: $("#confirm-option"),
    confirmOptionLabel: $("#confirm-option-label"),
    backupBanner: $("#backup-banner"),
    backupLast: $("#backup-last"),
    backupStatus: $("#backup-status"),
    backupCard: $("#backup-card"),
    settingsModal: $("#settings-modal"),
    fieldOmdbKey: $("#field-omdb-key"),
    fieldRawgKey: $("#field-rawg-key"),
    omdbKeyStatus: $("#omdb-key-status"),
    rawgKeyStatus: $("#rawg-key-status"),
    omdbTestStatus: $("#omdb-test-status"),
    rawgTestStatus: $("#rawg-test-status"),
    apiCardOmdb: $("#api-card-omdb"),
    apiCardRawg: $("#api-card-rawg"),
    apiKeyHintText: $("#api-key-hint-text"),
    btnOpenApiSettings: $("#btn-open-api-settings"),
    refImdb: $("#ref-imdb"),
    refIsfdb: $("#ref-isfdb"),
    refRawg: $("#ref-rawg"),
    refIgdb: $("#ref-igdb"),
    refLinksRow: $("#ref-links-row"),
    componentsRow: $("#components-row"),
    fieldOwnsGame: $("#field-owns-game"),
    fieldOwnsCase: $("#field-owns-case"),
    fieldOwnsManual: $("#field-owns-manual"),
    labelOwnsGame: $("#label-owns-game"),
    labelOwnsCase: $("#label-owns-case"),
    labelOwnsManual: $("#label-owns-manual"),
    btnCib: $("#btn-cib"),
    fieldPlatform: $("#field-platform"),
    platformRow: $("#platform-row"),
    signedRow: $("#signed-row"),
    signedSingle: $("#signed-single"),
    signedMulti: $("#signed-multi"),
    fieldSignedSingle: $("#field-signed-single"),
    fieldSignedParent: $("#field-signed-parent"),
    signedAuthors: $("#signed-authors"),
  };

  function uid() {
    return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      lastSyncedRaw = raw;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.items)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Two-tab guard (v1.2). `lastSyncedRaw` is the exact store string this tab last read or
   * wrote. Every change goes through commitItems(): it re-reads localStorage first, and if
   * another tab wrote in the meantime it applies this tab's change to the fresh items
   * instead of overwriting them with a stale in-memory list.
   */
  let lastSyncedRaw = null;

  function saveStore() {
    // Store envelope stays { version: 1, savedAt, items } so the key and its shape are
    // unchanged for any reader; only the item fields grew (all additive).
    const payload = {
      version: 1,
      savedAt: nowIso(),
      items,
    };
    const raw = JSON.stringify(payload);
    localStorage.setItem(STORAGE_KEY, raw);
    lastSyncedRaw = raw;
  }

  /** Re-read items from storage if another tab changed them. Returns true if reloaded. */
  function syncFromStorage() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      return false;
    }
    if (raw === lastSyncedRaw) return false;
    const store = loadStore();
    if (!store) return false; // missing or unreadable: keep what this tab has
    items = store.items.map(normalizeItem);
    lastSyncedRaw = raw;
    return true;
  }

  /**
   * The only way to change the library: sync with storage, apply `mutate` to the fresh
   * items (it may return a new array), save.
   * @param {(list: object[]) => (object[] | void)} mutate
   */
  function commitItems(mutate) {
    syncFromStorage();
    const next = mutate(items);
    if (Array.isArray(next)) items = next;
    saveStore();
  }

  /* ---------- v1.2 schema (additive; old items and backups lack these keys) ---------- */
  const TYPES = ["book", "game", "movie", "music"];
  /** Physical "format detail" (the reused `disc` field) allowed per type. */
  const DISC_OPTIONS = {
    game: ["cart", "disc", "code"],
    movie: ["blu-ray", "dvd", "vhs"],
    music: ["cd", "vinyl", "cassette"],
  };
  const PLATFORMS = [
    "steam", "psn", "xbox", "nintendo", "gog", "epic", "battlenet", "ea",
    "ubisoft", "amazon", "itch", "humble", "rockstar", "other",
  ];
  /**
   * Platform is free text (Micah, step 7 option A) with these suggestions in a datalist.
   * Typing one in any case stores this spelling, so "steam" and "Steam" match.
   */
  const PLATFORM_SUGGESTIONS = [
    "Steam", "GOG", "Epic", "itch.io", "Xbox", "Xbox Series X|S", "PlayStation", "PlayStation 5",
    "PlayStation 4", "Nintendo Switch", "Switch 2", "Battle.net", "EA app", "Ubisoft", "Amazon",
    "Humble", "PC", "Mac", "iOS", "Android",
  ];

  /**
   * Common short names, compared (and saved from import) as the suggestion they stand for.
   * Keep this list short. "Switch 2" stays separate from Nintendo Switch; PC is left alone.
   */
  const PLATFORM_ALIASES = {
    ps5: "PlayStation 5",
    ps4: "PlayStation 4",
    switch: "Nintendo Switch",
    xsx: "Xbox Series X|S",
    xss: "Xbox Series X|S",
    "series x": "Xbox Series X|S",
    "series s": "Xbox Series X|S",
    "xbox series x": "Xbox Series X|S",
    "xbox series s": "Xbox Series X|S",
  };

  /** Trim, collapse spaces, snap to a suggestion's spelling; old key ids get their label. */
  function normalizePlatform(value) {
    const v = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
    if (!v) return "";
    const low = v.toLowerCase();
    const hit = PLATFORM_SUGGESTIONS.find((p) => p.toLowerCase() === low);
    if (hit) return hit;
    if (PLATFORMS.includes(low) && low !== "other") return PLATFORM_LABELS[low] || v;
    return v;
  }

  /** The suggestion a platform stands for ("PS5" → "PlayStation 5"); otherwise as normalized. */
  function canonicalPlatform(value) {
    const n = normalizePlatform(value);
    return PLATFORM_ALIASES[n.toLowerCase()] || n;
  }

  /** Add-form values are saved as typed, but always compared through the aliases. */
  function samePlatform(a, b) {
    return canonicalPlatform(a).toLowerCase() === canonicalPlatform(b).toLowerCase();
  }
  const ACQUISITIONS = ["purchased", "pass", "shared", "gift", "bundled", "unknown"];
  const COMPONENT_KEYS = ["ownsGame", "ownsCase", "ownsManual"];
  /** "What’s on the shelf?" labels per type (handoff §3.4). Books have no trio in v1. */
  const COMPONENT_LABELS = {
    game: ["Game", "Case", "Manual"],
    music: ["Media", "Case", "Insert"],
    movie: ["Disc", "Case", "Insert"],
  };

  function hasComponents(item) {
    return item.format === "physical" && Boolean(COMPONENT_LABELS[item.type]);
  }

  function isCib(item) {
    return hasComponents(item) && COMPONENT_KEYS.every((k) => item[k] === true);
  }

  /** true / false / null (unknown). Anything else is unknown, never a guess. */
  function triState(v) {
    return v === true || v === false ? v : null;
  }

  function normalizeAuthors(raw) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const out = [];
    for (const a of raw) {
      const name = String((a && typeof a === "object" ? a.name : a) || "").trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      out.push({ name, signed: Boolean(a && typeof a === "object" && a.signed === true) });
    }
    return out;
  }

  function normalizeItem(raw) {
    const type = TYPES.includes(raw.type) ? raw.type : "book";
    let format = raw.format;
    if (type === "book") {
      if (!["physical", "digital", "audiobook"].includes(format)) format = "physical";
    } else {
      if (!["physical", "digital"].includes(format)) format = "digital";
    }
    let disc = raw.disc ?? raw.mediaFormat ?? null;
    if (format === "physical" && DISC_OPTIONS[type]) {
      if (!DISC_OPTIONS[type].includes(disc)) {
        // Movies have always required a disc (old items default to Blu-ray, as before).
        // Game cart/disc/code and music CD/vinyl/cassette are optional.
        disc = type === "movie" ? "blu-ray" : null;
      }
    } else {
      disc = null;
    }
    const rating =
      raw.rating === null || raw.rating === undefined || raw.rating === ""
        ? null
        : Math.min(5, Math.max(0, Number(raw.rating)));
    const year =
      raw.year === null || raw.year === undefined || raw.year === ""
        ? null
        : Number(raw.year);
    const coverSource = String(raw.coverSource || "").trim();
    const playtime =
      raw.playtimeMinutes === null || raw.playtimeMinutes === undefined || raw.playtimeMinutes === ""
        ? null
        : Number(raw.playtimeMinutes);
    const sources = Array.isArray(raw.sources)
      ? [...new Set(raw.sources.map((x) => String(x).trim()).filter(Boolean))]
      : [];
    const authors = normalizeAuthors(raw.authors);
    // `signed` is derived from authors[]; a bare flag only survives when no author is known.
    const signed = authors.length
      ? authors.some((a) => a.signed)
      : raw.signed === true;
    return {
      id: String(raw.id || uid()),
      type,
      title: String(raw.title || "Untitled").trim() || "Untitled",
      creator: String(raw.creator || "").trim(),
      year: Number.isFinite(year) ? year : null,
      status: ["want", "in_progress", "done", "dropped"].includes(raw.status)
        ? raw.status
        : "want",
      rating: Number.isFinite(rating) ? rating : null,
      format,
      disc,
      notes: String(raw.notes || ""),
      tags: Array.isArray(raw.tags)
        ? raw.tags.map((t) => String(t).trim()).filter(Boolean)
        : String(raw.tags || "")
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
      progress: String(raw.progress || ""),
      barcode: String(raw.barcode || "").trim(),
      coverUrl: String(raw.coverUrl || "").trim(),
      coverSource: coverSource || "",
      dateAdded: raw.dateAdded || nowIso(),
      dateUpdated: raw.dateUpdated || raw.dateAdded || nowIso(),
      seed: Boolean(raw.seed),
      // v1.2 additive fields (defaults are "unknown", never a guess)
      platform: normalizePlatform(raw.platform),
      externalId: String(raw.externalId ?? "").trim(),
      acquisition: ACQUISITIONS.includes(raw.acquisition) ? raw.acquisition : "",
      playtimeMinutes: Number.isFinite(playtime) && playtime >= 0 ? Math.round(playtime) : null,
      lastUsed: String(raw.lastUsed || "").trim(),
      ownsGame: triState(raw.ownsGame),
      ownsCase: triState(raw.ownsCase),
      ownsManual: triState(raw.ownsManual),
      sources: sources.length ? sources : ["manual"],
      rawgId: String(raw.rawgId ?? "").trim(),
      authors,
      signed,
      googleBooksUrl: safeGoogleBooksUrl(raw.googleBooksUrl),
    };
  }

  /**
   * The book's Google Books page (volumeInfo.canonicalVolumeLink or infoLink), stored so the
   * edit form can link to it. Only https links on Google hosts are kept: a restored backup
   * must never turn this into a javascript: or look-alike link.
   */
  function safeGoogleBooksUrl(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";
    try {
      const u = new URL(s.replace(/^http:\/\//i, "https://"));
      if (u.protocol !== "https:") return "";
      if (!/^(books|play|www)\.google\.(com|[a-z]{2,3}(\.[a-z]{2})?)$/i.test(u.hostname)) return "";
      return u.toString();
    } catch {
      return "";
    }
  }

  async function seedIfEmpty() {
    // Opening the app never writes storage (v1.2): old items get the new-field defaults in
    // memory only, and the stored string stays byte-identical until the user saves,
    // deletes, restores or clears. So a still-open older tab reads exactly what it wrote.
    const store = loadStore();
    if (store && Array.isArray(store.items) && store.items.length > 0) {
      items = store.items.map(normalizeItem);
      return;
    }
    // Samples are offered once. A saved (even empty) library means this browser has
    // already been set up — e.g. samples cleared or every item deleted — so don't re-seed.
    if (readLs(SEEDED_STORAGE) || store) {
      items = store ? store.items.map(normalizeItem) : [];
      return;
    }
    // First visit only (nothing stored yet): save the samples, as before.
    try {
      const res = await fetch("./data/seed.json");
      if (!res.ok) throw new Error("seed fetch failed");
      const data = await res.json();
      items = (Array.isArray(data) ? data : []).map(normalizeItem);
    } catch {
      // Seed file unavailable: start empty but don't persist, so a later visit can retry.
      items = [];
      return;
    }
    writeLs(SEEDED_STORAGE, nowIso());
    saveStore();
  }

  function stars(n) {
    if (n == null || !Number.isFinite(n) || n <= 0) return "";
    const full = Math.round(n);
    return "★".repeat(full) + "☆".repeat(5 - full);
  }

  /**
   * The quiet secondary pill (Oholiab B2): only type and status get coloured chips; format,
   * platform, disc, CIB and Signed are plain text joined with " · ".
   */
  function formatBadgeParts(item) {
    const parts = [FORMAT_LABELS[item.format] || item.format];
    if (item.platform) parts.push(PLATFORM_LABELS[item.platform] || item.platform);
    if (item.format === "physical" && item.disc) parts.push(DISC_LABELS[item.disc] || item.disc);
    if (isCib(item)) parts.push("CIB");
    if (item.type === "book" && item.signed) {
      // "Signed" when every listed author signed; names only for a subset (Oholiab Pass 1
      // fix 4). The full list stays in the edit form.
      const who = item.authors.filter((a) => a.signed).map((a) => a.name);
      const some = item.authors.length > 1 && who.length < item.authors.length;
      parts.push(some && who.length ? `Signed: ${who.join(", ")}` : "Signed");
    }
    return parts;
  }

  function formatBadgeText(item) {
    return formatBadgeParts(item).join(" · ");
  }

  function normalizeBarcode(raw) {
    return String(raw || "")
      .replace(/[-\s]/g, "")
      .toUpperCase();
  }

  function looksLikeIsbn(raw) {
    const n = normalizeBarcode(raw);
    if (/^\d{9}[\dX]$/.test(n)) return true;
    if (/^97[89]\d{10}$/.test(n)) return true;
    return false;
  }

  function setLookupStatus(msg, kind) {
    if (!msg) {
      els.lookupStatus.hidden = true;
      els.lookupStatus.textContent = "";
      els.lookupStatus.classList.remove("is-error", "is-ok");
      return;
    }
    els.lookupStatus.hidden = false;
    els.lookupStatus.textContent = msg;
    els.lookupStatus.classList.toggle("is-error", kind === "error");
    els.lookupStatus.classList.toggle("is-ok", kind === "ok");
  }

  /** Music covers preview in a 1:1 frame, other types in 2:3. */
  function updateCoverFrame() {
    const wrap = els.coverPreview && els.coverPreview.closest(".cover-preview-wrap");
    if (wrap) wrap.dataset.type = els.fieldType.value;
  }

  /** Google Books attribution: mark + link under Lookup, and a note beside a Google Books cover. */
  function updateGoogleBooksAttr() {
    const isBook = els.fieldType.value === "book";
    const link = isBook ? safeGoogleBooksUrl(els.fieldGbUrl.value) : "";
    els.gbAttr.hidden = !link;
    if (link) els.gbLink.href = link;
    else els.gbLink.removeAttribute("href");
    els.gbCoverNote.hidden = !(
      isBook &&
      els.fieldCoverSource.value === "googlebooks" &&
      els.fieldCover.value.trim()
    );
  }

  function updateCoverPreview() {
    updateGoogleBooksAttr();
    const url = els.fieldCover.value.trim();
    if (url) {
      els.coverPreview.src = url;
      els.coverPreview.hidden = false;
      els.coverPreviewPlaceholder.hidden = true;
    } else {
      els.coverPreview.removeAttribute("src");
      els.coverPreview.hidden = true;
      els.coverPreviewPlaceholder.hidden = false;
    }
  }

  function updateFormatOptions() {
    const type = els.fieldType.value;
    const current = els.fieldFormat.value;
    const options =
      type === "book"
        ? [
            ["physical", "Physical"],
            ["digital", "Digital"],
            ["audiobook", "Audiobook"],
          ]
        : [
            ["physical", "Physical"],
            ["digital", "Digital"],
          ];
    els.fieldFormat.innerHTML = options
      .map(([v, l]) => `<option value="${v}">${l}</option>`)
      .join("");
    const allowed = options.map(([v]) => v);
    els.fieldFormat.value = allowed.includes(current) ? current : allowed[0];
    els.labelCreator.textContent = CREATOR_HINTS[type] || "Creator";
    els.fieldCreator.placeholder = CREATOR_PLACEHOLDERS[type] || "";
    updateDiscOptions();
    updateDiscVisibility();
  }

  /**
   * Rebuild the format-detail select for the current type. A value that isn't valid for
   * the new type is cleared (movies fall back to Blu-ray, since a movie disc is required).
   */
  function updateDiscOptions() {
    const type = els.fieldType.value;
    const opts = DISC_OPTIONS[type] || [];
    const current = els.fieldDisc.value;
    const required = type === "movie";
    els.fieldDisc.innerHTML =
      (required ? "" : `<option value="">—</option>`) +
      opts.map((v) => `<option value="${v}">${DISC_LABELS[v]}</option>`).join("");
    els.fieldDisc.value = opts.includes(current) ? current : required ? opts[0] : "";
    if (els.labelDisc) {
      els.labelDisc.innerHTML =
        escapeHtml(DISC_FIELD_LABELS[type] || "Disc") +
        (required ? ` <span class="req">*</span>` : "");
    }
  }

  function updateDiscVisibility() {
    if (els.platformRow) els.platformRow.hidden = els.fieldType.value !== "game";
    const show =
      Boolean(DISC_OPTIONS[els.fieldType.value]) && els.fieldFormat.value === "physical";
    els.discRow.hidden = !show;
    els.fieldDisc.required = show && els.fieldType.value === "movie";
    updateComponentsUi();
  }

  /* ---------- Physical components (handoff §3.4) ---------- */
  /**
   * Form state for the trio: true / false / null. null means "not touched" (unknown), so an
   * unticked box saves as null until the user ticks and unticks it (then false).
   */
  let componentState = { ownsGame: null, ownsCase: null, ownsManual: null };

  function componentInputs() {
    return [els.fieldOwnsGame, els.fieldOwnsCase, els.fieldOwnsManual];
  }

  function setComponentState(state) {
    componentState = {
      ownsGame: triState(state.ownsGame),
      ownsCase: triState(state.ownsCase),
      ownsManual: triState(state.ownsManual),
    };
    componentInputs().forEach((el, i) => {
      if (el) el.checked = componentState[COMPONENT_KEYS[i]] === true;
    });
  }

  /* ---------- Book signed copy (handoff §3.5) ---------- */
  /** Form state: structured authors parsed from creator, plus a bare flag for 0 authors. */
  let formAuthors = [];
  let formSignedNoAuthor = false;

  /** Split creator on "," ";" " & " " and " (case-insensitive); trim; drop empties. */
  /** Name suffixes that follow a comma but belong to the name before it ("King, Jr."). */
  const NAME_SUFFIX_RE = /^(jr|sr|ii|iii|iv|ph\.?d|md)\.?$/i;

  function parseCreatorNames(creator) {
    // Keep the separators so a suffix after a comma can rejoin the previous name.
    const parts = String(creator || "").split(/(\s*[,;]\s*|\s+&\s+|\s+and\s+)/i);
    const names = [];
    for (let i = 0; i < parts.length; i += 2) {
      const name = parts[i].trim();
      const sep = i > 0 ? parts[i - 1].trim() : "";
      if (sep === "," && names.length && NAME_SUFFIX_RE.test(name)) {
        names[names.length - 1] += `, ${name}`;
      } else {
        names.push(name);
      }
    }
    const seen = new Set();
    return names.filter((n) => {
      const k = n.toLowerCase();
      if (!n || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }


  /** Re-derive authors from the creator field, keeping signed flags by case-insensitive name. */
  function syncAuthorsFromCreator() {
    const names = parseCreatorNames(els.fieldCreator.value);
    const prev = new Map(formAuthors.map((a) => [a.name.toLowerCase(), a.signed]));
    const carryBare = formSignedNoAuthor && !formAuthors.length && names.length === 1;
    formAuthors = names.map((name) => ({
      name,
      signed: prev.get(name.toLowerCase()) === true || carryBare,
    }));
    if (formAuthors.length) formSignedNoAuthor = false;
    renderSignedUi();
  }

  function renderSignedUi() {
    if (!els.signedRow) return;
    const isBook = els.fieldType.value === "book";
    els.signedRow.hidden = !isBook;
    if (!isBook) return;
    const multi = formAuthors.length > 1;
    els.signedSingle.hidden = multi;
    els.signedMulti.hidden = !multi;
    if (!multi) {
      els.fieldSignedSingle.checked = formAuthors.length
        ? formAuthors[0].signed
        : formSignedNoAuthor;
      els.signedAuthors.innerHTML = "";
      return;
    }
    const on = formAuthors.filter((a) => a.signed).length;
    els.fieldSignedParent.checked = on > 0;
    els.fieldSignedParent.indeterminate = on > 0 && on < formAuthors.length;
    els.signedAuthors.innerHTML = formAuthors
      .map(
        (a, i) =>
          `<label class="check"><input type="checkbox" data-author-index="${i}"${a.signed ? " checked" : ""} /> <span>${escapeHtml(a.name)}</span></label>`
      )
      .join("");
  }

  function setAllAuthorsSigned(value) {
    formAuthors = formAuthors.map((a) => ({ ...a, signed: value }));
    renderSignedUi();
  }

  function onSignedParentChange() {
    const anyOn = formAuthors.some((a) => a.signed);
    if (els.fieldSignedParent.checked) {
      // Parent on with nobody ticked: tick every author (untick any who didn't sign).
      if (!anyOn) setAllAuthorsSigned(true);
      return;
    }
    if (!anyOn) return;
    // Unchecking the parent clears every author: confirm first (handoff §3.5).
    els.fieldSignedParent.checked = true;
    els.fieldSignedParent.indeterminate =
      formAuthors.some((a) => !a.signed);
    // PLACEHOLDER copy (Berean).
    openConfirm(
      "Clear signed authors?",
      "This unticks every author on this book.",
      () => {
        setAllAuthorsSigned(false);
        closeConfirm();
      },
      "Clear"
    );
  }

  function collectAuthors() {
    if (els.fieldType.value === "book") syncAuthorsFromCreator();
    const authors = formAuthors.map((a) => ({ ...a }));
    return {
      authors,
      signed: authors.length ? authors.some((a) => a.signed) : formSignedNoAuthor,
    };
  }

  function updateComponentsUi() {
    if (!els.componentsRow) return;
    const type = els.fieldType.value;
    const labels = COMPONENT_LABELS[type];
    const show = Boolean(labels) && els.fieldFormat.value === "physical";
    els.componentsRow.hidden = !show;
    if (labels) {
      [els.labelOwnsGame, els.labelOwnsCase, els.labelOwnsManual].forEach((el, i) => {
        if (el) el.textContent = labels[i];
      });
    }
  }

  /**
   * @param {object|null} item  values to show (null = empty Add form)
   * @param {object} [snapshot] merge base for the edit, if different from `item` (the
   *   duplicate prompt opens the existing item pre-filled with incoming values)
   */
  function openModal(item, snapshot) {
    if (els.modal.hidden) lastFocus = document.activeElement;
    editingId = item ? item.id : null;
    editingSnapshot = snapshot
      ? JSON.parse(JSON.stringify(snapshot))
      : item
        ? JSON.parse(JSON.stringify(item))
        : null;
    dupAcceptedSeparateId = null;
    els.modalTitle.textContent = item ? "Edit item" : "Add item";
    els.btnDelete.hidden = !item;
    els.fieldId.value = item ? item.id : "";
    els.fieldType.value = item ? item.type : "book";
    updateFormatOptions();
    updateCoverFrame();
    els.fieldBarcode.value = item ? item.barcode || "" : "";
    els.fieldTitle.value = item ? item.title : "";
    els.fieldCreator.value = item ? item.creator : "";
    formAuthors = item && Array.isArray(item.authors) ? item.authors.map((a) => ({ ...a })) : [];
    formSignedNoAuthor = Boolean(item && !formAuthors.length && item.signed);
    if (els.fieldType.value === "book") syncAuthorsFromCreator();
    else renderSignedUi();
    els.fieldYear.value = item && item.year != null ? item.year : "";
    els.fieldStatus.value = item ? item.status : "want";
    els.fieldFormat.value = item ? item.format : els.fieldFormat.value;
    updateDiscVisibility();
    els.fieldDisc.value =
      item && item.disc ? item.disc : els.fieldType.value === "movie" ? "blu-ray" : "";
    setComponentState(item || {});
    els.fieldPlatform.value = item ? item.platform || "" : "";
    els.fieldRating.value =
      item && item.rating != null ? String(item.rating) : "";
    els.fieldProgress.value = item ? item.progress || "" : "";
    els.fieldTags.value = item ? (item.tags || []).join(", ") : "";
    els.fieldNotes.value = item ? item.notes || "" : "";
    els.fieldCover.value = item ? item.coverUrl || "" : "";
    els.fieldCoverSource.value = item ? item.coverSource || "" : "";
    els.fieldGbUrl.value = item ? item.googleBooksUrl || "" : "";
    lookupYearLoose = false;
    setLookupStatus("");
    updateCoverPreview();
    updateReferenceLinks();
    if (els.apiKeyHint) els.apiKeyHint.hidden = true;

    els.modal.hidden = false;
    els.modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    requestAnimationFrame(() => els.fieldTitle.focus());
  }

  function closeModal() {
    stopScanner();
    closeScanModal(true);
    els.modal.hidden = true;
    els.modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    editingId = null;
    editingSnapshot = null;
    setLookupStatus("");
    if (lastFocus && typeof lastFocus.focus === "function") {
      lastFocus.focus();
    }
  }

  /**
   * @param {string} title
   * @param {string} desc
   * @param {() => void} onOk
   * @param {string} [okLabel]
   * @param {{ altLabel?: string, onAlt?: () => void, focusAlt?: boolean,
   *   okClass?: string, altClass?: string, wide?: boolean,
   *   detailHtml?: string, optionLabel?: string }} [opts]
   *   Optional second action (e.g. Merge next to Replace). v1.2 duplicate prompt adds
   *   button styles, an Existing/Incoming detail block (pre-escaped HTML) and one option
   *   checkbox; all reset on close so the delete / restore dialogs look as before.
   */
  function openConfirm(title, desc, onOk, okLabel, opts = {}) {
    dismissPlainToast();
    confirmReturnFocus = document.activeElement;
    $("#confirm-title").textContent = title;
    $("#confirm-desc").textContent = desc;
    els.confirmOk.textContent = okLabel || "OK";
    els.confirmOk.className = `btn ${opts.okClass || "btn-danger"}`;
    els.confirmAlt.className = `btn ${opts.altClass || "btn-primary"}`;
    if (els.confirmPanel) els.confirmPanel.classList.toggle("is-wide", Boolean(opts.wide));
    if (els.confirmDetail) {
      els.confirmDetail.innerHTML = opts.detailHtml || "";
      els.confirmDetail.hidden = !opts.detailHtml;
    }
    if (els.confirmOptionRow) {
      els.confirmOption.checked = false;
      els.confirmOptionLabel.textContent = opts.optionLabel || "";
      els.confirmOptionRow.hidden = !opts.optionLabel;
    }
    confirmCallback = onOk;
    if (opts.altLabel && typeof opts.onAlt === "function") {
      els.confirmAlt.textContent = opts.altLabel;
      els.confirmAlt.hidden = false;
      confirmAltCallback = opts.onAlt;
    } else {
      els.confirmAlt.hidden = true;
      confirmAltCallback = null;
    }
    // Wide (duplicate) prompt: suggested choice last in DOM and on screen, so Tab order
    // matches what you see.
    const actions = els.confirmOk.parentNode;
    const cancelBtn = $("#confirm-cancel");
    if (opts.wide && opts.focusAlt) actions.append(cancelBtn, els.confirmOk, els.confirmAlt);
    else if (opts.wide) actions.append(cancelBtn, els.confirmAlt, els.confirmOk);
    else actions.append(cancelBtn, els.confirmOk, els.confirmAlt);
    els.confirm.hidden = false;
    els.confirm.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    (opts.focusAlt && !els.confirmAlt.hidden ? els.confirmAlt : els.confirmOk).focus();
  }

  function closeConfirm() {
    els.confirm.hidden = true;
    els.confirm.setAttribute("aria-hidden", "true");
    confirmCallback = null;
    confirmAltCallback = null;
    els.confirmAlt.hidden = true;
    els.confirmOk.className = "btn btn-danger";
    els.confirmAlt.className = "btn btn-primary";
    if (els.confirmPanel) els.confirmPanel.classList.remove("is-wide");
    if (els.confirmDetail) {
      els.confirmDetail.hidden = true;
      els.confirmDetail.innerHTML = "";
    }
    if (els.confirmOptionRow) els.confirmOptionRow.hidden = true;
    if (
      els.modal.hidden &&
      els.scanModal.hidden &&
      (!els.settingsModal || els.settingsModal.hidden)
    ) {
      document.body.classList.remove("modal-open");
    }
    const back = confirmReturnFocus;
    confirmReturnFocus = null;
    if (back && back.isConnected && typeof back.focus === "function" && back.offsetParent) {
      back.focus();
    }
  }

  /** Toast; optional one action button (e.g. Undo) and a longer duration for it. */
  /** Oholiab F1: a dialog opening clears a leftover plain toast (it sat on the dialog title
   *  while a sheet is open). Toasts with an action (Undo) keep their own timer. */
  function dismissPlainToast() {
    if (els.toast.hidden || els.toast.querySelector(".toast-action")) return;
    clearTimeout(toastTimer);
    els.toast.hidden = true;
  }

  function showToast(msg, opts = {}) {
    els.toast.textContent = "";
    const text = document.createElement("span");
    text.textContent = msg;
    els.toast.appendChild(text);
    els.toast.classList.toggle("has-action", Boolean(opts.actionLabel));
    if (opts.actionLabel && typeof opts.onAction === "function") {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-ghost btn-sm toast-action";
      btn.textContent = opts.actionLabel;
      btn.addEventListener("click", () => {
        els.toast.hidden = true;
        opts.onAction();
      });
      els.toast.appendChild(btn);
    }
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.hidden = true;
    }, opts.duration || 2600);
  }

  function collectForm() {
    const type = els.fieldType.value;
    let format = els.fieldFormat.value;
    if (type === "book") {
      if (!["physical", "digital", "audiobook"].includes(format)) format = "physical";
    } else {
      if (format === "audiobook") format = "digital";
      if (!["physical", "digital"].includes(format)) format = "digital";
    }
    let disc = null;
    if (format === "physical" && DISC_OPTIONS[type]) {
      disc = els.fieldDisc.value;
      if (!DISC_OPTIONS[type].includes(disc)) disc = type === "movie" ? "blu-ray" : null;
    }
    const ratingRaw = els.fieldRating.value;
    const yearRaw = els.fieldYear.value.trim();
    return {
      id: els.fieldId.value || uid(),
      type,
      title: els.fieldTitle.value.trim(),
      creator: els.fieldCreator.value.trim(),
      year: yearRaw === "" ? null : Number(yearRaw),
      status: els.fieldStatus.value,
      rating: ratingRaw === "" ? null : Number(ratingRaw),
      format,
      disc,
      notes: els.fieldNotes.value.trim(),
      tags: els.fieldTags.value
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      progress: els.fieldProgress.value.trim(),
      barcode: els.fieldBarcode.value.trim(),
      coverUrl: els.fieldCover.value.trim(),
      coverSource: els.fieldCoverSource.value.trim(),
      googleBooksUrl: type === "book" ? safeGoogleBooksUrl(els.fieldGbUrl.value) : "",
      platform: type === "game" ? normalizePlatform(els.fieldPlatform.value) : "",
      // Kept even while the trio is hidden (digital / book), so switching format never
      // silently clears what the user ticked.
      ownsGame: componentState.ownsGame,
      ownsCase: componentState.ownsCase,
      ownsManual: componentState.ownsManual,
      ...collectAuthors(),
      seed: false,
    };
  }

  function saveItem(e) {
    e.preventDefault();
    const data = collectForm();
    if (!data.title) {
      els.fieldTitle.focus();
      showToast("Title is required");
      return;
    }
    if (data.type === "movie" && data.format === "physical" && !data.disc) {
      els.fieldDisc.focus();
      showToast("Choose a disc format");
      return;
    }
    if (!editingId) {
      if (syncFromStorage()) render(); // a copy added in another tab counts too
      const dup = findDuplicate(withLookupYearRule(data), null);
      if (dup && dup.item.id !== dupAcceptedSeparateId) {
        openDuplicatePrompt(data, dup, "save");
        return;
      }
    }
    const ts = nowIso();
    if (editingId) {
      const id = editingId;
      const snapshot = editingSnapshot;
      commitItems((list) => {
        const idx = list.findIndex((i) => i.id === id);
        list.splice(idx >= 0 ? idx : 0, idx >= 0 ? 1 : 0, mergeEditOntoFresh(snapshot, list[idx], data, ts));
      });
      showToast("Updated");
    } else {
      commitItems((list) => {
        list.unshift(
          normalizeItem({
            ...data,
            dateAdded: ts,
            dateUpdated: ts,
          })
        );
      });
      showToast("Added");
    }
    closeModal();
    render();
  }

  const MERGE_SKIP_KEYS = new Set(["id", "dateAdded", "dateUpdated", "seed"]);

  /**
   * Two-tab merge for an edit: apply only the fields this form actually changed (form vs
   * the item as it was when the form opened) onto the freshest stored copy. If another tab
   * edited other fields of the same item, those edits survive. If another tab deleted the
   * item, the edit is kept (re-added) rather than lost.
   */
  function mergeEditOntoFresh(snapshot, fresh, data, ts) {
    const base = snapshot || fresh || {};
    const formItem = normalizeItem({ ...base, ...data, id: base.id || data.id });
    if (!fresh) {
      return normalizeItem({ ...formItem, dateAdded: base.dateAdded || ts, dateUpdated: ts, seed: false });
    }
    const changed = {};
    const baseNorm = snapshot ? normalizeItem(snapshot) : normalizeItem(fresh);
    for (const k of Object.keys(formItem)) {
      if (MERGE_SKIP_KEYS.has(k)) continue;
      if (JSON.stringify(formItem[k]) !== JSON.stringify(baseNorm[k])) changed[k] = formItem[k];
    }
    return normalizeItem({
      ...fresh,
      ...changed,
      id: fresh.id,
      dateAdded: fresh.dateAdded,
      dateUpdated: ts,
      seed: false,
    });
  }

  function deleteCurrent() {
    if (!editingId) return;
    const id = editingId;
    openConfirm(
      "Delete item?",
      "This cannot be undone.",
      () => {
        commitItems((list) => list.filter((i) => i.id !== id));
        closeConfirm();
        closeModal();
        showToast("Deleted");
        render();
      },
      "Delete"
    );
  }

  function clearSeeds() {
    openConfirm(
      "Clear sample items?",
      "Removes seeded examples. Your own items stay.",
      () => {
        commitItems((list) => list.filter((i) => !i.seed));
        closeConfirm();
        showToast("Samples cleared");
        render();
      },
      "Clear"
    );
  }

  function matchesSearch(item, q) {
    if (!q) return true;
    const hay = [
      item.title,
      item.creator,
      item.notes,
      item.barcode || "",
      ...(item.tags || []),
      FORMAT_LABELS[item.format] || "",
      item.disc ? DISC_LABELS[item.disc] || item.disc : "",
      item.platform ? PLATFORM_LABELS[item.platform] || item.platform : "",
      item.signed ? "signed" : "",
      item.progress || "",
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  }

  function filteredItems() {
    let list = items.slice();
    if (filterType !== "all") {
      list = list.filter((i) => i.type === filterType);
    }
    if (filterStatus !== "all") {
      list = list.filter((i) => i.status === filterStatus);
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) list = list.filter((i) => matchesSearch(i, q));

    list.sort((a, b) => {
      if (sortMode === "title") {
        return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
      }
      if (sortMode === "rating") {
        const ra = a.rating == null ? -1 : a.rating;
        const rb = b.rating == null ? -1 : b.rating;
        if (rb !== ra) return rb - ra;
        return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
      }
      return String(b.dateUpdated).localeCompare(String(a.dateUpdated));
    });
    return list;
  }

  function renderStats() {
    const byType = { book: 0, game: 0, movie: 0, music: 0 };
    const byStatus = { want: 0, in_progress: 0, done: 0, dropped: 0 };
    for (const i of items) {
      byType[i.type] = (byType[i.type] || 0) + 1;
      byStatus[i.status] = (byStatus[i.status] || 0) + 1;
    }
    const pill = (cls, n, key) =>
      `<span class="stat-pill${cls ? ` ${cls}` : ""}"><strong>${n}</strong> ${countNoun(n, key)}</span>`;
    els.stats.innerHTML = [
      pill("book", byType.book, "book"),
      pill("game", byType.game, "game"),
      pill("movie", byType.movie, "movie"),
      pill("music", byType.music, "music"),
      pill("", byStatus.want, "want"),
      pill("", byStatus.in_progress, "in_progress"),
      pill("", byStatus.done, "done"),
    ].join("");
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function coverMarkup(item) {
    const label = escapeHtml(TYPE_LABELS[item.type] || item.type);
    const type = escapeHtml(item.type);
    const url = (item.coverUrl || "").trim();
    // The column keeps the 2:3 height for every type, so mixed lists line up; music
    // covers (square album art) sit top-aligned in it as a 1:1 frame.
    const col = (inner) => `<div class="item-cover-col" data-type="${type}">${inner}</div>`;
    if (!url) {
      return col(`<div class="item-cover-placeholder ${type}" aria-hidden="true">${label}</div>`);
    }
    return col(
      `<img class="item-cover" src="${escapeHtml(url)}" alt="" loading="lazy" decoding="async" onerror="this.style.display='none';var p=this.nextElementSibling;if(p)p.hidden=false;" /><div class="item-cover-placeholder ${type}" hidden aria-hidden="true">${label}</div>`
    );
  }

  function renderList() {
    const list = filteredItems();
    const hasSeeds = items.some((i) => i.seed);
    els.seedBanner.hidden = !hasSeeds;

    if (list.length === 0) {
      els.list.innerHTML = "";
      els.empty.hidden = false;
      const totalFilteredOut = items.length > 0;
      $(".empty-title", els.empty).textContent = totalFilteredOut
        ? "No matches"
        : "Nothing on this shelf yet";
      $(".empty-hint", els.empty).textContent = totalFilteredOut
        ? "Try a different filter or search."
        : "Add a book, game, movie, or album to get started."; // PLACEHOLDER (Berean)
      $("#btn-empty-add").hidden = totalFilteredOut;
      return;
    }

    els.empty.hidden = true;
    els.list.innerHTML = list
      .map((item) => {
        const starStr = stars(item.rating);
        const tags = (item.tags || [])
          .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
          .join("");
        const year = item.year != null ? ` · ${item.year}` : "";
        const progress = item.progress
          ? `<span class="progress">${escapeHtml(item.progress)}</span>`
          : "";
        const notes = item.notes
          ? `<p class="item-notes">${escapeHtml(item.notes)}</p>`
          : "";
        const cardRefs = [];
        if (item.type === "movie" || item.type === "game") {
          const imdb = buildImdbUrl(item.title, item.year);
          if (imdb) {
            cardRefs.push(
              `<a class="card-ref" href="${escapeHtml(imdb)}" target="_blank" rel="noopener noreferrer">IMDb</a>`
            );
          }
        }
        if (item.type === "book") {
          const isfdb = buildIsfdbUrl(item.title);
          if (isfdb) {
            cardRefs.push(
              `<a class="card-ref" href="${escapeHtml(isfdb)}" target="_blank" rel="noopener noreferrer">ISFDB</a>`
            );
          }
        }
        if (item.type === "game") {
          const rawg = buildRawgSearchUrl(item.title);
          const igdb = buildIgdbUrl(item.title);
          if (rawg) {
            cardRefs.push(
              `<a class="card-ref" href="${escapeHtml(rawg)}" target="_blank" rel="noopener noreferrer">RAWG</a>`
            );
          }
          if (igdb) {
            cardRefs.push(
              `<a class="card-ref" href="${escapeHtml(igdb)}" target="_blank" rel="noopener noreferrer">IGDB</a>`
            );
          }
        }
        const refsHtml = cardRefs.length
          ? `<div class="card-refs">${cardRefs.join("")}</div>`
          : "";
        // Google Books credit (Oholiab F2): only for a Google Books cover with a safe link.
        const gbUrl = item.coverSource === "googlebooks" ? safeGoogleBooksUrl(item.googleBooksUrl) : "";
        const creditHtml = gbUrl
          ? `<p class="card-credit"><a class="card-credit-link" href="${escapeHtml(gbUrl)}" target="_blank" rel="noopener noreferrer"><span class="card-credit-text">Cover from Google Books</span></a></p>`
          : "";
        return `
<li>
  <article class="item-card" tabindex="0" data-id="${escapeHtml(item.id)}" role="button" aria-label="Edit ${escapeHtml(item.title)}">
    ${coverMarkup(item)}
    <div class="item-body">
      <div class="item-top">
        <div>
          <h3 class="item-title">${escapeHtml(item.title)}</h3>
          <p class="item-meta">${escapeHtml(item.creator || "—")}${year}</p>
        </div>
        <div class="item-badges">
          <span class="badge badge-type ${item.type}">${TYPE_LABELS[item.type]}</span>
          <span class="badge badge-status ${item.status}">${STATUS_LABELS[item.status]}</span>
          <span class="badge badge-format">${escapeHtml(formatBadgeText(item))}</span>
        </div>
      </div>
      ${notes}
      <div class="item-bottom">
        ${starStr ? `<span class="stars" aria-label="Rating ${item.rating} of 5">${starStr}</span>` : ""}
        ${progress}
        ${tags ? `<span class="tags">${tags}</span>` : ""}
        ${refsHtml}
      </div>
      ${creditHtml}
    </div>
  </article>
</li>`;
      })
      .join("");
  }

  function render() {
    renderStats();
    renderList();
    updateBackupUi();
  }

  /* ---------- Reference links (restored; dropped in 4d252ca) ---------- */
  function buildImdbUrl(title, year) {
    const q = String(title || "").trim();
    if (!q) return "";
    let term = q;
    if (year) term = `${q} ${year}`;
    return `https://www.imdb.com/find/?q=${encodeURIComponent(term)}`;
  }

  function buildIsfdbUrl(title) {
    const q = String(title || "").trim();
    if (!q) return "";
    return (
      `https://www.isfdb.org/cgi-bin/se.cgi?arg=${encodeURIComponent(q)}` +
      `&type=Fiction+Titles`
    );
  }

  function buildRawgSearchUrl(title) {
    const q = String(title || "").trim();
    if (!q) return "";
    return `https://rawg.io/search?query=${encodeURIComponent(q)}`;
  }

  function buildIgdbUrl(title) {
    const q = String(title || "").trim();
    if (!q) return "";
    return `https://www.igdb.com/search?type=games&q=${encodeURIComponent(q)}`;
  }

  function setRefLink(el, url) {
    if (!el) return;
    if (url) {
      el.href = url;
      el.hidden = false;
    } else {
      el.removeAttribute("href");
      el.hidden = true;
    }
  }

  function updateReferenceLinks() {
    const type = els.fieldType.value;
    const title = els.fieldTitle.value.trim();
    const year = els.fieldYear.value.trim();
    const imdb = type === "movie" || type === "game" ? buildImdbUrl(title, year) : "";
    const isfdb = type === "book" ? buildIsfdbUrl(title) : "";
    const rawg = type === "game" ? buildRawgSearchUrl(title) : "";
    const igdb = type === "game" ? buildIgdbUrl(title) : "";
    setRefLink(els.refImdb, imdb);
    setRefLink(els.refIsfdb, isfdb);
    setRefLink(els.refRawg, rawg);
    setRefLink(els.refIgdb, igdb);
    // Hide the whole Reference row (label + hint) until at least one live link applies.
    if (els.refLinksRow) els.refLinksRow.hidden = !(imdb || isfdb || rawg || igdb);
  }

  /* ---------- Backup / restore (iCloud via share sheet) ---------- */

  function readLs(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function writeLs(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage full / private mode */
    }
  }

  function parseTime(iso) {
    const t = Date.parse(String(iso || ""));
    return Number.isFinite(t) ? t : 0;
  }

  function localDateStamp(d = new Date()) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function formatBackupDate(iso) {
    const t = parseTime(iso);
    if (!t) return "";
    return new Date(t).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  /** Library snapshot for backup/export. Never includes API keys. */
  function buildBackupPayload() {
    return {
      app: BACKUP_APP_ID,
      version: BACKUP_VERSION,
      exportedAt: nowIso(),
      items: items.map((i) => ({ ...i })),
    };
  }

  // Filenames are for people only; Restore reads the file's contents, never its name.
  function backupFileName() {
    return `freerangemedia-backup-${localDateStamp()}.json`;
  }

  function exportFileName() {
    return `freerangemedia-export-${localDateStamp()}.json`;
  }

  function backupJsonText() {
    return JSON.stringify(buildBackupPayload(), null, 2);
  }

  function downloadText(text, filename, type = "application/json") {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Safari needs the URL alive briefly after click.
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function markBackedUp() {
    writeLs(LAST_BACKUP_STORAGE, nowIso());
    updateBackupUi();
  }

  function exportJson() {
    if (!items.length) {
      showToast("Nothing to export yet");
      return;
    }
    downloadText(backupJsonText(), exportFileName());
    markBackedUp();
    showToast("Exported");
  }

  /** Pick a File the platform says it can share (iOS Safari: application/json). */
  function shareableBackupFile(text, filename) {
    if (typeof File !== "function" || !navigator.canShare) return null;
    for (const type of ["application/json", "text/plain"]) {
      try {
        const file = new File([text], filename, { type });
        if (navigator.canShare({ files: [file] })) return file;
      } catch {
        /* try next type */
      }
    }
    return null;
  }

  /**
   * Must be called synchronously from a click handler: navigator.share()
   * requires a fresh user gesture (iOS shows the share sheet → Save to Files).
   */
  function backupToICloud() {
    if (!items.length) {
      showToast("Nothing to back up yet");
      return;
    }
    const text = backupJsonText();
    const filename = backupFileName();
    const file = shareableBackupFile(text, filename);
    if (file && typeof navigator.share === "function") {
      navigator
        .share({ files: [file], title: "FreeRangeMedia backup" })
        .then(() => {
          // Web Share can't tell us where the file went, so record "file created", not "saved".
          markBackedUp();
          showToast("Backup file shared. Check it’s in iCloud Drive or Files.");
        })
        .catch((err) => {
          if (err && err.name === "AbortError") return; // user cancelled
          try {
            downloadText(text, filename);
            markBackedUp();
            showToast("Share sheet unavailable — backup downloaded instead");
          } catch {
            showToast("Backup failed — try Export instead");
          }
        });
      return;
    }
    try {
      downloadText(text, filename);
      markBackedUp();
      showToast("Backup downloaded — move it to iCloud Drive or another safe place.");
    } catch {
      showToast("Backup failed — try Export instead");
    }
  }

  function backupReminderDue() {
    const ownItems = items.filter((i) => !i.seed);
    if (!ownItems.length) return false;
    const now = Date.now();
    const last = parseTime(readLs(LAST_BACKUP_STORAGE));
    if (last && now - last < BACKUP_STALE_DAYS * DAY_MS) return false;
    if (!last) {
      // Never backed up: 14-day grace from the first own item (no reminder on day one).
      const firstOwn = Math.min(...ownItems.map((i) => parseTime(i.dateAdded) || now));
      if (now - firstOwn < BACKUP_STALE_DAYS * DAY_MS) return false;
    }
    const dismissed = parseTime(readLs(BACKUP_REMINDER_DISMISSED_STORAGE));
    if (dismissed && now - dismissed < BACKUP_SNOOZE_DAYS * DAY_MS) return false;
    return true;
  }

  function dismissBackupReminder() {
    writeLs(BACKUP_REMINDER_DISMISSED_STORAGE, nowIso());
    updateBackupUi();
    showToast("OK — we’ll remind you again in a week");
  }

  function updateBackupUi() {
    const lastIso = readLs(LAST_BACKUP_STORAGE);
    const label = formatBackupDate(lastIso);
    const fresh = label && Date.now() - parseTime(lastIso) < BACKUP_STALE_DAYS * DAY_MS;
    if (els.backupLast) {
      els.backupLast.textContent = `Last backup file created: ${label || "Never"}`;
    }
    if (els.backupStatus) {
      els.backupStatus.textContent = label ? (fresh ? "Recent" : "Due") : "Never";
      els.backupStatus.dataset.status = fresh ? "set" : "unset";
    }
    if (els.backupBanner) {
      // Never alongside the "new version" banner: Reload wins.
      const due = backupReminderDue() && !updateBannerShown();
      els.backupBanner.hidden = !due;
      if (due) {
        $("#backup-banner-text").textContent = label
          ? `Last backup file: ${label}. Back up again to keep your copy current.`
          : "You haven’t backed up this library yet. Back up to keep a copy outside this browser.";
      }
    }
  }

  /**
   * Parse + validate an Export / Backup file. Accepts:
   *  - v1.2 backup/export: { app: "freerangemedia", version: 2, exportedAt, items: [...] }
   *  - Media Shelf backup: { app: "media-shelf", version: 1, exportedAt, items: [...] }
   *  - older Export: { version: 1, exportedAt, app: "Media Shelf", items: [...] }
   *  - plain array of items (read only; we never write one — see BACKUP_APP_ID)
   * @returns {{ items: object[], exportedAt: string }}
   */
  function parseBackupText(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("That file isn’t valid JSON.");
    }
    let arr;
    let exportedAt = "";
    if (Array.isArray(data)) {
      arr = data;
    } else if (data && typeof data === "object") {
      const app = String(data.app || "").trim();
      if (app && !LEGACY_BACKUP_APP_RE.test(app) && !BACKUP_APP_RE.test(app)) {
        throw new Error("That file isn’t a FreeRangeMedia backup.");
      }
      if (BACKUP_APP_RE.test(app) && Number(data.version) > BACKUP_VERSION) {
        // Copy from Berean's Pass 1 review.
        throw new Error("That backup was made by a newer version of FreeRangeMedia. Close and reopen the app to get the latest version, then try again.");
      }
      arr = data.items;
      exportedAt = data.exportedAt || data.savedAt || "";
    }
    if (!Array.isArray(arr)) throw new Error("No items found in that file.");
    const valid = arr.filter(
      (r) => r && typeof r === "object" && !Array.isArray(r) && (r.title || r.type)
    );
    if (arr.length && !valid.length) {
      throw new Error("That file doesn’t contain FreeRangeMedia items.");
    }
    // Normalize and de-dupe by id inside the file (newer dateUpdated wins).
    const byId = new Map();
    valid.map(normalizeItem).forEach((it) => {
      const prev = byId.get(it.id);
      if (!prev || parseTime(it.dateUpdated) > parseTime(prev.dateUpdated)) byId.set(it.id, it);
    });
    return { items: [...byId.values()], exportedAt };
  }

  /** Merge: add unknown ids; for shared ids keep the newer dateUpdated. */
  function mergeItems(current, incoming) {
    const out = current.slice();
    const index = new Map(out.map((it, i) => [it.id, i]));
    let added = 0;
    let updated = 0;
    incoming.forEach((it) => {
      if (!index.has(it.id)) {
        index.set(it.id, out.length);
        out.push(it);
        added += 1;
        return;
      }
      const i = index.get(it.id);
      if (parseTime(it.dateUpdated) > parseTime(out[i].dateUpdated)) {
        out[i] = it;
        updated += 1;
      }
    });
    return { items: out, added, updated };
  }

  /** Shared by header Import and Settings → Restore from iCloud. */
  function importJson(file) {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      showToast("That file is too large to be a FreeRangeMedia backup");
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => showToast("Couldn’t read that file — try again");
    reader.onload = () => {
      let parsed;
      try {
        parsed = parseBackupText(String(reader.result));
      } catch (err) {
        showToast(`Restore failed — ${err && err.message ? err.message : "invalid file"}`);
        return;
      }
      const incoming = parsed.items;
      if (!incoming.length) {
        showToast("That backup has no items — nothing to restore");
        return;
      }
      const when = formatBackupDate(parsed.exportedAt);
      const n = incoming.length;
      const fromLine = `This backup has ${countLabel(n, "item")}${when ? ` (created ${when})` : ""}.`;
      const hasCurrent = items.length > 0;
      const desc = hasCurrent
        ? `${fromLine} Merge keeps your current ${countLabel(items.length, "item")} and adds anything new (the newer copy wins when both have the same item). Replace swaps your whole library for the backup.`
        : `${fromLine} Restore it to this browser?`;
      const doReplace = () => {
        commitItems(() => incoming.slice());
        closeConfirm();
        render();
        showToast(`Restored ${countLabel(items.length, "item")}`);
      };
      const doMerge = () => {
        let res = { added: 0, updated: 0 };
        commitItems((list) => {
          res = mergeItems(list, incoming);
          return res.items;
        });
        closeConfirm();
        render();
        showToast(
          res.added || res.updated
            ? `Merged — ${res.added} added, ${res.updated} updated`
            : "Merged — already up to date"
        );
      };
      if (hasCurrent) {
        openConfirm("Restore backup", desc, doReplace, "Replace", {
          altLabel: "Merge",
          onAlt: doMerge,
          focusAlt: true,
        });
      } else {
        openConfirm("Restore backup", desc, doReplace, "Restore");
      }
    };
    reader.readAsText(file);
  }

  function applyLookupFields(data, { overwrite } = { overwrite: false }) {
    const fill = (el, value) => {
      if (value == null || value === "") return false;
      const cur = el.value.trim();
      if (!cur || overwrite || (el === els.fieldTitle && !cur)) {
        el.value = String(value);
        return true;
      }
      return false;
    };

    if (!els.fieldTitle.value.trim() && data.title) {
      els.fieldTitle.value = data.title;
    } else if (overwrite && data.title) {
      els.fieldTitle.value = data.title;
    }

    fill(els.fieldCreator, data.creator);
    if (data.year != null && data.year !== "") {
      const cur = els.fieldYear.value.trim();
      if (!cur || overwrite) els.fieldYear.value = String(data.year);
    }

    if (data.coverUrl) {
      if (!els.fieldCover.value.trim() || overwrite) {
        els.fieldCover.value = data.coverUrl;
        els.fieldCoverSource.value = data.coverSource || "";
        updateCoverPreview();
      }
    }
    if (data.barcode && !els.fieldBarcode.value.trim()) {
      els.fieldBarcode.value = data.barcode;
    }
    if (els.fieldType.value === "music") lookupYearLoose = Boolean(data._yearUncertain);
    if (data.googleBooksUrl && els.fieldType.value === "book") {
      els.fieldGbUrl.value = data.googleBooksUrl;
    }
    updateGoogleBooksAttr();
    // Lookup can change the creator string: re-derive authors (flags kept by name).
    if (els.fieldType.value === "book") syncAuthorsFromCreator();
  }

  function wouldOverwrite(data) {
    const checks = [];
    if (data.title && els.fieldTitle.value.trim() && els.fieldTitle.value.trim() !== data.title) {
      checks.push("title");
    }
    if (data.creator && els.fieldCreator.value.trim() && els.fieldCreator.value.trim() !== data.creator) {
      checks.push("creator");
    }
    if (
      data.year != null &&
      els.fieldYear.value.trim() &&
      String(els.fieldYear.value.trim()) !== String(data.year)
    ) {
      checks.push("year");
    }
    if (data.coverUrl && els.fieldCover.value.trim() && els.fieldCover.value.trim() !== data.coverUrl) {
      checks.push("cover");
    }
    return checks.length > 0;
  }

  function commitLookup(data, okMsg, kind = "ok") {
    const applyEmpty = () => applyLookupFields(data, { overwrite: false });
    applyEmpty();
    if (wouldOverwrite(data)) {
      openConfirm(
        "Overwrite filled fields?",
        "Lookup found details that differ from what’s already in the form. Overwrite title, creator, year, and cover?",
        () => {
          applyLookupFields(data, { overwrite: true });
          closeConfirm();
          setLookupStatus(okMsg || "Details updated.", kind);
          checkDuplicateFromForm();
        },
        "Overwrite"
      );
      setLookupStatus("Found a match — empty fields filled. Confirm to overwrite the rest.", "ok");
    } else {
      setLookupStatus(okMsg || "Details filled.", kind);
      checkDuplicateFromForm();
    }
  }

  const COVER_SOURCE_LABELS = {
    openlibrary: "Open Library",
    googlebooks: "Google Books",
    wikipedia: "Wikipedia",
    omdb: "OMDb",
    rawg: "RAWG",
    musicbrainz: "MusicBrainz",
    coverartarchive: "Cover Art Archive",
    manual: "manual",
  };

  function sourceLabel(slug) {
    return COVER_SOURCE_LABELS[slug] || slug || "unknown";
  }

  function isGoodLookupMatch(data) {
    if (!data) return false;
    if (data.coverUrl) return true;
    if (data.title && data.creator) return true;
    return false;
  }

  function lookupHasUsefulFields(data) {
    return Boolean(data && (data.coverUrl || data.title || data.creator || data.year != null));
  }

  /**
   * Google Books cover: the API's own image link, only upgraded to https. Forcing zoom=0 (as
   * before) often returned Google's "image not available" placeholder, and the Google Books
   * branding rules say results must not be altered.
   */
  function upgradeGoogleBooksImage(url) {
    if (!url) return "";
    return String(url).replace(/^http:\/\//i, "https://");
  }

  function getOmdbKey() {
    try {
      return String(localStorage.getItem(OMDB_KEY_STORAGE) || "").trim();
    } catch {
      return "";
    }
  }

  function getRawgKey() {
    try {
      return String(localStorage.getItem(RAWG_KEY_STORAGE) || "").trim();
    } catch {
      return "";
    }
  }

  function setOmdbKey(value) {
    try {
      const v = String(value || "").trim();
      if (v) localStorage.setItem(OMDB_KEY_STORAGE, v);
      else localStorage.removeItem(OMDB_KEY_STORAGE);
    } catch {
      /* quota / private mode */
    }
  }

  function setRawgKey(value) {
    try {
      const v = String(value || "").trim();
      if (v) localStorage.setItem(RAWG_KEY_STORAGE, v);
      else localStorage.removeItem(RAWG_KEY_STORAGE);
    } catch {
      /* quota / private mode */
    }
  }

  function maskApiKey(key) {
    const k = String(key || "").trim();
    if (!k) return "";
    const last = k.slice(-4);
    return `••••${last}`;
  }

  function refreshApiKeyStatuses() {
    const omdb = getOmdbKey();
    const rawg = getRawgKey();
    if (els.omdbKeyStatus) {
      if (omdb) {
        els.omdbKeyStatus.textContent = `Key saved ${maskApiKey(omdb)}`;
        els.omdbKeyStatus.dataset.status = "set";
      } else {
        els.omdbKeyStatus.textContent = "Not set";
        els.omdbKeyStatus.dataset.status = "unset";
      }
    }
    if (els.rawgKeyStatus) {
      if (rawg) {
        els.rawgKeyStatus.textContent = `Key saved ${maskApiKey(rawg)}`;
        els.rawgKeyStatus.dataset.status = "set";
      } else {
        els.rawgKeyStatus.textContent = "Not set";
        els.rawgKeyStatus.dataset.status = "unset";
      }
    }
  }

  function setKeyVisibility(provider, show) {
    const input = provider === "omdb" ? els.fieldOmdbKey : els.fieldRawgKey;
    const btn = $(provider === "omdb" ? "#btn-toggle-omdb" : "#btn-toggle-rawg");
    if (!input || !btn) return;
    input.type = show ? "text" : "password";
    btn.textContent = show ? "Hide" : "Show";
    btn.setAttribute("aria-pressed", show ? "true" : "false");
  }

  function clearTestStatus(provider) {
    const el = provider === "omdb" ? els.omdbTestStatus : els.rawgTestStatus;
    if (!el) return;
    el.hidden = true;
    el.textContent = "";
    el.classList.remove("is-ok", "is-fail");
  }

  function showTestStatus(provider, ok, message) {
    const el = provider === "omdb" ? els.omdbTestStatus : els.rawgTestStatus;
    if (!el) return;
    el.hidden = false;
    el.textContent = message;
    el.classList.toggle("is-ok", !!ok);
    el.classList.toggle("is-fail", !ok);
  }

  function focusApiCard(provider) {
    const card =
      provider === "rawg"
        ? els.apiCardRawg
        : provider === "omdb"
          ? els.apiCardOmdb
          : null;
    [els.apiCardOmdb, els.apiCardRawg].forEach((c) => {
      if (c) c.classList.remove("is-focus");
    });
    if (!card) return;
    card.classList.add("is-focus");
    card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const input = provider === "rawg" ? els.fieldRawgKey : els.fieldOmdbKey;
    requestAnimationFrame(() => {
      if (input) input.focus();
      else card.focus();
    });
  }

  function openSettingsModal(focusProvider) {
    if (!els.settingsModal) return;
    els.fieldOmdbKey.value = getOmdbKey();
    els.fieldRawgKey.value = getRawgKey();
    setKeyVisibility("omdb", false);
    setKeyVisibility("rawg", false);
    clearTestStatus("omdb");
    clearTestStatus("rawg");
    refreshApiKeyStatuses();
    els.settingsModal.hidden = false;
    els.settingsModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    updateBackupUi();
    if (focusProvider === "omdb" || focusProvider === "rawg") {
      focusApiCard(focusProvider);
    } else {
      [els.apiCardOmdb, els.apiCardRawg].forEach((c) => {
        if (c) c.classList.remove("is-focus");
      });
      requestAnimationFrame(() => {
        const first = $("#btn-backup-settings");
        if (first) first.focus();
        else if (els.fieldOmdbKey) els.fieldOmdbKey.focus();
      });
    }
  }

  function closeSettingsModal() {
    if (!els.settingsModal) return;
    els.settingsModal.hidden = true;
    els.settingsModal.setAttribute("aria-hidden", "true");
    [els.apiCardOmdb, els.apiCardRawg].forEach((c) => {
      if (c) c.classList.remove("is-focus");
    });
    if (els.modal.hidden && els.scanModal.hidden && els.confirm.hidden) {
      document.body.classList.remove("modal-open");
    }
    updateApiKeyHint();
  }

  function saveProviderKey(provider) {
    const input = provider === "omdb" ? els.fieldOmdbKey : els.fieldRawgKey;
    const value = input ? input.value.trim() : "";
    if (provider === "omdb") setOmdbKey(value);
    else setRawgKey(value);
    if (input) input.value = value;
    setKeyVisibility(provider, false);
    clearTestStatus(provider);
    refreshApiKeyStatuses();
    showToast(value ? `${provider === "omdb" ? "OMDb" : "RAWG"} key saved` : `${provider === "omdb" ? "OMDb" : "RAWG"} key cleared`);
    updateApiKeyHint();
  }

  function clearProviderKey(provider) {
    if (provider === "omdb") {
      setOmdbKey("");
      if (els.fieldOmdbKey) els.fieldOmdbKey.value = "";
    } else {
      setRawgKey("");
      if (els.fieldRawgKey) els.fieldRawgKey.value = "";
    }
    setKeyVisibility(provider, false);
    clearTestStatus(provider);
    refreshApiKeyStatuses();
    showToast(`${provider === "omdb" ? "OMDb" : "RAWG"} key cleared`);
    updateApiKeyHint();
  }

  async function testProviderKey(provider) {
    const input = provider === "omdb" ? els.fieldOmdbKey : els.fieldRawgKey;
    const typed = input ? input.value.trim() : "";
    const stored = provider === "omdb" ? getOmdbKey() : getRawgKey();
    const key = typed || stored;
    if (!key) {
      showTestStatus(provider, false, "Paste a key first, then Test.");
      return;
    }
    showTestStatus(provider, true, "Testing…");
    try {
      if (provider === "omdb") {
        const params = new URLSearchParams({ apikey: key, t: "Inception", type: "movie" });
        const res = await fetch(`https://www.omdbapi.com/?${params.toString()}`);
        if (res.status === 401) {
          // OMDb answers a bad key (and an exhausted daily limit) with 401 + JSON.
          let err = "";
          try {
            err = String((await res.json()).Error || "");
          } catch {
            /* body unreadable */
          }
          showTestStatus(
            provider,
            false,
            /limit/i.test(err)
              ? "OMDb says this key’s daily request limit is reached. Try again later."
              : "Key rejected by OMDb. Check that you copied it fully."
          );
          return;
        }
        if (!res.ok) throw new Error("network");
        const data = await res.json();
        if (data && data.Response === "True" && data.Title) {
          showTestStatus(provider, true, `Looks good — found “${data.Title}”.`);
        } else if (data && /invalid|key/i.test(String(data.Error || ""))) {
          showTestStatus(provider, false, "Key rejected by OMDb. Check that you copied it fully.");
        } else {
          showTestStatus(provider, false, data && data.Error ? String(data.Error) : "Unexpected OMDb response.");
        }
      } else {
        const params = new URLSearchParams({ key, search: "Hades", page_size: "1" });
        let res;
        try {
          res = await fetch(`https://api.rawg.io/api/games?${params.toString()}`);
        } catch {
          // RAWG's 401 for a bad key has no CORS header, so the browser reports a
          // network failure; we can't tell "rejected" from "blocked" or offline.
          showTestStatus(
            provider,
            false,
            navigator.onLine === false
              ? "You’re offline. Connect and try again."
              : "Couldn’t verify the key — RAWG rejected the request or it was blocked. Check that you copied it fully."
          );
          return;
        }
        if (res.status === 401 || res.status === 403) {
          showTestStatus(provider, false, "Key rejected by RAWG. Check that you copied it fully.");
          return;
        }
        if (!res.ok) throw new Error("network");
        const data = await res.json();
        const hit =
          data && Array.isArray(data.results) && data.results[0]
            ? data.results[0].name
            : "";
        if (hit) {
          showTestStatus(provider, true, `Looks good — found “${hit}”.`);
        } else {
          showTestStatus(provider, false, "RAWG responded but no results for “Hades”.");
        }
      }
    } catch {
      showTestStatus(provider, false, "Test failed — check your connection and try again.");
    }
  }

  function dismissApiHint() {
    apiHintDismissed = true;
    try {
      sessionStorage.setItem("media-shelf-api-hint-dismissed", "1");
    } catch {
      /* ignore */
    }
    if (els.apiKeyHint) {
      els.apiKeyHint.hidden = true;
    }
  }

  function maybeShowLookupKeyHint(type) {
    if (!els.apiKeyHint || apiHintDismissed) return;
    if (type === "movie" && !getOmdbKey()) {
      if (els.apiKeyHintText) {
        els.apiKeyHintText.textContent =
          "Add a free OMDb key in Settings and movie Lookup will check OMDb first.";
      }
      els.apiKeyHint.hidden = false;
      els.apiKeyHint.dataset.focus = "omdb";
    } else if (type === "game" && !getRawgKey()) {
      if (els.apiKeyHintText) {
        els.apiKeyHintText.textContent =
          "Add a free RAWG key in Settings and game Lookup will try RAWG first.";
      }
      els.apiKeyHint.hidden = false;
      els.apiKeyHint.dataset.focus = "rawg";
    }
  }

  function updateApiKeyHint() {
    if (!els.apiKeyHint) return;
    const type = els.fieldType ? els.fieldType.value : "";
    if (type === "movie" && getOmdbKey()) {
      els.apiKeyHint.hidden = true;
    } else if (type === "game" && getRawgKey()) {
      els.apiKeyHint.hidden = true;
    } else if (type !== "movie" && type !== "game") {
      els.apiKeyHint.hidden = true;
    }
    /* Do not auto-show on type change — only after Lookup (maybeShowLookupKeyHint). */
  }

  /* ---------- B10: tell refused/errored sources apart from genuine no-match ---------- */
  function noteLookupIssue(source, issue, override = false) {
    if (!lookupIssues || !source) return;
    if (override || !lookupIssues.has(source)) lookupIssues.set(source, issue);
  }

  /** fetch() for Lookup sources: records HTTP errors (not 404) and network failures. */
  async function lookupFetch(url) {
    const source = lookupSource;
    let res;
    try {
      res = await fetch(url);
    } catch (err) {
      noteLookupIssue(source, { kind: "network" });
      throw err;
    }
    if (!res.ok && res.status !== 404) noteLookupIssue(source, { kind: "http", status: res.status });
    return res;
  }

  function describeLookupIssue(source, issue) {
    if (issue.kind === "key") return `${source} rejected your API key — check it in Settings.`;
    if (issue.kind === "limit") return `${source}’s daily request limit is reached.`;
    if (issue.kind === "network") {
      return source === "RAWG"
        ? "RAWG rejected the request or it was blocked — check your key in Settings."
        : `${source} couldn’t be reached (network error or blocked).`;
    }
    const st = issue.status;
    if (st === 401 || st === 403) return `${source} refused the request (HTTP ${st}).`;
    if (st === 429) return `${source} is limiting requests (HTTP 429). Try again later.`;
    // PLACEHOLDER copy (Berean). MusicBrainz answers 503 when it's rate limiting.
    if (st === 503 && source === "MusicBrainz") {
      return "MusicBrainz is busy right now (HTTP 503). Try again in a minute.";
    }
    if (st >= 500) return `${source} had a server error (HTTP ${st}).`;
    return `${source} returned an error (HTTP ${st}).`;
  }

  async function fetchOmdb({ title, year }) {
    const key = getOmdbKey();
    if (!key) return null;
    const t = String(title || "").trim();
    if (!t) return null;
    try {
      const params = new URLSearchParams({ apikey: key, t, type: "movie" });
      if (year) params.set("y", String(year));
      const res = await lookupFetch(`https://www.omdbapi.com/?${params.toString()}`);
      if (res.status === 401) {
        // B6: a bad key (or exhausted daily limit) must surface, not fall through silently.
        let err = "";
        try {
          err = String((await res.json()).Error || "");
        } catch {
          /* body unreadable */
        }
        noteLookupIssue("OMDb", { kind: /limit/i.test(err) ? "limit" : "key" }, true);
        return null;
      }
      if (!res.ok) throw new Error("network");
      const data = await res.json();
      if (data && data.Response === "False" && /invalid api key/i.test(String(data.Error || ""))) {
        noteLookupIssue("OMDb", { kind: "key" }, true);
        return null;
      }
      if (!data || data.Response === "False") {
        /* try search */
        const sp = new URLSearchParams({ apikey: key, s: t, type: "movie" });
        const sr = await lookupFetch(`https://www.omdbapi.com/?${sp.toString()}`);
        if (!sr.ok) return null;
        const sd = await sr.json();
        if (!sd || sd.Response === "False" || !Array.isArray(sd.Search) || !sd.Search.length) {
          return null;
        }
        const best = sd.Search[0];
        const detailParams = new URLSearchParams({
          apikey: key,
          i: best.imdbID,
        });
        const dr = await lookupFetch(`https://www.omdbapi.com/?${detailParams.toString()}`);
        if (!dr.ok) return null;
        const detail = await dr.json();
        if (!detail || detail.Response === "False") return null;
        return mapOmdbResult(detail);
      }
      return mapOmdbResult(data);
    } catch {
      return null;
    }
  }

  function mapOmdbResult(data) {
    const poster = data.Poster && data.Poster !== "N/A" ? data.Poster : "";
    let year = null;
    if (data.Year) {
      const m = String(data.Year).match(/(18|19|20)\d{2}/);
      if (m) year = Number(m[0]);
    }
    const creator =
      (data.Director && data.Director !== "N/A" ? data.Director : "") ||
      (data.Production && data.Production !== "N/A" ? data.Production : "");
    return {
      title: data.Title || "",
      creator,
      year,
      coverUrl: poster,
      coverSource: "omdb",
    };
  }

  async function fetchRawg(title) {
    const key = getRawgKey();
    if (!key) return null;
    const t = String(title || "").trim();
    if (!t) return null;
    try {
      const params = new URLSearchParams({
        key,
        search: t,
        page_size: "5",
      });
      const res = await lookupFetch(`https://api.rawg.io/api/games?${params.toString()}`);
      if (!res.ok) throw new Error("network");
      const data = await res.json();
      const results = Array.isArray(data.results) ? data.results : [];
      if (!results.length) return null;

      const tLower = t.toLowerCase();
      let best = results[0];
      let bestScore = -1;
      for (const g of results) {
        const name = String(g.name || "").toLowerCase();
        let score = 0;
        if (name === tLower) score += 100;
        if (name.includes(tLower) || tLower.includes(name)) score += 40;
        const words = tLower.split(/\s+/).filter(Boolean);
        for (const w of words) {
          if (name.includes(w)) score += 8;
        }
        if (g.background_image) score += 10;
        if (score > bestScore) {
          bestScore = score;
          best = g;
        }
      }

      let coverUrl = best.background_image || "";
      let creator = "";
      let year = null;
      if (best.released) {
        const m = String(best.released).match(/^(18|19|20)\d{2}/);
        if (m) year = Number(m[0]);
      }

      /* Detail fetch for better image / developers when slug/id present */
      if (best.id && (!coverUrl || !creator)) {
        try {
          const dr = await fetch(
            `https://api.rawg.io/api/games/${best.id}?key=${encodeURIComponent(key)}`
          );
          if (dr.ok) {
            const detail = await dr.json();
            if (detail.background_image) coverUrl = detail.background_image;
            if (Array.isArray(detail.developers) && detail.developers.length) {
              creator = detail.developers
                .slice(0, 3)
                .map((d) => d.name)
                .filter(Boolean)
                .join(", ");
            } else if (Array.isArray(detail.publishers) && detail.publishers.length) {
              creator = detail.publishers
                .slice(0, 2)
                .map((d) => d.name)
                .filter(Boolean)
                .join(", ");
            }
            if (year == null && detail.released) {
              const m = String(detail.released).match(/^(18|19|20)\d{2}/);
              if (m) year = Number(m[0]);
            }
          }
        } catch {
          /* keep search-level data */
        }
      }

      return {
        title: best.name || t,
        creator,
        year,
        coverUrl,
        coverSource: "rawg",
      };
    } catch {
      return null;
    }
  }

  async function fetchOpenLibraryByIsbn(isbn) {
    const clean = normalizeBarcode(isbn);
    const coverUrl = `https://covers.openlibrary.org/b/isbn/${clean}-L.jpg`;
    let title = "";
    let creator = "";
    let year = null;

    try {
      const res = await lookupFetch(`https://openlibrary.org/isbn/${clean}.json`);
      if (res.ok) {
        const data = await res.json();
        title = data.title || data.full_title || "";
        if (data.publish_date) {
          const m = String(data.publish_date).match(/(18|19|20)\d{2}/);
          if (m) year = Number(m[0]);
        }
        if (Array.isArray(data.authors) && data.authors.length) {
          const names = [];
          for (const a of data.authors.slice(0, 3)) {
            if (!a || !a.key) continue;
            try {
              const ar = await fetch(`https://openlibrary.org${a.key}.json`);
              if (ar.ok) {
                const ad = await ar.json();
                if (ad.name) names.push(ad.name);
              }
            } catch {
              /* ignore author fetch */
            }
          }
          creator = names.join(", ");
        }
        if (Array.isArray(data.covers) && data.covers[0]) {
          return {
            title,
            creator,
            year,
            coverUrl: `https://covers.openlibrary.org/b/id/${data.covers[0]}-L.jpg`,
            coverSource: "openlibrary",
            barcode: clean,
          };
        }
      }
    } catch {
      /* fall through to search */
    }

    try {
      const q = encodeURIComponent(`isbn:${clean}`);
      const res = await lookupFetch(
        `https://openlibrary.org/search.json?q=${q}&limit=1`
      );
      if (!res.ok) throw new Error("search failed");
      const data = await res.json();
      const doc = (data.docs || [])[0];
      if (!doc) {
        if (title || creator || year != null) {
          return {
            title,
            creator,
            year,
            coverUrl,
            coverSource: "openlibrary",
            barcode: clean,
          };
        }
        return null;
      }
      title = title || doc.title || "";
      if (!creator && Array.isArray(doc.author_name)) {
        creator = doc.author_name.slice(0, 3).join(", ");
      }
      if (year == null && doc.first_publish_year) {
        year = Number(doc.first_publish_year);
      }
      let finalCover = coverUrl;
      if (doc.cover_i) {
        finalCover = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
      }
      return {
        title,
        creator,
        year,
        coverUrl: finalCover,
        coverSource: "openlibrary",
        barcode: clean,
      };
    } catch {
      if (title || creator || year != null) {
        return {
          title,
          creator,
          year,
          coverUrl,
          coverSource: "openlibrary",
          barcode: clean,
        };
      }
      return null;
    }
  }

  async function fetchOpenLibraryByTitle(title, author) {
    const t = String(title || "").trim();
    if (!t) return null;
    try {
      const params = new URLSearchParams();
      params.set("title", t);
      if (author) params.set("author", String(author).trim());
      params.set("limit", "5");
      const res = await lookupFetch(`https://openlibrary.org/search.json?${params.toString()}`);
      if (!res.ok) throw new Error("search failed");
      const data = await res.json();
      const docs = Array.isArray(data.docs) ? data.docs : [];
      if (!docs.length) return null;
      const tLower = t.toLowerCase();
      let best = docs[0];
      let bestScore = -1;
      for (const doc of docs) {
        const name = String(doc.title || "").toLowerCase();
        let score = 0;
        if (name === tLower) score += 100;
        if (name.includes(tLower) || tLower.includes(name)) score += 40;
        if (author && Array.isArray(doc.author_name)) {
          const aLower = String(author).toLowerCase();
          if (doc.author_name.some((n) => String(n).toLowerCase().includes(aLower))) score += 30;
        }
        if (doc.cover_i) score += 5;
        if (score > bestScore) {
          bestScore = score;
          best = doc;
        }
      }
      const creator = Array.isArray(best.author_name)
        ? best.author_name.slice(0, 3).join(", ")
        : "";
      let year = null;
      if (best.first_publish_year) year = Number(best.first_publish_year);
      const coverUrl = best.cover_i
        ? `https://covers.openlibrary.org/b/id/${best.cover_i}-L.jpg`
        : "";
      return {
        title: best.title || t,
        creator,
        year,
        coverUrl,
        coverSource: "openlibrary",
      };
    } catch {
      return null;
    }
  }

  async function fetchOpenLibrary({ isbn, title, author }) {
    if (isbn && looksLikeIsbn(isbn)) {
      const byIsbn = await fetchOpenLibraryByIsbn(isbn);
      if (byIsbn) return byIsbn;
    }
    if (title) return fetchOpenLibraryByTitle(title, author);
    return null;
  }

  async function fetchGoogleBooks({ isbn, title, author }) {
    try {
      let q = "";
      if (isbn && looksLikeIsbn(isbn)) {
        q = `isbn:${normalizeBarcode(isbn)}`;
      } else if (title) {
        q = `intitle:${title}`;
        if (author) q += `+inauthor:${author}`;
      } else {
        return null;
      }
      const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=5`;
      const res = await lookupFetch(url);
      if (!res.ok) throw new Error("network");
      const data = await res.json();
      const items = Array.isArray(data.items) ? data.items : [];
      if (!items.length) return null;

      const tLower = String(title || "").toLowerCase();
      let best = items[0];
      let bestScore = -1;
      for (const item of items) {
        const info = item.volumeInfo || {};
        const name = String(info.title || "").toLowerCase();
        let score = 0;
        if (tLower && name === tLower) score += 100;
        if (tLower && (name.includes(tLower) || tLower.includes(name))) score += 40;
        if (info.imageLinks) score += 10;
        if (Array.isArray(info.authors) && info.authors.length) score += 5;
        if (score > bestScore) {
          bestScore = score;
          best = item;
        }
      }

      const info = best.volumeInfo || {};
      const links = info.imageLinks || {};
      const rawCover =
        links.large || links.medium || links.thumbnail || links.smallThumbnail || "";
      const coverUrl = upgradeGoogleBooksImage(rawCover);
      let year = null;
      if (info.publishedDate) {
        const m = String(info.publishedDate).match(/(18|19|20)\d{2}/);
        if (m) year = Number(m[0]);
      }
      const creator = Array.isArray(info.authors)
        ? info.authors.slice(0, 3).join(", ")
        : "";
      return {
        title: info.title || title || "",
        creator,
        year,
        coverUrl,
        coverSource: "googlebooks",
        barcode: isbn && looksLikeIsbn(isbn) ? normalizeBarcode(isbn) : undefined,
        googleBooksUrl: safeGoogleBooksUrl(info.canonicalVolumeLink || info.infoLink || ""),
      };
    } catch {
      return null;
    }
  }

  function scoreWikiOpenSearchTitle(candidate, term, kind) {
    const name = String(candidate || "").toLowerCase();
    const t = String(term || "").toLowerCase();
    let score = 0;
    if (name === t) score += 100;
    if (name.includes(t) || t.includes(name)) score += 40;
    const words = t.split(/\s+/).filter(Boolean);
    for (const w of words) {
      if (name.includes(w)) score += 8;
    }
    /* B8: for movies/games a type-marked title ("… (film)", "… (video game)") must beat the
       bare exact title, which is often the book, the person or a disambiguation page. */
    if (kind === "movie") {
      if (/\b(film|movie)\)?$/.test(name) || /\((\d{4} )?film\)/.test(name)) score += 150;
      if (/\b(album|song|novel|book)\b/.test(name)) score -= 15;
    } else if (kind === "game") {
      if (/\((\d{4} )?video game\)/.test(name)) score += 150;
      else if (/\b(video game|videogame)\b/.test(name)) score += 25;
      if (/\b(album|song|film|movie|novel)\b/.test(name)) score -= 10;
    } else if (kind === "book") {
      if (/\b(novel|book|novella)\b/.test(name)) score += 15;
      if (/\b(film|movie|album|song|video game)\b/.test(name)) score -= 15;
    }
    return score;
  }

  /** Does a Wikipedia short description ("2016 film by Denis Villeneuve") fit the item type? */
  function wikiDescriptionFits(description, kind) {
    const d = String(description || "").toLowerCase();
    if (kind === "movie") return /\b(film|movie)\b/.test(d);
    if (kind === "game") return /\bvideo ?game\b|\bgame\b/.test(d);
    return true;
  }

  /**
   * B8: resolve candidate titles in one MediaWiki query (no 404 noise), following redirects.
   * Returns the first candidate that exists, isn't a disambiguation page and, when
   * `mustFit` is set, whose short description fits the item type.
   */
  async function resolveWikipediaTitle(candidates, kind) {
    const list = candidates.filter((c) => c && c.title);
    if (!list.length) return null;
    const url =
      "https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*" +
      "&redirects=1&prop=pageprops%7Cdescription&ppprop=disambiguation&titles=" +
      encodeURIComponent(list.map((c) => c.title).join("|"));
    const res = await lookupFetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const q = (data && data.query) || {};
    const resolve = (title) => {
      let t = title;
      for (const n of q.normalized || []) if (n.from === t) t = n.to;
      for (const r of q.redirects || []) if (r.from === t) t = r.to;
      return t;
    };
    const pages = new Map((q.pages || []).map((pg) => [pg.title, pg]));
    for (const c of list) {
      const pg = pages.get(resolve(c.title));
      if (!pg || pg.missing || pg.invalid) continue;
      if (pg.pageprops && "disambiguation" in pg.pageprops) continue;
      if (c.mustFit && !wikiDescriptionFits(pg.description, kind)) continue;
      return pg.title;
    }
    return null;
  }

  async function fetchWikipediaSummary(pageTitle, kind) {
    const t = String(pageTitle || "").trim();
    if (!t) return null;
    try {
      const encoded = encodeURIComponent(t.replace(/ /g, "_"));
      const res = await lookupFetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("network");
      const data = await res.json();
      if (!data || data.type === "disambiguation") return null;
      const coverUrl =
        (data.originalimage && data.originalimage.source) ||
        (data.thumbnail && data.thumbnail.source) ||
        "";
      let year = null;
      const desc = `${data.description || ""} ${data.extract || ""}`;
      const ym = desc.match(/\b((?:18|19|20)\d{2})\b/);
      if (ym) year = Number(ym[1]);
      /* Short descriptions often name the director: "2023 film by Christopher Nolan". */
      let creator = "";
      if (kind === "movie") {
        const cm = String(data.description || "").match(/\bfilm (?:directed )?by (.+)$/i);
        if (cm) creator = cm[1].trim();
        if (!creator) {
          /* Lead sentence: "… film directed by Denis Villeneuve and written by …" */
          const em = String(data.extract || "").match(
            /\bdirected by ((?:[A-Z][\p{L}.'’-]*)(?: (?:[A-Z][\p{L}.'’-]*|de|van|von|del|da)){0,3})/u
          );
          if (em) {
            /* Stop at a sentence end, but keep initials ("J. J. Abrams"). */
            creator = em[1].replace(/(\p{L}{2,})\. .*$/u, "$1").replace(/\.$/, "").trim();
          }
        }
      }
      /* Page titles carry a disambiguator ("Arrival (film)"); the item title shouldn't. */
      const cleanTitle = String(data.title || t)
        .replace(/\s*\((?:\d{4} )?(?:[\w -]+ )?(?:film|movie|video game)\)\s*$/i, "")
        .trim();
      return {
        title: cleanTitle || t,
        creator,
        year,
        coverUrl,
        coverSource: "wikipedia",
        description: data.description || "",
      };
    } catch {
      return null;
    }
  }

  async function fetchWikipediaOpenSearch(term, kind) {
    const q = String(term || "").trim();
    if (!q) return null;
    try {
      const url =
        `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(q)}` +
        `&limit=8&namespace=0&format=json&origin=*`;
      const res = await lookupFetch(url);
      if (!res.ok) throw new Error("network");
      const data = await res.json();
      const titles = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
      if (!titles.length) return null;
      const ranked = titles
        .map((title) => ({ title, score: scoreWikiOpenSearchTitle(title, q, kind), mustFit: true }))
        .sort((a, b) => b.score - a.score);
      const best = await resolveWikipediaTitle(ranked, kind);
      return best ? fetchWikipediaSummary(best, kind) : null;
    } catch {
      return null;
    }
  }

  async function fetchWikipedia({ title, kind, year }) {
    const t = String(title || "").trim();
    if (!t) return null;
    const k = kind || "book";
    /* B8: try the type-specific article first, then the bare title (which must fit the type). */
    const candidates = [];
    if (k === "movie") {
      if (year) candidates.push({ title: `${t} (${year} film)` });
      candidates.push({ title: `${t} (film)` });
    } else if (k === "game") {
      if (year) candidates.push({ title: `${t} (${year} video game)` });
      candidates.push({ title: `${t} (video game)` });
    }
    candidates.push({ title: t, mustFit: k === "movie" || k === "game" });
    try {
      const resolved = await resolveWikipediaTitle(candidates, k);
      if (resolved) {
        const hit = await fetchWikipediaSummary(resolved, k);
        if (hit) return hit;
      }
    } catch {
      /* fall through to OpenSearch */
    }
    return fetchWikipediaOpenSearch(t, k);
  }

  /**
   * Movie covers come from OMDb only and game covers from RAWG only (v1.2: the App Store
   * artwork fallback is gone). Other sources may still fill title, year and creator.
   */
  function withoutCover(data) {
    if (!data) return data;
    return { ...data, coverUrl: "", coverSource: "" };
  }

  /* ---------- Music: MusicBrainz + Cover Art Archive ---------- */
  // MusicBrainz asks for at most one request per second per client, so requests
  // queue ~1.1s apart. No custom headers: a browser can't set User-Agent, and a
  // custom header would add a CORS preflight. The browser's own User-Agent is sent.
  const MB_GAP_MS = 1100;
  let mbNextAt = 0;

  async function musicBrainzFetch(url) {
    const now = Date.now();
    const at = Math.max(now, mbNextAt);
    mbNextAt = at + MB_GAP_MS;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
    return lookupFetch(url);
  }

  function mbPhrase(text) {
    return `"${String(text).replace(/[\\"]/g, "\\$&")}"`;
  }

  function mbArtistCredit(release) {
    const credit = Array.isArray(release["artist-credit"]) ? release["artist-credit"] : [];
    return credit
      .map((c) => `${c.name || (c.artist && c.artist.name) || ""}${c.joinphrase || ""}`)
      .join("")
      .trim();
  }

  function mbYear(date) {
    const m = String(date || "").match(/^(\d{4})/);
    if (!m) return null;
    const y = Number(m[1]);
    return y >= 1860 && y <= new Date().getFullYear() + 1 ? y : null;
  }

  /** UPC-A and EAN-13 spellings of the same code (MusicBrainz stores whichever was entered). */
  function barcodeVariants(raw) {
    const d = String(raw || "").replace(/\D/g, "");
    if (d.length < 8 || d.length > 14) return [];
    const out = new Set([d]);
    if (d.length === 12) out.add(`0${d}`);
    if (d.length === 13 && d.startsWith("0")) out.add(d.slice(1));
    return [...out];
  }

  function httpsUrl(u) {
    return String(u || "").replace(/^http:\/\//i, "https://");
  }

  /** Front cover from the Cover Art Archive: release first, then its release group. */
  async function fetchCoverArtArchive(releaseId, releaseGroupId) {
    const targets = [];
    if (releaseId) targets.push(`https://coverartarchive.org/release/${encodeURIComponent(releaseId)}`);
    if (releaseGroupId) targets.push(`https://coverartarchive.org/release-group/${encodeURIComponent(releaseGroupId)}`);
    for (const url of targets) {
      try {
        // Plain fetch: a missing cover (404) or a CAA hiccup isn't a Lookup failure.
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = await res.json();
        const images = Array.isArray(data.images) ? data.images : [];
        const front = images.find((i) => i.front) || null;
        if (!front) continue;
        const t = front.thumbnails || {};
        const src = t["500"] || t.large || front.image || "";
        if (src) return httpsUrl(src);
      } catch {
        /* try the next target */
      }
    }
    return "";
  }

  async function searchMusicBrainz(query, limit) {
    const params = new URLSearchParams({ query, fmt: "json", limit: String(limit) });
    const res = await musicBrainzFetch(`https://musicbrainz.org/ws/2/release/?${params.toString()}`);
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.releases) ? data.releases : [];
  }

  function pickMusicBrainzRelease(releases, title) {
    if (!releases.length) return null;
    const top = Math.max(...releases.map((r) => Number(r.score) || 0));
    const want = normalizeTitle(title || "");
    const pool = releases.filter((r) => (Number(r.score) || 0) >= top - 10);
    const exact = want ? pool.filter((r) => normalizeTitle(r.title || "") === want) : [];
    const choices = exact.length ? exact : pool;
    // Earliest dated release in the best group (the year itself comes from its release group).
    const dated = choices.filter((r) => mbYear(r.date) != null);
    if (!dated.length) return choices[0];
    return dated.reduce((a, b) => (mbYear(b.date) < mbYear(a.date) ? b : a));
  }

  async function fetchMusicBrainz({ barcode, title, artist }) {
    let release = null;
    let byBarcode = false;
    const codes = barcodeVariants(barcode);
    if (codes.length) {
      const q = codes.length > 1 ? `barcode:(${codes.join(" OR ")})` : `barcode:${codes[0]}`;
      const found = await searchMusicBrainz(q, 5);
      if (found === null) return null;
      const exact = found.filter((r) => codes.includes(String(r.barcode || "")));
      if (exact.length) {
        release = exact.find((r) => mbYear(r.date) != null) || exact[0];
        byBarcode = true;
      }
    }
    if (!release && title) {
      let q = `release:${mbPhrase(title)}`;
      if (artist) q += ` AND artist:${mbPhrase(artist)}`;
      const found = await searchMusicBrainz(q, 5);
      if (found === null) return null;
      release = pickMusicBrainzRelease(found, title);
    }
    if (!release) return null;
    const rg = release["release-group"] || {};
    let year = mbYear(release.date);
    let yearUncertain = false;
    // Barcode and title matches both name one pressing, and the search doesn't return the
    // album's first release date (many pressings have no date, and title matches can land on
    // a reissue). Ask the release group for it; the queue keeps MusicBrainz calls 1.1 s apart.
    let firstYear = null;
    if (rg.id) {
      try {
        const res = await musicBrainzFetch(
          `https://musicbrainz.org/ws/2/release-group/${encodeURIComponent(rg.id)}?fmt=json`
        );
        if (res.ok) firstYear = mbYear((await res.json())["first-release-date"]);
      } catch {
        firstYear = null;
      }
    }
    if (firstYear != null) year = firstYear;
    else yearUncertain = true; // fell back to this pressing's date, or blank
    const coverUrl = await fetchCoverArtArchive(release.id, rg.id);
    return {
      title: release.title || "",
      creator: mbArtistCredit(release),
      year,
      coverUrl,
      coverSource: coverUrl ? "coverartarchive" : "",
      _musicNoCover: !coverUrl,
      _byBarcode: byBarcode,
      _yearUncertain: yearUncertain,
      _score: Number(release.score) || 0,
    };
  }

  function lookupRank(d) {
    if (!d) return 0;
    return (
      (d.coverUrl ? 8 : 0) +
      (d.title ? 2 : 0) +
      (d.creator ? 2 : 0) +
      (d.year != null ? 1 : 0)
    );
  }

  function mergeLookupPreferEmpty(base, extra) {
    if (!base) return extra;
    if (!extra) return base;
    return {
      title: base.title || extra.title || "",
      creator: base.creator || extra.creator || "",
      year: base.year != null ? base.year : extra.year,
      coverUrl: base.coverUrl || extra.coverUrl || "",
      coverSource: base.coverUrl
        ? base.coverSource
        : extra.coverUrl
          ? extra.coverSource
          : base.coverSource || extra.coverSource || "",
      barcode: base.barcode || extra.barcode,
      googleBooksUrl: base.googleBooksUrl || extra.googleBooksUrl || "",
      _score: Math.max(base._score || 0, extra._score || 0),
    };
  }

  async function runLookupWaterfall(steps, triedLabels) {
    let withCover = null;
    let withTitleCreator = null;
    let partial = null;
    let knownTitle = "";

    for (const step of steps) {
      triedLabels.push(step.label);
      lookupSource = step.label;
      let data = null;
      try {
        data = await step.run(knownTitle);
      } catch {
        data = null;
      }
      lookupSource = "";
      if (!lookupHasUsefulFields(data)) continue;
      /* A source that returned data isn't "refused", even if a secondary request failed. */
      if (lookupIssues) lookupIssues.delete(step.label);
      if (data.title) knownTitle = knownTitle || data.title;

      const wrapped = {
        data,
        label: step.label,
        slug: data.coverSource || step.slug,
      };

      if (data.coverUrl) {
        /* Prefer filling empty metadata from earlier partials onto the cover hit */
        if (partial && partial.data) {
          wrapped.data = mergeLookupPreferEmpty(data, partial.data);
          /* cover source must stay with the cover provider */
          wrapped.data.coverUrl = data.coverUrl;
          wrapped.data.coverSource = data.coverSource || step.slug;
        }
        withCover = wrapped;
        break; /* first cover wins */
      }

      if (data.title && data.creator && !withTitleCreator) {
        withTitleCreator = wrapped;
      }

      if (!partial || lookupRank(data) > lookupRank(partial.data)) {
        partial = wrapped;
      } else if (partial) {
        partial = {
          data: mergeLookupPreferEmpty(partial.data, data),
          label: partial.label,
          slug: partial.slug,
        };
      }
    }

    if (withCover) return withCover;
    if (withTitleCreator) return withTitleCreator;
    return partial;
  }

  async function runLookup() {
    if (lookupBusy) return;
    const type = els.fieldType.value;
    const barcode = els.fieldBarcode.value.trim();
    const title = els.fieldTitle.value.trim();
    const author = els.fieldCreator.value.trim();
    const isbnShaped = looksLikeIsbn(barcode);

    if (!barcode && !title) {
      setLookupStatus("Enter a barcode/ISBN or a title to look up.", "error");
      return;
    }

    lookupBusy = true;
    els.btnLookup.disabled = true;
    lookupIssues = new Map();
    setLookupStatus("Looking up…");

    try {
      const tried = [];
      let result = null;

      if (type === "book") {
        if (!isbnShaped && !title) {
          setLookupStatus(
            "Enter an ISBN or a title to look up a book.",
            "error"
          );
          return;
        }
        const steps = [
          {
            label: "Open Library",
            slug: "openlibrary",
            run: () =>
              fetchOpenLibrary({
                isbn: isbnShaped ? barcode : "",
                title,
                author,
              }),
          },
          {
            label: "Google Books",
            slug: "googlebooks",
            run: (knownTitle) =>
              fetchGoogleBooks({
                isbn: isbnShaped ? barcode : "",
                title: title || knownTitle || "",
                author,
              }),
          },
          {
            label: "Wikipedia",
            slug: "wikipedia",
            run: async (knownTitle) => {
              const t = title || knownTitle || "";
              if (!t) return null;
              return fetchWikipedia({ title: t, kind: "book" });
            },
          },
        ];
        result = await runLookupWaterfall(steps, tried);
      } else if (type === "movie") {
        const term = title || "";
        if (!term) {
          setLookupStatus(
            "Movie barcodes usually aren’t in free catalogs. Enter a title, then Lookup — or paste a cover URL.",
            "error"
          );
          return;
        }
        const yearVal = els.fieldYear.value.trim();
        const steps = [];
        if (getOmdbKey()) {
          steps.push({
            label: "OMDb",
            slug: "omdb",
            run: () => fetchOmdb({ title: term, year: yearVal }),
          });
        }
        steps.push({
          label: "Wikipedia",
          slug: "wikipedia",
          run: async (knownTitle) =>
            withoutCover(
              await fetchWikipedia({ title: term || knownTitle || "", kind: "movie", year: yearVal })
            ),
        });
        result = await runLookupWaterfall(steps, tried);
      } else if (type === "game") {
        const term = title || "";
        const steps = [];
        if (term && getRawgKey()) {
          steps.push({
            label: "RAWG",
            slug: "rawg",
            run: () => fetchRawg(term),
          });
        }
        if (term) {
          steps.push({
            label: "Wikipedia",
            slug: "wikipedia",
            run: async (knownTitle) =>
              withoutCover(
                await fetchWikipedia({
                  title: term || knownTitle || "",
                  kind: "game",
                  year: els.fieldYear.value.trim(),
                })
              ),
          });
        }
        if (isbnShaped) {
          steps.push({
            label: "Open Library",
            slug: "openlibrary",
            run: async () => withoutCover(await fetchOpenLibraryByIsbn(barcode)),
          });
        }
        if (!steps.length) {
          setLookupStatus("Enter a game title to search, or paste a cover URL.", "error");
          return;
        }
        result = await runLookupWaterfall(steps, tried);
      } else if (type === "music") {
        // Music: MusicBrainz for details, Cover Art Archive for the front cover (step 7c).
        if (!barcodeVariants(barcode).length && !title) {
          // PLACEHOLDER copy (Berean)
          setLookupStatus("Enter a barcode or an album title to look up music.", "error");
          return;
        }
        const steps = [
          {
            label: "MusicBrainz",
            slug: "musicbrainz",
            run: () => fetchMusicBrainz({ barcode, title, artist: author }),
          },
        ];
        result = await runLookupWaterfall(steps, tried);
      } else {
        setLookupStatus("Unsupported type for lookup.", "error");
        return;
      }

      const issues = [...lookupIssues.entries()];
      if (result && lookupHasUsefulFields(result.data)) {
        const label = result.label || sourceLabel(result.slug);
        /* B6: after a match, still surface problems with the user's own API keys. */
        const keyNotes = issues
          .filter(([src]) => src === "OMDb" || src === "RAWG")
          .map(([src, issue]) => describeLookupIssue(src, issue));
        // PLACEHOLDER copy (Berean): a music match without a front cover says so.
        if (result.data._musicNoCover) {
          keyNotes.push("No cover in the Cover Art Archive. You can paste a cover URL.");
        }
        commitLookup(
          result.data,
          keyNotes.length ? `Matched via ${label}. ${keyNotes.join(" ")}` : `Matched via ${label}`,
          keyNotes.length ? "note" : "ok"
        );
        return;
      }

      if (!issues.length) {
        const list =
          tried.length > 0
            ? tried.join(", ")
            : "available sources";
        setLookupStatus(`No match across ${list}`, "error");
        return;
      }
      /* B10: say which sources refused/errored instead of calling it a "no match". */
      const failed = new Set(issues.map(([src]) => src));
      const noMatch = tried.filter((l) => !failed.has(l));
      const why = issues.map(([src, issue]) => describeLookupIssue(src, issue)).join(" ");
      setLookupStatus(
        noMatch.length
          ? `No match in ${noMatch.join(", ")}. ${why}`
          : `Couldn’t get a result. ${why}`,
        "error"
      );
    } catch {
      setLookupStatus("Lookup failed — check your connection and try again.", "error");
    } finally {
      lookupBusy = false;
      lookupIssues = null;
      lookupSource = "";
      els.btnLookup.disabled = false;
      if (type === "movie" || type === "game") {
        maybeShowLookupKeyHint(type);
      }
    }
  }

  function loadHtml5QrCode() {
    if (window.Html5Qrcode) return Promise.resolve(window.Html5Qrcode);
    if (html5QrCodeLibPromise) return html5QrCodeLibPromise;
    html5QrCodeLibPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = HTML5_QRCODE_CDN;
      s.async = true;
      s.onload = () => {
        if (window.Html5Qrcode) resolve(window.Html5Qrcode);
        else reject(new Error("library missing"));
      };
      s.onerror = () => reject(new Error("cdn failed"));
      document.head.appendChild(s);
    });
    return html5QrCodeLibPromise;
  }

  async function stopScanner() {
    if (!activeScanner) return;
    try {
      await activeScanner.stop();
    } catch {
      /* already stopped */
    }
    try {
      await activeScanner.clear();
    } catch {
      /* ignore */
    }
    activeScanner = null;
  }

  function closeScanModal(silent) {
    stopScanner();
    els.scanModal.hidden = true;
    els.scanModal.setAttribute("aria-hidden", "true");
    if (!silent && els.scanStatus) els.scanStatus.textContent = "";
    if (els.modal.hidden && els.confirm.hidden) {
      document.body.classList.remove("modal-open");
    }
  }

  async function openScanModal() {
    els.scanStatus.textContent = "Starting camera…";
    els.scanModal.hidden = false;
    els.scanModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");

    try {
      const Html5Qrcode = await loadHtml5QrCode();
      await stopScanner();
      els.qrReader.innerHTML = "";
      activeScanner = new Html5Qrcode("qr-reader");
      await activeScanner.start(
        { facingMode: "environment" },
        { fps: 8, qrbox: { width: 240, height: 140 } },
        async (decoded) => {
          const code = String(decoded || "").trim();
          if (!code) return;
          els.fieldBarcode.value = code;
          els.scanStatus.textContent = "Scanned — looking up…";
          await stopScanner();
          closeScanModal(true);
          setLookupStatus("Barcode scanned. Looking up…", "ok");
          await runLookup();
          // Lookup already checked if it filled the form; this covers a scan whose lookup
          // found nothing but whose barcode is on file.
          if (els.confirm.hidden) checkDuplicateFromForm();
        },
        () => {}
      );
      els.scanStatus.textContent = "Point at a barcode…";
    } catch (err) {
      const name = err && err.name;
      const msg = String((err && err.message) || err || "");
      if (
        name === "NotAllowedError" ||
        /permission|notallowed|denied/i.test(msg)
      ) {
        els.scanStatus.textContent =
          "Camera permission denied. You can type the barcode instead.";
      } else if (
        name === "NotFoundError" ||
        /not found|no camera|devices/i.test(msg)
      ) {
        els.scanStatus.textContent =
          "No camera found on this device. Type the barcode instead.";
      } else if (/https|secure|insecure|permission/i.test(msg)) {
        els.scanStatus.textContent =
          "Camera needs HTTPS or localhost. Type the barcode, or open this page securely.";
      } else {
        els.scanStatus.textContent =
          "Could not start the camera. Type the barcode instead, or try HTTPS/localhost.";
      }
    }
  }

  function trapFocus(e, panel) {
    if (e.key !== "Tab") return;
    const focusables = $$(
      'button:not([hidden]), [href], input:not([hidden]), select:not([hidden]), textarea:not([hidden]), [tabindex]:not([tabindex="-1"])',
      panel
    ).filter((el) => !el.disabled && el.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function bind() {
    $$(".type-tabs .chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        filterType = btn.dataset.type;
        $$(".type-tabs .chip").forEach((b) => {
          const on = b === btn;
          b.classList.toggle("active", on);
          b.setAttribute("aria-selected", on ? "true" : "false");
        });
        render();
      });
    });

    els.statusFilter.addEventListener("change", () => {
      filterStatus = els.statusFilter.value;
      render();
    });

    els.sortSelect.addEventListener("change", () => {
      sortMode = els.sortSelect.value;
      render();
    });

    els.search.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        searchQuery = els.search.value;
        render();
      }, 200);
    });

    $("#btn-add").addEventListener("click", () => openModal(null));
    $("#btn-empty-add").addEventListener("click", () => openModal(null));
    $("#btn-clear-seed").addEventListener("click", clearSeeds);
    $("#btn-settings").addEventListener("click", () => openSettingsModal());
    $("#settings-close").addEventListener("click", () => closeSettingsModal());
    $$("[data-settings-close]").forEach((el) =>
      el.addEventListener("click", () => closeSettingsModal())
    );
    if (els.btnOpenApiSettings) {
      els.btnOpenApiSettings.addEventListener("click", () => {
        const focus = (els.apiKeyHint && els.apiKeyHint.dataset.focus) || "";
        dismissApiHint();
        openSettingsModal(focus === "rawg" || focus === "omdb" ? focus : undefined);
      });
    }
    const bindToggle = (id, provider) => {
      const btn = $(id);
      if (!btn) return;
      btn.addEventListener("click", () => {
        const input = provider === "omdb" ? els.fieldOmdbKey : els.fieldRawgKey;
        const showing = input && input.type === "text";
        setKeyVisibility(provider, !showing);
      });
    };
    bindToggle("#btn-toggle-omdb", "omdb");
    bindToggle("#btn-toggle-rawg", "rawg");
    const bindClick = (id, fn) => {
      const el = $(id);
      if (el) el.addEventListener("click", fn);
    };
    bindClick("#btn-save-omdb", () => saveProviderKey("omdb"));
    bindClick("#btn-save-rawg", () => saveProviderKey("rawg"));
    bindClick("#btn-clear-omdb", () => clearProviderKey("omdb"));
    bindClick("#btn-clear-rawg", () => clearProviderKey("rawg"));
    bindClick("#btn-test-omdb", () => testProviderKey("omdb"));
    bindClick("#btn-test-rawg", () => testProviderKey("rawg"));

    $("#btn-export").addEventListener("click", exportJson);
    $("#btn-import").addEventListener("click", () => els.importFile.click());
    // Backup handlers call navigator.share synchronously (user gesture).
    bindClick("#btn-backup", backupToICloud);
    bindClick("#btn-backup-settings", backupToICloud);
    bindClick("#btn-backup-now", backupToICloud);
    bindClick("#btn-backup-dismiss", dismissBackupReminder);
    bindClick("#btn-restore", () => els.importFile.click());
    els.confirmAlt.addEventListener("click", () => {
      if (typeof confirmAltCallback === "function") confirmAltCallback();
    });
    els.importFile.addEventListener("change", () => {
      const file = els.importFile.files && els.importFile.files[0];
      if (file) importJson(file);
      els.importFile.value = "";
    });

    els.list.addEventListener("click", (e) => {
      if (e.target.closest("a.card-ref, a.ref-link, a.card-credit-link")) return;
      const card = e.target.closest(".item-card");
      if (!card) return;
      const item = items.find((i) => i.id === card.dataset.id);
      if (item) openModal(item);
    });
    els.list.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.target.closest("a")) return; // a focused link on the card follows its own href
      const card = e.target.closest(".item-card");
      if (!card) return;
      e.preventDefault();
      const item = items.find((i) => i.id === card.dataset.id);
      if (item) openModal(item);
    });

    els.form.addEventListener("submit", saveItem);
    els.btnDelete.addEventListener("click", deleteCurrent);
    els.fieldType.addEventListener("change", () => {
      lookupYearLoose = false;
      updateFormatOptions();
      updateCoverFrame();
      updateGoogleBooksAttr();
      if (els.fieldType.value === "book") syncAuthorsFromCreator();
      else renderSignedUi();
      updateReferenceLinks();
      updateApiKeyHint();
    });
    els.fieldFormat.addEventListener("change", updateDiscVisibility);
    componentInputs().forEach((el, i) => {
      if (!el) return;
      el.addEventListener("change", () => {
        componentState[COMPONENT_KEYS[i]] = el.checked;
      });
    });
    els.fieldCreator.addEventListener("blur", () => {
      if (els.fieldType.value === "book") syncAuthorsFromCreator();
    });
    if (els.fieldSignedSingle) {
      els.fieldSignedSingle.addEventListener("change", () => {
        if (formAuthors.length === 1) formAuthors[0].signed = els.fieldSignedSingle.checked;
        else formSignedNoAuthor = els.fieldSignedSingle.checked;
      });
    }
    if (els.fieldSignedParent) {
      els.fieldSignedParent.addEventListener("change", onSignedParentChange);
    }
    if (els.signedAuthors) {
      els.signedAuthors.addEventListener("change", (e) => {
        const box = e.target.closest("input[data-author-index]");
        if (!box) return;
        const a = formAuthors[Number(box.dataset.authorIndex)];
        if (a) a.signed = box.checked;
        renderSignedUi(); // checking any author turns the parent on
      });
    }
    if (els.btnCib) {
      els.btnCib.addEventListener("click", () => {
        setComponentState({ ownsGame: true, ownsCase: true, ownsManual: true });
      });
    }
    els.fieldTitle.addEventListener("input", updateReferenceLinks);
    // A lookup error ("Enter a barcode/ISBN or a title…", "No match…") goes stale once the
    // user edits what would be looked up. Clear only the error; leave busy/ok states alone.
    const clearStaleLookupError = () => {
      if (!lookupBusy && els.lookupStatus.classList.contains("is-error")) setLookupStatus("");
    };
    els.fieldBarcode.addEventListener("input", clearStaleLookupError);
    els.fieldTitle.addEventListener("input", clearStaleLookupError);
    els.fieldYear.addEventListener("input", () => {
      lookupYearLoose = false; // a year the user typed is compared normally
      updateReferenceLinks();
    });
    els.fieldCover.addEventListener("input", () => {
      els.fieldCoverSource.value = els.fieldCover.value.trim() ? "manual" : "";
      updateCoverPreview();
    });
    els.coverPreview.addEventListener("error", () => {
      if (!els.fieldCover.value.trim()) return;
      els.coverPreview.hidden = true;
      els.coverPreviewPlaceholder.hidden = false;
      els.coverPreviewPlaceholder.textContent = "Preview failed";
    });
    els.coverPreview.addEventListener("load", () => {
      if (els.fieldCover.value.trim()) {
        els.coverPreview.hidden = false;
        els.coverPreviewPlaceholder.hidden = true;
        els.coverPreviewPlaceholder.textContent = "No cover";
      }
    });

    els.btnLookup.addEventListener("click", () => runLookup());
    els.btnScan.addEventListener("click", () => openScanModal());
    $("#scan-close").addEventListener("click", () => closeScanModal());
    $("#scan-cancel").addEventListener("click", () => closeScanModal());
    $$("[data-scan-close]").forEach((el) =>
      el.addEventListener("click", () => closeScanModal())
    );

    $$("[data-close]").forEach((el) => {
      el.addEventListener("click", () => {
        if (!els.confirm.hidden || !els.scanModal.hidden) return;
        closeModal();
      });
    });
    $("#modal-close").addEventListener("click", closeModal);

    $("#confirm-cancel").addEventListener("click", closeConfirm);
    $$("[data-confirm-cancel]").forEach((el) =>
      el.addEventListener("click", closeConfirm)
    );
    $("#confirm-ok").addEventListener("click", () => {
      if (typeof confirmCallback === "function") confirmCallback();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (!els.confirm.hidden) {
          closeConfirm();
          return;
        }
        if (!els.scanModal.hidden) {
          closeScanModal();
          return;
        }
        if (els.settingsModal && !els.settingsModal.hidden) {
          closeSettingsModal();
          return;
        }
        if (!els.modal.hidden) closeModal();
        return;
      }
      if (!els.confirm.hidden) {
        trapFocus(e, $(".modal-panel-sm", els.confirm));
        return;
      }
      if (!els.scanModal.hidden) {
        trapFocus(e, $(".scan-panel", els.scanModal));
        return;
      }
      if (!els.modal.hidden) {
        trapFocus(e, $(".modal-panel", els.modal));
      }
    });
  }

  /* ---------- Duplicate detection (handoff §4) ---------- */
  const TITLE_STOPWORDS = new Set(["the", "goty", "definitive", "remastered"]);

  /** lowercase, no trademark signs / accents / punctuation, no "the", goty, definitive, remastered. */
  function normalizeTitle(t) {
    const words = String(t || "")
      .toLowerCase()
      .replace(/[™®©℠]/g, "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    const out = [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (TITLE_STOPWORDS.has(w)) continue;
      // "Definitive Edition", "GOTY Edition": drop the edition word with its qualifier.
      if (w === "edition" && i > 0 && TITLE_STOPWORDS.has(words[i - 1]) && words[i - 1] !== "the") continue;
      out.push(w);
    }
    return out.join(" ");
  }

  function editDistance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let rowMin = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        rowMin = Math.min(rowMin, cur[j]);
      }
      if (rowMin > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  /** Near-identical titles only (typos, spacing). "Hades" vs "Hades II" is NOT fuzzy-equal. */
  /** Sequel / volume markers: numbers, roman numerals, single letters ("Tab A"). */
  function titleMarkers(t) {
    return t
      .split(" ")
      .filter((w) => /^\d+$/.test(w) || w.length === 1 || /^(?=[ivx]+$)x{0,3}(ix|iv|v?i{0,3})$/.test(w))
      .sort()
      .join(" ");
  }
  function fuzzyTitleEqual(a, b) {
    if (!a || !b) return false;
    if (a.replace(/\s/g, "") === b.replace(/\s/g, "")) return true;
    // "Mario Kart 7" vs "8", "Final Fantasy VII" vs "VIII" are different games, not typos.
    if (titleMarkers(a) !== titleMarkers(b)) return false;
    const len = Math.min(a.length, b.length);
    const max = len >= 12 ? 2 : len >= 6 ? 1 : 0;
    return max > 0 && editDistance(a, b, max) <= max;
  }

  /**
   * Match order (handoff §4.2): barcode + type; platform + externalId; type + title + year
   * (year optional if only one candidate); fuzzy title + type. Every match only prompts.
   * @returns {{ item: object, reason: string } | null}
   */
  function findDuplicate(candidate, excludeId) {
    const pool = items.filter((i) => i.id !== excludeId);
    // Several matches (e.g. a digital and a physical Hades II): point at the one that
    // looks like the same copy, so Update is offered against the right row.
    const newest = (list) => {
      const same = list.filter((i) => !looksLikeDifferentCopy(i, candidate));
      return (same.length ? same : list)
        .slice()
        .sort((a, b) => String(b.dateUpdated).localeCompare(String(a.dateUpdated)))[0];
    };
    const code = normalizeBarcode(candidate.barcode);
    if (code) {
      const hits = pool.filter((i) => i.type === candidate.type && normalizeBarcode(i.barcode) === code);
      if (hits.length) return { item: newest(hits), reason: "barcode" };
    }
    if (candidate.platform && candidate.externalId) {
      const hit = pool.find(
        (i) => samePlatform(i.platform, candidate.platform) && i.externalId && i.externalId === candidate.externalId
      );
      if (hit) return { item: hit, reason: "external" };
    }
    const title = normalizeTitle(candidate.title);
    if (!title) return null;
    // Music Lookup whose year is a pressing's date or blank (N2b): match on title plus
    // artist and ignore the year.
    const ignoreYear = candidate._ignoreYear === true;
    const artist = ignoreYear ? normalizeTitle(candidate.creator || "") : "";
    const sameType = pool.filter(
      (i) => i.type === candidate.type && (!artist || !i.creator || normalizeTitle(i.creator) === artist)
    );
    const exact = sameType.filter((i) => normalizeTitle(i.title) === title);
    const year = ignoreYear || candidate.year == null ? null : Number(candidate.year);
    // Same title with a different year (e.g. a remake) is not a duplicate.
    const compatible = exact.filter((i) => year == null || i.year == null || i.year === year);
    if (compatible.length) {
      const rank = (i) =>
        (looksLikeDifferentCopy(i, candidate) ? 0 : 2) + (year != null && i.year === year ? 1 : 0);
      const best = compatible
        .slice()
        .sort(
          (x, y) => rank(y) - rank(x) || String(y.dateUpdated).localeCompare(String(x.dateUpdated))
        )[0];
      return { item: best, reason: "title" };
    }
    const fuzzy = sameType.filter(
      (i) =>
        normalizeTitle(i.title) !== title &&
        fuzzyTitleEqual(normalizeTitle(i.title), title) &&
        !(year != null && i.year != null && i.year !== year)
    );
    if (fuzzy.length) return { item: newest(fuzzy), reason: "fuzzy" };
    return null;
  }

  /** Steam vs Switch, digital vs physical, CD vs vinyl: two rows is the right answer. */
  function looksLikeDifferentCopy(existing, incoming) {
    if (existing.platform && incoming.platform && !samePlatform(existing.platform, incoming.platform)) return true;
    if (existing.format !== incoming.format) return true;
    if (existing.disc && incoming.disc && existing.disc !== incoming.disc) return true;
    return false;
  }

  function dupSummaryHtml(it) {
    const meta = [TYPE_LABELS[it.type] || it.type];
    if (it.platform) meta.push(PLATFORM_LABELS[it.platform] || it.platform);
    meta.push(FORMAT_LABELS[it.format] || it.format);
    if (it.format === "physical" && it.disc) meta.push(DISC_LABELS[it.disc] || it.disc);
    if (it.playtimeMinutes != null) meta.push(`${Math.round(it.playtimeMinutes / 60)}h`);
    if (it.type === "book" && it.signed) meta.push("Signed");
    let parts = "";
    const labels = COMPONENT_LABELS[it.type];
    if (it.format === "physical" && labels && COMPONENT_KEYS.some((k) => it[k] != null)) {
      // ✓ / ✗ / dim en dash; screen readers hear yes / no / not recorded instead of symbols.
      const mark = (v) =>
        v === true
          ? `<span class="dup-mark" aria-hidden="true">✓</span><span class="sr-only">yes</span>`
          : v === false
            ? `<span class="dup-mark" aria-hidden="true">✗</span><span class="sr-only">no</span>`
            : `<span class="dup-mark is-unknown" aria-hidden="true">–</span><span class="sr-only">not recorded</span>`;
      parts = `<span class="dup-parts">${labels
        .map((l, i) => `<span class="dup-part">${escapeHtml(l)} ${mark(it[COMPONENT_KEYS[i]])}</span>`)
        .join(" ")}</span>`;
    }
    const year = it.year != null ? ` (${it.year})` : "";
    return `<span class="dup-title">${escapeHtml(it.title)}${year}</span><span class="dup-meta">${escapeHtml(meta.join(" · "))}</span>${parts}`;
  }

  /**
   * Update existing with incoming (handoff §4.3): fill empty fields; platform only if
   * missing; same platform + externalId refreshes playtime / lastUsed; union sources;
   * component flags: true fills null/false (the prompt shows them, and choosing Update is
   * the confirm), false only fills null, never true → false. Notes, tags, rating, status
   * are replaced only when `alsoReplace` is checked (empty ones are still filled).
   */
  function mergeIncomingIntoExisting(existing, incoming, alsoReplace) {
    const out = { ...existing };
    const empty = (v) => v == null || v === "" || (Array.isArray(v) && !v.length);
    for (const k of ["creator", "year", "barcode", "progress", "externalId", "rawgId", "acquisition", "lastUsed", "googleBooksUrl"]) {
      if (empty(out[k]) && !empty(incoming[k])) out[k] = incoming[k];
    }
    if (empty(out.coverUrl) && !empty(incoming.coverUrl)) {
      out.coverUrl = incoming.coverUrl;
      out.coverSource = incoming.coverSource || "";
    }
    if (out.format === incoming.format && empty(out.disc) && !empty(incoming.disc)) out.disc = incoming.disc;
    if (empty(out.platform) && !empty(incoming.platform)) out.platform = incoming.platform;
    if (out.platform && samePlatform(out.platform, incoming.platform) && out.externalId && out.externalId === incoming.externalId) {
      if (incoming.playtimeMinutes != null) out.playtimeMinutes = incoming.playtimeMinutes;
      if (!empty(incoming.lastUsed)) out.lastUsed = incoming.lastUsed;
    } else if (out.playtimeMinutes == null && incoming.playtimeMinutes != null) {
      out.playtimeMinutes = incoming.playtimeMinutes;
    }
    out.sources = [...new Set([...(existing.sources || []), ...(incoming.sources || ["manual"])])];
    for (const k of COMPONENT_KEYS) {
      if (incoming[k] === true) out[k] = true;
      else if (incoming[k] === false && out[k] == null) out[k] = false;
    }
    if (existing.type === "book") {
      const inc = new Map((incoming.authors || []).map((a) => [a.name.toLowerCase(), a.signed]));
      if (!(existing.authors || []).length && (incoming.authors || []).length) {
        out.authors = incoming.authors.map((a) => ({ ...a }));
      } else {
        out.authors = (existing.authors || []).map((a) => ({
          ...a,
          signed: a.signed || inc.get(a.name.toLowerCase()) === true,
        }));
      }
      if (!out.authors.length && incoming.signed) out.signed = true;
    }
    if (alsoReplace) {
      if (!empty(incoming.notes)) out.notes = incoming.notes;
      if (!empty(incoming.tags)) out.tags = incoming.tags.slice();
      if (incoming.rating != null) out.rating = incoming.rating;
      if (!empty(incoming.status)) out.status = incoming.status;
    } else {
      if (empty(out.notes) && !empty(incoming.notes)) out.notes = incoming.notes;
      if (empty(out.tags) && !empty(incoming.tags)) out.tags = incoming.tags.slice();
      if (out.rating == null && incoming.rating != null) out.rating = incoming.rating;
    }
    return out;
  }

  /** Would "also replace" change anything the user may care about? */
  function incomingWouldReplace(existing, incoming) {
    const differs = (a, b) => JSON.stringify(a) !== JSON.stringify(b);
    return (
      (incoming.notes && existing.notes && differs(incoming.notes, existing.notes)) ||
      (incoming.tags && incoming.tags.length && existing.tags && existing.tags.length && differs(incoming.tags, existing.tags)) ||
      (incoming.rating != null && existing.rating != null && incoming.rating !== existing.rating) ||
      (incoming.status && incoming.status !== existing.status)
    );
  }

  /**
   * "This looks like an item you already have" (handoff §4.3). Same dialog as Delete:
   * Update existing / Add as a separate copy / Cancel. The primary (focused) action is
   * Update existing, unless the two look like different copies, then Add as a separate
   * copy. Escape = Cancel.
   * @param {"save"|"lookup"} context  save = Add form Save; lookup = after Lookup / Scan
   */
  function openDuplicatePrompt(incomingRaw, dup, context) {
    const existing = dup.item;
    const incoming = normalizeItem({ ...incomingRaw, id: incomingRaw.id || "incoming" });
    const separateFirst = looksLikeDifferentCopy(existing, incoming);
    const detailHtml =
      `<dt>Existing</dt><dd>${dupSummaryHtml(existing)}</dd>` +
      `<dt>Incoming</dt><dd>${dupSummaryHtml(incoming)}</dd>`;
    // PLACEHOLDER copy (Berean): description, option label, toasts and status lines.
    const desc = separateFirst
      ? "These look like different copies (another format, disc or platform), so adding a separate copy is suggested."
      : "Update the item you have with the new details, or add this as a separate copy.";
    const optionLabel = incomingWouldReplace(existing, incoming)
      ? "When updating, also replace notes, tags, rating and status." // PLACEHOLDER (Berean), Oholiab fix 7
      : "";
    const doUpdate = () => {
      const alsoReplace = Boolean(els.confirmOption && els.confirmOption.checked && optionLabel);
      if (context === "save") {
        const ts = nowIso();
        commitItems((list) => {
          const idx = list.findIndex((i) => i.id === existing.id);
          const base = idx >= 0 ? list[idx] : existing;
          const merged = normalizeItem({ ...mergeIncomingIntoExisting(base, incoming, alsoReplace), dateUpdated: ts, seed: false });
          if (idx >= 0) list[idx] = merged;
          else list.unshift(merged);
        });
        closeConfirm();
        closeModal();
        showToast("Updated your existing item");
        render();
        return;
      }
      // After Lookup / Scan: switch the form to the existing item with the incoming details
      // filled in. Nothing is saved until the user presses Save.
      const merged = normalizeItem(mergeIncomingIntoExisting(existing, incoming, alsoReplace));
      closeConfirm();
      openModal(merged, existing);
      setLookupStatus("Now editing the item you already have. Check the details, then Save.", "ok");
    };
    const doSeparate = () => {
      if (context === "save") {
        const ts = nowIso();
        commitItems((list) => {
          list.unshift(normalizeItem({ ...incomingRaw, id: uid(), dateAdded: ts, dateUpdated: ts }));
        });
        closeConfirm();
        closeModal();
        showToast("Added as a separate copy");
        render();
        return;
      }
      dupAcceptedSeparateId = existing.id;
      closeConfirm();
      els.fieldTitle.focus();
    };
    openConfirm("This looks like an item you already have", desc, doUpdate, "Update existing", {
      altLabel: "Add as a separate copy",
      onAlt: doSeparate,
      focusAlt: separateFirst,
      okClass: separateFirst ? "btn-ghost" : "btn-primary",
      altClass: separateFirst ? "btn-primary" : "btn-ghost",
      wide: true,
      detailHtml,
      optionLabel,
    });
  }

  /** Add form only: run the matcher on what Lookup / Scan put in the form. */
  function checkDuplicateFromForm() {
    if (editingId || els.modal.hidden || !els.confirm.hidden) return;
    if (syncFromStorage()) render();
    const data = collectForm();
    if (!data.title && !data.barcode) return;
    const dup = findDuplicate(withLookupYearRule(data), null);
    if (dup && dup.item.id !== dupAcceptedSeparateId) openDuplicatePrompt(data, dup, "lookup");
  }

  /** Form data for the duplicate check, flagged when a music Lookup's year isn't reliable. */
  function withLookupYearRule(data) {
    return lookupYearLoose && data.type === "music" ? { ...data, _ignoreYear: true } : data;
  }

  /**
   * Another tab changed storage: reload and re-render. An open edit form is left alone;
   * its next Save merges against fresh storage (see commitItems / mergeEditOntoFresh).
   */
  function onStorageEvent(e) {
    if (e.storageArea && e.storageArea !== localStorage) return;
    if (e.key === STORAGE_KEY || e.key === null) {
      if (syncFromStorage()) render();
      return;
    }
    if (e.key === LAST_IMPORT_STORAGE) {
      updateLastImportUi();
      return;
    }
    if (e.key === LAST_BACKUP_STORAGE || e.key === BACKUP_REMINDER_DISMISSED_STORAGE) {
      updateBackupUi();
    }
  }

  /* ---------- "A new version is ready" (v1.2) ----------
   * sw.js calls skipWaiting() + clients.claim(), so when a later release activates, open
   * pages get `controllerchange` while still running the old files. Offer a Reload instead
   * of letting an old page keep saving. Never reload by itself, and wait while a form or
   * dialog is open so nothing typed is lost.
   */
  let swHadController = false;
  let updateReady = false;

  function updateBannerShown() {
    const el = document.getElementById("update-banner");
    return Boolean(el && !el.hidden);
  }

  function anyModalOpen() {
    return Boolean(document.querySelector(".modal:not([hidden])"));
  }

  function maybeShowUpdateBanner() {
    if (!updateReady || updateBannerShown() || anyModalOpen()) return;
    const banner = document.getElementById("update-banner");
    if (!banner) return;
    // PLACEHOLDER copy (Berean).
    document.getElementById("update-banner-text").textContent = "A new version is ready.";
    banner.hidden = false;
    updateBackupUi(); // hides the backup reminder while this shows
  }

  function onControllerChange() {
    // The very first install also claims the page; that isn't an update.
    if (!swHadController) {
      swHadController = true;
      return;
    }
    updateReady = true;
    maybeShowUpdateBanner();
  }

  function watchForUpdates() {
    if (!("serviceWorker" in navigator)) return;
    swHadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    // A form or dialog was open when the update arrived: show the banner once it closes.
    const mo = new MutationObserver(() => maybeShowUpdateBanner());
    document.querySelectorAll(".modal").forEach((m) =>
      mo.observe(m, { attributes: true, attributeFilter: ["hidden"] })
    );
    const btn = document.getElementById("btn-update-reload");
    if (btn) btn.addEventListener("click", () => location.reload());
  }

  function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    if (!/^https?:$/.test(location.protocol)) return;
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  /* ---------- Step 7: games import (paste or .csv) ----------
   * Columns: title, platform, year. Nothing is saved until "Add N games"; then one toast
   * with Undo (until the next save anywhere, or 10 seconds). All copy PLACEHOLDER (Berean).
   */
  const IMPORT_MAX_LINES = 5000;
  const IMPORT_SHOW_NEW = 100; // new rows listed one by one; the rest are summarised
  const IMPORT_UNDO_MS = 10000;
  /**
   * Last import record (Nathan N1): its own key, never in backups and never inside
   * media-tracker-v1. { v: 1, at, added: [{ id, fp }], updated: [{ id, fp, before }] }.
   * fp fingerprints the game as the import left it, so "changed since" can be told apart.
   */
  const LAST_IMPORT_STORAGE = "freerangemedia-last-import";
  let importRows = []; // parsed rows: { line, title, platform, year, error }
  let importEval = []; // per row: { kind: "new" | "dup" | "error", dup, reason }
  let importChoices = new Map(); // line -> "add" | "skip" | "update" (user overrides)
  let importFresh = false;
  let importUndo = null;

  function importYearMax() {
    return new Date().getFullYear() + 1;
  }

  /** CSV / TSV records with their starting line numbers. Quotes may wrap commas, tabs, newlines. */
  function parseDelimited(text, delim) {
    const out = [];
    let cells = [];
    let cell = "";
    let inQuotes = false;
    let atFieldStart = true;
    let line = 1;
    let recordLine = 1;
    const endCell = () => {
      cells.push(cell);
      cell = "";
      atFieldStart = true;
    };
    const endRecord = () => {
      endCell();
      if (cells.some((c) => c.trim())) out.push({ line: recordLine, cells });
      cells = [];
    };
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            cell += '"';
            i++;
          } else inQuotes = false;
        } else {
          if (ch === "\n") line++;
          cell += ch;
        }
        continue;
      }
      if (ch === '"' && atFieldStart) {
        inQuotes = true;
        atFieldStart = false;
      } else if (ch === delim) {
        endCell();
      } else if (ch === "\n") {
        endRecord();
        line++;
        recordLine = line;
      } else {
        cell += ch;
        if (ch !== " ") atFieldStart = false;
      }
    }
    endRecord();
    return out;
  }

  const IMPORT_HEADER_TITLE = new Set(["title", "name", "game", "game title"]);
  const IMPORT_HEADER_OTHER = new Set(["", "platform", "system", "store", "year", "release year"]);

  /** @returns {{ rows: object[] } | { error: string }} */
  function parseImportText(raw) {
    const text = String(raw || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    const lineCount = text.split("\n").filter((l) => l.trim()).length;
    if (!lineCount) return { error: "Paste some games first, or choose a .csv file." };
    if (lineCount > IMPORT_MAX_LINES) {
      return {
        error: `That’s ${lineCount.toLocaleString()} lines. The limit is ${IMPORT_MAX_LINES.toLocaleString()} at a time, so split the list and import it in parts.`,
      };
    }
    const delim = text.includes("\t") ? "\t" : ",";
    let records = parseDelimited(text, delim);
    const first = records[0];
    if (first) {
      const low = first.cells.map((c) => c.trim().toLowerCase());
      if (IMPORT_HEADER_TITLE.has(low[0]) && low.slice(1).every((c) => IMPORT_HEADER_OTHER.has(c))) {
        records = records.slice(1);
      }
    }
    const maxYear = importYearMax();
    const rows = records.map(({ line, cells }) => {
      const title = String(cells[0] || "").replace(/\s+/g, " ").trim();
      const platform = String(cells[1] || "").trim();
      const yearText = String(cells[2] || "").trim();
      let error = "";
      let year = null;
      if (!title) error = "No title.";
      else if (yearText) {
        const y = Number(yearText);
        if (!/^\d{4}$/.test(yearText) || y < 1950 || y > maxYear) {
          error = `Year should be a 4-digit year from 1950 to ${maxYear}.`;
        } else year = y;
      }
      return { line, title, platform, year, error };
    });
    if (!rows.length) return { error: "Paste some games first, or choose a .csv file." };
    return { rows };
  }

  function importDefaults() {
    return {
      platform: canonicalPlatform($("#import-default-platform").value),
      status: $("#import-default-status").value || "want",
      format: $("#import-default-format").value === "physical" ? "physical" : "digital",
    };
  }

  function importCandidate(row, defs) {
    return {
      type: "game",
      title: row.title,
      year: row.year,
      platform: canonicalPlatform(row.platform) || defs.platform,
      format: defs.format,
      disc: null,
      barcode: "",
      externalId: "",
      status: defs.status,
      sources: ["csv"],
    };
  }

  /** Classify every row: error, possible duplicate (of the shelf or an earlier line), or new. */
  function evaluateImport() {
    const defs = importDefaults();
    const earlier = []; // { title, platform, year, line } of lines already classed as new
    importEval = importRows.map((row) => {
      if (row.error) return { kind: "error" };
      const cand = importCandidate(row, defs);
      const dup = findDuplicate(cand, null);
      if (dup) return { kind: "dup", dup: dup.item };
      // Same rule as the shelf check (Nathan N3): same title and platform, and a line with
      // no year matches one with a year; two different years are different games.
      const title = normalizeTitle(row.title);
      const hit = earlier.find(
        (e) =>
          e.title === title &&
          samePlatform(e.platform, cand.platform) &&
          (e.year == null || row.year == null || e.year === row.year)
      );
      if (hit) return { kind: "dup", repeatOf: hit.line };
      earlier.push({ title, platform: cand.platform, year: row.year, line: row.line });
      return { kind: "new" };
    });
  }

  function importChoice(i) {
    const ev = importEval[i];
    if (ev.kind === "error") return "skip";
    const own = importChoices.get(importRows[i].line);
    if (own && (own !== "update" || ev.dup)) return own;
    return ev.kind === "dup" ? "skip" : "add";
  }

  function importCounts() {
    const c = { add: 0, update: 0, dupSkipped: 0, skipped: 0, errors: 0 };
    importEval.forEach((ev, i) => {
      const ch = importChoice(i);
      if (ev.kind === "error") c.errors++;
      else if (ch === "add") c.add++;
      else if (ch === "update") c.update++;
      else if (ev.kind === "dup") c.dupSkipped++;
      else c.skipped++;
    });
    return c;
  }

  function plural(n, one, many) {
    return `${n.toLocaleString()} ${n === 1 ? one : many}`;
  }

  function setImportMessage(msg, kind = "error") {
    const el = $("#import-message");
    el.textContent = msg || "";
    el.dataset.kind = kind;
    el.hidden = !msg;
  }

  function setImportFresh(fresh) {
    importFresh = fresh;
    $("#btn-import-preview").hidden = fresh;
    $("#btn-import-commit").hidden = !fresh;
  }

  function importDupText(ev, choice) {
    const verb = choice === "add" ? "Will add" : choice === "update" ? "Will update" : "Skipped";
    if (ev.repeatOf) return `${verb} · Also on line ${ev.repeatOf}`;
    const it = ev.dup;
    const meta = [it.platform, FORMAT_LABELS[it.format] || it.format, it.year].filter(Boolean).join(" · ");
    return `${verb} · You already have “${it.title}”${meta ? ` (${meta})` : ""}`;
  }

  function renderImportPreview() {
    const c = importCounts();
    const parts = [`${c.add.toLocaleString()} to add`];
    if (c.update) parts.push(`${c.update.toLocaleString()} to update`);
    if (c.dupSkipped) parts.push(plural(c.dupSkipped, "duplicate skipped", "duplicates skipped"));
    if (c.skipped) parts.push(`${c.skipped.toLocaleString()} skipped`);
    if (c.errors) parts.push(`${c.errors.toLocaleString()} ${c.errors === 1 ? "needs" : "need"} fixing`);
    $("#import-summary").textContent = parts.join(" · ");

    const html = [];
    let newShown = 0;
    let newHidden = 0;
    importRows.forEach((row, i) => {
      const ev = importEval[i];
      const choice = importChoice(i);
      if (ev.kind === "new" && newShown >= IMPORT_SHOW_NEW) {
        newHidden++;
        return;
      }
      if (ev.kind === "new") newShown++;
      const meta = [canonicalPlatform(row.platform) || importDefaults().platform, row.year].filter(Boolean).join(" · ");
      const titleText = row.title || "(no title)";
      let side = "";
      let note = "";
      if (ev.kind === "error") {
        note = `<p class="import-reason">${escapeHtml(row.error)}</p>`;
      } else if (ev.kind === "dup") {
        // Only duplicates get a menu; new rows are plain text (Oholiab O2). A line to leave
        // out can be deleted from the paste.
        const opts = [["skip", "Skip"], ["add", "Add"], ...(ev.dup ? [["update", "Update"]] : [])];
        const id = `import-choice-${i}`;
        side =
          `<label class="sr-only" for="${id}">Line ${row.line}: ${escapeHtml(titleText)}</label>` +
          `<select class="select import-choice" id="${id}" data-row="${i}">` +
          opts.map(([v, l]) => `<option value="${v}"${v === choice ? " selected" : ""}>${l}</option>`).join("") +
          `</select>`;
        note = `<p class="import-dup">${escapeHtml(importDupText(ev, choice))}</p>`;
      }
      html.push(
        `<li class="import-row is-${ev.kind}">` +
          `<div class="import-row-text"><span class="import-line">Line ${row.line}</span> ` +
          `<span class="import-title">${escapeHtml(titleText)}</span>` +
          (meta ? `<span class="import-meta"> · ${escapeHtml(String(meta))}</span>` : "") +
          note +
          `</div>${side}</li>`
      );
    });
    if (newHidden) {
      html.push(`<li class="import-row import-more">…and ${plural(newHidden, "more new game", "more new games")} to add.</li>`);
    }
    $("#import-rows").innerHTML = html.join("");

    const btn = $("#btn-import-commit");
    const total = c.add + c.update;
    btn.disabled = total === 0;
    btn.textContent = !total
      ? "Nothing to add"
      : c.add && c.update
        ? `Add ${c.add.toLocaleString()} and update ${plural(c.update, "game", "games")}`
        : c.update
          ? `Update ${plural(c.update, "game", "games")}`
          : `Add ${plural(c.add, "game", "games")}`;
    if (!c.add && !c.update && !c.dupSkipped && !c.skipped && c.errors) {
      setImportMessage("Nothing can be added yet. Fix the lines below, then preview again.");
    } else setImportMessage("");
  }

  function previewImport() {
    if (syncFromStorage()) render();
    const parsed = parseImportText($("#import-games-text").value);
    importChoices = new Map();
    if (parsed.error) {
      importRows = [];
      importEval = [];
      $("#import-preview").hidden = true;
      setImportFresh(false);
      setImportMessage(parsed.error);
      return;
    }
    importRows = parsed.rows;
    evaluateImport();
    $("#import-preview").hidden = false;
    setImportFresh(true);
    renderImportPreview();
  }

  function commitImport() {
    if (!importFresh || !importRows.length) return;
    // Another tab may have changed the shelf since the preview: re-check first.
    if (syncFromStorage()) {
      render();
      const before = importEval.map((e) => e.kind).join();
      evaluateImport();
      if (importEval.map((e) => e.kind).join() !== before) {
        renderImportPreview();
        setImportMessage("Your library changed in another tab. Check the preview again, then add.");
        return;
      }
    }
    const defs = importDefaults();
    const now = nowIso();
    const toAdd = [];
    const toUpdate = new Map(); // existing id -> incoming candidate
    importRows.forEach((row, i) => {
      const ch = importChoice(i);
      const cand = importCandidate(row, defs);
      if (ch === "add") {
        toAdd.push(normalizeItem({ ...cand, id: uid(), dateAdded: now, dateUpdated: now, seed: false }));
      } else if (ch === "update" && importEval[i].dup && !toUpdate.has(importEval[i].dup.id)) {
        toUpdate.set(importEval[i].dup.id, normalizeItem({ ...cand, id: "incoming" }));
      }
    });
    if (!toAdd.length && !toUpdate.size) return;
    const previous = new Map();
    commitItems((list) => {
      const next = list.map((it) => {
        const inc = toUpdate.get(it.id);
        if (!inc) return it;
        previous.set(it.id, JSON.parse(JSON.stringify(it)));
        return normalizeItem({ ...mergeIncomingIntoExisting(it, inc, false), dateUpdated: now });
      });
      return [...toAdd, ...next];
    });
    importUndo = {
      addedIds: new Set(toAdd.map((i) => i.id)),
      previous,
      raw: lastSyncedRaw,
      until: Date.now() + IMPORT_UNDO_MS,
    };
    const byId = new Map(items.map((it) => [it.id, it]));
    writeLastImport({
      v: 1,
      at: now,
      added: toAdd.map((it) => ({ id: it.id, fp: itemFingerprint(byId.get(it.id) || it) })),
      updated: [...previous.entries()].map(([id, before]) => ({ id, fp: itemFingerprint(byId.get(id)), before })),
    });
    render();
    $("#import-games-text").value = "";
    importRows = [];
    importEval = [];
    $("#import-preview").hidden = true;
    setImportFresh(false);
    setImportMessage("");
    const n = toAdd.length;
    const u = previous.size;
    const msg = n && u
      ? `Added ${plural(n, "game", "games")} and updated ${u.toLocaleString()}`
      : n
        ? `Added ${plural(n, "game", "games")}`
        : `Updated ${plural(u, "game", "games")}`;
    showToast(msg, { actionLabel: "Undo", onAction: undoImport, duration: IMPORT_UNDO_MS });
  }

  function undoImport() {
    const u = importUndo;
    importUndo = null;
    let current = null;
    try {
      current = localStorage.getItem(STORAGE_KEY);
    } catch {
      current = null;
    }
    // Only while nothing else has been saved since (in this tab or another) and within 10 s.
    if (!u || Date.now() > u.until || current !== u.raw) {
      showToast("Undo isn’t available anymore. Something changed since the import.");
      return;
    }
    commitItems((list) =>
      list.filter((it) => !u.addedIds.has(it.id)).map((it) => u.previous.get(it.id) || it)
    );
    writeLastImport(null); // the import is gone, so there's nothing left to remove
    render();
    showToast("Import undone");
  }

  /* ---------- Remove last import (Nathan N1) ---------- */
  function itemFingerprint(item) {
    if (!item) return "";
    const str = JSON.stringify(normalizeItem(item));
    let h = 0x811c9dc5; // FNV-1a
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return `${str.length}:${(h >>> 0).toString(16)}`;
  }

  function readLastImport() {
    try {
      const rec = JSON.parse(localStorage.getItem(LAST_IMPORT_STORAGE) || "null");
      if (!rec || rec.v !== 1 || !Array.isArray(rec.added) || !Array.isArray(rec.updated)) return null;
      if (!rec.added.length && !rec.updated.length) return null;
      return rec;
    } catch {
      return null;
    }
  }

  function writeLastImport(rec) {
    try {
      if (rec) localStorage.setItem(LAST_IMPORT_STORAGE, JSON.stringify(rec));
      else localStorage.removeItem(LAST_IMPORT_STORAGE);
    } catch {
      /* storage full or blocked: the button just won't show */
    }
    updateLastImportUi();
  }

  /** "today at 10:02", "yesterday at 9:15", "on Sep 25 at 10:02" (PLACEHOLDER). */
  function relativeDayTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((startOf(new Date()) - startOf(d)) / 86400000);
    if (days === 0) return `today at ${time}`;
    if (days === 1) return `yesterday at ${time}`;
    const opts = { month: "short", day: "numeric" };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
    return `on ${d.toLocaleDateString([], opts)} at ${time}`;
  }

  function updateLastImportUi() {
    const box = $("#import-last");
    if (!box) return;
    const rec = readLastImport();
    box.hidden = !rec;
    if (!rec) return;
    const n = rec.added.length + rec.updated.length;
    $("#import-last-line").textContent = `Last import: ${plural(n, "game", "games")}, ${relativeDayTime(rec.at)}.`;
    $("#btn-import-remove-last").textContent = `Remove last import (${plural(n, "game", "games")})`;
  }

  /** What removing the last import would do right now, against fresh storage. */
  function planRemoveLastImport(rec) {
    const byId = new Map(items.map((it) => [it.id, it]));
    const plan = { remove: [], revert: [], kept: 0 };
    for (const a of rec.added) {
      const cur = byId.get(a.id);
      if (!cur) continue; // already deleted
      if (itemFingerprint(cur) === a.fp) plan.remove.push(a.id);
      else plan.kept++;
    }
    for (const u of rec.updated) {
      const cur = byId.get(u.id);
      if (!cur) continue;
      if (itemFingerprint(cur) === u.fp && u.before) plan.revert.push(u);
      else plan.kept++;
    }
    return plan;
  }

  function removeLastImport() {
    if (syncFromStorage()) render();
    const rec = readLastImport();
    if (!rec) {
      updateLastImportUi();
      return;
    }
    const plan = planRemoveLastImport(rec);
    const n = plan.remove.length;
    const m = plan.revert.length;
    // PLACEHOLDER copy (Berean)
    if (!n && !m) {
      writeLastImport(null);
      showToast("Nothing to remove. Every game from your last import was changed or deleted since.");
      return;
    }
    const title = n ? `Remove ${plural(n, "game", "games")} from your last import?` : "Undo the updates from your last import?";
    const parts = [];
    if (m) parts.push(`${plural(m, "game", "games")} it updated ${m === 1 ? "goes" : "go"} back to how ${m === 1 ? "it was" : "they were"}.`);
    if (plan.kept) parts.push(`${plural(plan.kept, "game", "games")} you’ve changed since will be kept.`);
    if (!parts.length) parts.push("This can’t be undone.");
    openConfirm(title, parts.join(" "), () => {
      closeConfirm();
      // Two-tab rule: re-read and re-check right before writing; never touch a game another
      // tab changed after the import.
      let done = { removed: 0, reverted: 0, kept: 0 };
      commitItems((list) => {
        const fresh = readLastImport();
        if (!fresh) return list;
        items = list;
        const p = planRemoveLastImport(fresh);
        done = { removed: p.remove.length, reverted: p.revert.length, kept: p.kept };
        const drop = new Set(p.remove);
        const back = new Map(p.revert.map((u) => [u.id, normalizeItem(u.before)]));
        return list.filter((it) => !drop.has(it.id)).map((it) => back.get(it.id) || it);
      });
      writeLastImport(null);
      render();
      const msg = [];
      if (done.removed) msg.push(`Removed ${plural(done.removed, "game", "games")}`);
      if (done.reverted) msg.push(`${done.removed ? "restored" : "Restored"} ${plural(done.reverted, "updated game", "updated games")}`);
      let text = msg.length ? `${msg.join(" and ")} from your last import.` : "Nothing was removed.";
      if (done.kept) text += ` Kept ${plural(done.kept, "game", "games")} you changed since.`;
      showToast(text);
    }, n ? "Remove" : "Undo updates");
  }

  function readImportFile(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setImportMessage("That file is too large. Split it into smaller files, or paste the rows instead.");
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setImportMessage("Couldn’t read that file. Try again, or paste the rows instead.");
    reader.onload = () => {
      $("#import-games-text").value = String(reader.result || "");
      previewImport();
    };
    reader.readAsText(file);
  }

  function bindImport() {
    const statusSel = $("#import-default-status");
    if (!statusSel) return;
    statusSel.innerHTML = Object.keys(STATUS_LABELS).map((s) => `<option value="${s}">${STATUS_LABELS[s]}</option>`).join("");
    statusSel.value = "want";
    $("#import-games-text").addEventListener("input", () => {
      if (importFresh) setImportFresh(false);
    });
    $("#btn-import-preview").addEventListener("click", previewImport);
    $("#btn-import-commit").addEventListener("click", commitImport);
    $("#btn-import-remove-last").addEventListener("click", removeLastImport);
    updateLastImportUi();
    $("#btn-import-template").addEventListener("click", () =>
      downloadText("title,platform,year\r\n", "freerangemedia-games-template.csv", "text/csv")
    );
    $("#btn-import-csv").addEventListener("click", () => $("#import-csv-file").click());
    $("#import-csv-file").addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = "";
      readImportFile(f);
    });
    const reeval = () => {
      if (!importRows.length) return;
      evaluateImport();
      renderImportPreview();
    };
    $("#import-default-platform").addEventListener("change", reeval);
    $("#import-default-format").addEventListener("change", reeval);
    $("#import-default-status").addEventListener("change", reeval);
    $("#import-rows").addEventListener("change", (e) => {
      const sel = e.target.closest(".import-choice");
      if (!sel) return;
      const i = Number(sel.dataset.row);
      importChoices.set(importRows[i].line, sel.value);
      renderImportPreview();
      const again = document.getElementById(`import-choice-${i}`);
      if (again) again.focus();
    });
  }

  function fillPlatformOptions() {
    const dl = document.getElementById("platform-options");
    if (dl) dl.innerHTML = PLATFORM_SUGGESTIONS.map((p) => `<option value="${escapeHtml(p)}"></option>`).join("");
  }

  async function init() {
    fillPlatformOptions();
    bind();
    bindImport();
    window.addEventListener("storage", onStorageEvent);
    updateFormatOptions();
    await seedIfEmpty();
    render();
    watchForUpdates();
    registerSW();
  }

  init();
})();
