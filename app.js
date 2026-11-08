import { enrichGenres, allGenres, popularGenres } from './genre-taxonomy.mjs';

const catalogVersion = (name) => document.querySelector(`meta[name="${name}-catalog-version"]`)?.content || '';
const ANIME_CATALOG_URL = `./data/anime-catalog.json?v=${catalogVersion('anime')}`;
const MULT_DATA_URL = `./data/cartoons.json?v=${catalogVersion('mult')}`;
const STORAGE_KEY = 'anime-top-local-v2';
const OLD_STORAGE_KEY = 'anime-top-local-v1';

const state = {
  anime: [],
  animeIndex: new Map(),
  catalogues: { anime: null, mult: null },
  genreOptions: [],
  genreCounts: new Map(),
  subgenreNames: new Set(),
  typeOptions: [],
  universe: new URLSearchParams(location.search).get('mode') === 'mult' ? 'mult' : 'anime',
  page: 'overview',
  query: '',
  includeGenres: new Set(),
  excludeGenres: new Set(),
  ratingFilter: '',
  type: '',
  sort: 'rating',
  view: 'grid',
  visibleCount: 60,
  recommendationVisibleCount: 60,
  local: readLocal(),
  social: { inviteCode: '', friends: [], ratings: {} },
  siteRatings: [],
  siteRatingStats: { titles: 0, votes: 0 },
  siteRatingsLoadedAt: 0,
  rankingView: 'site',
  detailId: null,
  remoteResults: [],
  remoteSearchSeq: 0,
  remoteSearching: false,
  remoteError: '',
  user: null,
  authMode: 'login',
  resetToken: null,
  providers: { telegram: false, google: false, yandex: false },
  kpDetails: new Map(),
  kpPending: new Map(),
  selectedSeasons: new Map(),
  playback: new Map(),
  playbackPending: new Map(),
  playbackSelection: new Map(),
  playbackEpisode: new Map(),
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const fmtScore = (value) => value == null ? '—' : Number(value).toFixed(1);
const normalizeSearch = (value) => String(value || '').toLocaleLowerCase('ru').replace(/ё/g, 'е').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const searchTitleCache = new WeakMap();
function oneEditAway(left, right) {
  if (Math.abs(left.length - right.length) > 1) return false;
  let a = 0, b = 0, edits = 0;
  while (a < left.length && b < right.length) {
    if (left[a] === right[b]) { a++; b++; continue; }
    if (++edits > 1) return false;
    if (left.length >= right.length) a++;
    if (right.length >= left.length) b++;
  }
  return edits + Number(a < left.length || b < right.length) <= 1;
}
function titleMatches(item, query, fuzzy = false) {
  let titles = searchTitleCache.get(item);
  if (!titles) { titles = [item.title, item.originalTitle, ...(item.aliases || [])].map(normalizeSearch); searchTitleCache.set(item, titles); }
  if (titles.some((title) => title.includes(query))) return true;
  if (!fuzzy || query.length < 4 || query.includes(' ')) return false;
  return titles.some((title) => title.split(' ').some((word) => oneEditAway(word, query)));
}

function readLocal() {
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    if (current) return JSON.parse(current) || {};
    const legacy = JSON.parse(localStorage.getItem(OLD_STORAGE_KEY) || '{}') || {};
    for (const entry of Object.values(legacy)) if (entry) entry.personalRating = '';
    if (Object.keys(legacy).length) localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
    localStorage.removeItem(OLD_STORAGE_KEY);
    return legacy;
  }
  catch { return {}; }
}

const persistQueues = new Map();
function persist(id) {
  if (state.user) {
    if (id) {
      const body = JSON.stringify({ id, entry: state.local[id] });
      const task = (persistQueues.get(id) || Promise.resolve()).catch(() => {}).then(() => api('/api/me/library', { method: 'PUT', body }));
      persistQueues.set(id, task);
      task.catch(() => showToast('Не удалось синхронизировать список. Попробуй ещё раз.')).finally(() => { if (persistQueues.get(id) === task) persistQueues.delete(id); });
      return task;
    }
    return;
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.local)); }
  catch { showToast('Не удалось сохранить данные в браузере'); }
}

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', headers: { 'content-type': 'application/json' }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Что-то пошло не так.');
  return data;
}

function localEntry(id) {
  if (!state.local[id]) state.local[id] = { saved: false, episodes: 0, personalRating: '' };
  return state.local[id];
}

function episodeProgress(id) {
  const entry = localEntry(id);
  const watched = Array.isArray(entry.watchedEpisodes) ? entry.watchedEpisodes : [];
  const legacy = Number.isInteger(entry.legacyEpisodes) ? entry.legacyEpisodes : Math.max(0, (Number(entry.episodes) || 0) - watched.length);
  return { watched, legacy, total: legacy + watched.length };
}

function episodeSeasons(anime) {
  const detail = state.kpDetails.get(anime.id);
  if (detail?.seasons?.length) {
    const numbered = detail.seasons.some((season) => Number.isInteger(season.number) && season.number > 0);
    const seasons = detail.seasons.filter((season) => Number.isInteger(season.number) && (numbered ? season.number > 0 : season.number >= 0)).sort((a, b) => a.number - b.number);
    if (seasons.length) return seasons;
  }
  if (detail && !detail.serial || anime.seasons === 0 || anime.type === 'Мультфильм') return [{ number: 1, episodes: 1, episodeList: [{ number: 1, title: '' }] }];
  const count = Math.min(Math.max(Number(anime.seasons) || 1, 1), 100);
  return Array.from({ length: count }, (_, index) => ({ number: index + 1, episodes: 0, episodeList: [] }));
}

function episodePanelHtml(anime) {
  const seasons = episodeSeasons(anime);
  const progress = episodeProgress(anime.id);
  const selected = seasons.find((season) => season.number === state.selectedSeasons.get(anime.id)) || seasons[0];
  state.selectedSeasons.set(anime.id, selected.number);
  const known = selected.episodeList?.length ? selected.episodeList : Array.from({ length: selected.episodes || 0 }, (_, index) => ({ number: index + 1, title: '' }));
  const tracked = progress.watched.filter((key) => key.startsWith(`${selected.number}:`)).map((key) => Number(key.split(':')[1]));
  const count = Math.min(9999, Math.max(known.length, Number(localEntry(anime.id).episodeOverrides?.[selected.number]) || 0, ...tracked, 0));
  const episodes = Array.from({ length: count }, (_, index) => known[index] || { number: index + 1, title: '' });
  const status = localEntry(anime.id).watchStatus || 'watching';
  return `<div class="episode-panel" id="episode-panel"><div class="episode-panel-head"><div><span class="section-kicker">МОЙ ПРОСМОТР</span><h4>Сезоны и серии</h4></div><strong class="episode-total">${progress.total} ${progress.total === 1 ? 'серия' : 'серий'} просмотрено</strong></div>
    <div class="watch-statuses" role="group" aria-label="Статус просмотра">${[['planned','В планах'],['watching','Смотрю'],['completed','Просмотрено'],['dropped','Отложено']].map(([key,label]) => `<button type="button" data-watch-status="${key}" class="${status === key ? 'active' : ''}" aria-pressed="${status === key}">${label}</button>`).join('')}</div>
    <div class="episode-season-list" role="tablist" aria-label="Сезоны">${seasons.map((season) => { const seasonCount = progress.watched.filter((key) => key.startsWith(`${season.number}:`)).length; return `<button type="button" role="tab" aria-selected="${season.number === selected.number}" class="episode-season ${season.number === selected.number ? 'active' : ''}" data-season="${season.number}"><b>${seasons.length === 1 && anime.seasons === 0 ? 'Фильм' : `Сезон ${season.number}`}</b><small>${seasonCount}${season.episodes ? ` / ${season.episodes}` : ''}</small></button>`; }).join('')}</div>
    <div class="episode-grid" role="tabpanel">${episodes.length ? episodes.map((episode) => { const key = `${selected.number}:${episode.number}`; const done = progress.watched.includes(key); const active = state.playbackEpisode.get(anime.id) === key; const playable = state.playback.get(anime.id)?.options?.some((option) => option.seasons?.[selected.number]?.[episode.number]); const fallback = !playable && /^\d{1,10}$/.test(anime.id); return `<div class="episode-tile ${done ? 'is-watched' : ''} ${active ? 'is-active' : ''}"><button type="button" class="episode-tile-open" data-select-episode="${key}" aria-label="${playable ? 'Смотреть' : fallback ? 'Открыть плеер для' : 'Выбрать'} серию ${episode.number}${episode.title ? `: ${escapeHtml(episode.title)}` : ''}"><span class="episode-tile-art">${safePoster(anime.poster) ? `<img src="${escapeHtml(safePoster(anime.poster))}" alt="" loading="lazy">` : ''}<span class="episode-tile-play">${playable || fallback ? '▶' : String(episode.number).padStart(2, '0')}</span></span><span class="episode-tile-copy"><strong>Серия ${episode.number}</strong><small>${escapeHtml(episode.title || `Сезон ${selected.number}`)}</small></span></button><button type="button" class="episode-tile-mark" data-episode="${key}" aria-pressed="${done}">${done ? '✓ Просмотрено' : '○ Отметить просмотр'}</button></div>`; }).join('') : '<p class="episode-empty">Список серий ещё не получен. Можно добавить серию вручную и отмечать просмотр.</p>'}</div>
    <div class="episode-panel-foot"><button type="button" class="episode-add" data-add-episode>+ Добавить серию</button><span>${progress.legacy ? `Ещё ${progress.legacy} серий из старого счётчика.` : 'Нажми на серию после просмотра — счётчик обновится сам.'}</span></div></div>`;
}

function refreshEpisodePanel(id) {
  const anime = lookupAnime(id);
  const panel = $('#episode-panel');
  if (anime && panel && state.detailId === id) panel.outerHTML = episodePanelHtml(anime);
}

function safePoster(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.href : '';
  } catch { return ''; }
}

