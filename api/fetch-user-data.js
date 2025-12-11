import * as cheerio from 'cheerio';
import { Redis } from '@upstash/redis';

const TMDB_API_KEY = process.env.TMDB_API_KEY;

if (!TMDB_API_KEY) {
  console.warn('TMDB_API_KEY is not set. The API route will fail until it is configured in the environment.');
}

const LETTERBOXD_BASE = 'https://letterboxd.com';

// Lazily-initialized Upstash Redis client. If the required
// environment variables are missing (e.g. locally without
// integration), caching will be skipped safely.
let redis = null;
function getRedisClient() {
  if (redis) return redis;

  // Support both the newer Upstash Redis env vars
  // (UPSTASH_REDIS_REST_URL/TOKEN) and the Vercel KV-style
  // env vars (KV_REST_API_URL/TOKEN) that your integration
  // created.
  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    process.env.KV_URL;

  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return null;
  }

  redis = new Redis({ url, token });
  return redis;
}

// Simple versioned cache key helpers so we can invalidate cached
// payloads by bumping CACHE_VERSION.
const CACHE_VERSION = 'v2';

// How long to cache the fully-enriched per-user payload.
const USER_CACHE_TTL_SECONDS = 60 * 60 * 6; // 6 hours

// How long to cache per-film Letterboxd metadata and TMDB
// enrichment. These can safely live longer because film metadata
// changes rarely.
const FILM_LB_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const FILM_TMDB_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function buildUserCacheKey(username) {
  return `letterboxd-stats:${CACHE_VERSION}:user:${String(username).toLowerCase()}`;
}

function buildFilmLetterboxdCacheKey(letterboxdUri) {
  const normalized = normalizeFilmUrl(letterboxdUri || '');
  return `letterboxd-stats:${CACHE_VERSION}:film:lbmeta:${encodeURIComponent(normalized)}`;
}

function buildFilmTmdbCacheKey(movie) {
  const normalizedName = normalizeTitleForSearch(movie.Name || '');
  const year = movie.Year || '';
  const base = `${normalizedName || movie.Name || ''}::${year}`;
  return `letterboxd-stats:${CACHE_VERSION}:film:tmdb:${encodeURIComponent(base)}`;
}

// Normalize titles before sending them to TMDB search so that
// minor punctuation/whitespace differences between Letterboxd and
// TMDB (different dashes, quotes, etc.) don't hurt matching.
function normalizeTitleForSearch(name) {
  if (!name || typeof name !== 'string') return '';
  return name
    // Normalize various unicode dashes to a simple hyphen
    .replace(/[\u2012-\u2015]/g, '-')
    // Normalize fancy quotes to plain quotes
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    // Collapse multiple spaces
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; LetterboxdStatsBot/1.0; +https://github.com/ErenTerakye)'
    }
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return await res.text();
}

function normalizeFilmUrl(letterboxdUri) {
  if (!letterboxdUri) return '';
  // Accept full URLs or "/film/..." paths and normalize trailing slash
  let url = letterboxdUri;
  if (!url.startsWith('http')) {
    url = `${LETTERBOXD_BASE}${url}`;
  }
  if (!url.endsWith('/')) {
    url += '/';
  }
  return url;
}

