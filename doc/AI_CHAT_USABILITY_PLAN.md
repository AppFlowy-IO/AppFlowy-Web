# AI chat usability plan: closing the gap with Open WebUI

> **Status:** Living plan. Phase 1 (Web, image flow) started 2026-11-02.
> **Research baseline:** Open WebUI 0.12.5 (2026-10-29), AppFlowy-Web `207b0ba5`, AppFlowy-Cloud-Premium `a922b7d24`.
> **Owner notes:** server work lives in AppFlowy-Cloud-Premium (`services/appflowy-ai`, `libs/appflowy-cloud-ai`,
> `libs/appflowy-cloud-workspace`). Keep the "Progress" table at the bottom current.

This document preserves the research that compared AppFlowy AI chat with Open WebUI, and turns it into an ordered
implementation plan. The goal is ease of use, with image generation and text-plus-image answers as the first priority.

## 1. Research summary

### 1.1 Where the code lives

| Area | Location |
|---|---|
| Web chat UI | `src/components/chat` (self-contained: request classes, providers, components) |
| Web app glue (drawer, sources scope) | `src/components/ai-chat` |
| Web answer renderer | `@appflowyinc/editor` package, read-only, custom markdown parser |
| Server proxy | Cloud `libs/appflowy-cloud-ai/src/api/chat_proxy.rs`, `ai_proxy.rs` (auth + forward only) |
| Server chat logic | Cloud `services/appflowy-ai/src/api/chat.rs`, `biz/chat/llm.rs`, `tool/*` |
| DTOs | Cloud `libs/appflowy-entity/src/ai/dto.rs` (`ResponseFormat`, `OutputContentMetadata`), `shared/dto/chat_dto.rs` (`QuestionStreamValue`) |
| Image backend | Cloud `services/appflowy-ai/src/image/open_ai_image.rs`, `tool/image_generate.rs` |

### 1.2 How AppFlowy generates an image today (end to end)

1. The user opens the format bar, picks **Image only** or **Text and image**, and sends a question.
   The picked content type stays active for every later message until changed or the chat is switched.
2. The Web posts the question, then streams `POST /api/chat/{ws}/{chat}/answer/stream` with
   `format: {output_layout, output_content}`. `output_content_metadata` (custom prompt, size, quality) is never sent.
3. Server, `llm_stream_image`: the raw question text becomes the image prompt.
   Server, `llm_stream_text_with_image`: the text model answers first (no sources, tools, or persona), then the entire
   prose answer (up to 32,000 chars) becomes the image prompt.
4. `ImageGenerateTool::generate` returns a placeholder blob URL immediately and spawns a background task
   (3 attempts, 2 s to 10 s backoff). The stream ends with `![Generated Image](url)` as answer text.
5. The blob row carries a status (Pending, Failed, PolicyViolation) that only the AI service writes. The Cloud blob
   GET returns 404 until the object exists and the metadata API has no status field, so clients cannot tell
   "still generating" from "failed".
6. The editor's image block polls 5 times, 6 s apart, and gives up after 30 s with "Image load error" and a Reload
   button. Slow providers routinely exceed 30 s.
7. Nothing lets the user zoom, download, regenerate, or edit the image. "Try again" uses the input box's current
   format, not the format of the answer being regenerated.

### 1.3 How Open WebUI does it

- One **Image** toggle in the input (hidden when no engine is configured), or in native mode the model calls
  `generate_image(prompt, size)` and `edit_image(prompt, image_urls, size)` tools itself.
- A task model rewrites the request into an image prompt (legacy mode), or the model writes the prompt as a tool
  argument (native mode).
- Status lines "Creating image" and "Image created" stream in the reply. Images are attached to the message when
  ready and rendered inline. Click opens a full-screen pan-and-zoom preview with Download.
- Upload one or more images and describe a change to edit or composite them.
- Regenerate keeps both versions (sibling navigation).

### 1.4 Feature comparison (features both have, where Open WebUI is easier)

