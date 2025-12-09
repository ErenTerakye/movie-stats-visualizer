import React, { useState, useCallback, useMemo } from 'react';
import { Upload, Film, BarChart3, AlertCircle, RotateCcw, Clock, Users, Globe } from 'lucide-react';
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

// --- Custom Tooltip Component ---
const CustomTooltip = ({ active, payload, label, valueType }: any) => {
  if (active && payload && payload.length) {
    let value = payload[0].value;
    let unit = '';
    
    if (valueType === 'rating') {
        value = Number(value).toFixed(2);
        unit = '★';
    } else if (valueType === 'minutes') {
        unit = ' mins';
    } else {
        unit = ' films';
    }

    return (
      <div className="bg-lb-surface border border-gray-700 p-3 rounded shadow-xl z-50 text-xs pointer-events-none">
        <p className="text-white font-bold mb-1 text-sm">{label}</p>
        <p className="text-lb-green">
          {value}{unit}
        </p>
      </div>
    );
  }
  return null;
};

const StatCard = ({ icon: Icon, title, value, subtext, color = "text-white" }: any) => (
    <div className="bg-lb-surface p-5 rounded-lg border border-gray-800 shadow-lg flex flex-col justify-between">
        <div>
            <div className="flex items-center gap-2 mb-2">
                <Icon className={`w-4 h-4 ${color}`} />
                <h3 className="text-lb-text text-xs uppercase tracking-wider font-semibold">{title}</h3>
            </div>
            <p className="text-3xl font-bold text-white">{value}</p>
        </div>
        {subtext && <p className="text-xs text-gray-500 mt-2">{subtext}</p>}
    </div>
);