function posterHtml(anime, variant = '') {
  const image = safePoster(anime.poster);
  const rank = '✦';
  return `<div class="${variant === 'detail' ? 'detail-image' : 'poster-frame'}">
    <div class="poster-fallback">${escapeHtml(anime.title)}</div>
    ${image ? `<img src="${escapeHtml(image)}" alt="Постер: ${escapeHtml(anime.title)}" loading="lazy" referrerpolicy="no-referrer">` : ''}
    ${variant === 'detail' ? '' : `
      ${activeScore(anime) != null ? `<span class="poster-score"><span>★</span> ${fmtScore(activeScore(anime))}</span>` : ''}
      <span class="poster-rank">${rank}</span>`}
  </div>`;
}

function activeScore(anime) {
  return anime.displayRating;
}

function ownScore(id) {
  const value = Number(state.local[id]?.personalRating);
  return Number.isInteger(value) && value >= 1 && value <= 10 ? value : null;
}

function sharedScores(id) {
  const scores = [...(state.social.ratings[id] || [])];
  const mine = ownScore(id);
  if (mine != null) scores.unshift({ userId: state.user?.id || 'me', name: state.user?.name || 'Я', score: mine });
  return scores;
}

function sharedScore(id) {
  const scores = sharedScores(id);
  return scores.length ? scores.reduce((sum, item) => sum + item.score, 0) / scores.length : null;
}

function lookupAnime(id) {
  return state.animeIndex.get(id)
    || state.remoteResults.find((item) => item.id === id)
    || state.local[id]?.external
    || null;
}

function cardHtml(anime) {
  const saved = !!state.local[anime.id]?.saved;
  const year = anime.year || 'Год неизвестен';
  const genre = anime.genres[0] || 'Жанр не указан';
  return `<article class="anime-card" data-id="${escapeHtml(anime.id)}">
    <button type="button" class="card-open" data-open="${escapeHtml(anime.id)}" aria-label="Открыть карточку: ${escapeHtml(anime.title)}">
      ${posterHtml(anime)}
      <div class="card-info"><h3>${escapeHtml(anime.title)}</h3><p>${escapeHtml(year)} <span>•</span> ${escapeHtml(genre)}</p></div>
    </button>
    <button type="button" class="save-button ${saved ? 'saved' : ''}" data-save="${escapeHtml(anime.id)}" aria-label="${saved ? 'Убрать из моего списка' : 'Добавить в мой список'}: ${escapeHtml(anime.title)}" title="${saved ? 'Убрать из моего списка' : 'В мой список'}">${saved ? '♥' : '♡'}</button>
  </article>`;
}

function renderOverview() {
  const scored = state.anime.filter((anime) => anime.displayRating != null).length;
  const genres = new Set(state.anime.flatMap(allGenres)).size;
  $('#stats-grid').innerHTML = [
    ['01', state.anime.length, state.universe === 'mult' ? 'мультфильмов в каталоге' : 'аниме в каталоге'],
    ['02', scored, 'с рейтингом Кинопоиска'],
    ['03', genres, 'жанров для открытия'],
  ].map(([icon, count, label]) => `<div class="stat"><span class="stat-icon">${icon}</span><div><strong>${count}</strong><small>${label}</small></div></div>`).join('');

  const picks = state.universe === 'mult'
    ? ['Тайна Коко', 'Зверополис', 'Смешарики', 'Клаус', 'Шрэк']
      .map((title) => state.anime.find((item) => item.title === title)).filter(Boolean)
    : ['Истории монстров','Поднятие уровня в одиночку','Истребитель демонов','Хоримия','Магия и мускулы']
      .map((title) => state.anime.find((anime) => anime.title === title)).filter(Boolean);
  $('#picks-grid').innerHTML = picks.map(cardHtml).join('');

  const genreChoices = state.universe === 'mult' ? [
    { name: 'Семейный', symbol: '✦' },
    { name: 'Приключения', symbol: '↗' },
    { name: 'Комедия', symbol: '☺' },
    { name: 'Романтика', symbol: '♡' },
  ] : [
    { name: 'Боевик', symbol: '斬' },
    { name: 'Романтика', symbol: '愛' },
    { name: 'Фэнтези', symbol: '夢' },
    { name: 'Комедия', symbol: '笑' },
  ];
  $('#genre-tiles').innerHTML = genreChoices.map(({name, symbol}) => {
    const count = state.anime.filter((anime) => anime.genres.includes(name)).length;
    return `<button type="button" class="genre-tile" data-genre="${name}" data-symbol="${symbol}"><strong>${name}</strong><small>${count} ${pluralAnime(count)} →</small><span class="tile-arrow">↗</span></button>`;
  }).join('');

  const featured = (state.universe === 'anime' && state.anime.find((anime) => anime.title === 'Поднятие уровня в одиночку')) || picks[0] || state.anime[0];
  if (featured) {
    const image = safePoster(featured.poster);
    if (image) $('#hero-art').style.backgroundImage = `url("${image.replaceAll('"', '%22')}")`;
    if (image) $('#hero-poster').src = image;
    $('#hero-feature').innerHTML = `<span class="feature-icon">↗</span><span><small>В ЦЕНТРЕ ВНИМАНИЯ${featured.displayRating != null ? ` · ★ ${fmtScore(featured.displayRating)}` : ''}</small><strong>${escapeHtml(featured.title)}</strong></span>`;
    $('#hero-feature').style.cursor = 'pointer';
    $('#hero-feature').dataset.open = featured.id;
  } else {
    $('#hero-art').style.backgroundImage = '';
    $('#hero-poster').removeAttribute('src');
    $('#hero-feature').removeAttribute('data-open');
    $('#hero-feature').innerHTML = '<span class="feature-icon">✦</span><span><small>MULT TOP</small><strong>Каталог мультфильмов</strong></span>';
  }
}

function pluralAnime(count) {
  if (state.universe === 'anime') return 'аниме';
  const last = count % 10;
  const lastTwo = count % 100;
  return last === 1 && lastTwo !== 11 ? 'мультфильм' : last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? 'мультфильма' : 'мультфильмов';
}

function filteredAnime() {
  const all = state.query.trim()
    ? [...state.anime, ...state.remoteResults.filter((anime) => !state.animeIndex.has(anime.id))]
    : state.anime;
  const query = normalizeSearch(state.query);
  const useFuzzy = query.length >= 4 && !all.some((anime) => titleMatches(anime, query));
  let items = all.filter((anime) => {
    if (query && !titleMatches(anime, query, useFuzzy)) return false;
    const tags = allGenres(anime);
    if ([...state.includeGenres].some((genre) => !tags.includes(genre))) return false;
    if ([...state.excludeGenres].some((genre) => tags.includes(genre))) return false;
    if (state.type && anime.type !== state.type) return false;
    if (state.ratingFilter === 'rated' && ownScore(anime.id) == null) return false;
    if (state.ratingFilter === 'unrated' && ownScore(anime.id) != null) return false;
    return true;
  });

  if (state.sort === 'rating') {
    items.sort((a, b) => (b.displayRating ?? -1) - (a.displayRating ?? -1));
  } else if (state.sort === 'mine') {
    items.sort((a, b) => (ownScore(b.id) ?? -1) - (ownScore(a.id) ?? -1) || (b.displayRating ?? -1) - (a.displayRating ?? -1));
  } else if (state.sort === 'shared') {
    items.sort((a, b) => (sharedScore(b.id) ?? -1) - (sharedScore(a.id) ?? -1) || (b.displayRating ?? -1) - (a.displayRating ?? -1));
  } else if (state.sort === 'newest') {
    items.sort((a, b) => (b.year ?? -1) - (a.year ?? -1));
  } else if (state.sort === 'oldest') {
    items.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
  } else if (state.sort === 'title') {
    items.sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  }
  return items;
}

const filterOptions = {
  rating: [['', 'Все истории'], ['rated', 'Только оценённые'], ['unrated', 'Без моей оценки']],
  sort: [['rating', 'По Кинопоиску'], ['mine', 'Мой рейтинг'], ['shared', 'Общий рейтинг'], ['newest', 'Сначала новые'], ['oldest', 'Сначала старые'], ['title', 'По названию']],
};

const catalogRequests = new Map();
async function ensureCatalog(mode) {
  if (state.catalogues[mode]) return state.catalogues[mode];
  if (!catalogRequests.has(mode)) {
    const path = mode === 'mult' ? MULT_DATA_URL : ANIME_CATALOG_URL;
    const pending = fetch(path).then(async (response) => {
      if (!response.ok) throw new Error(`Каталог недоступен: HTTP ${response.status}`);
      const items = await response.json();
      if (!Array.isArray(items)) throw new Error('Некорректный формат каталога');
      state.catalogues[mode] = items.map(enrichGenres);
      return state.catalogues[mode];
    }).finally(() => catalogRequests.delete(mode));
    catalogRequests.set(mode, pending);
  }
  return catalogRequests.get(mode);
}

function prepareCatalogFilters() {
  state.animeIndex = new Map(state.anime.map((anime) => [anime.id, anime]));
  state.genreOptions = [...new Set(state.anime.flatMap(allGenres))].sort((a, b) => a.localeCompare(b, 'ru'));
  state.subgenreNames = new Set(state.anime.flatMap((anime) => anime.subgenres || []));
  state.genreCounts = new Map(state.genreOptions.map((genre) => [genre, state.anime.filter((anime) => allGenres(anime).includes(genre)).length]));
  state.typeOptions = [['', 'Любой формат'], ...[...new Set(state.anime.map((item) => item.type).filter(Boolean))].sort().map((type) => [type, type])];
}

