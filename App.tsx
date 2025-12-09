import React, { useState, useCallback, useMemo } from 'react';
import { Upload, Film, BarChart3, AlertCircle, RotateCcw, Clock, Users, Globe, Star, Languages } from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, 
  CartesianGrid,
} from 'recharts';
import Layout from './components/Layout';
import { parseCSV } from './utils/csvHelper';
import { fetchTMDBData } from './services/tmdbService';
import { EnrichedMovie, AppStatus } from './types';

// Constants
const TMDB_API_KEY_STORAGE = 'tmdb_api_key';

// Helper for language display names
const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });
const getLanguageName = (code: string) => {
    try {
        return languageNames.of(code) || code;
    } catch (e) {
        return code;
    }
};

// --- Custom Tooltip Component ---
const CustomTooltip = ({ active, payload, label, valueType, isRatingLabel, starIconColor }: any) => {
  if (active && payload && payload.length) {
    let value = payload[0].value;
    let unit = '';
    let showStarValue = false;
    
    if (valueType === 'rating' || valueType === 'rated') {
        value = Number(value).toFixed(2);
        showStarValue = true;
    } else if (valueType === 'minutes') {
        unit = ' mins';
    } else {
        unit = ' films';
    }

    return (
      <div className="bg-lb-surface border border-gray-600 p-3 rounded shadow-[0_8px_30px_rgb(0,0,0,0.5)] z-50 text-xs text-white backdrop-blur-sm bg-opacity-95">
        <div className="font-bold mb-1 text-sm flex items-center gap-1">
            {label}
            {isRatingLabel && <Star className="w-3.5 h-3.5 text-lb-green fill-current" />}
        </div>
        <div className="text-lb-green font-mono text-base flex items-baseline">
          {value}
          {showStarValue ? (
            <Star className={`w-3.5 h-3.5 ${starIconColor || 'text-lb-orange'} fill-current ml-1 self-center`} />
          ) : (
            <span className="text-gray-400 text-xs ml-1">{unit}</span>
          )}
        </div>
      </div>
    );
  }
  return null;
};

// Memoized custom tooltip
const MemoizedCustomTooltip = React.memo(CustomTooltip);

const StatCard = ({ icon: Icon, title, value, subtext, color = "text-white" }: any) => (
    <div className="bg-lb-surface p-4 md:p-5 rounded-lg border border-gray-800 shadow-lg flex flex-col justify-between hover:border-gray-600 transition-colors duration-300">
        <div>
            <div className="flex items-center gap-2 mb-2">
                <Icon className={`w-4 h-4 ${color}`} />
                <h3 className="text-lb-text text-xs uppercase tracking-wider font-semibold">{title}</h3>
            </div>
            <p className="text-2xl md:text-3xl font-bold text-white">{value}</p>
        </div>
        {subtext && <p className="text-xs text-gray-500 mt-2">{subtext}</p>}
    </div>
);

const SectionHeader = ({ icon: Icon, title, color = "text-white" }: any) => (
    <div className="flex items-center gap-2 mb-4 md:mb-6">
        <Icon className={`w-5 h-5 md:w-6 md:h-6 ${color}`} />
        <h3 className="text-lg md:text-xl font-bold text-white tracking-tight">{title}</h3>
    </div>
);

