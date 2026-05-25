// Peaks - Extension Popup Controller

document.addEventListener("DOMContentLoaded", () => {
  // --- State Variables ---
  // Default frequencies and types for the 11 bands
  const DEFAULT_BANDS = [
    { type: "lowshelf",  frequency: 30,    Q: 0.707, gain: 0, name: "30Hz"  }, // Butterworth shelf
    { type: "lowshelf",  frequency: 60,    Q: 0.707, gain: 0, name: "60Hz"  }, // Butterworth shelf
    { type: "peaking",   frequency: 120,   Q: 0.80,  gain: 0, name: "120Hz" }, // Wide — warm upper-bass
    { type: "peaking",   frequency: 250,   Q: 0.90,  gain: 0, name: "250Hz" }, // Slightly wide — warmth
    { type: "peaking",   frequency: 500,   Q: 1.00,  gain: 0, name: "500Hz" }, // Standard — low-mid
    { type: "peaking",   frequency: 1000,  Q: 1.00,  gain: 0, name: "1kHz"  }, // Standard — critical mid
    { type: "peaking",   frequency: 2000,  Q: 1.10,  gain: 0, name: "2kHz"  }, // Slightly tight — upper-mid
    { type: "peaking",   frequency: 4000,  Q: 1.20,  gain: 0, name: "4kHz"  }, // Tighter — presence
    { type: "peaking",   frequency: 8000,  Q: 1.50,  gain: 0, name: "8kHz"  }, // Tight — clean highs
    { type: "highshelf", frequency: 12000, Q: 0.707, gain: 0, name: "12kHz" }, // Butterworth shelf
    { type: "highshelf", frequency: 16000, Q: 0.707, gain: 0, name: "16kHz" }  // Butterworth shelf
  ];

  // --- State Variables ---
  let eqSettings = {
    enabled: false,
    bands: JSON.parse(JSON.stringify(DEFAULT_BANDS)),
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
  
  let activeSoloIndexes = []; // Array of currently soloed band indexes
  let customPresets = [];      // Array of saved custom presets
  let activeMatchedPresetValue = "flat"; // Currently active matched preset
  let activeDialTab = "tone";  // Currently active dial subgroup tab

  // --- Real-Time Audio Communication State ---
  let port = null;
  let liveFreqData = new Array(128).fill(0); // 128 bins for high-fidelity spectrum

  // --- Visualizer Animation Engine ---
  let animTime = 0;
  let isAudioPlaying = false;
  let audioDetectThrottle = 0;

  // --- Element Cache ---
  const masterToggle = document.getElementById("master-toggle");
  const powerStatusText = document.getElementById("power-status-text");
  const slidersRow = document.getElementById("sliders-row");
  const dialsRow = document.getElementById("dials-row");
  const resetBtn = document.getElementById("reset-btn");
  const canvas = document.getElementById("response-curve");
  const ctx = canvas.getContext("2d");

  // Custom Dropdown Menu Cache
  const dropdownTrigger = document.getElementById("dropdown-trigger");
  const dropdownMenu = document.getElementById("dropdown-menu");
  const selectedPresetName = document.getElementById("selected-preset-name");

  // Custom Preset Modal Cache
  const savePresetBtn      = document.getElementById("save-preset-btn");
  const deletePresetBtn    = document.getElementById("delete-preset-btn");
  const savePresetModal    = document.getElementById("save-preset-modal");
  const presetNameInput    = document.getElementById("preset-name-input");
  const cancelSaveBtn      = document.getElementById("cancel-save-btn");
  const confirmSaveBtn     = document.getElementById("confirm-save-btn");

  // Overwrite Confirmation Modal Cache
  const overwriteModal     = document.getElementById("overwrite-modal");
  const overwriteNameLabel = document.getElementById("overwrite-name-label");
  const overwriteYesBtn    = document.getElementById("overwrite-yes-btn");
  const overwriteNoBtn     = document.getElementById("overwrite-no-btn");

  // Pending overwrite state
  let pendingPresetName    = "";
  let pendingOverwriteIdx  = -1;

  // --- Presets Definition ---
  const PRESETS = {
    flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    "bass-boost": [0, 9, 7, 4, 1, 0, 0, 0, 0, 0, 0],
    "bass-reducer": [0, -9, -7, -3, 0, 0, 0, 0, 0, 0, 0],
    "vocal-boost": [3, -3, -1, 2, 5, 6, 5, 3, 1, 0, 0],
    "treble-boost": [0, 0, 0, 0, 0, 2, 4, 7, 9, 10, 0],
    acoustic: [0, 5, 4, 1, 2, 3, 4, 5, 6, 4, 0],
    electronic: [0, 8, 5, 0, -2, 0, 2, 4, 6, 7, 0],
    rock: [0, 6, 4, -2, -3, 1, 3, 5, 6, 5, 0],
    classical: [0, 5, 3, 2, 1, -1, -1, 2, 4, 5, 0]
  };

  // 13 Dial Configuration Objects grouped by tab
  const DIAL_CONFIGS = [
    // Tone & Filter tab
    {
      id: "highpass",
      name: "High Pass",
      tab: "tone",
      min: 20,
      max: 800,
      step: 5,
      defaultVal: 20,
      getValueText: (val) => val === 20 ? "Off" : `${Math.round(val)}Hz`,
      scale: "log"
    },
    {
      id: "lowpass",
      name: "Low Pass",
      tab: "tone",
      min: 2000,
      max: 20000,
      step: 50,
      defaultVal: 20000,
      getValueText: (val) => val === 20000 ? "Off" : (val >= 1000 ? `${(val/1000).toFixed(1)}kHz` : `${Math.round(val)}Hz`),
      scale: "log"
    },
    {
      id: "presence",
      name: "Presence",
      tab: "tone",
      min: -12,
      max: 12,
      step: 0.2,
      defaultVal: 0,
      getValueText: (val) => `${val > 0 ? "+" : ""}${val.toFixed(1)}dB`,
      scale: "linear"
    },
    {
      id: "air",
      name: "Air",
      tab: "tone",
      min: -12,
      max: 12,
      step: 0.2,
      defaultVal: 0,
      getValueText: (val) => `${val > 0 ? "+" : ""}${val.toFixed(1)}dB`,
      scale: "linear"
    },
    {
      id: "brilliance",
      name: "Brilliance",
      tab: "tone",
      min: -12,
      max: 12,
      step: 0.2,
      defaultVal: 0,
      getValueText: (val) => `${val > 0 ? "+" : ""}${val.toFixed(1)}dB`,
      scale: "linear"
    },
    
    // Dynamics tab
    {
      id: "preamp",
      name: "Preamp",
      tab: "dynamics",
      min: 0.0,
      max: 2.0,
      step: 0.05,
      defaultVal: 1.0,
      getValueText: (val) => {
        const db = val > 0 ? 20 * Math.log10(val) : -80;
        return val === 0 ? "Muted" : `${val.toFixed(2)}x (${db > 0 ? "+" : ""}${db.toFixed(1)}dB)`;
      },
      scale: "linear"
    },
    {
      id: "compressor",
      name: "Compressor",
      tab: "dynamics",
      min: -40.0,
      max: 0.0,
      step: 1.0,
      defaultVal: 0.0,
      getValueText: (val) => val === 0.0 ? "Off" : `${Math.round(val)}dB`,
      scale: "linear"
    },
    {
      id: "limiter",
      name: "Limiter",
      tab: "dynamics",
      min: -12.0,
      max: 0.0,
      step: 0.2,
      defaultVal: -0.5,
      getValueText: (val) => val === 0.0 ? "Off" : `${val.toFixed(1)}dB`,
      scale: "linear"
    },
    {
      id: "transient",
      name: "Transient",
      tab: "dynamics",
      min: -10.0,
      max: 10.0,
      step: 0.5,
      defaultVal: 0.0,
      getValueText: (val) => {
        if (val === 0.0) return "Neutral";
        return val > 0 ? `+${val.toFixed(1)} (Punch)` : `${val.toFixed(1)} (Soft)`;
      },
      scale: "linear"
    },
    
    // Space & Pan tab
    {
      id: "width",
      name: "Width",
      tab: "spatial",
      min: 0.0,
      max: 2.0,
      step: 0.05,
      defaultVal: 1.0,
      getValueText: (val) => {
        if (val === 1.0) return "100% (Std)";
        if (val === 0.0) return "Mono";
        return `${Math.round(val * 100)}%`;
      },
      scale: "linear"
    },
    {
      id: "pan",
      name: "Pan",
      tab: "spatial",
      min: -1.0,
      max: 1.0,
      step: 0.05,
      defaultVal: 0.0,
      getValueText: (val) => {
        if (val === 0.0) return "Center";
        return val > 0 ? `R ${Math.round(val * 100)}` : `L ${Math.round(Math.abs(val) * 100)}`;
      },
      scale: "linear"
    },
    {
      id: "revdry",
      name: "Reverb Dry",
      tab: "spatial",
      min: 0.0,
      max: 1.0,
      step: 0.05,
      defaultVal: 1.0,
      getValueText: (val) => `${Math.round(val * 100)}%`,
      scale: "linear"
    },
    {
      id: "revwet",
      name: "Reverb Wet",
      tab: "spatial",
      min: 0.0,
      max: 1.0,
      step: 0.05,
      defaultVal: 0.0,
      getValueText: (val) => val === 0.0 ? "Dry" : `${Math.round(val * 100)}%`,
      scale: "linear"
    }
  ];

  // List of available filter types for rotation
  const FILTER_TYPES = ["peaking", "lowshelf", "highshelf", "lowpass", "highpass", "bandpass"];

  // Helper for dial mapping
  function valueToPct(val, config) {
    if (config.scale === "log") {
      return (Math.log10(val / config.min)) / (Math.log10(config.max / config.min));
    }
    return (val - config.min) / (config.max - config.min);
  }

  function pctToValue(pct, config) {
    pct = Math.max(0, Math.min(1, pct));
    let val;
    if (config.scale === "log") {
      val = config.min * Math.pow(config.max / config.min, pct);
    } else {
      val = config.min + pct * (config.max - config.min);
    }
    return Math.round(val / config.step) * config.step;
  }

  // --- Core Methods ---

  // Load state from local storage and render
  function init() {
    try {
      chrome.storage.local.get(["eqSettings", "soloBandIndexes", "customPresets"], (result) => {
        try {
          if (result.customPresets) {
            customPresets = result.customPresets;
          }

          if (result.eqSettings && result.eqSettings.bands && result.eqSettings.bands.length === 11) {
            eqSettings = result.eqSettings;
            activeSoloIndexes = result.soloBandIndexes || [];
          } else {
            // Re-initialize slider bands using current shelves and peaking defaults
            eqSettings.bands = JSON.parse(JSON.stringify(DEFAULT_BANDS));
          }
          
          if (!eqSettings.dials) {
            eqSettings.dials = {};
          }
          // Robustly ensure all dial configs have default values if missing in loaded storage
          DIAL_CONFIGS.forEach(config => {
            if (config.id !== "preamp" && eqSettings.dials[config.id] === undefined) {
              eqSettings.dials[config.id] = config.defaultVal;
            }
          });
          if (eqSettings.masterGain === undefined) {
            eqSettings.masterGain = 1.0;
          }

          // Enforce clean frequency band labels and default mappings
          eqSettings.bands.forEach((band, idx) => {
            band.name = DEFAULT_BANDS[idx].name;
            band.defaultFrequency = DEFAULT_BANDS[idx].frequency;
          });

          renderUI();
          renderDials();
          drawFrequencyResponse();
        } catch (innerErr) {
          console.error("Popup storage callback error:", innerErr);
          renderUI();
          renderDials();
          drawFrequencyResponse();
        }
      });
    } catch (e) {
      console.error("Popup storage access error:", e);
      renderUI();
      renderDials();
      drawFrequencyResponse();
    }
  }

  // Save current settings to chrome storage & sync with active tabs
  function saveAndSync() {
    chrome.storage.local.set({ 
      eqSettings: eqSettings,
      soloBandIndexes: activeSoloIndexes
    }, () => {
      // Broadcast settings change to content scripts in all tabs
      try {
        chrome.tabs.query({}, (tabs) => {
          if (tabs) {
            tabs.forEach((tab) => {
              if (tab.url && !tab.url.startsWith("chrome://") && !tab.url.startsWith("about:") && !tab.url.startsWith("moz-extension://")) {
                chrome.tabs.sendMessage(tab.id, {
                  type: "POPUP_STATE_CHANGED",
                  settings: eqSettings,
                  soloIndexes: activeSoloIndexes
                }).catch(() => {
                  // Ignore errors for uninitialized content scripts
                });
              }
            });
          }
        });
      } catch (err) {
        console.warn("[Peaks] Tab broadcast failed gracefully:", err);
      }
      
      drawFrequencyResponse();
      updatePresetSelector(); // Dynamically update preset trigger text on manual tweaks
    });
  }

  // --- UI Rendering ---

  // --- Disable / Enable all controls based on master switch state ---
  function applyDisabledState() {
    const isOn = eqSettings.enabled;

    // Static controls
    resetBtn.disabled = !isOn;
    dropdownTrigger.disabled = !isOn;
    savePresetBtn.disabled = !isOn;
    document.querySelectorAll(".dial-tab-btn").forEach(b => b.disabled = !isOn);

    // Delete preset btn (only relevant when visible)
    if (!deletePresetBtn.classList.contains("hidden")) {
      deletePresetBtn.disabled = !isOn;
    }

    // Dynamically created sliders, type buttons, solo buttons
    document.querySelectorAll(".band-control input[type='range']").forEach(el => el.disabled = !isOn);
    document.querySelectorAll(".band-type-btn").forEach(el => el.disabled = !isOn);
    document.querySelectorAll(".band-solo-btn").forEach(el => el.disabled = !isOn);

    // Dial knobs: block pointer events via class
    document.querySelectorAll(".dial-knob").forEach(el => {
      if (isOn) {
        el.classList.remove("dial-disabled");
      } else {
        el.classList.add("dial-disabled");
      }
    });

    // Visual dimming on the main interactive areas
    const dimTargets = [
      document.querySelector(".visualizer-container"),
      document.querySelector(".dials-section"),
      resetBtn
    ];
    dimTargets.forEach(el => {
      if (!el) return;
      if (isOn) {
        el.classList.remove("ui-disabled");
      } else {
        el.classList.add("ui-disabled");
      }
    });

    // Header controls: dim preset dropdown and save/delete btns only — NOT the power button
    const presetDropdown = document.getElementById("preset-dropdown");
    if (presetDropdown) {
      if (isOn) {
        presetDropdown.classList.remove("header-disabled");
      } else {
        presetDropdown.classList.add("header-disabled");
      }
    }
    if (isOn) {
      savePresetBtn.classList.remove("header-disabled");
      deletePresetBtn.classList.remove("header-disabled");
    } else {
      savePresetBtn.classList.add("header-disabled");
      deletePresetBtn.classList.add("header-disabled");
    }
  }

  function renderUI() {
    // 1. Power Button State
    if (eqSettings.enabled) {
      document.body.classList.add("eq-active");
      powerStatusText.textContent = "ON";
    } else {
      document.body.classList.remove("eq-active");
      powerStatusText.textContent = "OFF";
    }

    // 2. Preset Dropdown Selection
    updatePresetSelector();

    // 3. Render Sliders Row
    slidersRow.innerHTML = "";
    eqSettings.bands.forEach((band, idx) => {
      const isSoloed = activeSoloIndexes.includes(idx);
      const isFittedFreq = (band.type === "lowpass" || band.type === "highpass" || band.type === "bandpass");
      
      let valueText = "";
      if (isFittedFreq) {
        const freq = mapSliderToFrequency(idx, band.gain, band.defaultFrequency);
        valueText = freq >= 1000 ? `${(freq / 1000).toFixed(1)}kHz` : `${Math.round(freq)}Hz`;
      } else {
        const sign = band.gain > 0 ? "+" : "";
        valueText = `${sign}${band.gain.toFixed(1)}dB`;
      }

      // Create Slider Element (Frequencies displayed at the top, e.g. 30Hz instead of Sub-Cut)
      const bandDiv = document.createElement("div");
      bandDiv.className = `band-control${isSoloed ? " soloed" : ""}`;

      const bandFreqSpan = document.createElement("span");
      bandFreqSpan.className = "band-freq";
      bandFreqSpan.textContent = band.name;

      const bandTypeBtn = document.createElement("button");
      bandTypeBtn.className = "band-type-btn";
      bandTypeBtn.title = "Click to change filter type";
      bandTypeBtn.textContent = getFilterIconChar(band.type);

      const sliderContainer = document.createElement("div");
      sliderContainer.className = "slider-container";

      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "-20";
      slider.max = "20";
      slider.step = "0.5";
      slider.value = band.gain;
      slider.title = "Drag to adjust";
      sliderContainer.appendChild(slider);

      const bandValueSpan = document.createElement("span");
      bandValueSpan.className = "band-value";
      bandValueSpan.textContent = valueText;

      const bandSoloBtn = document.createElement("button");
      bandSoloBtn.className = `band-solo-btn${isSoloed ? " active" : ""}`;
      bandSoloBtn.title = "Toggle Solo Band";
      bandSoloBtn.textContent = "S";

      bandDiv.appendChild(bandFreqSpan);
      bandDiv.appendChild(bandTypeBtn);
      bandDiv.appendChild(sliderContainer);
      bandDiv.appendChild(bandValueSpan);
      bandDiv.appendChild(bandSoloBtn);

      slider.addEventListener("input", (e) => {
        const val = parseFloat(e.target.value);
        band.gain = val;
        
        bandDiv.classList.add("active-adjust");
        
        let liveValText = "";
        if (isFittedFreq) {
          const freq = mapSliderToFrequency(idx, val, band.defaultFrequency);
          liveValText = freq >= 1000 ? `${(freq / 1000).toFixed(1)}kHz` : `${Math.round(freq)}Hz`;
        } else {
          const sign = val > 0 ? "+" : "";
          liveValText = `${sign}${val.toFixed(1)}dB`;
        }
        bandValueSpan.textContent = liveValText;

        saveAndSync();
      });

      slider.addEventListener("change", () => {
        bandDiv.classList.remove("active-adjust");
      });

      // Double-click to reset slider to 0
      slider.addEventListener("dblclick", () => {
        band.gain = 0;
        slider.value = 0;
        
        let resetValText = "";
        if (isFittedFreq) {
          const freq = band.defaultFrequency;
          resetValText = freq >= 1000 ? `${(freq / 1000).toFixed(1)}kHz` : `${Math.round(freq)}Hz`;
        } else {
          resetValText = "0.0dB";
        }
        bandValueSpan.textContent = resetValText;
        
        saveAndSync();
      });

      // Filter Type Rotation Button (HPF/LPF are renamed)
      bandTypeBtn.addEventListener("click", () => {
        let currentTypeIdx = FILTER_TYPES.indexOf(band.type);
        let nextTypeIdx = (currentTypeIdx + 1) % FILTER_TYPES.length;
        band.type = FILTER_TYPES[nextTypeIdx];
        
        saveAndSync();
        renderUI();
      });

      // Multi-Solo Button Action
      bandSoloBtn.addEventListener("click", () => {
        if (activeSoloIndexes.includes(idx)) {
          activeSoloIndexes = activeSoloIndexes.filter(i => i !== idx);
        } else {
          activeSoloIndexes.push(idx);
        }
        saveAndSync();
        renderUI();
      });

      slidersRow.appendChild(bandDiv);
    });

    // Apply disabled state after sliders are rendered
    applyDisabledState();
  }

  // Render Rotary Dials Row (Filtered by Active Tab)
  function renderDials() {
    dialsRow.innerHTML = "";

    const activeConfigs = DIAL_CONFIGS.filter(config => config.tab === activeDialTab);

    activeConfigs.forEach((config) => {
      let val = config.id === "preamp" ? eqSettings.masterGain : eqSettings.dials[config.id];
      const pct = valueToPct(val, config);
      const angle = -135 + pct * 270;
      const strokeDashoffset = 75.4 - pct * 75.4;

      const dialDiv = document.createElement("div");
      dialDiv.className = "dial-control";

      const dialLabelSpan = document.createElement("span");
      dialLabelSpan.className = "dial-label";
      dialLabelSpan.textContent = config.name;

      const dialWrapperDiv = document.createElement("div");
      dialWrapperDiv.className = "dial-wrapper";

      const dialKnobDiv = document.createElement("div");
      dialKnobDiv.className = "dial-knob";
      dialKnobDiv.dataset.id = config.id;

      const dialMarkerDiv = document.createElement("div");
      dialMarkerDiv.className = "dial-marker";
      dialMarkerDiv.style.transform = `rotate(${angle}deg)`;
      dialKnobDiv.appendChild(dialMarkerDiv);

      const svgNamespace = "http://www.w3.org/2000/svg";
      const dialSvg = document.createElementNS(svgNamespace, "svg");
      dialSvg.setAttribute("class", "dial-svg");
      dialSvg.setAttribute("viewBox", "0 0 40 40");

      const dialTrackCircle = document.createElementNS(svgNamespace, "circle");
      dialTrackCircle.setAttribute("class", "dial-track");
      dialTrackCircle.setAttribute("cx", "20");
      dialTrackCircle.setAttribute("cy", "20");
      dialTrackCircle.setAttribute("r", "16");

      const dialFillCircle = document.createElementNS(svgNamespace, "circle");
      dialFillCircle.setAttribute("class", "dial-fill");
      dialFillCircle.style.strokeDashoffset = `${strokeDashoffset}px`;
      dialFillCircle.setAttribute("cx", "20");
      dialFillCircle.setAttribute("cy", "20");
      dialFillCircle.setAttribute("r", "16");

      dialSvg.appendChild(dialTrackCircle);
      dialSvg.appendChild(dialFillCircle);

      dialWrapperDiv.appendChild(dialKnobDiv);
      dialWrapperDiv.appendChild(dialSvg);

      const dialValueSpan = document.createElement("span");
      dialValueSpan.className = "dial-value";
      dialValueSpan.textContent = config.getValueText(val);

      dialDiv.appendChild(dialLabelSpan);
      dialDiv.appendChild(dialWrapperDiv);
      dialDiv.appendChild(dialValueSpan);

      const knob = dialKnobDiv;
      
      let startY = 0;
      let startPct = 0;
      const sensitivity = 0.007;

      const handlePointerMove = (e) => {
        const deltaY = startY - e.clientY;
        const newPct = Math.max(0, Math.min(1, startPct + deltaY * sensitivity));
        const newVal = pctToValue(newPct, config);

        if (config.id === "preamp") {
          eqSettings.masterGain = newVal;
        } else {
          eqSettings.dials[config.id] = newVal;
        }

        dialDiv.classList.add("active-adjust");
        const activeAngle = -135 + newPct * 270;
        dialMarkerDiv.style.transform = `rotate(${activeAngle}deg)`;
        dialFillCircle.style.strokeDashoffset = `${75.4 - newPct * 75.4}px`;
        dialValueSpan.textContent = config.getValueText(newVal);

        saveAndSync();
      };

      const handlePointerUp = () => {
        dialDiv.classList.remove("active-adjust");
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };

      knob.addEventListener("pointerdown", (e) => {
        startY = e.clientY;
        let currentVal = config.id === "preamp" ? eqSettings.masterGain : eqSettings.dials[config.id];
        startPct = valueToPct(currentVal, config);
        
        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
      });

      knob.addEventListener("dblclick", () => {
        const defaultVal = config.defaultVal;
        if (config.id === "preamp") {
          eqSettings.masterGain = defaultVal;
        } else {
          eqSettings.dials[config.id] = defaultVal;
        }

        const resetPct = valueToPct(defaultVal, config);
        const resetAngle = -135 + resetPct * 270;

        dialMarkerDiv.style.transform = `rotate(${resetAngle}deg)`;
        dialFillCircle.style.strokeDashoffset = `${75.4 - resetPct * 75.4}px`;
        dialValueSpan.textContent = config.getValueText(defaultVal);

        saveAndSync();
      });

      dialsRow.appendChild(dialDiv);
    });

    // Re-apply disabled state for newly rendered dial knobs
    applyDisabledState();
  }

  // Return representation of filter type
  function getFilterIconChar(type) {
    switch(type) {
      case "highpass": return "HPF";
      case "lowpass": return "LPF";
      case "lowshelf": return "LS";
      case "highshelf": return "HS";
      case "bandpass": return "BP";
      default: return "PK";
    }
  }

  function mapSliderToFrequency(bandIndex, sliderVal, defaultFreq) {
    const octaveShift = (sliderVal / 20) * 2;
    return defaultFreq * Math.pow(2, octaveShift);
  }

  // Update custom preset selector dropdown dynamically, populating standard & custom options in custom menu
  function updatePresetSelector() {
    dropdownMenu.innerHTML = "";

    // 1. Built-in presets group
    const builtInHeader = document.createElement("div");
    builtInHeader.className = "dropdown-group-header";
    builtInHeader.textContent = "Standard Presets";
    dropdownMenu.appendChild(builtInHeader);
    
    const standardPresets = [
      { value: "custom", label: "Custom" },
      { value: "flat", label: "Flat (Default)" },
      { value: "bass-boost", label: "Bass Booster" },
      { value: "bass-reducer", label: "Bass Reducer" },
      { value: "vocal-boost", label: "Vocal Booster" },
      { value: "treble-boost", label: "Treble Booster" },
      { value: "acoustic", label: "Acoustic" },
      { value: "electronic", label: "Electronic" },
      { value: "rock", label: "Rock" },
      { value: "classical", label: "Classical" }
    ];

    let matchedPreset = "custom";
    let matchedLabel = "Custom";
    
    // Check standard presets
    for (const [presetName, gains] of Object.entries(PRESETS)) {
      let match = true;
      for (let i = 0; i < 11; i++) {
        if (Math.abs(eqSettings.bands[i].gain - gains[i]) > 0.1 || eqSettings.bands[i].type !== DEFAULT_BANDS[i].type) {
          match = false;
          break;
        }
      }
      if (match) {
        const dialsDefault = { 
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
        };
        const dialsObj = eqSettings.dials || {};
        for (const [k, v] of Object.entries(dialsDefault)) {
          const curVal = dialsObj[k] !== undefined ? dialsObj[k] : v;
          if (Math.abs(curVal - v) > 0.1) {
            match = false;
            break;
          }
        }
      }
      if (match) {
        matchedPreset = presetName;
        const matchedItem = standardPresets.find(p => p.value === presetName);
        if (matchedItem) matchedLabel = matchedItem.label;
        break;
      }
    }

    // Check custom presets
    if (matchedPreset === "custom") {
      for (let idx = 0; idx < customPresets.length; idx++) {
        const p = customPresets[idx];
        let match = true;
        for (let i = 0; i < 11; i++) {
          if (Math.abs(eqSettings.bands[i].gain - p.bands[i].gain) > 0.1 || eqSettings.bands[i].type !== p.bands[i].type) {
            match = false;
            break;
          }
        }
        if (match && p.dials) {
          const eqDialsObj = eqSettings.dials || {};
          for (const k of Object.keys(p.dials)) {
            const curVal = eqDialsObj[k] !== undefined ? eqDialsObj[k] : 0;
            if (Math.abs(curVal - p.dials[k]) > 0.1) {
              match = false;
              break;
            }
          }
        }
        if (match) {
          matchedPreset = `custom-${idx}`;
          matchedLabel = p.name;
          break;
        }
      }
    }

    // Set trigger text
    selectedPresetName.textContent = matchedLabel;
    activeMatchedPresetValue = matchedPreset;

    // Render standard items
    standardPresets.forEach(p => {
      const item = document.createElement("div");
      item.className = `dropdown-item${matchedPreset === p.value ? " selected" : ""}`;
      item.textContent = p.label;
      item.addEventListener("click", () => {
        applyPresetSelection(p.value);
        dropdownMenu.classList.add("hidden");
      });
      dropdownMenu.appendChild(item);
    });

    // 2. Custom presets group
    if (customPresets.length > 0) {
      const customHeader = document.createElement("div");
      customHeader.className = "dropdown-group-header";
      customHeader.textContent = "Custom Presets";
      dropdownMenu.appendChild(customHeader);

      customPresets.forEach((p, idx) => {
        const customValue = `custom-${idx}`;
        const item = document.createElement("div");
        item.className = `dropdown-item${matchedPreset === customValue ? " selected" : ""}`;
        item.textContent = p.name;
        item.addEventListener("click", () => {
          applyPresetSelection(customValue);
          dropdownMenu.classList.add("hidden");
        });
        dropdownMenu.appendChild(item);
      });
    }

    // Toggle delete button visibility (custom preset only)
    if (matchedPreset.startsWith("custom-")) {
      deletePresetBtn.classList.remove("hidden");
    } else {
      deletePresetBtn.classList.add("hidden");
    }
  }

  function applyPresetSelection(val) {
    if (val === "custom") return;

    if (val.startsWith("custom-")) {
      const idx = parseInt(val.replace("custom-", ""));
      const preset = customPresets[idx];
      if (preset) {
        eqSettings.bands.forEach((band, idx) => {
          band.gain = preset.bands[idx].gain;
          band.type = preset.bands[idx].type;
          band.Q = preset.bands[idx].Q;
          band.frequency = preset.bands[idx].frequency;
        });
        if (preset.dials) {
          eqSettings.dials = JSON.parse(JSON.stringify(preset.dials));
          // Robustly ensure all defaults are present inside loaded custom preset
          DIAL_CONFIGS.forEach(config => {
            if (config.id !== "preamp" && eqSettings.dials[config.id] === undefined) {
              eqSettings.dials[config.id] = config.defaultVal;
            }
          });
        } else {
          eqSettings.dials = { 
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
          };
        }
        saveAndSync();
        renderUI();
        renderDials();
      }
    } else {
      const presetGains = PRESETS[val];
      if (presetGains) {
        eqSettings.bands.forEach((band, idx) => {
          band.gain = presetGains[idx];
          band.type = DEFAULT_BANDS[idx].type;
          band.Q = DEFAULT_BANDS[idx].Q;
          band.frequency = DEFAULT_BANDS[idx].frequency;
        });
        eqSettings.dials = { 
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
        };
        saveAndSync();
        renderUI();
        renderDials();
      }
    }
  }

  // --- Visualizer Curve Mathematical Model ---

  function drawFrequencyResponse() {
    // Dynamic HD resolution adjustment to match the physical client bounding box perfectly
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.clearRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
    ctx.lineWidth = 1;

    // Horizontal grid lines (+20dB, +10dB, 0dB, -10dB, -20dB) - Perfectly pixel-aligned to the physical slider tracks
    const dbLevels = [20, 10, 0, -10, -20];
    dbLevels.forEach(db => {
      const y = 101 - db * 2.75;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
      ctx.font = "7px sans-serif";
      ctx.fillText(db === 0 ? "0dB" : `${db > 0 ? "+" : ""}${db}dB`, 4, y - 2);
    });

    // Vertical grid lines (100Hz, 1kHz, 10kHz)
    const vertFreqs = [100, 1000, 10000];
    vertFreqs.forEach(f => {
      const x = width * (Math.log10(f / 20) / Math.log10(20000 / 20));
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    });

    ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 101);
    ctx.lineTo(width, 101);
    ctx.stroke();

    const minFreq = 20;
    const maxFreq = 20000;
    const logRange = Math.log10(maxFreq / minFreq);

    const points = [];
    
    for (let x = 0; x <= width; x++) {
      const pct = x / width;
      const freq = minFreq * Math.pow(10, pct * logRange);
      let totalDb = 0;

      if (eqSettings.enabled) {
        // Sum response contributions of each active band filter
        eqSettings.bands.forEach((band, idx) => {
          let gainContrib = 0;
          
          if (band.type === "peaking") {
            const logDist = Math.log10(freq / band.frequency);
            const sigma = 0.38 / band.Q;
            gainContrib = band.gain * Math.exp(-Math.pow(logDist / sigma, 2));
          } 
          else if (band.type === "lowshelf") {
            const freqRatio = freq / band.frequency;
            gainContrib = band.gain / (1 + Math.pow(freqRatio, 2));
          } 
          else if (band.type === "highshelf") {
            const freqRatio = freq / band.frequency;
            gainContrib = band.gain * Math.pow(freqRatio, 2) / (1 + Math.pow(freqRatio, 2));
          }
          else if (band.type === "highpass") {
            const cutoff = mapSliderToFrequency(idx, band.gain, band.defaultFrequency);
            gainContrib = -20 * Math.log10(Math.sqrt(1 + Math.pow(cutoff / freq, 4)));
          }
          else if (band.type === "lowpass") {
            const cutoff = mapSliderToFrequency(idx, band.gain, band.defaultFrequency);
            gainContrib = -20 * Math.log10(Math.sqrt(1 + Math.pow(freq / cutoff, 4)));
          }
          else if (band.type === "bandpass") {
            const center = mapSliderToFrequency(idx, band.gain, band.defaultFrequency);
            const fRatio = freq / center;
            const Q = band.Q;
            const denom = Math.sqrt(1 + Q * Q * Math.pow(fRatio - 1/fRatio, 2));
            gainContrib = -20 * Math.log10(denom);
          }

          totalDb += gainContrib;
        });

        // Sum response contributions of the 5 active audio dials
        const dials = eqSettings.dials || { highpass: 20, lowpass: 20000, presence: 0, air: 0, brilliance: 0 };
        
        if (dials.highpass > 20) {
          const hpfContrib = -20 * Math.log10(Math.sqrt(1 + Math.pow(dials.highpass / freq, 4)));
          totalDb += hpfContrib;
        }

        if (dials.lowpass < 20000) {
          const lpfContrib = -20 * Math.log10(Math.sqrt(1 + Math.pow(freq / dials.lowpass, 4)));
          totalDb += lpfContrib;
        }

        if (Math.abs(dials.presence) > 0) {
          const logDistPresence = Math.log10(freq / 3500);
          const presenceContrib = dials.presence * Math.exp(-Math.pow(logDistPresence / (0.38 / 1.0), 2));
          totalDb += presenceContrib;
        }

        if (Math.abs(dials.air) > 0) {
          const freqRatioAir = freq / 12000;
          const airContrib = dials.air * Math.pow(freqRatioAir, 2) / (1 + Math.pow(freqRatioAir, 2));
          totalDb += airContrib;
        }

        if (Math.abs(dials.brilliance) > 0) {
          const logDistBrilliance = Math.log10(freq / 8000);
          const brillianceContrib = dials.brilliance * Math.exp(-Math.pow(logDistBrilliance / (0.38 / 1.2), 2));
          totalDb += brillianceContrib;
        }

        // Add Multi-Band Solo effect to curve visualization
        if (activeSoloIndexes && activeSoloIndexes.length > 0) {
          let sumLinear = 0;
          activeSoloIndexes.forEach(soloIdx => {
            const soloBand = eqSettings.bands[soloIdx];
            let soloFreq = soloBand.frequency;
            
            if (soloBand.type === "lowpass" || soloBand.type === "highpass" || soloBand.type === "bandpass") {
              soloFreq = mapSliderToFrequency(soloIdx, soloBand.gain, soloBand.defaultFrequency || soloBand.frequency);
            }
            
            const fRatio = freq / soloFreq;
            const denom = Math.sqrt(1 + 1.8 * 1.8 * Math.pow(fRatio - 1/fRatio, 2));
            const bandpassDb = -20 * Math.log10(denom);
            sumLinear += Math.pow(10, bandpassDb / 20);
          });
          
          if (sumLinear > 0.0001) {
            totalDb += 20 * Math.log10(sumLinear);
          } else {
            totalDb += -80;
          }
        }
        
        // --- Real-Time Frequency Spikes (128 high-fidelity bins) ---
        if (isAudioPlaying) {
          const nyquist = 22050;
          const binFloat = (freq / nyquist) * 127;
          const binIdx  = Math.min(127, Math.floor(binFloat));
          const binNext = Math.min(127, binIdx + 1);
          const w = binFloat - binIdx;
          const audioAmp = (liveFreqData[binIdx] || 0) * (1 - w) + (liveFreqData[binNext] || 0) * w;
          
          // Apply balanced high-frequency visual tilt scaling
          const freqRatioFactor = 1.0 + (binIdx / 127) * 2.0;
          const spikeDb = ((audioAmp * freqRatioFactor) / 255) * 14;
          totalDb += spikeDb;
        }
      }

      let y;
      if (eqSettings.enabled && isAudioPlaying) {
        // Clamp visual response curve inside ±30dB ranges for massive dynamic headrooms
        totalDb = Math.max(-30, Math.min(30, totalDb));
        y = 101 - totalDb * 2.75;
      } else {
        // Completely still and flat lying exactly on the lower -20dB grid line
        y = 156;
      }
      points.push({ x, y });
    }

    if (points.length > 0) {
      if (eqSettings.enabled && isAudioPlaying) {
        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, "rgba(167, 139, 250, 0.28)");
        gradient.addColorStop(0.5, "rgba(192, 132, 252, 0.10)");
        gradient.addColorStop(1, "rgba(7, 8, 14, 0)");

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(0, height);
        points.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.lineTo(width, height);
        ctx.closePath();
        ctx.fill();
      }

      if (eqSettings.enabled) {
        const strokeGrad = ctx.createLinearGradient(0, 0, width, 0);
        strokeGrad.addColorStop(0, "#fb7185");
        strokeGrad.addColorStop(0.4, "#c084fc");
        strokeGrad.addColorStop(0.7, "#a78bfa");
        strokeGrad.addColorStop(1, "#34d399");
        
        ctx.strokeStyle = strokeGrad;
        ctx.shadowColor = "rgba(167, 139, 250, 0.65)";
        ctx.shadowBlur = 10;
      } else {
        ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
      }
      ctx.lineWidth = 3.5;
      
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.stroke();
      
      ctx.shadowBlur = 0;
    }
  }

  // --- Interaction Event Listeners ---

  // Custom Dropdown Open/Close
  dropdownTrigger.addEventListener("click", () => {
    dropdownMenu.classList.toggle("hidden");
  });

  window.addEventListener("click", (e) => {
    if (!dropdownTrigger.contains(e.target) && !dropdownMenu.contains(e.target)) {
      dropdownMenu.classList.add("hidden");
    }
  });

  // Master Power Button Toggle Click
  masterToggle.addEventListener("click", () => {
    eqSettings.enabled = !eqSettings.enabled;
    saveAndSync();
    renderUI();
    renderDials();
  });

  // Reset All Button Click
  resetBtn.addEventListener("click", () => {
    activeSoloIndexes = [];
    eqSettings.bands.forEach((band, idx) => {
      band.gain = 0;
      band.type = DEFAULT_BANDS[idx].type;
      band.Q = DEFAULT_BANDS[idx].Q;
      band.frequency = DEFAULT_BANDS[idx].frequency;
    });
    eqSettings.dials = { 
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
    };
    eqSettings.masterGain = 1.0;
    saveAndSync();
    renderUI();
    renderDials();
  });

  // Dial Tab Buttons Switch Click
  const tabButtons = document.querySelectorAll(".dial-tab-btn");
  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      tabButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeDialTab = btn.getAttribute("data-tab");
      renderDials();
    });
  });

  // Preset Save Custom Action Click
  savePresetBtn.addEventListener("click", () => {
    savePresetModal.classList.remove("hidden");
    presetNameInput.value = "";
    presetNameInput.focus();
  });

  cancelSaveBtn.addEventListener("click", () => {
    savePresetModal.classList.add("hidden");
  });

  confirmSaveBtn.addEventListener("click", () => {
    const name = presetNameInput.value.trim();
    if (!name) return;

    // Check if a preset with this name already exists (case-insensitive)
    const existingIdx = customPresets.findIndex(
      p => p.name.trim().toLowerCase() === name.toLowerCase()
    );

    if (existingIdx !== -1) {
      // Show overwrite confirmation instead of saving immediately
      pendingPresetName   = name;
      pendingOverwriteIdx = existingIdx;
      overwriteNameLabel.textContent = name;
      savePresetModal.classList.add("hidden");
      overwriteModal.classList.remove("hidden");
      return;
    }

    // No conflict — save as new preset
    commitPresetSave(name, -1);
  });

  // Overwrite confirmed — replace existing preset in-place
  overwriteYesBtn.addEventListener("click", () => {
    overwriteModal.classList.add("hidden");
    commitPresetSave(pendingPresetName, pendingOverwriteIdx);
    pendingPresetName   = "";
    pendingOverwriteIdx = -1;
  });

  // Overwrite declined — go back to naming modal
  overwriteNoBtn.addEventListener("click", () => {
    overwriteModal.classList.add("hidden");
    savePresetModal.classList.remove("hidden");
    presetNameInput.focus();
    pendingPresetName   = "";
    pendingOverwriteIdx = -1;
  });

  // Shared helper: build and persist a preset, overwriting at overwriteIdx if >= 0
  function commitPresetSave(name, overwriteIdx) {
    const preset = {
      name: name,
      bands: eqSettings.bands.map(b => ({
        type: b.type,
        gain: b.gain,
        Q: b.Q,
        frequency: b.frequency
      })),
      dials: JSON.parse(JSON.stringify(eqSettings.dials))
    };

    if (overwriteIdx >= 0) {
      customPresets[overwriteIdx] = preset; // replace in-place
    } else {
      customPresets.push(preset);           // append as new
    }

    const savedIdx = overwriteIdx >= 0 ? overwriteIdx : customPresets.length - 1;
    chrome.storage.local.set({ customPresets: customPresets }, () => {
      savePresetModal.classList.add("hidden");
      updatePresetSelector();
      applyPresetSelection(`custom-${savedIdx}`);
    });
  }

  // Delete Custom Preset Action Click
  deletePresetBtn.addEventListener("click", () => {
    if (activeMatchedPresetValue.startsWith("custom-")) {
      const idx = parseInt(activeMatchedPresetValue.replace("custom-", ""));
      customPresets.splice(idx, 1);
      chrome.storage.local.set({ customPresets: customPresets }, () => {
        applyPresetSelection("flat");
      });
    }
  });

  // Close any open modal on Escape key press
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      savePresetModal.classList.add("hidden");
      overwriteModal.classList.add("hidden");
      pendingPresetName   = "";
      pendingOverwriteIdx = -1;
    }
  });

  function connectToActiveTabAnalyser() {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        try {
          if (tabs && tabs[0] && tabs[0].id && tabs[0].url && 
              !tabs[0].url.startsWith("chrome://") && 
              !tabs[0].url.startsWith("about:") && 
              !tabs[0].url.startsWith("moz-extension://")) {
            
            port = chrome.tabs.connect(tabs[0].id, { name: "peaks-analyser" });
            
            port.onMessage.addListener((msg) => {
              if (msg.type === "AUDIO_FREQS") {
                liveFreqData = msg.freqs;
                const sum = liveFreqData.reduce((a, b) => a + b, 0);
                isAudioPlaying = sum > 10;
              }
            });

            port.onDisconnect.addListener(() => {
              port = null;
              isAudioPlaying = false;
              liveFreqData.fill(0);
            });
          }
        } catch (innerError) {
          console.warn("[Peaks] Tab connection failed gracefully:", innerError);
        }
      });
    } catch (e) {
      console.warn("[Peaks] Active tab query failed gracefully:", e);
    }
  }

  function animLoop() {
    animTime += 0.05;
    
    if (!port) {
      audioDetectThrottle++;
      if (audioDetectThrottle >= 45) {
        audioDetectThrottle = 0;
        try {
          chrome.tabs.query({ audible: true }, (tabs) => {
            isAudioPlaying = tabs && tabs.length > 0;
          });
        } catch (e) {
          isAudioPlaying = false;
        }
      }
      
      for (let i = 0; i < 128; i++) {
        if (isAudioPlaying) {
          const baseHeight = (Math.sin(animTime * 1.5 + i * 0.1) + 1.0) * 35;
          liveFreqData[i] = baseHeight + Math.random() * 8;
        } else {
          liveFreqData[i] = liveFreqData[i] * 0.9;
        }
      }
    }

    drawFrequencyResponse();
    requestAnimationFrame(animLoop);
  }

  // Initialize extension elements
  init();
  connectToActiveTabAnalyser();
  animLoop();
});