function renderGenreOptions() {
  const query = $('#genre-search').value.trim().toLocaleLowerCase('ru');
  $('#genre-quick').innerHTML = query ? '' : `<div class="genre-section-title">ПОПУЛЯРНОЕ</div><div>${popularGenres.filter((genre) => state.genreCounts.has(genre)).map((genre) => `<button type="button" class="genre-quick-chip ${state.includeGenres.has(genre) ? 'active' : ''}" data-genre-mode="include" data-genre-name="${escapeHtml(genre)}">${escapeHtml(genre)} <small>${state.genreCounts.get(genre)}</small></button>`).join('')}</div>`;
  const matched = state.genreOptions.filter((genre) => genre.toLocaleLowerCase('ru').includes(query));
  const row = (genre) => `<div class="genre-option"><span>${escapeHtml(genre)} <small>${state.genreCounts.get(genre)}</small></span><div><button type="button" class="genre-choice ${state.includeGenres.has(genre) ? 'included' : ''}" data-genre-mode="include" data-genre-name="${escapeHtml(genre)}" aria-label="Включить жанр ${escapeHtml(genre)}" aria-pressed="${state.includeGenres.has(genre)}">＋</button><button type="button" class="genre-choice ${state.excludeGenres.has(genre) ? 'excluded' : ''}" data-genre-mode="exclude" data-genre-name="${escapeHtml(genre)}" aria-label="Исключить жанр ${escapeHtml(genre)}" aria-pressed="${state.excludeGenres.has(genre)}">−</button></div></div>`;
  const base = matched.filter((genre) => !state.subgenreNames.has(genre));
  const sub = matched.filter((genre) => state.subgenreNames.has(genre));
  $('#genre-options').innerHTML = `${base.length ? `<div class="genre-section-title">ЖАНРЫ</div>${base.map(row).join('')}` : ''}${sub.length ? `<div class="genre-section-title">ПОДЖАНРЫ</div>${sub.map(row).join('')}` : ''}` || '<p class="genre-no-results">Жанр не найден</p>';
}

function renderFilters() {
  const count = state.includeGenres.size + state.excludeGenres.size;
  $('#genre-trigger-label').textContent = count ? `＋${state.includeGenres.size} · −${state.excludeGenres.size}` : 'Любые жанры';
  for (const [key, options, current] of [
    ['rating', filterOptions.rating, state.ratingFilter],
    ['type', state.typeOptions, state.type],
    ['sort', filterOptions.sort, state.sort],
  ]) {
    $(`#${key}-trigger-label`).textContent = options.find(([value]) => value === current)?.[1] || options[0][1];
    $(`#${key}-menu`).innerHTML = options.map(([value, label]) => `<button type="button" class="filter-option ${value === current ? 'selected' : ''}" data-filter-option="${key}" data-value="${escapeHtml(value)}" role="option" aria-selected="${value === current}"><span>${escapeHtml(label)}</span><i>${value === current ? '✓' : ''}</i></button>`).join('');
  }
  const chips = [...state.includeGenres].map((genre) => `<button type="button" class="genre-chip included" data-remove-genre="include" data-genre-name="${escapeHtml(genre)}">＋ ${escapeHtml(genre)} <span>×</span></button>`)
    .concat([...state.excludeGenres].map((genre) => `<button type="button" class="genre-chip excluded" data-remove-genre="exclude" data-genre-name="${escapeHtml(genre)}">− ${escapeHtml(genre)} <span>×</span></button>`));
  $('#active-genre-filters').innerHTML = chips.join('') + (chips.length ? '<small>Выбранные жанры должны присутствовать все; исключённые не показываются.</small>' : '');
  $('#active-genre-filters').classList.toggle('hidden', !chips.length);
  renderGenreOptions();
}

function renderCatalog() {
  const items = filteredAnime();
  $('#catalog-grid').innerHTML = items.slice(0, state.visibleCount).map(cardHtml).join('');
  $('#catalog-more').classList.toggle('hidden', items.length <= state.visibleCount);
  $('#catalog-more').innerHTML = `Показать ещё <span>↓</span><small>${Math.min(60, Math.max(0, items.length - state.visibleCount))} из ${items.length - state.visibleCount}</small>`;
  $('#catalog-grid').classList.toggle('list-view', state.view === 'list');
  $('#catalog-empty').classList.toggle('hidden', items.length !== 0);
  $('#catalog-empty').querySelector('p').textContent = 'Попробуй другое название или сбрось фильтры.';
  $('#catalog-search-status').textContent = state.remoteSearching ? 'Ищем ещё в каталоге Кинопоиска…' : state.remoteError || '';
  $('#results-count').textContent = items.length;
  $('#results-label').textContent = state.universe === 'mult' ? 'мультфильмов' : 'аниме';
  $('#clear-filters').classList.toggle('hidden', !(state.query || state.includeGenres.size || state.excludeGenres.size || state.ratingFilter || state.type || state.sort !== 'rating'));
  $('#catalog-search').value = state.query;
  renderFilters();
  $$('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === state.view));
}

function remoteAnime(item) {
  return enrichGenres({
    id: item.id,
    title: item.title,
    originalTitle: item.originalTitle,
    year: item.year,
    seasons: item.type === 'FILM' ? 0 : null,
    genres: item.genres.filter((genre) => !['аниме', 'мультфильм'].includes(genre.toLocaleLowerCase('ru'))),
    displayRating: item.rating,
    poster: item.poster,
    type: state.universe === 'mult' ? (item.type === 'FILM' ? 'Мультфильм' : 'Мультсериал') : (item.type === 'FILM' ? 'Аниме-фильм' : 'Аниме-сериал'),
    source: 'kinopoisk',
  });
}

async function searchKinopoisk() {
  const query = state.query.trim();
  if (query.length < 2) return;
  const seq = ++state.remoteSearchSeq;
  state.remoteSearching = true;
  state.remoteError = '';
  renderCatalog();
  try {
    const response = await fetch(`/api/kinopoisk/search?q=${encodeURIComponent(query)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Поиск сейчас недоступен.');
    if (seq !== state.remoteSearchSeq) return;
    state.remoteResults = data.items.filter((item) => state.universe === 'mult' ? item.genres.some((genre) => genre.toLocaleLowerCase('ru') === 'мультфильм') && !item.genres.some((genre) => genre.toLocaleLowerCase('ru') === 'аниме') : item.genres.some((genre) => genre.toLocaleLowerCase('ru') === 'аниме')).map(remoteAnime);
  } catch (error) {
    if (seq !== state.remoteSearchSeq) return;
    state.remoteError = error.message || 'Поиск временно недоступен.';
  } finally {
    if (seq === state.remoteSearchSeq) { state.remoteSearching = false; renderCatalog(); }
  }
}

function renderSaved() {
  const items = state.anime.filter((anime) => state.local[anime.id]?.saved);
  const localIds = state.animeIndex;
  for (const [id, entry] of Object.entries(state.local)) {
    if (entry?.saved && entry.external && !localIds.has(id) && (state.universe === 'mult' ? id.startsWith('mult:') : !id.startsWith('mult:'))) items.push(entry.external);
  }
  $('#saved-grid').innerHTML = items.map(cardHtml).join('');
  $('#saved-empty').classList.toggle('hidden', items.length !== 0);
  $('#saved-count').textContent = items.length;
  $('#saved-nav-count').textContent = items.length;
}

async function fetchKinopoiskFilm(id) {
  if (state.kpDetails.has(id)) return state.kpDetails.get(id);
  if (state.kpPending.has(id)) return state.kpPending.get(id);
  const task = (async () => {
    const response = await fetch(`/api/kinopoisk/films/${id}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Данные Кинопоиска недоступны.');
    state.kpDetails.set(id, data);
    return data;
  })().finally(() => state.kpPending.delete(id));
  state.kpPending.set(id, task);
  return task;
}

function kinopoiskInfoHtml(detail) {
  const facts = [
    detail.ratingKinopoisk != null ? `★ ${fmtScore(detail.ratingKinopoisk)} Кинопоиск` : '',
    detail.ratingImdb != null ? `IMDb ${fmtScore(detail.ratingImdb)}` : '',
    detail.duration ? `${detail.duration} мин` : '',
    detail.countries?.[0] || '',
  ].filter(Boolean);
  const seasons = detail.seasons?.filter((season) => season.number != null) || [];
  return `<div class="kp-info-head"><span class="detail-section-title">ДАННЫЕ КИНОПОИСКА</span><span class="kp-live-dot"></span></div>
    ${detail.originalTitle && detail.originalTitle !== detail.title ? `<div class="kp-original">${escapeHtml(detail.originalTitle)}</div>` : ''}
    ${facts.length ? `<div class="kp-facts">${facts.map((fact) => `<span>${escapeHtml(fact)}</span>`).join('')}</div>` : ''}
    <p class="kp-description">${escapeHtml(detail.description || 'Описание пока отсутствует.')}</p>
    ${seasons.length ? `<div class="kp-seasons"><strong>Сезоны и серии</strong><div>${seasons.map((season) => `<span>${season.number} сезон · ${season.episodes} серий</span>`).join('')}</div></div>` : ''}`;
}

async function loadDetailMetadata(id) {
  const info = $('#kp-info');
  if (!info || !/^\d{1,10}$/.test(id)) return;
  try {
    const detail = await fetchKinopoiskFilm(id);
    if (state.detailId === id && $('#kp-info')) { $('#kp-info').innerHTML = kinopoiskInfoHtml(detail); refreshEpisodePanel(id); }
  } catch (error) {
    if (state.detailId === id && $('#kp-info')) {
      $('#kp-info').innerHTML = `<p class="kp-info-error">${escapeHtml(error.message)} <button type="button" data-kp-retry="${escapeHtml(id)}">Повторить ↗</button></p>`;
    }
  }
}

function selectedPlaybackOption(id) {
  const options = availablePlaybackOptions(id);
  return options.find((option) => option.id === state.playbackSelection.get(id)) || options[0];
}

function availablePlaybackOptions(id) {
  const options = state.playback.get(id)?.options || [];
  const key = state.playbackEpisode.get(id);
  if (!key) return options;
  const [season, episode] = key.split(':');
  return options.filter((option) => option.seasons?.[season]?.[episode]);
}

async function loadPlayback(id) {
  if (state.playback.has(id)) return state.playback.get(id);
  if (state.playbackPending.has(id)) return state.playbackPending.get(id);
  const task = api(`/api/playback/${id}`).then((result) => {
    state.playback.set(id, result);
    if (state.detailId === id) updateWatchAction(id);
    return result;
  }).finally(() => state.playbackPending.delete(id));
  state.playbackPending.set(id, task);
  return task;
}

function updateWatchAction(id) {
  const button = $('#detail-content [data-watch]');
  if (!button || state.detailId !== id) return;
  const options = state.playback.get(id)?.options || [];
  button.textContent = options.length ? 'Смотреть ▷' : /^\d{1,10}$/.test(id) ? 'Открыть плеер ▷' : 'Сезоны и серии ▷';
  button.disabled = false;
}

function currentPlaybackUrl(id) {
  const option = selectedPlaybackOption(id);
  const [season, episode] = (state.playbackEpisode.get(id) || '').split(':');
  if (season && episode) return option?.seasons?.[season]?.[episode] || '';
  return option?.url || Object.values(option?.seasons || {}).flatMap((items) => Object.values(items))[0] || '';
}

function renderPlayback(id) {
  const anime = lookupAnime(id);
  const container = $('#detail-watch');
  if (!anime || !container || state.detailId !== id) return;
  const options = availablePlaybackOptions(id);
  if (!options.length) {
    const current = state.playbackEpisode.get(id);
    const episode = current ? Number(current.split(':')[1]) : 0;
    const fallbackUrl = /^\d{1,10}$/.test(id) ? `https://kinoboxtv.tatnet.app/embed/#${id}` : '';
    container.innerHTML = `<div class="detail-watch-head"><div><button type="button" class="watch-back" data-close-watch>← К карточке</button><span class="section-kicker">ЭПИЗОДЫ</span><h3>${escapeHtml(anime.title)}</h3></div><span class="watch-head-count">${episodeProgress(id).total} просмотрено</span></div>${current ? fallbackUrl ? `<div class="detail-watch-stage"><iframe title="Плеер: ${escapeHtml(anime.title)}, сезон ${escapeHtml(current.split(':')[0])}, серия ${episode}" src="${fallbackUrl}" loading="eager" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen referrerpolicy="no-referrer"></iframe></div><p class="player-source-note">Сторонний плеер открылся для этого тайтла. Выбери сезон, серию и рабочий источник внутри него: старое встраивание не принимает номер серии из карточки.</p>` : `<div class="detail-watch-stage episode-player-empty"><div><span class="episode-player-icon">${String(episode).padStart(2, '0')}</span><strong>Видео для этой серии не подключено</strong></div></div>` : ''}${episodePanelHtml(anime)}`;
    return;
  }
  const selected = selectedPlaybackOption(id);
  const url = currentPlaybackUrl(id);
  container.innerHTML = `<div class="detail-watch-head"><div><button type="button" class="watch-back" data-close-watch>← К карточке</button><span class="section-kicker">СМОТРЕТЬ СЕЙЧАС</span><h3>${escapeHtml(anime.title)}</h3></div><span class="watch-head-count">${episodeProgress(id).total} просмотрено</span></div><div class="detail-watch-stage">${url ? `<iframe title="Плеер: ${escapeHtml(anime.title)}" src="${escapeHtml(url)}" loading="eager" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen referrerpolicy="no-referrer"></iframe>` : '<div class="playback-empty">Выбери серию для просмотра</div>'}</div><div class="playback-voices"><span class="section-kicker">ОЗВУЧКА И СУБТИТРЫ</span><div class="playback-voice-list">${options.map((option) => `<button type="button" data-playback-option="${escapeHtml(option.id)}" class="${option.id === selected.id ? 'active' : ''}" aria-pressed="${option.id === selected.id}"><small>${escapeHtml(option.kind)}</small>${escapeHtml(option.label)}</button>`).join('')}</div></div>${episodePanelHtml(anime)}`;
}

async function watchAnime(id) {
  const anime = lookupAnime(id);
  if (!anime) return;
  if (state.detailId !== id || $('#detail-overlay').classList.contains('hidden')) showDetail(id);
  $('#detail-watch')?.remove();
  const numericId = /^\d{1,10}$/.test(anime.id);
  $('#detail-content').insertAdjacentHTML('afterbegin', `<section id="detail-watch" class="detail-watch" aria-label="Просмотр ${escapeHtml(anime.title)}"></section>`);
  renderPlayback(id);
  if (numericId) {
    try { await loadPlayback(id); renderPlayback(id); }
    catch { if (state.detailId === id) renderPlayback(id); }
  }
  $('.detail-dialog').scrollTop = 0;
}
function safeMultSource(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['mult-fan.tv', 'www.mult-fan.tv'].includes(url.hostname) ? url.href : '';
  } catch { return ''; }
}

