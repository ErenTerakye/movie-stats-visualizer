import { EnrichedMovie, LetterboxdEntry } from '../types.ts';

export const fetchTMDBData = async (
  movies: LetterboxdEntry[], 
  apiKey: string, 
  onProgress: (percent: number) => void
): Promise<EnrichedMovie[]> => {
  const enriched: EnrichedMovie[] = [];
  const total = movies.length;
  let count = 0;

  // Reduced chunk size and increased delay to avoid 429 Rate Limit errors
  const CHUNK_SIZE = 3; 
  
  for (let i = 0; i < total; i += CHUNK_SIZE) {
    const chunk = movies.slice(i, i + CHUNK_SIZE);
    
    const promises = chunk.map(async (movie) => {
      try {
        // 1. Search for basic details
        const searchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${apiKey}&query=${encodeURIComponent(movie.Name)}&year=${movie.Year}`;
        const searchRes = await fetch(searchUrl);
        
        if (!searchRes.ok) throw new Error(`Search failed: ${searchRes.statusText}`);
        
        const searchData = await searchRes.json();
        
        if (searchData.results && searchData.results.length > 0) {
            const match = searchData.results[0];
            
            // 2. Fetch Details including Credits (Cast/Crew) and Runtime
            const detailsUrl = `https://api.themoviedb.org/3/movie/${match.id}?api_key=${apiKey}&append_to_response=credits`;
            const detailsRes = await fetch(detailsUrl);
            
            if (!detailsRes.ok) throw new Error(`Details failed: ${detailsRes.statusText}`);
            
            const detailsData = await detailsRes.json();

            // Extract Directors (Crew with job 'Director')
            const directors = detailsData.credits?.crew
                ?.filter((person: any) => person.job === 'Director')
                .map((d: any) => ({ id: d.id, name: d.name })) || [];

            // Extract Top Cast (first 10)
            const cast = detailsData.credits?.cast
                ?.slice(0, 10)
                .map((c: any) => ({ id: c.id, name: c.name })) || [];

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
                cast
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
    
    // Increased delay to respect API rate limits (approx 300ms between chunks)
    await new Promise(r => setTimeout(r, 300));
  }
  
  return enriched;
};