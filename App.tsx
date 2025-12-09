import React, { useState, useCallback } from 'react';
import { Upload, Film, BarChart3, AlertCircle, PlayCircle } from 'lucide-react';
import Layout from './components/Layout';
import { parseCSV } from './utils/csvHelper';
import { fetchTMDBData } from './services/tmdbService';
import { EnrichedMovie, AppStatus } from './types';

// Constants
const TMDB_API_KEY_STORAGE = 'tmdb_api_key';

const App: React.FC = () => {
  const [status, setStatus] = useState<AppStatus>('idle');
  const [apiKey, setApiKey] = useState<string>(localStorage.getItem(TMDB_API_KEY_STORAGE) || '');
  const [progress, setProgress] = useState<number>(0);
  const [data, setData] = useState<EnrichedMovie[]>([]);
  const [error, setError] = useState<string | null>(null);

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
        // Phase 2 Logic: Parse CSV
        const rawMovies = parseCSV(text);
        
        if (rawMovies.length === 0) {
            setError("No movies found in CSV. Check format.");
            setStatus('idle');
            return;
        }

        setStatus('fetching');
        
        // Phase 2 Logic: Fetch TMDB Data
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

  // Phase 3 UI: Header and Upload Zone
  return (
    <Layout>
      {/* Header */}
      <header className="mb-12 text-center border-b border-lb-surface pb-8">
        <div className="flex items-center justify-center gap-3 mb-4">
          <Film className="w-10 h-10 text-lb-green" />
          <h1 className="text-4xl font-bold text-white tracking-tight">
            Letterboxd <span className="text-lb-blue">Stats</span>
          </h1>
        </div>
        <p className="text-lb-text max-w-xl mx-auto text-lg">
          Visualize your movie watching habits. Export your data from Letterboxd and drop it below.
        </p>
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
                Required to fetch genre and country data. Free from themoviedb.org.
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
                {status === 'parsing' ? 'Parsing CSV...' : 'Fetching Movie Details...'}
            </h2>
            <p className="text-lb-text mb-6">
                Enriching your data with TMDB genres and production countries.
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

        {/* Dashboard Placeholder (Phase 3 Completed State) */}
        {status === 'ready' && (
          <div className="animate-fade-in">
             <div className="flex justify-between items-center mb-8">
                <h2 className="text-2xl font-bold text-white">Your Dashboard</h2>
                <button 
                    onClick={() => {
                        setStatus('idle');
                        setData([]);
                        setProgress(0);
                    }}
                    className="text-sm text-lb-orange hover:text-white underline"
                >
                    Upload New File
                </button>
             </div>

             {/* Simple Stats Grid Placeholder */}
             <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
                <div className="bg-lb-surface p-6 rounded-xl border-t-4 border-lb-green">
                    <h3 className="text-lb-text text-sm uppercase tracking-wider font-semibold mb-1">Total Films</h3>
                    <p className="text-4xl font-bold text-white">{data.length}</p>
                </div>
                <div className="bg-lb-surface p-6 rounded-xl border-t-4 border-lb-orange">
                    <h3 className="text-lb-text text-sm uppercase tracking-wider font-semibold mb-1">Success Rate</h3>
                    <p className="text-4xl font-bold text-white">
                        {Math.round((data.filter(m => !m.notFound && !m.error).length / data.length) * 100)}%
                    </p>
                </div>
                <div className="bg-lb-surface p-6 rounded-xl border-t-4 border-lb-blue">
                    <h3 className="text-lb-text text-sm uppercase tracking-wider font-semibold mb-1">Status</h3>
                    <div className="flex items-center gap-2 mt-2 text-white">
                        <PlayCircle className="w-6 h-6" />
                        <span className="text-xl">Ready to Visualize</span>
                    </div>
                </div>
             </div>
            
            <div className="bg-lb-surface p-12 rounded-xl text-center border border-dashed border-gray-700">
                <BarChart3 className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                <h3 className="text-xl text-white font-medium mb-2">Charts Coming Soon</h3>
                <p className="text-lb-text">
                    Phase 4 will inject the Recharts visualization components here.
                </p>
            </div>
          </div>
        )}
      </main>
    </Layout>
  );
};

export default App;