function watchActionHtml(id) {
  const checked = state.playback.get(id);
  return `<button type="button" class="button button-primary" data-watch="${escapeHtml(id)}">${checked?.options?.length ? 'Смотреть ▷' : 'Сезоны и серии ▷'}</button>`;
}

function ratingControlHtml(id) {
  const value = ownScore(id);
  return `<div class="rating-control"><span>МОЯ ОЦЕНКА ${value == null ? '· ещё не поставлена' : `· ${value} / 10`}</span><div class="rating-buttons" role="group" aria-label="Моя оценка от 1 до 10">${Array.from({ length: 10 }, (_, i) => i + 1).map((score) => `<button type="button" data-rating="${score}" class="${value === score ? 'selected' : ''}" aria-pressed="${value === score}">${score}</button>`).join('')}</div>${value != null ? '<button type="button" class="rating-clear" data-rating="">Убрать оценку ×</button>' : ''}</div>`;
}

function sharedRatingHtml(id) {
  const scores = sharedScores(id);
  if (!state.user || !state.social.friends.length || !scores.length) return '';
  return `<div class="shared-rating-box"><span class="section-kicker">ВАШ ОБЩИЙ РЕЙТИНГ</span><strong>★ ${fmtScore(sharedScore(id))}</strong><div>${scores.map((item) => `<span>${escapeHtml(item.name)} · ${item.score}</span>`).join('')}</div></div>`;
}

function renderMultDetail(anime) {
  const local = localEntry(anime.id);
  const source = safeMultSource(anime.sourceUrl);
  const hasKpId = /^\d{1,10}$/.test(anime.id);
  const kp = state.kpDetails.get(anime.id);
  const kinopoiskPage = hasKpId ? `https://www.kinopoisk.ru/${anime.seasons === 0 || anime.type === 'Мультфильм' ? 'film' : 'series'}/${anime.id}/` : '';
  $('#detail-content').innerHTML = `<div class="detail-layout">
    ${posterHtml(anime, 'detail')}
    <div class="detail-copy">
      <div class="detail-kicker">${anime.type === 'Мультсериал' ? 'МУЛЬТСЕРИАЛ' : 'МУЛЬТФИЛЬМ'} № ${String(state.anime.indexOf(anime) + 1).padStart(3, '0')} В КАТАЛОГЕ</div>
      <h2 id="detail-title">${escapeHtml(anime.title)}</h2>
      <div class="detail-subline"><span>${escapeHtml(anime.year || 'Год не указан')}</span>${anime.type ? `<span>${escapeHtml(anime.type)}</span>` : ''}</div>
      ${anime.displayRating != null ? `<div class="detail-score"><strong>${fmtScore(anime.displayRating)}</strong><div><b>Рейтинг Кинопоиска</b>Из 10 баллов</div></div>` : ''}
      <div class="detail-genres">${allGenres(anime).map((genre) => `<span class="${anime.subgenres?.includes(genre) ? 'is-subgenre' : ''}">${escapeHtml(genre)}</span>`).join('')}</div>
      ${hasKpId ? `<div id="kp-info" class="kp-info">${kp ? kinopoiskInfoHtml(kp) : '<p class="kp-loading">Загружаем описание из Кинопоиска…</p>'}</div>` : anime.description ? `<p class="kp-description">${escapeHtml(anime.description)}</p>` : ''}
      <div class="detail-actions">
        ${watchActionHtml(anime.id)}
        <button type="button" class="button button-primary" data-detail-save="${escapeHtml(anime.id)}">${local.saved ? 'В моём списке ♥' : 'В мой список ♡'}</button>
        ${source || kinopoiskPage ? `<a class="button button-outline" href="${escapeHtml(source || kinopoiskPage)}" target="_blank" rel="noopener noreferrer">${source ? 'Источник' : 'Кинопоиск'} ↗</a>` : ''}
      </div>
      ${sharedRatingHtml(anime.id)}
      <div class="detail-controls"><p class="detail-section-title">МОЙ ПРОСМОТР · ${episodeProgress(anime.id).total} СЕРИЙ</p>${ratingControlHtml(anime.id)}<div class="detail-local">Отмечай серии в блоке просмотра. ${state.user ? 'Прогресс и оценка сохраняются в твоём профиле.' : 'Пока данные хранятся в этом браузере. Войди, чтобы сохранить их в профиле.'}</div></div>
    </div></div>`;
}

