# Desktop form refactor parity

Reference: [Premium #1575, first commit](https://github.com/AppFlowy-IO/AppFlowy-Premium/commit/02dbdaa3a433f45e94450b2dca190e6b5e671428).
Design: [Database form frames](https://www.figma.com/design/a3iCZh32MlkFqc178phnIM/Database?node-id=12219-183668).
The second commit's mobile-only layouts are outside this change.

## Source and test mapping

| Flutter implementation/tests inspected | Web implementation/coverage |
| --- | --- |
| Native `16x/form_builder.svg` at Premium `90d4bf9b49851576bb513357486e886082afc293`; `SettingButton`, `actionsForDatabaseLayout(Form)` | Shared PageIcon/ViewIcon use the exact native asset through FormViewIcon; FormSettings exposes Layout only. Browser checks 16px tab geometry, themed strokes, full 600px title width/36px single-line height, responsive width, and a working Settings/Layout menu with no Filter/Sort |
| `form_page.dart`, `form_actions.dart`, `form_page_loading_test.dart`: shared header/body services, header mounted first, no live history sharing | `FormViewScope`, `FormActions`, `FormBuilderView`; `FormViewScope.test.tsx`, `FormBuilderView.scroll.test.tsx`, database history suites, isolated browser header-first bootstrap assertion |
| `form_builder_content.dart`, `form_question_type_picker.dart`, `form_question_type_picker_bdd_test.dart`: 600px column, centered outline button, new types only, clipped menu items | `FormQuestionTypePicker.test.tsx`; browser tests measure column width, button center/height, and short-viewport picker bounds. Per explicit user correction, the picker opens centered above the button with a 4px gap, never overlapping it |
| `form_question_card.dart`, `form_question_menu.dart`: 32px trigger, hover/touch visibility independent of menu state, required/type title, move/remove and switches | `FormQuestionCard.test.tsx`, `FormQuestionTitle.test.tsx`; browser checks trigger opacity and exact menu/trigger rectangles. The user's explicit placement correction takes precedence over the earlier interpretation of native anchors: popup top-right aligns with trigger bottom-right (`side='bottom'`, `align='end'`, zero offset). Insufficient space below flips the menu above; short windows bound the scrollable menu |
| `form_metadata_fields.dart`, `form_metadata_fields_test.dart`, question description input: multiline drafts and remote synchronization | Metadata/card draft suites; browser types title characters and Enter, edits descriptions, then reloads the encoded Yjs document |
| `form_question_body.dart`, `form_add_option_button.dart`: plain radio/checkbox option rows, fixed-height inline addition, date/URL arrows, 120px long answers, read-only content | Shared placeholder/option/card tests; browser measures Add option before/after focus and checks actual read-only option labels |
| `form_preview_page.dart`, `form_preview_inputs.dart`, `form_preview_page_test.dart`: 840px dialog, 600px answers, display-only typed labels, native radio selection, local validation, disabled empty Submit, preserved answers and report link | Preview schema/error/snapshot tests, `FormBody.validation.test.tsx`; browser fills preview, submits, checks retained answers and zero submission requests. Snapshot tests keep remote changes out of an open preview and refresh them on the next open |
| `form_share_controller_test.dart`, share access/link/submenu files: authoritative URL, anonymous/public rules, permissions, clipboard, pending save and retries | `useFormShare.test.tsx`, `FormSharePopover.test.tsx`, form HTTP API suites; browser checks shared state, submenu reachability and read-only controls |

## Browser runs

```sh
BASE_URL=http://localhost:3010 pnpm exec playwright test \
  playwright/e2e/form/form-refactor-isolated.spec.ts \
  playwright/e2e/form/public-form-scroll.spec.ts --workers=1
```

The fixture loads production React components, database dispatchers, form writers and Yjs history. Only the account context and HTTP boundary are fixtures. It stores encoded Yjs updates in localStorage to test save/reload; this does not verify Cloud acceptance, IndexedDB reconciliation or multi-client synchronization. The fixture uses the app's theme provider, styles and toaster. Playwright launches its dedicated testing browser with a fresh profile.

`form-refactor.spec.ts` additionally exercises the full authenticated application and database creation. Its attempted live run was blocked before app setup by a Cloudflare 403 from the configured GoTrue admin endpoint. It has not passed against the live provider.

## Web adaptations and boundaries

- Flutter AFPopover/AFMenu interactions use the existing Web Radix components, with collision handling, keyboard focus access and touch visibility. Native widget tests were inspected; Flutter tests were not executed here.
- Web creation and history use the existing atomic Yjs dispatch instead of Flutter's native field service. No upload, quota, permission or sharing policy is relaxed.
- Public respondent input rendering and API validation keep their existing contract. Desktop preview gets typed titles, native radio glyphs and local success feedback through explicit preview props; it never posts response rows or uploads selected files.
- Public URL validation remains the existing Web/API validation rather than adopting Flutter's more permissive scheme handling. Live OAuth, file storage, Cloud persistence and cross-client behavior are not established by the mocked HTTP browser run.
- Menu/caption/media editor shared primitives were not restyled globally. Form-specific text glyphs and the desktop native radio glyphs are scoped to form consumers. Regression runs include the shared database view and public form suites.

Light/dark authoring and preview screenshots are emitted into the Playwright test output directory.
