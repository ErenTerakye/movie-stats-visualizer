import type { VercelRequest, VercelResponse } from '@vercel/node';

interface EnrichedMovie {
  Date: string;
  Name: string;
  Year: string;
  LetterboxdURI: string;
  Rating: string;
  [key: string]: any;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // --- CORS Configuration ---
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { username } = req.query;
  const tmdbApiKey = process.env.TMDB_API_KEY;

  if (!tmdbApiKey) {
    return res.status(500).json({ error: 'Server configuration error: TMDB_API_KEY missing' });
  }

  if (!username || typeof username !== 'string') {
    return res.status(400).json({ error: 'Username is required' });
  }

  try {
    // 1. Scrape Letterboxd Diary
    // Added User-Agent to avoid 403 Forbidden errors
    const letterboxdUrl = `https://letterboxd.com/${username}/films/diary/`;
    const lbRes = await fetch(letterboxdUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    if (!lbRes.ok) {
        if (lbRes.status === 404) return res.status(404).json({ error: 'User not found' });
        return res.status(lbRes.status).json({ error: `Letterboxd Error: ${lbRes.statusText}` });
    }

    const html = await lbRes.text();
    
    // Improved Regex to capture the full TR row including attributes
    // More flexible: allows whitespace between attributes
    const movies: any[] = [];
    const rowRegex = /<tr[^>]+class="[^"]*diary-entry-row[^"]*"[^>]*>[\s\S]*?<\/tr>/g;
    
    let match;
    while ((match = rowRegex.exec(html)) !== null) {
        const rowHtml = match[0];
        
        // Extract directly from data attributes on the TR tag
        // \s* allows for potential spaces around equal signs or attributes
        const nameMatch = rowHtml.match(/data-film-name\s*=\s*"([^"]+)"/);
        const slugMatch = rowHtml.match(/data-film-slug\s*=\s*"([^"]+)"/);
        const yearMatch = rowHtml.match(/data-film-release-year\s*=\s*"(\d+)"/);
        const dateMatch = rowHtml.match(/data-viewing-date\s*=\s*"([^"]+)"/);
        
        const name = nameMatch ? nameMatch[1].replace(/&amp;/g, '&') : '';
        const slug = slugMatch ? slugMatch[1] : '';
        const year = yearMatch ? yearMatch[1] : '';
        const date = dateMatch ? dateMatch[1] : '';

        // Rating logic
        // Look for rating class in the row or children
        const ratingMatch = rowHtml.match(/rated-(\d+)/);
        const ratingVal = ratingMatch ? (parseInt(ratingMatch[1]) / 2).toString() : '';

        if (name && year) {
            movies.push({
                Name: name,
                Year: year,
                Date: date, // YYYY-MM-DD
                Rating: ratingVal,
                LetterboxdURI: `https://letterboxd.com/film/${slug}/`
            });
        }
    }

    if (movies.length === 0) {
        // Fallback: Return empty array but log it for debugging
        console.log("Regex found no matches. HTML preview:", html.substring(0, 500));
        return res.status(200).json([]);
    }

    // 2. Enrich with TMDB Data
    const enrichedMovies: EnrichedMovie[] = [];
    const BATCH_SIZE = 5;
    
    for (let i = 0; i < movies.length; i += BATCH_SIZE) {
        const batch = movies.slice(i, i + BATCH_SIZE);
        const promises = batch.map(async (movie) => {
            try {
                const searchRes = await fetch(
                    `https://api.themoviedb.org/3/search/movie?api_key=${tmdbApiKey}&query=${encodeURIComponent(movie.Name)}&year=${movie.Year}`
                );
                const searchData: any = await searchRes.json();
                
                if (searchData.results?.[0]) {
                    const match = searchData.results[0];
                    const detailsRes = await fetch(
                        `https://api.themoviedb.org/3/movie/${match.id}?api_key=${tmdbApiKey}&append_to_response=credits`
                    );
                    const details: any = await detailsRes.json();

                    return {
                        ...movie,
                        poster_path: match.poster_path,
                        backdrop_path: match.backdrop_path,
                        genres: details.genres || [],
                        production_countries: details.production_countries || [],
                        original_language: match.original_language,
                        tmdb_id: match.id,
                        runtime: details.runtime || 0,
                        directors: details.credits?.crew?.filter((p: any) => p.job === 'Director')
                            .map((d: any) => ({ id: d.id, name: d.name })) || [],
                        cast: details.credits?.cast?.slice(0, 10)
                            .map((c: any) => ({ id: c.id, name: c.name })) || [],
                    };
                }
                return { ...movie, notFound: true };
            } catch (e) {
                console.error(`Error processing ${movie.Name}:`, e);
                return { ...movie, error: true };
            }
        });

        const results = await Promise.all(promises);
        enrichedMovies.push(...results);
        
        // Slight delay to be nice to TMDB API
        if (i + BATCH_SIZE < movies.length) {
            await new Promise(r => setTimeout(r, 200));
        }
    }

    res.status(200).json(enrichedMovies);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}