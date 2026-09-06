// --- HUGGING FACE ROUTER CONFIGURATION ---
// SECURITY NOTE: Never commit active API keys to GitHub. Set this up using environment variables or a configuration file in a production environment.
const HF_TOKEN = "YOUR_HUGGINGFACE_TOKEN_HERE"; 
const API_URL = "https://router.huggingface.co/v1/chat/completions"; 
const MODEL = "Qwen/Qwen3.8-27B"; 

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const testVoiceBtn = document.getElementById("testVoiceBtn");
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

// Pre-loading variables
let preloadedNarration = "";
let isPreloading = false;
let lastAnalyzedImageHash = "";

// Visual delta tracking
let previousPixels = null;
let lastScreenChangedTime = 0;
let hasPendingScreenChange = false;

testVoiceBtn.addEventListener("click", () => {
  speakText("Audio voice engine is active and ready.");
  setStatus("Voice synthesis engine tested successfully.");
});

pauseSlider.addEventListener("input", () => {
  pauseVal.textContent = pauseSlider.value + "s";
});

threshSlider.addEventListener("input", () => {
  threshVal.textContent = threshSlider.value;
});

startBtn.addEventListener("click", async () => {
  window.speechSynthesis.cancel();

  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 10 },
      audio: true
    });
  } catch (err) {
    setStatus("Permission denied or sharing cancelled: " + err.message, true);
    return;
  }

  video.srcObject = stream;
  await video.play();

  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length > 0) {
    setupAudioAnalysis(stream);
  } else {
    setStatus("Running in Visual-Only mode (No audio track shared).", true);
  }

  startVisualMotionWatcher();

  stream.getVideoTracks()[0].addEventListener("ended", stopCapture);
  previewWrap.classList.remove("empty");
  startBtn.disabled = true;
  stopBtn.disabled = false;
  setStatus("Monitoring host voice and screen scrolls...");
});

stopBtn.addEventListener("click", stopCapture);

// ---- 1. AUDIO ANALYSIS (VOICE, SILENCE & INTERRUPTION) ----
function setupAudioAnalysis(mediaStream) {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioCtx.createMediaStreamSource(mediaStream);

  const highpass = audioCtx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 250;

  const lowpass = audioCtx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 3500;

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.4;

  source.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(analyser);

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function checkAudio() {
    analyser.getByteFrequencyData(dataArray);

    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      sum += dataArray[i] * dataArray[i];
    }
    const rms = Math.sqrt(sum / bufferLength);
    const dynamicThreshold = Number(threshSlider.value);

    if (rms > dynamicThreshold) {
      handleSpeechDetected();
    } else {
      handleSilenceDetected();
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

    if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
      window.speechSynthesis.pause();
      setStatus("Host interrupted. Pausing AI...");
    }
  }

  if (silenceTimer) {
    clearTimeout(silenceTimer);
    silenceTimer = null;
  }
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
          if (!muteToggle.checked) {
            speakText(preloadedNarration, entry);
          }
          preloadedNarration = "";
        } else {
          triggerNarration("Host finished speaking");
        }
      }
    }, pauseDelay);
  }
}

// ---- 2. VISUAL MOTION DETECTION & PRELOADING ----
function startVisualMotionWatcher() {
  visualCheckInterval = setInterval(() => {
    if (isRequesting || isPreloading || (isNarratingVoice && !window.speechSynthesis.paused) || !video.videoWidth) return;

    mCtx.drawImage(video, 0, 0, 64, 64);
    const imgData = mCtx.getImageData(0, 0, 64, 64).data;

    if (!previousPixels) {
      previousPixels = new Uint8ClampedArray(imgData);
      return;
    }

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
      speechState.textContent = "Screen Scrolling / Changed";
      previousPixels.set(imgData);
    } else if (hasPendingScreenChange) {
      if (Date.now() - lastScreenChangedTime > 1200) {
        hasPendingScreenChange = false;
        speechBadge.className = "badge silent";
        speechState.textContent = "Screen Settled";

        if (isHostSpeaking) {
          preloadScreenDescription();
        } else {
          triggerNarration("Screen scrolled silently");
        }
      }
    }
  }, 400);
}

