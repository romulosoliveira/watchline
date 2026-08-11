const DB_NAME = "personal-tv-tracker";
const DB_VERSION = 1;
const APP_NAME = "Watchline";
const DATA_KEY = "tracker-data";
const SETTINGS_KEY = "tvtracker-settings";
const UI_STATE_KEY = "watchline-ui";
const DRIVE_FILE_NAME = "tvtracker-data.json";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const TVMAZE_API = "https://api.tvmaze.com";
const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_IMAGE = "https://image.tmdb.org/t/p/w500";
const TMDB_LANGUAGE = "en-US";
const SHOW_METADATA_LANGUAGE_VERSION = "en-US-shows-v1";
const MOVIE_METADATA_LANGUAGE_VERSION = "en-US-movies-v2";
const FORGOTTEN_SHOW_DAYS = 90;

const state = {
  data: null,
  view: new URLSearchParams(window.location.search).get("view") || "home",
  showFilter: "active",
  movieFilter: "watched",
  showGenreFilter: "all",
  movieGenreFilter: "all",
  showSort: "title-asc",
  movieSort: "title-asc",
  search: "",
  selectedShowId: null,
  selectedMovieId: null,
  addShowQuery: "",
  addShowResults: [],
  episodeFilter: "all",
  busy: false,
  notice: "",
  catalogLoading: false,
  catalogSync: {
    running: false,
    total: 0,
    index: 0,
    updated: 0,
    failed: 0,
    lastTitle: "",
  },
  posterSync: {
    running: false,
    total: 0,
    index: 0,
    updated: 0,
    failed: 0,
    lastTitle: "",
  },
  driveSaving: false,
  driveSaveQueued: false,
  token: null,
  tokenClient: null,
  settings: loadSettings(),
  ui: loadUiState(),
};

const navItems = [
  ["home", "Home", "layout-dashboard"],
  ["shows", "Shows", "monitor-play"],
  ["movies", "Movies", "clapperboard"],
  ["lists", "Lists", "list"],
  ["sync", "Drive", "cloud"],
];

init();

async function init() {
  try {
    document.title = APP_NAME;
    const stored = await idbGet(DATA_KEY);
    state.data = stored || (await loadSeedData());
    state.data.stats = recomputeStats(state.data);
    if (!stored) {
      await persist("import-seed", { autosave: false });
    }
    render();
    window.setTimeout(() => startAutoCatalogSync(), 900);
    window.setTimeout(() => startMoviePosterSync(), 3000);
    window.setInterval(() => startAutoCatalogSync(), 60 * 60 * 1000);
    window.setInterval(() => startMoviePosterSync(), 2 * 60 * 60 * 1000);
    window.addEventListener("online", () => {
      if (hasPendingDriveSave() && canAttemptDriveAutosave()) scheduleDriveAutosave(0);
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && hasPendingDriveSave() && canAttemptDriveAutosave()) scheduleDriveAutosave(0);
    });
  } catch (error) {
    document.querySelector("#app").innerHTML = renderFatalError(error);
  }
}

async function loadSeedData() {
  const response = await fetch("./data/tvtime-seed.json", { cache: "no-store" });
  if (!response.ok) {
    return createEmptyData();
  }
  return response.json();
}

function createEmptyData() {
  return {
    schemaVersion: 1,
    appName: APP_NAME,
    exportedAt: new Date().toISOString(),
    source: "empty",
    shows: [],
    movies: [],
    lists: [],
    localChanges: [],
    sync: {},
  };
}

function render() {
  const focus = captureFocus();
  const scrollPositions = captureScrollPositions();
  const app = document.querySelector("#app");
  app.innerHTML = `
    <div class="layout">
      ${renderSidebar()}
      <main class="main">
        ${renderTopbar()}
        ${renderView()}
      </main>
      ${renderMobileNav()}
    </div>
  `;
  bindDynamicControls();
  refreshIcons();
  restoreFocus(focus);
  restoreScrollPositions(scrollPositions);
}

function renderSidebar() {
  return `
    <aside class="sidebar">
      <div class="brand">
        <img class="brand-mark" src="./assets/watchline-play-192.png" alt="" />
        <div>
          <p class="brand-title">${APP_NAME}</p>
          <p class="brand-subtitle">${formatCount(state.data.stats.watchedEpisodes)} saved episodes</p>
        </div>
      </div>
      <nav class="nav">${renderNavButtons()}</nav>
      ${renderSidebarFooter()}
    </aside>
  `;
}

function renderSidebarFooter() {
  return `
    <div class="sidebar-footer">
      <div class="status-line">
        <span class="status-dot ${state.settings.driveFileId ? "ok" : ""}"></span>
        <span>${driveStatusLabel()}</span>
      </div>
      ${renderMediaStatus()}
      <p>${state.notice || "Data saved in this browser."}</p>
    </div>
  `;
}

function renderMediaStatus() {
  const catalog = state.catalogSync;
  const posters = state.posterSync;
  const lines = [];
  if (catalog.running) {
    lines.push(`
      <div class="status-line">
        <span class="status-dot ok pulse"></span>
        <span>Online episodes ${catalog.index}/${catalog.total}</span>
      </div>
      <p class="sidebar-small">${escapeHtml(catalog.lastTitle || "Updating catalogs...")}</p>
    `);
  } else {
    const cataloged = state.data?.stats?.catalogedShows || 0;
    lines.push(`
      <div class="status-line">
        <span class="status-dot ${cataloged ? "ok" : "warn"}"></span>
        <span>${formatCount(cataloged)} shows with online episodes</span>
      </div>
    `);
  }
  if (posters.running) {
    lines.push(`
      <div class="status-line">
        <span class="status-dot ok pulse"></span>
        <span>Movie metadata ${posters.index}/${posters.total}</span>
      </div>
      <p class="sidebar-small">${escapeHtml(posters.lastTitle || "Fetching movie metadata...")}</p>
    `);
  } else {
    const moviePosters = state.data?.stats?.moviePosters || 0;
    lines.push(`
      <div class="status-line">
        <span class="status-dot ${moviePosters ? "ok" : "warn"}"></span>
        <span>${formatCount(moviePosters)} movies with posters</span>
      </div>
    `);
  }
  return lines.join("");
}

function driveStatusLabel() {
  if (state.driveSaving) return "Saving to Drive...";
  if (hasPendingDriveSave()) return "Pending Drive changes";
  if (state.settings.driveFileId) return "Drive is up to date";
  return "Drive connection pending";
}

function driveSyncSummary() {
  if (hasPendingDriveSave()) return `Local changes have been waiting to upload since ${formatDateTime(state.data.sync.pendingDriveSince)}.`;
  if (state.data?.sync?.lastSavedToDriveAt) return `Last automatic upload: ${formatDateTime(state.data.sync.lastSavedToDriveAt)}.`;
  return `Primary file: ${DRIVE_FILE_NAME}.`;
}

function renderDriveButtonContent() {
  if (state.driveSaving) return `<i data-lucide="loader-circle" class="spin"></i><span>Saving</span>`;
  if (hasPendingDriveSave()) return `<i data-lucide="cloud-upload"></i><span>Pending</span>`;
  if (state.settings.driveFileId) return `<i data-lucide="cloud-check"></i><span>Drive</span>`;
  return `<i data-lucide="cloud"></i><span>Drive</span>`;
}

function refreshBackgroundStatus() {
  const footer = document.querySelector(".sidebar-footer");
  if (footer) footer.outerHTML = renderSidebarFooter();
  refreshIcons();
}

function refreshDriveStatus() {
  document.querySelectorAll("[data-drive-button]").forEach((button) => {
    button.className = `button ${state.settings.driveFileId ? "teal" : "primary"}`;
    button.innerHTML = renderDriveButtonContent();
  });
  const syncStatus = document.querySelector("[data-drive-sync-status]");
  if (syncStatus) syncStatus.textContent = driveStatusLabel();
  const syncDot = document.querySelector("[data-drive-sync-dot]");
  if (syncDot) syncDot.className = `status-dot ${state.driveSaving ? "ok pulse" : hasPendingDriveSave() ? "warn" : state.settings.driveFileId ? "ok" : "warn"}`;
  const syncSummary = document.querySelector("[data-drive-sync-summary]");
  if (syncSummary) syncSummary.textContent = driveSyncSummary();
  const manualSave = document.querySelector("[data-manual-drive-save]");
  if (manualSave) manualSave.disabled = state.driveSaving;
  refreshIcons();
}

function renderMobileNav() {
  return `<nav class="mobile-nav">${renderNavButtons()}</nav>`;
}

function renderNavButtons() {
  return navItems
    .map(
      ([view, label, icon]) => `
        <button class="nav-button ${state.view === view ? "active" : ""}" data-action="view" data-view="${view}" title="${label}">
          <i data-lucide="${icon}"></i>
          <span>${label}</span>
        </button>
      `,
    )
    .join("");
}

function renderTopbar() {
  const titles = {
    home: ["Home", "Your personal queue and library status"],
    shows: ["Shows", "Progress, favorites, and watch later"],
    "add-show": ["Add show", "Find seasons and episodes from a public source"],
    movies: ["Movies", "Imported history and watchlist"],
    lists: ["Lists", "Favorites and personal collections"],
    sync: ["Google Drive", "Your tracker's primary file"],
  };
  const [title, subtitle] = titles[state.view] || titles.home;
  return `
    <header class="topbar">
      <div>
        <h1 class="page-title">${title}</h1>
        <p class="page-kicker">${subtitle}</p>
      </div>
      <div class="toolbar">
        <button class="button ghost" data-action="export-json">
          <i data-lucide="download"></i>
          Export
        </button>
        <button class="button ${state.settings.driveFileId ? "teal" : "primary"}" data-action="goto-sync" data-drive-button>
          ${renderDriveButtonContent()}
        </button>
      </div>
    </header>
  `;
}

function renderView() {
  if (state.selectedShowId) return renderShowDetail();
  if (state.selectedMovieId) return renderMovieDetail();
  if (state.view === "add-show") return renderAddShowView();
  if (state.view === "shows") return renderShowsView();
  if (state.view === "movies") return renderMoviesView();
  if (state.view === "lists") return renderListsView();
  if (state.view === "sync") return renderSyncView();
  return renderHomeView();
}

function renderHomeView() {
  const stats = state.data.stats;
  const continueShows = getShows()
    .filter((show) => show.followed && !show.archived && watchedCount(show) > 0 && hasNextAvailableEpisode(show))
    .sort((a, b) => lastWatchedTimestamp(b) - lastWatchedTimestamp(a))
    .slice(0, 14);
  const laterShows = getShows()
    .filter((show) => show.forLater)
    .sort((a, b) => a.title.localeCompare(b.title))
    .slice(0, 14);
  const favoriteShows = getShows()
    .filter((show) => show.favorite)
    .sort((a, b) => a.title.localeCompare(b.title))
    .slice(0, 14);

  return `
    ${renderStatsSection(stats)}
    ${renderShelf("Continue Watching", "Shows with released episodes left to watch", continueShows, "home:continue")}
    ${renderShelf("Watch Later", "Shows saved for later", laterShows, "home:later")}
    ${renderShelf("Favorites", "Favorites recovered from TV Time", favoriteShows, "home:favorites")}
  `;
}

function renderStatsSection(stats) {
  const collapseId = "home:stats";
  const collapsed = isCollapsed(collapseId);
  return `
    <section class="section stats-section">
      <div class="section-header">
        <div>
          <h3>Statistics</h3>
          <p>Library overview</p>
        </div>
        ${renderCollapseButton(collapseId)}
      </div>
      ${
        collapsed
          ? ""
          : `<div class="stat-grid">
              ${renderStat(stats.watchedEpisodes, "watched episodes")}
              ${renderStat(stats.followedShows, "followed shows")}
              ${renderStat(stats.watchedMovies, "watched movies")}
              ${renderStat(stats.movieWatchlist, "movies on watchlist")}
            </div>`
      }
    </section>
  `;
}

function renderStat(value, label) {
  return `
    <div class="stat">
      <strong>${formatCount(value)}</strong>
      <span>${label}</span>
    </div>
  `;
}

function renderShelf(title, subtitle, shows, collapseId) {
  const collapsed = collapseId ? isCollapsed(collapseId) : false;
  return `
    <section class="section">
      <div class="section-header">
        <div>
          <h3>${title}</h3>
          <p>${subtitle}</p>
        </div>
        ${collapseId ? renderCollapseButton(collapseId) : ""}
      </div>
      ${
        collapsed
          ? ""
          : shows.length
            ? `<div class="scroller" data-scroll-id="${escapeAttr(collapseId || title)}">${shows.map((show) => renderShowCard(show)).join("")}</div>`
            : `<div class="empty">Nothing here yet.</div>`
      }
    </section>
  `;
}

function renderCollapseButton(collapseId) {
  const collapsed = isCollapsed(collapseId);
  return `
    <button class="collapse-button" data-action="toggle-collapse" data-collapse-id="${escapeAttr(collapseId)}" aria-expanded="${collapsed ? "false" : "true"}" title="${collapsed ? "Expand" : "Collapse"}">
      <i data-lucide="${collapsed ? "chevron-right" : "chevron-down"}"></i>
      <span class="sr-only">${collapsed ? "Expand" : "Collapse"}</span>
    </button>
  `;
}

