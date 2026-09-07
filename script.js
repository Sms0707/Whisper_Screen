const { ipcRenderer } = require('electron');

// Replace with your actual NVIDIA API key
const NVIDIA_API_KEY = "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"; 
const API_URL = "https://integrate.api.nvidia.com/v1/chat/completions"; 
const MODEL = "meta/llama-3.2-11b-vision-instruct"; 

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
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

// Audio detection frame counters (smoothing to prevent rapid toggle noise)
let speechFrameCount = 0;
let silenceFrameCount = 0;

// Global reference prevents Chromium Garbage Collection from killing active speech mid-sentence
let currentUtterance = null;

if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => { window.speechSynthesis.getVoices(); };
}

pauseSlider.addEventListener("input", () => { pauseVal.textContent = pauseSlider.value + "s"; });
threshSlider.addEventListener("input", () => { threshVal.textContent = threshSlider.value; });

startBtn.addEventListener("click", async () => {
  stopCapture(); // Reset existing state prior to initialization
  
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
  
  // Listen for media stream ending (e.g. host stops screen share or closes Meet)
  stream.getVideoTracks()[0].addEventListener("ended", stopCapture);
  
  if (previewWrap) previewWrap.classList.remove("empty");
  startBtn.disabled = true;
  stopBtn.disabled = false;

  speakText("Whisper activated.");
  setStatus("Monitoring host voice and screen changes...");
});

stopBtn.addEventListener("click", stopCapture);

if (closeBtn) {
  closeBtn.addEventListener("click", () => {
    stopCapture();
    ipcRenderer.send('close-overlay');
  });
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
  analyser.smoothingTimeConstant = 0.5;

  source.connect(highpass); highpass.connect(lowpass); lowpass.connect(analyser);

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function checkAudio() {
    if (!analyser) return;
    analyser.getByteFrequencyData(dataArray);
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) { sum += dataArray[i] * dataArray[i]; }
    const rms = Math.sqrt(sum / bufferLength);
    const dynamicThreshold = Number(threshSlider.value);

    // Smooth microphone readings to eliminate speech audio breaking
    if (rms > dynamicThreshold) {
      speechFrameCount++;
      silenceFrameCount = 0;
      if (speechFrameCount >= 3) {
        handleSpeechDetected();
      }
    } else {
      silenceFrameCount++;
      speechFrameCount = 0;
      if (silenceFrameCount >= 5) {
        handleSilenceDetected();
      }
    }

    animFrameId = requestAnimationFrame(checkAudio);
  }
  checkAudio();
}

function handleSpeechDetected() {
  if (!isHostSpeaking) {
    isHostSpeaking = true;
    speechBadge.className = "badge speaking";
    speechState.textContent = "Host Speaking";
    
    // Instantly cancel AI speech if host resumes talking
    if ('speechSynthesis' in window && window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      isNarratingVoice = false;
      setStatus("Host speaking. Cleared speech queue.");
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
      
      // Speak preloaded description immediately when host pauses
      if (preloadedNarration) {
        setStatus("Host paused. Narrating preloaded description...");
        const entry = logEntry(preloadedNarration);
        if (!muteToggle.checked) { speakText(preloadedNarration, entry); }
        preloadedNarration = "";
      } else if (hasPendingScreenChange) {
        hasPendingScreenChange = false;
        triggerNarration("Host paused after screen change");
      }
    }, pauseDelay);
  }
}

function startVisualMotionWatcher() {
  visualCheckInterval = setInterval(() => {
    if (isRequesting || isPreloading || !video.videoWidth || !stream) return;

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
      speechState.textContent = "Screen Changed";
      previousPixels.set(imgData);
    } else if (hasPendingScreenChange) {
      if (Date.now() - lastScreenChangedTime > 1200) {
        speechBadge.className = isHostSpeaking ? "badge speaking" : "badge silent";
        speechState.textContent = isHostSpeaking ? "Host Speaking" : "Screen Settled";
        
        if (isHostSpeaking) {
          // Preload description in background while host speaks
          preloadScreenDescription();
        } else {
          hasPendingScreenChange = false;
          triggerNarration("Screen changed while host silent");
        }
      }
    }
  }, 400);
}

