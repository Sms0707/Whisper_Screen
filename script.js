const { ipcRenderer } = require('electron');

// Replace with your actual NVIDIA API key starting with "nvapi-..."
const NVIDIA_API_KEY = "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"; 

// NVIDIA NIM OpenAI-compatible endpoint
const API_URL = "https://integrate.api.nvidia.com/v1/chat/completions"; 

// NVIDIA hosted multimodal vision model
const MODEL = "meta/llama-3.2-11b-vision-instruct";
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const testVoiceBtn = document.getElementById("testVoiceBtn");
const closeBtn = document.getElementById("closeBtn");
const silenceBtn = document.getElementById("silenceBtn"); 
const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");
const video = document.getElementById("hiddenVideo");
const canvas = document.getElementById("hiddenCanvas");
const ctx = canvas.getContext("2d");
const motionCanvas = document.getElementById("motionCanvas");
const mCtx = motionCanvas.getContext("2d");
const previewWrap = document.getElementById("previewWrap");
const speechBadge = document.getElementById("speechBadge");
const speechState = document.getElementById("speechState");
const pauseSlider = document.getElementById("pauseSlider");
const pauseVal = document.getElementById("pauseVal");
const threshSlider = document.getElementById("threshSlider");
const threshVal = document.getElementById("threshVal");
const muteToggle = document.getElementById("muteToggle");

// Engine State
let stream = null;
let audioCtx = null;
let analyser = null;
let animFrameId = null;
let visualCheckInterval = null;

let isHostSpeaking = false;
let isNarratingVoice = false;
let silenceTimer = null;
let isRequesting = false;

let preloadedNarration = "";
let isPreloading = false;
let lastAnalyzedImageHash = "";

let previousPixels = null;
let lastScreenChangedTime = 0;
let hasPendingScreenChange = false;

// Preload Web Speech voices
if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    window.speechSynthesis.getVoices();
  };
}

if (testVoiceBtn) {
  testVoiceBtn.addEventListener("click", () => {
    speakText("Audio voice engine is active and ready.");
    setStatus("Voice synthesis engine tested successfully.");
  });
}

if (pauseSlider) {
  pauseSlider.addEventListener("input", () => { pauseVal.textContent = pauseSlider.value + "s"; });
}

if (threshSlider) {
  threshSlider.addEventListener("input", () => { threshVal.textContent = threshSlider.value; });
}

startBtn.addEventListener("click", async () => {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 10 }, audio: true });
  } catch (err) {
    setStatus("Permission denied or sharing cancelled: " + err.message, true);
    return;
  }

  video.srcObject = stream;
  await video.play();

  if (stream.getAudioTracks().length > 0) {
    setupAudioAnalysis(stream);
  } else {
    setStatus("Running in Visual-Only mode (No audio track shared).", true);
  }

  startVisualMotionWatcher();
  stream.getVideoTracks()[0].addEventListener("ended", () => stopCapture());
  
  if (previewWrap) previewWrap.classList.remove("empty");
  startBtn.disabled = true;
  stopBtn.disabled = false;

  speakText("Whisper activated.");
  setStatus("Monitoring host voice and screen scrolls...");
});

stopBtn.addEventListener("click", () => stopCapture());

if (closeBtn) {
  closeBtn.addEventListener("click", () => {
    ipcRenderer.send('close-overlay');
  });
}

if (silenceBtn) {
  silenceBtn.addEventListener("click", silenceAudioNow);
}

function silenceAudioNow() {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  isNarratingVoice = false;
  setStatus("Silenced by user.");
  const activeEntries = document.querySelectorAll(".entry.speaking");
  activeEntries.forEach(entry => entry.classList.remove("speaking"));
}

function setupAudioAnalysis(mediaStream) {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioCtx.createMediaStreamSource(mediaStream);
  const highpass = audioCtx.createBiquadFilter();
  highpass.type = "highpass"; highpass.frequency.value = 250;
  const lowpass = audioCtx.createBiquadFilter();
  lowpass.type = "lowpass"; lowpass.frequency.value = 3500;

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.4;

  source.connect(highpass); highpass.connect(lowpass); lowpass.connect(analyser);

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function checkAudio() {
    analyser.getByteFrequencyData(dataArray);
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) { sum += dataArray[i] * dataArray[i]; }
    const rms = Math.sqrt(sum / bufferLength);
    const dynamicThreshold = Number(threshSlider.value);

    if (rms > dynamicThreshold) { handleSpeechDetected(); } 
    else { handleSilenceDetected(); }

    animFrameId = requestAnimationFrame(checkAudio);
  }
  checkAudio();
}