// Placeholder: scrape detailed Letterboxd metadata for a single film.
// This function will be wired to use the real CSS selectors
// once the HTML structure for cast, crew, details, and genres pages
// is finalized.
async function scrapeLetterboxdFilmMeta(letterboxdUri) {
  const baseUrl = normalizeFilmUrl(letterboxdUri);
  if (!baseUrl) {
    return {
      lbCast: [],
      lbCrew: [],
      lbStudios: [],
      lbCountries: [],
      lbGenres: [],
      lbThemes: [],
      lbPosterUrl: null,
    };
  }

  const urls = {
    main: baseUrl,
    crew: `${baseUrl}crew/`,
    details: `${baseUrl}details/`,
    genres: `${baseUrl}genres/`,
  };

  try {
    const [mainHtml, crewHtml, detailsHtml, genresHtml] = await Promise.all([
      fetchHtml(urls.main),
      fetchHtml(urls.crew),
      fetchHtml(urls.details),
      fetchHtml(urls.genres),
    ]);

    const main$ = cheerio.load(mainHtml);
    const crew$ = cheerio.load(crewHtml);
    const details$ = cheerio.load(detailsHtml);
    const genres$ = cheerio.load(genresHtml);

    // --- Poster (from main film page) ---
    let lbPosterUrl = null;
    try {
      const EMPTY_POSTER_FRAGMENT = 'empty-poster';

      const normalizeUrl = (u) => {
        if (!u) return null;
        const trimmed = String(u).trim();
        if (!trimmed || trimmed.includes(EMPTY_POSTER_FRAGMENT)) return null;
        if (trimmed.startsWith('http')) return trimmed;
        if (trimmed.startsWith('//')) return `https:${trimmed}`;
        return trimmed;
      };

      // 1) Prefer the Open Graph image in <head>, which usually
      // matches the main poster and is very stable.
      const ogImage = normalizeUrl(main$('meta[property="og:image"]').attr('content'));
      if (ogImage) {
        lbPosterUrl = ogImage;
      }

      // 2) Fallback to poster <img> elements in the page if needed.
      if (!lbPosterUrl) {
        // Try a few likely selectors to locate the main poster image
        let posterImg = main$('div.poster.film-poster img').first();

        if (!posterImg || !posterImg.length) {
          posterImg = main$('.film-poster img').first();
        }

        if (!posterImg || !posterImg.length) {
          posterImg = main$('.poster img').first();
        }

        if (!posterImg || !posterImg.length) {
          posterImg = main$('img[class*="film-poster"]').first();
        }

        if (posterImg && posterImg.length) {
          // Some Letterboxd HTML uses srcset/data-srcset with the real poster
          // and puts an "empty-poster" placeholder in src. Prefer srcset first.
          const rawSrcset =
            posterImg.attr('data-srcset') ||
            posterImg.attr('srcset') ||
            '';

          if (rawSrcset) {
            const candidates = rawSrcset
              .split(',')
              .map((part) => part.trim().split(' ')[0])
              .filter(Boolean);

            for (const candidate of candidates) {
              const url = normalizeUrl(candidate);
              if (url) {
                lbPosterUrl = url;
                break;
              }
            }
          }

          if (!lbPosterUrl) {
            const rawSrc =
              posterImg.attr('data-src') ||
              posterImg.attr('src') ||
              '';
            const url = normalizeUrl(rawSrc);
            if (url) {
              lbPosterUrl = url;
            }
          }
        }
      }
    } catch (posterErr) {
      console.warn('Failed to parse Letterboxd poster for', letterboxdUri, posterErr);
    }

    // --- Cast (from main film page, including overflow) ---
    const lbCast = [];
    main$('#tab-cast .cast-list a.text-slug').each((_, el) => {
      const anchor = main$(el);
      const href = anchor.attr('href') || '';
      // Skip the "Show All…" toggle which has no href
      if (!href) return;
      const name = anchor.text().trim();
      if (!name) return;
      const characterAttr = anchor.attr('data-original-title');
      const character = characterAttr ? characterAttr.trim() : '';
      lbCast.push({ name, character: character || undefined });
    });

    // --- Crew (from /crew/ page) ---
    const lbCrew = [];
    crew$('#tab-crew h3').each((_, h3) => {
      const heading = crew$(h3);
      const jobText =
        heading.find('.crewrole.-full').text().trim() ||
        heading.text().trim();
      if (!jobText) return;
      const list = heading.next('.text-sluglist');
      if (!list || !list.length) return;
      list.find('a.text-slug').each((__, link) => {
        const name = crew$(link).text().trim();
        if (!name) return;
        lbCrew.push({ name, job: jobText });
      });
    });

    // --- Studios & Countries (from /details/ page) ---
    const lbStudios = [];
    const lbCountries = [];
    details$('#tab-details h3').each((_, h3) => {
      const heading = details$(h3);
      const label = heading.text().trim();
      const list = heading.next('.text-sluglist');
      if (!list || !list.length) return;

      if (/studios?/i.test(label)) {
        list.find('a.text-slug').each((__, link) => {
          const name = details$(link).text().trim();
          if (name) lbStudios.push(name);
        });
      } else if (/countries?/i.test(label)) {
        list.find('a.text-slug').each((__, link) => {
          const name = details$(link).text().trim();
          if (name) lbCountries.push(name);
        });
      }
    });

    // --- Genres & Themes (from /genres/ page) ---
    const lbGenres = [];
    const lbThemes = [];
    genres$('#tab-genres h3').each((_, h3) => {
      const heading = genres$(h3);
      const label = heading.text().trim();
      const list = heading.next('.text-sluglist');
      if (!list || !list.length) return;

      if (/genres?/i.test(label)) {
        list.find('a.text-slug').each((__, link) => {
          const text = genres$(link).text().trim();
          const href = genres$(link).attr('href') || '';
          if (!href || !text) return;
          lbGenres.push(text);
        });
      } else if (/themes?/i.test(label)) {
        list.find('a.text-slug').each((__, link) => {
          const text = genres$(link).text().trim();
          const href = genres$(link).attr('href') || '';
          // Skip the "Show All…" link which points back to /film/.../themes/
          if (!href || /^show all/i.test(text)) return;
          lbThemes.push(text);
        });
      }
    });

    return { lbCast, lbCrew, lbStudios, lbCountries, lbGenres, lbThemes, lbPosterUrl };
  } catch (err) {
    console.error('Failed to scrape Letterboxd film metadata for', letterboxdUri, err);
    return {
      lbCast: [],
      lbCrew: [],
      lbStudios: [],
      lbCountries: [],
      lbGenres: [],
      lbThemes: [],
      lbPosterUrl: null,
    };
  }
}

