# Published page SSR

The Bun server in `deploy/` can include a published page's content in the initial
HTML, so crawlers that do not run JavaScript (most LLM and answer-engine crawlers)
can read it. The client app still mounts over it with `createRoot`, exactly as before,
but keeps the server-rendered article on screen while its route chunks load
instead of flashing a spinner, and reuses the inlined snapshot (a
`<script type="application/json">` block after `#root`) instead of fetching it again.

**It is off by default.** With no configuration, every published page gets
byte-for-byte the response it had before this feature existed: head metadata, an
empty `<div id="root">`, and no robots directives. This is enforced by
`deploy/publish-golden.test.ts`.

## How a page's mode is decided

`deploy/indexing-policy.ts` makes the decision once per request. First match wins:

| # | Condition | Mode | Robots directive |
|---|---|---|---|
| 0 | Namespace is an app path (`app`, `login`, `auth`, …) | shell | none |
| 1 | `APPFLOWY_SSR_KILL_SWITCH` is on | shell | none |
| 2 | Publisher set `indexing_enabled: false` | shell | `noindex, nofollow, noarchive, nosnippet` |
| 3 | Publisher set `indexing_enabled: true` | server-rendered | none |
| 4 | Namespace is in `APPFLOWY_INDEXABLE_NAMESPACES` | server-rendered | none |
| 5 | Anything else | shell | none |

Rules 2 and 3 read `config.indexing_enabled` from the published-metadata
response. AppFlowy-Cloud does not send that field yet, so today these rules never
match and only the namespace allowlist enables SSR.

"Shell" is the pre-SSR response. Any failure while server-rendering (snapshot
fetch error or timeout, a database page, a malformed snapshot) also serves the
shell, never an error.

## Environment variables

Set these on the web container (the same place as `APPFLOWY_BASE_URL`). They are
read on every request; the effective values are logged once at startup — check
that line after changing them, since a misspelled variable is silently ignored.

| Variable | Default | Meaning |
|---|---|---|
| `APPFLOWY_INDEXABLE_NAMESPACES` | empty (none) | Comma-separated publish namespaces to server-render, e.g. `docs,guide`. Exact, case-sensitive match. |
| `APPFLOWY_SSR_KILL_SWITCH` | off | `true`, `1`, `yes` or `on` disables SSR everywhere, overriding everything else. |
| `APPFLOWY_SSR_SNAPSHOT_TIMEOUT_MS` | `1500` | Total time SSR may spend upstream: the page snapshot, then link lookups with whatever is left. A snapshot that misses it serves the shell. Clamped to 100–5000. |
| `APPFLOWY_SSR_MAX_INLINE_BYTES` | `1048576` | Largest snapshot inlined into the page for the client to reuse. Larger pages are still server-rendered; the client fetches the snapshot itself. |

Changing a variable requires restarting the container; it is not instant.

## Enabling for AppFlowy's docs and guides

```bash
APPFLOWY_INDEXABLE_NAMESPACES=docs,guide
```

Verify after the restart:

```bash
# Allowlisted page: content is in the HTML, no robots restriction.
curl -s https://appflowy.com/guide/getting-started-with-appflowy | grep -c 'data-appflowy-ssr'   # 1
curl -sI https://appflowy.com/guide/getting-started-with-appflowy | grep -i x-robots-tag         # (nothing)

# Any other namespace: unchanged. Capture before enabling, compare after.
curl -s -D before.h https://appflowy.com/<namespace>/<page> -o before.html   # before
curl -s -D after.h  https://appflowy.com/<namespace>/<page> -o after.html    # after
diff before.html after.html
diff <(grep -iv '^date:' before.h) <(grep -iv '^date:' after.h)

# App routes never server-render.
curl -s https://appflowy.com/app | grep -c 'data-appflowy-ssr'   # 0
```

## Turning it off

Set `APPFLOWY_SSR_KILL_SWITCH=true` and restart, or remove the namespace from
`APPFLOWY_INDEXABLE_NAMESPACES`. Either returns pages to their pre-SSR response.
Content crawlers already fetched stays in their indexes; if an HTML cache is ever
added in front of these pages, purge it too.

## Scope and limits

- Only document pages are server-rendered. Database pages (grid, board,
  calendar, gallery) always get the shell.
- The server-rendered markup is plain semantic HTML with minimal styling
  (`deploy/publish-serializer.ts`). It is independent of the React editor by
  design; unknown block types keep their text in a neutral wrapper.
- `deploy/publish-serializer.test.ts` fails when a new `BlockType` is added
  without deciding how the serializer treats it.

## Meta descriptions

Server-rendered pages replace the generic description (`description`,
`og:description`, `twitter:description`) with one taken from the page's opening
prose: paragraphs, lists, quotes, callouts and toggles, in document order,
skipping headings, code, equations and tables. It is cut to 155 characters at a
word boundary. Pages with no prose keep the default. Shell pages always keep the
default, so their response is unchanged.

## Links to other pages

Sub-page blocks and page mentions render as real links, so crawlers can follow
them to the rest of a site. The snapshot only contains view ids, so the server
looks each one up (`/api/workspace/v1/published-info/{view_id}`, anonymous):

- Only in server-rendered mode; shell pages make no extra requests.
- A target is linked only if it is published **and** is in the same namespace
  or an allowlisted one. SSR never hands crawlers a URL into a namespace that
  has not opted in. Everything else renders as the plain page name.
- At most 50 targets per page and 6 lookups at a time. The lookups share the
  snapshot's `APPFLOWY_SSR_SNAPSHOT_TIMEOUT_MS` budget: they get whatever the
  snapshot fetch left, so SSR waits at most that value upstream in total. When
  nothing is left, only already-cached targets are linked. Results are cached
  in memory for 60 seconds, so an unpublished or renamed page stops being
  linked within a minute.
- Any lookup failure or timeout drops that link, never the page.

## Testing

- `deploy/*.test.ts` (Jest): the policy, serializer, link resolution and full
  request handling against a mocked upstream API; `publish-golden.test.ts`
  pins the default response byte for byte.
- `deploy/publish-ssr-client.test.ts`: feeds the server's real HTML to the
  client code that reads it (inlined snapshot, server-rendered article).
- `playwright/e2e/page/publish-ssr.spec.ts`: end to end against the Bun server
  and a real Cloud. It moves its workspace to one of the namespaces in
  `APPFLOWY_INDEXABLE_NAMESPACES` and checks the rendered HTML, then that a real
  browser shows the article before any script runs and hands it to the app
  with no spinner in between. CI sets the variable for the whole Playwright job.
  Without it, the spec is skipped (e.g. against the Vite dev server).

To run the end-to-end spec locally, build the app, start `bun deploy/server.ts`
with `APPFLOWY_INDEXABLE_NAMESPACES=e2e-ssr-a,e2e-ssr-b,e2e-ssr-c`, and run
Playwright with the same variable and `BASE_URL` pointing at that server.