async function preloadScreenDescription() {
  if (isPreloading) return;
  const frameData = getFrame();
  if (!frameData || frameData.fingerprint === lastAnalyzedImageHash) return;

  isPreloading = true;
  setStatus("Background pre-loading screen description...");
  try {
    const description = await describeScreen(frameData.base64);
    if (description && description.length > 5) {
      preloadedNarration = description;
      lastAnalyzedImageHash = frameData.fingerprint;
      setStatus("Description preloaded. Waiting for host pause.");
    }
  } catch (err) {
    setStatus("Ready.");
  } finally { isPreloading = false; }
}

async function triggerNarration(triggerReason) {
  if (isRequesting || isHostSpeaking) return;
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
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${NVIDIA_API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ 
        role: "user", 
        content: [
          { type: "text", text: "Describe ONLY the presentation, shared slides, or main document content. Completely ignore any floating UI windows, overlays, or control bars on top of the screen. Provide only relevant context in 1 to 2 concise sentences." }, 
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
        ] 
      }],
      max_tokens: 80,
      temperature: 0.2
    })
  });
  
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  const data = await response.json();
  const aiText = data?.choices?.[0]?.message?.content;
  
  if (!aiText) throw new Error("AI returned empty response.");
  return aiText.trim();
}

function speakText(text, entryEl) {
  if (!("speechSynthesis" in window) || (muteToggle && muteToggle.checked)) return;

  // Never attempt TTS playback if host is currently speaking
  if (isHostSpeaking) return;

  window.speechSynthesis.cancel();

  currentUtterance = new SpeechSynthesisUtterance(text);
  currentUtterance.rate = 1.1; 
  currentUtterance.pitch = 1.0;
  
  const voices = window.speechSynthesis.getVoices();
  const englishVoice = voices.find(v => v.lang.startsWith("en") && (v.name.includes("Natural") || v.name.includes("Google") || v.name.includes("Samantha"))) || voices.find(v => v.lang.startsWith("en"));
  if (englishVoice) currentUtterance.voice = englishVoice;

  currentUtterance.onstart = () => { 
    isNarratingVoice = true; 
    if (entryEl) entryEl.classList.add("speaking"); 
    setStatus("Narrating aloud..."); 
  };
  
  currentUtterance.onend = () => { 
    isNarratingVoice = false; 
    if (entryEl) entryEl.classList.remove("speaking"); 
    setStatus("Finished speaking. Listening for changes..."); 
    currentUtterance = null;
  };
  
  currentUtterance.onerror = () => { 
    isNarratingVoice = false; 
    if (entryEl) entryEl.classList.remove("speaking"); 
    currentUtterance = null;
  };

  window.speechSynthesis.speak(currentUtterance);
}

function stopCapture() {
  if (silenceTimer) clearTimeout(silenceTimer);
  if (animFrameId) cancelAnimationFrame(animFrameId);
  if (visualCheckInterval) clearInterval(visualCheckInterval);
  
  if (audioCtx) {
    try { audioCtx.close(); } catch (e) {}
    audioCtx = null;
  }
  
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }

  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }

  isNarratingVoice = false;
  isHostSpeaking = false;
  isRequesting = false;
  isPreloading = false;
  preloadedNarration = "";
  hasPendingScreenChange = false;
  currentUtterance = null;

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

// IPC Listeners
ipcRenderer.on('force-stop-capture', () => {
  stopCapture();
});

ipcRenderer.on('trigger-silence', () => {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  isNarratingVoice = false;
  setStatus("Silenced.");
});

ipcRenderer.on('trigger-replay', () => {
  const lastReplayBtn = document.querySelector('.entry .replay');
  if (lastReplayBtn) {
    lastReplayBtn.click();
  } else {
    speakText("No recent context to replay.");
  }
});

window.addEventListener('beforeunload', () => {
  stopCapture();
});