function renderDetail(anime) {
  if (state.universe === 'mult') { renderMultDetail(anime); return; }
  const local = localEntry(anime.id);
  const seasons = anime.seasons === 0 ? 'Фильм' : anime.seasons ? `${anime.seasons} сезон${anime.seasons === 1 ? '' : 'а'}` : '';
  const detail = state.kpDetails.get(anime.id);
  const hasKpId = /^\d{1,10}$/.test(anime.id);
  const type = (detail ? !detail.serial : anime.seasons === 0) ? 'film' : 'series';
  $('#detail-content').innerHTML = `<div class="detail-layout">
    ${posterHtml(anime, 'detail')}
    <div class="detail-copy">
      <div class="detail-kicker">ОТКРОЙ НОВУЮ ИСТОРИЮ</div>
      <h2 id="detail-title">${escapeHtml(anime.title)}</h2>
      <div class="detail-subline"><span>${escapeHtml(anime.year || 'Год не указан')}</span>${seasons ? `<span>${escapeHtml(seasons)}</span>` : ''}</div>
      <div class="detail-score"><strong>${fmtScore(anime.displayRating)}</strong><div><b>Рейтинг Кинопоиска</b>${anime.displayRating == null ? 'Пока без числовой оценки' : 'Из 10 баллов'}</div></div>
      <div class="detail-genres">${allGenres(anime).length ? allGenres(anime).map((genre) => `<span class="${anime.subgenres?.includes(genre) ? 'is-subgenre' : ''}">${escapeHtml(genre)}</span>`).join('') : '<span>Жанры пока не указаны</span>'}</div>
      <div id="kp-info" class="kp-info">${detail ? kinopoiskInfoHtml(detail) : hasKpId ? '<p class="kp-loading">Загружаем описание и сезоны из Кинопоиска…</p>' : '<p class="kp-info-error">У этой записи нет ID Кинопоиска. Найди аниме через поиск в каталоге.</p>'}</div>
      ${sharedRatingHtml(anime.id)}
      <div class="detail-actions">
        ${watchActionHtml(anime.id)}
        <button type="button" class="button button-primary" data-detail-save="${escapeHtml(anime.id)}">${local.saved ? 'В моём списке ♥' : 'В мой список ♡'}</button>
        ${hasKpId ? `<a class="button button-outline" href="https://www.kinopoisk.ru/${type}/${anime.id}/" target="_blank" rel="noopener noreferrer">Кинопоиск ↗</a>` : ''}
      </div>
      <div class="detail-controls">
        <p class="detail-section-title">МОИ ЗАМЕТКИ О ПРОСМОТРЕ</p>
        <p class="detail-local">Просмотрено серий: ${episodeProgress(anime.id).total}. Отмечай их в блоке просмотра.</p>
        ${ratingControlHtml(anime.id)}
        <div class="detail-local">${state.user ? 'Прогресс и оценка сохраняются в твоём профиле.' : 'Пока данные хранятся в этом браузере. Войди, чтобы сохранить их в профиле.'}</div>
      </div>
    </div>
  </div>`;
}

function rerenderDetail(anime) {
  const player = $('#detail-watch');
  player?.remove();
  renderDetail(anime);
  if (player) $('#detail-content').prepend(player);
}

function showDetail(id) {
  const anime = lookupAnime(id);
  if (!anime) return;
  state.detailId = id;
  renderDetail(anime);
  $('#detail-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  $('#detail-close').focus();
  loadDetailMetadata(id);
  if (/^\d{1,10}$/.test(id)) loadPlayback(id).catch(() => {});
}

function closeDetail() {
  state.detailId = null;
  $('#detail-watch')?.remove();
  $('#detail-overlay').classList.add('hidden');
  document.body.style.overflow = '';
}

function toggleSaved(id) {
  const anime = lookupAnime(id);
  if (!anime) return;
  const entry = localEntry(id);
  entry.saved = !entry.saved;
  if (!state.anime.includes(anime)) entry.external = anime;
  persist(id);
  renderOverview();
  renderCatalog();
  renderSaved();
  renderProfile();
  if (state.detailId === id) rerenderDetail(anime);
  showToast(entry.saved ? 'Добавлено в мой список' : 'Удалено из моего списка');
}

let toastTimer;
function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2700);
}

function navigate(page) {
  state.page = page;
  ['overview','catalog','saved','ratings','recommendations','profile'].forEach((name) => $(`#${name}-page`).classList.toggle('hidden', name !== page));
  $$('[data-page]').forEach((button) => button.classList.toggle('active', button.dataset.page === page));
  $('#current-page-label').textContent = ({overview:'Обзор',catalog:'Каталог',saved:'Мой список',ratings:'Рейтинги',recommendations:'Рекомендации',profile:'Профиль'})[page];
  if (location.hash !== `#${page}`) history.replaceState(null, '', `#${page}`);
  if (page === 'catalog') renderCatalog();
  if (page === 'saved') renderSaved();
  if (page === 'ratings') { renderRankings(); if (state.rankingView === 'site') loadSiteRatings(); }
  if (page === 'recommendations') renderRecommendations();
  if (page === 'profile') renderProfile();
  window.scrollTo({top:0,behavior:'smooth'});
}

function clearFilters() {
  clearTimeout(searchTimer);
  state.remoteSearchSeq++;
  state.remoteResults = [];
  state.remoteSearching = false;
  state.remoteError = '';
  state.query = '';
  state.includeGenres.clear();
  state.excludeGenres.clear();
  state.ratingFilter = '';
  state.type = '';
  state.sort = 'rating';
  state.visibleCount = 60;
  renderCatalog();
}

function setUniverseCopy() {
  const mult = state.universe === 'mult';
  const copy = [
    ['.hero .eyebrow', mult ? '✦ МУЛЬТФИЛЬМЫ, КОТОРЫЕ ОСТАЮТСЯ С ТОБОЙ' : '✦ АНИМЕ, КОТОРОЕ ОСТАЁТСЯ С ТОБОЙ'],
    ['.hero-index', mult ? 'MULT TOP / 001' : 'ANIME TOP / 001'],
    ['.hero-visual-label', mult ? 'A WORLD WORTH EXPLORING' : 'A STORY WORTH FEELING'],
    ['.cta-kanji', mult ? '✦' : '物語'],
    ['#catalog-page .page-intro h1', mult ? 'Исследуй мультфильмы.' : 'Исследуй аниме.'],
    ['#catalog-page .page-intro p', mult ? 'Один каталог — тысячи миров для открытия.' : 'Один поиск — тысячи поводов остаться ещё на серию.'],
    ['#saved-empty p', mult ? 'Добавь понравившийся мультфильм из каталога — он появится здесь.' : 'Добавь понравившееся аниме из каталога — оно появится здесь.'],
    ['.footer p', mult ? 'Мультфильмы и мультсериалы в твоём личном пространстве.' : 'Истории, которые остаются. Твой личный рейтинг и общий топ с друзьями.'],
    ['.auth-intro', mult ? 'Сохраняй мультфильмы, прогресс и личные оценки в своём профиле.' : 'Сохраняй аниме, прогресс и личные оценки в своём профиле.'],
  ];
  for (const [selector, value] of copy) $(selector).textContent = value;
  $('#catalog-search').placeholder = mult ? 'Найти мультфильм...' : 'Найти любое аниме...';
  $('#catalog-search').setAttribute('aria-label', mult ? 'Поиск мультфильмов' : 'Поиск аниме');
  $('#top-search').setAttribute('aria-label', mult ? 'Найти мультфильм' : 'Найти аниме');
  $('#random-anime').disabled = mult && !state.anime.length;
  $('.footer-brand').innerHTML = mult ? 'mult<span>top</span> <i>✦</i>' : 'anime<span>top</span> <i>✦</i>';
  $$('.universe-switcher [data-universe]').forEach((link) => {
    if (link.dataset.universe === state.universe) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  });
  document.body.dataset.universe = state.universe;
  document.title = mult ? 'Mult Top — мир мультфильмов' : 'Anime Top — твоя следующая история';
  $('#site-favicon').href = mult ? './favicon-mult.svg' : './favicon-anime.svg';
  $('meta[name="theme-color"]').content = mult ? '#211610' : '#080b10';
}

let universeSwitchSequence = 0;
async function switchUniverse(mode) {
  if (!['anime', 'mult'].includes(mode) || mode === state.universe) return;
  const sequence = ++universeSwitchSequence;
  try { await ensureCatalog(mode); }
  catch { showToast('Не удалось загрузить каталог. Попробуй ещё раз.'); return; }
  if (sequence !== universeSwitchSequence) return;
  closeDetail();
  state.universe = mode;
  state.anime = state.catalogues[mode];
  prepareCatalogFilters();
  state.recommendationVisibleCount = 60;
  clearFilters();
  const url = new URL(location.href);
  url.searchParams.set('mode', mode);
  url.hash = 'overview';
  history.replaceState(null, '', url);
  setUniverseCopy();
  renderAccount(); renderOverview(); renderCatalog(); renderSaved(); renderProfile();
  navigate('overview');
}

function renderAccount() {
  $('#account-label').textContent = state.user ? state.user.name : 'Войти';
  $('#account-avatar').textContent = state.user ? state.user.name.slice(0, 1).toLocaleUpperCase('ru') : '◉';
  $('#account-button').setAttribute('aria-label', state.user ? 'Открыть профиль' : 'Войти или зарегистрироваться');
  $('#saved-sync-label').textContent = state.user ? 'Синхронизировано с профилем' : 'Сохранено в этом браузере';
}

async function loadSocial() {
  if (!state.user) { state.social = { inviteCode: '', friends: [], ratings: {} }; return; }
  try { state.social = await api('/api/me/social'); }
  catch { state.social = { inviteCode: '', friends: [], ratings: {} }; }
  renderProfile(); renderRankings(); renderCatalog();
  if (state.detailId) { const item = lookupAnime(state.detailId); if (item) rerenderDetail(item); }
}

async function loadSiteRatings(force = false) {
  if (!force && Date.now() - state.siteRatingsLoadedAt < 30_000) return;
  try {
    const data = await api('/api/ratings/site');
    state.siteRatings = Array.isArray(data.items) ? data.items : [];
    state.siteRatingStats = { titles: Number(data.titles) || 0, votes: Number(data.votes) || 0 };
    state.siteRatingsLoadedAt = Date.now();
  } catch { state.siteRatings = []; state.siteRatingStats = { titles: 0, votes: 0 }; }
  if (state.page === 'ratings') renderRankings();
}

function rankingList(items, mode, limit = 10, start = 0) {
  if (!items.length) {
    const empty = mode === 'mine' ? 'Пока нет твоих оценок. Открой карточку и поставь первую.'
      : mode === 'friends' ? 'Добавь друга по коду и сравнивайте оценки.'
      : mode === 'site' ? 'Пока нет оценок пользователей. Твоя может стать первой.'
      : 'Пока нет оценок Кинопоиска.';
    return `<div class="ranking-empty">${empty}</div>`;
  }
  return `<div class="ranking-list">${items.slice(start, start + limit).map(({ item, score, count }, index) => `<button type="button" class="ranking-row" data-open="${escapeHtml(item.id)}"><b>${String(start + index + 1).padStart(2, '0')}</b><span class="ranking-poster">${safePoster(item.poster) ? `<img src="${escapeHtml(safePoster(item.poster))}" alt="" loading="lazy">` : '✦'}</span><span class="ranking-name"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.year || '')}${(mode === 'site' || mode === 'friends') ? ` · ${count} оцен${count === 1 ? 'ка' : count < 5 ? 'ки' : 'ок'}` : ''}</small></span><em>★ ${fmtScore(score)}</em></button>`).join('')}</div>`;
}

