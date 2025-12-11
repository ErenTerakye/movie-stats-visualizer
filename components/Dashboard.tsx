import React, { useState, useMemo, useCallback } from 'react';
import { Film, BarChart3, AlertCircle, RotateCcw, Clock, Users, Star } from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, 
  CartesianGrid,
} from 'recharts';
import { EnrichedMovie } from '../types';

// Helper for language display names
const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });
const getLanguageName = (code: string) => {
    try {
        return languageNames.of(code) || code;
    } catch (e) {
        return code;
    }
};

// Crew roles we care about and their display names/order
const CREW_ROLE_CONFIG = [
  { label: 'Co-Directors', matcher: (job: string) => /co-?director/i.test(job) },
  { label: 'Producers', matcher: (job: string) => /producer/i.test(job) },
  { label: 'Writers', matcher: (job: string) => /writer/i.test(job) && !/original/i.test(job) },
  { label: 'Original Writers', matcher: (job: string) => /original\s+writer/i.test(job) },
  { label: 'Story', matcher: (job: string) => /story/i.test(job) },
  { label: 'Casting', matcher: (job: string) => /casting/i.test(job) },
  { label: 'Editors', matcher: (job: string) => /editor/i.test(job) },
  { label: 'Cinematography', matcher: (job: string) => /cinematograph|director of photography/i.test(job) },
] as const;