function renderShowsView() {
  const shows = filterShows();
  return `
    <div class="view-actions">
      <button class="button primary" data-action="goto-add-show">
        <i data-lucide="plus"></i>
        Add show
      </button>
      <button class="button" data-action="catalog-force">
        <i data-lucide="refresh-cw"></i>
        Update online episodes
      </button>
    </div>
    <div class="search-row show-search-row">
      <label class="search-box">
        <span class="sr-only">Search shows</span>
        <i data-lucide="search"></i>
        <input class="input" type="search" data-input="search" value="${escapeAttr(state.search)}" autocomplete="off" enterkeyhint="search" placeholder="Search shows" />
      </label>
      <div class="segmented" role="tablist">
        ${renderShowFilterButton("active", "Active")}
        ${renderShowFilterButton("continuing", "Continue")}
        ${renderShowFilterButton("up-to-date", "Up to date")}
        ${renderShowFilterButton("waiting", "Waiting")}
        ${renderShowFilterButton("forgotten", "Forgotten")}
        ${renderShowFilterButton("completed", "Completed")}
        ${renderShowFilterButton("later", "Watch later")}
        ${renderShowFilterButton("favorites", "Favorites")}
        ${renderShowFilterButton("archived", "Archived")}
        ${renderShowFilterButton("all", "All")}
      </div>
    </div>
    ${renderLibraryControls("show")}
    <div data-library-results="show" aria-live="polite">${renderShowLibraryResults(shows)}</div>
  `;
}

function renderShowLibraryResults(shows = filterShows()) {
  return shows.length
    ? `<div class="grid">${shows.map((show) => renderShowCard(show)).join("")}</div>`
    : `<div class="empty">No shows found.</div>`;
}

function renderAddShowView() {
  return `
    <section class="sync-panel">
      <div class="settings-block">
        <h3>Search for a show</h3>
        <div class="settings-row">
          <label class="search-box">
            <span class="sr-only">Show name</span>
            <i data-lucide="search"></i>
            <input class="input" data-input="add-show-query" value="${escapeAttr(state.addShowQuery)}" placeholder="Ex.: The Last of Us" />
          </label>
          <button class="button primary" data-action="search-tvmaze" ${state.busy ? "disabled" : ""}>
            <i data-lucide="search"></i>
            Search
          </button>
        </div>
      </div>
      ${
        state.addShowResults.length
          ? `<div class="source-results">${state.addShowResults.map((result) => renderSourceResult(result)).join("")}</div>`
          : `<div class="empty">Search for a show to import its seasons and episodes.</div>`
      }
    </section>
  `;
}

function renderSourceResult(result) {
  const show = result.show;
  const image = show.image?.medium || show.image?.original || "";
  const meta = [show.premiered?.slice(0, 4), show.status, show.language].filter(Boolean).join(" · ");
  return `
    <article class="source-card">
      <div class="source-poster" style="${image ? `background-image:url('${escapeAttr(image)}')` : coverVars(show.name)}">
        ${image ? "" : `<span class="cover-initial">${initials(show.name)}</span>`}
      </div>
      <div class="source-body">
        <h3>${escapeHtml(show.name)}</h3>
        <p class="card-meta">${escapeHtml(meta || "No metadata")}</p>
        <p>${escapeHtml(stripHtml(show.summary || "").slice(0, 220))}</p>
        <div class="badges">
          ${(show.genres || []).slice(0, 4).map((genre) => `<span class="badge">${escapeHtml(genre)}</span>`).join("")}
        </div>
      </div>
      <div class="source-actions">
        <button class="button teal" data-action="add-tvmaze-show" data-tvmaze-id="${show.id}">
          <i data-lucide="plus"></i>
          Add
        </button>
      </div>
    </article>
  `;
}

function renderFilterButton(kind, value, label) {
  const active = kind === "show" ? state.showFilter === value : state.movieFilter === value;
  return `<button class="${active ? "active" : ""}" data-action="${kind}-filter" data-filter="${value}">${label}</button>`;
}

function renderShowFilterButton(value, label) {
  const active = state.showFilter === value;
  const count = getShows().filter((show) => matchesShowFilter(show, value)).length;
  return `<button class="${active ? "active" : ""}" data-action="show-filter" data-filter="${value}">${label}<span class="filter-count">${formatCount(count)}</span></button>`;
}

