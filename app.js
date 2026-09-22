/* Media Shelf — vanilla SPA, localStorage persistence */
(() => {
  "use strict";

  const STORAGE_KEY = "media-tracker-v1";
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
  let toastTimer = null;
  let html5QrCodeLibPromise = null;
  /** @type {any} */
  let activeScanner = null;
  let lookupBusy = false;

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
    btnScan: $("#btn-scan"),
    btnLookup: $("#btn-lookup"),
    scanStatus: $("#scan-status"),
    qrReader: $("#qr-reader"),
    toast: $("#toast"),
    importFile: $("#import-file"),
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

  function openConfirm(title, desc, onOk, okLabel) {
    $("#confirm-title").textContent = title;
    $("#confirm-desc").textContent = desc;
    $("#confirm-ok").textContent = okLabel || "OK";
    confirmCallback = onOk;
    els.confirm.hidden = false;
    els.confirm.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    $("#confirm-ok").focus();
  }

  function closeConfirm() {
    els.confirm.hidden = true;
    els.confirm.setAttribute("aria-hidden", "true");
    confirmCallback = null;
    if (els.modal.hidden && els.scanModal.hidden) {
      document.body.classList.remove("modal-open");
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
  }

  function exportJson() {
    const payload = {
      version: 1,
      exportedAt: nowIso(),
      app: "Media Shelf",
      items,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = URL.createObjectURL(blob);
    a.download = `media-shelf-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast("Exported");
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        const arr = Array.isArray(data) ? data : data.items;
        if (!Array.isArray(arr)) throw new Error("Invalid file");
        openConfirm(
          "Replace library?",
          `Import ${arr.length} items and replace what’s currently saved?`,
          () => {
            items = arr.map(normalizeItem);
            saveStore();
            closeConfirm();
            showToast(`Imported ${items.length} items`);
            render();
          },
          "Import"
        );
      } catch {
        showToast("Import failed — invalid JSON");
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
      if (!doc) return null;
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
      return null;
    }
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
  }

  async function runLookup() {
    if (lookupBusy) return;
    const type = els.fieldType.value;
    const barcode = els.fieldBarcode.value.trim();
    const title = els.fieldTitle.value.trim();
    const isbnShaped = looksLikeIsbn(barcode);

    if (!barcode && !title) {
      setLookupStatus("Enter a barcode/ISBN or a title to look up.", "error");
      return;
    }

    lookupBusy = true;
    els.btnLookup.disabled = true;
    setLookupStatus("Looking up…");

    try {
      let data = null;

      if (type === "book" || isbnShaped) {
        if (!isbnShaped) {
          setLookupStatus(
            type === "book"
              ? "Books need an ISBN for Open Library lookup. You can still paste a cover URL."
              : "That barcode doesn’t look like an ISBN. Try a title search or paste a cover URL.",
            "error"
          );
          return;
        }
        data = await fetchOpenLibraryByIsbn(barcode);
        if (!data) {
          setLookupStatus("No book match found for that ISBN.", "error");
          return;
        }
        commitLookup(data, "Found via Open Library.");
        return;
      }

      if (type === "movie") {
        const term = title || barcode;
        if (!title && barcode && !isbnShaped) {
          setLookupStatus(
            "Movie barcodes usually aren’t in iTunes. Enter a title, then Lookup — or paste a cover URL.",
            "error"
          );
          return;
        }
        data = await fetchItunes(term, "movie");
        if (!data || !data.title) {
          setLookupStatus("No movie match found. Try a different title or paste a cover URL.", "error");
          return;
        }
        commitLookup(data, "Found via iTunes.");
        return;
      }

      if (type === "game") {
        if (isbnShaped) {
          data = await fetchOpenLibraryByIsbn(barcode);
          if (data) {
            commitLookup(data, "ISBN matched via Open Library (unusual for games).");
            return;
          }
        }
        const term = title || barcode;
        if (!term) {
          setLookupStatus("Enter a game title to search, or paste a cover URL.", "error");
          return;
        }
        data = await fetchItunes(title ? `${title} game` : term, "software");
        if (!data || data._score < 20) {
          const retry = title ? await fetchItunes(title, "software") : null;
          if (retry && retry._score >= 20) data = retry;
        }
        if (!data || !data.coverUrl) {
          setLookupStatus(
            "No solid game match (UPC lookups are limited). Paste a cover URL manually.",
            "error"
          );
          return;
        }
        commitLookup(data, "Found via iTunes (best effort for games).");
        return;
      }

      setLookupStatus("Unsupported type for lookup.", "error");
    } catch {
      setLookupStatus("Lookup failed — check your connection and try again.", "error");
    } finally {
      lookupBusy = false;
      els.btnLookup.disabled = false;
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
    $("#btn-export").addEventListener("click", exportJson);
    $("#btn-import").addEventListener("click", () => els.importFile.click());
    els.importFile.addEventListener("change", () => {
      const file = els.importFile.files && els.importFile.files[0];
      if (file) importJson(file);
      els.importFile.value = "";
    });

    els.list.addEventListener("click", (e) => {
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
    els.fieldType.addEventListener("change", updateFormatOptions);
    els.fieldFormat.addEventListener("change", updateDiscVisibility);
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
