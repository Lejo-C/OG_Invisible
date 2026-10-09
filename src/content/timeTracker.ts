let lastTick = Date.now();
let accumulatedMs = 0;
let currentTitle = "";
let cachedTimeLimit = 60; // Default
let isBlocked = false;

export function initTimeTracker() {
    chrome.storage.local.get(['parentalStats', 'timeLimit'], (res) => {
        if (res.timeLimit !== undefined) {
            cachedTimeLimit = res.timeLimit;
        }
        if (res.parentalStats) {
            const d = new Date();
            const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const todayEntry = res.parentalStats.history.find((e: any) => e.date === today);
            if (todayEntry && todayEntry.minutes >= cachedTimeLimit) {
                isBlocked = true;
            }
        }
    });
}

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.timeLimit) {
        cachedTimeLimit = changes.timeLimit.newValue;
        // On next tick, the new limit will be evaluated
    }
});

export function isTimeLimitReached(): boolean {
    return isBlocked;
}

export function tickTimeTracker(isPlaying: boolean, title: string) {
    const now = Date.now();
    const delta = Math.min(now - lastTick, 1000); 
    lastTick = now;

    if (isPlaying && !isBlocked) {
        accumulatedMs += delta;
    }
    
    if (accumulatedMs > 5000 || (title !== currentTitle && title !== "")) {
        const msToSave = accumulatedMs;
        accumulatedMs = 0;
        currentTitle = title;
        
        chrome.storage.local.get(['parentalStats'], (res) => {
            const stats = res.parentalStats || { history: [], currentVideoTitle: '' };
            
            const d = new Date();
            const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            
            let todayEntry = stats.history.find((e: any) => e.date === today);
            if (!todayEntry) {
                todayEntry = { date: today, minutes: 0 };
                stats.history.push(todayEntry);
            }
            
            todayEntry.minutes += msToSave / 60000;
            
            if (todayEntry.minutes >= cachedTimeLimit) {
                isBlocked = true;
            } else {
                isBlocked = false;
            }
            
            if (stats.history.length > 7) {
                stats.history = stats.history.slice(-7);
            }
            stats.currentVideoTitle = title;
            
            chrome.storage.local.set({ parentalStats: stats });
        });
    }
}