const App: React.FC = () => {
  const [status, setStatus] = useState<AppStatus>('idle');
  const [apiKey, setApiKey] = useState<string>(localStorage.getItem(TMDB_API_KEY_STORAGE) || '');
  const [progress, setProgress] = useState<number>(0);
  const [data, setData] = useState<EnrichedMovie[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  // Chart Toggles
  const [yearMetric, setYearMetric] = useState<'films' | 'rating' | 'diary'>('films');
  const [gclMetric, setGclMetric] = useState<'watched' | 'rated'>('watched');

  // Handle File Upload & Processing
  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!apiKey) {
      setError("Please enter a TMDB API Key first.");
      return;
    }

    // Save key for convenience
    localStorage.setItem(TMDB_API_KEY_STORAGE, apiKey);
    setError(null);
    setStatus('parsing');

    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target?.result as string;
      if (!text) return;

      try {
        const rawMovies = parseCSV(text);
        
        if (rawMovies.length === 0) {
            setError("No movies found in CSV. Check format.");
            setStatus('idle');
            return;
        }

        setStatus('fetching');
        
        const enrichedData = await fetchTMDBData(rawMovies, apiKey, (pct) => {
          setProgress(pct);
        });

        setData(enrichedData);
        setStatus('ready');
      } catch (err) {
        console.error(err);
        setError("An error occurred while processing data.");
        setStatus('idle');
      }
    };
    reader.readAsText(file);
  }, [apiKey]);

  // --- Statistics Calculation ---
  const stats = useMemo(() => {
    if (data.length === 0) return null;

    // Detailed Year Stats
    const yearsDetailedMap: Record<string, { 
        diaryCount: number; 
        sumRating: number; 
        ratedCount: number; 
        uniqueMovies: Set<string>;
    }> = {};

    // For Decade Analysis
    const decadesDetailedMap: Record<string, {
        sumRating: number;
        count: number;
        movies: EnrichedMovie[];
    }> = {};

    const ratingsMap: Record<string, number> = {};
    const directorsMap: Record<string, number> = {};
    const actorsMap: Record<string, number> = {};
    
    // Aggregation maps for GCL (Genre, Country, Language)
    const genresStats: Record<string, { count: number, sumRating: number, ratedCount: number }> = {};
    const countriesStats: Record<string, { count: number, sumRating: number, ratedCount: number }> = {};
    const languagesStats: Record<string, { count: number, sumRating: number, ratedCount: number }> = {};
    
    let totalRated = 0;
    let sumRating = 0;
    let totalRuntimeMinutes = 0;

    // Helper to ensure map entry exists
    const ensureYearEntry = (year: string) => {
        if (!yearsDetailedMap[year]) {
            yearsDetailedMap[year] = { 
                diaryCount: 0, 
                sumRating: 0, 
                ratedCount: 0, 
                uniqueMovies: new Set() 
            };
        }
    };

    // Helper to aggregate GCL stats
    const aggGCL = (key: string, map: any, rating: string | undefined) => {
        if (!map[key]) map[key] = { count: 0, sumRating: 0, ratedCount: 0 };
        map[key].count += 1;
        if (rating) {
            map[key].sumRating += parseFloat(rating);
            map[key].ratedCount += 1;
        }
    };

    data.forEach(movie => {
      // 1. Release Year Stats
      if (movie.Year) {
        ensureYearEntry(movie.Year);
        const yStat = yearsDetailedMap[movie.Year];
        
        yStat.uniqueMovies.add(movie.LetterboxdURI || movie.Name);
        
        if (movie.Rating) {
            yStat.sumRating += parseFloat(movie.Rating);
            yStat.ratedCount += 1;
        }

        // Decade Logic
        const yearInt = parseInt(movie.Year);
        if (!isNaN(yearInt)) {
            const decade = Math.floor(yearInt / 10) * 10;
            const decadeLabel = `${decade}s`;
            
            if (!decadesDetailedMap[decadeLabel]) {
                decadesDetailedMap[decadeLabel] = { sumRating: 0, count: 0, movies: [] };
            }
            
            if (movie.Rating) {
                decadesDetailedMap[decadeLabel].sumRating += parseFloat(movie.Rating);
                decadesDetailedMap[decadeLabel].count += 1;
            }
            decadesDetailedMap[decadeLabel].movies.push(movie);
        }
      }

      // 2. Diary Stats
      const watchedDate = movie['Watched Date'] || movie.Date;
      if (watchedDate) {
          const diaryYear = watchedDate.split('-')[0];
          if (diaryYear && !isNaN(parseInt(diaryYear))) {
              ensureYearEntry(diaryYear);
              yearsDetailedMap[diaryYear].diaryCount += 1;
          }
      }

      // Ratings
      if (movie.Rating) {
        ratingsMap[movie.Rating] = (ratingsMap[movie.Rating] || 0) + 1;
        totalRated++;
        sumRating += parseFloat(movie.Rating);
      }

      // Genres
      if (movie.genres) {
        movie.genres.forEach(g => aggGCL(g.name, genresStats, movie.Rating));
      }

      // Countries
      if (movie.production_countries) {
        movie.production_countries.forEach(c => {
           const name = c.iso_3166_1 === 'US' ? 'USA' : 
                        c.iso_3166_1 === 'GB' ? 'UK' : c.name;
           aggGCL(name, countriesStats, movie.Rating);
        });
      }

      // Languages
      if (movie.original_language) {
          const langName = getLanguageName(movie.original_language);
          aggGCL(langName, languagesStats, movie.Rating);
      }
      
      // Directors & Actors
      movie.directors?.forEach(d => { directorsMap[d.name] = (directorsMap[d.name] || 0) + 1; });
      movie.cast?.forEach(a => { actorsMap[a.name] = (actorsMap[a.name] || 0) + 1; });

      // Runtime
      if (movie.runtime) {
          totalRuntimeMinutes += movie.runtime;
      }
    });

    // Format Years
    const yearsData = Object.entries(yearsDetailedMap)
      .map(([name, stat]) => ({ 
          name, 
          films: stat.uniqueMovies.size,
          diary: stat.diaryCount,
          rating: stat.ratedCount > 0 ? parseFloat((stat.sumRating / stat.ratedCount).toFixed(2)) : 0
      }))
      .sort((a, b) => parseInt(a.name) - parseInt(b.name));

    // Top Decades
    const topDecades = Object.entries(decadesDetailedMap)
        .map(([name, stat]) => {
            const ratedMoviesWithPoster = stat.movies.filter(m => m.Rating && m.poster_path);
            return {
                name,
                average: stat.count > 0 ? stat.sumRating / stat.count : 0,
                count: stat.count,
                topMovies: ratedMoviesWithPoster
                    .sort((a, b) => parseFloat(b.Rating) - parseFloat(a.Rating))
                    .slice(0, 12) 
            };
        })
        .filter(d => d.count >= 3)
        .sort((a, b) => b.average - a.average)
        .slice(0, 3);

    const ratingsData = Object.entries(ratingsMap)
        .map(([name, value]) => ({ name: parseFloat(name), value, label: name }))
        .sort((a, b) => a.name - b.name);
    
    // Process GCL Data (Genres, Countries, Languages)
    const processGCL = (map: any) => {
        return Object.entries(map).map(([name, stat]: any) => ({
            name,
            count: stat.count,
            average: stat.ratedCount > 0 ? stat.sumRating / stat.ratedCount : 0,
            ratedCount: stat.ratedCount
        }));
    };

    const genresData = processGCL(genresStats);
    const countriesData = processGCL(countriesStats);
    const languagesData = processGCL(languagesStats);

    const directorsData = Object.entries(directorsMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    const actorsData = Object.entries(actorsMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    const averageRating = totalRated > 0 ? (sumRating / totalRated).toFixed(2) : 'N/A';
    const totalHours = Math.round(totalRuntimeMinutes / 60);

    return { 
        yearsData, 
        topDecades,
        ratingsData, 
        genresData, 
        countriesData, 
        languagesData,
        directorsData, 
        actorsData, 
        averageRating, 
        totalHours,
    };
  }, [data]);

  // Helper to sort GCL data based on metric
  const getSortedGCL = useCallback((data: any[], metric: 'watched' | 'rated') => {
      if (metric === 'watched') {
          return [...data].sort((a, b) => b.count - a.count).slice(0, 10);
      } else {
          // For rating, filter items with at least 3 rated films to avoid noise
          return [...data]
              .filter(item => item.ratedCount >= 3)
              .sort((a, b) => b.average - a.average)
              .slice(0, 10);
      }
  }, []);

  const isProcessing = status === 'parsing' || status === 'fetching';

  return (
    <Layout>
      {/* Header */}
      <header className={`text-center border-b border-lb-surface pb-6 md:pb-8 transition-all duration-500 ${status === 'ready' ? 'mb-6 md:mb-8' : 'mb-8 md:mb-12'}`}>
        <div className="flex items-center justify-center gap-2 md:gap-3 mb-4">
          <Film className={`w-8 h-8 md:w-10 md:h-10 text-lb-green ${isProcessing ? 'animate-bounce' : ''}`} />
          <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight">
            Letterboxd <span className="text-lb-blue">Stats</span>
          </h1>
        </div>
        {status !== 'ready' && (
           <p className="text-lb-text max-w-xl mx-auto text-base md:text-lg px-4">
             Visualize your movie watching habits. Export your data from Letterboxd and drop it below.
           </p>
        )}
      </header>

      {/* Main Content Area */}
      <main className="w-full">
        {status === 'idle' && (
          <div className="max-w-xl mx-auto bg-lb-surface p-6 md:p-8 rounded-xl shadow-xl border border-gray-800 hover:border-gray-700 transition-colors">
            <div className="mb-6">
              <label className="block text-sm font-medium text-lb-text mb-2">
                1. TMDB API Key
              </label>
              <input
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your TMDB Read Access Token or API Key"
                className="w-full bg-lb-bg border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-lb-green transition-colors text-sm md:text-base"
              />
              <p className="text-xs text-gray-500 mt-2">
                Required to fetch genre, country, cast, and crew data.
              </p>
            </div>

            <div className="mb-2">
              <label className="block text-sm font-medium text-lb-text mb-2">
                2. Upload CSV
              </label>
              <div className="relative group">
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div className="border-2 border-dashed border-gray-600 rounded-xl p-6 md:p-8 text-center group-hover:border-lb-blue transition-colors bg-lb-bg group-hover:bg-gray-800">
                  <Upload className="w-10 h-10 md:w-12 md:h-12 mx-auto text-gray-500 mb-4 group-hover:text-lb-blue transition-colors" />
                  <p className="text-white font-medium text-sm md:text-base">Click or Drag CSV here</p>
                  <p className="text-xs md:text-sm text-gray-500 mt-1">Exported from Letterboxd settings</p>
                </div>
              </div>
            </div>

            {error && (
              <div className="mt-6 p-4 bg-red-900/20 border border-red-900/50 rounded-lg flex items-center gap-3 text-red-200">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <span className="text-sm">{error}</span>
              </div>
            )}
          </div>
        )}

        {/* Processing State */}
        {(status === 'parsing' || status === 'fetching') && (
          <div className="max-w-xl mx-auto text-center py-10 md:py-20">
            <div className="mb-6 relative w-20 h-20 md:w-24 md:h-24 mx-auto">
                <div className="absolute inset-0 border-4 border-lb-surface rounded-full"></div>
                <div 
                    className="absolute inset-0 border-4 border-lb-green rounded-full border-t-transparent animate-spin"
                ></div>
            </div>
            <h2 className="text-xl md:text-2xl font-bold text-white mb-2">
                {status === 'parsing' ? 'Parsing CSV...' : 'Fetching Data...'}
            </h2>
            <p className="text-lb-text mb-6 text-sm md:text-base">
                Analyzing {status === 'fetching' ? 'metadata, credits, and runtimes' : 'file'}.
            </p>
            
            <div className="w-full bg-lb-surface rounded-full h-3 md:h-4 overflow-hidden">
                <div 
                    className="bg-lb-green h-full transition-all duration-300 ease-out"
                    style={{ width: `${progress}%` }}
                ></div>
            </div>
            <p className="mt-2 text-right text-sm text-lb-green font-mono">{progress}%</p>
          </div>
        )}

        {/* Dashboard Visualization */}
        {status === 'ready' && stats && (
          <div className="animate-[fadeIn_0.5s_ease-out] pb-20 space-y-6 md:space-y-8">
             {/* Action Bar */}
             <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-2xl md:text-3xl font-bold text-white">Your Dashboard</h2>
                    <p className="text-lb-text text-sm">Analysis of {data.length} films</p>
                </div>
                <button 
                    onClick={() => {
                        setStatus('idle');
                        setData([]);
                        setProgress(0);
                    }}
                    className="w-full md:w-auto flex items-center justify-center gap-2 px-4 py-2 bg-lb-surface hover:bg-gray-700 rounded-lg text-sm text-white transition-colors border border-gray-600 shadow-sm hover:shadow"
                >
                    <RotateCcw className="w-4 h-4" />
                    Start Over
                </button>
             </div>

             {/* 1. Overview Cards */}
             <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
                <StatCard icon={Film} title="Total Films" value={data.length} color="text-lb-green" />
                <StatCard icon={Clock} title="Hours Watched" value={stats.totalHours.toLocaleString()} color="text-lb-orange" subtext="Approximate runtime" />
                <StatCard icon={BarChart3} title="Avg Rating" value={stats.averageRating} color="text-lb-blue" />
             </div>

             {/* 2. Timeline (Years) */}
             <div className="bg-lb-surface p-4 md:p-6 rounded-xl shadow-lg border border-gray-800">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-3">
                    <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs font-bold text-white tracking-widest uppercase">By Year</span>
                    </div>
                    <div className="hidden sm:block h-[1px] bg-gray-700 w-full mx-4 opacity-50"></div>
                    <div className="flex gap-4 shrink-0 text-xs font-bold tracking-widest uppercase w-full sm:w-auto justify-between sm:justify-end">
                        <button 
                            onClick={() => setYearMetric('films')}
                            className={`${yearMetric === 'films' ? 'text-lb-green' : 'text-gray-500 hover:text-gray-300'} transition-colors`}
                        >
                            Films
                        </button>
                        <button 
                            onClick={() => setYearMetric('rating')}
                            className={`${yearMetric === 'rating' ? 'text-lb-blue' : 'text-gray-500 hover:text-gray-300'} transition-colors`}
                        >
                            Ratings
                        </button>
                        <button 
                            onClick={() => setYearMetric('diary')}
                            className={`${yearMetric === 'diary' ? 'text-lb-orange' : 'text-gray-500 hover:text-gray-300'} transition-colors`}
                        >
                            Diary
                        </button>
                    </div>
                </div>

                <div className="h-48 md:h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={stats.yearsData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#445566" opacity={0.2} />
                            <XAxis dataKey="name" tick={{ fill: '#99aabb', fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={15} />
                            <YAxis tick={{ fill: '#99aabb', fontSize: 11 }} tickLine={false} axisLine={false} domain={yearMetric === 'rating' ? [0, 5] : [0, 'auto']} />
                            <Tooltip 
                                content={<MemoizedCustomTooltip valueType={yearMetric} />} 
                                cursor={{ fill: 'rgba(255,255,255,0.05)', radius: 4 }}
                                wrapperStyle={{ pointerEvents: 'none' }}
                                isAnimationActive={true}
                                animationDuration={200}
                            />
                            <Bar 
                                dataKey={yearMetric} 
                                fill={yearMetric === 'films' ? '#00e054' : yearMetric === 'rating' ? '#40bcf4' : '#ff8000'} 
                                radius={[2, 2, 0, 0]} 
                                maxBarSize={40} 
                                activeBar={{ stroke: '#ffffff', strokeWidth: 1.5, strokeOpacity: 0.8 }}
                                animationDuration={1000}
                                animationEasing="ease-out"
                            />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

             {/* 3. Highest Rated Decades */}
             <div className="bg-lb-surface p-4 md:p-6 rounded-xl shadow-lg border border-gray-800">
                <SectionHeader icon={Star} title="Highest Rated Decades" color="text-white" />
                <div className="space-y-6 md:space-y-8">
                    {stats.topDecades.map((decade) => (
                        <div key={decade.name} className="flex flex-col md:flex-row gap-4 md:gap-6">
                            <div className="w-full md:w-48 flex-shrink-0 flex flex-row md:flex-col justify-between md:justify-start items-center md:items-start pt-0 md:pt-2 border-b md:border-b-0 border-gray-800 pb-2 md:pb-0 mb-2 md:mb-0">
                                <span className="text-3xl md:text-5xl font-light text-white mb-0 md:mb-2">{decade.name}</span>
                                <div className="text-right md:text-left">
                                    <div className="flex items-center text-lb-text gap-1 text-sm justify-end md:justify-start">
                                        <Star className="w-3 h-3 text-lb-green fill-current" />
                                        <span>Avg {decade.average.toFixed(2)}</span>
                                    </div>
                                    <span className="text-xs text-gray-500 mt-1 block">{decade.count} films</span>
                                </div>
                            </div>
                            <div className="flex-grow">
                                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 lg:gap-3">
                                    {decade.topMovies.map((movie, idx) => (
                                        <div key={`${movie.tmdb_id}-${idx}`} className="relative group w-full aspect-[2/3] bg-gray-800 rounded overflow-hidden shadow-lg hover:ring-2 hover:ring-lb-green transition-all cursor-default transform hover:-translate-y-1 hover:z-10 duration-200">
                                            {movie.poster_path ? (
                                                <img 
                                                    src={`https://image.tmdb.org/t/p/w154${movie.poster_path}`} 
                                                    alt={movie.Name}
                                                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-[8px] md:text-xs text-gray-500 p-1 text-center bg-gray-900">
                                                    {movie.Name}
                                                </div>
                                            )}
                                            <div className="absolute inset-0 bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[1px]">
                                                <div className="text-center">
                                                    <span className="block text-lb-green font-bold text-base md:text-lg scale-0 group-hover:scale-100 transition-transform delay-75">{movie.Rating}</span>
                                                    <span className="block text-[9px] md:text-[10px] text-white/80 line-clamp-2 px-1">{movie.Name}</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
             </div>

             {/* 4. Ratings Profile */}
             <div className="bg-lb-surface p-4 md:p-6 rounded-xl shadow-lg border border-gray-800">
                <SectionHeader icon={BarChart3} title="Ratings Profile" color="text-lb-orange" />
                <div className="h-48 md:h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={stats.ratingsData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#445566" opacity={0.2} />
                            <XAxis dataKey="label" tick={{ fill: '#99aabb', fontSize: 11 }} tickLine={false} axisLine={false} />
                            <YAxis tick={{ fill: '#99aabb', fontSize: 11 }} tickLine={false} axisLine={false} />
                            <Tooltip 
                                content={<MemoizedCustomTooltip isRatingLabel={true} />} 
                                cursor={{ fill: 'rgba(255,255,255,0.05)', radius: 4 }}
                                wrapperStyle={{ pointerEvents: 'none' }}
                                isAnimationActive={true}
                                animationDuration={200}
                            />
                            <Bar 
                                dataKey="value" 
                                fill="#ff8000" 
                                radius={[2, 2, 0, 0]} 
                                activeBar={{ stroke: '#ffffff', strokeWidth: 1.5, strokeOpacity: 0.8 }}
                                animationDuration={1000}
                                animationEasing="ease-out"
                            />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
             </div>

             {/* 5. Genres, Countries & Languages (Combined) */}
             <div className="bg-lb-surface p-4 md:p-6 rounded-xl shadow-lg border border-gray-800 overflow-hidden">
                 {/* Combined Header */}
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-6 gap-3 md:gap-4">
                    <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs font-bold text-white tracking-widest uppercase">Genres, Countries & Languages</span>
                    </div>
                    <div className="hidden md:block h-[1px] bg-gray-700 w-full mx-4 opacity-50"></div>
                    <div className="flex gap-4 shrink-0 text-xs font-bold tracking-widest uppercase w-full md:w-auto justify-between md:justify-end">
                        <button 
                            onClick={() => setGclMetric('watched')}
                            className={`${gclMetric === 'watched' ? 'text-lb-blue' : 'text-gray-500 hover:text-gray-300'} transition-colors`}
                        >
                            Most Watched
                        </button>
                        <button 
                            onClick={() => setGclMetric('rated')}
                            className={`${gclMetric === 'rated' ? 'text-lb-orange' : 'text-gray-500 hover:text-gray-300'} transition-colors`}
                        >
                            Highest Rated
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pb-4">
                    {/* Genres */}
                    <div className="h-[300px] md:h-[400px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={getSortedGCL(stats.genresData, gclMetric)} layout="vertical" margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#445566" opacity={0.2} />
                                <XAxis type="number" hide />
                                <YAxis dataKey="name" type="category" width={80} tick={{ fill: '#99aabb', fontSize: 10 }} tickLine={false} axisLine={false} />
                                <Tooltip 
                                    content={<MemoizedCustomTooltip valueType={gclMetric === 'rated' ? 'rated' : 'count'} starIconColor="text-lb-green" />} 
                                    cursor={{ fill: 'rgba(255,255,255,0.05)', radius: 4 }}
                                    wrapperStyle={{ pointerEvents: 'none' }}
                                    isAnimationActive={true}
                                    animationDuration={200}
                                />
                                <Bar 
                                    dataKey={gclMetric === 'watched' ? 'count' : 'average'} 
                                    fill="#00e054" 
                                    radius={[0, 4, 4, 0]} 
                                    barSize={20} 
                                    activeBar={{ stroke: '#ffffff', strokeWidth: 1.5, strokeOpacity: 0.8 }}
                                    animationDuration={1000}
                                    animationEasing="ease-out"
                                />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>

                    {/* Countries */}
                    <div className="h-[300px] md:h-[400px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={getSortedGCL(stats.countriesData, gclMetric)} layout="vertical" margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#445566" opacity={0.2} />
                                <XAxis type="number" hide />
                                <YAxis dataKey="name" type="category" width={80} tick={{ fill: '#99aabb', fontSize: 10 }} tickLine={false} axisLine={false} />
                                <Tooltip 
                                    content={<MemoizedCustomTooltip valueType={gclMetric === 'rated' ? 'rated' : 'count'} starIconColor="text-lb-green" />} 
                                    cursor={{ fill: 'rgba(255,255,255,0.05)', radius: 4 }}
                                    wrapperStyle={{ pointerEvents: 'none' }}
                                    isAnimationActive={true}
                                    animationDuration={200}
                                />
                                <Bar 
                                    dataKey={gclMetric === 'watched' ? 'count' : 'average'} 
                                    fill="#40bcf4" 
                                    radius={[0, 4, 4, 0]} 
                                    barSize={20} 
                                    activeBar={{ stroke: '#ffffff', strokeWidth: 1.5, strokeOpacity: 0.8 }}
                                    animationDuration={1000}
                                    animationEasing="ease-out"
                                />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>

                    {/* Languages */}
                    <div className="h-[300px] md:h-[400px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={getSortedGCL(stats.languagesData, gclMetric)} layout="vertical" margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#445566" opacity={0.2} />
                                <XAxis type="number" hide />
                                <YAxis dataKey="name" type="category" width={80} tick={{ fill: '#99aabb', fontSize: 10 }} tickLine={false} axisLine={false} />
                                <Tooltip 
                                    content={<MemoizedCustomTooltip valueType={gclMetric === 'rated' ? 'rated' : 'count'} starIconColor="text-lb-green" />} 
                                    cursor={{ fill: 'rgba(255,255,255,0.05)', radius: 4 }}
                                    wrapperStyle={{ pointerEvents: 'none' }}
                                    isAnimationActive={true}
                                    animationDuration={200}
                                />
                                <Bar 
                                    dataKey={gclMetric === 'watched' ? 'count' : 'average'} 
                                    fill="#ff8000" 
                                    radius={[0, 4, 4, 0]} 
                                    barSize={20} 
                                    activeBar={{ stroke: '#ffffff', strokeWidth: 1.5, strokeOpacity: 0.8 }}
                                    animationDuration={1000}
                                    animationEasing="ease-out"
                                />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
             </div>

             {/* 6. Directors & Stars */}
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                <div className="bg-lb-surface p-4 md:p-6 rounded-xl shadow-lg border border-gray-800">
                    <SectionHeader icon={Users} title="Top Directors" color="text-lb-blue" />
                    <div className="h-[300px] md:h-[400px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={stats.directorsData} layout="vertical" margin={{ top: 5, right: 20, left: 20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#445566" opacity={0.2} />
                                <XAxis type="number" hide />
                                <YAxis dataKey="name" type="category" width={90} tick={{ fill: '#99aabb', fontSize: 11 }} tickLine={false} axisLine={false} />
                                <Tooltip 
                                    content={<MemoizedCustomTooltip />} 
                                    cursor={{ fill: 'rgba(255,255,255,0.05)', radius: 4 }}
                                    wrapperStyle={{ pointerEvents: 'none' }}
                                    isAnimationActive={true}
                                    animationDuration={200}
                                />
                                <Bar 
                                    dataKey="value" 
                                    fill="#40bcf4" 
                                    radius={[0, 4, 4, 0]} 
                                    barSize={20} 
                                    activeBar={{ stroke: '#ffffff', strokeWidth: 1.5, strokeOpacity: 0.8 }}
                                    animationDuration={1000}
                                    animationEasing="ease-out"
                                />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="bg-lb-surface p-4 md:p-6 rounded-xl shadow-lg border border-gray-800">
                    <SectionHeader icon={Users} title="Top Stars" color="text-lb-orange" />
                    <div className="h-[300px] md:h-[400px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={stats.actorsData} layout="vertical" margin={{ top: 5, right: 20, left: 20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#445566" opacity={0.2} />
                                <XAxis type="number" hide />
                                <YAxis dataKey="name" type="category" width={90} tick={{ fill: '#99aabb', fontSize: 11 }} tickLine={false} axisLine={false} />
                                <Tooltip 
                                    content={<MemoizedCustomTooltip />} 
                                    cursor={{ fill: 'rgba(255,255,255,0.05)', radius: 4 }}
                                    wrapperStyle={{ pointerEvents: 'none' }}
                                    isAnimationActive={true}
                                    animationDuration={200}
                                />
                                <Bar 
                                    dataKey="value" 
                                    fill="#ff8000" 
                                    radius={[0, 4, 4, 0]} 
                                    barSize={20} 
                                    activeBar={{ stroke: '#ffffff', strokeWidth: 1.5, strokeOpacity: 0.8 }}
                                    animationDuration={1000}
                                    animationEasing="ease-out"
                                />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
             </div>
          </div>
        )}
      </main>
    </Layout>
  );
};

export default App;