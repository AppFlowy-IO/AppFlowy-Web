# Image block regression coverage

## Flutter audit

Audited 2026-11-02 against AppFlowy-Premium `338ec2b1e9fe88a05f9a0de4df723b0862ed723b`, under `frontend/appflowy_flutter`. These are behavioral ports into React/Slate/Yjs and Playwright, not Dart files copied into a JavaScript test runner. Generated BDD `.dart` files duplicate their `.feature` scenarios and are counted only once.

| Flutter source | Scenarios and web coverage |
| --- | --- |
| `integration_test/desktop/document/document_image_test.dart` | Eight scenarios: placeholder/local upload, toolbar and menu replacement, alignment, external/page links, pointer resize, fullscreen, clipboard copy/paste, and caption add/edit/remove. Covered by `image.spec.ts` and `image-flutter.spec.ts`. |
| `integration_test/desktop/document/document_with_image_block_test.dart` | Single and multiple local file selection, preserved insertion order. `image.spec.ts` exercises the actual chooser and multi-file upload path. |
| `integration_test/mobile/bdd/document/image_block_bottom_sheet.feature` | Image insertion opens its picker immediately, and dismissal leaves the block intact. Ported as a web popover rather than a native bottom sheet. The separate Photo Gallery block is outside this revamp. |
| `test/widget_test/unsplash_image_selector_test.dart` | All nine scenarios: loading/results, selection/download tracking, tracking failure, Tab/Shift+Tab, bounded arrow navigation, pointer-to-keyboard navigation, Enter selection, debounced search, and provider failure. `image-flutter.spec.ts` also covers out-of-order search responses and dismissal during a request. |
| `test/plugins/document/presentation/editor_plugins/image/custom_image_block_component/image_block_bloc_test.dart` | Empty/new URL, upload completion, retained preview through retry, terminal quota classification, source changes, resize during upload, cleanup and retry state. `image-upload.test.ts`, `image-upload-lifecycle.test.ts`, `ImageBlock.test.tsx`, `useImageWithRetry.test.tsx`, and both browser specs exercise the web equivalents. Rust upload-progress subscriptions and BLoC one-shot width-reset events do not exist on Web; tests use pending upload promises, persisted retry files, and React sizing instead. |
| `test/unit_test/file_storage_upload_limit_test.dart` and `integration_test/desktop/bdd/document/image_upload_limit.feature` | File-size and workspace-storage errors survive reopening, remain non-retryable regardless of server wording, and do not create background upgrade dialogs. Unit upload tests and browser quota scenarios cover the persisted web representation. A server-owned desktop background upload continuing after the whole application closes has no web equivalent. |
| `test/plugins/document/presentation/editor_plugins/image/image_tab_activity_test.dart` | Single-image read-only rendering, offscreen/inactive loading, and one load notification per source. Web has no `DocumentBloc`/`TabActivityScope`: its adaptation defers initial offscreen loading, cancels on unmount, and keeps loaded previews stable across focus/visibility changes. Browser visibility/read-only cases and loader unit tests cover that lifecycle rather than claiming native tab-controller parity. The four gallery-specific cases belong to the separate Photo Gallery implementation. |
| `test/unit_test/image/appflowy_network_image_test.dart` | Retry exhaustion resets for an explicit new attempt. `useImageWithRetry.test.tsx` uses fake time to exercise the complete production retry budget and cancellation. |
| `test/widget_test/unsupported_image_test.dart` | Unknown single-image data stays opaque and can recover live; stale uploads cannot overwrite replacement sources; picker dismissal cannot cancel an owned upload. Covered by image unit and browser tests. Gallery serialization/layout and desktop archive HTML export are separate features. Web fullscreen has no Delete command; replacement closes the obsolete viewer instead. |
| `integration_test/desktop/cloud/database/database_image_test.dart` and `integration_test/desktop/bdd/database/board/row_detail_image_drop.feature` | Image upload in a row document and drop ownership. Browser tests use two real editors and target a single drop recipient; this ports ownership without requiring a database server or macOS native file-drop bridge. |
| `test/unit_test/editor/editor_drop_test.dart` | The two image insertion cases (empty/nonempty paragraph targets) are ported as browser file insertion tests. Its File-block cases are outside the image feature. |
| Image cases in `integration_test/desktop/document/document_copy_and_paste_test.dart` | PNG, JPEG and GIF clipboard data and the image-bytes-plus-HTML regression run through Chromium's `beforeinput` path. Filename/URL text accompanying image bytes must not insert extra text. The copy/paste round trip additionally uses the native clipboard. `imageClipboard.test.ts` ports the image-first mixed selection through AppFlowy fragments, Slate fragments and clipboard HTML, including preserved image data, new block IDs and undo/redo. |

