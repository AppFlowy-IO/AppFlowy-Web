# Published-page comments state

## Required behavior

The comments toggle is a per-page publish setting. Its durable key is the
published page's `view_id` within its workspace.

- A page that has never been published uses the server’s historical defaults: comments and duplication enabled.
- Turning comments on or off must update the stored setting for that page.
- Unpublishing must not delete the last stored setting.
- Republishing must reuse the last stored setting.
- Opening the same published page in another tab, browser, profile, or device
  must produce the same comment-panel visibility.
- The public comment panel is rendered only when the server reports
  `comments_enabled: true`.

## Backend persistence contract

Cross-browser consistency requires the backend to be the source of truth. The
backend must persist `comments_enabled` for each published `view_id`; browser
storage cannot provide correctness outside one browser profile.

The publish APIs should apply these rules atomically:

1. On the first publish, create the publish configuration with
   `comments_enabled: true` unless the request explicitly supplies another
   value.
2. On a config update, durably store the supplied boolean before returning
   success.
3. On unpublish, retain the publish configuration, including the comments
   value.
4. On republish, reuse the retained value when `comments_enabled` is omitted,
   or replace it when an explicit value is supplied.
5. Return the persisted value from the published-info response used by public
   pages. Comment creation endpoints must enforce the same server-side value;
   hiding the panel in the client is not an authorization boundary.

Document publishing can send `comments_enabled` in its JSON publish payload.
The binary database-publish endpoint accepts an optional `config` object in its
metadata frame. Explicit options are sent there with the content, in one request.
Ordinary republishing omits options and lets the server retain its saved values.

The extensible server implementation is in
[Cloud PR #1145](https://github.com/AppFlowy-IO/AppFlowy-Cloud-Premium/pull/1145).
It stores configuration in `af_publish_config`, keyed by `(workspace_id, view_id)`,
and updates the public publication fields in the same transaction. It preserves
configuration through unpublish and slug replacement. Deploy the migration and
updated server publishing writers before deploying this Web integration.

`GET /api/workspace/{workspace_id}/publish/{view_id}/config` reads saved settings
even when the page is unpublished. `PATCH` on that URL accepts partial settings
and returns the complete saved config. The web panel reads this authenticated
endpoint when opening and uses the PATCH response after a toggle. Slug changes
continue through the existing publication endpoint. The GET supports ETag/304 through
the shared HTTP client. A warm unchanged request returns 304 using Redis, without
checking out a PostgreSQL connection; settings and permission changes invalidate
the cached response.

For databases, active publication info selects between the child and legacy
container IDs. When neither is publicly available, a saved config selects the
retained publication identity. Public-info and private-config requests are made
in parallel, and reads started before an update cannot replace the completed
save. `PublishConfig` and `PublishConfigPatch` define the Web API types for future
settings.

## Server-only settings and refresh

Publish settings are persisted only on the server. The Web client does not read,
write, or migrate publishing preferences in `localStorage`, `sessionStorage`, or
IndexedDB. Legacy browser values and storage events are ignored.

The settings panel loads server config when it opens and refreshes when the tab
becomes visible or its window regains focus. Published pages refresh their public
server settings on the same events. These refreshes bypass the application's
public-info cache so another browser's changes become visible after the response.

React holds the current server response and pending toggle state only while the
UI is mounted. Saves use the server's complete PATCH response; failed saves restore
the last confirmed value. The shared HTTP client can reuse a response when the
server validates its ETag with 304. No browser preference is replayed on republish.

## Cross-browser acceptance cases

| Previous server value | Action                               | Expected result in every browser |
| --------------------- | ------------------------------------ | -------------------------------- |
| No value              | First publish without explicit options | Comments on; panel visible       |
| Off                   | Turn comments on                     | Comments on; panel visible       |
| On                    | Turn comments off                    | Comments off; panel hidden       |
| On                    | Unpublish, then republish elsewhere  | Comments on; panel visible       |
| Off                   | Unpublish, then republish elsewhere  | Comments off; panel hidden       |
| Either                | Clear all browser storage and reopen | Server value is unchanged        |
