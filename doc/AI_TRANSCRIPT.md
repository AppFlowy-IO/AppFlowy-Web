# AI transcript imports

Run the feature branch with the usual AppFlowy Cloud environment configuration:

```sh
pnpm dev --port 3001
```

Open `http://localhost:3001`, sign in, open a document, and choose **AI transcript**
from the slash menu. The welcome actions are **Transcribe audio file** and
**Paste YouTube URL**. The URL dialog also accepts direct audio/video file links.

The Paste YouTube URL action reads the clipboard on the button click. HTTP links
prefill the input; denied clipboard permission or non-link text leaves it empty.
Late clipboard reads do not overwrite user input.

The six-language audio support banner appears on first insertion and in the Transcript
tab, including during processing. Imported YouTube captions use their available
languages and do not show this audio-provider banner. Dismissal is saved per workspace in the browser,
using Flutter's `hasClickedAIMeetingBanner_<workspaceId>` preference. Dismissing
one banner also hides it in other open blocks in that workspace.

A recording longer than the remaining allowance shows a dismissible error so
the user can choose a shorter file or another URL. This does not mark all workspace
minutes as consumed. Dismissing an exhausted-quota banner rechecks the current
allowance; it does not reset usage or permit transcription without available time.

## YouTube captions

Pasting a YouTube URL loads its metadata and available caption languages. Choose
**Import captions** to fetch existing captions and save their text and timestamps
in the transcript section. Both creator-provided and automatically generated
captions are supported. The default track follows the video's original/default
language, with manual captions preferred within that language. Users can choose
another available caption language; the bridge does not request translations.

Caption import downloads no video or audio, creates no transcription-provider
job, and consumes no transcription minutes. It stays available when transcription
minutes are exhausted. Captions do not need the audio import's one-minute minimum
or four-hour maximum duration. Imported cues have unknown speakers; no speaker
identity is invented. The video ID, caption language and automatic-caption flag
are saved as `youtube_caption_source` on the meeting block. The transcript is
saved directly in Yjs, so reopening the page needs no provider polling. A late
caption response cannot replace live transcript edits or another saved job.

After import, the existing summary flow uses the saved transcript. Summary
requests still use the normal AI-response allowance. Missing captions or a
YouTube restriction keep the dialog open with an explanation. Users can explicitly
choose **Download audio and transcribe** or **Upload audio/video**. Downloading
does not start automatically when captions are missing.
Stop, Retry, workspace changes and closing the dialog cancel pending requests.

## Browser audio fallback

### Why an extension is needed

A normal React page cannot read arbitrary YouTube playback resources or change
the browser's cross-origin response rules. React libraries still operate under
the browser's [same-origin restrictions](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests).
The download also needs current playback metadata from YouTube's native player.
The helper prepares that playback in a YouTube tab, then uses narrowly scoped
[network-header rules](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)
to let AppFlowy fetch the audio directly on the user's device. This satisfies
the requirement that AppFlowy servers do not download or proxy YouTube media.

Only the audio track is needed for transcription. Existing captions already
contain the words and timestamps, so importing them needs neither a media
download nor the extension. Manual audio/video upload also needs no extension.

### Installation and download flow

The optional Chrome/Edge helper lives in `extensions/youtube-transcript`. Build
its downloadable ZIP with `node extensions/youtube-transcript/package.mjs`.
The URL dialog explains how to unzip it, enable Developer mode, choose **Load
unpacked**, and reload AppFlowy. This is a development distribution, not a
published extension-store listing. Self-hosted installations need a package
configured for their exact origin; see the helper's README.

After an explicit download click, the helper opens a temporary YouTube tab to
prepare native playback for the requested video. It rejects advertisement
sessions and returns bounded playback metadata to AppFlowy. YouTube's player and
verification code execute on YouTube, outside the signed-in AppFlowy page.
AppFlowy downloads the audio stream directly from Googlevideo using the helper's
scoped network rules. It does not download the video track. Media never passes
through an AppFlowy download server.

The resulting playable file goes through the existing upload/transcription flow,
including its duration and quota checks. Streaming enforces the workspace file
limit and a 256 MiB browser download cap. Stop, navigation, workspace changes and
loss of editing/transcription availability cancel preparation and download.
Errors keep the file-upload alternative available. Captions remain usable without
the extension and without transcription minutes.

