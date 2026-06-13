# Architecture Plan: YouTube Language Learning Chrome Extension

## Overview
This document outlines the architecture for the YouTube Language Learning Chrome Extension (Manifest V3). The extension will overlay a bilingual subtitle reader on YouTube, featuring dictionary lookup, A-B repeat, and video synchronization.

## Tech Stack
- **Framework:** Vite + TypeScript
- **UI:** React
- **Styling:** Tailwind CSS
- **Extension Tooling:** `@crxjs/vite-plugin` (recommended for seamless MV3 development)

## Component Diagram

```mermaid
graph TD
    A[YouTube Web Page] -->|DOM Elements| B(Content Script);
    B -->|Extract| C{ytInitialPlayerResponse / API Intercept};
    C -->|English & Chinese URLs| D[Fetch Timedtext API];
    D -->|Parse XML/JSON| E[Bilingual Subtitle Array];
    
    E --> F[React UI Panel];
    B -->|Inject Shadow DOM| F;
    
    F -->|Render| G[Subtitle List];
    F -->|Render| H[Video Controls A-B Loop];
    
    G -->|Click Word| I[Word Tokenizer];
    I -->|Message: Dictionary Lookup| J(Background Service Worker);
    J -->|Fetch| K[dictionaryapi.dev];
    K -->|Return Definition| J;
    J -->|Return Definition| F;
    F -->|Render| L[Tooltip UI];
    
    A -->|video.timeupdate| F;
    F -->|video.currentTime = start| A;
```

## Key Mechanisms
1. **Subtitle Fetching:** We intercept the actual subtitle fetching by injecting `src/inject.js` into the main world. This hooks `XMLHttpRequest` and `fetch` to capture the authenticated `json3` subtitles downloaded by YouTube.
2. **Translation Matching:** We construct the Chinese translation URL by modifying the intercepted `url` with `&tlang=zh-Hant` and fetch it.
3. **UI Injection:** To prevent YouTube's complex global CSS from breaking our Tailwind styles, the React root is injected inside a Shadow DOM element.
4. **Dictionary Lookup:** Content Scripts cannot easily bypass CORS if the target page has strict CSP. Therefore, word lookups are delegated to the Background Service Worker via `chrome.runtime.sendMessage`.
5. **SPA Navigation:** YouTube is an SPA. We use `window.addEventListener('message')` to receive new intercepted subtitles without requiring a full page refresh.

## Recent Implementation Notes
- **Shadowing Result Overlay:** The content script now includes a shadowing practice overlay that records user audio, transcribes it, and displays a score plus comparison against the target subtitle.
- **Recording Lifecycle:** Closing the overlay clears the original recording resources and revokes the generated audio URL to prevent stale blobs from staying in memory.
- **Playback and Save Controls:** The overlay supports playback of the recorded shadowing audio, as well as saving the recording to a file if the user chooses.
- **Shadow DOM Stability:** The React UI remains injected in Shadow DOM so extension styling stays isolated from YouTube page styles.