`playwright/fixtures/images/flutter-sample.jpeg` and `flutter-sample.gif` are copied from Flutter's `assets/test/images/sample.jpeg` and `sample.gif` at the audited revision.

Also inspected `document_with_multi_image_block_test.dart`, the Photo Gallery widget tests, cover-image tests, and database gallery cover tests. They exercise different blocks/properties; they are not counted as `/image` parity. Shared fullscreen zoom/copy/download and authenticated loading are exercised here, but multi-image gallery layout/navigation is not introduced by this change.

## User-reported regressions

`playwright/e2e/integrations/image.spec.ts` covers both themes, exact upload copy, normal/destructive icon colors, blue-fill block selection versus neutral picker state, menu collision handling, four-side sizing, filename mentions with shared truncation, Page-only conversion, image links, copy success/failure toasts, independent duplication, upload recovery, and the shared Ask AI composer/dismissal behavior.

`playwright/e2e/integrations/image-flutter.spec.ts` extends those interactions with the Flutter parity cases and caption character/caret/composition, persisted quota classification, native clipboard round trips, deferred loading, and async ownership regressions.

## Running

```sh
pnpm test:e2e:image
pnpm exec jest src/components/editor/components/blocks/image/__tests__ --no-coverage --maxWorkers=2
pnpm type-check
pnpm exec tsc --noEmit -p playwright/tsconfig.integrations.json
```

The browser configuration uses a dedicated Chrome for Testing executable and Playwright's temporary profile locally, and Playwright-installed Chromium in CI. It never attaches to the user's browser. Every scenario runs in light and dark themes with the real editor and persisted Yjs document. Cloud uploads, Unsplash HTTP responses, and AI responses are deterministic service-boundary mocks; this suite does not prove live provider availability, native Flutter behavior, or a live billing backend's plan enforcement. Browser screenshots and traces are retained for failures.

## Local verification — 2026-11-02

- 134 image Playwright cases passed after merging current main: `image.spec.ts` (70), `image-flutter.spec.ts` (60), and upload-hover regression cases (4), all across light and dark themes. The combined-spec fixture was also checked with both files sharing a worker.
- 10 PDF Playwright cases passed across both themes: captions, Ask AI, hosted/self-hosted pasted-file quota handling, and multi-PDF drops/read-only behavior.
- 218 focused Jest tests passed in 29 suites, including image lifecycle/clipboard, shared fullscreen/authenticated loading, mentions/duplication, and clipboard regressions for callouts, code, math, subpages, PDF and database text.
- App TypeScript, integration-test TypeScript, scoped ESLint and `git diff --check` passed.
- Existing server-backed image copy/download/hover tests were updated for the redesigned toolbar; their live server run remains for CI. Live beta sign-in rejected the configured test credentials, so live upload/persistence is not claimed.
- The browser harness loads the shared CJS PostCSS configuration natively, preserving the production plugins without Playwright ESM transformation of Tailwind's `require.cache`. Dedicated image tests are excluded from the general connections job to avoid duplicate execution.

## Issues reproduced while porting

- A clipboard containing both image bytes and HTML inserted two images. File pastes now bypass the fallback HTML insertion path.
- Loaded notifications could fire twice for the same decoded source. They are now scoped to each load attempt.
- Empty read-only blocks exposed editing controls, and future image source types could be loaded as ordinary URLs. Both now preserve read-only/opaque behavior.
- File-size and workspace-storage failures lost their classification on reload. The safe numeric classification is persisted, and terminal limits do not offer Retry.
- A source changing to an unknown type and back while upload was pending could accept stale completion. A scoped Yjs observer invalidates ownership on source transitions, without cancelling caption or resize edits, and is removed when the operation settles.
- Caption values were controlled by delayed editor updates. A synchronous draft preserves typing/caret/IME while still following undo/redo and external changes; captions also support removal and multiline input.
- Unsplash lacked keyboard navigation and download tracking, and old requests could replace newer results. The shared picker now has keyboard navigation, cancellable/debounced search, failure recovery and nonblocking tracking.
- Persisting each resize remounted the focused handle, dropping repeated keyboard input. Saved-size changes now cancel pending pointer listeners without remounting the handle; a collaborator's resize still wins over an in-flight gesture.
- Fullscreen backdrop clicks were classified as drags. Dismissal now distinguishes pointer movement from a plain click, and clipboard failures show error feedback.

Shared impact: the Unsplash selector is also used by page covers and Photo Gallery. GalleryPreview is also used outside image blocks. The paste fix applies to file-bearing clipboard events; text and rich-fragment pastes retain their existing paths. The image-specific quota/source lifecycle, captions, and resize changes do not alter PDF/File/Drive renderers.
