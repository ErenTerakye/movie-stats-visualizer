import { EnrichedMovie, LetterboxdEntry } from '../types';

export const fetchTMDBData = async (
  movies: LetterboxdEntry[], 
  apiKey: string, 
  onProgress: (percent: number) => void
): Promise<EnrichedMovie[]> => {
  const enriched: EnrichedMovie[] = [];
  const total = movies.length;
  let count = 0;

  // Process in chunks to prevent browser freeze and manage rate limits
  const CHUNK_SIZE = 5; 
  
  for (let i = 0; i < total; i += CHUNK_SIZE) {
    const chunk = movies.slice(i, i + CHUNK_SIZE);
    
    const promises = chunk.map(async (movie) => {
      try {
        // 1. Search for basic details
        const searchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${apiKey}&query=${encodeURIComponent(movie.Name)}&year=${movie.Year}`;
        const searchRes = await fetch(searchUrl);
        const searchData = await searchRes.json();
        
        if (searchData.results && searchData.results.length > 0) {
            const match = searchData.results[0];
            
            // 2. Fetch Details for "Countries" and extra genres
            const detailsUrl = `https://api.themoviedb.org/3/movie/${match.id}?api_key=${apiKey}`;
            const detailsRes = await fetch(detailsUrl);
            const detailsData = await detailsRes.json();

            return {
                ...movie,
                poster_path: match.poster_path,
                backdrop_path: match.backdrop_path,
                genres: detailsData.genres || [],
                production_countries: detailsData.production_countries || [],
                original_language: match.original_language,
                tmdb_id: match.id
            } as EnrichedMovie;
        }
        return { ...movie, notFound: true } as EnrichedMovie;
      } catch (e) {
        console.error("Failed to fetch", movie.Name, e);
        return { ...movie, error: true } as EnrichedMovie;
      }
    });

    const results = await Promise.all(promises);
    enriched.push(...results);
    
    count += chunk.length;
    onProgress(Math.min(100, Math.round((count / total) * 100)));
    
    // Slight delay to respect API rate limits
    await new Promise(r => setTimeout(r, 200));
  }
  
  return enriched;
};