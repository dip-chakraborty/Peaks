# Peaks — Browser Audio Equalizer

A high-precision, 11-band audio equalizer and mastering suite that works across all websites — YouTube, Spotify Web, SoundCloud, Twitch, and anywhere else audio plays in your browser.

---

## What It Does

Peaks intercepts your browser's Web Audio engine and wraps every audio source in a full DSP processing chain — giving you studio-grade control over how everything sounds, in real time.

No page reloads. No account. No cloud. Just better sound.

---

## Features

### 11-Band Equalizer
Drag the vertical sliders to boost or cut any frequency band. Each band can also be switched to a different filter type by clicking the label above it.

| Band | Frequency | Default Type |
|------|-----------|--------------|
| 1 | 30 Hz | Low Shelf |
| 2 | 60 Hz | Low Shelf |
| 3 | 120 Hz | Peaking |
| 4 | 250 Hz | Peaking |
| 5 | 500 Hz | Peaking |
| 6 | 1 kHz | Peaking |
| 7 | 2 kHz | Peaking |
| 8 | 4 kHz | Peaking |
| 9 | 8 kHz | Peaking |
| 10 | 12 kHz | High Shelf |
| 11 | 16 kHz | High Shelf |

Available filter types: `Peaking`, `Low Shelf`, `High Shelf`, `Low Pass`, `High Pass`, `Band Pass`

### Solo Bands
Click the **S** button on any band to isolate it. You can solo multiple bands at once. Soloed bands pulse red so you always know what's active.

### EQ & Filter Dials
| Dial | What It Does |
|------|-------------|
| High Pass | Cuts everything below the set frequency |
| Low Pass | Cuts everything above the set frequency |
| Presence | Boosts/cuts the 3.2 kHz vocal clarity region |
| Air | Boosts/cuts the 12 kHz high shelf — adds "air" and openness |
| Brilliance | Boosts/cuts the 8 kHz presence peak — adds sparkle |

### Dynamics Dials
| Dial | What It Does |
|------|-------------|
| Preamp | Volume multiplier before the EQ chain (0× mute → 2× loud) |
| Compressor | Threshold-based dynamic compression — glues the mix |
| Limiter | Brickwall ceiling — prevents any distortion or clipping |
| Transient | Positive = **Punch** (snappy, forward hits) · Negative = **Soft** (smooth, rounded) |

### Space & Pan Dials
| Dial | What It Does |
|------|-------------|
| Width | Stereo width via Mid-Side matrix (0% = Mono → 200% = Super Wide) |
| Pan | Left/Right stereo panning |
| Reverb Dry | Level of the original (direct) signal |
| Reverb Wet | Level of the synthetic room reverb tail |

### Real-Time Visualizer
The frequency response curve updates live while audio plays, showing you the combined shape of all your EQ adjustments on top of the band sliders.

### Preset System
- **9 built-in presets** — Flat, Bass Booster, Bass Reducer, Vocal Booster, Treble Booster, Acoustic, Electronic, Rock, Classical
- **Custom presets** — Save your own with any name. If the name already exists, you'll be asked if you want to overwrite it
- **Delete** any custom preset with the trash icon (only visible when a custom preset is active)

---

## DSP Signal Chain

Audio flows through this chain in order:

```
Source Audio
    │
    ▼
11-Band EQ Filters (BiquadFilterNode × 11)
    │
    ▼
Dial Filters — High Pass · Low Pass · Presence · Air · Brilliance
    │
    ▼
Multi-Solo Router (parallel bandpass isolation)
    │
    ▼
Transient Shaper (DynamicsCompressorNode — attack/sustain control)
    │
    ▼
Compressor (DynamicsCompressorNode — glue compression)
    │
    ▼
Mid-Side Stereo Widener (ChannelSplitter/Merger matrix)
    │
    ▼
Stereo Panner (StereoPannerNode)
    │
    ▼
Reverb (ConvolverNode — synthetic studio room, parallel dry/wet)
    │
    ▼
Brickwall Limiter (DynamicsCompressorNode — 20:1 ratio, hard knee)
    │
    ▼
Analyser (AnalyserNode — feeds real-time visualizer)
    │
    ▼
Output
```

---

## Browser Compatibility

| Browser | Support |
|---------|---------|
| Google Chrome | ✅ Full |
| Microsoft Edge | ✅ Full |
| Firefox | ✅ Full (via `chrome.*` compatibility shim) |
| Opera | ✅ Full (Chromium-based) |
| Brave | ✅ Full (Chromium-based) |

---

## Installation (Manual / Developer Mode)

1. Download or clone this repository
2. Open your browser's extensions page:
   - **Chrome / Edge / Opera / Brave** → `chrome://extensions`
   - **Firefox** → `about:debugging` → This Firefox → Load Temporary Add-on
3. Enable **Developer Mode** (toggle in the top-right corner)
4. Click **Load unpacked** and select the `Peaks` folder
5. The Peaks icon will appear in your browser toolbar

---

## Project Structure

```
Peaks/
├── manifest.json          ← Extension manifest (Manifest V3)
│
├── popup/
│   ├── popup.html         ← Extension popup UI
│   ├── popup.css          ← Styles (dark glassmorphic theme)
│   └── popup.js           ← Popup controller — UI, presets, visualizer
│
├── scripts/
│   ├── content-main.js    ← Main-world audio DSP engine (hooks Web Audio API)
│   ├── content-bridge.js  ← Isolated-world bridge (relays messages to main world)
│   ├── background.js      ← Service worker (loads settings, relays to content scripts)
│   └── content.js         ← Lightweight content entry point
│
├── icons/
│   ├── icon-16.png        ← Toolbar icon
│   ├── icon-48.png        ← Extensions page icon
│   ├── icon-128.png       ← Store / install icon
│   └── peaks_source.png   ← Master source icon (high-res)
│
└── developer/
    └── generator.html     ← Tool to rasterize icons from source PNG
```

---

## How It Intercepts Audio

Peaks runs in the **MAIN world** of the page (same JavaScript context as the website). It monkey-patches `AudioContext` and `AudioNode.prototype.connect` so that any audio node trying to connect to the speakers is silently rerouted through the EQ chain first. The website never knows anything changed.

It also scans for `<video>` and `<audio>` elements (including those inside Shadow DOMs) and wraps them using `createMediaElementSource`.

---

## Data & Privacy

- All settings are stored locally using `chrome.storage.local` — nothing is ever sent anywhere
- No analytics, no tracking, no accounts
- The extension requests only two permissions: `storage` (to save your EQ settings) and `tabs` (to broadcast settings changes across open tabs)

---

## Tips

- **Double-click** any slider or dial to reset it to its default value
- The **master switch** (top-right power button) enables/disables the entire DSP chain cleanly — all controls grey out when it's off
- For the best results on music, start with a preset, then fine-tune the EQ bands from there

---

## Screenshot 1 - Off State

<img width="675" height="581" alt="Screenshot 2026-05-24 203524" src="https://github.com/user-attachments/assets/772cfd9c-7085-4e5f-8644-563a6cdfa25b" />

## Screenshot 2 - On State (Nothing Playing)

<img width="675" height="581" alt="Screenshot 2026-05-24 203557" src="https://github.com/user-attachments/assets/70fb58f1-9e6f-4a90-9138-889127e8ed00" />

## Screenshot 3 - On State (Playing)

<img width="675" height="581" alt="Screenshot 2026-05-24 203638" src="https://github.com/user-attachments/assets/6a18d837-0d18-4dc9-8263-4277b5c48f00" />

---

*vibed by — [github.com/dip-chakraborty](https://github.com/dip-chakraborty)*
