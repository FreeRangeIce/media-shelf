/* Media Shelf — vanilla SPA, localStorage persistence */
(() => {
  "use strict";

  const STORAGE_KEY = "media-tracker-v1";
  const OMDB_KEY_STORAGE = "media-shelf-omdb-key";
  const RAWG_KEY_STORAGE = "media-shelf-rawg-key";
  const LAST_BACKUP_STORAGE = "media-shelf-last-backup";
  const BACKUP_REMINDER_DISMISSED_STORAGE = "media-shelf-backup-reminder-dismissed";
  const BACKUP_APP_ID = "media-shelf";
  const BACKUP_VERSION = 1;
  const BACKUP_STALE_DAYS = 14;
  const BACKUP_SNOOZE_DAYS = 7;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
  const HTML5_QRCODE_CDN =
    "https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js";
  const TYPE_LABELS = { book: "Book", game: "Game", movie: "Movie" };
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
  };
  const CREATOR_HINTS = {
    book: "Author",
    game: "Developer / publisher",
    movie: "Director / studio",
  };

  /** @type {Array<object>} */
  let items = [];
  let filterType = "all";
  let filterStatus = "all";
  let sortMode = "updated";
  let searchQuery = "";
  let searchTimer = null;
  let editingId = null;
  let lastFocus = null;
  let confirmCallback = null;
  let confirmAltCallback = null;
  let confirmReturnFocus = null;
  let toastTimer = null;
  let html5QrCodeLibPromise = null;
  /** @type {any} */
  let activeScanner = null;
  let lookupBusy = false;
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
    apiKeyHint: $("#api-key-hint"),
    btnScan: $("#btn-scan"),
    btnLookup: $("#btn-lookup"),
    scanStatus: $("#scan-status"),
    qrReader: $("#qr-reader"),
    toast: $("#toast"),
    importFile: $("#import-file"),
    confirmOk: $("#confirm-ok"),
    confirmAlt: $("#confirm-alt"),
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
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.items)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function saveStore() {
    const payload = {
      version: 1,
      savedAt: nowIso(),
      items,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  function normalizeItem(raw) {
    const type = ["book", "game", "movie"].includes(raw.type) ? raw.type : "book";
    let format = raw.format;
    if (type === "book") {
      if (!["physical", "digital", "audiobook"].includes(format)) format = "physical";
    } else {
      if (!["physical", "digital"].includes(format)) format = "digital";
    }
    let disc = raw.disc ?? raw.mediaFormat ?? null;
    if (type === "movie" && format === "physical") {
      if (!["blu-ray", "dvd", "vhs"].includes(disc)) disc = "blu-ray";
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
    };
  }

  async function seedIfEmpty() {
    const store = loadStore();
    if (store && Array.isArray(store.items) && store.items.length > 0) {
      items = store.items.map(normalizeItem);
      saveStore();
      return;
    }
    try {
      const res = await fetch("./data/seed.json");
      if (!res.ok) throw new Error("seed fetch failed");
      const data = await res.json();
      items = (Array.isArray(data) ? data : []).map(normalizeItem);
    } catch {
      items = [];
    }
    saveStore();
  }

  function stars(n) {
    if (n == null || !Number.isFinite(n) || n <= 0) return "";
    const full = Math.round(n);
    return "★".repeat(full) + "☆".repeat(5 - full);
  }

  function formatBadgeText(item) {
    const f = FORMAT_LABELS[item.format] || item.format;
    if (item.type === "movie" && item.format === "physical" && item.disc) {
      return `${f} · ${DISC_LABELS[item.disc] || item.disc}`;
    }
    return f;
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

  function upgradeItunesArtwork(url) {
    if (!url) return "";
    return String(url).replace(/100x100bb/g, "600x600bb").replace(/100x100/g, "600x600");
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

  function updateCoverPreview() {
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
    updateDiscVisibility();
  }

  function updateDiscVisibility() {
    const show =
      els.fieldType.value === "movie" && els.fieldFormat.value === "physical";
    els.discRow.hidden = !show;
    els.fieldDisc.required = show;
  }

  function openModal(item) {
    lastFocus = document.activeElement;
    editingId = item ? item.id : null;
    els.modalTitle.textContent = item ? "Edit item" : "Add item";
    els.btnDelete.hidden = !item;
    els.fieldId.value = item ? item.id : "";
    els.fieldType.value = item ? item.type : "book";
    updateFormatOptions();
    els.fieldBarcode.value = item ? item.barcode || "" : "";
    els.fieldTitle.value = item ? item.title : "";
    els.fieldCreator.value = item ? item.creator : "";
    els.fieldYear.value = item && item.year != null ? item.year : "";
    els.fieldStatus.value = item ? item.status : "want";
    els.fieldFormat.value = item ? item.format : els.fieldFormat.value;
    updateDiscVisibility();
    els.fieldDisc.value = item && item.disc ? item.disc : "blu-ray";
    els.fieldRating.value =
      item && item.rating != null ? String(item.rating) : "";
    els.fieldProgress.value = item ? item.progress || "" : "";
    els.fieldTags.value = item ? (item.tags || []).join(", ") : "";
    els.fieldNotes.value = item ? item.notes || "" : "";
    els.fieldCover.value = item ? item.coverUrl || "" : "";
    els.fieldCoverSource.value = item ? item.coverSource || "" : "";
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
   * @param {{ altLabel?: string, onAlt?: () => void, focusAlt?: boolean }} [opts]
   *   Optional second action (e.g. Merge next to Replace).
   */
  function openConfirm(title, desc, onOk, okLabel, opts = {}) {
    confirmReturnFocus = document.activeElement;
    $("#confirm-title").textContent = title;
    $("#confirm-desc").textContent = desc;
    els.confirmOk.textContent = okLabel || "OK";
    confirmCallback = onOk;
    if (opts.altLabel && typeof opts.onAlt === "function") {
      els.confirmAlt.textContent = opts.altLabel;
      els.confirmAlt.hidden = false;
      confirmAltCallback = opts.onAlt;
    } else {
      els.confirmAlt.hidden = true;
      confirmAltCallback = null;
    }
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

  function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.hidden = true;
    }, 2600);
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
    if (type === "movie" && format === "physical") {
      disc = els.fieldDisc.value;
      if (!["blu-ray", "dvd", "vhs"].includes(disc)) disc = "blu-ray";
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
    const ts = nowIso();
    if (editingId) {
      const idx = items.findIndex((i) => i.id === editingId);
      if (idx >= 0) {
        const prev = items[idx];
        items[idx] = normalizeItem({
          ...prev,
          ...data,
          id: prev.id,
          dateAdded: prev.dateAdded,
          dateUpdated: ts,
          seed: false,
        });
      }
      showToast("Updated");
    } else {
      items.unshift(
        normalizeItem({
          ...data,
          dateAdded: ts,
          dateUpdated: ts,
        })
      );
      showToast("Added");
    }
    saveStore();
    closeModal();
    render();
  }

  function deleteCurrent() {
    if (!editingId) return;
    const id = editingId;
    openConfirm(
      "Delete item?",
      "This cannot be undone.",
      () => {
        items = items.filter((i) => i.id !== id);
        saveStore();
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
        items = items.filter((i) => !i.seed);
        saveStore();
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
    const byType = { book: 0, game: 0, movie: 0 };
    const byStatus = { want: 0, in_progress: 0, done: 0, dropped: 0 };
    for (const i of items) {
      byType[i.type] = (byType[i.type] || 0) + 1;
      byStatus[i.status] = (byStatus[i.status] || 0) + 1;
    }
    els.stats.innerHTML = [
      `<span class="stat-pill book"><strong>${byType.book}</strong> books</span>`,
      `<span class="stat-pill game"><strong>${byType.game}</strong> games</span>`,
      `<span class="stat-pill movie"><strong>${byType.movie}</strong> movies</span>`,
      `<span class="stat-pill"><strong>${byStatus.want}</strong> want</span>`,
      `<span class="stat-pill"><strong>${byStatus.in_progress}</strong> in progress</span>`,
      `<span class="stat-pill"><strong>${byStatus.done}</strong> done</span>`,
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
    if (!url) {
      return `<div class="item-cover-placeholder ${type}" aria-hidden="true">${label}</div>`;
    }
    return `<img class="item-cover" src="${escapeHtml(url)}" alt="" loading="lazy" decoding="async" onerror="this.style.display='none';var p=this.nextElementSibling;if(p)p.hidden=false;" /><div class="item-cover-placeholder ${type}" hidden aria-hidden="true">${label}</div>`;
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
        : "Add a book, game, or movie to get started.";
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

  function backupFileName() {
    return `media-shelf-backup-${localDateStamp()}.json`;
  }

  function backupJsonText() {
    return JSON.stringify(buildBackupPayload(), null, 2);
  }

  function downloadText(text, filename) {
    const blob = new Blob([text], { type: "application/json" });
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
    downloadText(backupJsonText(), backupFileName());
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
        .share({ files: [file], title: "Media Shelf backup" })
        .then(() => {
          markBackedUp();
          showToast("Backup saved ✓");
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
      showToast("Backup downloaded — move it to iCloud Drive or Files to keep it safe");
    } catch {
      showToast("Backup failed — try Export instead");
    }
  }

  function backupReminderDue() {
    const hasOwnItems = items.some((i) => !i.seed);
    if (!hasOwnItems) return false;
    const now = Date.now();
    const last = parseTime(readLs(LAST_BACKUP_STORAGE));
    if (last && now - last < BACKUP_STALE_DAYS * DAY_MS) return false;
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
      els.backupLast.textContent = `Last backed up: ${label || "Never"}`;
    }
    if (els.backupStatus) {
      els.backupStatus.textContent = label ? (fresh ? "Up to date" : "Due") : "Never";
      els.backupStatus.dataset.status = fresh ? "set" : "unset";
    }
    if (els.backupBanner) {
      const due = backupReminderDue();
      els.backupBanner.hidden = !due;
      if (due) {
        $("#backup-banner-text").textContent = label
          ? `It’s been a while since your last backup (${label}).`
          : "It’s been a while since your last backup — you haven’t backed up this library yet.";
      }
    }
  }

  /**
   * Parse + validate an Export / Backup file. Accepts:
   *  - new backup: { app: "media-shelf", version: 1, exportedAt, items: [...] }
   *  - older Export: { version: 1, exportedAt, app: "Media Shelf", items: [...] }
   *  - plain array of items
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
      if (data.app && !/^media[\s-]?shelf$/i.test(String(data.app).trim())) {
        throw new Error("That file isn’t a Media Shelf backup.");
      }
      arr = data.items;
      exportedAt = data.exportedAt || data.savedAt || "";
    }
    if (!Array.isArray(arr)) throw new Error("No items found in that file.");
    const valid = arr.filter(
      (r) => r && typeof r === "object" && !Array.isArray(r) && (r.title || r.type)
    );
    if (arr.length && !valid.length) {
      throw new Error("That file doesn’t contain Media Shelf items.");
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
      showToast("That file is too large to be a Media Shelf backup");
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
      const fromLine = `This backup has ${n} item${n === 1 ? "" : "s"}${when ? ` (saved ${when})` : ""}.`;
      const hasCurrent = items.length > 0;
      const desc = hasCurrent
        ? `${fromLine} Merge keeps your current ${items.length} and adds anything new (the newer copy wins when both have the same item). Replace swaps your whole library for the backup.`
        : `${fromLine} Restore it to this browser?`;
      const doReplace = () => {
        items = incoming.slice();
        saveStore();
        closeConfirm();
        render();
        showToast(`Restored ${items.length} item${items.length === 1 ? "" : "s"}`);
      };
      const doMerge = () => {
        const res = mergeItems(items, incoming);
        items = res.items;
        saveStore();
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

  function commitLookup(data, okMsg) {
    const applyEmpty = () => applyLookupFields(data, { overwrite: false });
    applyEmpty();
    if (wouldOverwrite(data)) {
      openConfirm(
        "Overwrite filled fields?",
        "Lookup found details that differ from what’s already in the form. Overwrite title, creator, year, and cover?",
        () => {
          applyLookupFields(data, { overwrite: true });
          closeConfirm();
          setLookupStatus(okMsg || "Details updated.", "ok");
        },
        "Overwrite"
      );
      setLookupStatus("Found a match — empty fields filled. Confirm to overwrite the rest.", "ok");
    } else {
      setLookupStatus(okMsg || "Details filled.", "ok");
    }
  }

  const COVER_SOURCE_LABELS = {
    openlibrary: "Open Library",
    googlebooks: "Google Books",
    itunes: "iTunes",
    wikipedia: "Wikipedia",
    omdb: "OMDb",
    rawg: "RAWG",
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

  function upgradeGoogleBooksImage(url) {
    if (!url) return "";
    let u = String(url).replace(/^http:\/\//i, "https://");
    u = u.replace(/([?&])zoom=\d+/i, "$1zoom=0");
    if (!/[?&]zoom=/i.test(u)) {
      u += (u.includes("?") ? "&" : "?") + "zoom=0";
    }
    return u;
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
        const res = await fetch(`https://api.rawg.io/api/games?${params.toString()}`);
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
          "Want better covers? Add a free OMDb key in Settings.";
      }
      els.apiKeyHint.hidden = false;
      els.apiKeyHint.dataset.focus = "omdb";
    } else if (type === "game" && !getRawgKey()) {
      if (els.apiKeyHintText) {
        els.apiKeyHintText.textContent =
          "Want better covers? Add a free RAWG key in Settings.";
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

  async function fetchOmdb({ title, year }) {
    const key = getOmdbKey();
    if (!key) return null;
    const t = String(title || "").trim();
    if (!t) return null;
    try {
      const params = new URLSearchParams({ apikey: key, t, type: "movie" });
      if (year) params.set("y", String(year));
      const res = await fetch(`https://www.omdbapi.com/?${params.toString()}`);
      if (!res.ok) throw new Error("network");
      const data = await res.json();
      if (!data || data.Response === "False") {
        /* try search */
        const sp = new URLSearchParams({ apikey: key, s: t, type: "movie" });
        const sr = await fetch(`https://www.omdbapi.com/?${sp.toString()}`);
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
        const dr = await fetch(`https://www.omdbapi.com/?${detailParams.toString()}`);
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
      const res = await fetch(`https://api.rawg.io/api/games?${params.toString()}`);
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
      const res = await fetch(`https://openlibrary.org/isbn/${clean}.json`);
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
      const res = await fetch(
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
      const res = await fetch(`https://openlibrary.org/search.json?${params.toString()}`);
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
      const res = await fetch(url);
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
    if (kind === "movie") {
      if (/\b(film|movie|cinema)\b/.test(name)) score += 25;
      if (/\b(album|song|novel|book)\b/.test(name)) score -= 15;
    } else if (kind === "game") {
      if (/\b(video game|game|videogame)\b/.test(name)) score += 25;
      if (/\b(album|song|film|movie|novel)\b/.test(name)) score -= 10;
    } else if (kind === "book") {
      if (/\b(novel|book|novella)\b/.test(name)) score += 15;
      if (/\b(film|movie|album|song|video game)\b/.test(name)) score -= 15;
    }
    return score;
  }

  async function fetchWikipediaSummary(pageTitle) {
    const t = String(pageTitle || "").trim();
    if (!t) return null;
    try {
      const encoded = encodeURIComponent(t.replace(/ /g, "_"));
      const res = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("network");
      const data = await res.json();
      if (!data || data.type === "disambiguation") {
        /* still usable for title/cover sometimes, but skip thin disambiguation */
        if (data && data.type === "disambiguation" && !data.originalimage && !data.thumbnail) {
          return null;
        }
      }
      const coverUrl =
        (data.originalimage && data.originalimage.source) ||
        (data.thumbnail && data.thumbnail.source) ||
        "";
      let year = null;
      const desc = `${data.description || ""} ${data.extract || ""}`;
      const ym = desc.match(/\b((?:18|19|20)\d{2})\b/);
      if (ym) year = Number(ym[1]);
      return {
        title: data.title || t,
        creator: "",
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
        `&limit=5&namespace=0&format=json&origin=*`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("network");
      const data = await res.json();
      const titles = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
      if (!titles.length) return null;
      let best = titles[0];
      let bestScore = -1;
      for (const candidate of titles) {
        const s = scoreWikiOpenSearchTitle(candidate, q, kind);
        if (s > bestScore) {
          bestScore = s;
          best = candidate;
        }
      }
      return fetchWikipediaSummary(best);
    } catch {
      return null;
    }
  }

  async function fetchWikipedia({ title, kind }) {
    const t = String(title || "").trim();
    if (!t) return null;
    const exact = await fetchWikipediaSummary(t);
    if (exact) return exact;
    /* 404 / miss — try opensearch (movies/games especially; books as soft fallback) */
    return fetchWikipediaOpenSearch(t, kind || "book");
  }

  function scoreItunesMatch(result, term) {
    const name = String(result.trackName || result.collectionName || "").toLowerCase();
    const t = term.toLowerCase();
    let score = 0;
    if (name === t) score += 100;
    if (name.includes(t) || t.includes(name)) score += 40;
    const words = t.split(/\s+/).filter(Boolean);
    for (const w of words) {
      if (name.includes(w)) score += 8;
    }
    return score;
  }

  async function fetchItunes(term, entity) {
    try {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=${encodeURIComponent(entity)}&limit=5`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("network");
      const data = await res.json();
      const results = Array.isArray(data.results) ? data.results : [];
      if (!results.length) return null;
      let best = results[0];
      let bestScore = -1;
      for (const r of results) {
        const s = scoreItunesMatch(r, term);
        if (s > bestScore) {
          bestScore = s;
          best = r;
        }
      }
      const art = upgradeItunesArtwork(best.artworkUrl100 || best.artworkUrl60 || "");
      let year = null;
      if (best.releaseDate) {
        const m = String(best.releaseDate).match(/^(18|19|20)\d{2}/);
        if (m) year = Number(m[0]);
      }
      return {
        title: best.trackName || best.collectionName || "",
        creator: best.artistName || "",
        year,
        coverUrl: art,
        coverSource: "itunes",
        _score: bestScore,
      };
    } catch {
      return null;
    }
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
      let data = null;
      try {
        data = await step.run(knownTitle);
      } catch {
        data = null;
      }
      if (!lookupHasUsefulFields(data)) continue;
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
        steps.push(
          {
            label: "iTunes",
            slug: "itunes",
            run: () => fetchItunes(term, "movie"),
          },
          {
            label: "Wikipedia",
            slug: "wikipedia",
            run: (knownTitle) =>
              fetchWikipedia({ title: term || knownTitle || "", kind: "movie" }),
          }
        );
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
            label: "iTunes",
            slug: "itunes",
            run: async () => {
              let data = await fetchItunes(`${term} game`, "software");
              if (!data || data._score < 20) {
                const retry = await fetchItunes(term, "software");
                if (retry && retry._score >= 20) data = retry;
                else if (!data) data = retry;
              }
              if (data && data._score < 15 && !data.coverUrl) return null;
              return data;
            },
          });
          steps.push({
            label: "Wikipedia",
            slug: "wikipedia",
            run: (knownTitle) =>
              fetchWikipedia({ title: term || knownTitle || "", kind: "game" }),
          });
        }
        if (isbnShaped) {
          steps.push({
            label: "Open Library",
            slug: "openlibrary",
            run: () => fetchOpenLibraryByIsbn(barcode),
          });
        }
        if (!steps.length) {
          setLookupStatus("Enter a game title to search, or paste a cover URL.", "error");
          return;
        }
        result = await runLookupWaterfall(steps, tried);
      } else {
        setLookupStatus("Unsupported type for lookup.", "error");
        return;
      }

      if (result && lookupHasUsefulFields(result.data)) {
        const label = result.label || sourceLabel(result.slug);
        commitLookup(result.data, `Matched via ${label}`);
        return;
      }

      const list =
        tried.length > 0
          ? tried.join(", ")
          : "available sources";
      setLookupStatus(`No match across ${list}`, "error");
    } catch {
      setLookupStatus("Lookup failed — check your connection and try again.", "error");
    } finally {
      lookupBusy = false;
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
      if (e.target.closest("a.card-ref, a.ref-link")) return;
      const card = e.target.closest(".item-card");
      if (!card) return;
      const item = items.find((i) => i.id === card.dataset.id);
      if (item) openModal(item);
    });
    els.list.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const card = e.target.closest(".item-card");
      if (!card) return;
      e.preventDefault();
      const item = items.find((i) => i.id === card.dataset.id);
      if (item) openModal(item);
    });

    els.form.addEventListener("submit", saveItem);
    els.btnDelete.addEventListener("click", deleteCurrent);
    els.fieldType.addEventListener("change", () => {
      updateFormatOptions();
      updateReferenceLinks();
      updateApiKeyHint();
    });
    els.fieldFormat.addEventListener("change", updateDiscVisibility);
    els.fieldTitle.addEventListener("input", updateReferenceLinks);
    els.fieldYear.addEventListener("input", updateReferenceLinks);
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

  function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    if (!/^https?:$/.test(location.protocol)) return;
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  async function init() {
    bind();
    updateFormatOptions();
    await seedIfEmpty();
    render();
    registerSW();
  }

  init();
})();
