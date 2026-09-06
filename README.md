# 👁️ Whisper Screen

> **Zero-Latency Real-Time Accessibility Narration for Screen Sharing**

Whisper Screen bridges the accessibility gap for visually impaired participants during presentations, webinars, and live streams. By running parallel audio-visual pipelines directly in the browser, it silently pre-loads AI descriptions of visual changes while the speaker talks, delivering instantaneous, polite narration the moment they pause.

---

## 🚀 The Core Problem

During virtual presentations (Zoom, Google Meet, Microsoft Teams), speakers frequently say phrases like *"As you can see on this chart..."* without describing the visual context. Standard AI meeting tools only transcribe or summarize spoken words; they are blind to the screen itself.

Whisper Screen solves this by acting as an intelligent visual co-pilot that watches the screen, waits for natural pauses in speech, and speaks aloud what has changed.

---

## ✨ Key Features

* **Zero-Latency Preloading:** Instead of waiting for a pause to begin processing, the vision model analyzes visual changes in the background while the host is speaking, eliminating awkward multi-second lag.
* **Dynamic Noise Gate:** Uses real-time RMS audio analysis via the Web Audio API to distinguish intentional human speech from background hums and breath sounds.
* **Platform Agnostic:** Runs entirely client-side in any modern browser—compatible with Zoom, Google Meet, Microsoft Teams, and local app windows.
* **Local-First Privacy:** Video frames are analyzed transiently via API; audio analysis and speech synthesis run 100% locally on the client device.

---

## 🛠️ Architecture & Tech Stack

```text
[ Screen Share / Audio ]
       │
       ├──► [ Web Audio API ] ──► Dynamic Noise Gate ──► Detects Pause
       │
       └──► [ HTML5 Canvas ] ──► Pixel Delta Check ──► HF Vision Model
                                                              │
                                                     [ Preloaded Cache ]
                                                              │
                                                     [ Web Speech API ]