function renderLibraryControls(kind) {
  const genres = kind === "show" ? availableShowGenres() : availableMovieGenres();
  const selectedGenre = kind === "show" ? state.showGenreFilter : state.movieGenreFilter;
  const selectedSort = kind === "show" ? state.showSort : state.movieSort;
  const sortOptions =
    kind === "show"
      ? [
          ["title-asc", "A-Z"],
          ["title-desc", "Z-A"],
          ["year-desc", "Year: newest"],
          ["year-asc", "Year: oldest"],
          ["last-watched", "Last watched"],
          ["progress-desc", "Most watched"],
        ]
      : [
          ["title-asc", "A-Z"],
          ["title-desc", "Z-A"],
          ["year-desc", "Year: newest"],
          ["year-asc", "Year: oldest"],
          ["last-watched", "Last watched"],
        ];

  return `
    <div class="library-controls">
      <label>
        <span>Genre</span>
        <select class="select" data-select="${kind}-genre">
          <option value="all">All genres</option>
          ${genres.map((genre) => `<option value="${escapeAttr(genre)}" ${selectedGenre === genre ? "selected" : ""}>${escapeHtml(genre)}</option>`).join("")}
        </select>
      </label>
      <label>
        <span>Sort by</span>
        <select class="select" data-select="${kind}-sort">
          ${sortOptions.map(([value, label]) => `<option value="${value}" ${selectedSort === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}
        </select>
      </label>
    </div>
  `;
}

function renderShowCard(show) {
  const last = lastWatchedEpisode(show) || lastEpisode(show);
  const image = mediaImage(show);
  const year = mediaYear(show.premiered);
  const trackingStatus = showTrackingStatus(show);
  const badges = [
    renderShowTrackingBadge(trackingStatus),
    show.favorite ? `<span class="badge gold">Favorite</span>` : "",
    show.forLater ? `<span class="badge teal">Watch later</span>` : "",
    show.archived ? `<span class="badge">Archived</span>` : "",
  ].join("");
  return `
    <article class="show-card" style="${image ? "" : coverVars(show.title)}">
      <button data-action="open-show" data-id="${escapeAttr(show.id)}">
        ${renderCover(show.title, image)}
        <div class="card-body">
          <h3 class="card-title">${escapeHtml(show.title)}</h3>
          <p class="card-meta">${[`${formatCount(watchedCount(show))} watched eps`, year, last ? `S${last.season}E${last.number}` : ""].filter(Boolean).join(" · ")}</p>
          <div class="badges">${badges}</div>
        </div>
      </button>
    </article>
  `;
}

function renderShowDetail() {
  const show = getShows().find((item) => item.id === state.selectedShowId);
  if (!show) {
    state.selectedShowId = null;
    return renderShowsView();
  }
  const seasons = hasCatalog(show) ? groupCatalogEpisodes(show) : groupEpisodes(show);
  const next = nextEpisode(show);
  const trackingStatus = showTrackingStatus(show);
  const caughtUpLabel = trackingStatus.key === "waiting" ? "Waiting" : trackingStatus.label;
  const progress = hasCatalog(show)
    ? `${formatCount(watchedCount(show))} of ${formatCount(show.catalogEpisodes.length)} episodes watched`
    : `${formatCount(watchedCount(show))} imported episodes`;
  const image = show.image || "";
  return `
    <section class="detail">
      <aside class="detail-cover" style="${image ? "" : coverVars(show.title)}">
        <div class="cover ${image ? "cover-image" : ""}" style="${image ? `background-image:url('${escapeAttr(image)}')` : ""}">
          ${image ? "" : `<span class="cover-initial">${initials(show.title)}</span>`}
        </div>
      </aside>
      <div>
        <button class="button ghost" data-action="back-to-shows">
          <i data-lucide="arrow-left"></i>
          Shows
        </button>
        <h2 class="detail-title">${escapeHtml(show.title)}</h2>
        <p class="page-kicker">${progress}${show.status ? ` · ${escapeHtml(show.status)}` : ""}${lastEpisode(show) ? ` · latest S${lastEpisode(show).season}E${lastEpisode(show).number}` : ""}</p>
        <div class="badges detail-status">${renderShowTrackingBadge(trackingStatus)}</div>
        <div class="detail-actions">
          ${
            next
              ? `<button class="button primary" data-action="watch-next" data-id="${escapeAttr(show.id)}">
                  <i data-lucide="check-circle"></i>
                  Mark S${next.season}E${next.number}
                </button>`
              : `<button class="button teal" disabled>
                  <i data-lucide="badge-check"></i>
                  ${caughtUpLabel}
                </button>`
          }
          <button class="button" data-action="fetch-catalog" data-id="${escapeAttr(show.id)}" ${state.catalogLoading ? "disabled" : ""}>
            <i data-lucide="refresh-cw"></i>
            ${hasCatalog(show) ? "Update episodes" : "Find episodes"}
          </button>
          <button class="icon-button ${show.favorite ? "active" : ""}" data-action="toggle-show" data-field="favorite" data-id="${escapeAttr(show.id)}" title="Favorite">
            <i data-lucide="star"></i>
          </button>
          <button class="icon-button ${show.forLater ? "active" : ""}" data-action="toggle-show" data-field="forLater" data-id="${escapeAttr(show.id)}" title="Watch later">
            <i data-lucide="bookmark"></i>
          </button>
          <button class="icon-button ${show.archived ? "active" : ""}" data-action="toggle-show" data-field="archived" data-id="${escapeAttr(show.id)}" title="Archived">
            <i data-lucide="archive"></i>
          </button>
        </div>
        ${show.summary ? `<p class="detail-summary">${escapeHtml(show.summary)}</p>` : ""}
        ${
          hasCatalog(show)
            ? `<div class="segmented episode-segmented">
                ${renderEpisodeFilterButton("all", "All")}
                ${renderEpisodeFilterButton("unseen", "Unwatched")}
                ${renderEpisodeFilterButton("seen", "Watched")}
              </div>`
            : `<div class="empty catalog-empty">
                This show does not have a complete episode list yet. Use "Find episodes" to load seasons, titles, and dates.
              </div>`
        }
        ${
          seasons.length
            ? seasons.map(([season, episodes]) => (hasCatalog(show) ? renderCatalogSeason(show, season, episodes) : renderHistorySeason(show, season, episodes))).join("")
            : `<div class="empty">No episodes recorded for this show.</div>`
        }
      </div>
    </section>
  `;
}

function renderEpisodeFilterButton(value, label) {
  return `<button class="${state.episodeFilter === value ? "active" : ""}" data-action="episode-filter" data-filter="${value}">${label}</button>`;
}

function renderCatalogSeason(show, season, episodes) {
  const visible = episodes.filter((episode) => {
    const watched = isEpisodeWatched(show, episode);
    if (state.episodeFilter === "seen") return watched;
    if (state.episodeFilter === "unseen") return !watched;
    return true;
  });
  if (!visible.length) return "";
  const collapseId = seasonCollapseId(show, season);
  const collapsed = isCollapsed(collapseId);
  const watchedInSeason = episodes.filter((episode) => isEpisodeWatched(show, episode)).length;
  return `
    <section class="season-block">
      <div class="season-heading">
        <div>
          <h3 class="season-title">${seasonLabel(season)}</h3>
          <p>${formatCount(watchedInSeason)} of ${formatCount(episodes.length)} watched${visible.length !== episodes.length ? ` · ${formatCount(visible.length)} filtered` : ""}</p>
        </div>
        ${renderCollapseButton(collapseId)}
      </div>
      ${collapsed ? "" : `<div class="episode-list">${visible.map((episode) => renderCatalogEpisodeRow(show, episode)).join("")}</div>`}
    </section>
  `;
}

function renderCatalogEpisodeRow(show, episode) {
  const watched = isEpisodeWatched(show, episode);
  const code = `S${episode.season}E${episode.number}`;
  return `
    <article class="episode-row ${watched ? "watched" : ""}">
      <button class="episode-check" data-action="toggle-episode" data-id="${escapeAttr(show.id)}" data-season="${episode.season}" data-episode="${episode.number}" title="${watched ? "Mark as unwatched" : "Mark as watched"}">
        <i data-lucide="${watched ? "check" : "circle"}"></i>
      </button>
      <div class="episode-code">${code}</div>
      <div class="episode-copy">
        <h4>${escapeHtml(episode.title || `Episode ${episode.number}`)}</h4>
        <p>${[episode.airdate ? formatDate(episode.airdate) : "", episode.runtime ? `${episode.runtime} min` : ""].filter(Boolean).join(" · ") || "No date"}</p>
      </div>
      <span class="badge ${watched ? "teal" : ""}">${watched ? "Watched" : "Unwatched"}</span>
    </article>
  `;
}

function renderHistorySeason(show, season, episodes) {
  const collapseId = seasonCollapseId(show, season);
  const collapsed = isCollapsed(collapseId);
  return `
    <section class="season-block">
      <div class="season-heading">
        <div>
          <h3 class="season-title">${seasonLabel(season)}</h3>
          <p>${formatCount(episodes.length)} imported episodes</p>
        </div>
        ${renderCollapseButton(collapseId)}
      </div>
      ${
        collapsed
          ? ""
          : `<div class="episode-grid">
              ${episodes
                .map(
                  (episode) => `
                    <div class="episode-pill">
                      <span>E${episode.number}${episode.times > 1 ? ` · ${episode.times}x` : ""}</span>
                      <button data-action="unwatch-episode" data-id="${escapeAttr(show.id)}" data-season="${episode.season}" data-episode="${episode.number}" title="Remove">
                        <i data-lucide="x"></i>
                      </button>
                    </div>
                  `,
                )
                .join("")}
            </div>`
      }
    </section>
  `;
}

function renderMoviesView() {
  const movies = filterMovies();
  return `
    <div class="view-actions">
      <button class="button" data-action="posters-force">
        <i data-lucide="image"></i>
        Update metadata
      </button>
    </div>
    <div class="search-row">
      <label class="search-box">
        <span class="sr-only">Search movies</span>
        <i data-lucide="search"></i>
        <input class="input" type="search" data-input="search" value="${escapeAttr(state.search)}" autocomplete="off" enterkeyhint="search" placeholder="Search movies" />
      </label>
      <div class="segmented" role="tablist">
        ${renderFilterButton("movie", "watched", "Watched")}
        ${renderFilterButton("movie", "watchlist", "Watchlist")}
        ${renderFilterButton("movie", "favorites", "Favorites")}
        ${renderFilterButton("movie", "all", "All")}
      </div>
    </div>
    ${renderLibraryControls("movie")}
    <div data-library-results="movie" aria-live="polite">${renderMovieLibraryResults(movies)}</div>
  `;
}

function renderMovieLibraryResults(movies = filterMovies()) {
  return movies.length
    ? `<div class="grid">${movies.map((movie) => renderMovieCard(movie)).join("")}</div>`
    : `<div class="empty">No movies found.</div>`;
}

function renderMovieCard(movie) {
  const year = mediaYear(movie.releaseDate);
  const image = mediaImage(movie);
  const meta = [movie.watched ? "watched" : movie.watchlist ? "watchlist" : "", year].filter(Boolean).join(" · ");
  return `
    <article class="movie-card" style="${image ? "" : coverVars(movie.title)}">
      <button data-action="open-movie" data-id="${escapeAttr(movie.id)}">
        ${renderCover(movie.title, image)}
        <div class="card-body">
          <h3 class="card-title">${escapeHtml(movie.title)}</h3>
          <p class="card-meta">${escapeHtml(meta || "no date")}</p>
          <div class="badges">
            ${movie.favorite ? `<span class="badge gold">Favorite</span>` : ""}
            ${movie.watchlist ? `<span class="badge teal">Watchlist</span>` : ""}
            ${movie.watched ? `<span class="badge red">Watched</span>` : ""}
          </div>
        </div>
      </button>
    </article>
  `;
}

function renderMovieDetail() {
  const movie = getMovies().find((item) => item.id === state.selectedMovieId);
  if (!movie) {
    state.selectedMovieId = null;
    return renderMoviesView();
  }
  const image = mediaImage(movie);
  const year = mediaYear(movie.releaseDate);
  const runtime = movie.runtimeSeconds ? `${Math.round(Number(movie.runtimeSeconds) / 60)} min` : "";
  const meta = [year, runtime, movie.rating ? `TMDb ${Number(movie.rating).toFixed(1)}` : ""].filter(Boolean).join(" · ");
  const summary = movie.summary || movie.overview || "";
  return `
    <section class="detail">
      <aside class="detail-cover" style="${image ? "" : coverVars(movie.title)}">
        <div class="cover ${image ? "cover-image" : ""}" style="${image ? `background-image:url('${escapeAttr(image)}')` : ""}">
          ${image ? "" : `<span class="cover-initial">${initials(movie.title)}</span>`}
        </div>
      </aside>
      <div>
        <button class="button ghost" data-action="back-to-movies">
          <i data-lucide="arrow-left"></i>
          Movies
        </button>
        <h2 class="detail-title">${escapeHtml(movie.title)}</h2>
        <p class="page-kicker">${escapeHtml(meta || "No metadata")}</p>
        <div class="detail-actions">
          <button class="button ${movie.watched ? "teal" : "primary"}" data-action="toggle-movie" data-field="watched" data-id="${escapeAttr(movie.id)}">
            <i data-lucide="${movie.watched ? "check-circle" : "circle"}"></i>
            ${movie.watched ? "Watched" : "Mark as watched"}
          </button>
          <button class="icon-button ${movie.favorite ? "active" : ""}" data-action="toggle-movie" data-field="favorite" data-id="${escapeAttr(movie.id)}" title="Favorite">
            <i data-lucide="star"></i>
          </button>
          <button class="icon-button ${movie.watchlist ? "active" : ""}" data-action="toggle-movie" data-field="watchlist" data-id="${escapeAttr(movie.id)}" title="Watchlist">
            <i data-lucide="bookmark"></i>
          </button>
          <button class="button" data-action="fetch-movie-details" data-id="${escapeAttr(movie.id)}" ${state.busy ? "disabled" : ""}>
            <i data-lucide="refresh-cw"></i>
            Update details
          </button>
        </div>
        ${
          summary
            ? `<p class="detail-summary">${escapeHtml(summary)}</p>`
            : `<div class="empty catalog-empty">No synopsis is available for this movie yet. Configure TMDb and use "Update details".</div>`
        }
        ${renderMovieFacts(movie)}
      </div>
    </section>
  `;
}

function renderMovieFacts(movie) {
  const facts = [
    movie.watchedAt ? ["Watched on", formatDateTime(movie.watchedAt)] : null,
    mediaYear(movie.releaseDate) ? ["Release date", formatDate(movie.releaseDate)] : null,
    movie.originalTitle && movie.originalTitle !== movie.title ? ["Original title", movie.originalTitle] : null,
    movie.genres?.length ? ["Genres", movie.genres.join(", ")] : null,
    movie.external?.imdbId ? ["IMDb", movie.external.imdbId] : null,
  ].filter(Boolean);
  if (!facts.length) return "";
  return `
    <div class="fact-grid">
      ${facts.map(([label, value]) => `<div class="fact"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}
    </div>
  `;
}

function renderListsView() {
  const lists = state.data.lists || [];
  const favoriteShows = getShows()
    .filter((show) => show.favorite)
    .sort((a, b) => a.title.localeCompare(b.title));
  const favoriteMovies = getMovies()
    .filter((movie) => movie.favorite)
    .sort((a, b) => a.title.localeCompare(b.title));
  return `
    <div class="list-dashboard">
      ${renderFavoriteCollection("Favorite shows", "Marked as favorites in TV Time or here", favoriteShows, "show", "lists:favorite-shows")}
      ${renderFavoriteCollection("Favorite movies", "Favorite movies preserved from the import", favoriteMovies, "movie", "lists:favorite-movies")}
      ${renderImportedLists(lists)}
    </div>
  `;
}

function renderFavoriteCollection(title, subtitle, items, type, collapseId) {
  const collapsed = isCollapsed(collapseId);
  return `
    <section class="section">
      <div class="section-header">
        <div>
          <h3>${title}</h3>
          <p>${subtitle} · ${formatCount(items.length)} items</p>
        </div>
        ${renderCollapseButton(collapseId)}
      </div>
      ${
        collapsed
          ? ""
          : items.length
            ? `<div class="mini-grid">${items.map((item) => renderFavoriteTile(item, type)).join("")}</div>`
            : `<div class="empty">No favorites found.</div>`
      }
    </section>
  `;
}

function renderFavoriteTile(item, type) {
  const image = mediaImage(item);
  const title = item.title || "Untitled";
  const year = mediaYear(item.releaseDate);
  const meta =
    type === "show"
      ? `${formatCount(watchedCount(item))} watched eps${hasCatalog(item) ? ` · ${formatCount(item.catalogEpisodes.length)} available` : ""}`
      : [item.watched ? "watched" : "", year || "no year"].filter(Boolean).join(" · ");
  const cover = renderCover(title, image);
  const body = `
    ${cover}
    <div class="card-body">
      <h3 class="card-title">${escapeHtml(title)}</h3>
      <p class="card-meta">${escapeHtml(meta)}</p>
    </div>
  `;
  return `
    <article class="mini-card" style="${image ? "" : coverVars(title)}">
      ${
        type === "show"
          ? `<button data-action="open-show" data-id="${escapeAttr(item.id)}">${body}</button>`
          : `<button data-action="open-movie" data-id="${escapeAttr(item.id)}">${body}</button>`
      }
    </article>
  `;
}

function renderImportedLists(lists) {
  const collapseId = "lists:imported";
  const collapsed = isCollapsed(collapseId);
  return `
    <section class="section">
      <div class="section-header">
        <div>
          <h3>Imported lists</h3>
          <p>Original lists recovered from TV Time</p>
        </div>
        ${renderCollapseButton(collapseId)}
      </div>
      ${
        collapsed
          ? ""
          : lists.length
            ? `<div class="list-grid">${lists.map((list) => renderImportedListCard(list)).join("")}</div>`
            : `<div class="empty">No imported lists.</div>`
      }
    </section>
  `;
}

function renderImportedListCard(list) {
  const items = list.items || [];
  const resolvedItems = items.map(resolveListItem).filter(Boolean);
  return `
    <article class="list-card">
      <div class="card-body">
        <h3>${escapeHtml(list.name)}</h3>
        <p class="card-meta">${formatCount(items.length)} items</p>
        <div class="badges">
          <span class="badge teal">${items.filter((item) => item.type === "show").length} shows</span>
          <span class="badge gold">${items.filter((item) => item.type === "movie").length} movies</span>
        </div>
        ${
          resolvedItems.length
            ? `<div class="list-items">${resolvedItems.map((item) => `<span>${escapeHtml(item.title)}</span>`).join("")}</div>`
            : `<p class="card-meta">Items without a local match.</p>`
        }
      </div>
    </article>
  `;
}

function resolveListItem(item) {
  if (item.type === "show") {
    const show = getShows().find((candidate) => {
      if (item.refId && candidate.id === item.refId) return true;
      if (item.tvtimeId && String(candidate.tvtimeId) === String(item.tvtimeId)) return true;
      return false;
    });
    return show ? { type: "show", title: show.title, media: show } : null;
  }
  if (item.type === "movie") {
    const movie = getMovies().find((candidate) => {
      if (item.refId && candidate.id === item.refId) return true;
      if (item.tvtimeUuid && candidate.tvtimeUuid === item.tvtimeUuid) return true;
      if (item.tvtimeId && String(candidate.tvtimeId) === String(item.tvtimeId)) return true;
      return false;
    });
    return movie ? { type: "movie", title: movie.title, media: movie } : null;
  }
  return null;
}

function renderSyncView() {
  const hasDrive = Boolean(state.settings.driveFileId);
  const clientId = state.settings.googleClientId || "";
  const tmdbToken = state.settings.tmdbToken || "";
  return `
    <section class="sync-panel">
      <div class="settings-block">
        <h3>Google Drive</h3>
        <div class="status-line">
          <span class="status-dot ${state.driveSaving ? "ok pulse" : hasPendingDriveSave() ? "warn" : hasDrive ? "ok" : "warn"}" data-drive-sync-dot></span>
          <span data-drive-sync-status>${hasDrive ? driveStatusLabel() : "No file connected yet"}</span>
        </div>
        <div class="settings-row">
          <input class="input" data-input="google-client-id" value="${escapeAttr(clientId)}" autocomplete="off" spellcheck="false" inputmode="url" placeholder="Google OAuth Client ID" />
          <button class="button primary" data-action="connect-drive">
            <i data-lucide="key-round"></i>
            Connect
          </button>
        </div>
        ${clientId ? `<p class="card-meta">Saved Client ID: ${escapeHtml(summarizeClientId(clientId))}</p>` : ""}
        <div class="detail-actions">
          <button class="button teal" data-action="save-drive" data-manual-drive-save ${state.driveSaving ? "disabled" : ""}>
            <i data-lucide="cloud-upload"></i>
            Save to Drive
          </button>
          <button class="button" data-action="load-drive">
            <i data-lucide="cloud-download"></i>
            Load from Drive
          </button>
          <button class="button ghost" data-action="export-json">
            <i data-lucide="download"></i>
            Download JSON
          </button>
        </div>
        ${hasDrive ? `<p class="card-meta" data-drive-sync-summary>${driveSyncSummary()}</p>` : ""}
      </div>
      <div class="settings-block">
        <h3>Movie metadata</h3>
        <div class="status-line">
          <span class="status-dot ${tmdbToken ? "ok" : "warn"}"></span>
          <span>${tmdbToken ? "TMDb configured" : "TMDb Read Access Token pending"}</span>
        </div>
        <div class="settings-row">
          <input class="input" data-input="tmdb-token" type="password" value="${escapeAttr(tmdbToken)}" placeholder="TMDb Read Access Token" />
          <button class="button" data-action="posters-force">
            <i data-lucide="image"></i>
            Fetch posters and metadata
          </button>
        </div>
      </div>
      <div class="settings-block">
        <h3>Import file</h3>
        <div class="settings-row">
          <input class="input" type="file" accept="application/json,.json" data-input="import-json" />
          <button class="button" data-action="reset-seed">
            <i data-lucide="rotate-ccw"></i>
            Restore original import
          </button>
        </div>
      </div>
      <div class="settings-block">
        <h3>Local status</h3>
        <p class="card-meta">
          Updated on ${formatDateTime(state.data.updatedAt)} · ${formatCount(state.data.localChanges?.length || 0)} local changes.
        </p>
      </div>
    </section>
  `;
}

let librarySearchTimer = null;

function bindActionControls(root = document) {
  root.querySelectorAll("[data-action]").forEach((node) => {
    node.addEventListener("click", handleAction);
  });
}

function bindDynamicControls() {
  bindActionControls();
  document.querySelectorAll("[data-input='search']").forEach((node) => {
    node.addEventListener("input", (event) => {
      state.search = event.target.value;
      scheduleLibrarySearchRefresh();
    });
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        refreshLibrarySearchResults();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.target.value = "";
        state.search = "";
        refreshLibrarySearchResults();
      }
    });
  });
  document.querySelectorAll("[data-input='add-show-query']").forEach((node) => {
    node.addEventListener("input", (event) => {
      state.addShowQuery = event.target.value;
    });
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        searchTvmaze();
      }
    });
  });
  document.querySelectorAll("[data-input='google-client-id']").forEach((node) => {
    node.addEventListener("input", (event) => {
      state.settings.googleClientId = event.target.value.trim();
      saveSettings();
    });
  });
  document.querySelectorAll("[data-input='tmdb-token']").forEach((node) => {
    node.addEventListener("input", (event) => {
      state.settings.tmdbToken = event.target.value.trim();
      saveSettings();
    });
    node.addEventListener("change", () => {
      if (!state.settings.tmdbToken) return;
      startAutoCatalogSync();
      startMoviePosterSync();
    });
  });
  document.querySelectorAll("[data-input='import-json']").forEach((node) => {
    node.addEventListener("change", importJsonFile);
  });
  document.querySelectorAll("[data-select]").forEach((node) => {
    node.addEventListener("change", (event) => {
      const value = event.target.value;
      if (event.target.dataset.select === "show-genre") state.showGenreFilter = value;
      if (event.target.dataset.select === "movie-genre") state.movieGenreFilter = value;
      if (event.target.dataset.select === "show-sort") state.showSort = value;
      if (event.target.dataset.select === "movie-sort") state.movieSort = value;
      render();
    });
  });
  bindScrollerGuards();
}