| Feature | AppFlowy today | Open WebUI |
|---|---|---|
| Asking for an image | Format bar, sticky content type | Image toggle or native tool |
| Image prompt | Raw question, or whole prose answer | Task-model rewrite or model-authored tool argument |
| Waiting | Placeholder URL, 30 s client poll | Streamed status, image attached when ready |
| Failures | Indistinguishable "Image Not Found" | Error relayed in reply |
| Options and actions | None in Web | Size, lightbox, download, versions |
| Editing | Not supported | `edit_image` with reference images |
| Default format | Forced bullet list until switched to Auto | Natural answers |
| Streaming display | Reasoning dropped, 5 progress lines, stop before headers no-op, errors inside 200 streams ignored | Thinking block, expandable status, Escape to stop, error block |
| Message actions | Copy, Try again, Add to page | Edit (branches), versions, continue, rate, info, read aloud, delete |
| Citations | `[A1]` becomes plain `【Title】` | Clickable numbered chips with excerpt modal |
| Follow-ups | Latest answer only, lost on reload | Persisted, Tab to accept |
| Prompts | 232-prompt modal, hand-edited placeholders | `/` commands with typed variable forms |
| Sources | Subtree picker, no databases, no "chat with this page" | `#` inline attach of anything |
| Attachments | Server parses `[IMAGE:url]`/`[FILE:url]`, Web has no upload UI | Plus menu, drag and drop, paste |
| Model picker | English-only, no badges | Fuzzy search, pins, badges, @model |
| Titles and search | Full first question, messages not searchable | Generated titles, Cmd+K content search |
| Shared chats | No live updates, initials only | Live collaborators, typing indicator |
| Markdown | No math, mermaid, code copy | Full markdown, KaTeX, mermaid |

### 1.5 Server facts to remember

- The image tool implements rig's `Tool` trait as `generate_image_tool` but is never registered with the chat agent
  (`tool/builder.rs`), so the model cannot decide to draw.
- `OutputContentMetadata.image_model` defaults to `dall-e-3` when omitted; the Web must keep omitting it so the admin
  default model applies. `size` accepts `WxH`; GPT image accepts 1024x1024, 1536x1024, 1024x1536, auto. `quality`
  accepts standard/hd (mapped to medium/high), low, auto.
- The stream is NDJSON with one-key objects: `"1"` text, `"5"` progress, `"6"` reasoning, `"0"` metadata (sources,
  sent once at the end). Error lines are `{code, message, error}`. A failure before streaming is HTTP 503 with one
  error line; later failures are error lines inside a 200 body.
- The server never saves streamed answers; the client posts `message/answer` with `content` and `meta_data`.
- The answer id is assumed to be `question id + 1` in several Web files; ids come from one global sequence.
- `PUT /api/chat/{ws}/{chat}/message` edits a question and regenerates a non-streamed answer; the Web never calls it.

## 2. Implementation plan

Phases are ordered by user value. Each step lists the owning repo, the touch points, and the acceptance check.

### Phase 1: image generation that feels finished (Web first)