const SectionHeader = ({ icon: Icon, title, color = "text-white" }: any) => (
    <div className="flex items-center gap-2 mb-6">
        <Icon className={`w-6 h-6 ${color}`} />
        <h3 className="text-xl font-bold text-white tracking-tight">{title}</h3>
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
    // Keys are year strings (e.g. "2023", "1999")
    const yearsDetailedMap: Record<string, { 
        diaryCount: number; 
        sumRating: number; 
        ratedCount: number; 
        uniqueMovies: Set<string>;
    }> = {};

    const decadesMap: Record<string, number> = {};
    const ratingsMap: Record<string, number> = {};
    const genresMap: Record<string, number> = {};
    const countriesMap: Record<string, number> = {};
    const directorsMap: Record<string, number> = {};
    const actorsMap: Record<string, number> = {};
    
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

    data.forEach(movie => {
      // 1. Release Year Stats (Films count, Ratings, Decades)
      if (movie.Year) {
        ensureYearEntry(movie.Year);
        const yStat = yearsDetailedMap[movie.Year];
        
        yStat.uniqueMovies.add(movie.LetterboxdURI || movie.Name);
        
        if (movie.Rating) {
            yStat.sumRating += parseFloat(movie.Rating);
            yStat.ratedCount += 1;
        }

        const yearInt = parseInt(movie.Year);
        if (!isNaN(yearInt)) {
            const decade = Math.floor(yearInt / 10) * 10;
            const decadeLabel = `${decade}s`;
            decadesMap[decadeLabel] = (decadesMap[decadeLabel] || 0) + 1;
        }
      }

      // 2. Diary Stats (Logged Count based on 'Watched Date' or 'Date' column)
      // Prioritize explicit 'Watched Date' if it exists (some exports separate Logged vs Watched)
      const watchedDate = movie['Watched Date'] || movie.Date;
      if (watchedDate) {
          // Date format is typically YYYY-MM-DD
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
        movie.genres.forEach(g => {
          genresMap[g.name] = (genresMap[g.name] || 0) + 1;
        });
      }

      // Countries
      if (movie.production_countries) {
        movie.production_countries.forEach(c => {
           const name = c.iso_3166_1 === 'US' ? 'USA' : 
                        c.iso_3166_1 === 'GB' ? 'UK' : c.iso_3166_1;
           countriesMap[name] = (countriesMap[name] || 0) + 1;
        });
      }
      
      // Directors
      if (movie.directors) {
          movie.directors.forEach(d => {
              directorsMap[d.name] = (directorsMap[d.name] || 0) + 1;
          });
      }

      // Actors
      if (movie.cast) {
          movie.cast.forEach(a => {
              actorsMap[a.name] = (actorsMap[a.name] || 0) + 1;
          });
      }

      // Runtime
      if (movie.runtime) {
          totalRuntimeMinutes += movie.runtime;
      }
    });

    // Format for Recharts
    const yearsData = Object.entries(yearsDetailedMap)
      .map(([name, stat]) => ({ 
          name, 
          films: stat.uniqueMovies.size,
          diary: stat.diaryCount,
          rating: stat.ratedCount > 0 ? parseFloat((stat.sumRating / stat.ratedCount).toFixed(2)) : 0
      }))
      .sort((a, b) => parseInt(a.name) - parseInt(b.name));

    const decadesData = Object.entries(decadesMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => parseInt(a.name) - parseInt(b.name));

    const ratingsData = Object.entries(ratingsMap)
        .map(([name, value]) => ({ name: parseFloat(name), value, label: name }))
        .sort((a, b) => a.name - b.name);
    
    const genresData = Object.entries(genresMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    const countriesData = Object.entries(countriesMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
      
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
        decadesData, 
        ratingsData, 
        genresData, 
        countriesData, 
        directorsData, 
        actorsData, 
        averageRating, 
        totalHours,
    };
  }, [data]);


  return (
    <Layout>
      {/* Header */}
      <header className={`text-center border-b border-lb-surface pb-8 transition-all duration-500 ${status === 'ready' ? 'mb-8' : 'mb-12'}`}>
        <div className="flex items-center justify-center gap-3 mb-4">
          <Film className="w-10 h-10 text-lb-green" />
          <h1 className="text-4xl font-bold text-white tracking-tight">
            Letterboxd <span className="text-lb-blue">Stats</span>
          </h1>
        </div>
        {status !== 'ready' && (
           <p className="text-lb-text max-w-xl mx-auto text-lg">
             Visualize your movie watching habits. Export your data from Letterboxd and drop it below.
           </p>
        )}
      </header>

      {/* Main Content Area */}
      <main className="w-full">
        {status === 'idle' && (
          <div className="max-w-xl mx-auto bg-lb-surface p-8 rounded-xl shadow-xl border border-gray-800">
            <div className="mb-6">
              <label className="block text-sm font-medium text-lb-text mb-2">
                1. TMDB API Key
              </label>
              <input
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your TMDB Read Access Token or API Key"
                className="w-full bg-lb-bg border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-lb-green transition-colors"
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
                <div className="border-2 border-dashed border-gray-600 rounded-xl p-8 text-center group-hover:border-lb-blue transition-colors bg-lb-bg">
                  <Upload className="w-12 h-12 mx-auto text-gray-500 mb-4 group-hover:text-lb-blue transition-colors" />
                  <p className="text-white font-medium">Click or Drag CSV here</p>
                  <p className="text-sm text-gray-500 mt-1">Exported from Letterboxd settings</p>
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
          <div className="max-w-xl mx-auto text-center py-20">
            <div className="mb-6 relative w-24 h-24 mx-auto">
                <div className="absolute inset-0 border-4 border-lb-surface rounded-full"></div>
                <div 
                    className="absolute inset-0 border-4 border-lb-green rounded-full border-t-transparent animate-spin"
                ></div>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">
                {status === 'parsing' ? 'Parsing CSV...' : 'Fetching Data...'}
            </h2>
            <p className="text-lb-text mb-6">
                Analyzing {status === 'fetching' ? 'metadata, credits, and runtimes' : 'file'}.
            </p>
            
            <div className="w-full bg-lb-surface rounded-full h-4 overflow-hidden">
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
          <div className="animate-fade-in pb-20 space-y-8">
             {/* Action Bar */}
             <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-3xl font-bold text-white">Your Dashboard</h2>
                    <p className="text-lb-text text-sm">Analysis of {data.length} films</p>
                </div>
                <button 
                    onClick={() => {
                        setStatus('idle');
                        setData([]);
                        setProgress(0);
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-lb-surface hover:bg-gray-700 rounded-lg text-sm text-white transition-colors border border-gray-600"
                >
                    <RotateCcw className="w-4 h-4" />
                    Start Over
                </button>
             </div>

             {/* 1. Overview Cards (3 columns) */}
             <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <StatCard icon={Film} title="Total Films" value={data.length} color="text-lb-green" />
                <StatCard icon={Clock} title="Hours Watched" value={stats.totalHours.toLocaleString()} color="text-lb-orange" subtext="Approximate runtime" />
                <StatCard icon={BarChart3} title="Avg Rating" value={stats.averageRating} color="text-lb-blue" />
             </div>

             {/* 2. Timeline (Years & Decades) */}
             <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 bg-lb-surface p-6 rounded-xl shadow-lg border border-gray-800">
                    {/* Header with Tabs */}
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs font-bold text-white tracking-widest uppercase">By Year</span>
                        </div>
                        <div className="h-[1px] bg-gray-700 w-full mx-4"></div>
                        <div className="flex gap-4 shrink-0 text-xs font-bold tracking-widest uppercase">
                            <button 
                                onClick={() => setYearMetric('films')}
                                className={`${yearMetric === 'films' ? 'text-white' : 'text-gray-500 hover:text-gray-300'} transition-colors`}
                            >
                                Films
                            </button>
                            <button 
                                onClick={() => setYearMetric('rating')}
                                className={`${yearMetric === 'rating' ? 'text-white' : 'text-gray-500 hover:text-gray-300'} transition-colors`}
                            >
                                Ratings
                            </button>
                            <button 
                                onClick={() => setYearMetric('diary')}
                                className={`${yearMetric === 'diary' ? 'text-white' : 'text-gray-500 hover:text-gray-300'} transition-colors`}
                            >
                                Diary
                            </button>
                        </div>
                    </div>

                    <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={stats.yearsData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#445566" opacity={0.3} />
                                <XAxis dataKey="name" tick={{ fill: '#99aabb', fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={15} />
                                <YAxis tick={{ fill: '#99aabb', fontSize: 12 }} tickLine={false} axisLine={false} domain={yearMetric === 'rating' ? [0, 5] : [0, 'auto']} />
                                <Tooltip content={<CustomTooltip valueType={yearMetric} />} cursor={{fill: '#445566', opacity: 0.2}} />
                                <Bar 
                                    dataKey={yearMetric} 
                                    fill={yearMetric === 'films' ? '#00e054' : yearMetric === 'rating' ? '#40bcf4' : '#ff8000'} 
                                    radius={[2, 2, 0, 0]} 
                                    maxBarSize={40} 
                                />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="bg-lb-surface p-6 rounded-xl shadow-lg border border-gray-800">
                    <SectionHeader icon={Clock} title="Decade Stats" color="text-lb-green" />
                    <div className="h-64 w-full">
                         <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={stats.decadesData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#445566" opacity={0.3} />
                                <XAxis dataKey="name" tick={{ fill: '#99aabb', fontSize: 12 }} tickLine={false} axisLine={false} />
                                <YAxis tick={{ fill: '#99aabb', fontSize: 12 }} tickLine={false} axisLine={false} />
                                <Tooltip content={<CustomTooltip />} cursor={{fill: '#445566', opacity: 0.2}} />
                                <Bar dataKey="value" fill="#00e054" radius={[2, 2, 0, 0]} barSize={30} fillOpacity={0.8} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
             </div>

             {/* 3. Ratings Profile */}
             <div className="bg-lb-surface p-6 rounded-xl shadow-lg border border-gray-800">
                <SectionHeader icon={BarChart3} title="Ratings Profile" color="text-lb-orange" />
                <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={stats.ratingsData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#445566" opacity={0.3} />
                            <XAxis dataKey="label" tick={{ fill: '#99aabb', fontSize: 12 }} tickLine={false} axisLine={false} />
                            <YAxis tick={{ fill: '#99aabb', fontSize: 12 }} tickLine={false} axisLine={false} />
                            <Tooltip content={<CustomTooltip />} cursor={{fill: '#445566', opacity: 0.2}} />
                            <Bar dataKey="value" fill="#ff8000" radius={[2, 2, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
             </div>

             {/* 4. Genres & Countries */}
             <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-lb-surface p-6 rounded-xl shadow-lg border border-gray-800">
                    <SectionHeader icon={BarChart3} title="Top Genres" color="text-lb-blue" />
                    <div className="h-[400px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={stats.genresData} layout="vertical" margin={{ top: 5, right: 20, left: 20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#445566" opacity={0.3} />
                                <XAxis type="number" hide />
                                <YAxis dataKey="name" type="category" width={100} tick={{ fill: '#99aabb', fontSize: 11 }} tickLine={false} axisLine={false} />
                                <Tooltip content={<CustomTooltip />} cursor={{fill: '#445566', opacity: 0.2}} />
                                <Bar dataKey="value" fill="#40bcf4" radius={[0, 2, 2, 0]} barSize={20} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="bg-lb-surface p-6 rounded-xl shadow-lg border border-gray-800">
                    <SectionHeader icon={Globe} title="Production Countries" color="text-lb-green" />
                    <div className="h-[400px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={stats.countriesData} layout="vertical" margin={{ top: 5, right: 20, left: 20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#445566" opacity={0.3} />
                                <XAxis type="number" hide />
                                <YAxis dataKey="name" type="category" width={100} tick={{ fill: '#99aabb', fontSize: 11 }} tickLine={false} axisLine={false} />
                                <Tooltip content={<CustomTooltip />} cursor={{fill: '#445566', opacity: 0.2}} />
                                <Bar dataKey="value" fill="#00e054" radius={[0, 2, 2, 0]} barSize={20} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
             </div>

             {/* 5. Stars & Directors */}
             <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-lb-surface p-6 rounded-xl shadow-lg border border-gray-800">
                    <SectionHeader icon={Users} title="Top Stars" color="text-lb-orange" />
                    <div className="h-[400px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={stats.actorsData} layout="vertical" margin={{ top: 5, right: 20, left: 20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#445566" opacity={0.3} />
                                <XAxis type="number" hide />
                                <YAxis dataKey="name" type="category" width={100} tick={{ fill: '#99aabb', fontSize: 11 }} tickLine={false} axisLine={false} />
                                <Tooltip content={<CustomTooltip />} cursor={{fill: '#445566', opacity: 0.2}} />
                                <Bar dataKey="value" fill="#ff8000" radius={[0, 2, 2, 0]} barSize={20} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="bg-lb-surface p-6 rounded-xl shadow-lg border border-gray-800">
                    <SectionHeader icon={Users} title="Top Directors" color="text-lb-blue" />
                    <div className="h-[400px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={stats.directorsData} layout="vertical" margin={{ top: 5, right: 20, left: 20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#445566" opacity={0.3} />
                                <XAxis type="number" hide />
                                <YAxis dataKey="name" type="category" width={100} tick={{ fill: '#99aabb', fontSize: 11 }} tickLine={false} axisLine={false} />
                                <Tooltip content={<CustomTooltip />} cursor={{fill: '#445566', opacity: 0.2}} />
                                <Bar dataKey="value" fill="#40bcf4" radius={[0, 2, 2, 0]} barSize={20} />
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