function scheduleLibrarySearchRefresh(delay = 280) {
  window.clearTimeout(librarySearchTimer);
  librarySearchTimer = window.setTimeout(refreshLibrarySearchResults, delay);
}

function refreshLibrarySearchResults() {
  window.clearTimeout(librarySearchTimer);
  const kind = state.view === "shows" ? "show" : state.view === "movies" ? "movie" : null;
  if (!kind) return;
  const container = document.querySelector(`[data-library-results='${kind}']`);
  if (!container) return;
  container.innerHTML = kind === "show" ? renderShowLibraryResults() : renderMovieLibraryResults();
  bindActionControls(container);
  refreshIcons();
}

function bindScrollerGuards() {
  document.querySelectorAll(".scroller").forEach((scroller) => {
    let startX = 0;
    let startY = 0;
    let dragged = false;
    scroller.addEventListener("pointerdown", (event) => {
      startX = event.clientX;
      startY = event.clientY;
      dragged = false;
    });
    scroller.addEventListener(
      "pointermove",
      (event) => {
        if (Math.abs(event.clientX - startX) > 8 && Math.abs(event.clientX - startX) > Math.abs(event.clientY - startY)) {
          dragged = true;
        }
      },
      { passive: true },
    );
    scroller.addEventListener("pointerup", () => {
      if (dragged) scroller.dataset.suppressClickUntil = String(Date.now() + 300);
    });
    scroller.addEventListener(
      "click",
      (event) => {
        if (Date.now() < Number(scroller.dataset.suppressClickUntil || 0)) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
        }
      },
      true,
    );
  });
}

async function handleAction(event) {
  const button = event.currentTarget;
  const action = button.dataset.action;
  if (action === "view") {
    state.view = button.dataset.view;
    state.selectedShowId = null;
    state.selectedMovieId = null;
    state.search = "";
    render();
    return;
  }
  if (action === "goto-sync") {
    state.view = "sync";
    state.selectedShowId = null;
    state.selectedMovieId = null;
    render();
    return;
  }
  if (action === "goto-add-show") {
    state.view = "add-show";
    state.selectedShowId = null;
    state.selectedMovieId = null;
    state.addShowResults = [];
    render();
    return;
  }
  if (action === "search-tvmaze") {
    await searchTvmaze();
    return;
  }
  if (action === "add-tvmaze-show") {
    await addTvmazeShow(Number(button.dataset.tvmazeId));
    return;
  }
  if (action === "fetch-catalog") {
    await fetchCatalogForShow(button.dataset.id);
    return;
  }
  if (action === "catalog-force") {
    startAutoCatalogSync({ force: true });
    return;
  }
  if (action === "posters-force") {
    startAutoCatalogSync();
    startMoviePosterSync({ force: true });
    return;
  }
  if (action === "open-show") {
    state.selectedShowId = button.dataset.id;
    state.selectedMovieId = null;
    render();
    return;
  }
  if (action === "open-movie") {
    state.selectedMovieId = button.dataset.id;
    state.selectedShowId = null;
    state.view = "movies";
    render();
    return;
  }
  if (action === "back-to-shows") {
    state.selectedShowId = null;
    state.view = "shows";
    render();
    return;
  }
  if (action === "back-to-movies") {
    state.selectedMovieId = null;
    state.view = "movies";
    render();
    return;
  }
  if (action === "show-filter") {
    state.showFilter = button.dataset.filter;
    render();
    return;
  }
  if (action === "movie-filter") {
    state.movieFilter = button.dataset.filter;
    render();
    return;
  }
  if (action === "episode-filter") {
    state.episodeFilter = button.dataset.filter;
    render();
    return;
  }
  if (action === "toggle-show") {
    await toggleShowField(button.dataset.id, button.dataset.field);
    return;
  }
  if (action === "watch-next") {
    await markNextEpisode(button.dataset.id);
    return;
  }
  if (action === "unwatch-episode") {
    await unwatchEpisode(button.dataset.id, Number(button.dataset.season), Number(button.dataset.episode));
    return;
  }
  if (action === "toggle-episode") {
    await toggleEpisode(button.dataset.id, Number(button.dataset.season), Number(button.dataset.episode));
    return;
  }
  if (action === "toggle-movie") {
    await toggleMovieField(button.dataset.id, button.dataset.field);
    return;
  }
  if (action === "fetch-movie-details") {
    await fetchMovieDetailsForMovie(button.dataset.id);
    return;
  }
  if (action === "connect-drive") {
    await connectDrive();
    return;
  }
  if (action === "save-drive") {
    await saveToDrive({ interactive: true });
    return;
  }
  if (action === "load-drive") {
    await loadFromDrive();
    return;
  }
  if (action === "export-json") {
    exportJson();
    return;
  }
  if (action === "reset-seed") {
    const confirmed = window.confirm("Restore the original import on this device? Current local changes will be replaced, but the Drive file will not be changed automatically.");
    if (!confirmed) return;
    await resetToSeed();
    return;
  }
  if (action === "toggle-collapse") {
    toggleCollapse(button.dataset.collapseId);
  }
}

async function searchTvmaze() {
  const query = state.addShowQuery.trim();
  if (!query) {
    state.notice = "Enter a show name.";
    render();
    return;
  }
  state.busy = true;
  state.notice = "Searching for shows...";
  render();
  try {
    state.addShowResults = await searchTvmazeShows(query, { expanded: true });
    state.notice = state.addShowResults.length ? "Choose the correct show." : "No results found.";
  } catch (error) {
    state.notice = `TVmaze: ${error.message}`;
  } finally {
    state.busy = false;
    render();
  }
}

async function addTvmazeShow(tvmazeId) {
  const result = state.addShowResults.find((item) => item.show.id === tvmazeId);
  if (!result) return;
  state.busy = true;
  state.notice = "Loading episodes...";
  render();
  try {
    const episodes = await fetchTvmazeEpisodes(tvmazeId);
    const existing = findExistingShowForTvmaze(result.show);
    const show = existing || createShowFromTvmaze(result.show);
    mergeTvmazeData(show, result.show, episodes);
    await updateShowEnglishMetadataIfConfigured(show, result.show);
    if (!existing) {
      state.data.shows = [...getShows(), show].sort((a, b) => a.title.localeCompare(b.title));
    }
    show.followed = true;
    show.active = true;
    addLocalChange("show:add-tvmaze", { id: show.id, tvmazeId });
    state.selectedShowId = show.id;
    state.selectedMovieId = null;
    state.view = "shows";
    await persist("add-tvmaze-show", { autosave: true });
    state.notice = `${show.title} added with ${episodes.length} episodes.`;
  } catch (error) {
    state.notice = `TVmaze: ${error.message}`;
  } finally {
    state.busy = false;
    render();
  }
}

async function fetchCatalogForShow(id) {
  const show = getShows().find((item) => item.id === id);
  if (!show) return;
  state.catalogLoading = true;
  state.notice = `Fetching episodes for ${show.title}...`;
  render();
  try {
    const count = await updateCatalogForShow(show);
    await persist("fetch-catalog", { autosave: true });
    state.notice = `${count} episodes loaded for ${show.title}.`;
  } catch (error) {
    state.notice = `TVmaze: ${error.message}`;
  } finally {
    state.catalogLoading = false;
    render();
  }
}

async function updateCatalogForShow(show) {
  const resolved = await resolveTvmazeCatalog(show);
  if (!resolved) {
    throw new Error("No reliable match was found.");
  }
  const { tvmazeShow, episodes } = resolved;
  mergeTvmazeData(show, tvmazeShow, episodes);
  await updateShowEnglishMetadataIfConfigured(show, tvmazeShow);
  addLocalChange("show:catalog-tvmaze", { id: show.id, tvmazeId: tvmazeShow.id, episodes: episodes.length });
  return episodes.length;
}

function startAutoCatalogSync({ force = false } = {}) {
  if (!state.data || state.catalogSync.running) return;
  const candidates = getShows()
    .filter((show) => isRelevantShow(show))
    .filter((show) => force || shouldRefreshCatalog(show));
  state.catalogSync = {
    running: candidates.length > 0,
    total: candidates.length,
    index: 0,
    updated: 0,
    failed: 0,
    lastTitle: "",
  };
  if (!candidates.length) {
    return;
  }
  refreshBackgroundStatus();
  runCatalogQueue(candidates);
}

function startMoviePosterSync({ force = false } = {}) {
  if (!state.data || state.posterSync.running) return;
  if (!state.settings.tmdbToken) {
    if (force) {
      state.notice = "Enter a TMDb Read Access Token to fetch movie metadata.";
      render();
    }
    return;
  }
  const candidates = getMovies()
    .filter((movie) => movie.title)
    .filter((movie) => force || shouldRefreshMoviePoster(movie));
  state.posterSync = {
    running: candidates.length > 0,
    total: candidates.length,
    index: 0,
    updated: 0,
    failed: 0,
    lastTitle: "",
  };
  if (!candidates.length) return;
  refreshBackgroundStatus();
  runMoviePosterQueue(candidates);
}

async function fetchMovieDetailsForMovie(id) {
  const movie = getMovies().find((item) => item.id === id);
  if (!movie) return;
  if (!state.settings.tmdbToken) {
    state.notice = "Enter a TMDb Read Access Token to fetch the synopsis and details.";
    render();
    return;
  }
  state.busy = true;
  state.notice = `Fetching details for ${movie.title}...`;
  render();
  try {
    const found = await updateMovieFromTmdb(movie, { includeDetails: true });
    if (!found) {
      state.notice = `TMDb: ${movie.title} was not found.`;
    } else {
      addLocalChange("movie:details-tmdb", { id: movie.id, tmdbId: movie.external?.tmdbId || null });
      await persist("movie-details", { autosave: true });
      state.notice = `Details updated for ${movie.title}.`;
    }
  } catch (error) {
    state.notice = `TMDb: ${error.message}`;
  } finally {
    state.busy = false;
    render();
  }
}

