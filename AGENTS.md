# AppFlowy Web agent instructions and document-embed memory

Last consolidated: 2026-11-02. Source: the user's callout, PDF Embed, File, Image, and Google Drive work, plus related review feedback in this conversation.

This is a regression checklist and record of user expectations, not a claim that every item is already implemented or verified. Newer explicit user instructions take precedence.

## Required workflow for every document-embed task

1. Read this entire file before planning or changing a document embed, media block, caption, upload picker, block menu, or shared editor control. Re-read the relevant sections before final verification.
2. Identify the applicable historical issues below and use them as acceptance criteria. Check shared-component impact beyond the block being edited.
3. Inspect the Flutter implementation and its relevant tests first when porting a feature. Port the behavior and test scenarios into the Web architecture; do not merely reproduce screenshots. Inventory related shared account/error tests as well as block-named tests, record the Flutter-to-Web test mapping, and identify native-only adaptations and untested provider boundaries before claiming parity.
4. Use Figma MCP for supplied design frames. Read the applicable Figma skill before using its tools. Match the supplied frame and latest desktop screenshots in spacing, dimensions, typography, icons, colors, hover, focus, selection, and error states.
5. Use a separate git worktree for a new task. Preserve unrelated changes. If a new worktree's base does not yet contain this file, copy this memory into its root before implementation. Do not overwrite newer or additional instructions.
6. Follow React best practices and relevant Flutter guidance. Review effects, subscriptions, cleanup, async races, controlled inputs, read-only behavior, and shared component consumers.
7. Add meaningful regression coverage for the reported failure. Exercise real interactions in the editor, not only isolated mocks or input `.fill()`. Run relevant tests, type checks, and lint; report what was actually verified.
8. Keep the local app available for user testing with the correct worktree and environment. Restart after environment changes. Verify the served source and URL instead of assuming the browser is using the new code.
9. When a new issue or correction is reported, update this ledger in the task worktree. Keep the local main-checkout copy current when it exists, preserving other instructions, so subsequent worktrees inherit the learning.
10. Do not treat historical requests to submit a PR as authorization to submit every future task. Follow the current task's authorization.

## Browser automation preference — mandatory

- Never inspect, attach to, or automate the user's everyday Chrome browser, its tabs, or its personal profiles. This applies to Chrome DevTools MCP, Chrome/browser plugins, computer-use tools, AppleScript, CDP, and any other automation route.
- Use a dedicated Chrome for Testing instance with an isolated temporary profile for browser debugging and testing. Verify the executable and profile isolation before using browser tools. Do not use `--autoConnect` or reuse a personal Chrome user-data directory.
- The configured Chrome DevTools MCP uses the Chrome for Testing executable under `~/Library/Caches/ms-playwright/chromium-1208/` with `--isolated`. If that executable is unavailable, locate or install a dedicated testing browser; never fall back to the user's everyday Chrome.
- Existing Codex sessions may still have the old `--autoConnect` MCP process loaded. Do not call its browser tools until it has been restarted with the isolated configuration. Do not enumerate personal browser tabs to verify isolation.
- These preferences apply across projects, including when a skill suggests reusing an existing Chrome session. If isolation cannot be established, report the blocker instead of accessing the user's browser.

## Collaboration branch identity

- Regression checked 2026-11-09: missing remote collab-version metadata is no evidence of a branch
  change. Preserve the known Y.Doc version, local cache, and pending outbox edits. Only a concrete
  differing version may trigger history recovery.
- Sibling-tab edits can be broadcast before server acceptance. An unversioned peer update must not
  enter a known restored branch; retain local state until authoritative catch-up arrives.
- Cover versionless Update and Manifest delivery over WebSocket and BroadcastChannel with queued
  edits before and after the message. Assert that uploads retain the version and both edits reach
  a server replica, without cache reopening, outbox discard, or document destruction.

## Row duplication relation regressions

- Re-read the activated source cell and its membership after related database or row hydration. A newer edit or undo must prevent a delayed reciprocal insertion from restoring a removed link.
- Preserve canonical shared-array identity for unlimited relation edits so concurrent additions merge. Keep one-only replacement semantics and legacy on-write normalization separate.
- A duplicate's reciprocal graph belongs to its creation history group, even though ordinary relation edits skip history. Foreign row writes need an owner-specific history origin and lifecycle cleanup so unrelated target edits retain their own undo history.
- Late completion must join the original history group without consuming newer actions or discarding their redo. Cover deferred hydration, real Yjs replica merging, displacement, and undo/redo.