function handleSpeechDetected() {
  if (!isHostSpeaking) {
    isHostSpeaking = true;
    speechBadge.className = "badge speaking";
    speechState.textContent = "Host Speaking";
    if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
      window.speechSynthesis.pause();
      setStatus("Host interrupted. Pausing AI...");
    }
  }
  if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
}

function handleSilenceDetected() {
  if (isHostSpeaking && !silenceTimer) {
    const pauseDelay = Number(pauseSlider.value) * 1000;
    silenceTimer = setTimeout(() => {
      isHostSpeaking = false;
      speechBadge.className = "badge silent";
      speechState.textContent = "Host Paused";
      
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
        setStatus("Host paused. Resuming AI narration...");
      } else {
        if (preloadedNarration) {
          setStatus("Speaking pre-loaded description instantly.");
          const entry = logEntry(preloadedNarration);
          if (!muteToggle.checked) { speakText(preloadedNarration, entry); }
          preloadedNarration = "";
        } else {
          triggerNarration("Host finished speaking");
        }
      }
    }, pauseDelay);
  }
}

function startVisualMotionWatcher() {
  visualCheckInterval = setInterval(() => {
    if (isRequesting || isPreloading || (isNarratingVoice && !window.speechSynthesis.paused) || !video.videoWidth) return;

    mCtx.drawImage(video, 0, 0, 64, 64);
    const imgData = mCtx.getImageData(0, 0, 64, 64).data;

    if (!previousPixels) { previousPixels = new Uint8ClampedArray(imgData); return; }

    let diff = 0;
    for (let i = 0; i < imgData.length; i += 4) {
      diff += Math.abs(imgData[i] - previousPixels[i]);
      diff += Math.abs(imgData[i + 1] - previousPixels[i + 1]);
      diff += Math.abs(imgData[i + 2] - previousPixels[i + 2]);
    }

    const avgDiff = diff / (64 * 64 * 3);
    if (avgDiff > 7.0) {
      lastScreenChangedTime = Date.now();
      hasPendingScreenChange = true;
      speechBadge.className = "badge motion";
      speechState.textContent = "Screen Scrolling";
      previousPixels.set(imgData);
    } else if (hasPendingScreenChange) {
      if (Date.now() - lastScreenChangedTime > 1200) {
        hasPendingScreenChange = false;
        speechBadge.className = "badge silent";
        speechState.textContent = "Screen Settled";
        if (isHostSpeaking) { preloadScreenDescription(); } 
        else { triggerNarration("Screen scrolled silently"); }
      }
    }
  }, 400);
}

async function preloadScreenDescription() {
  if (isPreloading) return;
  const frameData = getFrame();
  if (!frameData || frameData.fingerprint === lastAnalyzedImageHash) return;

  isPreloading = true;
  setStatus("Background pre-loading description...");
  try {
    const description = await describeScreen(frameData.base64);
    if (description && description.length > 5) {
      preloadedNarration = description;
      lastAnalyzedImageHash = frameData.fingerprint;
      setStatus("Description pre-loaded. Waiting for pause.");
    }
  } catch (err) {
    setStatus("Ready.");
  } finally { isPreloading = false; }
}

async function triggerNarration(triggerReason) {
  if (isRequesting || isNarratingVoice) return;
  const frameData = getFrame();
  if (!frameData || frameData.fingerprint === lastAnalyzedImageHash) return;

  isRequesting = true;
  setStatus(`Describing content (${triggerReason})...`);
  try {
    const description = await describeScreen(frameData.base64);
    if (description && description.length > 5) {
      lastAnalyzedImageHash = frameData.fingerprint;
      const entry = logEntry(description);
      if (!muteToggle.checked) { speakText(description, entry); }
    }
  } catch (err) {
    setStatus("API Error: " + err.message, true);
  } finally { isRequesting = false; }
}