async function runMoviePosterQueue(candidates) {
  for (const movie of candidates) {
    state.posterSync.index += 1;
    state.posterSync.lastTitle = movie.title;
    refreshBackgroundStatus();
    try {
      const poster = await fetchMoviePoster(movie);
      movie.posterUpdatedAt = new Date().toISOString();
      if (poster) state.posterSync.updated += 1;
      addLocalChange("movie:poster-tmdb", { id: movie.id, found: Boolean(poster) });
      if (state.posterSync.index % 10 === 0) {
        await persist("movie-posters-partial", { autosave: false });
      }
    } catch (error) {
      movie.posterError = error.message;
      state.posterSync.failed += 1;
    }
    await sleep(4200);
  }
  state.posterSync.running = false;
  state.posterSync.lastTitle = "";
  await persist("movie-posters", { autosave: true });
  state.notice = `Movie metadata updated: ${state.posterSync.updated}; failures: ${state.posterSync.failed}.`;
  render();
}

function shouldRefreshMoviePoster(movie) {
  if (movie.metadataLanguageVersion !== MOVIE_METADATA_LANGUAGE_VERSION) return true;
  if (mediaImage(movie) && (movie.summary || movie.overview) && movie.genres?.length) return false;
  const updatedAt = parseDateValue(movie.posterUpdatedAt);
  if (!updatedAt) return true;
  return Date.now() - updatedAt > 7 * 24 * 60 * 60 * 1000;
}

async function fetchMoviePoster(movie) {
  const found = await updateMovieFromTmdb(movie);
  return found ? mediaImage(movie) : null;
}

async function updateMovieFromTmdb(movie, { includeDetails = false } = {}) {
  const needsEnglishMetadata = movie.metadataLanguageVersion !== MOVIE_METADATA_LANGUAGE_VERSION;
  let result = movie.external?.tmdbId ? await fetchTmdbMovieDetails(movie.external.tmdbId) : await findTmdbMovie(movie);
  if (!result) return false;
  mergeTmdbMovieData(movie, result);
  if ((includeDetails || needsEnglishMetadata) && !result.runtime) {
    const details = await fetchTmdbMovieDetails(result.id);
    mergeTmdbMovieData(movie, details);
  }
  movie.metadataLanguageVersion = MOVIE_METADATA_LANGUAGE_VERSION;
  movie.posterUpdatedAt = new Date().toISOString();
  movie.updatedAt = new Date().toISOString();
  return true;
}

async function findTmdbMovie(movie) {
  const params = new URLSearchParams({
    query: movie.title,
    include_adult: "false",
    language: TMDB_LANGUAGE,
  });
  const year = mediaYear(movie.releaseDate);
  if (year) params.set("year", year);
  let results = await searchTmdbMovie(params);
  if (!results.length && year) {
    params.delete("year");
    results = await searchTmdbMovie(params);
  }
  const result = bestMoviePosterMatch(movie, results);
  return result || null;
}