// Background worker that stores text without speaking
async function preloadScreenDescription() {
  if (isPreloading) return;

  const frameData = getFrame();
  if (!frameData) return;

  if (frameData.fingerprint === lastAnalyzedImageHash) return;

  isPreloading = true;
  setStatus("Background pre-loading screen description...");

  try {
    const description = await describeScreen(frameData.base64);
    if (description && description.length > 5) {
      preloadedNarration = description;
      lastAnalyzedImageHash = frameData.fingerprint;
      setStatus("Description pre-loaded. Waiting for host to pause.");
    }
  } catch (err) {
    console.warn("Preload error:", err);
    setStatus("Ready.");
  } finally {
    isPreloading = false;
  }
}

// ---- 3. HUGGING FACE ROUTER NARRATION HANDLER ----
async function triggerNarration(triggerReason) {
  if (isRequesting || isNarratingVoice) return;

  const frameData = getFrame();
  if (!frameData) return;

  if (frameData.fingerprint === lastAnalyzedImageHash) {
    setStatus("Screen unchanged since last narration.");
    return;
  }

  isRequesting = true;
  setStatus(`Describing new content (${triggerReason})...`);

  try {
    const description = await describeScreen(frameData.base64);
    if (description && description.length > 5) {
      lastAnalyzedImageHash = frameData.fingerprint;
      const entry = logEntry(description);
      if (!muteToggle.checked) {
        speakText(description, entry);
      }
    }
  } catch (err) {
    setStatus("API Error: " + err.message, true);
  } finally {
    isRequesting = false;
  }
}

function getFrame() {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;

  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(video, 0, 0, w, h);

  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = 16;
  sampleCanvas.height = 16;
  sampleCanvas.getContext("2d").drawImage(canvas, 0, 0, 16, 16);
  const fingerprint = sampleCanvas.toDataURL();

  const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
  return { 
    base64: dataUrl.split(",")[1],
    fingerprint: fingerprint
  };
}

// Rewired specifically for Hugging Face's OpenAI-compatible endpoint
async function describeScreen(base64Image) {
  const response = await fetch(
    API_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${HF_TOKEN}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Explain clearly and completely in 2 to 3 full sentences what new content, app view, list, or section is currently shown. Do not leave any sentence unfinished."
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${base64Image}`
                }
              }
            ]
          }
        ],
        max_tokens: 2048,
        temperature: 0.2
      })
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

// ---- 4. TEXT-TO-SPEECH ENGINE ----
function speakText(text, entryEl) {
  if (!("speechSynthesis" in window)) return;

  window.speechSynthesis.cancel();
  if (window.speechSynthesis.paused) {
    window.speechSynthesis.resume();
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.25; 
  utterance.pitch = 1.0;

  const voices = window.speechSynthesis.getVoices();
  const englishVoice = voices.find(v => v.lang.startsWith("en-US") || v.lang.startsWith("en-GB") || v.lang.startsWith("en"));
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

  utterance.onerror = (e) => {
    console.error("SpeechSynthesis error:", e);
    isNarratingVoice = false;
    if (entryEl) entryEl.classList.remove("speaking");
  };

  setTimeout(() => {
    window.speechSynthesis.speak(utterance);
  }, 100);
}

function stopCapture() {
  if (silenceTimer) clearTimeout(silenceTimer);
  if (animFrameId) cancelAnimationFrame(animFrameId);
  if (visualCheckInterval) clearInterval(visualCheckInterval);
  if (audioCtx) audioCtx.close();
  if (stream) stream.getTracks().forEach(t => t.stop());
  window.speechSynthesis.cancel();

  speechBadge.className = "badge";
  speechState.textContent = "Idle";
  previewWrap.classList.add("empty");
  startBtn.disabled = false;
  stopBtn.disabled = true;
  setStatus("Stopped.");
}

function setStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", Boolean(isError));
}

function logEntry(text) {
  const div = document.createElement("div");
  div.className = "entry";
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  div.innerHTML = `
    <span class="time">${time}</span>
    <span class="desc">${escapeHtml(text)}</span>
    <button class="replay" title="Replay aloud" aria-label="Replay">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
    </button>
  `;

  div.querySelector(".replay").addEventListener("click", () => speakText(text, div));
  logEl.prepend(div);
  return div;
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}