function renderRankings() {
  const byId = state.animeIndex;
  const site = state.siteRatings.map((row) => ({ item: byId.get(String(row.id)), score: Number(row.score), count: Number(row.votes) }))
    .filter((row) => row.item && Number.isFinite(row.score));
  const mine = state.anime.map((item) => ({ item, score: ownScore(item.id) }))
    .filter((row) => row.score != null).sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title, 'ru'));
  const isMine = state.rankingView === 'mine';
  const items = isMine ? mine : site;
  const votes = state.siteRatingStats.votes;
  const siteTitles = state.siteRatingStats.titles;
  $('#ratings-content').innerHTML = `<div class="ranking-view-switch" role="tablist" aria-label="Выбрать рейтинг">
    <button type="button" role="tab" data-ranking-view="site" aria-selected="${!isMine}" class="${!isMine ? 'active' : ''}"><span>★</span><strong>Общий рейтинг</strong><small>${siteTitles} историй · ${votes} оценок</small></button>
    <button type="button" role="tab" data-ranking-view="mine" aria-selected="${isMine}" class="${isMine ? 'active' : ''}"><span>◉</span><strong>Мой рейтинг</strong><small>${mine.length} личных оценок</small></button>
  </div><section class="ranking-focus"><div class="ranking-focus-heading"><div><span class="section-kicker">${isMine ? 'ТВОИ ВПЕЧАТЛЕНИЯ' : 'ВЫБОР ЗРИТЕЛЕЙ'}</span><h2>${isMine ? 'Мой рейтинг' : 'Топ сообщества'}<span class="heading-dot">.</span></h2><p>${isMine ? 'Истории, которые ты оценил. Поставь оценки в карточках, чтобы собрать свой топ.' : 'Средние оценки пользователей сайта. Твой голос тоже влияет на этот список.'}</p></div><strong>${isMine ? items.length : siteTitles} ${isMine ? 'оценено' : 'в топе'}</strong></div>
    ${items.length ? rankingList(items, isMine ? 'mine' : 'site', 30) : `<div class="community-empty"><span>★</span><div><strong>${isMine ? 'Твой топ пока пуст.' : 'Первый голос за тобой.'}</strong><p>${isMine ? 'Открой карточку и оцени историю от 1 до 10.' : 'Оцени любую историю от 1 до 10 — она появится здесь.'}</p></div><button type="button" class="button button-primary" data-page="catalog">Открыть каталог ↗</button></div>`}
  </section>`;
}
function getRecommendations() {
  const taste = new Map();
  for (const [id, entry] of Object.entries(state.local)) {
    if (!entry || (!entry.saved && Number(entry.personalRating) < 8)) continue;
    const item = lookupAnime(id);
    for (const genre of item?.genres || []) taste.set(genre, (taste.get(genre) || 0) + (Number(entry.personalRating) >= 8 ? 2 : 1));
  }
  return state.anime.filter((item) => !state.local[item.id]?.saved)
    .map((item) => ({ item, score: item.genres.reduce((sum, genre) => sum + (taste.get(genre) || 0), 0) * 10 + (item.displayRating || 0) }))
    .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title, 'ru'))
    .map(({ item }) => item);
}

function renderRecommendations() {
  const items = getRecommendations();
  $('#recommendations-grid').innerHTML = items.slice(0, state.recommendationVisibleCount).map(cardHtml).join('');
  $('#recommendations-more').classList.toggle('hidden', items.length <= state.recommendationVisibleCount);
}

function renderProfile() {
  const target = $('#profile-content');
  if (!state.user) {
    target.innerHTML = `<div class="profile-guest"><div class="profile-orb">✦</div><span class="section-kicker">СОХРАНИ СВОЮ ИСТОРИЮ</span><h2>${state.universe === 'mult' ? 'Твой мир мультфильмов начинается здесь.' : 'Твой мир аниме начинается здесь.'}</h2><p>Создай профиль, чтобы твой список, прогресс и оценки сохранялись между входами.</p><button type="button" class="button button-primary" data-action="open-auth">Войти или зарегистрироваться ↗</button></div>`;
    return;
  }
  const entries = Object.values(state.local);
  const saved = entries.filter((entry) => entry?.saved).length;
  const episodes = entries.reduce((sum, entry) => sum + (Number(entry?.episodes) || 0), 0);
  const rated = entries.filter((entry) => entry?.personalRating !== '' && entry?.personalRating != null).length;
  const watching = entries.filter((entry) => entry?.watchStatus === 'watching').length;
  const completed = entries.filter((entry) => entry?.watchStatus === 'completed').length;
  const recent = Object.entries(state.local).filter(([, entry]) => entry?.watchStatus === 'watching' || Number(entry?.episodes) > 0).slice(-4).reverse()
    .map(([id]) => lookupAnime(id)).filter(Boolean);
  const recommended = getRecommendations().slice(0, 7);
  target.innerHTML = `<div class="profile-hero"><div class="profile-identity"><span class="profile-avatar">${escapeHtml(state.user.name.slice(0,1).toLocaleUpperCase('ru'))}</span><div><span class="section-kicker">УЧАСТНИК ${state.universe === 'mult' ? 'MULT TOP' : 'ANIME TOP'}</span><h2>${escapeHtml(state.user.name)}</h2><p>${escapeHtml(state.user.email || 'Аккаунт через сервис входа')}</p></div></div><button type="button" class="button button-outline" id="profile-logout">Выйти ↗</button></div>
    <div class="profile-stats"><div><strong>${saved}</strong><span>в моём списке</span></div><div><strong>${episodes}</strong><span>серий отмечено</span></div><div><strong>${watching} / ${completed}</strong><span>смотрю / досмотрено</span></div><div><strong>${rated}</strong><span>личных оценок</span></div></div>
    <div class="profile-panels"><div class="profile-panel"><span class="section-kicker">ЛИЧНОЕ ПРОСТРАНСТВО</span><h3>Создай свой топ</h3><p>Оценивай истории от 1 до 10. Из этих оценок соберётся твой личный рейтинг.</p><button type="button" class="button button-primary" data-ranking-view="mine">Мой рейтинг ↗</button></div><div class="profile-panel"><span class="section-kicker">НАСТРОЙКИ ПРОФИЛЯ</span><h3>Как к тебе обращаться?</h3><form id="profile-name-form"><label for="profile-name">Имя в профиле</label><div class="profile-name-row"><input id="profile-name" required minlength="2" maxlength="50" value="${escapeHtml(state.user.name)}"><button type="submit" class="button button-outline">Сохранить</button></div></form></div></div>
    <div class="profile-panel profile-connections"><span class="section-kicker">БЫСТРЫЙ ВХОД</span><h3>Привязанные аккаунты</h3><p>Подключи другие способы входа к этому профилю. Твои списки и оценки останутся вместе.</p><div class="connection-list">${[["telegram","Telegram"],["google","Google"],["yandex","Яндекс"]].map(([id,label]) => `<button type="button" class="button button-outline" data-provider="${id}" ${state.user.providers?.includes(id) || !state.providers[id] ? "disabled" : ""}>${label} · ${state.user.providers?.includes(id) ? "подключён" : state.providers[id] ? "подключить ↗" : "нужна настройка"}</button>`).join("")}</div></div>
    <div class="friends-panel"><div><span class="section-kicker">ВМЕСТЕ ИНТЕРЕСНЕЕ</span><h3>Друзья и общий рейтинг</h3><p>Отправь другу свой код. Когда он введёт его, вы увидите оценки друг друга и общий топ.</p></div><div class="friend-code"><small>ТВОЙ КОД ПРИГЛАШЕНИЯ</small><strong>${escapeHtml(state.social.inviteCode || 'Загружается…')}</strong><button type="button" class="button button-outline" id="copy-invite" ${state.social.inviteCode ? '' : 'disabled'}>Копировать</button></div><form id="friend-add-form"><label for="friend-code-input">Код друга</label><div><input id="friend-code-input" required minlength="12" maxlength="12" placeholder="12 символов" autocomplete="off" spellcheck="false"><button type="submit" class="button button-primary">Добавить друга ↗</button></div><p id="friend-add-error" class="friend-error hidden" role="alert"></p></form><div class="friends-list">${state.social.friends.length ? state.social.friends.map((friend) => `<div><span class="friend-avatar">${escapeHtml(friend.name.slice(0, 1).toLocaleUpperCase('ru'))}</span><strong>${escapeHtml(friend.name)}</strong><button type="button" data-remove-friend="${escapeHtml(friend.id)}" aria-label="Удалить друга ${escapeHtml(friend.name)}">Убрать ×</button></div>`).join('') : '<p>Друзей пока нет. Поделись кодом и начните собирать общий рейтинг.</p>'}</div></div>
    ${recent.length ? `<div class="profile-recent"><div class="section-heading"><div><div class="section-kicker">ТАМ, ГДЕ ТЫ ОСТАНОВИЛСЯ</div><h2>Продолжить просмотр<span class="heading-dot">.</span></h2></div></div><div class="catalog-grid">${recent.map(cardHtml).join('')}</div></div>` : ''}
    <div class="profile-recent profile-recommendations"><div class="section-heading"><div><div class="section-kicker">ПОД ТВОЁ НАСТРОЕНИЕ</div><h2>Может понравиться<span class="heading-dot">.</span></h2></div><div class="rail-actions"><button type="button" class="rail-arrow" data-rec-scroll="-1" aria-label="Листать рекомендации влево">←</button><button type="button" class="rail-arrow" data-rec-scroll="1" aria-label="Листать рекомендации вправо">→</button></div></div><div class="recommendation-rail" id="profile-recommendation-rail">${recommended.map(cardHtml).join('')}<button type="button" class="recommendation-more-card" data-page="recommendations"><span>✦</span><strong>Больше историй для тебя</strong><small>Открыть все рекомендации ↗</small></button></div></div>`;
}