## CI regression history

- Regression checked 2026-11-14: freeze the clock in relative-date editor interaction tests and pick a calendar date different from the resolved relative date. On November 14, Tomorrow is the 15th; clicking the selected 15th clears the value to `timestamp: null`.
- Docker build heap settings must reach the Node process inside both builder stages. The `web-build` job's `NODE_OPTIONS` does not configure a separate Docker build.
- Calendar drag helpers must reveal the target inside its scroll container before measuring pointer coordinates. Use nearest-edge scrolling so revealing a clipped Sunday row does not hide Saturday's source event. Keep the real FullCalendar and mouse-drag regression.

## Shared issues reported across embed PRs

### Menus, icons, hover, and placement

- Icons became black on hover or were too dark to recognize in dark mode. Use the app's themed icon treatment; normal, hovered, selected, disabled, and destructive states must remain readable in both themes.
- Delete must use the shared destructive red hover treatment for both label and icon.
- Submenu arrows must match the supplied design, including size, stroke, alignment, and spacing.
- Alignment submenus must include Left, Center, and Right icons and clearly show the active alignment.
- Second-level menus appeared in the wrong position. Anchor them to their triggering row, handle horizontal collisions, and keep the submenu reachable.
- Upload/replace popovers and action menus were cut off near the viewport bottom. Flip or shift them and bound their height; keep inputs and actions accessible in short viewports.
- Slash-menu labels and icons must follow the requested designs. Confirm the new block actually appears and can be inserted in the locally served app.
- Turn into Page must actually create the page and preserve the block's content. Do not leave a visible action that silently does nothing. For Image, the user's later clarification was that Turn into contains Page only.

### Distinct selection states

- Clicking the six-dot block menu must select the corresponding block.
- An empty embed selected through its block action menu uses the desktop blue fill treatment.
- A filled PDF selected through its block menu uses blue fill only: no bright blue outline. Preserve visibility of the preview beneath the fill.
- Opening the upload picker by clicking an empty block is a different state from selecting the block via its six-dot menu. Follow the desktop's neutral active background for the picker state instead of reusing the action-menu selection.
- Verify selection is attached to the correct block and clears appropriately when menus close. Compare empty and populated blocks separately.

### Upload, replace, links, and file identity

- Selecting a file in the native file picker should upload automatically; the user must not need a second Upload click. Keep any design-specified footer controls consistent with that behavior.
- File upload popovers must follow the PDF/desktop design, including tabs, drop zone, spacing, and Cancel/Upload controls where specified.
- Replacing a previously uploaded file must open an empty, focused Embed Link input. Do not prefill it with the upload's internal URL.
- Scope picker drafts, replacement guards, and account sessions to the target block. Switching targets must reset local state and unmount the previous account picker so its late result cannot update another block.
- Open in browser must display previewable content in a new tab, not trigger the download flow. Download remains a separate action.
- Copy link to block followed by pasting a mention must display the file/photo name, not the containing page title or a generic label.
- Use the general mention styling, filename icon conventions, and existing maximum-width/ellipsis behavior. Long names must not expand the line without bound.
- Copy link to original must be present for externally sourced images, including Unsplash and embedded image URLs.
- Use the designated original-link icon. A regular copy action should use the normal copy icon, not a chain-link icon.
- Successful copy actions, including copy image, copy link to block, and copy link to original, must show the shared AppFlowy success toast. The latest screenshot says “Copied to clipboard” with the shared success icon and styling. Only show success after the clipboard operation succeeds.

### Captions and placeholders

- Captions are left aligned and follow the Code block caption's style and behavior.
- Caption input previously reset freshly typed text and moved the caret during editor updates. Keep the input responsive while persisting edits to the document.
- Preserve the caret when inserting into the middle, replacing a selection, deleting, and entering multiple lines. Test rapid typing and IME/composed text as well as simple typing.
- Caption drafts must still reflect external document changes, undo/redo, and read-only state. Verify persistence after reload; a correct-looking local draft alone is insufficient.
- Google Drive's reproduced cause: the controlled textarea used the Slate node value directly while Slate published the change after the input event, allowing React to restore old text/caret. The local caption draft now updates synchronously and synchronizes document changes. Preserve that behavior.
- Placeholder text must start after the caret; the first character must not appear underneath it.
- Use the exact latest requested placeholder copy. Image upload: “Drag & drop a file or click to Browse”, with Browse styled as the action. Remove the appended “or paste an image link/URL” wording.