| Step | Repo | Change | Done when |
|---|---|---|---|
| 1.1 | Web | Default the input to Auto. Send `output_layout: Flex` in Auto so the model picks the layout. | New chats answer in natural prose; format bar opens on demand. |
| 1.2 | Web | Add an **Image** button next to Web search that opens a popover: mode (Image only / Text and image), size preset (Auto, Square, Landscape, Portrait), quality (Auto, Standard, HD), optional "Describe the image". Send them as `output_content_metadata`. Show an active chip in the input; the choice is one-shot and clears after sending. | A user can request an image without opening the format bar and sees what will happen before sending. |
| 1.3 | Web | Render generated images with a dedicated component: authenticated fetch with long backoff (about 2.5 min), "Generating image, this can take a minute" state, failure state with Retry, lightbox with zoom, Download, Copy, and Regenerate image. | A slow image never shows "Image load error" within the first minute; failures have a retry. |
| 1.4 | Web | Remember each answer's format in session and infer it from stored answers, so "Try again" regenerates with the original format. | Regenerating an image answer produces an image even if the input is back in text mode. |
| 1.5 | Web | Stream hardening: AbortController, parse error lines inside 200 streams, surface server messages, Retry button on failed answers, Escape stops, IME-safe Enter. | A provider error shows its message and a retry; Stop works before headers. |
| 1.6 | Web | Show reasoning (`"6"`) in a collapsible "Thinking" block while streaming. | Reasoning models no longer look stalled. |
| 1.7 | Server | Emit `Progress("Creating image")` and hold the stream until the file is saved, or expose blob status through the metadata API and a `progress`/`metadata` event with the final URL. | Clients can show pending vs failed vs policy-blocked. |
| 1.8 | Server | Dedicated image prompt: for text-plus-image ask the model for `{answer, image_prompt}` or run a short rewrite step; honor `custom_image_prompt`. | Pictures match the request, not the prose. |
| 1.9 | Server | Register `generate_image_tool` with the chat agent (policy allow-list) so "draw a ..." works in Auto mode; keep the explicit mode for forcing. | Image requests work without any toggle. |
| 1.10 | Server | Image editing: add `edit` to `ImageGenerationBackend` (OpenAI `images/edits`), accept reference images from `[IMAGE:url]` markers, add an `edit_image` tool. | "Add a hat" on an uploaded or generated image works. |
| 1.11 | Server | Expose image capability in `GET /api/ai/{ws}/model/list` (or a capabilities endpoint) so the Web can hide image options when no image model is configured. | No 503 after sending when images are unconfigured. |
| 1.12 | Web | Attachments: upload through `PUT /api/file_storage/{ws}/v1/blob/{chat_id}` and prepend `[IMAGE:url]` / `[FILE:url]` markers; show chips; warn when the model lacks vision. | Users can attach a reference image or a PDF. |

### Phase 2: answer quality and control

| Step | Repo | Change |
|---|---|---|
| 2.1 | Web | Wire `PUT .../message` for "Edit and resend" on user messages; add delete. |
| 2.2 | Server + Web | Answer versions: keep previous answers (new `reply_message_id` chain or `versions` metadata) and add sibling navigation. |
| 2.3 | Web | Show the model name on each answer; store it in answer metadata. |
| 2.4 | Web | Clickable citations: numbered chips that open the page in the drawer; keep `【Title】` text as fallback for copy. |
| 2.5 | Server | Send the metadata (sources) event before the answer text so markers resolve while streaming. |
| 2.6 | Web + Server | Persist related questions in answer metadata; Tab accepts the first suggestion. |
| 2.7 | Server + Web | Short generated titles (task model) and tag generation; index message text for search. |

### Phase 3: input power features

| Step | Repo | Change |
|---|---|---|
| 3.1 | Web | `/` slash commands for the prompt library with `{{variable}}` forms. |
| 3.2 | Web | `@page` mention to add sources inline; "Chat with this page" button on documents. |
| 3.3 | Web | Keyboard: Cmd+Shift+O new chat, ArrowUp edits last message, Cmd+K focuses search. |
| 3.4 | Web | Reuse the document editor's markdown pipeline in chat (math, mermaid, code copy, nested lists). |
| 3.5 | Server + Web | Realtime chat updates over the existing WebSocket; author names and timestamps. |

### Phase 4: organization and sharing

| Step | Repo | Change |
|---|---|---|
| 4.1 | Server + Web | Share link and export (markdown, PDF) for chats; clone a chat. |
| 4.2 | Web | Archive and tags for chat pages. |
| 4.3 | Server | Per-chat system prompt and parameters in chat settings metadata. |

## 3. Design notes for Phase 1 (Web)

### Input model

