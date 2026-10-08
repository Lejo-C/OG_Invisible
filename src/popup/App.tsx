import React, { useEffect, useState } from 'react';

export interface AppState {
  enabled: boolean;
  saturation: number;
  brightness: number;
  playbackRate: number;
}

export interface Telemetry {
  saturation: number;
  brightness: number;
  flicker: number;
  motion: number;
  cutsPerMin: number;
  score: number;
  level: string;
  intervention: string;
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
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);

  const fetchTelemetry = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_TELEMETRY' }, (response) => {
          if (chrome.runtime.lastError) {
            return;
          }
          if (response && response.telemetry) {
            setTelemetry(response.telemetry);
          }
        });
      }
    });
  };

  useEffect(() => {
    chrome.storage.local.get(['appState'], (result) => {
      if (result.appState) {
        setState(result.appState);
      }
      setLoaded(true);
    });

    const messageListener = (message: any) => {
      if (message.type === 'TELEMETRY') {
        setTelemetry(message.payload);
      }
    };
    chrome.runtime.onMessage.addListener(messageListener);

    // Initial fetch telemetry when popup opens
    fetchTelemetry();

    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, []);

  const updateState = (updates: Partial<AppState>) => {
    const newState = { ...state, ...updates };
    setState(newState);
    chrome.storage.local.set({ appState: newState });
    
    // Attempt to message the active tab directly (storage sync handles fallback)
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'UPDATE_STATE',
          payload: newState
        }).catch(() => {
          // Ignore errors
        });
      }
    });
  };

  if (!loaded) return <div className="w-80 min-h-[250px] bg-slate-900 text-slate-100 p-6 font-sans">Loading...</div>;

  return (
    <div className="w-80 bg-slate-900 text-slate-100 p-6 flex flex-col font-sans">
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

      {/* Telemetry Dashboard */}
      <div className="bg-slate-800 rounded-xl p-4 space-y-3 mb-6 border border-slate-700 shadow-lg">
        <div className="flex justify-between items-end">
          <div>
            <div className="text-xs font-bold text-slate-400 tracking-wider mb-1">STIMULATION SCORE</div>
            <div className="text-3xl font-bold flex items-baseline gap-2">
              {telemetry?.score ?? 0} <span className="text-sm font-medium text-slate-400">/ 100</span>
            </div>
          </div>
          <div className={`text-xs font-bold px-2 py-1 rounded shadow-inner ${
            !telemetry ? 'bg-slate-700 text-slate-400' :
            telemetry.score > 80 ? 'bg-red-500/20 text-red-400' :
            telemetry.score > 60 ? 'bg-orange-500/20 text-orange-400' :
            telemetry.score > 30 ? 'bg-yellow-500/20 text-yellow-400' :
            'bg-emerald-500/20 text-emerald-400'
          }`}>
            {telemetry?.level || 'CALM'}
          </div>
        </div>

        <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden shadow-inner">
          <div
            className={`h-full transition-all duration-300 ${
              !telemetry ? 'bg-slate-600' :
              telemetry.score > 80 ? 'bg-red-500' :
              telemetry.score > 60 ? 'bg-orange-500' :
              telemetry.score > 30 ? 'bg-yellow-500' :
              'bg-emerald-500'
            }`}
            style={{ width: `${telemetry?.score ?? 0}%` }}
          ></div>
        </div>

        <div className="text-xs text-slate-400 pt-2 border-b border-slate-700 pb-3">
          Action: <span className="text-slate-200">{telemetry?.intervention || 'No intervention'}</span>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px] pt-1">
          <div className="flex justify-between">
            <span className="text-slate-400">Saturation</span>
            <span className="font-mono text-slate-300">{telemetry?.saturation ?? 0}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Brightness</span>
            <span className="font-mono text-slate-300">{telemetry?.brightness ?? 0}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Flicker</span>
            <span className="font-mono text-slate-300">{telemetry?.flicker ?? 0}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Cuts/min</span>
            <span className="font-mono text-slate-300">{telemetry?.cutsPerMin ?? 0}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Motion</span>
            <span className="font-mono text-slate-300">{telemetry?.motion ?? 0}</span>
          </div>
        </div>
      </div>

      <div className="text-xs font-bold text-slate-500 tracking-wider mb-4 px-1">MANUAL CONTROLS</div>

      <div className={`space-y-5 transition-opacity duration-300 ${!state.enabled ? 'opacity-40 pointer-events-none' : 'opacity-100'}`}>
        
        {/* Saturation */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label className="text-xs font-medium text-slate-300">Target Saturation</label>
            <span className="text-xs font-mono bg-slate-800 text-slate-300 px-2 py-0.5 rounded shadow-inner">{state.saturation}%</span>
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
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label className="text-xs font-medium text-slate-300">Target Brightness</label>
            <span className="text-xs font-mono bg-slate-800 text-slate-300 px-2 py-0.5 rounded shadow-inner">{state.brightness}%</span>
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
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label className="text-xs font-medium text-slate-300">Playback Speed</label>
            <span className="text-xs font-mono bg-slate-800 text-slate-300 px-2 py-0.5 rounded shadow-inner">{state.playbackRate.toFixed(2)}x</span>
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
