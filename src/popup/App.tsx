import React, { useEffect, useState } from 'react';

export interface AppState {
  enabled: boolean;
  saturation: number;
  brightness: number;
  playbackRate: number;
  governorEnabled: boolean;
  audioEnabled: boolean;
}

export interface Telemetry {
  saturation: number;
  brightness: number;
  flicker: number;
  motion: number;
  cutsPerMin: number;
  audioScore: number;
  score: number;
  level: string;
  intervention: string;
  governorLevel: string;
  flashDetected: boolean;
  mlLabel?: string;
  mlProbability?: number;
  mlReady?: boolean;
  // Layer 3 shadow recommendation (preview-only)
  l3Level?: string;
  l3TargetSaturation?: number;
  l3TargetBrightness?: number;
  l3TargetPlaybackRate?: number;
  l3TargetScore?: number;
  l3ControlError?: number;
  l3Trend?: string;
  l3SpikeDetected?: boolean;
  l3RecoveryDetected?: boolean;
  l3EscalationCount?: number;
  l3DeescalationCount?: number;
  l3Reason?: string;
}

export interface ActionLogEntry {
  time: string;
  score: number;
  level: string;
}

const DEFAULT_STATE: AppState = {
  enabled: false,
  saturation: 100,
  brightness: 100,
  playbackRate: 1.0,
  governorEnabled: false,
  audioEnabled: false,
};