async function fetchTmdbMovieDetails(tmdbId) {
  const response = await fetch(`${TMDB_API}/movie/${encodeURIComponent(tmdbId)}?language=${TMDB_LANGUAGE}`, {
    headers: {
      Authorization: `Bearer ${state.settings.tmdbToken}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(response.statusText);
  return response.json();
}

function mergeTmdbMovieData(movie, tmdbMovie) {
  const poster = tmdbMovie.poster_path ? `${TMDB_IMAGE}${tmdbMovie.poster_path}` : null;
  const originalLanguage = tmdbMovie.original_language || movie.originalLanguage || null;
  const preferredTitle = tmdbMovie.title || tmdbMovie.original_title;
  movie.importedTitle = movie.importedTitle || movie.title || null;
  movie.title = preferredTitle || movie.title;
  movie.poster = poster || movie.poster || null;
  movie.image = movie.poster || movie.image || null;
  movie.summary = tmdbMovie.overview || movie.summary || movie.overview || null;
  movie.overview = movie.summary;
  movie.originalTitle = tmdbMovie.original_title || movie.originalTitle || null;
  movie.originalLanguage = originalLanguage;
  movie.releaseDate = normalizeMovieReleaseDate(movie.releaseDate, tmdbMovie.release_date);
  movie.runtimeSeconds = tmdbMovie.runtime ? Number(tmdbMovie.runtime) * 60 : movie.runtimeSeconds || null;
  movie.rating = Number(tmdbMovie.vote_average || movie.rating || 0) || null;
  movie.voteCount = Number(tmdbMovie.vote_count || movie.voteCount || 0) || null;
  movie.genres = tmdbMovie.genres?.length ? tmdbMovie.genres.map((genre) => genre.name).filter(Boolean) : movie.genres || [];
  movie.external = {
    ...(movie.external || {}),
    tmdbId: tmdbMovie.id || movie.external?.tmdbId || null,
    tmdbTitle: tmdbMovie.title || tmdbMovie.original_title || movie.external?.tmdbTitle || null,
    imdbId: tmdbMovie.imdb_id || movie.external?.imdbId || null,
  };
}

function normalizeMovieReleaseDate(currentDate, tmdbDate) {
  const currentYear = currentDate ? String(currentDate).slice(0, 4) : "";
  if (currentYear && currentYear !== "0001") return currentDate;
  return tmdbDate || currentDate || null;
}

function bestMoviePosterMatch(movie, results) {
  if (!results.length) return null;
  const movieTitle = normalizeTitle(movie.title);
  const movieYear = mediaYear(movie.releaseDate);
  const scored = results
    .map((result) => {
      const title = normalizeTitle(result.title || result.original_title || "");
      const year = result.release_date ? String(result.release_date).slice(0, 4) : "";
      let score = 0;
      if (title === movieTitle) score += 8;
      if (title.includes(movieTitle) || movieTitle.includes(title)) score += 3;
      if (movieYear && year === movieYear) score += 5;
      if (result.poster_path) score += 1;
      if (result.overview) score += 1;
      score += Math.min(3, Number(result.vote_count || 0) / 1000);
      return { result, score };
    })
    .sort((a, b) => b.score - a.score);
  return scored[0]?.score > 0 ? scored[0].result : results[0] || null;
}

async function searchTmdbMovie(params) {
  const response = await fetch(`${TMDB_API}/search/movie?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${state.settings.tmdbToken}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(response.statusText);
  const data = await response.json();
  return data.results || [];
}

async function runCatalogQueue(candidates) {
  for (const show of candidates) {
    state.catalogSync.index += 1;
    state.catalogSync.lastTitle = show.title;
    refreshBackgroundStatus();
    try {
      await updateCatalogForShow(show);
      state.catalogSync.updated += 1;
      show.catalogError = null;
      if (state.catalogSync.updated % 3 === 0) {
        await persist("catalog-auto-partial", { autosave: false });
      }
    } catch (error) {
      state.catalogSync.failed += 1;
      show.catalogError = error.message;
    }
    await sleep(1200);
  }
  state.catalogSync.running = false;
  state.catalogSync.lastTitle = "";
  await persist("catalog-auto", { autosave: true });
  state.notice = `Show catalogs updated: ${state.catalogSync.updated}; failures: ${state.catalogSync.failed}.`;
  render();
}

function isRelevantShow(show) {
  return Boolean(show.followed || show.forLater || show.archived || watchedCount(show) > 0);
}

function shouldRefreshCatalog(show) {
  if (!hasCatalog(show)) return true;
  if (state.settings.tmdbToken && show.metadataLookupVersion !== SHOW_METADATA_LANGUAGE_VERSION) return true;
  const updatedAt = parseDateValue(show.catalogUpdatedAt);
  if (!updatedAt) return true;
  return Date.now() - updatedAt > 24 * 60 * 60 * 1000;
}

async function searchTvmazeShows(query, { expanded = false } = {}) {
  const queries = expanded ? tvmazeQueryCandidates(query) : [String(query || "").trim()].filter(Boolean);
  const seen = new Set();
  const merged = [];
  for (let index = 0; index < queries.length; index += 1) {
    const results = await fetchTvmazeSearch(queries[index]);
    for (const item of results) {
      const id = item.show?.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push({ ...item, query: queries[index], queryIndex: index });
    }
    if (expanded && index < queries.length - 1) {
      await sleep(180);
    }
  }
  return merged;
}

async function fetchTvmazeSearch(query) {
  const response = await fetch(`${TVMAZE_API}/search/shows?q=${encodeURIComponent(query)}`);
  if (!response.ok) throw new Error(response.statusText);
  return response.json();
}

async function fetchTvmazeShow(tvmazeId) {
  const response = await fetch(`${TVMAZE_API}/shows/${encodeURIComponent(tvmazeId)}`);
  if (!response.ok) throw new Error(response.statusText);
  return response.json();
}

async function fetchTvmazeEpisodes(tvmazeId) {
  const response = await fetch(`${TVMAZE_API}/shows/${encodeURIComponent(tvmazeId)}/episodes?specials=1`);
  if (!response.ok) throw new Error(response.statusText);
  return response.json();
}

async function resolveTvmazeCatalog(show) {
  const attempted = new Map();
  if (show.external?.tvmazeId) {
    const currentShow = await fetchTvmazeShow(show.external.tvmazeId);
    await sleep(700);
    const currentEpisodes = await fetchTvmazeEpisodes(currentShow.id);
    attempted.set(currentShow.id, { tvmazeShow: currentShow, episodes: currentEpisodes, score: 100 });
    if (catalogLooksCompatible(show, currentEpisodes)) {
      return { tvmazeShow: currentShow, episodes: currentEpisodes };
    }
  }

  const ranked = rankTvmazeMatches(show, await searchTvmazeShows(show.title, { expanded: true }));
  let fallback = null;
  for (const candidate of ranked.slice(0, 5)) {
    if (candidate.score < 7) continue;
    let attempt = attempted.get(candidate.show.id);
    if (!attempt) {
      await sleep(700);
      const episodes = await fetchTvmazeEpisodes(candidate.show.id);
      attempt = { tvmazeShow: candidate.show, episodes, score: candidate.score };
      attempted.set(candidate.show.id, attempt);
    }
    if (!fallback || candidate.score > fallback.score) {
      fallback = attempt;
    }
    if (catalogLooksCompatible(show, attempt.episodes)) {
      return { tvmazeShow: attempt.tvmazeShow, episodes: attempt.episodes };
    }
  }

  if (fallback && fallback.score >= 12) {
    return { tvmazeShow: fallback.tvmazeShow, episodes: fallback.episodes };
  }
  return null;
}

function bestTvmazeMatch(title, results) {
  return rankTvmazeMatches({ title }, results)[0]?.show || null;
}

function rankTvmazeMatches(target, results) {
  return (results || [])
    .filter((item) => item.show)
    .map((item, index) => ({
      show: item.show,
      score: scoreTvmazeMatch(target, item, index),
    }))
    .sort((a, b) => b.score - a.score);
}

function scoreTvmazeMatch(target, item, index) {
  const show = item.show;
  const parts = parseTitleParts(target.title);
  const queryNames = titleAliases(target.title);
  const showName = normalizeTitle(show.name);
  const premieredYear = show.premiered ? String(show.premiered).slice(0, 4) : "";
  const country = tvmazeCountryCode(show);
  const apiScore = Number(item.score || 0);
  let score = Math.min(4, apiScore * 2);

  if (queryNames.some((name) => name && name === showName)) score += 12;
  if (queryNames.some((name) => name && (name.includes(showName) || showName.includes(name)))) score += 6;

  const overlap = tokenOverlapScore(queryNames[0], showName);
  if (overlap >= 0.85) score += 5;
  else if (overlap >= 0.65) score += 3;
  else if (overlap >= 0.45) score += 1;

  if (parts.year && premieredYear) {
    if (parts.year === premieredYear) score += 14;
    else if (Math.abs(Number(parts.year) - Number(premieredYear)) <= 1) score += 5;
    else score -= 7;
  }

  if (parts.country && country) {
    score += parts.country === country ? 6 : -2;
  }

  if (show.image?.medium || show.image?.original) score += 1;
  score -= Math.min(2, index * 0.2);
  score -= Math.min(1, Number(item.queryIndex || 0) * 0.1);
  return score;
}

function catalogLooksCompatible(show, episodes) {
  const watched = uniqueEpisodes(show);
  if (!watched.length) return true;
  const numberedEpisodes = (episodes || []).filter((episode) => Number(episode.season) > 0 && Number(episode.number) > 0);
  if (watched.length >= 12 && numberedEpisodes.length < watched.length * 0.65) {
    return false;
  }
  return true;
}

function tvmazeQueryCandidates(title) {
  const raw = String(title || "").trim();
  const parts = parseTitleParts(raw);
  const candidates = [];
  const add = (value) => {
    const cleaned = String(value || "")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned && !candidates.some((item) => normalizeTitle(item) === normalizeTitle(cleaned))) {
      candidates.push(cleaned);
    }
  };

  add(raw);
  add(parts.withoutParentheses);
  add(parts.withoutParentheses.replace(/\s*:\s*/g, " "));

  if (parts.beforeColon && parts.afterColon) {
    add(`${parts.beforeColon} ${parts.afterColon}`);
    add(parts.beforeColon);
    add(parts.afterColon);
    const beforeTokens = parts.beforeColon.split(/\s+/);
    if (beforeTokens.length > 1 && /^[a-z0-9]$/i.test(beforeTokens.at(-1))) {
      add(`${beforeTokens.slice(0, -1).join(" ")} ${parts.afterColon}`);
    }
  }

  return candidates.slice(0, 6);
}

function titleAliases(title) {
  const raw = String(title || "").trim();
  const parts = parseTitleParts(raw);
  const aliases = [];
  const add = (value) => {
    const normalized = normalizeTitle(value);
    if (normalized && !aliases.includes(normalized)) {
      aliases.push(normalized);
    }
  };

  add(raw);
  add(parts.withoutParentheses);
  add(parts.withoutParentheses.replace(/\s*:\s*/g, " "));

  if (parts.beforeColon && parts.afterColon) {
    const beforeTokens = parts.beforeColon.split(/\s+/);
    if (beforeTokens.length > 1 && /^[a-z0-9]$/i.test(beforeTokens.at(-1))) {
      add(`${beforeTokens.slice(0, -1).join(" ")} ${parts.afterColon}`);
    }
  }

  return aliases;
}

function parseTitleParts(title) {
  const raw = String(title || "").trim();
  const parentheticals = [...raw.matchAll(/\(([^)]+)\)/g)].map((match) => match[1].trim());
  const year = parentheticals.map((value) => value.match(/\b(19|20)\d{2}\b/)?.[0]).find(Boolean) || "";
  const country = parentheticals.map(countryCodeFromToken).find(Boolean) || "";
  const withoutParentheses = raw
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const colonIndex = withoutParentheses.indexOf(":");
  return {
    raw,
    parentheticals,
    year,
    country,
    withoutParentheses,
    beforeColon: colonIndex >= 0 ? withoutParentheses.slice(0, colonIndex).trim() : "",
    afterColon: colonIndex >= 0 ? withoutParentheses.slice(colonIndex + 1).trim() : "",
  };
}

function countryCodeFromToken(token) {
  const normalized = normalizeTitle(token).toUpperCase().replace(/\s+/g, "");
  const aliases = {
    US: "US",
    USA: "US",
    UNITEDSTATES: "US",
    UNITEDSTATESOFAMERICA: "US",
    UK: "GB",
    GB: "GB",
    BR: "BR",
    BRAZIL: "BR",
    BRASIL: "BR",
  };
  return aliases[normalized] || (/^[A-Z]{2}$/.test(normalized) ? normalized : "");
}

function tvmazeCountryCode(show) {
  return show.network?.country?.code || show.webChannel?.country?.code || "";
}

function tokenOverlapScore(a, b) {
  const aTokens = new Set(String(a || "").split(/\s+/).filter(Boolean));
  const bTokens = new Set(String(b || "").split(/\s+/).filter(Boolean));
  if (!aTokens.size || !bTokens.size) return 0;
  const shared = [...aTokens].filter((token) => bTokens.has(token)).length;
  return shared / Math.max(aTokens.size, bTokens.size);
}

function normalizeTitle(value) {
  return normalizeText(value)
    .replace(/&/g, " and ")
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findExistingShowForTvmaze(tvmazeShow) {
  const tvmazeTitle = normalizeTitle(tvmazeShow.name);
  return (
    getShows().find((show) => show.external?.tvmazeId === tvmazeShow.id) ||
    getShows().find((show) => titleAliases(show.title).includes(tvmazeTitle))
  );
}

function createShowFromTvmaze(tvmazeShow) {
  return {
    id: `tvmaze:show:${tvmazeShow.id}`,
    tvtimeId: null,
    title: tvmazeShow.name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    followed: true,
    active: true,
    archived: false,
    forLater: false,
    favorite: false,
    notificationType: null,
    notificationOffset: null,
    episodesSeenCount: 0,
    watchedEpisodes: [],
    catalogEpisodes: [],
    ratings: [],
    reactions: [],
    characterVotes: [],
  };
}

function mergeTvmazeData(show, tvmazeShow, episodes) {
  const hasLocalizedMetadata = show.metadataLanguageVersion === SHOW_METADATA_LANGUAGE_VERSION;
  show.importedTitle = show.importedTitle || show.title || null;
  show.originalTitle = tvmazeShow.name || show.originalTitle || null;
  if (!hasLocalizedMetadata) show.title = tvmazeShow.name || show.title;
  show.image = tvmazeShow.image?.medium || tvmazeShow.image?.original || show.image || null;
  if (!hasLocalizedMetadata) show.summary = stripHtml(tvmazeShow.summary || show.summary || "");
  show.status = tvmazeShow.status || show.status || null;
  show.premiered = tvmazeShow.premiered || show.premiered || null;
  show.ended = tvmazeShow.ended || show.ended || null;
  if (!hasLocalizedMetadata) show.genres = tvmazeShow.genres || show.genres || [];
  show.language = tvmazeShow.language || show.language || null;
  show.external = {
    ...(show.external || {}),
    source: "tvmaze",
    tvmazeId: tvmazeShow.id,
    tvmazeUrl: tvmazeShow.url || null,
    imdbId: tvmazeShow.externals?.imdb || show.external?.imdbId || null,
    tvdbId: tvmazeShow.externals?.thetvdb || show.external?.tvdbId || null,
    tvrageId: tvmazeShow.externals?.tvrage || show.external?.tvrageId || null,
  };
  show.catalogEpisodes = episodes.map(mapTvmazeEpisode).sort((a, b) => a.season - b.season || a.number - b.number);
  show.catalogUpdatedAt = new Date().toISOString();
  show.updatedAt = new Date().toISOString();
}

async function updateShowEnglishMetadataIfConfigured(show, tvmazeShow) {
  if (!state.settings.tmdbToken) return false;
  try {
    const tmdbShow = await findTmdbShow(show, tvmazeShow);
    show.metadataLookupVersion = SHOW_METADATA_LANGUAGE_VERSION;
    if (!tmdbShow) return false;
    const details = tmdbShow.number_of_seasons ? tmdbShow : await fetchTmdbShowDetails(tmdbShow.id);
    mergeTmdbShowData(show, details);
    show.metadataError = null;
    return true;
  } catch (error) {
    show.metadataLookupVersion = SHOW_METADATA_LANGUAGE_VERSION;
    show.metadataError = error.message;
    return false;
  }
}

async function findTmdbShow(show, tvmazeShow) {
  if (show.external?.tmdbId) return fetchTmdbShowDetails(show.external.tmdbId);
  const imdbId = tvmazeShow?.externals?.imdb || show.external?.imdbId;
  if (imdbId) {
    const response = await tmdbFetch(`/find/${encodeURIComponent(imdbId)}?external_source=imdb_id&language=${TMDB_LANGUAGE}`);
    const result = response.tv_results?.[0];
    if (result) return result;
  }

  const params = new URLSearchParams({
    query: tvmazeShow?.name || show.title,
    include_adult: "false",
    language: TMDB_LANGUAGE,
  });
  const year = mediaYear(tvmazeShow?.premiered || show.premiered);
  if (year) params.set("first_air_date_year", year);
  let results = (await tmdbFetch(`/search/tv?${params.toString()}`)).results || [];
  if (!results.length && year) {
    params.delete("first_air_date_year");
    results = (await tmdbFetch(`/search/tv?${params.toString()}`)).results || [];
  }
  return bestTmdbShowMatch(show, tvmazeShow, results);
}

function bestTmdbShowMatch(show, tvmazeShow, results) {
  const referenceTitles = [show.title, show.importedTitle, tvmazeShow?.name].filter(Boolean).map(normalizeTitle).filter(Boolean);
  const referenceYear = mediaYear(tvmazeShow?.premiered || show.premiered);
  const best = results
    .map((result) => {
      const titles = [result.name, result.original_name].filter(Boolean).map(normalizeTitle).filter(Boolean);
      const titleScore = Math.max(
        0,
        ...referenceTitles.flatMap((reference) => titles.map((title) => (title === reference ? 8 : title.includes(reference) || reference.includes(title) ? 3 : tokenOverlapScore(title, reference) * 4))),
      );
      const year = mediaYear(result.first_air_date);
      return { result, score: titleScore + (referenceYear && year === referenceYear ? 5 : 0) + (result.poster_path ? 1 : 0) };
    })
    .sort((a, b) => b.score - a.score)[0];
  return best?.score >= 3 ? best.result : null;
}

async function fetchTmdbShowDetails(tmdbId) {
  return tmdbFetch(`/tv/${encodeURIComponent(tmdbId)}?language=${TMDB_LANGUAGE}`);
}

async function tmdbFetch(path) {
  const response = await fetch(`${TMDB_API}${path}`, {
    headers: {
      Authorization: `Bearer ${state.settings.tmdbToken}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(response.statusText);
  return response.json();
}

function mergeTmdbShowData(show, tmdbShow) {
  const originalLanguage = tmdbShow.original_language || show.originalLanguage || null;
  const preferredTitle = isPortugueseOriginal(originalLanguage)
    ? tmdbShow.original_name || tmdbShow.name
    : tmdbShow.name || tmdbShow.original_name;
  show.title = preferredTitle || show.title;
  show.originalTitle = tmdbShow.original_name || show.originalTitle || null;
  show.originalLanguage = originalLanguage;
  show.summary = tmdbShow.overview || show.summary || "";
  show.genres = tmdbShow.genres?.length ? tmdbShow.genres.map((genre) => genre.name).filter(Boolean) : show.genres || [];
  show.metadataLanguageVersion = SHOW_METADATA_LANGUAGE_VERSION;
  show.metadataLookupVersion = SHOW_METADATA_LANGUAGE_VERSION;
  show.external = {
    ...(show.external || {}),
    tmdbId: tmdbShow.id || show.external?.tmdbId || null,
    tmdbTitle: tmdbShow.name || tmdbShow.original_name || show.external?.tmdbTitle || null,
    tmdbOriginalLanguage: originalLanguage,
  };
}

function isPortugueseOriginal(language) {
  return String(language || "").toLowerCase().split("-")[0] === "pt";
}

function mapTvmazeEpisode(episode) {
  return {
    source: "tvmaze",
    sourceId: String(episode.id),
    season: Number(episode.season || 0),
    number: Number(episode.number || 0),
    title: episode.name || "",
    airdate: episode.airdate || null,
    airtime: episode.airtime || null,
    runtime: episode.runtime || null,
    url: episode.url || null,
    image: episode.image?.medium || episode.image?.original || null,
    summary: stripHtml(episode.summary || ""),
  };
}

async function toggleShowField(id, field) {
  const show = getShows().find((item) => item.id === id);
  if (!show || !(field in show)) return;
  show[field] = !show[field];
  show.updatedAt = new Date().toISOString();
  addLocalChange("show:update", { id, field, value: show[field] });
  await persistAndRender(`Show updated: ${show.title}`);
}

async function markNextEpisode(id) {
  const show = getShows().find((item) => item.id === id);
  if (!show) return;
  const next = nextEpisode(show);
  if (!next) {
    state.notice = `${show.title} has no released episode left to watch.`;
    render();
    return;
  }
  addEpisode(show, next.season, next.number, { catalogEpisode: next });
  await persistAndRender(`Marked S${next.season}E${next.number}: ${show.title}`);
}

function addEpisode(show, season, episode, options = {}) {
  const exists = uniqueEpisodes(show).some((item) => item.season === season && item.number === episode);
  if (exists) return;
  const catalogEpisode = options.catalogEpisode || findCatalogEpisode(show, season, episode);
  show.watchedEpisodes = show.watchedEpisodes || [];
  show.watchedEpisodes.push({
    id: `local:episode:${crypto.randomUUID()}`,
    tvtimeEpisodeId: null,
    sourceEpisodeId: catalogEpisode?.sourceId || null,
    source: catalogEpisode?.source || null,
    season,
    number: episode,
    title: catalogEpisode?.title || null,
    watchedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    runtimeSeconds: catalogEpisode?.runtime ? catalogEpisode.runtime * 60 : null,
    rewatchCount: 0,
    bulkType: catalogEpisode ? "catalog" : "manual",
    isSpecial: season === 0,
  });
  show.episodesSeenCount = watchedCount(show);
  show.updatedAt = new Date().toISOString();
  addLocalChange("episode:watched", { showId: show.id, season, episode });
}

async function toggleEpisode(id, season, episode) {
  const show = getShows().find((item) => item.id === id);
  if (!show) return;
  const catalogEpisode = findCatalogEpisode(show, season, episode);
  if (isEpisodeWatched(show, { season, number: episode })) {
    show.watchedEpisodes = (show.watchedEpisodes || []).filter((item) => Number(item.season || 0) !== season || Number(item.number || 0) !== episode);
    show.episodesSeenCount = watchedCount(show);
    show.updatedAt = new Date().toISOString();
    addLocalChange("episode:unwatched", { showId: show.id, season, episode });
    await persistAndRender(`Unmarked S${season}E${episode}: ${show.title}`);
  } else {
    addEpisode(show, season, episode, { catalogEpisode });
    await persistAndRender(`Marked S${season}E${episode}: ${show.title}`);
  }
}

async function unwatchEpisode(id, season, episode) {
  const show = getShows().find((item) => item.id === id);
  if (!show) return;
  show.watchedEpisodes = (show.watchedEpisodes || []).filter((item) => Number(item.season || 0) !== season || Number(item.number || 0) !== episode);
  show.episodesSeenCount = watchedCount(show);
  show.updatedAt = new Date().toISOString();
  addLocalChange("episode:unwatched", { showId: show.id, season, episode });
  await persistAndRender(`Removed S${season}E${episode}: ${show.title}`);
}

async function toggleMovieField(id, field) {
  const movie = getMovies().find((item) => item.id === id);
  if (!movie || !(field in movie)) return;
  movie[field] = !movie[field];
  if (field === "watched") {
    movie.watchedAt = movie.watched ? new Date().toISOString() : null;
  }
  movie.updatedAt = new Date().toISOString();
  addLocalChange("movie:update", { id, field, value: movie[field] });
  await persistAndRender(`Movie updated: ${movie.title}`);
}

async function persistAndRender(message) {
  state.notice = message;
  await persist("change", { autosave: true });
  render();
}

async function persist(reason, options = {}) {
  const updatedAt = new Date().toISOString();
  state.data.updatedAt = updatedAt;
  state.data.stats = recomputeStats(state.data);
  if (options.autosave && hasDriveConfiguration()) {
    state.data.sync = state.data.sync || {};
    state.data.sync.pendingDriveSince = state.data.sync.pendingDriveSince || updatedAt;
  }
  await idbSet(DATA_KEY, state.data);
  if (options.autosave && canAttemptDriveAutosave()) {
    scheduleDriveAutosave();
  }
}

let autosaveTimer = null;
function hasDriveConfiguration() {
  return Boolean(state.settings.googleClientId && (state.settings.driveFileId || state.token));
}

function hasPendingDriveSave() {
  return Boolean(state.data?.sync?.pendingDriveSince && hasDriveConfiguration());
}

function canAttemptDriveAutosave() {
  return Boolean(state.token && Date.now() < state.token.expiresAt - 60_000);
}

function scheduleDriveAutosave(delay = 850) {
  if (!canAttemptDriveAutosave()) return;
  window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => {
    saveToDrive({ interactive: false }).catch((error) => {
      state.notice = `Drive pending: ${error.message}`;
      refreshBackgroundStatus();
      refreshDriveStatus();
    });
  }, delay);
}

async function connectDrive() {
  normalizeGoogleClientIdSetting();
  if (!state.settings.googleClientId) {
    state.notice = "Enter the Google OAuth Client ID.";
    render();
    return;
  }
  try {
    await ensureDriveToken({ interactive: true });
    state.notice = "Drive connected.";
    render();
    if (hasPendingDriveSave()) scheduleDriveAutosave(0);
  } catch (error) {
    state.notice = `Drive: ${error.message}`;
    render();
  }
}

async function saveToDrive({ interactive }) {
  normalizeGoogleClientIdSetting();
  if (!state.settings.googleClientId) {
    state.notice = "Enter the Google OAuth Client ID.";
    render();
    return;
  }
  if (state.driveSaving) {
    state.driveSaveQueued = true;
    return;
  }
  state.driveSaving = true;
  refreshDriveStatus();
  let saveSucceeded = false;
  let snapshotUpdatedAt = "";
  try {
    await ensureDriveToken({ interactive });
    snapshotUpdatedAt = state.data.updatedAt || "";
    const savedAt = new Date().toISOString();
    const uploadData = {
      ...state.data,
      sync: {
        ...(state.data.sync || {}),
        lastSavedToDriveAt: savedAt,
        pendingDriveSince: null,
      },
    };
    const body = JSON.stringify(uploadData);
    let fileId = state.settings.driveFileId;
    if (!fileId) {
      const found = await findDriveFile();
      fileId = found?.id || null;
    }
    const file = fileId ? await updateDriveFile(fileId, body) : await createDriveFile(body);
    state.settings.driveFileId = file.id;
    state.settings.driveModifiedTime = file.modifiedTime || new Date().toISOString();
    state.data.sync = state.data.sync || {};
    state.data.sync.lastSavedToDriveAt = savedAt;
    if ((state.data.updatedAt || "") === snapshotUpdatedAt) {
      state.data.sync.pendingDriveSince = null;
    }
    saveSettings();
    await idbSet(DATA_KEY, state.data);
    state.notice = "Saved to Google Drive.";
    saveSucceeded = true;
  } catch (error) {
    state.notice = `Drive: ${error.message}`;
  } finally {
    state.driveSaving = false;
    const queued = state.driveSaveQueued;
    state.driveSaveQueued = false;
    if (interactive) render();
    else {
      refreshBackgroundStatus();
      refreshDriveStatus();
    }
    if (saveSucceeded && canAttemptDriveAutosave() && (queued || hasPendingDriveSave())) {
      scheduleDriveAutosave(250);
    }
  }
}

async function loadFromDrive() {
  normalizeGoogleClientIdSetting();
  if (!state.settings.googleClientId) {
    state.notice = "Enter the Google OAuth Client ID.";
    render();
    return;
  }
  try {
    await ensureDriveToken({ interactive: true });
    const file = state.settings.driveFileId
      ? { id: state.settings.driveFileId }
      : await findDriveFile();
    if (!file?.id) {
      state.notice = "File not found in Drive.";
      render();
      return;
    }
    const response = await driveFetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`);
    const data = await response.json();
    data.sync = data.sync || {};
    data.sync.lastLoadedFromDriveAt = new Date().toISOString();
    data.stats = recomputeStats(data);
    state.data = data;
    state.settings.driveFileId = file.id;
    saveSettings();
    await idbSet(DATA_KEY, state.data);
    state.notice = "Loaded from Google Drive.";
    render();
    window.setTimeout(() => startAutoCatalogSync(), 0);
    window.setTimeout(() => startMoviePosterSync(), 500);
  } catch (error) {
    state.notice = `Drive: ${error.message}`;
    render();
  }
}

async function ensureDriveToken({ interactive }) {
  normalizeGoogleClientIdSetting();
  await waitForGoogleIdentity();
  if (!state.tokenClient) {
    state.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: state.settings.googleClientId,
      scope: DRIVE_SCOPE,
      callback: () => {},
    });
  }
  if (state.token && Date.now() < state.token.expiresAt - 60_000) {
    return state.token.accessToken;
  }
  return new Promise((resolve, reject) => {
    state.tokenClient.callback = (response) => {
      if (response.error) {
        reject(new Error(response.error));
        return;
      }
      state.token = {
        accessToken: response.access_token,
        expiresAt: Date.now() + Number(response.expires_in || 3600) * 1000,
      };
      resolve(state.token.accessToken);
    };
    try {
      state.tokenClient.requestAccessToken({ prompt: interactive ? "consent" : "" });
    } catch (error) {
      reject(error);
    }
  });
}

async function waitForGoogleIdentity() {
  const started = Date.now();
  while (!window.google?.accounts?.oauth2) {
    if (Date.now() - started > 8000) {
      throw new Error("Google Identity Services is unavailable.");
    }
    await sleep(100);
  }
}

async function driveFetch(url, options = {}) {
  const token = await ensureDriveToken({ interactive: false });
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return response;
}

async function findDriveFile() {
  const query = encodeURIComponent(`name='${DRIVE_FILE_NAME.replaceAll("'", "\\'")}' and trashed=false`);
  const fields = encodeURIComponent("files(id,name,modifiedTime,size)");
  const response = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=${fields}&spaces=drive`);
  const result = await response.json();
  return result.files?.[0] || null;
}

async function createDriveFile(content) {
  const boundary = `tvtracker_${Date.now()}`;
  const metadata = { name: DRIVE_FILE_NAME, mimeType: "application/json" };
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: application/json",
    "",
    content,
    `--${boundary}--`,
    "",
  ].join("\r\n");
  const response = await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime", {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  return response.json();
}

async function updateDriveFile(fileId, content) {
  const response = await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,name,modifiedTime`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: content,
  });
  return response.json();
}