// Scrape a single diary page and return entries + whether a next page exists
async function scrapeDiaryPage(username, page = 1) {
  const path = page === 1
    ? `/${username}/diary/`
    : `/${username}/diary/page/${page}/`;

  const html = await fetchHtml(`${LETTERBOXD_BASE}${path}`);
  const $ = cheerio.load(html);

  const entries = [];

  // Each diary row is a table row under #diary-table
  $('#diary-table tbody tr.diary-entry-row').each((_, el) => {
    const row = $(el);

    // Film title and base film link
    const titleLink = row.find('.inline-production-masthead h2.name a');
    const name = titleLink.text().trim();

    // Prefer the generic film link from LazyPoster data attributes,
    // fall back to the title link (which is user-specific)
    let filmPath =
      row.find('.react-component.figure').attr('data-item-link') ||
      titleLink.attr('href') ||
      '';

    if (filmPath && !filmPath.startsWith('http')) {
      filmPath = `${LETTERBOXD_BASE}${filmPath}`;
    }

    // Release year (displayed in its own column and within releasedate span)
    const yearText =
      row.find('td.col-releaseyear span').text().trim() ||
      row.find('.releasedate a').first().text().trim();

    // Full diary date can be derived from the day link URL:
    // e.g. /username/diary/films/for/2025/11/29/
    const dayLink = row.find('td.col-daydate a.daydate');
    const dayHref = dayLink.attr('href') || '';
    let dateText = '';
    const dateMatch = dayHref.match(/for\/(\d{4})\/(\d{2})\/(\d{2})\//);
    if (dateMatch) {
      const [, year, month, day] = dateMatch;
      dateText = `${year}-${month}-${day}`;
    } else {
      // Fallback to just the day number if parsing fails
      dateText = dayLink.text().trim();
    }

    // Rating is stored as a class like "rating rated-8" (0-10, halves included)
    const ratingEl = row.find('span.rating');
    const ratingClass = ratingEl.attr('class') || '';
    const ratingClassMatch = ratingClass.match(/rated-(\d+)/);
    let rating = '';
    if (ratingClassMatch) {
      const value = parseInt(ratingClassMatch[1], 10);
      if (!Number.isNaN(value)) {
        rating = String(value / 2);
      }
    } else {
      // Fallback to parsing star characters if needed
      rating = normalizeLetterboxdRating(ratingEl.text().trim());
    }

    if (!name) {
      return;
    }

    entries.push({
      Date: dateText,
      Name: name,
      Year: yearText,
      LetterboxdURI: filmPath,
      Rating: rating,
    });
  });

  const hasNext = $('.paginate-nextprev .next').length > 0;
  return { entries, hasNext };
}

function normalizeLetterboxdRating(text) {
  if (!text) return '';
  // Ratings are rendered as stars (e.g. "★★★½"); count stars + optional half
  const fullStars = (text.match(/★/g) || []).length;
  const hasHalf = text.includes('½');
  if (!fullStars && !hasHalf) return '';
  const value = fullStars + (hasHalf ? 0.5 : 0);
  return String(value);
}

async function scrapeFullDiary(username, maxPages = 10) {
  const allEntries = [];
  let page = 1;
  while (page <= maxPages) {
    const { entries, hasNext } = await scrapeDiaryPage(username, page);
    if (!entries.length && page === 1) {
      // Probably invalid username or private profile
      break;
    }
    allEntries.push(...entries);
    if (!hasNext) break;
    page += 1;
  }
  return allEntries;
}

// Scrape a single films page ("Watched" grid) and return entries + whether a next page exists
async function scrapeFilmsPage(username, page = 1) {
  const path = page === 1
    ? `/${username}/films/`
    : `/${username}/films/page/${page}/`;

  const html = await fetchHtml(`${LETTERBOXD_BASE}${path}`);
  const $ = cheerio.load(html);

  const entries = [];

  // Each film is a grid item under .poster-grid
  $('.poster-grid ul.grid li.griditem').each((_, el) => {
    const item = $(el);

    const posterComponent = item.find('.react-component[data-component-class="LazyPoster"]');
    if (!posterComponent.length) return;

    const fullName = posterComponent.attr('data-item-full-display-name') || '';
    const name = posterComponent.attr('data-item-name') || fullName;
    if (!name) return;

    let filmPath = posterComponent.attr('data-item-link') || '';
    if (filmPath && !filmPath.startsWith('http')) {
      filmPath = `${LETTERBOXD_BASE}${filmPath}`;
    }

    // Year is at the end of full display name, e.g. "Title (2025)"
    let yearText = '';
    const yearMatch = fullName.match(/\((\d{4})\)\s*$/);
    if (yearMatch) {
      yearText = yearMatch[1];
    }

    const ratingEl = item.find('p.poster-viewingdata span.rating');
    const ratingClass = ratingEl.attr('class') || '';
    const ratingClassMatch = ratingClass.match(/rated-(\d+)/);
    let rating = '';
    if (ratingClassMatch) {
      const value = parseInt(ratingClassMatch[1], 10);
      if (!Number.isNaN(value)) {
        rating = String(value / 2);
      }
    } else {
      rating = normalizeLetterboxdRating(ratingEl.text().trim());
    }

    entries.push({
      Date: '', // Films page does not expose a specific watch date
      Name: name,
      Year: yearText,
      LetterboxdURI: filmPath,
      Rating: rating,
    });
  });

  const hasNext = $('.paginate-nextprev .next').length > 0;
  return { entries, hasNext };
}

async function scrapeFullFilms(username, maxPages = 20) {
  const allEntries = [];
  let page = 1;
  while (page <= maxPages) {
    const { entries, hasNext } = await scrapeFilmsPage(username, page);
    allEntries.push(...entries);
    if (!hasNext) break;
    page += 1;
  }
  return allEntries;
}

async function searchTMDB(movie) {
  const baseParams = new URLSearchParams({
    api_key: TMDB_API_KEY,
    include_adult: 'false',
  });

  // Helper to run a search and return TMDB results array
  const runSearch = async (path, extraParams = {}) => {
    const url = new URL(`https://api.themoviedb.org/3${path}`);
    const params = new URLSearchParams(baseParams.toString());
    const normalizedName = normalizeTitleForSearch(movie.Name);
    params.set('query', normalizedName || movie.Name || '');
    Object.entries(extraParams).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
    });
    url.search = params.toString();

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Search failed: ${res.statusText}`);
    const data = await res.json();
    return Array.isArray(data.results) ? data.results : [];
  };

  // 1) Movie search with year (most precise)
  if (movie.Year) {
    const results = await runSearch('/search/movie', { year: movie.Year });
    if (results.length > 0) {
      return { match: results[0], mediaType: 'movie' };
    }
  }

  // 2) Movie search without year (fallback)
  {
    const results = await runSearch('/search/movie');
    if (results.length > 0) {
      return { match: results[0], mediaType: 'movie' };
    }
  }

  // 3) Multi search (to catch popular TV/limited series etc.)
  {
    const results = await runSearch('/search/multi');
    const filtered = results.filter(r => r.media_type === 'movie' || r.media_type === 'tv');
    if (filtered.length > 0) {
      const best = filtered.sort((a, b) => (b.popularity || 0) - (a.popularity || 0))[0];
      return { match: best, mediaType: best.media_type };
    }
  }

  return { match: null, mediaType: null };
}

async function enrichWithTMDB(entries, forceRefresh = false) {
  if (!TMDB_API_KEY) {
    throw new Error('TMDB_API_KEY is not configured on the server.');
  }

  const result = [];
  const CHUNK_SIZE = 3;

  const redisClient = getRedisClient();

  for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
    const chunk = entries.slice(i, i + CHUNK_SIZE);

    const enrichedChunk = await Promise.all(chunk.map(async (movie) => {
      const cacheKey = redisClient ? buildFilmTmdbCacheKey(movie) : null;

      // Try per-film TMDB cache first, unless this is an explicit
      // force-refresh request.
      if (!forceRefresh && redisClient && cacheKey) {
        try {
          const cached = await redisClient.get(cacheKey);
          if (cached && typeof cached === 'object') {
            return { ...movie, ...cached };
          }
        } catch (cacheErr) {
          console.warn('Redis TMDB film cache get failed for', movie.Name, cacheErr);
        }
      }

      try {
        const { match, mediaType } = await searchTMDB(movie);

        if (!match || !mediaType) {
          const tmdbPayload = { notFound: true };

          if (redisClient && cacheKey) {
            try {
              await redisClient.set(cacheKey, tmdbPayload, { ex: FILM_TMDB_CACHE_TTL_SECONDS });
            } catch (cacheErr) {
              console.warn('Redis TMDB film cache set failed for', movie.Name, cacheErr);
            }
          }

          return { ...movie, ...tmdbPayload };
        }

        const typePath = mediaType === 'tv' ? 'tv' : 'movie';
        const detailsUrl = new URL(`https://api.themoviedb.org/3/${typePath}/${match.id}`);
        detailsUrl.searchParams.set('api_key', TMDB_API_KEY);
        detailsUrl.searchParams.set('append_to_response', 'credits');

        const detailsRes = await fetch(detailsUrl);
        if (!detailsRes.ok) throw new Error(`Details failed: ${detailsRes.statusText}`);
        const detailsData = await detailsRes.json();

        const credits = detailsData.credits || {};
        const directors = (credits.crew || [])
          .filter((person) => person.job === 'Director' || person.job === 'Series Director' || person.department === 'Directing')
          .map((d) => ({ id: d.id, name: d.name }));

        const cast = (credits.cast || [])
          .slice(0, 10)
          .map((c) => ({ id: c.id, name: c.name }));

        // Approximate runtime for TV if needed
        let runtime = 0;
        if (typeof detailsData.runtime === 'number') {
          runtime = detailsData.runtime;
        } else if (Array.isArray(detailsData.episode_run_time) && detailsData.episode_run_time.length > 0) {
          runtime = detailsData.episode_run_time[0];
        }

        const tmdbPayload = {
          poster_path: match.poster_path,
          backdrop_path: match.backdrop_path,
          genres: detailsData.genres || [],
          production_countries: detailsData.production_countries || [],
          original_language: match.original_language,
          tmdb_id: match.id,
          runtime: runtime || 0,
          directors,
          cast,
        };

        if (redisClient && cacheKey) {
          try {
            await redisClient.set(cacheKey, tmdbPayload, { ex: FILM_TMDB_CACHE_TTL_SECONDS });
          } catch (cacheErr) {
            console.warn('Redis TMDB film cache set failed for', movie.Name, cacheErr);
          }
        }

        return { ...movie, ...tmdbPayload };
      } catch (err) {
        console.error('TMDB enrichment failed for', movie.Name, err);
        const tmdbPayload = { error: true };

        if (redisClient && cacheKey) {
          try {
            await redisClient.set(cacheKey, tmdbPayload, { ex: FILM_TMDB_CACHE_TTL_SECONDS });
          } catch (cacheErr) {
            console.warn('Redis TMDB film cache set failed for', movie.Name, cacheErr);
          }
        }

        return { ...movie, ...tmdbPayload };
      }
    }));

    result.push(...enrichedChunk);
    await new Promise((r) => setTimeout(r, 300));
  }

  return result;
}

