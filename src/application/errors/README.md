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
in toasts or dialogs. Publishing retries and legacy missing-route/view checks use
the retained diagnostics, including an explicitly empty diagnostic, so translated
or server-controlled display wording cannot change recovery decisions.
Form-sharing bootstrap retries use the same retained diagnostics for older servers.
Error rendering tolerates denied browser storage access and retains authoritative
server hosting flags. Pass reviewed, locally authored landing-page guidance through
the explicit `description` prop; raw server diagnostics still go through `error`.

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
Mismatched-language unknown reasons use the local code mapping, then the generic
fallback when the code is unknown. Malformed or
future metadata falls back to existing mappings. Metadata does not control
authorization or retries. Hosted upgrade hints apply only to known Pro remedies;
self-hosted and unknown deployments keep neutral quota guidance.

`userFriendlyErrorMessage` can append uncertain-outcome guidance when callers
explicitly pass `operation: 'mutation'`. Existing Web UI callers currently use
the default action mode; this guidance is not automatically added to every write.

The regression tests cover real HTTP adapter paths under 200/400/503, namespace
collisions, old password responses, unknown metadata, request references,
unchanged diagnostics, retry classification, and auth session recovery. These
are controlled response tests, not a live old-server acceptance run.
History and PDF endpoints decode JSON error bodies with the same resolver even
when the request expects binary data; decoding is limited to 64 KiB and leaves
successful binary responses untouched. Binary publishing also uses the shared
response resolver. Password confirmation errors come from the entered values,
so changing server wording or the selected language cannot mark matching
passwords as different.
Failed PDF import tasks from older workers retain OCR guidance through an exact,
reviewed legacy diagnostic match. Other task diagnostics still use safe mappings;
supported optional task `user_error` metadata takes precedence.

Cloud emission requires both `APPFLOWY_PUBLIC_ERROR_MESSAGES_ENABLED=true` and
an explicit schema-1 offer. Native clients use `X-AppFlowy-Error-Schema: 1`;
Web appends `application/json; appflowy-error-schema=1` to its existing `Accept`
media ranges only after its configured server's Web `/api/server-info` advertises
`supported_error_schema_version: 1`. Older servers, unavailable discovery and
unknown schema versions keep the original request headers and local fallbacks;
the safelisted `Accept` offer also works through existing proxies whose CORS
allowlist lacks the native custom header. Existing binary media ranges are
preserved, repeated offers are collapsed, and requests that would exceed the
128-byte safelisted `Accept` limit keep their original value. Capability state is
scoped to the configured server URL. Discovery requests never opt in, allowing
the existing refresh loop to discover a server rollback even with stale state.

The opted-in Axios transport covers Cloud authentication verification,
publishing and binary download adapters. The offer is limited to that server's
`/api/` path; GoTrue, billing, signed storage requests and other origins do not
receive it. Standalone public forms and SSR retain their existing legacy error
handling without negotiating metadata. Request-level regression tests exercise
offer scope, preserved media ranges, absent/invalid discovery, server rollback, legacy and malformed or
future error metadata, successful requests after failures, unchanged retry
details and mutation request counts.

Keep legacy codes, statuses, messages and retry semantics unchanged. Roll back
by turning emission off. Merge Cloud first, wait for generated Client sync,
then update Desktop SDK pins; Web has no SDK dependency. This repository's
catalog is a fallback snapshot, not a second editable source.
