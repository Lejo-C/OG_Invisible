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

let currentState: AppState = { ...DEFAULT_STATE };
let videoElement: HTMLVideoElement | null = null;

function applySettings() {
  if (!videoElement) return;

  if (currentState.enabled) {
    videoElement.style.filter = `saturate(${currentState.saturation}%) brightness(${currentState.brightness}%)`;
    if (videoElement.playbackRate !== currentState.playbackRate) {
      videoElement.playbackRate = currentState.playbackRate;
    }
  } else {
    videoElement.style.filter = '';
    // Let playback rate return to 1.0 or user-chosen value when disabled
    if (videoElement.playbackRate !== 1.0) {
      videoElement.playbackRate = 1.0;
    }
  }
}

function findVideoElement() {
  const video = document.querySelector('video.html5-main-video') as HTMLVideoElement | null;
  if (video && video !== videoElement) {
    videoElement = video;
    
    // Add event listener to re-apply if YouTube changes playback rate
    videoElement.addEventListener('ratechange', () => {
      if (currentState.enabled && videoElement && videoElement.playbackRate !== currentState.playbackRate) {
        videoElement.playbackRate = currentState.playbackRate;
      }
    });
    
    // Re-apply when video loads new data
    videoElement.addEventListener('loadeddata', applySettings);
    
    applySettings();
  }
}

// Initial load
chrome.storage.local.get(['appState'], (result) => {
  if (result.appState) {
    currentState = result.appState as AppState;
  }
  findVideoElement();
});

// Listen for messages from popup for immediate updates
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'UPDATE_STATE') {
    currentState = message.payload;
    applySettings();
  }
});

// Periodic check to handle SPA navigation and element recreation robustly
setInterval(() => {
  findVideoElement();
  applySettings(); // Enforce settings continually to prevent YouTube overrides
}, 500);

console.log('[Stimulation Governor] Content script loaded and active.');