// Enrich list of films with Letterboxd-native metadata (cast, crew,
// studios, countries, genres, themes) scraped from each film's page.
async function enrichWithLetterboxdDetails(entries, forceRefresh = false) {
  const result = [];
  const CHUNK_SIZE = 3;
  const redisClient = getRedisClient();

  for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
    const chunk = entries.slice(i, i + CHUNK_SIZE);

    const enrichedChunk = await Promise.all(chunk.map(async (movie) => {
      if (!movie.LetterboxdURI) return movie;

      const cacheKey = redisClient
        ? buildFilmLetterboxdCacheKey(movie.LetterboxdURI)
        : null;

      // Try per-film Letterboxd metadata cache first, unless this is
      // an explicit force-refresh request.
      if (!forceRefresh && redisClient && cacheKey) {
        try {
          const cached = await redisClient.get(cacheKey);
          if (cached && typeof cached === 'object') {
            return { ...movie, ...cached };
          }
        } catch (cacheErr) {
          console.warn('Redis LB film cache get failed for', movie.Name, cacheErr);
        }
      }

      try {
        const meta = await scrapeLetterboxdFilmMeta(movie.LetterboxdURI);

        if (redisClient && cacheKey) {
          try {
            await redisClient.set(cacheKey, meta, { ex: FILM_LB_CACHE_TTL_SECONDS });
          } catch (cacheErr) {
            console.warn('Redis LB film cache set failed for', movie.Name, cacheErr);
          }
        }

        return { ...movie, ...meta };
      } catch (err) {
        console.error('Letterboxd details enrichment failed for', movie.Name, err);
        return movie;
      }
    }));

    result.push(...enrichedChunk);
    // Small delay between chunks to be gentle with Letterboxd.
    await new Promise((r) => setTimeout(r, 200));
  }

  return result;
}