- `ResponseFormatProvider` keeps `responseMode` (Auto by default) and `responseFormat`.
- Image intent lives in `responseFormat.output_content` plus `imageOptions` (`size`, `quality`, `customImagePrompt`).
  The chat input builds the wire format as
  `{ output_layout: mode === Format ? layout : Flex, output_content, output_content_metadata? }`.
- After a message is sent with an image content type, the provider resets the content type to text. The reason is
  that today's server cannot continue an image conversation; once editing lands (1.10) make it sticky.

### Generated image component

- `GeneratedImage` (`src/components/chat/components/chat-messages/generated-image.tsx`) uses the editor's
  `useImageWithRetry` hook (status-aware backoff, 5 min budget) and the shared `GalleryPreview` lightbox.
- `AnswerMd` keeps feeding the full markdown to `@appflowyinc/editor` so copy and Add to page still include the image,
  but hides the editor's own image blocks (`[&_[data-block-type=image]]:hidden`) and renders `GeneratedImage` for each
  standalone image line instead.
- Regenerate image calls `regenerateAnswer(questionId, format)` with the answer's remembered format.

### Stream contract handled by the Web

| Line | Handling |
|---|---|
| `{"1": text}` | Append to answer |
| `{"5": step}` | Progress line (kept until first text) |
| `{"6": text}` | Append to reasoning buffer |
| `{"0": [...]}` | Sources |
| `{"code", "message"}` | Reject the stream with that error |

## 4. Progress

| Step | State | Notes |
|---|---|---|
| 1.1 Auto default | done (2026-11-02) | Auto sends `Flex`; the e2e expectation in `chat-provider-stability.spec.ts` was updated |
| 1.2 Image popover and chip | done (2026-11-02) | `chat-input/image-options.tsx`; one-shot; options sent as `output_content_metadata` |
| 1.3 Generated image component | done (2026-11-02) | `chat-messages/generated-image.tsx`; 5 s polling for about 3 min; lightbox, copy, download, regenerate |
| 1.4 Per-answer format memory | done (2026-11-02) | remembered in session, inferred from stored answers for history |
| 1.5 Stream hardening | done (2026-11-02) | AbortController, error lines, server messages, Retry button, Escape stops, IME-safe Enter |
| 1.6 Reasoning block | done (2026-11-02) | "Thinking" / "Thought process" toggle, session only |
| 1.7 Image progress and completion | done (2026-11-02), server | `Progress("Creating image")`, the stream waits for the saved file, `KeepAlive` (`{"3": ""}`) every 10 s; Web shows the trailing progress line |
| 1.8 Dedicated image prompt | done (2026-11-02), server | text-with-image answers end with an `<image_prompt>` block that `biz/chat/image_prompt.rs` strips and uses as the prompt; `custom_image_prompt` still wins |
| 1.9 Image tool in Auto mode | done (2026-11-02), server | `generate_image_tool` registered for TEXT chat answers when an image model exists; generates inline with admin defaults |
| 1.10 Image editing | done (2026-11-02), server | `edit_image_tool` with attached pictures or chat image URLs; OpenAI `images/edits` multipart for GPT image models |
| 1.11 Image capability flag | done (2026-11-02) | `GET /api/ai/{ws}/model/list` returns `image_generation`; Web hides image options when false |
| 1.12 Attachments | done (2026-11-02), Web | attach button, drag and drop, paste; `[IMAGE:url]` / `[FILE:url]` markers; previews on questions |
| 2.1 Edit and resend | done (2026-11-02) | `PUT .../message` with `generate_answer: false`, pencil on own questions, ArrowUp from an empty input |
| 2.2 Answer versions | not started | needs a schema change |
| 2.3 Model name on answers | not started | |
| 2.4 Clickable citations | not started | blocked by the read-only answer editor |
| 2.5 Early sources | done (2026-11-02) | metadata event before the answer; the final event replaces it (Desktop already keeps the last) |
| 2.6 Follow-ups | partial | Tab inserts the first suggestion; persistence not started |
| 2.7 Titles, tags, search | partial | Web shortens titles; task-model titles, tags and message search not started |
| 3.1 Slash commands | partial | "/" on an empty input opens the prompt library; variable forms not started |
| 3.2 Mentions | partial | "@" on an empty input opens the sources picker; inline page mentions not started |
| 3.3 Keyboard | partial | Escape stops, ArrowUp edits, Tab accepts; new-chat shortcut not started |
| 3.4 Shared markdown renderer | done (2026-11-02) | `chat-messages/markdown/*`: answers parse with the document pipeline (`parseMarkdown`, `\(..\)` kept inline), KaTeX math, highlight.js code with language label and copy, Mermaid with Diagram/Code tabs (code while streaming), tables; copy and "Add to page" now carry `math_equation`, `code` language and image blocks |
| 3.5 Realtime chat updates | not started | |
| 4.1 Share and export | not started | |
| 4.2 Archive and tags | not started | |
| 4.3 Per-chat instructions | done (2026-11-02) | settings button stores `metadata.instructions`; the service injects it into the prompt, bounded to 4,000 chars |

