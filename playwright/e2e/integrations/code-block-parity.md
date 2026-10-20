# Code block and Mermaid parity report

Web branch: `feat/code-block-revamp`, based on `201cfcca0c091d9cf3df2e6e19cf3d99aca8b573`.
Flutter source inspected: AppFlowy Premium `338ec2b1e9fe88a05f9a0de4df723b0862ed723b`, `frontend/appflowy_flutter`. No Flutter files were changed.

## What changed

- Code block surface, spacing, hover toolbar, language label, caption and selected-block treatment follow the [code block Figma showcase](https://www.figma.com/design/3K0ai4FhDOJ3Lts8G3KOVP/Page?node-id=11147-29242). Empty blocks measure 96px high; the four-line reference measures 156px, with 14px/20px code text and body padding of 8px 20px 38px. Longer blocks grow vertically; wrapping is optional.
- Floating and six-dot menus share the same actions and state handling. Adjacent submenus flip at viewport edges and stay inside narrow viewports. Mouse-opened submenus close when the pointer leaves the parent option and submenu, with a 150ms grace period for crossing the gap. Repeated clicks retain the same submenu, Escape/Left return focus, and keyboard entry focuses the child menu. Keyboard and touch opening do not require hovering. Delete uses red text on a neutral hover background. Turn into offers Page; Comment is hidden. Language/caption/wrap data persists in Yjs.
- Flutter's language set and legacy aliases are available, including Auto, Plain text, Delphi, Verilog, VHDL and Zig. The highlighter is isolated from other app consumers and loaded on demand. Formatting is offered for JavaScript, TypeScript, JSON, CSS, HTML, Markdown, YAML and GraphQL; other languages do not have a formatter in this change.
- Mermaid supports Code/Preview/Split, a compact display toolbar, expand/pan/zoom/reset, SVG/PNG download, captions and theme-aware rendering, following the [Mermaid Figma showcase](https://www.figma.com/design/3K0ai4FhDOJ3Lts8G3KOVP/Page?node-id=15249-47145). Expanded diagrams use the dim overlay and diagram surface from node `16133:55599`. Syntax errors recover after correction; stale renders cannot replace a newer diagram.
- Diagram exports use the SVG viewBox rather than the editor preview's responsive sizing. SVG files have explicit natural dimensions, preserve vector text/shapes and remove preview size constraints. PNG files render directly from vectors at 4× natural dimensions, with a minimum 2048px longest edge, capped at 8192px per edge and 16 × 1024² pixels. Both formats preserve proportions, transparency and theme colors regardless of preview size or zoom.
- Mermaid **Copy image** is available beside Expand in Split/Preview mode and in the expanded toolbar, including read-only documents. It copies the same high-resolution PNG used for downloads, with the current theme and transparency. Preview controls support keyboard/touch access and clear mouse hover on pointer leave. Successful copies show confirmation; denied/unavailable clipboard access shows an error and allows retry. Copy code retains its existing behavior.
- Ask AI supports Generate/Refine, Explain, Check and Add inline comments from both menus and the floating AI button. Empty code disables the last three actions. Responses render Markdown, including headings, lists, tables and highlighted code. Loading uses Flutter's three animated dots and a 32px stop control with a 24px icon. Stop/Escape, retry, follow-up prompts, keep, discard and insert below are supported.
- AI proposals remain separate from saved source until accepted. A complete, single fenced snippet can replace code; prose or ambiguous snippets cannot overwrite it. Insert below can retain the original and insert the response. Changing the source/language while AI runs prevents applying an outdated answer. This uses Web's existing streaming client, not Flutter's temporary document-node implementation.
- Code stays literal: Markdown/mention/slash/emoji/formatting triggers are suppressed only for code selections. The existing prose behavior is covered by a regression check. Tab/outdent, auto-indented Enter, Shift+Enter, platform navigation, multiple-click selection, paste and read-only interactions are exercised.
- Captions grow and shrink with newlines and wrapping, without a resize handle. Like Flutter, Backspace at a collapsed caption start removes the caption and appends any remaining text to the code, with the cursor at the end. Normal character/selection deletion is preserved, and the join is one undoable operation. Returning from a Mermaid Preview caption reveals Split mode so the code cursor remains visible.
- New `/mermaid` blocks start with Flutter’s `graph TD` → `Mermaid --> Diagram` example, with two-space indentation on the second line and all source text selected. Typing replaces the example immediately; inserting after existing paragraph text preserves that paragraph.
- Code/Mermaid **Turn into → Page** creates the child with the complete code block, including literal text, language, caption, pin/wrap and Mermaid display settings. After creation succeeds, the original block becomes the subpage link in one undoable operation. Failed requests leave the source intact; edits, removal or permission changes while creation is pending prevent replacement and clean up the newly created child. Ordinary empty-subpage insertion keeps its existing behavior.

## Validation

<!-- validation-results -->
Validated locally on 2026-10-20:

- **62/62 browser checks passed**: 31 scenarios in each of light and dark Chromium, including touch mode, both menus, all AI actions, Mermaid render/export, literal input, long selection, conversion and undo.
- **288/288 unit/parser/clipboard tests passed** across 14 suites.
- Application TypeScript, browser-fixture TypeScript and ESLint for changed source files passed.
- Production build passed (40.74s); existing bundle-size and Browserslist warnings remain.
- `git diff --check` passed.
- Language-search follow-up: 6 focused browser checks passed in light/dark mode after matching Flutter’s 20px search glyph and focused field border. TypeScript and focused ESLint also passed.
- Language-picker positioning follow-up: matched Flutter’s left inset and 4px gap below the language button. All 6 focused browser checks passed in light/dark mode, including a new geometry assertion and the existing floating/six-dot submenu checks. Application and fixture TypeScript checks and focused ESLint passed.
- Caption and Mermaid-default follow-up: **24/24 focused browser checks passed** in light/dark mode (1.8m). Covers caption removal/join, caret placement, ordinary deletion, undo/redo, multiline sizing, read-only protection, Mermaid Preview return, mouse/keyboard default selection, repeated insertion, persistence and existing Mermaid menu/render/export behavior. Application and fixture TypeScript passed; ESLint reported no errors and five pre-existing SlashPanel warnings.
- Submenu pointer-leave follow-up: **30/30 focused browser checks passed** in light/dark mode (2.0m). Covers closing all five submenu types in both menus, crossing the gap in either direction, repeated clicks, keyboard focus, outside dismissal, touch selection in a narrow viewport, and existing AI actions. Application and fixture TypeScript, focused source ESLint and `git diff --check` passed. Manually verified Download stays open while entering SVG and closes when hovering another parent option on the local app's editor fixture; no console errors or fetch/XHR requests were produced.
- Turn-into-page follow-up: **16/16 focused browser checks passed** in light/dark mode (1.4m), covering code and Mermaid through both menus, complete creation payloads, empty code, undo/redo, persisted parent links and submenu regressions. **53/53 unit tests passed** across the new conversion suite and existing subpage creation/lifecycle/clipboard suites. Application and fixture TypeScript, focused source ESLint and `git diff --check` passed. A live test through localhost:3015 and the configured test backend created one child with the exact code payload, replaced the parent block, and retained the code after reopening and refreshing. The tested child produced no console errors; an unrelated emoji asset 404 was present on the original test document before conversion.
- Export-resolution follow-up: **24/24 export/renderer unit tests and 10/10 focused browser checks passed** in light/dark mode (52.1s). Downloaded SVG/PNG files are decoded and inspected from the floating menu, six-dot menu and zoomed expanded view. Tests verify vector labels/shapes, actual PNG header dimensions, nonempty theme-colored pixels, transparency and aspect ratio, plus allocation limits, invalid input and resource cleanup. Sample PNGs measure 2378×252 (wide), 636×2048 (tall) and 1697×2048 (default), with light/dark exports visually inspected. Application and fixture TypeScript, focused source ESLint and `git diff --check` passed.
- Copy-image follow-up: **29/29 clipboard/export/renderer unit tests and 20/20 focused browser checks passed** in light/dark Chromium (1.3m). Real clipboard PNGs are decoded to verify dimensions, theme-colored pixels and transparency from Split, Preview and zoomed read-only expanded views. Additional checks cover unchanged source, Copy code, hover dismissal, keyboard focus/activation, touch controls, invalid diagrams, denied permission/retry, unavailable clipboard APIs and rendering/resource cleanup. Screenshot review caught and fixed icon contrast in the expanded toolbar; computed stroke color now has regression coverage. Application and fixture TypeScript, focused source ESLint and `git diff --check` passed. Clipboard writing starts synchronously with a promised PNG, following [WebKit's clipboard gesture guidance](https://webkit.org/blog/10855/async-clipboard-api/); Safari itself was not run.
- Copy-image icon sizing follow-up: replaced the thinner custom copy asset in Mermaid previews with the same 20px Lucide icon family and stroke weight used by Expand and Download. Visually checked inline/expanded controls and light/dark screenshots; **12/12 existing copy/export browser checks passed** (47.2s), along with application TypeScript, focused ESLint and `git diff --check`.

Screenshots were visually checked against the referenced Figma nodes for code spacing/hover, menus, Mermaid display/expanded states and both themes. Screenshot and trace files are generated under `test-results/`.
<!-- /validation-results -->

Run the focused checks:

```sh
pnpm exec playwright install chromium
pnpm test:e2e:code-block
pnpm exec jest src/components/editor/components/blocks/code/__tests__ \
  src/components/editor/plugins/__tests__/codeBlockClipboard.test.ts \
  src/components/editor/plugins/__tests__/withPasted.test.ts \
  src/components/editor/parsers/__tests__ --runInBand --no-coverage --silent
pnpm type-check
pnpm exec tsc --project playwright/tsconfig.integrations.json
pnpm build
```

For interactive testing, run `pnpm test:e2e:code-block --project=chromium-light --headed`, or use the `chromium-dark` project. The suite mounts the production Editor and Yjs document in an isolated fixture, without Cloud credentials. A new GitHub Actions job runs both themes and retains screenshots/traces. AI provider responses are controlled fixtures through the actual Web request client; these results do not claim a live model/backend smoke test. Chromium ran locally on macOS; Windows/Linux key mappings have unit coverage, not native OS runs.

## React best-practices review

Reviewed the code/Mermaid components, shared editor changes, asynchronous work and React effects on 2026-10-20. Fixed three confirmed problems:

- **AI request lifecycle:** changing the translation function restarted automatic Explain/Check/Comments requests, aborted the existing stream and cleared its response. Errors now retain translation keys and translate during rendering, so locale changes do not alter request dependencies. Send and Try again pass the selected model explicitly; they no longer read a ref written during rendering. Initial source and prompt use lazy state initializers.
- **Deferred syntax highlighting:** plain-text and empty Auto blocks unnecessarily loaded the syntax bundle. An import resolving after typing or unmounting also still ran Auto detection. These cases now skip unnecessary loading/computation, while current Auto input and explicit language changes continue to highlight.
- **Deferred formatting:** a formatter finishing after editor disconnection still mutated its Slate document. Formatting now checks connectivity, permissions, block type, source text and language after loading, before computing or applying the result. The formatter and selected parser load concurrently.

Added 18 regression checks in [`CodeAI.test.tsx`](../../../src/components/editor/components/blocks/code/__tests__/CodeAI.test.tsx), [`Code.hooks.test.tsx`](../../../src/components/editor/components/blocks/code/__tests__/Code.hooks.test.tsx) and [`format-code.test.ts`](../../../src/components/editor/components/blocks/code/__tests__/format-code.test.ts). They cover translation changes during streaming, translated errors and manual retry, model selection, explicit Send, unmount cancellation, stale detection, empty/plain-text fast paths, explicit-language typing and formatting conflicts. Added browser coverage for selecting a model without submitting or clearing the prompt, followed by Send and Try again using the chosen models.

Review validation:

- **259 unit tests passed across 17 suites**, including the 18 new checks, code editing, Mermaid export/rendering, page conversion, Markdown/HTML parsers, clipboard/paste and AI stream handling.
- The full light/dark Chromium run passed **107 of 108 checks**. One existing mouse-selection check intermittently started a drag at the viewport edge before scrolling settled. Its setup now explicitly scrolls to the top before measuring coordinates; the selection assertions are unchanged. The corrected test passed **10/10 repeats**, five per theme. The new model-selection check passed in both themes.
- Application and browser-fixture TypeScript passed. Changed source and unit-test files have no remaining ESLint errors; 12 import warnings remain. Test lint cleanup was followed by 66 passing checks in the affected suites.
- Production build passed in 36.29s, with existing bundle-size, Browserslist and ambiguous Tailwind-class warnings. `git diff --check` passed.
- The local app remains available at `http://localhost:3015/`. These browser checks use controlled AI responses through the production request client, not a live AI provider.

## Flutter test mapping

Flutter tests were translated into Web tests for the same behavior; Dart test files cannot execute in the Web test runner.

| Flutter source | Web coverage |
| --- | --- |
| `integration_test/desktop/uncategorized/code_test.dart` | Language search/arrows; six-dot and floating-menu language/copy/pin/caption/AI; four AI actions; disabled empty actions; code and inline-code panel suppression. |
| `lib/plugins/document/presentation/editor_plugins/caption/caption.dart` (behavior reference) | Additional Web regressions cover caption Backspace/join, caret return, undo/redo, deletion persistence, multiline Enter, automatic sizing and read-only protection. Includes code, Mermaid Split and Mermaid Preview. |
| `lib/plugins/document/presentation/editor_plugins/slash_menu/slash_menu_items/code_block_item.dart` (behavior reference) | The same two-line Mermaid example is inserted and fully selected. Mouse/keyboard and repeated insertion tests confirm immediate replacement and preservation of neighboring text. |
| `integration_test/desktop/document/document_mermaid_test.dart` | Slash insertion; floating Display and More → Display; Code/Preview/Split persistence; expanded preview. Additional Web cases cover local rendering, themes, downloads, invalid-input recovery and unsafe markup. |
| `integration_test/desktop/document/document_codeblock_paste_test.dart` | Multiline clipboard paste, indentation, Unicode and reload persistence. Existing code clipboard and paste plugin suites also pass. |
| `test/unit_test/document/shortcuts/code_block_line_shortcut_test.dart` | All eight platform rule groups, expanded into explicit boundary/selection cases in `code-keyboard.test.ts`; real Yjs editing transactions verify identity and metadata. |
| `integration_test/desktop/document/document_shortcuts_test.dart` | Backspace at the first empty code block. |
| `integration_test/desktop/document/document_customer_test.dart` | Triple-backtick insertion and literal inline-code behavior. |
| `integration_test/desktop/document/document_option_action_test.dart` | Paragraph → code, code → paragraph, preserved block identity, undo and redo. |
| `test/unit_test/editor/share_markdown_test.dart` | Unspecified-language fenced-code parsing is covered. Native/server Markdown export is not claimed. |
| `integration_test/desktop/document/document_share_html_test.dart` | HTML export is not ported to this isolated editor suite; it needs the Web export service. |
| `test/unit_test/link_preview/kroki_cache_recovery_test.dart` | Web renders Mermaid locally rather than calling Kroki. Render failure recovery, queue isolation, theme configuration, stale results and cleanup are covered in `mermaid-renderer.test.ts`. Flutter's HTTP timeout and persistent Kroki cache tests are not applicable to this implementation. |

Test sources: [`code-block.spec.ts`](./code-block.spec.ts), [`code-keyboard.test.ts`](../../../src/components/editor/components/blocks/code/__tests__/code-keyboard.test.ts), [`code-languages.test.ts`](../../../src/components/editor/components/blocks/code/__tests__/code-languages.test.ts), [`code-ai.test.ts`](../../../src/components/editor/components/blocks/code/__tests__/code-ai.test.ts), [`mermaid-renderer.test.ts`](../../../src/components/editor/components/blocks/code/__tests__/mermaid-renderer.test.ts).

## Closed GitHub issues

All 33 results from the user's [closed `code-block` issue query](https://github.com/AppFlowy-IO/AppFlowy/issues?q=is%3Aissue+state%3Aclosed+label%3Acode-block) were inspected. “Verified in Web” means the behavior is covered by this implementation and its tests; some behavior already existed and is preserved, rather than newly fixed. Native Flutter failures are not declared fixed by a Web-only change. Results: **22 verified in Web, 5 partially verified, 5 not implemented and 1 not verified**.

| Issue | Result | Evidence or remaining gap |
| --- | --- | --- |
| [#8446](https://github.com/AppFlowy-IO/AppFlowy/issues/8446) [Bug] Home/End is not jumping to line start in code block | Partial: Web rules verified | Windows Home/End, Ctrl+Home/End, Shift selection, repeated boundaries and native word movement are unit tested. No Windows or Flutter binary was run. |
| [#8182](https://github.com/AppFlowy-IO/AppFlowy/issues/8182) [FR] Setting a code block to perform no syntax highlighting | Verified in Web | Plain text produces no syntax tokens; changing from a highlighted language clears highlighting. |
| [#8147](https://github.com/AppFlowy-IO/AppFlowy/issues/8147) [FR] Permit to convert a line of text to code block | Verified in Web | Six-dot Turn into → Code Block preserves text and block identity. Undo and redo are exercised. |
| [#8137](https://github.com/AppFlowy-IO/AppFlowy/issues/8137) [Bug] Disable all shortcuts in code block | Verified in Web | @, +, [[, /, emoji and Markdown triggers stay literal inside code. Formatting shortcuts do not modify code. |
| [#8126](https://github.com/AppFlowy-IO/AppFlowy/issues/8126) [Bug] Codeblock langauge and copy option not visible in Moto g64 phone | Partial: Web equivalent verified | Touch controls remain visible and copy works in a 430px Chromium viewport in light/dark themes. The native Moto g64 app was not tested. |
| [#8108](https://github.com/AppFlowy-IO/AppFlowy/issues/8108) [FR] Permit to create code block in callout | Verified in Web | A code block nested in a callout renders, preserves literal text/metadata, and supports read-only copying. |
| [#8090](https://github.com/AppFlowy-IO/AppFlowy/issues/8090) [FR] support verilog and more language for code blocks | Verified in Web | Verilog, VHDL and Zig are selectable and produce syntax tokens. Every selectable programming language has a registered grammar. |
| [#7409](https://github.com/AppFlowy-IO/AppFlowy/issues/7409) [Bug] Formatting and Slash commands work inside code fences | Verified in Web | Inline code suppresses prose panels and selection formatting; its selected text does not acquire bold marks. Ordinary paragraph Markdown and slash commands remain available. |
| [#7271](https://github.com/AppFlowy-IO/AppFlowy/issues/7271) [FR] Always show language on code snippet | Verified in Web | Pin language persists through reload; the label remains visible after pointer leave. Touch visibility does not depend on pinning. |
| [#6919](https://github.com/AppFlowy-IO/AppFlowy/issues/6919) [Bug] paste Rust code snippet doesn't show proper highlight | Verified in Web | Auto detects a representative Rust snippet; Rust highlighting renders after insertion. Legacy Rust aliases normalize correctly. |
| [#6905](https://github.com/AppFlowy-IO/AppFlowy/issues/6905) [Bug] unable to use keyboards to select a programming language in the code blcok | Verified in Web | Search retains focus, Up/Down wrap, Enter selects, and no-results input does not commit an invalid language. |
| [#6749](https://github.com/AppFlowy-IO/AppFlowy/issues/6749) [Bug] Code block navigation with keys and mouse-clicks isn't standard | Verified in Web | Triple-click selects a logical line; four clicks select the block. Platform line/block boundary shortcuts and Shift extensions are tested. |
| [#5880](https://github.com/AppFlowy-IO/AppFlowy/issues/5880) [Bug] Code block line numbers not in sync | Not implemented | No line-number gutter is present in this design or the inspected Flutter baseline; this PR does not add or validate synchronized line numbers. |
| [#5643](https://github.com/AppFlowy-IO/AppFlowy/issues/5643) [Bug] Line numbers are shifted comparing to the code in the code block | Not implemented | Same line-number limitation as #5880. |
| [#5581](https://github.com/AppFlowy-IO/AppFlowy/issues/5581) [FR] Luau support, code blocks | Not implemented | Lua is supported; a distinct Luau grammar/language option is not. |
| [#5541](https://github.com/AppFlowy-IO/AppFlowy/issues/5541) [FR] Delphi support | Verified in Web | Delphi is selectable, Pascal aliases resolve to it, and its keywords are highlighted. |
| [#5377](https://github.com/AppFlowy-IO/AppFlowy/issues/5377) [Bug] Unable to delete the code block if it is the first node. | Partial: Web equivalent verified | Backspace removes the first empty code block; Delete works through the menu. The native mobile editor was not run. |
| [#5229](https://github.com/AppFlowy-IO/AppFlowy/issues/5229) [Bug] Crash when styling strikethrough on MacOS 0.5.5 | Partial: Web equivalent verified | Tildes, strikethrough syntax and formatting commands stay literal without a Web editor exception. The historical Flutter/macOS crash was not reproduced in a native build. |
| [#5212](https://github.com/AppFlowy-IO/AppFlowy/issues/5212) [Bug] Export to html, no code blocks | Not verified | HTML document export is outside this editor change and requires a running export service. Rendering a code block in the Web document is not proof of export correctness. |
| [#5203](https://github.com/AppFlowy-IO/AppFlowy/issues/5203) [FR] Add language select with keyboard support to the Code Block | Verified in Web | Keyboard language selection, aliases, no-results behavior, submenu focus and Escape/Left focus restoration are exercised. |
| [#5032](https://github.com/AppFlowy-IO/AppFlowy/issues/5032) [Bug] Import markdown, the URL with username and password in the code block is abnormally converted | Partial: import verified | The exact issue attachment example, curl https://user_name:password@github.com, remains literal through Markdown parsing and code insertion/paste. Server-owned Markdown export round-trip is not verified. |
| [#4999](https://github.com/AppFlowy-IO/AppFlowy/issues/4999) [FR] Code block text coloring | Verified in Web | Syntax tokens and colors render in both themes. Leading whitespace, CRLF, Unicode and HTML metacharacters retain correct Slate offsets. |
| [#4971](https://github.com/AppFlowy-IO/AppFlowy/issues/4971) [Bug] Code Block doesn't support selected line/s indentation with TAB | Verified in Web | Tab/Shift+Tab indent/outdent selected lines by two spaces, preserve backward selection, and exclude a following line when selection ends at its start. |
| [#4967](https://github.com/AppFlowy-IO/AppFlowy/issues/4967) [FR] Code language search in Code Block | Verified in Web | Case-insensitive, trimmed language search includes aliases and keyboard navigation. |
| [#4959](https://github.com/AppFlowy-IO/AppFlowy/issues/4959) [Bug] Input underscore exception | Verified in Web | Underscores and double underscores remain literal code instead of triggering emphasis. |
| [#4932](https://github.com/AppFlowy-IO/AppFlowy/issues/4932) [Bug] Typing inside a code block breaks it. | Verified in Web | Typing, Enter, Tab, multiline paste and Unicode keep a single code block. Shift+Enter deliberately exits to a paragraph. |
| [#4930](https://github.com/AppFlowy-IO/AppFlowy/issues/4930) [FR] Code Blocks | Verified in Web | Slash and Markdown insertion, editable code, syntax selection, persistence and read-only rendering are covered. |
| [#4923](https://github.com/AppFlowy-IO/AppFlowy/issues/4923) [Bug] Keyboard up/down arrows are not working in code block | Verified in Web | Unmodified Up/Down move between code lines; subsequent text insertion confirms caret placement. |
| [#4614](https://github.com/AppFlowy-IO/AppFlowy/issues/4614) [Bug] Code block selection problem | Verified in Web | A 70-line block supports upward mouse drag, cross-viewport Shift-click and forward/backward keyboard selection; wrap retains selectable content. |
| [#4431](https://github.com/AppFlowy-IO/AppFlowy/issues/4431) [FR] ``` to create a code block | Verified in Web | Typing three backticks creates and focuses an editable code block. |
| [#3915](https://github.com/AppFlowy-IO/AppFlowy/issues/3915) [FR] Ability to select monospaced fonts for code blocks | Not implemented | The code block uses a system monospace stack; no user-selectable code font picker is added. |
| [#3555](https://github.com/AppFlowy-IO/AppFlowy/issues/3555) [FR] Executing code blocks | Not implemented | Code execution/runtime integration is not part of this editor implementation. |
| [#3478](https://github.com/AppFlowy-IO/AppFlowy/issues/3478) [FR] Add a copy button to the top-right corner of the code block. | Verified in Web | Top-right Copy appears on hover and on touch, copies exact source, and works in read-only documents. |

## Remaining scope

- Not implemented: line numbers, Luau, selectable code fonts and code execution.
- Not verified: service-backed HTML/Markdown export round-trips, native Moto/Android regressions, native Windows behavior and the historical Flutter/macOS crash.
- Rendering uses Mermaid's diagram engine; node geometry follows the source/engine rather than reproducing a hard-coded illustration. The neutral light/dark palette, display controls and overlay follow Figma.
- New UI strings are supplied in English through the existing localization workflow; other locales use the configured fallback until translated.
- No Flutter schema migration is required: existing language, caption, pin and Mermaid mode fields are retained. `wrap_code` is optional Web presentation metadata; older Flutter clients retain their existing wrapping behavior.