## Server bridge

The Web Node/Bun bridge fetches only YouTube metadata and timed caption text.
Vite serves the existing `/api/youtube-audio` endpoint locally; its name is kept
for deployment compatibility. It accepts GET `action=metadata` and
`action=captions`, with `workspace_id`, `url`, and optional caption `language`.
The old POST `action=audio` route is rejected. No AppFlowy Cloud changes,
AssemblyAI key, yt-dlp executable or browser extension are needed for captions.

The bridge uses `APPFLOWY_BASE_URL` and the existing workspace usage endpoint to
verify access. It does not enforce audio duration, upload size or transcription
minute quotas for caption text. AppFlowy bearer tokens go only to the configured
AppFlowy backend. Caption targets are restricted to YouTube timed-text endpoints;
redirects are disabled, responses are bounded, and signed caption URLs are never
returned to the browser. YouTube may block caption requests or change its
undocumented APIs, so unavailable and blocked captions have explicit errors.

The Node API entry point is `api/youtube-audio.ts`; the SSR Docker image includes
the shared handler. Static nginx deployments must route this endpoint to a
Node/Bun instance. Existing file and direct-media URL transcription continue to
use their current upload/provider flow and transcription allowances.

## Loading and summary sources

The block shows actual upload progress, then Flutter's rotating processing
messages and spinner throughout transcription. Once transcript or notes content
is ready, editable blocks keep the Summary tab available, including after a failed
generation. Flutter's blue Generate summary split button sits beside the title;
after generation, Regenerate appears beside the Summary tab. While generating,
the block shows Flutter's blue Cancel button with a spinner beside the title and
keeps its loading indicator until the response finishes. Cancel aborts the active
completion or speaker preprocessing request, discards unfinished output,
and preserves the saved summary. A new generation can start immediately; late
responses from the cancelled request cannot overwrite it or clear its loading state.
Failures show a dismissible error banner, and existing summary content stays
visible while regenerating. Network failures offer Retry. AI-response quota errors
(`1033`) use the shared error catalog or server-declared public guidance and offer Click to Upgrade, which opens the
workspace's Stripe Pro checkout directly using the existing subscription-link API.
The completion reader follows Flutter's handling of provider `error` frames and
application `code`/`message` errors, including failures inside an HTTP 200 stream.
It retains server diagnostics and quota codes for classification, rejects interrupted or
malformed output, and keeps partial output from replacing the saved summary.
UI errors use the shared message resolver; raw server diagnostics are not displayed.
Responses with no content leave the saved summary intact and offer Retry.
The upgrade action stays disabled while checkout loads; dismissing the banner or
switching workspaces ignores late checkout responses. Hosted billing actions are
hidden on self-hosted servers and read-only pages. Summary generation and speaker
preprocessing consume the AI-response allowance, separately from transcription minutes.
Missing Summary, Notes, or Transcript sections are repaired without replacing
existing content or source IDs, including when an older block is reopened.

Before generating a summary, the block follows Flutter's speaker preprocessing:
it sends the transcript, default speaker labels, optional meeting notes, and
workspace member names to `/api/ai/{workspace_id}/v2/complete/stream` using
`completion_type: 8` (CustomPrompt) and Flutter's auto-guess prompt. The JSON result
maps speaker IDs to names and may supply a title. Only default names and the
default meeting title are replaced; imported file/YouTube titles and custom
names remain intact, including edits made while the request is pending. Unknown
speakers keep their labels. The saved names are used in the transcript, copied
text, and summary source context.

Preprocessing runs for completed audio/video and URL imports even if a summary
already exists. Existing summaries are preserved in that case. Regenerate also
preprocesses transcripts with unresolved labels, so older imports can gain names.
AI/network errors, invalid JSON, and a 60-second preprocessing timeout fall back
to summary generation. Navigating away or making the page read-only cancels the
request and discards late responses.