const orderCrewSectionsForUI = (sections: any[]) => {
  const result: any[] = [];
  const usedJobs = new Set<string>();

  CREW_ROLE_CONFIG.forEach((config) => {
    const match = sections.find((section: any) => {
      if (!section || typeof section.job !== 'string') return false;
      if (usedJobs.has(section.job)) return false;
      return config.matcher(section.job);
    });

    if (match) {
      usedJobs.add(match.job);
      result.push({ ...match, displayJob: config.label });
    }
  });

  return result;
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

interface DashboardProps {
  data: EnrichedMovie[];
  onReset: () => void;
}

const Dashboard: React.FC<DashboardProps> = ({ data, onReset }) => {
  const [yearMetric, setYearMetric] = useState<'films' | 'rating' | 'diary'>('films');
  const [gclMetric, setGclMetric] = useState<'watched' | 'rated'>('watched');
  const [crewMetric, setCrewMetric] = useState<'watched' | 'rated'>('watched');

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
    const studiosStats: Record<string, { count: number, sumRating: number, ratedCount: number }> = {};
    const crewByJobStats: Record<string, Record<string, { count: number, sumRating: number, ratedCount: number }>> = {};
    
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

      // Genres (prefer Letterboxd-native genres if present)
      const effectiveGenres: string[] = movie.lbGenres && movie.lbGenres.length
          ? movie.lbGenres
          : (movie.genres || []).map((g: any) => g.name);
      effectiveGenres.forEach(name => aggGCL(name, genresStats, movie.Rating));

      // Countries (prefer Letterboxd-native countries if present)
      const effectiveCountries: string[] = movie.lbCountries && movie.lbCountries.length
          ? movie.lbCountries
          : (movie.production_countries || []).map((c: any) => {
                  if (!c || !c.name) return '';
                  if (c.iso_3166_1 === 'US') return 'USA';
                  if (c.iso_3166_1 === 'GB') return 'UK';
                  return c.name;
              }).filter(Boolean);
      effectiveCountries.forEach(name => aggGCL(name, countriesStats, movie.Rating));

      // Studios (Letterboxd-native only for now)
      if (movie.lbStudios && movie.lbStudios.length) {
          movie.lbStudios.forEach((studio: string) => {
              const name = (studio || '').trim();
              if (!name) return;
              aggGCL(name, studiosStats, movie.Rating);
          });
      }

      // Languages
      if (movie.original_language) {
          const langName = getLanguageName(movie.original_language);
          aggGCL(langName, languagesStats, movie.Rating);
      }
      
      // Directors & Actors (prefer Letterboxd-native credits; count only rated films)
      if (movie.Rating) {
              const directorNames: string[] = movie.lbCrew && movie.lbCrew.length
                  ? movie.lbCrew
                          .filter((p: any) => typeof p.job === 'string' && /director/i.test(p.job))
                          .map((p: any) => p.name)
                  : (movie.directors || []).map(d => d.name);

              const actorNames: string[] = movie.lbCast && movie.lbCast.length
                  ? movie.lbCast.map((a: any) => a.name)
                  : (movie.cast || []).map(a => a.name);

              directorNames.forEach(name => {
                  directorsMap[name] = (directorsMap[name] || 0) + 1;
              });

              actorNames.forEach(name => {
                  actorsMap[name] = (actorsMap[name] || 0) + 1;
              });
      }

      // Crew by job (Letterboxd-native)
      if (movie.lbCrew && movie.lbCrew.length) {
          movie.lbCrew.forEach((member: any) => {
              if (!member || !member.name) return;
              const job = (member.job || 'Other').trim();
              if (!crewByJobStats[job]) {
                  crewByJobStats[job] = {};
              }
              if (!crewByJobStats[job][member.name]) {
                  crewByJobStats[job][member.name] = { count: 0, sumRating: 0, ratedCount: 0 };
              }
              const stat = crewByJobStats[job][member.name];
              stat.count += 1;
              if (movie.Rating) {
                  stat.sumRating += parseFloat(movie.Rating);
                  stat.ratedCount += 1;
              }
          });
      }

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
        const ratedMovies = stat.movies.filter(m => m.Rating);
        const ratedMoviesWithPoster = ratedMovies.filter(
          (m) => m.poster_path || m.lbPosterUrl
        );
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
    const studiosData = processGCL(studiosStats);

    const directorsData = Object.entries(directorsMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    const actorsData = Object.entries(actorsMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    // Crew & Studios sections (for "Crew & Studios" panel)
    const crewSectionsMostWatched: any[] = [];
    const crewSectionsHighestRated: any[] = [];

    Object.entries(crewByJobStats).forEach(([job, peopleMap]) => {
        const peopleArray = Object.entries(peopleMap as any).map(([name, stat]: any) => ({
            name,
            count: stat.count,
            average: stat.ratedCount > 0 ? stat.sumRating / stat.ratedCount : 0,
            ratedCount: stat.ratedCount,
        }));

        const mostWatched = [...peopleArray]
            .sort((a, b) => b.count - a.count)
            .slice(0, 6);
        const highestRated = peopleArray
            .filter(p => p.ratedCount >= 3)
            .sort((a, b) => b.average - a.average)
            .slice(0, 6);

        if (mostWatched.length) {
            crewSectionsMostWatched.push({ job, people: mostWatched });
        }
        if (highestRated.length) {
            crewSectionsHighestRated.push({ job, people: highestRated });
        }
    });

    // Studios as their own "job" section
    if (studiosData.length) {
        const studiosMostWatched = [...studiosData]
            .sort((a, b) => b.count - a.count)
            .slice(0, 6);
        const studiosHighestRated = studiosData
            .filter(s => s.ratedCount >= 3)
            .sort((a, b) => b.average - a.average)
            .slice(0, 6);

        if (studiosMostWatched.length) {
            crewSectionsMostWatched.push({ job: 'Studios', people: studiosMostWatched });
        }
        if (studiosHighestRated.length) {
            crewSectionsHighestRated.push({ job: 'Studios', people: studiosHighestRated });
        }
    }

    crewSectionsMostWatched.sort((a, b) => a.job.localeCompare(b.job));
    crewSectionsHighestRated.sort((a, b) => a.job.localeCompare(b.job));

    const averageRating = totalRated > 0 ? (sumRating / totalRated).toFixed(2) : 'N/A';
    const totalHours = Math.round(totalRuntimeMinutes / 60);

    return { 
        yearsData, 
        topDecades,
        ratingsData, 
        genresData, 
        countriesData, 
        languagesData,
        studiosData,
        directorsData, 
        actorsData, 
        averageRating, 
        totalHours,
        crewSectionsMostWatched,
        crewSectionsHighestRated,
    };
  }, [data]);

  // Helper to sort GCL data based on metric
  const getSortedGCL = useCallback((gclData: any[], metric: 'watched' | 'rated') => {
      if (metric === 'watched') {
          return [...gclData].sort((a, b) => b.count - a.count).slice(0, 10);
      } else {
          // For rating, filter items with at least 3 rated films to avoid noise
          return [...gclData]
              .filter(item => item.ratedCount >= 3)
              .sort((a, b) => b.average - a.average)
              .slice(0, 10);
      }
  }, []);

  if (!stats) {
    return (
      <div className="text-center text-lb-text py-10">
        <p>No movies to display.</p>
        <button
          onClick={onReset}
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-lb-surface hover:bg-gray-700 rounded-lg text-sm text-white transition-colors border border-gray-600 shadow-sm"
        >
          <RotateCcw className="w-4 h-4" />
          Start Over
        </button>
      </div>
    );
  }

  const crewSectionsMostWatchedOrdered = orderCrewSectionsForUI(stats.crewSectionsMostWatched);
  const crewSectionsHighestRatedOrdered = orderCrewSectionsForUI(stats.crewSectionsHighestRated);

  return (
    <div className="animate-[fadeIn_0.5s_ease-out] pb-20 space-y-6 md:space-y-8">
      {/* Action Bar */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-white">Your Dashboard</h2>
          <p className="text-lb-text text-sm">Analysis of {data.length} films</p>
        </div>
        <button 
          onClick={onReset}
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
          {stats.topDecades.map((decade: any) => (
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
                  {decade.topMovies.map((movie: any, idx: number) => (
                    <div key={`${movie.tmdb_id}-${idx}`} className="relative group w-full aspect-[2/3] bg-gray-800 rounded overflow-hidden shadow-lg hover:ring-2 hover:ring-lb-green transition-all cursor-default transform hover:-translate-y-1 hover:z-10 duration-200">
                      {movie.lbPosterUrl || movie.poster_path ? (
                        <img 
                          src={movie.lbPosterUrl
                            ? movie.lbPosterUrl
                            : `https://image.tmdb.org/t/p/w154${movie.poster_path}`}
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
            <span className="text-xs font-bold text-white tracking-widest uppercase">Genres, Countries &amp; Languages</span>
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

      {/* 7. Crews & Studios */}
      {crewSectionsMostWatchedOrdered.length > 0 && (
        <div className="bg-lb-surface p-4 md:p-6 rounded-xl shadow-lg border border-gray-800 overflow-hidden">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-6 gap-3 md:gap-4">
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs font-bold text-white tracking-widest uppercase">Crews &amp; Studios</span>
            </div>
            <div className="hidden md:block h-[1px] bg-gray-700 w-full mx-4 opacity-50"></div>
            <div className="flex gap-4 shrink-0 text-xs font-bold tracking-widest uppercase w-full md:w-auto justify-between md:justify-end">
              <button
                onClick={() => setCrewMetric('watched')}
                className={`${crewMetric === 'watched' ? 'text-lb-blue' : 'text-gray-500 hover:text-gray-300'} transition-colors`}
              >
                Most Watched
              </button>
              <button
                onClick={() => setCrewMetric('rated')}
                className={`${crewMetric === 'rated' ? 'text-lb-orange' : 'text-gray-500 hover:text-gray-300'} transition-colors`}
              >
                Highest Rated
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {(crewMetric === 'watched' ? crewSectionsMostWatchedOrdered : crewSectionsHighestRatedOrdered)
              .map((section: any) => (
                <div key={section.displayJob} className="space-y-2 min-w-0">
                  <h4 className="text-[11px] font-semibold text-gray-400 tracking-[0.18em] uppercase truncate">
                    {section.displayJob}
                  </h4>
                  <ul className="space-y-1 text-sm">
                    {section.people.map((person: any) => (
                      <li key={person.name} className="flex items-baseline justify-between gap-2">
                        <span className="text-gray-100 truncate">{person.name}</span>
                        <span className="text-[11px] text-gray-500 font-mono">
                          {crewMetric === 'watched'
                            ? person.count
                            : person.average.toFixed(1)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
