import React, { useEffect, useState } from 'react';

export interface AppState {
  enabled: boolean;
  saturation: number;
  brightness: number;
  playbackRate: number;
}

const DEFAULT_STATE: AppState = {
  enabled: false,
  saturation: 100,
  brightness: 100,
  playbackRate: 1.0,
};

export const App: React.FC = () => {
  const [state, setState] = useState<AppState>(DEFAULT_STATE);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(['appState'], (result) => {
      if (result.appState) {
        setState(result.appState);
      }
      setLoaded(true);
    });
  }, []);

  const updateState = (updates: Partial<AppState>) => {
    const newState = { ...state, ...updates };
    setState(newState);
    chrome.storage.local.set({ appState: newState });
    
    // Attempt to message the active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'UPDATE_STATE',
          payload: newState
        }).catch(() => {
          // Ignore errors (e.g. extension not loaded on current tab)
        });
      }
    });
  };

  if (!loaded) return <div className="w-80 min-h-[250px] bg-slate-900 text-slate-100 p-6 font-sans">Loading...</div>;

  return (
    <div className="w-80 min-h-[350px] bg-slate-900 text-slate-100 p-6 flex flex-col font-sans">
      <header className="flex items-center justify-between border-b border-slate-800 pb-4 mb-6">
        <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
          <span className={`w-3 h-3 rounded-full inline-block transition-colors duration-300 ${state.enabled ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse' : 'bg-slate-600'}`}></span>
          Stimulation Governor
        </h1>
        <label className="relative inline-flex items-center cursor-pointer">
          <input 
            type="checkbox" 
            className="sr-only peer" 
            checked={state.enabled}
            onChange={(e) => updateState({ enabled: e.target.checked })}
          />
          <div className="w-10 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
        </label>
      </header>

      <div className={`space-y-6 transition-opacity duration-300 ${!state.enabled ? 'opacity-40 pointer-events-none' : 'opacity-100'}`}>
        
        {/* Saturation */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <label className="text-sm font-medium text-slate-300">Saturation</label>
            <span className="text-xs font-mono bg-slate-800 text-slate-300 px-2 py-1 rounded shadow-inner">{state.saturation}%</span>
          </div>
          <input 
            type="range" 
            min="0" max="100" 
            value={state.saturation}
            onChange={(e) => updateState({ saturation: parseInt(e.target.value) })}
            className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
          />
        </div>

        {/* Brightness */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <label className="text-sm font-medium text-slate-300">Brightness</label>
            <span className="text-xs font-mono bg-slate-800 text-slate-300 px-2 py-1 rounded shadow-inner">{state.brightness}%</span>
          </div>
          <input 
            type="range" 
            min="50" max="120" 
            value={state.brightness}
            onChange={(e) => updateState({ brightness: parseInt(e.target.value) })}
            className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
          />
        </div>

        {/* Playback Speed */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <label className="text-sm font-medium text-slate-300">Playback Speed</label>
            <span className="text-xs font-mono bg-slate-800 text-slate-300 px-2 py-1 rounded shadow-inner">{state.playbackRate.toFixed(2)}x</span>
          </div>
          <input 
            type="range" 
            min="0.5" max="1.0" step="0.05"
            value={state.playbackRate}
            onChange={(e) => updateState({ playbackRate: parseFloat(e.target.value) })}
            className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
          />
        </div>

      </div>
    </div>
  );
};

export default App;