function setAuthMode(mode) {
  state.authMode = mode;
  const register = mode === 'register';
  const reset = mode === 'resetRequest' || mode === 'resetConfirm';
  $('#auth-title').textContent = ({ register: 'Создать профиль', resetRequest: 'Восстановить пароль', resetConfirm: 'Новый пароль' })[mode] || `Войти в ${state.universe === 'mult' ? 'Mult Top' : 'Anime Top'}`;
  $('#auth-name-wrap').classList.toggle('hidden', !register);
  $('#auth-name').required = register;
  $('#auth-email-wrap').classList.toggle('hidden', mode === 'resetConfirm');
  $('#auth-email').required = mode !== 'resetConfirm';
  $('#auth-password-wrap').classList.toggle('hidden', mode === 'resetRequest');
  $('#auth-password').required = mode !== 'resetRequest';
  $('#auth-password').autocomplete = register || mode === 'resetConfirm' ? 'new-password' : 'current-password';
  $('#auth-submit').innerHTML = ({ register: 'Зарегистрироваться', resetRequest: 'Отправить ссылку', resetConfirm: 'Сохранить пароль' })[mode] || 'Войти';
  $('#auth-switch').textContent = reset ? 'Вернуться ко входу' : register ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться';
  $('#auth-forgot').classList.toggle('hidden', mode !== 'login' || !state.providers.emailVerification);
  $('#auth-resend').classList.add('hidden');
  $('#auth-info').classList.add('hidden');
  $('#auth-error').classList.add('hidden');
}

function renderProviderButtons() {
  $$('#auth-overlay [data-provider]').forEach((button) => {
    const ready = !!state.providers[button.dataset.provider];
    button.disabled = !ready;
    const status = button.querySelector('small');
    if (status) status.textContent = ready ? '↗' : 'нужна настройка';
  });
  $('#auth-provider-note').classList.toggle('hidden', ['telegram', 'google', 'yandex'].some((name) => state.providers[name]));
}

function openAuth(mode = 'login') {
  setAuthMode(mode);
  $('#auth-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  $(mode === 'resetConfirm' ? '#auth-password' : '#auth-email').focus();
}

function closeAuth() {
  $('#auth-overlay').classList.add('hidden');
  document.body.style.overflow = '';
  $('#auth-error').classList.add('hidden');
}

async function applyLogin(data) {
  const guest = readLocal();
  state.user = data.user;
  state.local = data.library || {};
  if (Object.keys(guest).length) {
    try {
      const merged = await api('/api/me/library/merge', { method: 'POST', body: JSON.stringify({ entries: guest }) });
      state.local = merged.library;
      localStorage.removeItem(STORAGE_KEY);
    } catch { showToast('Не удалось перенести данные гостя. Они остались в этом браузере.'); }
  }
  await loadSocial();
  renderAccount(); renderOverview(); renderCatalog(); renderSaved(); renderProfile(); renderRankings();
  closeAuth();
  showToast(`Привет, ${state.user.name}!`);
}

async function submitAuth(event) {
  event.preventDefault();
  const button = $('#auth-submit');
  const error = $('#auth-error');
  button.disabled = true;
  error.classList.add('hidden');
  try {
    const path = ({ register: '/api/auth/register', resetRequest: '/api/auth/reset/request', resetConfirm: '/api/auth/reset/confirm' })[state.authMode] || '/api/auth/login';
    const data = await api(path, { method: 'POST', body: JSON.stringify({ name: $('#auth-name').value, email: $('#auth-email').value, password: $('#auth-password').value, token: state.resetToken }) });
    if (data.pendingVerification || state.authMode === 'resetRequest') {
      const message = data.pendingVerification ? 'Проверь почту и открой ссылку подтверждения. Письмо действует 24 часа.' : 'Если такой email есть на сайте, письмо со ссылкой придёт на него.';
      setAuthMode('login');
      $('#auth-info').textContent = message;
      $('#auth-info').classList.remove('hidden');
      if (data.pendingVerification) $('#auth-resend').classList.remove('hidden');
      return;
    }
    $('#auth-form').reset();
    if (state.authMode === 'resetConfirm') state.resetToken = null;
    await applyLogin(data);
  } catch (err) {
    error.textContent = err.message || 'Не удалось войти.';
    error.classList.remove('hidden');
    if (state.authMode === 'login' && /подтверди email/i.test(error.textContent) && state.providers.emailVerification) $('#auth-resend').classList.remove('hidden');
  } finally { button.disabled = false; }
}

async function logout() {
  try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); }
  catch { showToast('Не удалось выйти. Попробуй ещё раз.'); return; }
  state.user = null;
  state.local = readLocal();
  state.social = { inviteCode: '', friends: [], ratings: {} };
  renderAccount(); renderOverview(); renderCatalog(); renderSaved(); renderProfile(); renderRankings();
  showToast('Ты вышел из профиля');
}

let searchTimer;