function exportJson() {
  const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tvtracker-data-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importJsonFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    data.stats = recomputeStats(data);
    state.data = data;
    addLocalChange("file:import", { name: file.name });
    await persist("import-json", { autosave: true });
    state.notice = "File imported.";
    render();
    window.setTimeout(() => startAutoCatalogSync(), 0);
    window.setTimeout(() => startMoviePosterSync(), 500);
  } catch (error) {
    state.notice = `Import: ${error.message}`;
    render();
  }
}

async function resetToSeed() {
  state.data = await loadSeedData();
  state.data.stats = recomputeStats(state.data);
  await persist("reset-seed", { autosave: false });
  state.notice = "Original import restored locally.";
  render();
  window.setTimeout(() => startAutoCatalogSync(), 0);
  window.setTimeout(() => startMoviePosterSync(), 500);
}

function getShows() {
  return state.data.shows || [];
}

function getMovies() {
  return state.data.movies || [];
}

function filterShows() {
  const q = normalizeText(state.search);
  return getShows()
    .filter((show) => {
      if (!matchesShowFilter(show, state.showFilter)) return false;
      if (state.showGenreFilter !== "all" && !hasGenre(show, state.showGenreFilter)) return false;
      return !q || normalizeText(show.title).includes(q);
    })
    .sort(compareShowsForTab);
}

function matchesShowFilter(show, filter) {
  if (filter === "active") return isActiveShow(show);
  if (filter === "later") return Boolean(show.forLater);
  if (filter === "favorites") return Boolean(show.favorite);
  if (filter === "archived") return Boolean(show.archived);
  if (filter === "all") return true;
  const trackingStatus = showTrackingStatus(show).key;
  if (filter === "continuing") return trackingStatus === "continuing" || trackingStatus === "forgotten";
  if (filter === "up-to-date") return trackingStatus === "up-to-date" || trackingStatus === "waiting";
  if (filter === "waiting") return trackingStatus === "waiting";
  if (filter === "forgotten") return trackingStatus === "forgotten";
  if (filter === "completed") return trackingStatus === "completed";
  return true;
}

function filterMovies() {
  const q = normalizeText(state.search);
  return getMovies()
    .filter((movie) => {
      if (state.movieFilter === "watched" && !movie.watched) return false;
      if (state.movieFilter === "watchlist" && !movie.watchlist) return false;
      if (state.movieFilter === "favorites" && !movie.favorite) return false;
      if (state.movieGenreFilter !== "all" && !hasGenre(movie, state.movieGenreFilter)) return false;
      return !q || normalizeText(movie.title).includes(q);
    })
    .sort(compareMoviesForTab);
}

function compareShowsForTab(a, b) {
  if (state.showSort === "title-desc") return b.title.localeCompare(a.title);
  if (state.showSort === "year-desc") return compareYearsDesc(a.premiered, b.premiered) || a.title.localeCompare(b.title);
  if (state.showSort === "year-asc") return compareYearsAsc(a.premiered, b.premiered) || a.title.localeCompare(b.title);
  if (state.showSort === "last-watched") return lastWatchedTimestamp(b) - lastWatchedTimestamp(a) || a.title.localeCompare(b.title);
  if (state.showSort === "progress-desc") return watchedCount(b) - watchedCount(a) || a.title.localeCompare(b.title);
  return a.title.localeCompare(b.title);
}

function compareMoviesForTab(a, b) {
  if (state.movieSort === "title-desc") return b.title.localeCompare(a.title);
  if (state.movieSort === "year-desc") return compareYearsDesc(a.releaseDate, b.releaseDate) || a.title.localeCompare(b.title);
  if (state.movieSort === "year-asc") return compareYearsAsc(a.releaseDate, b.releaseDate) || a.title.localeCompare(b.title);
  if (state.movieSort === "last-watched") return parseDateValue(b.watchedAt || b.updatedAt) - parseDateValue(a.watchedAt || a.updatedAt) || a.title.localeCompare(b.title);
  return a.title.localeCompare(b.title);
}

function compareYearsDesc(a, b) {
  return Number(mediaYear(b) || 0) - Number(mediaYear(a) || 0);
}

function compareYearsAsc(a, b) {
  const yearA = Number(mediaYear(a) || 9999);
  const yearB = Number(mediaYear(b) || 9999);
  return yearA - yearB;
}

function hasGenre(item, genre) {
  return (item.genres || []).some((value) => normalizeText(value) === normalizeText(genre));
}

function availableShowGenres() {
  return availableGenres(getShows());
}

function availableMovieGenres() {
  return availableGenres(getMovies());
}

