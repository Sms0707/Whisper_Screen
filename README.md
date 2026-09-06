# Screen Narrator (Zero-Latency Preloading)

An accessibility tool that silently monitors screen changes during meetings and preloads AI descriptions. It provides zero-latency narration the moment a meeting host pauses speaking.

## Features
*   **Zero-Latency Preloading**: Pre-fetches descriptions while the host is talking.
*   **Audio Silence Detection**: Uses Web Audio API to detect host pauses dynamically.
*   **Visual Motion Tracking**: Uses the Canvas API to detect when presentation slides or screen views change.
*   **Hugging Face API Integration**: Uses `Qwen/Qwen3.8-27B` (or other Vision models) for contextual narration.

## Setup
1. Clone this repository.
2. Open `script.js` and add your Hugging Face API key to the `HF_TOKEN` constant.
3. Serve the directory using a local development server. (e.g., `python -m http.server 8000` or VS Code Live Server).
4. Open the site in your browser and click "Share Screen & Audio".

*Note: Access to the screen-sharing API requires the site to be served over `localhost` or a secure `https://` connection.*