### Verification log, second round (2026-11-02, server and Web together)

Local stack with the rebuilt AI service, signed in as Nathan on a new chat page:

- `GET /api/ai/{ws}/model/list` returned `image_generation: true`; the Image button stays visible.
- Auto mode, "Draw a simple watercolor illustration of a lighthouse at dusk": the model called
  `generate_image_tool`, the answer carried the picture (1024×1536) plus a caption, with Open full size,
  Copy image, Download and Regenerate image.
- Text and image, "Why do leaves change color in autumn? Keep it short.": a real two-sentence answer streamed,
  then the trailing "Creating image" line, then a 1536×1024 picture appeared without any 404 polling.
- Attached `orange-ball.png` through the attach button and asked for a red party hat: the question showed the
  thumbnail, `edit_image_tool` ran with the attachment (read from storage after the first attempt failed over
  HTTP), and the reply carried the edited 1024×1024 picture.
- Edit message on the leaves question with "Answer in exactly two sentences": the question text and the answer
  were replaced in place.
- Tab inserted the first suggestion, "/" opened the prompt library, "@" opened the sources picker.
- Chat settings: typed instructions persisted to `metadata.instructions` and the next answer began with the
  requested word. (The DevTools `fill` helper did not fire React's change event for that textarea; keyboard
  typing did.)
