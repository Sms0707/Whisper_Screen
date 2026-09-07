// --- NVIDIA NIM VISION CONFIGURATION ---
const NVIDIA_API_KEY = "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"; // Replace with your actual NVIDIA key
const API_URL = "https://integrate.api.nvidia.com/v1/chat/completions"; 
const MODEL = "meta/llama-3.2-11b-vision-instruct"; 

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

// Global utterance reference to prevent browser garbage collection cutoffs
let currentUtterance = null;

if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => { window.speechSynthesis.getVoices(); };
}

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

  // Wake up speech synthesis engine on user gesture
  const wakeUp = new SpeechSynthesisUtterance(" ");
  wakeUp.volume = 0;
  window.speechSynthesis.speak(wakeUp);

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
  if (previewWrap) previewWrap.classList.remove("empty");
  startBtn.disabled = true;
  stopBtn.disabled = false;
  setStatus("Monitoring host voice and screen changes...");
});

stopBtn.addEventListener("click", stopCapture);

// ---- 1. AUDIO ANALYSIS & DYNAMIC NOISE GATE ----
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
    if (!analyser) return;

    // Skip audio analysis while the AI is speaking to prevent loopback self-triggering
    if (isNarratingVoice) {
      animFrameId = requestAnimationFrame(checkAudio);
      return;
    }

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

    // Instantly kill AI audio if host starts talking
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      isNarratingVoice = false;
      setStatus("Host speaking. Cleared speech queue.");
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
    }, pauseDelay);
  }
}

// ---- 2. VISUAL MOTION DETECTION & PRELOADING ----
function startVisualMotionWatcher() {
  visualCheckInterval = setInterval(() => {
    if (isRequesting || isPreloading || !video.videoWidth) return;

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

// ---- 3. NVIDIA NIM VISION API HANDLER ----
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

async function describeScreen(base64Image) {
  const response = await fetch(
    API_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${NVIDIA_API_KEY}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Describe ONLY the presentation, shared slides, or main document content. Completely ignore any floating UI windows or overlays. Explain clearly and completely in 2 concise sentences what content or section is shown."
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
        max_tokens: 100,
        temperature: 0.2
      })
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const aiText = data?.choices?.[0]?.message?.content;
  if (!aiText) throw new Error("AI returned empty response.");
  return aiText.trim();
}

// ---- 4. ROBUST TEXT-TO-SPEECH ENGINE ----
function speakText(text, entryEl) {
  if (!("speechSynthesis" in window) || (muteToggle && muteToggle.checked)) return;

  if (window.speechSynthesis.paused) {
    window.speechSynthesis.resume();
  }

  window.speechSynthesis.cancel();

  currentUtterance = new SpeechSynthesisUtterance(text);
  currentUtterance.rate = 1.15; 
  currentUtterance.pitch = 1.0;
  currentUtterance.volume = 1.0;

  const voices = window.speechSynthesis.getVoices();
  const englishVoice = voices.find(v => v.lang.startsWith("en") && (v.name.includes("Natural") || v.name.includes("Google") || v.name.includes("Samantha"))) || voices.find(v => v.lang.startsWith("en"));
  if (englishVoice) currentUtterance.voice = englishVoice;

  currentUtterance.onstart = () => {
    isNarratingVoice = true;
    if (entryEl) entryEl.classList.add("speaking");
    setStatus("Narrating aloud...");
  };

  currentUtterance.onend = () => {
    setTimeout(() => { isNarratingVoice = false; }, 400); // Grace period prevents mic pickup echo
    if (entryEl) entryEl.classList.remove("speaking");
    setStatus("Finished speaking. Listening for changes...");
    currentUtterance = null;
  };

  currentUtterance.onerror = (e) => {
    console.error("SpeechSynthesis error:", e);
    isNarratingVoice = false;
    if (entryEl) entryEl.classList.remove("speaking");
    currentUtterance = null;
  };

  isNarratingVoice = true;
  window.speechSynthesis.speak(currentUtterance);
}

function stopCapture() {
  if (silenceTimer) clearTimeout(silenceTimer);
  if (animFrameId) cancelAnimationFrame(animFrameId);
  if (visualCheckInterval) clearInterval(visualCheckInterval);
  if (audioCtx) {
    try { audioCtx.close(); } catch(e){}
    audioCtx = null;
  }
  if (stream) stream.getTracks().forEach(t => t.stop());
  window.speechSynthesis.cancel();

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