Summary requests label transcript paragraphs and manual notes with their block
IDs, using Flutter's `[BLOCK:id]` input and `{ref:id1,id2}` response syntax.
Generation waits for the shared Flutter summary template request to finish;
if it cannot load within ten seconds, a local fallback remains available. Both
paths use Flutter's citation placement rules: group related sentences and place
references after the final punctuation of the complete paragraph or thought,
without repeating the same source throughout the summary. Overview uses a
sentence-case heading, cohesive prose, and Markdown emphasis for meaningful
phrases. Markdown hard breaks are preserved with their rich-text offsets, so
separate lines do not become joined text such as `.Attendees`.
Live insertion uses the same container structure as a reopened document, so an
unused text field on a summary section cannot add an empty line above Overview.
Each source gets a stable numbered button. The source popover shows the source
text and transcript timestamp, scrolls at a maximum height of 360 px, and jumps
to and highlights the referenced paragraph when clicked. Read-only pages switch
tabs locally. References are saved in the document; unknown source IDs do not
produce links. Regenerate an older summary to add these source references.

Dragging or duplicating a transcript block remaps its citations to the copied
transcript and note paragraph IDs. This also applies when moving a parent that
contains the block, and supports undo/redo and saved documents. Sources already
broken by an earlier move need one regeneration; subsequent moves preserve them.

Opening a source clears the editor selection, so the text formatting toolbar
stays closed. Source buttons use Flutter's neutral hover background while open.
Nested Markdown bullets, paragraphs, and tasks retain their structure and rich
text when saved. Regenerate existing summaries to restore bullets that an older
parser joined into their parent item.

The Regenerate split button uses the Figma icons, 32 px height, 8 px corners, and
6 px icon spacing. Its options menu initially shows the first template section;
More templates expands the remaining sections in a scrolling menu. Summary
languages open in a separate submenu with a 360 px maximum height, matching
Flutter's behavior. Both menu levels support keyboard navigation.

## Checks

```sh
pnpm lint
TZ=UTC pnpm exec jest --maxWorkers=4 --coverage --silent
pnpm build
pnpm build-storybook
```

The YouTube tests cover timed-caption parsing, language selection, unavailable
and blocked captions, authentication, token isolation, allowed caption targets,
response limits, cancellation, retry and stale responses. Editor tests cover
caption persistence, timestamps, summary triggering, exhausted transcription
minutes and preserving collaborator content without uploading audio or creating
a provider job. An opt-in real YouTube regression can be run with:

```sh
RUN_YOUTUBE_CAPTION_LIVE_TEST=1 pnpm exec jest --runInBand --no-coverage --runTestsByPath api/_lib/__tests__/youtube-import.test.ts
```

This test retrieves caption text only. It does not download media, submit a
transcription job or modify a document. Default tests use mocked HTTP responses.

Browser-download unit tests cover extension detection, ad/session isolation,
media host restrictions, cancellation, size limits, error redaction, playable
file validation and the upload fallback. Run the opt-in real browser test with:

```sh
RUN_YOUTUBE_DOWNLOAD_LIVE_TEST=1 node scripts/test-youtube-browser-download.mjs
```

This opens a disposable Chromium profile, loads the local helper, downloads the
test video's audio on the device, and verifies its complete byte count, playable
duration, network destinations and helper-tab cleanup. It does not sign in,
submit a paid transcription job or modify a document. It requires Playwright's
Chromium (`pnpm exec playwright install chromium`). Set `VIDEO_ID` to
test another video.

A real download must be tested in a regular browser session: YouTube may reject playback in automated
headless/`navigator.webdriver` sessions even when the same video plays normally.
Verifying only metadata or an initial audio buffer is insufficient; check the
complete file and its playable duration. The helper uses YouTube's changing
playback protocol, so restricted videos can still require file upload.

Summary tests cover Flutter's reference parsing and numbering cases, rich-text
and Yjs persistence, loading through the completion stream, source edits/deletion,
and source navigation on editable and read-only pages.
Speaker tests port Flutter's default-name, unique-ID, unmapped-speaker, and
skip-inference cases, and cover name/title persistence, streaming order, edited
names, invalid results, network errors, timeouts, and stale responses. Move tests
cover citations in repeated drags, ancestor moves, duplicates, undo/redo, and
documents reopened from their Yjs state.
