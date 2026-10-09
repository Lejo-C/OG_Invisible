import React, { useEffect, useState } from 'react';

interface DailyUsage {
  date: string;
  minutes: number;
}

interface ParentalStats {
  history: DailyUsage[];
  currentVideoTitle: string;
}

const Dashboard: React.FC = () => {
  const [stats, setStats] = useState<ParentalStats>({ history: [], currentVideoTitle: 'Nothing playing right now' });
  const [timeLimit, setTimeLimit] = useState(60);

  useEffect(() => {
    const fetchStats = () => {
      chrome.storage.local.get(['parentalStats', 'timeLimit'], (res) => {
        if (res.timeLimit !== undefined) {
          setTimeLimit(res.timeLimit);
        }
        let currentStats = res.parentalStats;
        if (!currentStats) {
          currentStats = { history: [], currentVideoTitle: 'Nothing playing right now' };
        }
        
        // --- SEED MOCK DATA FOR PAST 6 DAYS (DEMO PURPOSES) ---
        let changed = false;
        const d = new Date();
        for (let i = 1; i <= 6; i++) {
          const past = new Date();
          past.setDate(d.getDate() - i);
          const dateStr = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, '0')}-${String(past.getDate()).padStart(2, '0')}`;
          
          if (!currentStats.history.find((h: any) => h.date === dateStr)) {
            // Random time between 25 and 115 minutes
            currentStats.history.push({ date: dateStr, minutes: Math.floor(Math.random() * 90) + 25 });
            changed = true;
          }
        }
        
        if (changed) {
          chrome.storage.local.set({ parentalStats: currentStats });
        }
        // ------------------------------------------------------
        
        setStats(currentStats);
      });
    };

    fetchStats();
    // Poll every 5 seconds since content script updates it regularly
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  const d = new Date();
  const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const todayData = stats.history.find(h => h.date === todayStr);
  const todayMinutes = Math.round(todayData?.minutes || 0);
  
  // Build last 7 days array even for missing days
  const chartData = [];
  let maxMin = 10;
  for (let i = 6; i >= 0; i--) {
    const dDate = new Date();
    dDate.setDate(dDate.getDate() - i);
    const dateStr = `${dDate.getFullYear()}-${String(dDate.getMonth() + 1).padStart(2, '0')}-${String(dDate.getDate()).padStart(2, '0')}`;
    const dayName = dDate.toLocaleDateString('en-US', { weekday: 'short' });
    
    const entry = stats.history.find(h => h.date === dateStr);
    const mins = Math.round(entry?.minutes || 0);
    if (mins > maxMin) maxMin = mins;
    
    chartData.push({ day: dayName, minutes: mins });
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans p-8">
      <div className="max-w-3xl mx-auto">
        <header className="mb-10 flex justify-between items-end">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 mb-2">Screen Time</h1>
            <p className="text-slate-500 text-lg">Track daily YouTube usage.</p>
          </div>
          <div className="text-right">
            <div className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-1">Today</div>
            <div className="text-4xl font-bold text-emerald-600">{todayMinutes} <span className="text-xl text-slate-400 font-normal">min</span></div>
          </div>
        </header>

        <main className="space-y-6">
          {/* Real-time Status */}
          <section className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-1">Currently Watching</h2>
              <p className="text-slate-800 font-medium text-lg truncate max-w-xl">
                {stats.currentVideoTitle || 'No video detected'}
              </p>
            </div>
            {stats.currentVideoTitle && stats.currentVideoTitle !== 'Nothing playing right now' && (
              <span className="flex h-3 w-3 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
            )}
          </section>

          {/* Bar Chart (Screen Time style) */}
          <section className="bg-white p-8 rounded-xl border border-slate-200 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900 mb-8">Weekly Summary</h2>
            <div className="h-48 flex items-end justify-between gap-2">
              {chartData.map((d, i) => {
                const heightPercent = Math.max((d.minutes / maxMin) * 100, 2);
                const isToday = i === 6;
                return (
                  <div key={i} className="flex flex-col items-center flex-1 group h-full">
                    <div className="w-full flex justify-center h-full items-end relative">
                      {/* Tooltip on hover */}
                      <div className="opacity-0 group-hover:opacity-100 absolute -top-8 bg-slate-800 text-white text-xs px-2 py-1 rounded transition-opacity whitespace-nowrap pointer-events-none">
                        {d.minutes} min
                      </div>
                      <div 
                        className={`w-full max-w-[40px] rounded-t-md transition-all duration-500 ${isToday ? 'bg-emerald-500' : 'bg-slate-300 hover:bg-slate-400'}`}
                        style={{ height: `${heightPercent}%` }}
                      ></div>
                    </div>
                    <span className={`text-sm mt-3 font-medium ${isToday ? 'text-slate-900' : 'text-slate-500'}`}>
                      {d.day}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Simple controls */}
          <section className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-slate-900">Daily Limit</h2>
              <span className="text-slate-600 font-medium">{timeLimit} min</span>
            </div>
            <input 
              type="range" 
              min="1" max="120" step="1"
              value={timeLimit}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                setTimeLimit(val);
                chrome.storage.local.set({ timeLimit: val });
              }}
              className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-emerald-500"
            />
            <p className="text-sm text-slate-500 mt-4">
              Set a goal for daily usage. When this limit is reached, YouTube video playback will be blocked.
            </p>
          </section>
          
          <div className="text-center pt-8">
            <button 
              onClick={() => {
                if (confirm('Are you sure you want to reset all viewing history?')) {
                  chrome.storage.local.remove('parentalStats', () => {
                    setStats({ history: [], currentVideoTitle: 'Nothing playing right now' });
                    window.location.reload();
                  });
                }
              }}
              className="text-xs font-medium text-slate-400 hover:text-red-500 transition-colors"
            >
              Reset Usage Data
            </button>
          </div>
        </main>
      </div>
    </div>
  );
};

export default Dashboard;