### Ask AI

- Use the general AppFlowy AI composer design, with the Math Equation block as the reference, rather than an embed-specific substitute.
- Clicking an image's star/Ask AI button opens the standard composer below the block.
- Escape or an outside click must dismiss an empty AI composer. Do not accidentally discard a typed draft.
- PDF offers its PDF-specific summary action as well as the general Ask AI flow; preserve the intended menu hierarchy and correct submenu placement.
- Use the shared spacing, theme colors, input, model/action controls, and submit-button states. Check shared media-assistant consumers when changing this behavior.

### Preview stability and document interaction

- Taking a screenshot, switching window focus, changing visibility, hovering, or typing a caption must not reload a loaded preview.
- Refresh only for an intentional Reload or a real source/session change that requires it. Avoid unnecessary effects, changing keys, or unstable dependencies that remount media.
- Duplicating an image previously displayed “Image load failed” even though the image was visible. Preserve valid source data and independent load/error state; do not revoke or invalidate a source still used by another block.
- Support interaction inside an embed: scrolling, page navigation, text fields, controls, and fullscreen. Selection overlays, resize handles, and editor event handlers must not intercept normal viewer input.
- Resizing and fullscreen must preserve the appropriate preview state, including current page where the viewer supports it.
- Test actual pointer dragging across a cross-origin iframe, not just keyboard resizing. Suspend preview pointer input only during an active resize and restore it on completion/cancellation, keeping normal scrolling and pagination available.
- Cancel captured resize gestures when the source, account, alignment, or saved dimensions change; do not apply an old gesture to a replacement file or overwrite a collaborator's resize.
- Resize keyboard arrows must match the handle's axis and edge: Left/Right for horizontal handles, Up/Down for vertical handles, with the correct direction for top/left edges.
- Persisting a resize must not remount the handle and lose keyboard focus. Verify repeated arrow presses, while still cancelling an active pointer gesture when a collaborator changes the saved dimensions.
- Preserve plan-dependent upload limits. Verify free-plan rejection/upgrade behavior and permitted Pro-plan file sizes; do not bypass the limit while simplifying upload UX.

## Block-specific issue history and acceptance criteria

### Callout

- Suppress the inner six-dot menu beside the callout title line; retain it for body text blocks inside the callout.
- Align the callout's outer block handle with its icon. Center body-line handles against their own text line.
- Correct submenu chevrons and Ask AI styling against the supplied references.
- Fix the caret overlapping the first placeholder character inside nested/toggle content.
- Review shared editor-control effects on other block types, not just Callout.

### PDF Embed

- Slash-menu name is “PDF Embed”; verify slash insertion works in the served app.
- Hide the Comment option for the PDF block.
- Implement and validate empty, uploaded, and URL-embedded action menus with the appropriate actions for each state.
- Support upload/replace, pagination and go-to-page, resizing, fullscreen, captions, alignment, summary/AI, retry/error states, and password states where supported by the PDF implementation.
- Invalid non-PDF links should follow the specified bookmark fallback and feedback. Distinguish an actual invalid URL from a valid PDF rejected because of response headers, redirects, or loading restrictions.
- User-reported valid-PDF failure to retain as a regression example: `https://htmlhoster.com/p/MRTM0V0T/The_2022_Community_Careers_Guide.pdf`. Treat it as an external fixture whose availability may change; use deterministic equivalents in automated tests.
- Recheck auto-upload, open-in-new-tab behavior, filename mentions, left-aligned captions, destructive/icon hover, submenu placement, bottom-edge clipping, blue-fill selection without outline, and no refresh on screenshots.
- Preserve Pro-plan file-size logic.
- The user requested Playwright coverage for PR #672 and fixes for failing tests; do not rely only on type checks or unit tests for these interaction regressions.

### File

- Port Flutter features, tests, and UX, using PDF Embed's upload-popover design.
- Rename dialog must match the supplied desktop reference: title “Rename file”, close control, helper “Enter the new name for this file”, populated name field, and Save action with the specified spacing.
- Turn into Page must work and preserve file content.
- Clicking a file should open it in a new browser tab instead of invoking Download; keep explicit Download separate.
- Replacing an uploaded file: Embed Link is empty and immediately editable/focused.
- Recheck the PDF lessons for hover, selection, popover positioning, captions, mentions, and Ask AI rather than rebuilding their old failures.

