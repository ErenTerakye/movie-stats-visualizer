import React, { useState, useCallback, useEffect } from 'react';
import { Film, AlertCircle, RotateCcw } from 'lucide-react';
import Layout from './components/Layout';
import { EnrichedMovie, AppStatus } from './types';

const Dashboard = React.lazy(() => import('./components/Dashboard'));

// Helper for language display names
const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });
const getLanguageName = (code: string) => {
    try {
        return languageNames.of(code) || code;
    } catch (e) {
        return code;
    }
};

const App: React.FC = () => {
  const [status, setStatus] = useState<AppStatus>('idle');
    const [username, setUsername] = useState<string>('');
  const [progress, setProgress] = useState<number>(0);
  const [data, setData] = useState<EnrichedMovie[]>([]);
  const [error, setError] = useState<string | null>(null);

    // Smooth, slower approximate progress bar while fetching from the backend
    useEffect(() => {
        if (status !== 'fetching') {
            if (status === 'ready') {
                setProgress(100);
            }
            return;
        }

        // Start from a small non-zero value so the user sees movement
        setProgress((prev) => (prev <= 0 ? 5 : prev));

        const intervalId = window.setInterval(() => {
            setProgress((prev) => {
                // Cap the simulated progress well below 100 so
                // long-running fetches don't sit forever at "99%"
                if (prev >= 85) return prev;

                // Much slower progression: quick start, then gradually slows
                const increment =
                    prev < 40 ? 2 :
                    prev < 70 ? 1 :
                    0.5;

                return Math.min(prev + increment, 85);
            });
        }, 800);

        return () => {
            window.clearInterval(intervalId);
        };
    }, [status]);

    // Fetch data from backend by Letterboxd username
    const handleFetchByUsername = useCallback(async () => {
        const trimmed = username.trim();
        if (!trimmed) {
            setError('Please enter a Letterboxd username.');
            return;
        }

        setError(null);
        setStatus('fetching');
        setProgress(0);

        try {
            const apiBase = (import.meta as any).env?.VITE_API_BASE_URL || '';
            const url = `${apiBase}/api/fetch-user-data?username=${encodeURIComponent(trimmed)}`;
            const res = await fetch(url);
            if (!res.ok) {
                let message = 'Failed to fetch data from server.';
                try {
                    const body = await res.json();
                    if (body && typeof body.error === 'string') {
                        message = body.error;
                    }
                } catch {
                    // ignore JSON parse errors and use default message
                }
                throw new Error(message);
            }

            const body = await res.json();
            if (!body || !Array.isArray(body.movies) || body.movies.length === 0) {
                throw new Error('No movies returned for this user.');
            }

            setData(body.movies as EnrichedMovie[]);
            setStatus('ready');
            setProgress(100);
        } catch (err: any) {
            console.error(err);
            setError(err?.message || 'An error occurred while fetching data.');
            setStatus('idle');
            setProgress(0);
        }
    }, [username]);

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
                         Visualize your movie watching habits. Enter your Letterboxd username and we&apos;ll fetch and enrich your diary + films.
           </p>
        )}
      </header>

      {/* Main Content Area */}
      <main className="w-full">
        {status === 'idle' && (
          <div className="max-w-xl mx-auto bg-lb-surface p-6 md:p-8 rounded-xl shadow-xl border border-gray-800 hover:border-gray-700 transition-colors">
            <div className="mb-6">
              <label className="block text-sm font-medium text-lb-text mb-2">
                                Letterboxd Username
              </label>
              <input
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                placeholder="e.g. erenreel"
                className="w-full bg-lb-bg border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-lb-green transition-colors text-sm md:text-base"
              />
              <p className="text-xs text-gray-500 mt-2">
                                We&apos;ll fetch your public diary and films, then enrich them with TMDB on the server.
              </p>
            </div>

            <div className="mb-2">
                            <button
                                onClick={handleFetchByUsername}
                                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-lb-green hover:bg-emerald-500 rounded-lg text-sm md:text-base text-black font-semibold transition-colors shadow-lg shadow-emerald-500/20"
                            >
                                Fetch Stats
                            </button>
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
                {status === 'fetching' && (
          <div className="max-w-xl mx-auto text-center py-10 md:py-20">
            <div className="mb-6 relative w-20 h-20 md:w-24 md:h-24 mx-auto">
                <div className="absolute inset-0 border-4 border-lb-surface rounded-full"></div>
                <div 
                    className="absolute inset-0 border-4 border-lb-green rounded-full border-t-transparent animate-spin"
                ></div>
            </div>
            <h2 className="text-xl md:text-2xl font-bold text-white mb-2">
                Fetching Data...
            </h2>
            <p className="text-lb-text mb-6 text-sm md:text-base">
                Fetching your diary and films, then analyzing metadata, credits, and runtimes.
            </p>
            
            <div className="w-full bg-lb-surface rounded-full h-3 md:h-4 overflow-hidden">
                <div 
                    className="bg-lb-green h-full transition-all duration-300 ease-out"
                    style={{ width: `${progress}%` }}
                ></div>
            </div>
                        <p className="mt-2 text-right text-sm text-lb-green font-mono">{Math.round(progress)}%</p>
          </div>
        )}

        {/* Dashboard Visualization */}
        {status === 'ready' && (
          <React.Suspense
            fallback={
              <div className="max-w-xl mx-auto text-center py-10 md:py-16">
                <div className="mb-4 text-lb-text text-sm md:text-base">Loading dashboard...</div>
                <div className="w-full bg-lb-surface rounded-full h-3 md:h-4 overflow-hidden">
                  <div className="bg-lb-green h-full w-1/3 animate-pulse" />
                </div>
              </div>
            }
          >
            <Dashboard
              data={data}
              onReset={() => {
                setStatus('idle');
                setData([]);
                setProgress(0);
              }}
            />
          </React.Suspense>
        )}
      </main>
    </Layout>
  );
};

export default App;