function availableGenres(items) {
  return [...new Set(items.flatMap((item) => item.genres || []).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function groupEpisodes(show) {
  const groups = new Map();
  for (const episode of uniqueEpisodes(show)) {
    const season = Number.isFinite(episode.season) ? episode.season : 0;
    if (!groups.has(season)) groups.set(season, []);
    groups.get(season).push(episode);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]);
}

function groupCatalogEpisodes(show) {
  const groups = new Map();
  for (const episode of show.catalogEpisodes || []) {
    const season = Number.isFinite(episode.season) ? episode.season : 0;
    if (!groups.has(season)) groups.set(season, []);
    groups.get(season).push(episode);
  }
  for (const episodes of groups.values()) {
    episodes.sort((a, b) => a.number - b.number);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]);
}

function seasonLabel(season) {
  return Number(season) === 0 ? "Specials" : `Season ${season}`;
}

function seasonCollapseId(show, season) {
  return `season:${show.id}:${season}`;
}

function uniqueEpisodes(show) {
  const map = new Map();
  for (const episode of show.watchedEpisodes || []) {
    const season = Number(episode.season || 0);
    const number = Number(episode.number || episode.episode_number || 0);
    const key = episode.tvtimeEpisodeId || `${season}:${number}`;
    const existing = map.get(key);
    if (existing) {
      existing.times += 1;
    } else {
      map.set(key, { ...episode, season, number, times: 1 });
    }
  }
  return [...map.values()].sort((a, b) => a.season - b.season || a.number - b.number);
}

function watchedCount(show) {
  return uniqueEpisodes(show).length;
}

function hasCatalog(show) {
  return Boolean((show.catalogEpisodes || []).length);
}

function findCatalogEpisode(show, season, episode) {
  return (show.catalogEpisodes || []).find((item) => Number(item.season) === season && Number(item.number) === episode) || null;
}

function isEpisodeWatched(show, episode) {
  const season = Number(episode.season || 0);
  const number = Number(episode.number || 0);
  return uniqueEpisodes(show).some((item) => item.season === season && item.number === number);
}

function lastEpisode(show) {
  const episodes = uniqueEpisodes(show);
  return episodes[episodes.length - 1] || null;
}

function regularCatalogEpisodes(show) {
  return (show.catalogEpisodes || []).filter(
    (episode) => Number(episode.season || 0) > 0 && Number(episode.number || 0) > 0,
  );
}

function availableCatalogEpisodes(show) {
  const today = new Date().toISOString().slice(0, 10);
  return regularCatalogEpisodes(show)
    .filter((episode) => {
      const airdate = String(episode.airdate || "").slice(0, 10);
      return airdate ? airdate <= today : isEndedShow(show);
    })
    .sort((a, b) => Number(a.season || 0) - Number(b.season || 0) || Number(a.number || 0) - Number(b.number || 0));
}

function futureCatalogEpisodes(show) {
  const today = new Date().toISOString().slice(0, 10);
  return regularCatalogEpisodes(show)
    .filter((episode) => String(episode.airdate || "").slice(0, 10) > today)
    .sort((a, b) => String(a.airdate).localeCompare(String(b.airdate)) || Number(a.season) - Number(b.season) || Number(a.number) - Number(b.number));
}

function remainingAvailableEpisodes(show) {
  const watched = new Set(uniqueEpisodes(show).map((episode) => `${episode.season}:${episode.number}`));
  return availableCatalogEpisodes(show).filter((episode) => !watched.has(`${Number(episode.season)}:${Number(episode.number)}`));
}

function hasNextAvailableEpisode(show) {
  if (!hasCatalog(show)) return true;
  return remainingAvailableEpisodes(show).length > 0;
}

function isEndedShow(show) {
  const status = normalizeText(show.status);
  const endedAt = String(show.ended || "").slice(0, 10);
  const endedByDate = /^\d{4}-\d{2}-\d{2}$/.test(endedAt) && endedAt <= new Date().toISOString().slice(0, 10);
  return endedByDate || ["ended", "finalizada", "concluida", "cancelled", "canceled"].some((value) => status.includes(value));
}

function showTrackingStatus(show) {
  const watched = watchedCount(show);
  if (!hasCatalog(show) || regularCatalogEpisodes(show).length === 0) {
    return watched
      ? { key: "unknown", label: "No catalog", tone: "", description: "Update the episodes to calculate this show's status." }
      : { key: "not-started", label: "Not started", tone: "", description: "No watched episodes." };
  }

  const remaining = remainingAvailableEpisodes(show);
  const future = futureCatalogEpisodes(show);
  if (isEndedShow(show) && remaining.length === 0) {
    return { key: "completed", label: "Completed", tone: "teal", description: "Every episode of this ended show has been watched." };
  }
  if (!isEndedShow(show) && remaining.length === 0 && future.length > 0) {
    return {
      key: "waiting",
      label: `Waiting · ${formatDate(future[0].airdate)}`,
      tone: "gold",
      description: "You are up to date and the next episode has a release date.",
    };
  }
  if (!isEndedShow(show) && remaining.length === 0 && watched > 0) {
    return { key: "up-to-date", label: "Up to date", tone: "teal", description: "Every released episode has been watched." };
  }
  if (remaining.length > 0 && watched > 0 && isForgottenShow(show)) {
    return {
      key: "forgotten",
      label: `Forgotten · ${formatCount(remaining.length)}`,
      tone: "red",
      description: `There are unwatched episodes and no activity for at least ${FORGOTTEN_SHOW_DAYS} days.`,
    };
  }
  if (remaining.length > 0 && watched > 0) {
    return {
      key: "continuing",
      label: `Continue · ${formatCount(remaining.length)}`,
      tone: "red",
      description: `${formatCount(remaining.length)} released episodes have not been watched yet.`,
    };
  }
  return { key: "not-started", label: "Not started", tone: "", description: "No watched episodes." };
}

function isForgottenShow(show) {
  const lastWatched = lastWatchedTimestamp(show);
  if (!lastWatched) return false;
  return Date.now() - lastWatched >= FORGOTTEN_SHOW_DAYS * 24 * 60 * 60 * 1000;
}

function renderShowTrackingBadge(status) {
  return `<span class="badge ${status.tone}" title="${escapeAttr(status.description)}">${escapeHtml(status.label)}</span>`;
}

function nextEpisode(show) {
  if (hasCatalog(show)) {
    return availableCatalogEpisodes(show).find((episode) => !isEpisodeWatched(show, episode)) || null;
  }
  const last = lastEpisode(show);
  if (!last) return { season: 1, number: 1 };
  return { season: last.season, number: last.number + 1 };
}

function lastWatchedAt(show) {
  const dates = (show.watchedEpisodes || []).map((episode) => episode.watchedAt || episode.updatedAt).filter(Boolean);
  return dates.sort().at(-1) || show.updatedAt || show.createdAt || "";
}

function lastWatchedTimestamp(show) {
  return Math.max(
    0,
    ...(show.watchedEpisodes || [])
      .map((episode) => parseDateValue(episode.watchedAt || episode.updatedAt))
      .filter(Boolean),
  );
}

function lastWatchedEpisode(show) {
  return [...uniqueEpisodes(show)].sort((a, b) => parseDateValue(b.watchedAt || b.updatedAt) - parseDateValue(a.watchedAt || a.updatedAt))[0] || null;
}

function recomputeStats(data) {
  const shows = data.shows || [];
  const movies = data.movies || [];
  return {
    shows: shows.length,
    followedShows: shows.filter((show) => show.followed).length,
    activeShows: shows.filter(isActiveShow).length,
    archivedShows: shows.filter((show) => show.archived).length,
    forLaterShows: shows.filter((show) => show.forLater).length,
    catalogedShows: shows.filter((show) => hasCatalog(show)).length,
    showImages: shows.filter((show) => mediaImage(show)).length,
    availableEpisodes: shows.reduce((sum, show) => sum + (show.catalogEpisodes || []).length, 0),
    watchedEpisodes: shows.reduce((sum, show) => sum + watchedCount(show), 0),
    movies: movies.length,
    moviePosters: movies.filter((movie) => mediaImage(movie)).length,
    watchedMovies: movies.filter((movie) => movie.watched).length,
    movieWatchlist: movies.filter((movie) => movie.watchlist).length,
    lists: (data.lists || []).length,
  };
}

function isActiveShow(show) {
  return Boolean(show.followed && show.active && !show.archived && !show.forLater);
}

function addLocalChange(type, payload) {
  state.data.localChanges = state.data.localChanges || [];
  state.data.localChanges.push({
    id: crypto.randomUUID(),
    type,
    payload,
    createdAt: new Date().toISOString(),
  });
}

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

function normalizeGoogleClientIdSetting() {
  const normalized = extractGoogleClientId(state.settings.googleClientId);
  if (normalized !== (state.settings.googleClientId || "")) {
    state.settings.googleClientId = normalized;
    saveSettings();
  }
  return normalized;
}

function extractGoogleClientId(value) {
  const text = String(value || "");
  const match = text.match(/\b\d+-[a-z0-9-]+\.apps\.googleusercontent\.com\b/i);
  return match ? match[0] : text.trim();
}

function summarizeClientId(value) {
  const id = extractGoogleClientId(value);
  const match = id.match(/^(\d+)-(.+)\.apps\.googleusercontent\.com$/);
  if (!match) return id || "not provided";
  const prefix = `${match[1]}-`;
  const body = match[2];
  return `${prefix}${body.slice(0, 6)}...${body.slice(-5)}.apps.googleusercontent.com`;
}

function loadUiState() {
  try {
    const saved = JSON.parse(localStorage.getItem(UI_STATE_KEY) || "{}");
    return {
      collapsed: saved.collapsed || {},
    };
  } catch {
    return { collapsed: {} };
  }
}

function saveUiState() {
  localStorage.setItem(UI_STATE_KEY, JSON.stringify(state.ui));
}

function isCollapsed(collapseId) {
  return Boolean(state.ui?.collapsed?.[collapseId]);
}

function toggleCollapse(collapseId) {
  if (!collapseId) return;
  state.ui.collapsed = state.ui.collapsed || {};
  state.ui.collapsed[collapseId] = !state.ui.collapsed[collapseId];
  saveUiState();
  render();
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("kv");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("kv", "readonly");
    const request = tx.objectStore("kv").get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(value, key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons({ attrs: { width: 18, height: 18, "stroke-width": 2 } });
  }
}

function formatCount(value) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

function formatDateTime(value) {
  if (!value) return "no date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-US", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function formatDate(value) {
  if (!value) return "";
  if (!mediaYear(value)) return "";
  const text = String(value);
  const normalized = text.includes("T") || text.includes(" ") ? text.replace(" ", "T") : `${text}T00:00:00`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-US", { dateStyle: "short" }).format(date);
}

function mediaYear(value) {
  if (!value) return "";
  const match = String(value).match(/\b(18|19|20|21)\d{2}\b/);
  if (!match) return "";
  const year = Number(match[0]);
  if (year < 1878 || year > 2100) return "";
  return String(year);
}

function stripHtml(value) {
  const div = document.createElement("div");
  div.innerHTML = String(value || "");
  return div.textContent || div.innerText || "";
}

function compareDates(a, b) {
  return parseDateValue(a) - parseDateValue(b);
}

function parseDateValue(value) {
  if (!value) return 0;
  if (typeof value === "number") return value;
  const normalized = String(value).includes("T") ? String(value) : String(value).replace(" ", "T");
  const time = new Date(normalized).getTime();
  return Number.isFinite(time) ? time : 0;
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function initials(title) {
  const words = String(title || "TV")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const value = (words[0]?.[0] || "T") + (words.length > 1 ? words[1][0] : "");
  return escapeHtml(value.toUpperCase());
}

function coverVars(title) {
  const palettes = [
    ["#ff4f61", "#19c2a5"],
    ["#ffc857", "#2f9c95"],
    ["#e85d75", "#345995"],
    ["#7bd389", "#f45b69"],
    ["#f7b267", "#2ec4b6"],
    ["#b8f2e6", "#ed6a5a"],
  ];
  const hash = [...String(title || "")].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const [a, b] = palettes[hash % palettes.length];
  return `--cover-a:${a};--cover-b:${b};`;
}

function renderFatalError(error) {
  return `
    <main class="loading-screen">
      <img class="loading-mark" src="./assets/watchline-play-192.png" alt="Watchline" />
      <p>${escapeHtml(error.message)}</p>
    </main>
  `;
}

function mediaImage(item) {
  return item?.image || item?.poster || item?.posterUrl || item?.artworkUrl || "";
}

function renderCover(title, image) {
  return `
    <div class="cover ${image ? "cover-image" : ""}" style="${image ? `background-image:url('${escapeAttr(image)}')` : ""}">
      ${image ? "" : `<span class="cover-initial">${initials(title)}</span>`}
    </div>
  `;
}

function captureScrollPositions() {
  const positions = {};
  document.querySelectorAll("[data-scroll-id]").forEach((node) => {
    positions[node.dataset.scrollId] = node.scrollLeft;
  });
  return positions;
}

function restoreScrollPositions(positions) {
  if (!positions || !Object.keys(positions).length) return;
  window.requestAnimationFrame(() => {
    document.querySelectorAll("[data-scroll-id]").forEach((node) => {
      const scrollLeft = positions[node.dataset.scrollId];
      if (Number.isFinite(scrollLeft)) node.scrollLeft = scrollLeft;
    });
  });
}

function captureFocus() {
  const active = document.activeElement;
  if (!active || !active.dataset?.input) return null;
  return {
    input: active.dataset.input,
    value: active.value,
    start: active.selectionStart,
    end: active.selectionEnd,
  };
}

function restoreFocus(focus) {
  if (!focus) return;
  window.requestAnimationFrame(() => {
    const target = document.querySelector(`[data-input='${focus.input}']`);
    if (!target) return;
    target.focus();
    if (typeof target.setSelectionRange === "function") {
      const end = Math.min(focus.end ?? focus.value.length, target.value.length);
      target.setSelectionRange(end, end);
    }
  });
}
