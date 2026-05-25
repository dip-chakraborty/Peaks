// Background Service Worker for Peaks Equalizer

const DEFAULT_BANDS = [
  { type: "lowshelf", frequency: 30, Q: 0.707, gain: 0 },
  { type: "lowshelf", frequency: 60, Q: 0.707, gain: 0 },
  { type: "peaking", frequency: 120, Q: 1.0, gain: 0 },
  { type: "peaking", frequency: 250, Q: 1.0, gain: 0 },
  { type: "peaking", frequency: 500, Q: 1.0, gain: 0 },
  { type: "peaking", frequency: 1000, Q: 1.0, gain: 0 },
  { type: "peaking", frequency: 2000, Q: 1.0, gain: 0 },
  { type: "peaking", frequency: 4000, Q: 1.0, gain: 0 },
  { type: "peaking", frequency: 8000, Q: 1.0, gain: 0 },
  { type: "highshelf", frequency: 12000, Q: 0.707, gain: 0 },
  { type: "highshelf", frequency: 16000, Q: 0.707, gain: 0 }
];

const DEFAULT_SETTINGS = {
  enabled: false,
  bands: DEFAULT_BANDS,
  masterGain: 1.0,
  dials: {
    highpass: 20,
    lowpass: 20000,
    presence: 0,
    air: 0,
    brilliance: 0,
    width: 1.0,
    compressor: 0.0,
    limiter: -0.5,
    transient: 0.0,
    pan: 0.0,
    revdry: 1.0,
    revwet: 0.0
  }
};

// Initialize extension storage on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["eqSettings"], (result) => {
    if (!result.eqSettings) {
      chrome.storage.local.set({ eqSettings: DEFAULT_SETTINGS });
    }
  });
});
