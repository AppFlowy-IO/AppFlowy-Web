# Published-page comments state

## Required behavior

The comments toggle is a per-page publish setting. Its durable key is the
published page's `view_id` within its workspace.

- A page that has never been published starts with comments disabled.
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
   `comments_enabled: false` unless the request explicitly supplies another
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
The binary database-publish endpoint currently cannot carry publish config, so
the backend must either extend that operation to accept the setting or apply
the default/preserved value server-side in the same transaction. A follow-up
PATCH after publishing is not sufficient for atomic correctness: it can fail
after the page has already become public.

## Frontend cache and synchronization

The web client stores one minimal, versioned boolean per `view_id` in
`localStorage`. This supports immediate synchronization among same-origin tabs
and preserves the selection while a page is unpublished. Confirmed changes
cause already-open published-page tabs to re-fetch published info from the
server.

This browser value is a cache and cross-tab invalidation signal only. It must
not replace backend persistence, because it is unavailable in another browser,
profile, device, cleared storage, or a private browsing session.

## Cross-browser acceptance cases

| Previous server value | Action                               | Expected result in every browser |
| --------------------- | ------------------------------------ | -------------------------------- |
| No value              | First publish without opting in      | Comments off; panel hidden       |
| Off                   | Turn comments on                     | Comments on; panel visible       |
| On                    | Turn comments off                    | Comments off; panel hidden       |
| On                    | Unpublish, then republish elsewhere  | Comments on; panel visible       |
| Off                   | Unpublish, then republish elsewhere  | Comments off; panel hidden       |
| Either                | Clear all browser storage and reopen | Server value is unchanged        |
