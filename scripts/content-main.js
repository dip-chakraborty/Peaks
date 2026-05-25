// Peaks - Main-World Audio Equalizer Engine
// Intercepts AudioContexts and media elements directly in the webpage context to bypass isolated world and CORS security restrictions.

(function () {
  if (window.peaksMainInjected) return;
  window.peaksMainInjected = true;

  console.log("[Peaks] Main-World Audio Engine Loaded.");

  let latestAnalyser = null;
  let popupConnected = false;

  // --- DSP Configuration & Default State ---
  const DEFAULT_BANDS = [
    { type: "lowshelf", frequency: 30,    Q: 0.707, gain: 0 }, // Butterworth shelf — flat, no resonance
    { type: "lowshelf", frequency: 60,    Q: 0.707, gain: 0 }, // Butterworth shelf — flat, no resonance
    { type: "peaking", frequency: 120,   Q: 0.80,  gain: 0 }, // Wide — warm, musical upper-bass
    { type: "peaking", frequency: 250,   Q: 0.90,  gain: 0 }, // Slightly wide — natural warmth control
    { type: "peaking", frequency: 500,   Q: 1.00,  gain: 0 }, // Standard 1-octave — low-mid precision
    { type: "peaking", frequency: 1000,  Q: 1.00,  gain: 0 }, // Standard 1-octave — critical midrange
    { type: "peaking", frequency: 2000,  Q: 1.10,  gain: 0 }, // Slightly tight — sensitive upper-mid
    { type: "peaking", frequency: 4000,  Q: 1.20,  gain: 0 }, // Tighter — presence, less harshness risk
    { type: "peaking", frequency: 8000,  Q: 1.50,  gain: 0 }, // Tight — clean high freq, no smearing
    { type: "highshelf", frequency: 12000, Q: 0.707, gain: 0 }, // Butterworth shelf — flat, no resonance
    { type: "highshelf", frequency: 16000, Q: 0.707, gain: 0 }  // Butterworth shelf — flat, no resonance
  ];

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
      width: 1.0
    }
  };
  
  let soloBandIndexes = []; // Array of soloed band indexes

  // Keep track of all active audio contexts and their associated EQ chains
  const activeContexts = new Set();
  const eqChains = new Map(); // Map: AudioContext -> EQ Chain object

  // Safe parameter transition time in seconds (to prevent clicking)
  const TRANSITION_TIME = 0.025; // 25ms — prevents click artifacts on fast slider movements

  // Smoothly update an AudioParam
  function smoothParam(param, value, audioCtx) {
    if (!param) return;
    try {
      const currVal = param.value;
      param.cancelScheduledValues(audioCtx.currentTime);
      param.setValueAtTime(currVal, audioCtx.currentTime);
      param.setTargetAtTime(value, audioCtx.currentTime, TRANSITION_TIME);
    } catch (e) {
      param.value = value;
    }
  }

  // --- Generate high-fidelity synthetic stereo reverb impulse response ---
  function createReverbImpulseResponse(audioCtx) {
    const sampleRate = audioCtx.sampleRate || 44100;
    const duration = 2.0; // seconds (musical studio concert hall)
    const preDelay = 0.020; // 20ms pre-delay for clean transient separation
    const preDelaySamples = Math.floor(sampleRate * preDelay);
    const numSamples = sampleRate * duration;
    const buffer = audioCtx.createBuffer(2, numSamples, sampleRate);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    
    const decayRate = 3.0; // More natural exponential decay — smoother room tail
    const dampingFactor = 1.8; // More realistic HF damping — darker, less metallic late tail
    
    let lpL = 0;
    let lpR = 0;
    
    // Clear pre-delay samples
    for (let i = 0; i < preDelaySamples; i++) {
      left[i] = 0;
      right[i] = 0;
    }
    
    for (let i = preDelaySamples; i < numSamples; i++) {
      const t = (i - preDelaySamples) / sampleRate;
      const tailDuration = duration - preDelay;
      
      // Exponential decay envelope
      const envelope = Math.pow(1 - t / tailDuration, decayRate);
      
      // Gently filter high frequencies as the tail decays for realistic acoustics
      const filterCoeff = Math.max(0.04, 0.40 * Math.exp(-t * dampingFactor)); // Lower floor = darker, cleaner late tail
      
      // Direct noise generation
      const noiseL = Math.random() * 2 - 1;
      const noiseR = Math.random() * 2 - 1;
      
      // One-pole low-pass filter
      lpL += filterCoeff * (noiseL - lpL);
      lpR += filterCoeff * (noiseR - lpR);
      
      // Inject stereo cross-talk to increase diffusion and realistic room reflections
      const mixedL = lpL * 0.85 + lpR * 0.15;
      const mixedR = lpR * 0.85 + lpL * 0.15;
      
      left[i] = mixedL * envelope * 0.9; // Balanced output volume
      right[i] = mixedR * envelope * 0.9;
    }
    return buffer;
  }


  // --- Create & Manage EQ Graph ---
  function getOrCreateEQChain(audioCtx) {
    if (eqChains.has(audioCtx)) {
      return eqChains.get(audioCtx);
    }

    console.log("[Peaks] Constructing EQ Chain for AudioContext:", audioCtx);

    // 1. Create Nodes (Flagged as isPeaksNode to prevent feedback loops in hook)
    const inputNode = audioCtx.createGain();
    inputNode.gain.value = 1.0;
    inputNode.isPeaksNode = true;

    const filters = [];
    let lastNode = inputNode;

    // Create 11 serial BiquadFilterNodes
    for (let i = 0; i < 11; i++) {
      const filter = audioCtx.createBiquadFilter();
      filter.isPeaksNode = true;
      filters.push(filter);
      lastNode.connect(filter);
      lastNode = filter;
    }

    // Create 5 serial BiquadFilterNodes for the new dials
    const dialHighPass = audioCtx.createBiquadFilter();
    dialHighPass.isPeaksNode = true;
    dialHighPass.type = "allpass";
    lastNode.connect(dialHighPass);
    lastNode = dialHighPass;

    const dialLowPass = audioCtx.createBiquadFilter();
    dialLowPass.isPeaksNode = true;
    dialLowPass.type = "allpass";
    lastNode.connect(dialLowPass);
    lastNode = dialLowPass;

    const dialPresence = audioCtx.createBiquadFilter();
    dialPresence.isPeaksNode = true;
    dialPresence.type = "peaking";
    dialPresence.frequency.value = 3200; // 3200Hz = peak ear sensitivity, more natural vocal clarity
    dialPresence.Q.value = 1.0;
    dialPresence.gain.value = 0;
    lastNode.connect(dialPresence);
    lastNode = dialPresence;

    const dialAir = audioCtx.createBiquadFilter();
    dialAir.isPeaksNode = true;
    dialAir.type = "highshelf";
    dialAir.frequency.value = 12000;
    dialAir.Q.value = 0.707;
    dialAir.gain.value = 0;
    lastNode.connect(dialAir);
    lastNode = dialAir;

    const dialBrilliance = audioCtx.createBiquadFilter();
    dialBrilliance.isPeaksNode = true;
    dialBrilliance.type = "peaking";
    dialBrilliance.frequency.value = 8000;
    dialBrilliance.Q.value = 1.2;
    dialBrilliance.gain.value = 0;
    lastNode.connect(dialBrilliance);
    lastNode = dialBrilliance;

    // Create parallel multi-solo block
    const soloInputNode = audioCtx.createGain();
    soloInputNode.gain.value = 1.0;
    soloInputNode.isPeaksNode = true;
    lastNode.connect(soloInputNode);

    const soloOutputNode = audioCtx.createGain();
    soloOutputNode.gain.value = 1.0;
    soloOutputNode.isPeaksNode = true;

    // Direct path (unfiltered, used when no solo is active)
    const directSoloGain = audioCtx.createGain();
    directSoloGain.gain.value = 1.0;
    directSoloGain.isPeaksNode = true;
    soloInputNode.connect(directSoloGain);
    directSoloGain.connect(soloOutputNode);

    // 11 parallel bandpass solo filters
    const soloFilters = [];
    const soloFilterGains = [];
    for (let i = 0; i < 11; i++) {
      const sFilter = audioCtx.createBiquadFilter();
      sFilter.isPeaksNode = true;
      sFilter.type = "bandpass";
      sFilter.Q.value = 1.8;

      const sGain = audioCtx.createGain();
      sGain.isPeaksNode = true;
      sGain.gain.value = 0.0;

      soloInputNode.connect(sFilter);
      sFilter.connect(sGain);
      sGain.connect(soloOutputNode);

      soloFilters.push(sFilter);
      soloFilterGains.push(sGain);
    }

    lastNode = soloOutputNode;

    // Dynamics Nodes: Transient Shaper and Compressor
    const transientShaper = audioCtx.createDynamicsCompressor();
    transientShaper.isPeaksNode = true;
    transientShaper.threshold.value = -24.0;
    transientShaper.knee.value = 4.0;
    transientShaper.ratio.value = 1.0;
    transientShaper.attack.value = 0.05;
    transientShaper.release.value = 0.15;
    lastNode.connect(transientShaper);
    lastNode = transientShaper;

    const transientMakeup = audioCtx.createGain();
    transientMakeup.isPeaksNode = true;
    transientMakeup.gain.value = 1.0;
    lastNode.connect(transientMakeup);
    lastNode = transientMakeup;

    const compressor = audioCtx.createDynamicsCompressor();
    compressor.isPeaksNode = true;
    compressor.threshold.value = 0.0;
    compressor.knee.value = 8.0;
    compressor.ratio.value = 1.0;
    compressor.attack.value = 0.012;
    compressor.release.value = 0.15;
    lastNode.connect(compressor);
    lastNode = compressor;

    const compressorMakeup = audioCtx.createGain();
    compressorMakeup.isPeaksNode = true;
    compressorMakeup.gain.value = 1.0;
    lastNode.connect(compressorMakeup);
    lastNode = compressorMakeup;

    // Create Mid-Side Stereo Widener Matrix
    const splitter = audioCtx.createChannelSplitter(2);
    const merger = audioCtx.createChannelMerger(2);
    splitter.isPeaksNode = true;
    merger.isPeaksNode = true;

    const midGain = audioCtx.createGain();
    const sideGain = audioCtx.createGain();
    const sideWidth = audioCtx.createGain();
    const leftReconstructor = audioCtx.createGain();
    const rightReconstructor = audioCtx.createGain();
    const sideSumL = audioCtx.createGain();
    const sideSumR = audioCtx.createGain();
    const sideInverter = audioCtx.createGain();

    // Set ALL intermediate nodes to explicit mono (1 channel) to prevent channel count mode crosstalk downmixing!
    midGain.channelCount = 1;
    midGain.channelCountMode = "explicit";
    sideGain.channelCount = 1;
    sideGain.channelCountMode = "explicit";
    sideWidth.channelCount = 1;
    sideWidth.channelCountMode = "explicit";
    leftReconstructor.channelCount = 1;
    leftReconstructor.channelCountMode = "explicit";
    rightReconstructor.channelCount = 1;
    rightReconstructor.channelCountMode = "explicit";
    sideSumL.channelCount = 1;
    sideSumL.channelCountMode = "explicit";
    sideSumR.channelCount = 1;
    sideSumR.channelCountMode = "explicit";
    sideInverter.channelCount = 1;
    sideInverter.channelCountMode = "explicit";

    midGain.isPeaksNode = true;
    sideGain.isPeaksNode = true;
    sideWidth.isPeaksNode = true;
    leftReconstructor.isPeaksNode = true;
    rightReconstructor.isPeaksNode = true;
    sideSumL.isPeaksNode = true;
    sideSumR.isPeaksNode = true;
    sideInverter.isPeaksNode = true;

    // Split input
    lastNode.connect(splitter);

    // Mid = (L + R) / 2
    splitter.connect(midGain, 0); // Connect L
    splitter.connect(midGain, 1); // Connect R
    midGain.gain.value = 0.5;

    // Side = (L - R) / 2
    sideSumL.gain.value = 0.5;
    sideSumR.gain.value = -0.5; // Phase invert Right

    splitter.connect(sideSumL, 0); // Connect L
    splitter.connect(sideSumR, 1); // Connect R

    sideSumL.connect(sideGain);
    sideSumR.connect(sideGain);

    // Apply Width Coefficient W
    sideGain.connect(sideWidth);
    sideWidth.gain.value = 1.0;

    // Reconstruct Left = Mid + Side
    midGain.connect(leftReconstructor);
    sideWidth.connect(leftReconstructor);

    // Reconstruct Right = Mid - Side
    midGain.connect(rightReconstructor);
    sideWidth.connect(sideInverter);
    sideInverter.gain.value = -1.0; // CRITICAL FIX: Invert side channel to compute Mid - Side
    sideInverter.connect(rightReconstructor);

    // Merge back to stereo
    leftReconstructor.connect(merger, 0, 0);
    rightReconstructor.connect(merger, 0, 1);

    // Create Stereo Panner Node
    const pannerNode = audioCtx.createStereoPanner();
    pannerNode.isPeaksNode = true;
    pannerNode.pan.value = 0.0;
    merger.connect(pannerNode);

    // Create parallel Reverb Block
    const reverbDryGain = audioCtx.createGain();
    reverbDryGain.isPeaksNode = true;
    reverbDryGain.gain.value = 1.0;

    const reverbWetGain = audioCtx.createGain();
    reverbWetGain.isPeaksNode = true;
    reverbWetGain.gain.value = 0.0;

    const reverbConvolver = audioCtx.createConvolver();
    reverbConvolver.isPeaksNode = true;
    reverbConvolver.normalize = true; // explicitly enable gain normalization
    try {
      reverbConvolver.buffer = createReverbImpulseResponse(audioCtx);
    } catch (e) {
      console.warn("[Peaks] Failed to set synthetic reverb buffer:", e);
    }

    const reverbSumNode = audioCtx.createGain();
    reverbSumNode.isPeaksNode = true;
    reverbSumNode.gain.value = 1.0;

    // Connect Reverb parallel paths
    pannerNode.connect(reverbDryGain);
    pannerNode.connect(reverbConvolver);
    reverbConvolver.connect(reverbWetGain);
    reverbDryGain.connect(reverbSumNode);
    reverbWetGain.connect(reverbSumNode);

    lastNode = reverbSumNode;

    // Create Dynamics Compressor Master Limiter (Strict Brickwall Peak Limiting characteristics)
    const limiter = audioCtx.createDynamicsCompressor();
    limiter.isPeaksNode = true;
    limiter.threshold.value = -0.5;
    limiter.knee.value = 0.0;    // hard knee for brickwall limit ceiling
    limiter.ratio.value = 20.0;
    limiter.attack.value = 0.003;  // 3ms — safer inter-sample clipping protection vs 1ms
    limiter.release.value = 0.10;  // 100ms — eliminates volume pumping / breathing artifacts
    
    lastNode.connect(limiter);
    lastNode = limiter;

    // Master Gain Node
    const masterGainNode = audioCtx.createGain();
    masterGainNode.isPeaksNode = true;
    masterGainNode.gain.value = 1.0;
    lastNode.connect(masterGainNode);

    // Analyser Node for real-time visualizer (256 fftSize = 128 frequency bins)
    const analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 256; 
    analyserNode.smoothingTimeConstant = 0.75;
    analyserNode.isPeaksNode = true;
    latestAnalyser = analyserNode;

    const chain = {
      inputNode,
      filters,
      dialHighPass,
      dialLowPass,
      dialPresence,
      dialAir,
      dialBrilliance,
      transientShaper,
      transientMakeup,
      compressor,
      compressorMakeup,
      midGain,
      sideWidth,
      pannerNode,
      reverbConvolver,
      reverbDryGain,
      reverbWetGain,
      reverbSumNode,
      limiter,
      soloInputNode,
      soloOutputNode,
      directSoloGain,
      soloFilters,
      soloFilterGains,
      masterGainNode,
      analyserNode,
      audioCtx
    };

    eqChains.set(audioCtx, chain);
    activeContexts.add(audioCtx);

    // Apply current settings immediately to the new chain
    applySettingsToChain(chain);

    return chain;
  }

  // Map slider value (-20 to +20) to frequency for HPF/LPF/BPF
  function mapSliderToFrequency(bandIndex, sliderVal, defaultFreq) {
    const octaveShift = (sliderVal / 20) * 2; 
    return defaultFreq * Math.pow(2, octaveShift);
  }

  // Apply settings to a specific EQ chain
  function applySettingsToChain(chain) {
    const { 
      filters, 
      dialHighPass, 
      dialLowPass, 
      dialPresence, 
      dialAir, 
      dialBrilliance,
      transientShaper,
      transientMakeup,
      compressor,
      compressorMakeup,
      midGain,
      sideWidth,
      pannerNode,
      reverbDryGain,
      reverbWetGain,
      limiter,
      directSoloGain,
      soloFilters,
      soloFilterGains,
      masterGainNode, 
      audioCtx 
    } = chain;

    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }

    const isEnabled = eqSettings.enabled;

    // Master gain
    smoothParam(masterGainNode.gain, isEnabled ? eqSettings.masterGain : 1.0, audioCtx);

    // Biquads clean neutral bypass (using completely transparent allpass type)
    if (!isEnabled) {
      eqSettings.bands.forEach((band, idx) => {
        const filter = filters[idx];
        if (filter) {
          filter.type = "allpass";
        }
      });

      dialHighPass.type = "allpass";
      dialLowPass.type = "allpass";
      dialPresence.type = "allpass";
      dialAir.type = "allpass";
      dialBrilliance.type = "allpass";

      // Reset Width to 100% (midGain = 0.5, sideWidth = 1.0) and Limiter to transparent 0dB threshold
      if (chain.midGain) {
        smoothParam(chain.midGain.gain, 0.5, audioCtx);
      }
      smoothParam(sideWidth.gain, 1.0, audioCtx);
      
      // Reset new components
      if (transientShaper) {
        smoothParam(transientShaper.ratio, 1.0, audioCtx);
      }
      if (transientMakeup) {
        smoothParam(transientMakeup.gain, 1.0, audioCtx);
      }
      if (compressor) {
        smoothParam(compressor.ratio, 1.0, audioCtx);
      }
      if (compressorMakeup) {
        smoothParam(compressorMakeup.gain, 1.0, audioCtx);
      }
      if (pannerNode) {
        smoothParam(pannerNode.pan, 0.0, audioCtx);
      }
      if (reverbDryGain) {
        smoothParam(reverbDryGain.gain, 1.0, audioCtx);
      }
      if (reverbWetGain) {
        smoothParam(reverbWetGain.gain, 0.0, audioCtx);
      }
      
      smoothParam(limiter.threshold, 0.0, audioCtx);

      // Direct path (unfiltered)
      smoothParam(directSoloGain.gain, 1.0, audioCtx);
      for (let i = 0; i < 11; i++) {
        smoothParam(soloFilterGains[i].gain, 0.0, audioCtx);
      }
      return;
    }

    // Apply values to each of the 11 filters when enabled
    eqSettings.bands.forEach((band, idx) => {
      const filter = filters[idx];
      if (!filter) return;

      filter.type = band.type;
      const isFittedFreq = (band.type === "lowpass" || band.type === "highpass" || band.type === "bandpass");

      if (isFittedFreq) {
        const targetFreq = mapSliderToFrequency(idx, band.gain, band.defaultFrequency || band.frequency);
        smoothParam(filter.frequency, targetFreq, audioCtx);
        smoothParam(filter.Q, band.Q, audioCtx);
      } else {
        smoothParam(filter.frequency, band.frequency, audioCtx);
        smoothParam(filter.Q, band.Q, audioCtx);
        smoothParam(filter.gain, band.gain, audioCtx);
      }
    });

    // Apply Dial Settings
    const dials = eqSettings.dials || {
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

    // 1. High Pass Dial (cuts lows)
    if (dials.highpass > 20) {
      dialHighPass.type = "highpass";
      smoothParam(dialHighPass.frequency, dials.highpass, audioCtx);
      smoothParam(dialHighPass.Q, 0.707, audioCtx);
    } else {
      dialHighPass.type = "allpass";
    }

    // 2. Low Pass Dial (cuts highs)
    if (dials.lowpass < 20000) {
      dialLowPass.type = "lowpass";
      smoothParam(dialLowPass.frequency, dials.lowpass, audioCtx);
      smoothParam(dialLowPass.Q, 0.707, audioCtx);
    } else {
      dialLowPass.type = "allpass";
    }

    // 3. Presence Dial
    dialPresence.type = "peaking";
    smoothParam(dialPresence.frequency, 3200, audioCtx); // 3200Hz — peak ear sensitivity
    smoothParam(dialPresence.Q, 1.0, audioCtx);
    smoothParam(dialPresence.gain, dials.presence, audioCtx);

    // 4. Air Dial
    dialAir.type = "highshelf";
    smoothParam(dialAir.frequency, 12000, audioCtx);
    smoothParam(dialAir.Q, 0.707, audioCtx);
    smoothParam(dialAir.gain, dials.air, audioCtx);

    // 5. Brilliance Dial
    dialBrilliance.type = "peaking";
    smoothParam(dialBrilliance.frequency, 8000, audioCtx);
    smoothParam(dialBrilliance.Q, 1.2, audioCtx);
    smoothParam(dialBrilliance.gain, dials.brilliance, audioCtx);

    // 6. Compressor
    const thresholdComp = dials.compressor !== undefined ? dials.compressor : 0.0;
    if (compressor && compressorMakeup) {
      if (thresholdComp < 0) {
        smoothParam(compressor.threshold, thresholdComp, audioCtx);
        smoothParam(compressor.ratio, 4.0, audioCtx);
        smoothParam(compressor.knee, 8.0, audioCtx);
        smoothParam(compressor.attack, 0.012, audioCtx);
        smoothParam(compressor.release, 0.15, audioCtx);
        
        // Automatic makeup gain to level volume: e.g. up to +3.5dB makeup gain at -40dB threshold
        const compMakeupDb = (Math.abs(thresholdComp) / 40.0) * 3.5;
        const compMakeupGain = Math.pow(10, compMakeupDb / 20);
        smoothParam(compressorMakeup.gain, compMakeupGain, audioCtx);
      } else {
        smoothParam(compressor.ratio, 1.0, audioCtx);
        smoothParam(compressorMakeup.gain, 1.0, audioCtx);
      }
    }

    // 7. Transient Shaper
    const transientVal = dials.transient !== undefined ? dials.transient : 0.0;
    if (transientShaper && transientMakeup) {
      if (transientVal > 0) {
        // Punch: slow attack lets the full transient hit slam through uncompressed.
        // Low threshold + high ratio crushes the sustain hard, creating maximum contrast.
        // High makeup gain then drives the now-prominent transients loud and forward.
        smoothParam(transientShaper.threshold, -34.0, audioCtx);                            // lower = catches more sustain
        smoothParam(transientShaper.ratio, 1.0 + (transientVal / 10.0) * 15.0, audioCtx); // up to 16:1 — hard sustain crush
        smoothParam(transientShaper.knee, 3.0, audioCtx);                                   // slightly harder knee for snappier onset
        smoothParam(transientShaper.attack, 0.060, audioCtx);                               // 60ms — more transient energy let through
        smoothParam(transientShaper.release, 0.200, audioCtx);                              // 200ms — sustain stays compressed longer
        
        // Makeup gain up to +130% (~+7dB) so the freed transients truly slam forward
        const transientMakeupGain = 1.0 + (transientVal / 10.0) * 1.30;
        smoothParam(transientMakeup.gain, transientMakeupGain, audioCtx);
      } else if (transientVal < 0) {
        // Soft / Squash Transients: instant attack (1ms) squashes initial hit instantly, fast release
        smoothParam(transientShaper.threshold, -28.0, audioCtx);
        smoothParam(transientShaper.ratio, 1.0 + (-transientVal / 10.0) * 8.0, audioCtx); // up to 9.0 ratio
        smoothParam(transientShaper.knee, 2.0, audioCtx);
        smoothParam(transientShaper.attack, 0.001, audioCtx);
        smoothParam(transientShaper.release, 0.10, audioCtx);
        
        // Slight attenuation or neutral gain
        const transientMakeupGain = 1.0 + (transientVal / 10.0) * 0.1; // down to -10%
        smoothParam(transientMakeup.gain, transientMakeupGain, audioCtx);
      } else {
        // Transparent
        smoothParam(transientShaper.ratio, 1.0, audioCtx);
        smoothParam(transientMakeup.gain, 1.0, audioCtx);
      }
    }

    // 8. Stereo Widener (Loudness-compensated Mid-Side Stereo Width control)
    const targetWidth = dials.width !== undefined ? dials.width : 1.0;
    let midGainVal = 1.0;
    let sideGainVal = targetWidth;

    if (targetWidth < 1.0) {
      // Mono/narrow: slightly boost mid to preserve power and solidity
      midGainVal = 1.0 + (1.0 - targetWidth) * 0.15;
    } else {
      // Extra wide: slightly attenuate mid to increase spatial contrast and feel extremely wide
      midGainVal = 1.0 - (targetWidth - 1.0) * 0.15;
    }

    if (chain.midGain) {
      smoothParam(chain.midGain.gain, 0.5 * midGainVal, audioCtx);
    }
    smoothParam(sideWidth.gain, sideGainVal, audioCtx);

    // 9. Stereo Panning
    const panVal = dials.pan !== undefined ? dials.pan : 0.0;
    if (pannerNode) {
      smoothParam(pannerNode.pan, panVal, audioCtx);
    }

    // 10. Reverb Dry/Wet
    const dryVal = dials.revdry !== undefined ? dials.revdry : 1.0;
    const wetVal = dials.revwet !== undefined ? dials.revwet : 0.0;
    if (reverbDryGain) {
      if (dryVal === 0.0) {
        reverbDryGain.gain.cancelScheduledValues(audioCtx.currentTime);
        reverbDryGain.gain.setValueAtTime(0.0, audioCtx.currentTime);
      } else {
        smoothParam(reverbDryGain.gain, dryVal, audioCtx);
      }
    }
    if (reverbWetGain) {
      if (wetVal === 0.0) {
        reverbWetGain.gain.cancelScheduledValues(audioCtx.currentTime);
        reverbWetGain.gain.setValueAtTime(0.0, audioCtx.currentTime);
      } else {
        smoothParam(reverbWetGain.gain, wetVal * 0.95, audioCtx);
      }
    }

    // 11. Brickwall Limiter threshold protection
    const limiterThresh = dials.limiter !== undefined ? dials.limiter : -0.5;
    smoothParam(limiter.threshold, limiterThresh, audioCtx);

    // Apply Multi-Solo routing
    const hasSolo = isEnabled && soloBandIndexes && soloBandIndexes.length > 0;
    
    if (hasSolo) {
      smoothParam(directSoloGain.gain, 0.0, audioCtx);

      for (let i = 0; i < 11; i++) {
        if (soloBandIndexes.includes(i)) {
          const soloBand = eqSettings.bands[i];
          let soloFreq = soloBand.frequency;
          
          const isFittedFreq = (soloBand.type === "lowpass" || soloBand.type === "highpass" || soloBand.type === "bandpass");
          if (isFittedFreq) {
            soloFreq = mapSliderToFrequency(i, soloBand.gain, soloBand.defaultFrequency || soloBand.frequency);
          }

          smoothParam(soloFilters[i].frequency, soloFreq, audioCtx);
          smoothParam(soloFilters[i].Q, 1.8, audioCtx);
          smoothParam(soloFilterGains[i].gain, 1.0, audioCtx);
        } else {
          smoothParam(soloFilterGains[i].gain, 0.0, audioCtx);
        }
      }
    } else {
      smoothParam(directSoloGain.gain, 1.0, audioCtx);
      
      for (let i = 0; i < 11; i++) {
        smoothParam(soloFilterGains[i].gain, 0.0, audioCtx);
      }
    }
  }

  // Apply settings to all active audio contexts
  function updateAllChains() {
    for (const audioCtx of activeContexts) {
      if (audioCtx.state === "closed") {
        activeContexts.delete(audioCtx);
        eqChains.delete(audioCtx);
        continue;
      }
      const chain = eqChains.get(audioCtx);
      if (chain) applySettingsToChain(chain);
    }
  }

  // --- Web Audio Hooking / Monkey Patching ---
  const OriginalAudioContext = window.AudioContext || window.webkitAudioContext;

  if (OriginalAudioContext) {
    const HookedAudioContext = function(...args) {
      const context = new OriginalAudioContext(...args);
      activeContexts.add(context);
      console.log("[Peaks] Intercepted new AudioContext creation.");
      
      setTimeout(() => {
        if (context.state !== "closed") {
          getOrCreateEQChain(context);
        }
      }, 100);

      return context;
    };

    HookedAudioContext.prototype = OriginalAudioContext.prototype;
    window.AudioContext = HookedAudioContext;
    if (window.webkitAudioContext) window.webkitAudioContext = HookedAudioContext;
  }

  const originalConnect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function(destination, output = 0, input = 0) {
    if (this.isPeaksNode) {
      return originalConnect.call(this, destination, output, input);
    }

    if (destination && destination.constructor && 
        (destination.constructor.name === "AudioDestinationNode" || destination === this.context.destination)) {
      
      const chain = getOrCreateEQChain(this.context);
      
      originalConnect.call(this, chain.inputNode, output, 0);
      originalConnect.call(chain.masterGainNode, chain.analyserNode, 0, 0);
      originalConnect.call(chain.analyserNode, destination, 0, input);
      
      return chain.analyserNode;
    }
    
    return originalConnect.call(this, destination, output, input);
  };

  // --- Traversal to find all video & audio elements, including those inside Shadow DOMs ---
  function findAllMediaElements(root = document, elements = []) {
    if (!root) return elements;

    // Find direct media elements in this root
    try {
      const media = root.querySelectorAll("video, audio");
      media.forEach(el => {
        if (!elements.includes(el)) {
          elements.push(el);
        }
      });
    } catch (e) {}

    // Traverse shadow DOMs recursively
    try {
      const allElements = root.querySelectorAll("*");
      allElements.forEach(el => {
        if (el.shadowRoot) {
          findAllMediaElements(el.shadowRoot, elements);
        }
      });
    } catch (e) {}

    return elements;
  }

  // --- Resume suspended AudioContexts on user gesture ---
  const resumeContexts = () => {
    for (const audioCtx of activeContexts) {
      if (audioCtx.state === "suspended") {
        audioCtx.resume().catch(() => {});
      }
    }
  };
  
  // Register gesture listeners with high-priority capture
  window.addEventListener("click", resumeContexts, { capture: true, passive: true });
  window.addEventListener("keydown", resumeContexts, { capture: true, passive: true });
  window.addEventListener("mousedown", resumeContexts, { capture: true, passive: true });
  window.addEventListener("touchstart", resumeContexts, { capture: true, passive: true });

  // --- Direct HTMLMediaElement Capture ---
  let extensionAudioCtx = null;
  const capturedElements = new Set();

  function captureMediaElement(element) {
    if (capturedElements.has(element)) return;
    capturedElements.add(element);

    console.log("[Peaks] Capturing media element:", element);

    try {
      if (element.src && !element.src.startsWith(window.location.origin) && !element.src.startsWith("blob:")) {
        element.crossOrigin = "anonymous";
      }

      if (!extensionAudioCtx) {
        extensionAudioCtx = new OriginalAudioContext();
        activeContexts.add(extensionAudioCtx);
      }

      const source = extensionAudioCtx.createMediaElementSource(element);
      const chain = getOrCreateEQChain(extensionAudioCtx);

      source.connect(chain.inputNode);
      originalConnect.call(chain.masterGainNode, chain.analyserNode, 0, 0);
      originalConnect.call(chain.analyserNode, extensionAudioCtx.destination, 0, 0);
      
      console.log("[Peaks] Media element captured successfully.");
    } catch (err) {
      console.warn("[Peaks] Failed to capture media element:", err);
      capturedElements.delete(element);
    }
  }

  const originalPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function() {
    resumeContexts(); // Wake up suspended context on user action
    captureMediaElement(this);
    return originalPlay.apply(this, arguments);
  };

  setInterval(() => {
    const mediaElements = findAllMediaElements();
    mediaElements.forEach(el => {
      if (!el.paused && !capturedElements.has(el)) {
        captureMediaElement(el);
      }
    });
  }, 1000);

  // --- Communication Bridge ---
  function startAnalyserLoop() {
    if (!popupConnected) return;
    
    function sendFreqs() {
      if (!popupConnected) return;
      if (latestAnalyser) {
        const dataArray = new Uint8Array(latestAnalyser.frequencyBinCount);
        latestAnalyser.getByteFrequencyData(dataArray);
        const freqs = Array.from(dataArray);
        window.postMessage({ source: "peaks-main", type: "ANALYSER_DATA", freqs }, "*");
      }
      requestAnimationFrame(sendFreqs);
    }
    
    requestAnimationFrame(sendFreqs);
  }

  // Listen for updates from the isolated-world content script via window postMessage
  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.source !== "peaks-content") {
      return;
    }

    const message = event.data;

    if (message.type === "UPDATE_EQ_SETTINGS") {
      eqSettings = message.settings;
      // Convert indices explicitly to numbers to prevent any serialization type mismatch
      soloBandIndexes = (message.soloBandIndexes || []).map(Number);
      updateAllChains();
    } else if (message.type === "POPUP_CONNECTED") {
      popupConnected = message.connected;
      if (popupConnected) {
        startAnalyserLoop();
      }
    }
  });

  window.postMessage({ source: "peaks-main", type: "REQUEST_STATE" }, "*");
})();
