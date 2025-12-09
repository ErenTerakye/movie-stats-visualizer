import * as cheerio from 'cheerio';

const TMDB_API_KEY = process.env.TMDB_API_KEY;

if (!TMDB_API_KEY) {
  console.warn('TMDB_API_KEY is not set. The API route will fail until it is configured in the environment.');
}

const LETTERBOXD_BASE = 'https://letterboxd.com';

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; LetterboxdStatsBot/1.0; +https://github.com/your-username)'
    }
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return await res.text();
}

// Scrape a single diary page and return entries + whether a next page exists
async function scrapeDiaryPage(username, page = 1) {
  const path = page === 1
    ? `/${username}/films/diary/`
    : `/${username}/films/diary/page/${page}/`;

  const html = await fetchHtml(`${LETTERBOXD_BASE}${path}`);
  const $ = cheerio.load(html);

  const entries = [];

  // Diary entries are represented by rows; selectors may need adjustment if Letterboxd changes
  $('.diary-entry-row').each((_, el) => {
    const row = $(el);

    const filmLink = row.find('.film-title a');
    const name = filmLink.text().trim();
    const letterboxdUri = filmLink.attr('href') || '';

    const yearText = row.find('.diary-entry-year').text().trim();
    const ratingEl = row.find('.rating');
    const ratingText = ratingEl.attr('title') || ratingEl.text().trim();

    const dateText = row.find('.diary-entry-date').text().trim();

    if (!name) {
      return;
    }

    entries.push({
      Date: dateText,
      Name: name,
      Year: yearText,
      LetterboxdURI: letterboxdUri ? `${LETTERBOXD_BASE}${letterboxdUri}` : '',
      Rating: normalizeLetterboxdRating(ratingText),
    });
  });

  const hasNext = $('.paginate-nextprev .next').length > 0;
  return { entries, hasNext };
}

function normalizeLetterboxdRating(text) {
  if (!text) return '';
  // Letterboxd often uses stars like f31ff31ff31ff31f2bd0
  // or fractional stars; here we try to parse to a 0-5 value
  const starMatch = text.match(/([0-9](?:\.5)?)/);
  if (starMatch) return starMatch[1];
  return '';
}

async function scrapeFullDiary(username, maxPages = 5) {
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

async function enrichWithTMDB(entries) {
  if (!TMDB_API_KEY) {
    throw new Error('TMDB_API_KEY is not configured on the server.');
  }

  const result = [];
  const CHUNK_SIZE = 3;

  for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
    const chunk = entries.slice(i, i + CHUNK_SIZE);

    const enrichedChunk = await Promise.all(chunk.map(async (movie) => {
      try {
        const searchUrl = new URL('https://api.themoviedb.org/3/search/movie');
        searchUrl.searchParams.set('api_key', TMDB_API_KEY);
        searchUrl.searchParams.set('query', movie.Name);
        if (movie.Year) searchUrl.searchParams.set('year', movie.Year);

        const searchRes = await fetch(searchUrl);
        if (!searchRes.ok) throw new Error(`Search failed: ${searchRes.statusText}`);
        const searchData = await searchRes.json();

        if (searchData.results && searchData.results.length > 0) {
          const match = searchData.results[0];

          const detailsUrl = new URL(`https://api.themoviedb.org/3/movie/${match.id}`);
          detailsUrl.searchParams.set('api_key', TMDB_API_KEY);
          detailsUrl.searchParams.set('append_to_response', 'credits');

          const detailsRes = await fetch(detailsUrl);
          if (!detailsRes.ok) throw new Error(`Details failed: ${detailsRes.statusText}`);
          const detailsData = await detailsRes.json();

          const directors = (detailsData.credits?.crew || [])
            .filter((person) => person.job === 'Director')
            .map((d) => ({ id: d.id, name: d.name }));

          const cast = (detailsData.credits?.cast || [])
            .slice(0, 10)
            .map((c) => ({ id: c.id, name: c.name }));

          return {
            ...movie,
            poster_path: match.poster_path,
            backdrop_path: match.backdrop_path,
            genres: detailsData.genres || [],
            production_countries: detailsData.production_countries || [],
            original_language: match.original_language,
            tmdb_id: match.id,
            runtime: detailsData.runtime || 0,
            directors,
            cast,
          };
        }

        return { ...movie, notFound: true };
      } catch (err) {
        console.error('TMDB enrichment failed for', movie.Name, err);
        return { ...movie, error: true };
      }
    }));

    result.push(...enrichedChunk);
    await new Promise((r) => setTimeout(r, 300));
  }

  return result;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed. Use GET.' });
    return;
  }

  const { username } = req.query;
  if (!username || typeof username !== 'string') {
    res.status(400).json({ error: 'Missing or invalid username parameter.' });
    return;
  }

  try {
    const diaryEntries = await scrapeFullDiary(username);

    if (!diaryEntries.length) {
      res.status(404).json({ error: 'No diary entries found. Profile may be private or username invalid.' });
      return;
    }

    const enriched = await enrichWithTMDB(diaryEntries);

    res.status(200).json({
      username,
      movies: enriched,
      count: enriched.length,
    });
  } catch (err) {
    console.error('Failed to fetch user data', err);
    res.status(500).json({ error: 'Internal server error while fetching user data.' });
  }
}