### Image

- CI follow-up (2026-11-05): alignment options use “Align left/center/right”. When testing lazy-loaded duplicates after reload, scroll the stable block rather than the image node, which is replaced when validation supplies its source. Keep dedicated Playwright configs aligned with `.eslintignore.web` and type-check them through the integration-test tsconfig.
- Preserve the shared editor's 40px image placeholder and 24px trailing action slot. Apply `data-media-placeholder` to the empty surface so shared padding does not wrap or inset a populated image.
- Fullscreen copy action uses the normal copy icon and a success toast.
- Duplicate must load correctly without a spurious error banner.
- Pasted block-link mentions use the photo filename and shared truncation/style rules.
- The later explicit Turn into requirement is Page only; the Page action must work.
- Align menu includes alignment icons and the current-selection indicator.
- Copy link to original is available for Unsplash and URL-embedded images; use the requested original-link icon and shared success toast.
- The image's target-link picker must match Flutter: full-width focused “Paste link or search pages” input, Recent pages, proper page icons/titles, and correct row hover. Do not substitute space names with generic chain-link icons.
- Once an image has a target link, clicking any non-control area of the image should navigate to that target. Keep toolbar, resize, caption, and selection interactions working.
- Image upload copy uses “Drag & drop a file or click to Browse”; no paste-URL suffix.
- Empty Ask AI dismisses on Escape/outside click.
- Use the specified Figma slash-menu icons.
- Clipboard data can contain both image bytes and HTML. Insert one image from the file bytes; do not also parse the HTML into a duplicate. Chromium rich/file paste tests must exercise beforeinput or the native clipboard.
- Preserve typed captions, IME, multiline input, and removal. Unsplash needs keyboard navigation, cancellable search, and best-effort download tracking that cannot block insertion.
- Persist safe upload-limit classifications across reload, including workspace storage limits, and suppress Retry for terminal quotas. Ignore stale upload completion after source-type transitions, even if the source type later becomes supported again.
- Fullscreen backdrop clicks must close the viewer; only an actual drag should suppress dismissal. Copy failures must show error feedback without a success toast.

### Google Drive Embed

- Port Flutter behavior and tests while rechecking all Image/PDF/File lessons.
- Match the empty “Paste a link or select files from google drive” state, Embed Link and Browse Google Drive tabs, account chooser, connected/disconnected states, and populated preview/footer.
- Account chooser user/add icons must be legible in dark mode, matching the supplied desktop example.
- Choosing an account must open Google's actual file picker with folder navigation and file selection, not a custom flat list of files.
- Bind the picker to the selected account and handle adding another account, cancellation, reconnect, and private-file access. Keep tokens out of document content and logs.
- Verify whether account connection problems come from frontend configuration, OAuth, or backend support instead of assuming the UI alone can fix them.
- A thumbnail of a PDF or document only shows one page. Use the full Google viewer for PDF/Docs/Sheets and other document previews even when metadata contains a thumbnail. Only image files should use the scrollable image preview.
- Scrolling inside the viewer must reach the next and previous pages of the same document. A tall first-page image is not a substitute for pagination.
- Check inline and fullscreen pagination and ensure focus/screenshots do not reset the current page.
- Caption editing must retain newly typed letters and caret position; cover persistence, undo/redo, multiline/IME input, and external updates.
- Implement invalid-link bookmark fallback and supported provider error/reconnect states. Do not invent an AppFlowy password-unlock flow for Google-hosted permissions.
- Match Flutter access recovery for 403/404 separately from retryable provider failures such as 500. After access is restored, explicitly selecting the same file/account again must retry its preview; a subscription keyed only by file ID can stay stuck on the reconnect state. Keep ordinary focus, caption and screenshot updates stable.
- The user switched the local environment to `beta.appflowy.cloud` and requested a restart. Read the current environment at task time; do not silently revert the backend or assume every worktree uses the same configuration.
- For local testing against beta, verify the exact origin. On 2026-11-02, beta allowed `http://localhost:3006` but omitted Access-Control-Allow-Origin for `http://127.0.0.1:3006`, blocking login. Prefer the verified localhost URL; restart the task frontend after `.env` changes and check the served runtime config. A credential rejection after CORS is fixed is a separate sign-in problem, not an image-block failure.
- When merging shared editor spacing changes, put `data-media-placeholder` on the empty Drive surface itself. Keep the populated preview outside placeholder padding, and verify both surfaces in the browser.
- Include new Playwright configs in the dedicated test TypeScript project and the existing main ESLint exclusions. Run the full `pnpm lint` command to catch root config files missed by focused source lint.
- In provider-error tests, wait for the initial authenticated metadata response before installing the failure mock; Picker metadata can render the footer before the preview request finishes. For scroll containment, record the outer scroll position after hovering the target, because Playwright may scroll it into view.