export const App: React.FC = () => {
  const [state, setState] = useState<AppState>(DEFAULT_STATE);
  const [loaded, setLoaded] = useState(false);
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [actionLog, setActionLog] = useState<ActionLogEntry[]>([]);

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
      } else if (message.type === 'ACTION_LOG') {
        setActionLog(message.payload);
      }
    };
    chrome.runtime.onMessage.addListener(messageListener);

    // Initial fetch telemetry when popup opens
    fetchTelemetry();

    // Initial fetch of existing action log
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_ACTION_LOG' }, (response) => {
          if (!chrome.runtime.lastError && response?.actionLog) {
            setActionLog(response.actionLog);
          }
        });
      }
    });

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
        <div className="flex items-center gap-3">
          <button 
            onClick={() => chrome.runtime.openOptionsPage()}
            className="text-slate-400 hover:text-white transition-colors"
            title="Parental Dashboard"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </button>
          <label className="relative inline-flex items-center cursor-pointer">
            <input 
              type="checkbox" 
              className="sr-only peer" 
              checked={state.enabled}
              onChange={(e) => updateState({ enabled: e.target.checked })}
            />
            <div className="w-10 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
          </label>
        </div>
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

      {/* Auto Governor — NEW additive block */}
      <div className="bg-slate-800/60 rounded-xl p-4 mb-4 border border-slate-700/60">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold text-slate-300 tracking-wider">AUTO GOVERNOR</span>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={state.governorEnabled}
              onChange={(e) => updateState({ governorEnabled: e.target.checked, audioEnabled: e.target.checked })}
            />
            <div className="w-10 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-violet-500"></div>
          </label>
        </div>
        <div className="flex justify-between items-center text-[11px]">
          <span className="text-slate-400">Governor Level</span>
          <span className={`font-mono font-bold ${
            !telemetry?.governorLevel || telemetry.governorLevel === 'none' ? 'text-emerald-400' :
            telemetry.governorLevel === 'mild' ? 'text-yellow-400' :
            telemetry.governorLevel === 'moderate' ? 'text-orange-400' :
            telemetry.governorLevel === 'strong' ? 'text-red-400' :
            'text-red-500'
          }`}>
            {telemetry?.governorLevel
              ? telemetry.governorLevel === 'veryStrong' ? 'Very Strong'
              : telemetry.governorLevel.charAt(0).toUpperCase() + telemetry.governorLevel.slice(1)
              : 'None'
            }
          </span>
        </div>
        {!state.governorEnabled && (
          <p className="text-[10px] text-slate-500 mt-2">Enable to allow automatic adjustments.</p>
        )}

        {/* Layer 3 Preview indicator */}
        <div className="space-y-1 mt-2 pt-2 border-t border-slate-700/40 text-[11px]">
          <div className="flex justify-between items-center">
            <span className="text-slate-500">L3 Preview</span>
            <span className={`font-mono font-bold ${
              !telemetry?.l3Level || telemetry.l3Level === 'none' ? 'text-slate-500' :
              telemetry.l3Level === 'mild' ? 'text-yellow-400' :
              telemetry.l3Level === 'moderate' ? 'text-orange-400' :
              telemetry.l3Level === 'strong' ? 'text-red-400' :
              'text-red-500'
            }`}>
              {telemetry?.l3Level
                ? telemetry.l3Level === 'veryStrong' ? 'VERY STRONG'
                : telemetry.l3Level === 'none' ? 'NONE'
                : telemetry.l3Level.toUpperCase()
                : 'NONE'
              }
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-500">Target / Error</span>
            <span className="font-mono text-slate-400">
              {telemetry?.l3TargetScore ?? 30} / <span className={telemetry?.l3ControlError != null && telemetry.l3ControlError > 0 ? 'text-orange-400' : 'text-emerald-400'}>{telemetry?.l3ControlError != null ? (telemetry.l3ControlError > 0 ? `+${telemetry.l3ControlError}` : telemetry.l3ControlError) : '—'}</span>
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-500">Trend</span>
            <span className={`font-mono ${
              telemetry?.l3Trend === 'rising' ? 'text-red-400' :
              telemetry?.l3Trend === 'falling' ? 'text-emerald-400' :
              'text-slate-400'
            }`}>
              {telemetry?.l3Trend === 'rising' ? '↑ Rising' : telemetry?.l3Trend === 'falling' ? '↓ Falling' : '→ Stable'}
              {telemetry?.l3SpikeDetected ? ' ⚡' : ''}
              {telemetry?.l3RecoveryDetected ? ' ✓' : ''}
            </span>
          </div>
        </div>
      </div>
      

      <div className="text-xs font-bold text-slate-500 tracking-wider mb-4 px-1">MANUAL CONTROLS</div>

      <div className={`space-y-5 transition-opacity duration-300 ${!state.enabled ? 'opacity-40 pointer-events-none' : 'opacity-100'}`}>
        
        {/* Saturation */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label className="text-xs font-medium text-slate-300">Target Saturation</label>
            <div className="flex items-center gap-1.5">
              {telemetry?.l3Level && telemetry.l3Level !== 'none' && (
                <span className="text-[10px] font-mono text-violet-400">{telemetry.l3TargetSaturation}%</span>
              )}
              <span className="text-xs font-mono bg-slate-800 text-slate-300 px-2 py-0.5 rounded shadow-inner">{state.saturation}%</span>
            </div>
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
            <div className="flex items-center gap-1.5">
              {telemetry?.l3Level && telemetry.l3Level !== 'none' && (
                <span className="text-[10px] font-mono text-violet-400">{telemetry.l3TargetBrightness}%</span>
              )}
              <span className="text-xs font-mono bg-slate-800 text-slate-300 px-2 py-0.5 rounded shadow-inner">{state.brightness}%</span>
            </div>
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
            <div className="flex items-center gap-1.5">
              {telemetry?.l3Level && telemetry.l3Level !== 'none' && (
                <span className="text-[10px] font-mono text-violet-400">{telemetry.l3TargetPlaybackRate?.toFixed(2)}x</span>
              )}
              <span className="text-xs font-mono bg-slate-800 text-slate-300 px-2 py-0.5 rounded shadow-inner">{state.playbackRate.toFixed(2)}x</span>
            </div>
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

      {/* Recent Actions — additive Layer 1 section */}
      {actionLog.length > 0 && (
        <div className="mt-5">
          <div className="text-xs font-bold text-slate-500 tracking-wider mb-2 px-1">RECENT ACTIONS</div>
          <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
            {[...actionLog].reverse().map((entry, i) => (
              <div key={i} className="flex justify-between items-center px-3 py-1.5 text-[10px] border-b border-slate-700/30 last:border-0">
                <span className="font-mono text-slate-500">{entry.time}</span>
                <span className="font-mono text-slate-300">Score {entry.score}</span>
                <span className={`font-mono font-bold ${
                  entry.level === 'None' ? 'text-emerald-400' :
                  entry.level === 'Mild' ? 'text-yellow-400' :
                  entry.level === 'Moderate' ? 'text-orange-400' :
                  entry.level === 'Strong' ? 'text-red-400' : 'text-red-500'
                }`}>{entry.level}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