function bindEvents() {
  $$('[data-filter-trigger]').forEach((trigger) => trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    const key = trigger.dataset.filterTrigger;
    const opening = $(`#${key}-menu`).classList.contains('hidden');
    $$('.filter-menu').forEach((menu) => menu.classList.add('hidden'));
    $$('[data-filter-trigger]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
    if (opening) { $(`#${key}-menu`).classList.remove('hidden'); trigger.setAttribute('aria-expanded', 'true'); }
  }));
  $('#auth-form').addEventListener('submit', submitAuth);
  $('#profile-content').addEventListener('submit', async (event) => {
    if (event.target.id === 'friend-add-form') {
      event.preventDefault();
      const code = $('#friend-code-input').value;
      const error = $('#friend-add-error');
      try {
        state.social = await api('/api/me/friends', { method: 'POST', body: JSON.stringify({ code }) });
        renderProfile(); renderRankings(); renderCatalog(); showToast('Друг добавлен. Общий рейтинг готов!');
      } catch (err) { error.textContent = err.message; error.classList.remove('hidden'); }
      return;
    }
    if (event.target.id !== 'profile-name-form') return;
    event.preventDefault();
    try {
      const data = await api('/api/me/profile', { method: 'PATCH', body: JSON.stringify({ name: $('#profile-name').value }) });
      state.user = data.user;
      renderAccount(); renderProfile(); showToast('Имя обновлено');
    } catch (error) { showToast(error.message); }
  });
  document.addEventListener('click', (event) => {
    const universe = event.target.closest('.universe-switcher [data-universe]');
    if (universe) { event.preventDefault(); universe.dataset.universe === state.universe ? navigate('overview') : switchUniverse(universe.dataset.universe); return; }
    const option = event.target.closest('[data-filter-option]');
    if (option) {
      const key = option.dataset.filterOption;
      if (key === 'rating') state.ratingFilter = option.dataset.value;
      if (key === 'type') state.type = option.dataset.value;
      if (key === 'sort') state.sort = option.dataset.value;
      state.visibleCount = 60;
      $(`#${key}-menu`).classList.add('hidden');
      $(`[data-filter-trigger="${key}"]`).setAttribute('aria-expanded', 'false');
      renderCatalog(); return;
    }
    const genreChoice = event.target.closest('[data-genre-mode]');
    if (genreChoice) {
      const { genreMode: mode, genreName: name } = genreChoice.dataset;
      const chosen = mode === 'include' ? state.includeGenres : state.excludeGenres;
      const opposite = mode === 'include' ? state.excludeGenres : state.includeGenres;
      chosen.has(name) ? chosen.delete(name) : (chosen.add(name), opposite.delete(name));
      state.visibleCount = 60; renderCatalog(); return;
    }
    const removeGenre = event.target.closest('[data-remove-genre]');
    if (removeGenre) {
      (removeGenre.dataset.removeGenre === 'include' ? state.includeGenres : state.excludeGenres).delete(removeGenre.dataset.genreName);
      state.visibleCount = 60; renderCatalog(); return;
    }
    if (!event.target.closest('.filter-dropdown')) {
      $$('.filter-menu').forEach((menu) => menu.classList.add('hidden'));
      $$('[data-filter-trigger]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
    }
    const rating = event.target.closest('[data-rating]');
    if (rating && state.detailId) {
      localEntry(state.detailId).personalRating = rating.dataset.rating;
      const savedRating = persist(state.detailId);
      if (state.user) Promise.resolve(savedRating).then(() => loadSiteRatings(true));
      const item = lookupAnime(state.detailId);
      if (item) rerenderDetail(item);
      renderCatalog(); renderRankings(); renderProfile();
      showToast(rating.dataset.rating ? 'Оценка добавлена в твой рейтинг' : 'Оценка убрана');
      return;
    }
    if (event.target.closest('#copy-invite')) {
      navigator.clipboard.writeText(state.social.inviteCode).then(() => showToast('Код скопирован')).catch(() => showToast('Не удалось скопировать код'));
      return;
    }
    const removeFriend = event.target.closest('[data-remove-friend]');
    if (removeFriend) {
      api(`/api/me/friends/${removeFriend.dataset.removeFriend}`, { method: 'DELETE', body: '{}' }).then((social) => { state.social = social; renderProfile(); renderRankings(); renderCatalog(); showToast('Друг удалён'); }).catch((error) => showToast(error.message));
      return;
    }
    const save = event.target.closest('[data-save], [data-detail-save]');
    if (save) { toggleSaved(save.dataset.save || save.dataset.detailSave); return; }
    const watch = event.target.closest('[data-watch]');
    if (watch) { watchAnime(watch.dataset.watch); return; }
    if (event.target.closest('[data-close-watch]')) { $('#detail-watch')?.remove(); return; }
    const voice = event.target.closest('[data-playback-option]');
    if (voice && state.detailId) { state.playbackSelection.set(state.detailId, voice.dataset.playbackOption); renderPlayback(state.detailId); return; }
    const playEpisode = event.target.closest('[data-play-episode]');
    if (playEpisode && state.detailId) { state.playbackEpisode.set(state.detailId, playEpisode.dataset.playEpisode); renderPlayback(state.detailId); $('.detail-watch-stage')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    const selectEpisode = event.target.closest('[data-select-episode]');
    if (selectEpisode && state.detailId) { state.playbackEpisode.set(state.detailId, selectEpisode.dataset.selectEpisode); renderPlayback(state.detailId); $('#detail-watch')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const seasonButton = event.target.closest('[data-season]');
    if (seasonButton && state.detailId) { state.selectedSeasons.set(state.detailId, Number(seasonButton.dataset.season)); refreshEpisodePanel(state.detailId); return; }
    const statusButton = event.target.closest('[data-watch-status]');
    if (statusButton && state.detailId) { localEntry(state.detailId).watchStatus = statusButton.dataset.watchStatus; persist(state.detailId); refreshEpisodePanel(state.detailId); renderProfile(); return; }
    const episodeButton = event.target.closest('[data-episode]');
    if (episodeButton && state.detailId) {
      const entry = localEntry(state.detailId);
      const progress = episodeProgress(state.detailId);
      entry.legacyEpisodes = progress.legacy;
      entry.watchedEpisodes = progress.watched.includes(episodeButton.dataset.episode) ? progress.watched.filter((key) => key !== episodeButton.dataset.episode) : [...progress.watched, episodeButton.dataset.episode];
      entry.episodes = entry.legacyEpisodes + entry.watchedEpisodes.length;
      persist(state.detailId);
      refreshEpisodePanel(state.detailId);
      renderProfile();
      const title = $('#detail-content .detail-controls .detail-section-title');
      if (title && state.universe === 'mult') title.textContent = `МОЙ ПРОСМОТР · ${entry.episodes} СЕРИЙ`;
      const note = $('#detail-content .detail-controls .detail-local');
      if (note && state.universe === 'anime') note.textContent = `Просмотрено серий: ${entry.episodes}. Отмечай их в блоке просмотра.`;
      return;
    }
    if (event.target.closest('[data-add-episode]') && state.detailId) {
      const entry = localEntry(state.detailId);
      const season = state.selectedSeasons.get(state.detailId) || 1;
      const existing = $('#episode-panel .episode-grid').querySelectorAll('[data-episode]').length;
      entry.episodeOverrides ||= {};
      entry.episodeOverrides[season] = Math.min(9999, Math.max(existing, entry.episodeOverrides[season] || 0) + 1);
      persist(state.detailId);
      refreshEpisodePanel(state.detailId);
      return;
    }
    const open = event.target.closest('[data-open]');
    if (open) { showDetail(open.dataset.open); return; }
    const railArrow = event.target.closest('[data-rec-scroll]');
    if (railArrow) { $('#profile-recommendation-rail')?.scrollBy({ left: Number(railArrow.dataset.recScroll) * 480, behavior: 'smooth' }); return; }
    const rankingView = event.target.closest('[data-ranking-view]');
    if (rankingView) { state.rankingView = rankingView.dataset.rankingView; if (state.page !== 'ratings') navigate('ratings'); else { renderRankings(); if (state.rankingView === 'site') loadSiteRatings(); } return; }
    const nav = event.target.closest('[data-page]');
    if (nav) { navigate(nav.dataset.page); return; }
    const action = event.target.closest('[data-action]');
    if (action?.dataset.action === 'browse') { navigate('catalog'); return; }
    if (action?.dataset.action === 'open-auth') { openAuth(); return; }
    if (action?.dataset.action === 'clear') { clearFilters(); return; }
    const genre = event.target.closest('[data-genre]');
    if (genre) { state.includeGenres.clear(); state.excludeGenres.clear(); state.includeGenres.add(genre.dataset.genre); navigate('catalog'); return; }
    const view = event.target.closest('[data-view]');
    if (view) { state.view = view.dataset.view; renderCatalog(); return; }
    if (event.target.closest('#catalog-more')) { state.visibleCount += 60; renderCatalog(); return; }
    if (event.target.id === 'clear-filters') { clearFilters(); return; }
    if (event.target.id === 'recommendations-more') { state.recommendationVisibleCount += 60; renderRecommendations(); return; }
    if (event.target.id === 'detail-close' || event.target.id === 'detail-overlay') { closeDetail(); return; }
    if (event.target.id === 'random-anime') { if (state.anime.length) showDetail(state.anime[Math.floor(Math.random() * state.anime.length)].id); return; }
    if (event.target.id === 'account-button' || event.target.closest('#account-button')) { state.user ? navigate('profile') : openAuth(); return; }
    if (event.target.id === 'auth-close' || event.target.id === 'auth-overlay') { closeAuth(); return; }
    if (event.target.id === 'auth-switch') { setAuthMode(state.authMode === 'login' ? 'register' : 'login'); return; }
    if (event.target.id === 'auth-forgot') { setAuthMode('resetRequest'); return; }
    if (event.target.id === 'auth-resend') {
      api('/api/auth/verification/request', { method: 'POST', body: JSON.stringify({ email: $('#auth-email').value }) })
        .then(() => { $('#auth-info').textContent = 'Если адрес ждёт подтверждения, письмо отправлено ещё раз.'; $('#auth-info').classList.remove('hidden'); $('#auth-error').classList.add('hidden'); })
        .catch((error) => { $('#auth-error').textContent = error.message; $('#auth-error').classList.remove('hidden'); });
      return;
    }
    if (event.target.id === 'profile-logout') { logout(); return; }
    const provider = event.target.closest('[data-provider]');
    if (provider) {
      if (state.providers[provider.dataset.provider] && !provider.disabled) location.assign(`/api/auth/oauth/${provider.dataset.provider}/start?mode=${state.universe}`);
      return;
    }
    const retry = event.target.closest('[data-kp-retry]');
    if (retry) { $('#kp-info').innerHTML = '<p class="kp-loading">Загружаем данные Кинопоиска…</p>'; loadDetailMetadata(retry.dataset.kpRetry); return; }
    if (event.target.closest('#top-search')) { navigate('catalog'); $('#catalog-search').focus(); }
  });

  document.addEventListener('input', (event) => {
    if (event.target.id === 'genre-search') { renderGenreOptions(); return; }
    if (event.target.id === 'catalog-search') {
      state.query = event.target.value;
      state.visibleCount = 60;
      clearTimeout(searchTimer);
      state.remoteSearchSeq++;
      state.remoteResults = [];
      state.remoteSearching = false;
      state.remoteError = '';
      renderCatalog();
      if (state.query.trim().length >= 2 && filteredAnime().length < 5) searchTimer = setTimeout(searchKinopoisk, 550);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && $$('.filter-menu').some((menu) => !menu.classList.contains('hidden'))) { $$('.filter-menu').forEach((menu) => menu.classList.add('hidden')); $$('[data-filter-trigger]').forEach((button) => button.setAttribute('aria-expanded', 'false')); return; }
    if (event.key === 'Escape' && !$('#auth-overlay').classList.contains('hidden')) { closeAuth(); return; }
    if (event.key === 'Escape' && state.detailId) { closeDetail(); return; }
    if (event.key === 'Enter' && event.target.id === 'catalog-search') { event.preventDefault(); clearTimeout(searchTimer); if (filteredAnime().length < 5) searchKinopoisk(); return; }
    if (event.key === '/' && !['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) {
      event.preventDefault(); navigate('catalog'); $('#catalog-search').focus();
    }
  });
  document.addEventListener('error', (event) => {
    if (event.target.tagName === 'IMG') event.target.style.display = 'none';
  }, true);
  window.addEventListener('hashchange', () => {
    const page = location.hash.slice(1);
    if (['overview','catalog','saved','ratings','recommendations','profile'].includes(page)) navigate(page);
  });
}

async function init() {
  bindEvents();
  try {
    const initialMode = state.universe;
    const catalogPromise = ensureCatalog(initialMode).then((items) => ({ items }), (error) => ({ error }));
    try { state.providers = await api('/api/auth/providers'); renderProviderButtons(); } catch { /* Email remains available. */ }
    try {
      const session = await api('/api/auth/me');
      if (session.user) {
        state.user = session.user;
        state.local = session.library;
        const guest = readLocal();
        if (Object.keys(guest).length) {
          const merged = await api('/api/me/library/merge', { method: 'POST', body: JSON.stringify({ entries: guest }) });
          state.local = merged.library;
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    } catch { /* Каталог остаётся доступным при ошибке аккаунта. */ }
    const catalogResult = await catalogPromise;
    if (catalogResult.error) throw catalogResult.error;
    state.anime = state.universe === initialMode ? catalogResult.items : await ensureCatalog(state.universe);
    prepareCatalogFilters();
    setUniverseCopy();
    renderAccount(); renderOverview(); renderCatalog(); renderSaved(); renderProfile(); renderRankings();
    if (state.user) loadSocial();
    const page = location.hash.slice(1);
    navigate(['overview','catalog','saved','ratings','recommendations','profile'].includes(page) ? page : 'overview');
    const authResult = new URLSearchParams(location.search);
    if (authResult.has('reset_token')) {
      state.resetToken = authResult.get('reset_token');
      openAuth('resetConfirm');
      const clean = new URL(location.href);
      clean.searchParams.delete('reset_token');
      history.replaceState(null, '', clean);
    }
    if (authResult.has('auth') || authResult.has('auth_error')) {
      const messages = { cancelled: 'Вход отменён.', expired: 'Время входа истекло. Попробуй ещё раз.', failed: 'Не удалось подтвердить вход. Попробуй ещё раз.', conflict: 'Этот аккаунт уже привязан или email занят. Войди по email и подключи сервис в профиле.' };
      showToast(authResult.get('auth') === 'success' ? `Привет, ${state.user?.name || 'друг'}!` : authResult.get('auth') === 'verified' ? 'Email подтверждён. Добро пожаловать!' : messages[authResult.get('auth_error')] || 'Не удалось войти.');
      const clean = new URL(location.href);
      clean.searchParams.delete('auth'); clean.searchParams.delete('auth_error');
      history.replaceState(null, '', clean);
    }
  } catch (error) {
    console.error(error);
    $('#hero-feature').textContent = 'Не удалось загрузить каталог. Перезапусти локальный сервер.';
    showToast('Ошибка загрузки данных');
  }
}

init();
