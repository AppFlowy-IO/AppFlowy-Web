# Shared error presentation

`shared-error-catalog.json` is a byte-identical snapshot of
`AppFlowy-Cloud-Premium/libs/app-error/resources/error_messages.json`. That canonical
file owns existing Cloud codes, HTTP statuses, GoTrue reasons/legacy messages,
and reviewed English guidance. Desktop's overlapping FFI codes remain in its
separate `desktop.json`; do not use FFI numbers as Cloud numbers.

From this Web checkout:

```sh
pnpm error-catalog:sync --source /path/to/AppFlowy-Cloud-Premium/libs/app-error/resources/error_messages.json
pnpm error-catalog:check --source /path/to/AppFlowy-Cloud-Premium/libs/app-error/resources/error_messages.json
```

Sync generates the named constants, English `userError` translations, and a
source checksum. Commit those outputs together. Regular `pnpm lint` verifies the
snapshot and generated files without a Cloud checkout. The optional `--source`
check also compares the two repositories. Runtime never fetches the catalog.
Edit the canonical file, not this snapshot. Protocol/SDK fixes still belong in
the server repository; this file changes presentation only.

Use `getErrorMessage(error)` at UI boundaries. HTTP adapters also populate safe
`.message` text for existing callers. `diagnosticMessage`, numeric `code`, actual
`httpStatus`, request reference, and retry data remain available. Use
`getErrorDiagnostic` for existing recovery checks and logs, and
`userErrorSupportDetails` only for explicit copying. Do not display those details
in toasts or dialogs.

Adapters select `sourceDomain` so Cloud `-1` (Unhandled), local network `-1`,
HTTP statuses, and GoTrue numeric statuses do not collide. In particular, 1073
is export contention; 1069 is an existing workspace member. HTTP 422 alone says
neither that signup is disabled nor that the email is registered. Known GoTrue
machine reasons and exact reviewed legacy strings determine those messages.

Old `{code, message}` Cloud responses and `{code, msg}` GoTrue responses work
without server changes. Unknown codes remain failures with a nonempty explanation
and their available code; arbitrary diagnostics never become default UI text.
Supported optional `user_error` schema 1 with a `locale` matching the app's
selected language takes precedence, including wording for known reasons. The
request adapter sends `Accept-Language`. Current Cloud copy is English; other
languages retain client translations. Untagged schema-1 metadata keeps the prior
behavior: known reasons localize and unknown reasons use bounded public copy.
Mismatched-language unknown reasons use the local generic fallback. Malformed or
future metadata falls back to existing mappings. Metadata does not control
authorization or retries. Hosted upgrade hints apply only to known Pro remedies;
self-hosted and unknown deployments keep neutral quota guidance.

The regression tests cover real HTTP adapter paths under 200/400/503, namespace
collisions, old password responses, unknown metadata, request references,
unchanged diagnostics, retry classification, and auth session recovery. These
are controlled response tests, not a live old-server acceptance run.

Cloud emission is opt-in (`APPFLOWY_PUBLIC_ERROR_MESSAGES_ENABLED=true`). Keep
legacy codes, statuses, messages and retry semantics unchanged. Roll back by
turning emission off. Merge Cloud first, wait for generated Client sync, then
update Desktop SDK pins; Web has no SDK dependency. This repository's catalog is
a fallback snapshot, not a second editable source.
