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
check also compares the two repositories. The bundled snapshot is an offline
fallback; runtime public copy comes from the standalone endpoint described below.
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
Mismatched-language unknown reasons use a supported server or local code mapping,
then the generic fallback when the code is unknown. Malformed or
future metadata falls back to existing mappings. Metadata does not control
authorization or retries. Hosted upgrade hints apply only to known Pro remedies;
self-hosted and unknown deployments keep neutral quota guidance.

New Web clients also load public copy from the configured Cloud's standalone
`GET /api/error-messages?schema_version=1&platform=web&client_version=<web-version>&locale=<selected-language>`.
The explicit schema, platform and actual bundled client version identify this
new-client request; no server-info discovery field or minimum release number is
needed. A successful response is `{code:0,data:{schema_version:1,locale,reasons,codes}}`,
where `reasons` contains reviewed public strings and `codes` maps Cloud numeric
error codes to reason names. The endpoint provides no diagnostics or matching
rules. Per-response metadata remains strongest; reviewed legacy classifications
preserve overloaded-code specificity, then server code mappings precede bundled
mappings. Server copy precedes bundled copy only when its response locale matches
the selected app language. Code-to-reason mappings remain useful across languages,
so new codes can use existing app translations until Cloud provides that language.
HTTP, GoTrue, transport and local validation identities keep their existing
namespaces and do not consume Cloud's remote code or reason tables. Server quota
instructions are not amended with client-authored Pro or administrator remedies.

`AppConfig` starts the optional catalog owner before sign-in. Owners share one
in-memory server/locale-scoped session with a five-minute refresh, focus/online
revalidation, a ten-second request deadline, and cancellation on configuration
change or disposal. Requests use a fixed URL, omit credentials, reject redirects
and avoid browser storage and normal error interceptors. Reading stops at 256 KiB;
the schema allows at most 512 reason entries and 512 code entries, bounded public
strings, valid locale/reason identifiers and referenced signed 32-bit error codes.
The endpoint is available without an operator flag; unsupported requests return
204. Unsupported/legacy endpoints, malformed/future catalogs and network
failures clear optional remote copy and retain reviewed local fallbacks. Shared
React error pages subscribe to catalog revisions, so displayed server wording can
refresh without a new client bundle. Standalone public forms and SSR retain local
fallbacks. Catalog data changes presentation only: codes, diagnostics, retry
headers and recovery checks are preserved.

The validated body and its optional ETag stay together in that in-memory session.
Refreshes send `If-None-Match` only while both are available. An empty 304 with a
matching ETag keeps the body, resets the refresh schedule and avoids notifying
React subscribers. Tags use weak comparison of the complete opaque value and
are limited to one quoted ASCII validator of at most 256 characters. A valid 200
replaces both body and validator; missing or unsupported ETags still allow public
copy but disable conditional requests. An unverifiable 304 clears the cache and
uses local fallback until the next unconditional refresh. Other failed responses
also clear both values. Server or language changes and final owner disposal drop
the pair. Fetch uses `cache: 'no-store'` so this explicit cache controls reuse.
Cloud responds with `Cache-Control: private, no-cache`; cross-origin deployments
must allow `If-None-Match` and expose `ETag` on both 200 and 304 responses.

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

Per-response Cloud metadata requires an explicit schema-1 offer; it has no
environment switch. Native clients use `X-AppFlowy-Error-Schema: 1`;
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

Keep legacy codes, statuses, messages and retry semantics unchanged. Clients that
do not opt in continue receiving the legacy envelope. The standalone catalog
works with the current Desktop SDK pin and has no generated Client dependency. Native per-response metadata
opt-in still requires merging Cloud, waiting for generated Client sync, and then
updating Desktop SDK pins. Web has no SDK dependency. This repository's catalog
is a fallback snapshot, not a second editable source.