export default async function handler(req, res) {
  // Basic CORS support so the frontend on GitHub Pages (or other origins)
  // can call this Vercel function.
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed. Use GET.' });
    return;
  }

  const { username } = req.query;
  if (!username || typeof username !== 'string') {
    res.status(400).json({ error: 'Missing or invalid username parameter.' });
    return;
  }

  const cacheKey = buildUserCacheKey(username);

  // Optional flag to force a refresh and bypass the cache, e.g.
  // /api/fetch-user-data?username=foo&forceRefresh=true
  const forceRefresh = String(req.query.forceRefresh || '').toLowerCase() === 'true';

  const redisClient = getRedisClient();

  if (!forceRefresh && redisClient) {
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached && typeof cached === 'object' && Array.isArray(cached.movies)) {
        res.status(200).json(cached);
        return;
      }
    } catch (cacheErr) {
      console.warn('Redis cache get failed, continuing without cache:', cacheErr);
    }
  }

  try {
    // 1) Fetch films first (primary source of what you've rated/watched)
    let filmEntries = [];
    try {
      filmEntries = await scrapeFullFilms(username);
    } catch (filmErr) {
      console.error('Failed to scrape films page', filmErr);
    }

    // 2) Fetch diary separately (used mainly for per-year diary stats)
    const diaryEntries = await scrapeFullDiary(username);

    if (!filmEntries.length && !diaryEntries.length) {
      res.status(404).json({ error: 'No films or diary entries found. Profile may be private or username invalid.' });
      return;
    }

    // Build a map from the films grid first; this is our canonical
    // list of movies (most data lives here, including ratings that
    // may not be present in the diary).
    const byUri = new Map();

    for (const entry of filmEntries) {
      if (!entry.LetterboxdURI) continue;
      byUri.set(entry.LetterboxdURI, { ...entry });
    }

    // Overlay diary info: use it for watch dates / diary-based
    // stats, but do not overwrite film ratings/years if they exist.
    for (const entry of diaryEntries) {
      if (!entry.LetterboxdURI) continue;
      const existing = byUri.get(entry.LetterboxdURI);

      if (!existing) {
        // Films page might not list every logged diary item
        byUri.set(entry.LetterboxdURI, { ...entry });
        continue;
      }

      // Prefer the film grid's rating/year; only fill if missing.
      const merged = { ...existing };
      if (!merged.Rating && entry.Rating) {
        merged.Rating = entry.Rating;
      }
      if (!merged.Year && entry.Year) {
        merged.Year = entry.Year;
      }

      // Always preserve the diary watch date separately so the
      // frontend can use it for "by year" diary stats.
      if (entry.Date) {
        merged.Date = entry.Date;
      }

      byUri.set(entry.LetterboxdURI, merged);
    }

    const mergedEntries = Array.from(byUri.values());

    // First enrich with Letterboxd-native film metadata, then fall
    // back to TMDB for additional info like runtime and posters.
    const withLetterboxdDetails = await enrichWithLetterboxdDetails(mergedEntries, forceRefresh);
    const enriched = await enrichWithTMDB(withLetterboxdDetails, forceRefresh);

    const payload = {
      username,
      movies: enriched,
      count: enriched.length,
    };

    // Store the full enriched payload in Redis so repeat requests
    // for the same user are fast and avoid re-scraping
    // Letterboxd/TMDB.
    if (redisClient) {
      try {
        await redisClient.set(cacheKey, payload, { ex: USER_CACHE_TTL_SECONDS });
      } catch (cacheErr) {
        console.warn('Redis cache set failed, continuing without cache:', cacheErr);
      }
    }

    res.status(200).json(payload);
  } catch (err) {
    console.error('Failed to fetch user data', err);
    res.status(500).json({ error: 'Internal server error while fetching user data.' });
  }
}
