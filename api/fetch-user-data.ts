import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as cheerio from 'cheerio';

// Define types for our scraped/enriched data
interface MovieData {
  Name: string;
  Year: string;
  Date: string; // Watched date
  Rating: string;
  LetterboxdURI: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  genres?: any[];
  production_countries?: any[];
  original_language?: string;
  tmdb_id?: number;
  runtime?: number;
  directors?: any[];
  cast?: any[];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 1. Enable CORS for your frontend
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { username } = req.query;
  const TMDB_API_KEY = process.env.TMDB_API_KEY;

  if (!username || typeof username !== 'string') {
    return res.status(400).json({ error: 'Username is required' });
  }

  if (!TMDB_API_KEY) {
    return res.status(500).json({ error: 'Server misconfiguration: TMDB_API_KEY missing' });
  }

  try {
    // --- STEP A: Scrape Letterboxd Diary ---
    // Note: For this demo, we fetch the first page of the diary. 
    // In a full production app, you would loop through pagination.
    const letterboxdUrl = `https://letterboxd.com/${username}/films/diary/`;
    
    const lbResponse = await fetch(letterboxdUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
    });

    if (lbResponse.status === 404) {
      return res.status(404).json({ error: 'User not found or profile is private' });
    }

    const html = await lbResponse.text();
    const $ = cheerio.load(html);
    const movies: MovieData[] = [];

    // Parse the Diary Table Rows
    $('.diary-entry-row').each((_, element) => {
      const $row = $(element);
      
      // Extract data from data-attributes (most reliable method)
      const name = $row.find('.td-film-details .film-poster').attr('data-film-name') || '';
      const releaseYear = $row.find('.td-film-details .film-poster').attr('data-film-release-year') || '';
      const watchedDate = $row.find('.td-day').attr('data-viewing-date') || ''; // YYYY-MM-DD
      const uri = $row.find('.td-film-details .film-poster').attr('data-film-slug') || '';
      
      // Rating is often in a text span or class. 
      // Letterboxd uses classes like 'rated-9' (for 4.5) or 'rated-10' (for 5).
      let rating = '0';
      const ratingClass = $row.find('.td-rating .rating').attr('class');
      if (ratingClass) {
        // Extract number from 'rated-X'
        const match = ratingClass.match(/rated-(\d+)/);
        if (match) {
            rating = (parseInt(match[1]) / 2).toString(); // Convert 10-scale to 5-scale
        }
      }

      if (name) {
        movies.push({
          Name: name,
          Year: releaseYear,
          Date: watchedDate, // Maps to 'Watched Date' logic
          Rating: rating,
          LetterboxdURI: uri
        });
      }
    });

    if (movies.length === 0) {
      return res.status(200).json([]); // Return empty if no entries found
    }

    // --- STEP B: Enrich with TMDB Data ---
    // We process in batches to respect API limits and Vercel timeouts
    const enrichedMovies: MovieData[] = [];
    const BATCH_SIZE = 5;
    
    // Limit to first 50 movies to prevent Vercel Function Timeout (10s limit on free tier)
    // You can increase this if you have a higher timeout limit.
    const moviesToProcess = movies.slice(0, 50);

    for (let i = 0; i < moviesToProcess.length; i += BATCH_SIZE) {
      const batch = moviesToProcess.slice(i, i + BATCH_SIZE);
      
      const promises = batch.map(async (movie) => {
        try {
          // 1. Search for ID
          const searchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(movie.Name)}&year=${movie.Year}`;
          const searchRes = await fetch(searchUrl);
          const searchData = await searchRes.json();
          
          if (searchData.results && searchData.results.length > 0) {
            const tmdbId = searchData.results[0].id;
            
            // 2. Get Details (Credits, Runtime)
            const detailsUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=credits`;
            const detailsRes = await fetch(detailsUrl);
            const detailsData = await detailsRes.json();

            // Transform to app format
            return {
              ...movie,
              poster_path: searchData.results[0].poster_path,
              backdrop_path: searchData.results[0].backdrop_path,
              genres: detailsData.genres || [],
              production_countries: detailsData.production_countries || [],
              original_language: searchData.results[0].original_language,
              tmdb_id: tmdbId,
              runtime: detailsData.runtime || 0,
              directors: detailsData.credits?.crew?.filter((p: any) => p.job === 'Director').map((d: any) => ({ id: d.id, name: d.name })) || [],
              cast: detailsData.credits?.cast?.slice(0, 10).map((c: any) => ({ id: c.id, name: c.name })) || []
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
      
      // Small delay to be nice to TMDB API
      if (i + BATCH_SIZE < moviesToProcess.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    // --- STEP C: Return JSON ---
    res.status(200).json(enrichedMovies);

  } catch (error) {
    console.error('Scraping error:', error);
    res.status(500).json({ error: 'Failed to fetch user data' });
  }
}