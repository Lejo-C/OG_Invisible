let audioCtx: AudioContext | null = null;
let sourceNode: MediaElementAudioSourceNode | null = null;
let compressor: DynamicsCompressorNode | null = null;
let analyser: AnalyserNode | null = null;
let isInitialized = false;

export function initAudio(video: HTMLVideoElement) {
    if (isInitialized) return;
    try {
        audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        sourceNode = audioCtx.createMediaElementSource(video);
        
        compressor = audioCtx.createDynamicsCompressor();
        // Configure for aggressive peak limiting (safety limiter)
        compressor.threshold.value = -15; // dB (only kicks in on loud spikes)
        compressor.knee.value = 5;        // Harder knee
        compressor.ratio.value = 15;      // High compression ratio for clamping
        compressor.attack.value = 0.002;  // 2ms fast attack
        compressor.release.value = 0.1;   // 100ms fast release

        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;

        // Default route (pass-through)
        sourceNode.connect(analyser);
        analyser.connect(audioCtx.destination);
        
        // Resume context automatically on video playback if suspended
        video.addEventListener('playing', () => {
            if (audioCtx && audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
        });

        isInitialized = true;
    } catch (e) {
        console.warn("[Stimulation Governor] Audio processor init failed:", e);
    }
}

export function setAudioEnabled(enabled: boolean) {
    if (!isInitialized || !audioCtx || !sourceNode || !compressor || !analyser) return;
    
    try { analyser.disconnect(); } catch (e) {}
    try { compressor.disconnect(); } catch (e) {}
    
    if (enabled) {
        analyser.connect(compressor);
        compressor.connect(audioCtx.destination);
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    } else {
        analyser.connect(audioCtx.destination);
    }
}

export function getAudioLoudness(): number {
    if (!isInitialized || !analyser) return 0;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(dataArray);
    
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
        const val = (dataArray[i] - 128) / 128;
        sum += val * val;
    }
    const rms = Math.sqrt(sum / dataArray.length);
    // Multiply by 300 to map RMS to a roughly 0-100 scale (max sine wave RMS is ~0.707)
    return Math.min(100, Math.round(rms * 300));
}
