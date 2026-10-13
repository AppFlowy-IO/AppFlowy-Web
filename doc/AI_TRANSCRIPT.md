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

The six-language support banner appears on first insertion and in the Transcript
tab, including during processing. Dismissal is saved per workspace in the browser,
using Flutter's `hasClickedAIMeetingBanner_<workspaceId>` preference. Dismissing
one banner also hides it in other open blocks in that workspace.

A recording longer than the remaining allowance shows a dismissible error so
the user can choose a shorter file or another URL. This does not mark all workspace
minutes as consumed. Dismissing an exhausted-quota banner rechecks the current
allowance; it does not reset usage or permit transcription without available time.

YouTube previews and downloads follow Flutter's `YoutubeExplodeAudioRepository`:
watch-page metadata, Android VR/Android player API clients, mp4 audio selection,
1 MB byte ranges, and up to three stream URL refreshes after HTTP 403. Videos must
have a known duration between one minute and four hours. Downloads have progress,
Stop and retry controls. The completed audio then follows Flutter's release file
import path: request `/api/file_storage/{workspace_id}/create_presigned_url` with
the file size, MIME type, and `audio_file_transcription` prefix; PUT the raw bytes
to the signed storage URL; then submit its download URL to
`/api/meeting/{workspace_id}/v2/transcribe-audio` with the recording's duration.
AppFlowy credentials are used only to request the signed URL. Sending the full
audio through `/v2/upload-audio-file` can hit the Cloud proxy's body limit
(HTTP 413), even when the file is within the workspace's upload allowance.

Audio selection prefers tracks labelled as original, then the default or an
unlabelled stream. Auto-dubbed and non-default translated tracks are excluded,
even if their bitrate is higher. Stream refreshes and client fallback preserve
the selected track ID so an import cannot switch languages partway through.

If the native clients are blocked, the bridge tries the same YouTube player API
with the VisionOS client. Before responding with audio, it validates the first
two ranges to detect YouTube's first-MB restriction. Switching clients restarts
from byte zero and discards the earlier bytes; different clients may produce
different encodings or file lengths. The upload limit is checked for each client.
Native clients keep their Range header; the fallback uses the range query parameter.

## Server bridge

Browsers cannot make Flutter's direct YouTube requests because of CORS. Vite serves
`/api/youtube-audio` locally; the same handler is available to the Bun server and
the Node API entry point in `api/youtube-audio.ts`. The SSR Docker image includes
it. A static nginx deployment must route this endpoint to a Node/Bun instance;
static HTML alone cannot provide YouTube import.

The bridge uses `APPFLOWY_BASE_URL` to validate workspace access and usage before
contacting YouTube. AppFlowy bearer tokens are sent only to that configured
backend. Download targets are restricted to YouTube's audio CDN, with redirects
disabled. Workspace quota and upload-size limits are checked before downloading,
and checked again by the existing upload/transcription APIs. File transcription
does not call the live-transcription duration reporting endpoint.

YouTube can reject its player requests or audio streams with bot checks or HTTP
403, including for the Flutter client. These failures keep the dialog open and
offer Retry; restrictions detected before streaming have a distinct error message.
Partial downloads are never submitted for transcription. The fallback was verified
with a complete download of video `FqiQfL9OBKY` (14:56); YouTube restrictions can
still vary by network, session, and video.

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
(`1033`) retain the server's reason and offer Click to Upgrade, which opens the
workspace's Stripe Pro checkout directly using the existing subscription-link API.
The completion reader follows Flutter's handling of provider `error` frames and
application `code`/`message` errors, including failures inside an HTTP 200 stream.
It preserves the server's explanation and quota code, rejects interrupted or
malformed output, and keeps partial output from replacing the saved summary.
Responses with no content show an actionable retry message.
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

The YouTube dialog tests include the Flutter cases for progress, keeping the
dialog open during download, out-of-range duration, and unavailable duration,
plus clipboard, cancellation, stale responses, retry, and quota/size handling.
Server tests cover authentication, token isolation, CDN targets, workspace limits,
client fallback, complete byte ranges, stream refreshes, and corrupt downloads.
Summary tests cover Flutter's reference parsing and numbering cases, rich-text
and Yjs persistence, loading through the completion stream, source edits/deletion,
and source navigation on editable and read-only pages.
Speaker tests port Flutter's default-name, unique-ID, unmapped-speaker, and
skip-inference cases, and cover name/title persistence, streaming order, edited
names, invalid results, network errors, timeouts, and stale responses. Move tests
cover citations in repeated drags, ancestor moves, duplicates, undo/redo, and
documents reopened from their Yjs state.