function getFrame() {
  const w = video.videoWidth; const h = video.videoHeight;
  if (!w || !h) return null;
  canvas.width = w; canvas.height = h;
  ctx.drawImage(video, 0, 0, w, h);
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = 16; sampleCanvas.height = 16;
  sampleCanvas.getContext("2d").drawImage(canvas, 0, 0, 16, 16);
  const fingerprint = sampleCanvas.toDataURL();
  return { base64: canvas.toDataURL("image/jpeg", 0.7).split(",")[1], fingerprint };
}

async function describeScreen(base64Image) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json", 
      "Authorization": `Bearer ${NVIDIA_API_KEY}` // Updated variable here
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ 
        role: "user", 
        content: [
          { type: "text", text: "Briefly describe the necessary information currently shown on this screen in a short, crisp way. Skip redundant UI elements or menus. Provide only the relevant context in 1 to 2 concise sentences." }, 
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
        ] 
      }],
      max_tokens: 80,
      temperature: 0.2
    })
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  
  const data = await response.json();
  const aiText = data?.choices?.[0]?.message?.content;
  
  if (!aiText) {
    throw new Error("AI returned an empty response.");
  }

  return aiText.trim();
}
function speakText(text, entryEl) {
  if (!("speechSynthesis" in window) || (muteToggle && muteToggle.checked)) return;

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.15; 
  utterance.pitch = 1.0;
  
  const voices = window.speechSynthesis.getVoices();
  const englishVoice = voices.find(v => v.lang.startsWith("en") && (v.name.includes("Natural") || v.name.includes("Google") || v.name.includes("Samantha"))) || voices.find(v => v.lang.startsWith("en"));
  if (englishVoice) utterance.voice = englishVoice;

  utterance.onstart = () => { 
    isNarratingVoice = true; 
    if (entryEl) entryEl.classList.add("speaking"); 
    setStatus("Narrating aloud..."); 
  };
  
  utterance.onend = () => { 
    isNarratingVoice = false; 
    if (entryEl) entryEl.classList.remove("speaking"); 
    setStatus("Finished speaking. Listening for changes..."); 
  };
  
  utterance.onerror = () => { 
    isNarratingVoice = false; 
    if (entryEl) entryEl.classList.remove("speaking"); 
  };

  setTimeout(() => {
    window.speechSynthesis.speak(utterance);
  }, 50);
}

function stopCapture(preserveSpeech = false) {
  if (silenceTimer) clearTimeout(silenceTimer);
  if (animFrameId) cancelAnimationFrame(animFrameId);
  if (visualCheckInterval) clearInterval(visualCheckInterval);
  
  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  
  if (!preserveSpeech && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }

  isHostSpeaking = false;
  isNarratingVoice = false;
  isRequesting = false;
  isPreloading = false;

  speechBadge.className = "badge"; 
  speechState.textContent = "Idle";
  if (previewWrap) previewWrap.classList.add("empty");
  startBtn.disabled = false; 
  stopBtn.disabled = true;
  setStatus("Stopped.");
}

function setStatus(msg, isError) {
  if (!statusEl) return;
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", Boolean(isError));
}

function logEntry(text) {
  if (!logEl) return null;
  const div = document.createElement("div");
  div.className = "entry";
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  div.innerHTML = `<span class="time">${time}</span><span class="desc">${text}</span><button class="replay" title="Replay aloud"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></button>`;
  div.querySelector(".replay").addEventListener("click", () => speakText(text, div));
  logEl.prepend(div);
  return div;
}

/* =========================================
   IPC HANDLERS FOR CONTROL & SHORTCUTS
========================================= */

ipcRenderer.on('activate-whisper', () => {
  setStatus("Whisper Activated.");
  speakText("Whisper activated.");
});

ipcRenderer.on('deactivate-whisper', () => {
  setStatus("Deactivating...");
  stopCapture(true);
  speakText("Whisper deactivated.");
  setTimeout(() => {
    ipcRenderer.send('hide-window-now');
  }, 1200);
});

ipcRenderer.on('trigger-replay', () => {
  const lastReplayBtn = document.querySelector('.entry .replay');
  if (lastReplayBtn) {
    lastReplayBtn.click();
  } else {
    speakText("No recent context to replay.");
  }
});

ipcRenderer.on('trigger-silence', silenceAudioNow);

ipcRenderer.on('force-stop-capture', () => {
  stopCapture(false);
});