## Other issues from previous reviews — apply when relevant

- Floating document outlines must be enabled only for visible hosts. The AI chat drawer can close by shrinking to zero width while its Document stays mounted; an outline portaled to document.body must not remain visible or navigate that hidden document.
- In short viewports with a cover, reserve enough height for usable outline entries. Example failure: viewport height 600px, content start 412px, panel height 76px, header/padding 72px, leaving only 4px for headings. Clamp position against a usable minimum height.
- Recompute outline tracking when toggle visibility changes, even if editor dimensions remain unchanged because another column is taller. Do not leave a collapsed/hidden heading highlighted until the next scroll.
- Template URLs must consistently honor the saved primary category in both AsTemplate and the share panel (including copied/opened links). Share the resolver and fallback; do not use categories[0] in one entry point.
- Product-visualization HTML showed unequal apparent gaps between images, especially the fourth/fifth pair. Check intrinsic whitespace inside assets and displayed image dimensions as well as paragraph margins and explicit breaks. Do not assume identical HTML wrappers guarantee equal visible spacing.

## Design references

Use the relevant MCP frame and latest user screenshot; these links are references, not evidence that a current implementation matches them.

- Callout handles/alignment: https://www.figma.com/design/3K0ai4FhDOJ3Lts8G3KOVP/Page?node-id=11142-6176
- Block-menu arrows: https://www.figma.com/design/3K0ai4FhDOJ3Lts8G3KOVP/Page?node-id=17230-73573
- Callout Ask AI: https://www.figma.com/design/3K0ai4FhDOJ3Lts8G3KOVP/Page?node-id=11615-9207
- PDF Embed: https://www.figma.com/design/3K0ai4FhDOJ3Lts8G3KOVP/Page?node-id=13853-36342
- File: https://www.figma.com/design/3K0ai4FhDOJ3Lts8G3KOVP/Page?node-id=10751-4429
- Image: https://www.figma.com/design/3K0ai4FhDOJ3Lts8G3KOVP/Page?node-id=10747-38544
- Copy link to original icon: https://www.figma.com/design/3K0ai4FhDOJ3Lts8G3KOVP/Page?node-id=11553-8151
- Slash-menu icons: https://www.figma.com/design/a3iCZh32MlkFqc178phnIM/Database?node-id=199-11920
- Google Drive Embed: https://www.figma.com/design/3K0ai4FhDOJ3Lts8G3KOVP/Page?node-id=14963-45081

## Verification checklist before handing back an embed change

- Test the relevant empty, uploaded, external-link, connected-account, error, and read-only states.
- Inspect light/dark themes, icon hover, destructive actions, selected fill, toolbar/handle alignment, and focus/caret placement.
- Open action menus, submenus, upload/replace pickers, and AI near viewport edges and in short windows.
- Exercise real file selection/drop, replacement, rename, copy/paste mentions, clipboard feedback, new-tab opening, duplication, and Page conversion where applicable.
- Type into captions character by character and in the middle of existing text; check selection replacement, deletion, multiline/IME, save/reload, and undo/redo.
- Verify that screenshots/focus/visibility, hover, caption edits, and resizing do not unnecessarily reload previews or repeat provider requests.
- For multipage content, navigate forward and backward inside the same embed and in fullscreen. Ensure the document underneath does not consume the viewer's scroll.
- Check applicable upload limits and account/auth boundaries without weakening them for the test.
- Run focused regression tests with real Slate/Yjs and browser interactions where relevant. Mock external service boundaries deterministically, and explicitly distinguish mocked-provider tests from live provider verification.
- Summarize effects on shared menus, captions, mentions, upload controls, media AI, selection, and other blocks. Report remaining limitations rather than claiming untested parity.
