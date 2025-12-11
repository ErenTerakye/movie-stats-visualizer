export interface LetterboxdEntry {
  Date: string;
  Name: string;
  Year: string;
  LetterboxdURI: string;
  Rating: string;
  [key: string]: any;
}

export interface Genre {
  id: number;
  name: string;
}

export interface ProductionCountry {
  iso_3166_1: string;
  name: string;
}

export interface CastMember {
  id: number;
  name: string;
}

export interface Director {
  id: number;
  name: string;
}

export interface TMDBMovieResult {
  id: number;
  poster_path: string | null;
  backdrop_path: string | null;
  original_language: string;
  genres?: Genre[];
  production_countries?: ProductionCountry[];
}

export interface EnrichedMovie extends LetterboxdEntry {
  poster_path?: string | null;
  backdrop_path?: string | null;
  genres?: Genre[];
  production_countries?: ProductionCountry[];
  original_language?: string;
  tmdb_id?: number;
  runtime?: number;
  directors?: Director[];
  cast?: CastMember[];
  // Letterboxd-native metadata (scraped from film pages)
  lbCast?: LetterboxdCastMember[];
  lbCrew?: LetterboxdCrewMember[];
  lbStudios?: string[];
  lbCountries?: string[];
  lbGenres?: string[];
  lbThemes?: string[];
  notFound?: boolean;
  error?: boolean;
}

export interface LetterboxdCastMember {
  name: string;
  character?: string;
}

export interface LetterboxdCrewMember {
  name: string;
  job?: string;
}

export type AppStatus = 'idle' | 'parsing' | 'fetching' | 'ready';