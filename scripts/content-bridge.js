// Peaks - Isolated-World Content Script Bridge
// Reads saved storage settings and bridges popup messages to the main-world script.

(function () {
  let currentSettings = null;
  let currentSoloIndexes = [];

  // Send settings down to main-world script
  function sendSettingsToMainWorld() {
    if (!currentSettings) return;
    window.postMessage({
      source: "peaks-content",
      type: "UPDATE_EQ_SETTINGS",
      settings: currentSettings,
      soloBandIndexes: currentSoloIndexes
    }, "*");
  }

  // Load from local storage
  function loadAndApplySettings() {
    chrome.storage.local.get(["eqSettings", "soloBandIndexes"], (result) => {
      if (result.eqSettings) {
        currentSettings = result.eqSettings;
        currentSoloIndexes = result.soloBandIndexes || [];
        sendSettingsToMainWorld();
      }
    });
  }

  // Listen for updates from the extension popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "POPUP_STATE_CHANGED") {
      currentSettings = message.settings;
      currentSoloIndexes = message.soloIndexes || [];
      sendSettingsToMainWorld();
      if (sendResponse) sendResponse({ status: "success" });
    }
  });

  // Listen for storage changes from other popup pages
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.eqSettings) {
      currentSettings = changes.eqSettings.newValue;
      sendSettingsToMainWorld();
    }
    if (areaName === "local" && changes.soloBandIndexes) {
      currentSoloIndexes = changes.soloBandIndexes.newValue || [];
      sendSettingsToMainWorld();
    }
  });

  // Listen for state requests from main-world script
  window.addEventListener("message", (event) => {
    if (event.source === window && event.data && event.data.source === "peaks-main") {
      if (event.data.type === "REQUEST_STATE") {
        loadAndApplySettings();
      }
    }
  });

  // Long-lived port connection from the popup for real-time visualizer data
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === "peaks-analyser") {
      // Notify main world that popup is connected
      window.postMessage({ source: "peaks-content", type: "POPUP_CONNECTED", connected: true }, "*");
      
      port.onDisconnect.addListener(() => {
        window.postMessage({ source: "peaks-content", type: "POPUP_CONNECTED", connected: false }, "*");
      });

      // Listen for message from main world containing frequency data and forward to popup
      const handleMainWorldMessage = (event) => {
        if (event.source === window && event.data && event.data.source === "peaks-main") {
          if (event.data.type === "ANALYSER_DATA") {
            try {
              port.postMessage({ type: "AUDIO_FREQS", freqs: event.data.freqs });
            } catch (err) {
              // Port closed, clean up listener
              window.removeEventListener("message", handleMainWorldMessage);
            }
          }
        }
      };

      window.addEventListener("message", handleMainWorldMessage);
    }
  });

  // Initial load
  loadAndApplySettings();
})();
