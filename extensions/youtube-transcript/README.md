# AppFlowy YouTube transcript helper

This Chromium Manifest V3 extension supports the optional local YouTube audio download in AppFlowy's transcript block. It is not required to import existing captions or upload an audio/video file. YouTube compatibility changes over time; the helper cannot guarantee access to every video.

## Why use an extension?

An ordinary React page is subject to browser cross-origin restrictions and cannot change the network headers needed for this download. The helper prepares current playback metadata in YouTube's own tab and provides scoped network rules so AppFlowy can download the audio directly on the user's device. AppFlowy servers do not download or proxy YouTube media. Only the audio track is downloaded because transcription does not need video frames.

## Install for local testing

1. Open `chrome://extensions` (Chrome) or `edge://extensions` (Edge).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this `extensions/youtube-transcript` directory. If you downloaded a ZIP, extract it and select the extracted directory containing `manifest.json`.
4. Reload the AppFlowy tab, paste a YouTube link in a transcript block, and use **Download audio** when needed.

The extension is not published to an extension store. A production distribution should publish this package and configure AppFlowy's install link with the reviewed store listing. Firefox and Safari are not supported by this Chromium package.

## Data flow and permissions

- Accepts requests only from `https://beta.appflowy.cloud`, `https://test.appflowy.cloud`, and HTTP loopback development pages (`localhost`, `127.0.0.1`). The bridge supports availability checks and preparation for one YouTube video ID; it exposes no general HTTP proxy.
- Opens its own active YouTube watch tab, briefly plays the native player muted, and captures the requested video's playback metadata and native streaming request. The tab closes after preparation, on Stop, on AppFlowy navigation, or after a 90-second timeout. Opening the helper in the foreground lets YouTube initialize playback normally.
- Activates the packaged playback hook only on a watch URL containing the helper nonce. The worker accepts results only from the top frame of the exact tab it created, checks the requested video and native playback configuration to exclude ads, and bounds request data to 256 KiB and format metadata to 256 entries. Each AppFlowy page may have at most four pending operations.
- YouTube's native page may use the browser's normal YouTube session. The extension does not read or forward browser cookies, authorization headers, AppFlowy credentials, or browsing history. Short-lived playback metadata is sent only to the initiating AppFlowy page and is neither logged nor persisted.
- Allows the AppFlowy page to fetch Googlevideo `/videoplayback` streams directly through network-header rules limited to the AppFlowy and loopback initiators above. Audio bytes travel from Googlevideo to the user's browser, without an AppFlowy download server or extension message relay.
- AppFlowy subsequently uploads the downloaded audio through its existing transcription flow and usage limits. Captions import and manual file upload remain available independently.

The extension does not inject downloaded scripts into AppFlowy. It uses packaged JavaScript to observe YouTube's own player in the helper tab. Current live streams are unsupported. YouTube access restrictions, unavailable videos, consent pages, and player changes may prevent preparation; users can upload a local audio or video file instead.

Self-hosted domains require a deployment-specific package: add the exact HTTPS origin to the two AppFlowy content-script match lists and host permissions in `manifest.json`, `isAppFlowyOrigin` in `policy.js`, and the media-rule `initiatorDomains` in `rules.json`. Keep the separate YouTube helper match lists unchanged. The general package does not request access to arbitrary self-hosted sites.

## Build and verify

From the Web repository root:

```sh
node --test extensions/youtube-transcript/*.test.mjs
pnpm exec jest src/application/integrations/__tests__/youtube-extension.test.ts --runInBand --no-coverage
node extensions/youtube-transcript/package.mjs
```

The packaging command requires the system `zip` executable and writes `public/downloads/appflowy-youtube-transcript.zip`. Run it after editing the helper so the downloadable artifact matches its source. The package includes an explicit source-file list and excludes tests and Chromium's generated `_metadata` directory. The extension has no npm dependencies, analytics, or backend component.

An opt-in integration check downloads real audio through the production Web downloader and this extension, verifies byte count and media duration, and checks helper cleanup and the absence of AppFlowy server requests:

```sh
RUN_YOUTUBE_DOWNLOAD_LIVE_TEST=1 node scripts/test-youtube-browser-download.mjs
```

It requires a desktop display and installed Playwright Chromium. It opens a disposable normal browser profile using a fixed debugging port, because automated browser profiles can fail YouTube's own native playback. It uses no account, sends no transcription request, and writes no document. Ordinary unit tests use mocked browser APIs and run without YouTube access.

Architecture uses the same local-extension/network-rule pattern demonstrated by [Kira](https://github.com/LuanRT/kira); the extension implementation here is original. See [Chrome's cross-origin request guidance](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests) and [declarativeNetRequest reference](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest).