- Found and fixed: a chat with no selected sources stores its own id as the only `rag_id`, which put answers
  into selected-documents mode and refused general questions ("I don't know based on the selected
  documents"). The service now ignores the chat's own id (`without_own_chat_id` in `biz/chat/llm.rs`).
- Edit message on a text-with-image answer re-sent `output_content: 2` and the regenerated answer carried a
  new picture, so the remembered format survives edits.
- After the scope fix was deployed locally, "What is the capital of Italy?" in a chat with no selected
  sources answered "BANANA Rome is the capital of Italy." instead of refusing, confirming both the scope fix
  and the per-chat instructions.

### Verification log

- 2026-11-02, local stack (Cloud `a922b7d24` native, AI service binary from `target/macos-dev`, Web dev server on
  port 3000), signed in as Nathan: a new AI chat opened in Auto mode with the format bar hidden; the Image button
  offered Text only / Image only / Text and image, size and quality presets and an optional prompt; sending with
  "Text and image · Landscape" posted `output_layout: 4, output_content: 2, output_content_metadata: {size:
  "1536x1024"}`; the reply showed a collapsed "Thought process", the text, then "Generating image, this can take up
  to a minute" until a 1536×1024 picture appeared with Open full size, Copy image, Download and Regenerate image;
  Regenerate image re-sent the same format although the input had returned to text; after a reload the stored answer
  rendered the picture with the same actions; the sidebar title was shortened to "A cozy reading nook by a window
  with a sleeping cat,…".
- Observed server behavior to fix in 1.8: in text-plus-image mode the "text" the user sees is the image prompt the
  model wrote, not an answer. Suggested questions from the previous answer stay visible while a regeneration runs.
- Chat page creation needs the AI service to be up: Cloud checks its `/health` before creating a Chat page and
  returns code 1032 otherwise. `just restart-server` starts it with `--with-ai`.

## 5. Backlog: further Open WebUI gaps (reviewed 2026-11-02)

Features Open WebUI (0.10 to 0.12.5) has that AppFlowy chat lacks and the plan above does not cover.
Ordered by value for ease of use; "existing" names what AppFlowy already provides to build on.

| Candidate | Repo | Existing pieces | Size |
|---|---|---|---|
| Voice dictation button | Web | `transcribe_audio` already serves AI meetings | small |
| Read aloud | Web | browser speech synthesis first, provider TTS later | small |
| `@model` per message, model pins, capability badges (vision, reasoning, image) | Web + server | `model_name` on `SendQuestionPayload`; `ModelMetadata` has only `is_default`/`desc` | small + small |
| Export chat as Markdown, copy whole chat | Web | messages already in the provider | small |
| Edit AI answers inline | Web + server guard | `PUT .../message` updates any message | small |
| Paste a URL to attach it as a source chip | Web | `web_fetch` tool | small |
| Rating (thumbs up/down with reason) | Server + Web | none; new table `af_chat_message_feedback` | medium |
| Multi-model compare (two answers side by side) | Server + Web | shares the 2.2 multiple-answers schema change | medium |
| Continue generating a truncated answer | Server + Web | answer text is saved by the client | medium |
| Per-chat model parameters (temperature, reasoning effort) | Server + Web | per-chat instructions (4.3) | medium |
| Memory viewer and editor | Server + Web | workspace memory tools exist, no list/edit API | medium |
| Live preview of HTML/SVG/Mermaid answers (artifacts panel) | Web | "Add to page" | medium |
| In-browser code execution (Pyodide) | Web | none | medium |
| Reminder/timer tool ("remind me in 2 hours") | Server | workspace notifications | medium |
| Realtime voice call mode | Server + Web | `get_ephemeral_key` exists | large |
| MCP or custom tool servers for chat | Server | tool registry | large |

Not needed in AppFlowy: folders (spaces), pinned chats (favorites), shared folders (page permissions), notes chat
(AI writer in documents), channels.

### Verification log, markdown renderer (2026-11-02)

- Local stack: Cloud on 8000, the prebuilt AI service on 5001, Web dev server on 3000, Nathan in "Pro workspace",
  chat page `c9f903eb-506c-458d-9d34-e9e864ec40c9`.
- Prompt asked for display math, inline `\(x\)`, a Python function, a Mermaid flowchart and a two-column table. The
  saved answer (message 22) rendered one KaTeX display block and one inline formula, a `Python` code block with
  12 highlighted tokens and a copy button, a `Mermaid` block whose Diagram tab held the rendered SVG (Code while
  streaming), and a table with `Lists` / `Tuples` headers.
- The first attempt lost its answer because the Vite dev server re-optimized the newly loaded `mermaid` dependency
  and reloaded the page mid-stream (`node_modules/.vite/deps/_metadata.json` rewritten at that second); a dev-only
  effect, not a save bug. The second run saved normally.
- Checks: `pnpm type-check`, ESLint on the changed files (only pre-existing warnings), Jest full suite passes.

### Code-smell review fixes (2026-11-02, all three repositories)

- Shared static renderer: `editor/components/static/static-blocks.tsx` now renders parsed blocks for the chat answer,
  `CodeResponse` and `MathEquationResponse`; the chat only overrides code (copy, Mermaid) and image blocks.
- Parser: a paragraph is split at an image that stands on its own line, also after a soft break, so
  `text\n![img](url)` renders the picture (and pastes it into documents) instead of dropping it. The server now
  also separates generated images from the answer text with a blank line (`paragraph_break_after`).
- Formats: `resolveAnswerFormat(answerId, content)` on the format provider is the single rule for regenerate and
  edit (remembered, then inferred from content through the parser, then Auto). `isChatFileUrl` replaces the
  regex-based image extraction.
- Ownership: ArrowUp only edits the current user's latest question and the editor never opens on another member's
  question. The draft and uploads are cleared only after the question is accepted.
- Attachments hook: side effects left the state updater (no double uploads under StrictMode), object URLs are
  revoked on remove, clear and chat switch.
- Message store: `messagesVersion` replaces the replaced-ids trick for in-place edits; `Message` reads the store
  during render.
- Smaller: `useImageGenerationAvailable()` hook, `MermaidDiagram` extracted from `MermaidPreview` for read-only
  surfaces, `errorMessageFromPayload`, Mermaid Diagram/Code toggle as pressed buttons, `aria-expanded` on the
  reasoning toggle, popover triggers use `data-active`, generated images have a translated `alt`.
- Tests added or tightened: parser soft-break split, `deriveChatTitle` with markers, `resolveAnswerFormat`,
  attachments hook, edit request on someone else's question, deterministic cancel tests.
- Verified against the rebuilt AI service (2026-11-03, local stack): a "Text and image" question streamed two
  paragraphs, showed "Creating image", and the saved answer ends with a blank line before
  `![Generated Image](…)`; the Web rendered paragraph, paragraph, image block with preview, copy, download and
  regenerate. The image job took 26 s, inside the 45 s inline wait. Note for manual testing: Escape while an
  answer streams stops it (`chat-input/index.tsx`), which cancelled the first attempt.

## 6. Desktop port (AppFlowy-Premium `frontend/`, 2026-11-02)

Desktop already had text/image format modes, regenerate with another format or model, sources and web search per
chat, related questions and full Markdown (math, tables, Mermaid through Kroki, code copy). The items below bring it
level with the Web work above. Shared DTO additions (`image_generation`, `KeepAlive`, `generate_answer`) reach Desktop
only after the server change merges and `just upgrade-client-api` runs, so the port avoids depending on them.

| Feature | Desktop state | Files |
|---|---|---|
| Keep-alive tolerance | done: empty answer chunks are dropped before they reach Flutter, so progress text is not reset | `rust-lib/flowy-ai/src/chat.rs` |
| Reasoning block | done: `reasoning:` stream message, `AnswerStream.reasoning`, `ChatAIMessageBloc.reasoningNotifier`, collapsible `ReasoningSection` | `stream_message.rs`, `chat_message_stream.dart`, `chat_ai_message_bloc.dart`, `presentation/message/reasoning_section.dart` |
| Progress after text | done: a partial answer stays visible with the latest step under it | `presentation/message/ai_text_message.dart` |
| Auto format by default | done: new chats start without a preset, like Web | `plugins/ai_chat/chat_page.dart` |
| Image options (size, quality, prompt) | done: `ResponseImageOptionsPB` on `PredefinedFormatPB`, mapped to `output_content_metadata`; options button in the format bar | `entities.rs`, `ai/service/ai_entities.dart`, `ai/widgets/prompt_input/image_options_popover.dart`, `predefined_format_buttons.dart` |
| Generated image actions | done: chat image block with polling, full-size viewer, copy, download, regenerate; regenerate reuses the answer's format (remembered this session, else inferred from the saved markdown) so a picture stays a picture | `presentation/message/chat_image_block.dart`, `ai_markdown_text.dart`, `chat_bloc.dart`, `ai/service/ai_entities.dart` |
| Cloud end-to-end test | done: text answer, instructions popover, image options popover, picture actions and regenerate against a live local Cloud; run by hand, not in the CI cloud runner | `integration_test/desktop/cloud/chat/ai_chat_cloud_test.dart` |
| Per-chat instructions | done: `ChatSettingsPB.instructions`, `AIManager::update_chat_instructions` (metadata merge, 4,000 chars), prompt-bar button | `entities.rs`, `ai_manager.rs`, `event_handler.rs`, `chat_settings_manager.dart`, `ai/widgets/prompt_input/instructions_button.dart` |
| Image capability gating | pending: needs `ModelList.image_generation` from the next client-api bump | `model_select.rs`, `select_model_menu.dart` |
| Edit and resend | pending: needs `generate_answer: false` from the next client-api bump to stream the new answer | `ai_manager.rs`, `chat_bloc.dart` |
| Cloud attachments | pending: upload through the blob API and `[IMAGE:url]` markers | `af_cloud/impls/chat.rs`, `prompt_input/action_buttons.dart` |
| Retry on failed answers | pending: the stream error currently removes the message | `ai_text_message.dart`, `chat_bloc.dart` |

Notes
- The Freezed generator is intentionally absent from the Flutter pubspec, so the port avoids new freezed fields:
  reasoning lives in a `ValueNotifier` on the message bloc and instructions use a bloc method rather than an event.
- Protobuf bindings were regenerated with `cargo check -p flowy-ai-protobuf --features dart` (Rust and Dart).
- Local mode: instructions persist in the chat table metadata; the local model does not read them yet.

## 7. End-to-end verification on the local stack (2026-11-03)

Both clients ran against the local Cloud (`http://localhost:8000`) with the standalone AI service rebuilt from the
working tree; the Web dev server served the working tree at `http://localhost:3000`. Server-side effects were read
from the AI service log (`answer stream called with query` shows the `ResponseFormat` each client sent) and from
`af_chat_messages`.

| Scenario | Web (Chrome, nathan's workspace) | Desktop (Flutter cloud integration test) |
|---|---|---|
| Text answer streams and is saved | passed | passed (`PONG`) |
| Markdown: display math, Mermaid diagram/code toggle, code copy | passed (KaTeX, `aria-pressed` toggle, copy buttons) | pre-existing, not re-run |
| Per-chat instructions reach the model | passed: "Hello. PINEAPPLE" after saving the instruction | passed: "Hello PINEAPPLE" saved by the server |
| Image format with size and quality options | passed: server received `IMAGE`, `1024x1024`, `standard` | passed: same request from the Desktop popover |
| Generated picture actions | passed: open full size, copy (toast), download, regenerate (new picture) | passed: hover actions, full-size viewer, regenerate produced a new picture |
| Regenerate keeps the image format | passed | failed first (request carried `Flex/TEXT`, the model composed its own 1,198-character prompt); fixed in `ChatBloc`, see section 6 |
| Regenerate from a released client (legacy `v2/answer/stream`, no format) | n/a | passed after the server fallback: the AI service reused the previous answer's shape and re-ran the original 79-character prompt as an image |
| Attachment (PNG) understood by the model | passed: "Red PINEAPPLE" | pending (cloud attachments, section 6) |
| Edit question and resend | passed: "Goodbye. PINEAPPLE" | pending (section 6) |
| Escape stops a streaming answer | passed: partial story kept, input re-enabled | not covered |
| Reasoning section | not observed: none of the available models (Azure GPT-4o family, gpt-5-mini, gpt-5.1) emitted reasoning frames | not observed |

Notes
- The Web format bar buttons had no accessible names; they now carry `aria-label` and `aria-pressed`
  (`components/ui/format-group.tsx`).
- The Desktop test hung on a bare `pumpAndSettle()` after the chat opened (the focused prompt caret never settles);
  the test only uses bounded waits now.
- Each image request costs a DALL·E call; the Desktop test generates two pictures per run.
- Server side, `services/appflowy-ai/src/biz/chat/answer_format.rs` now treats the default request format as
  "no preference" and keeps the previous answer's shape on regenerate, so released Desktop builds and older
  Web builds get the same behaviour without a client update; explicit formats are never overridden.
