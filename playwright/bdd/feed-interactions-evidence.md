# Feed interaction evidence and browser scenarios

Research checked on September 8, 2026. This pass covers card properties and
access to existing discussions. It does not implement analytics, subscriptions,
conditional colors, or property-value search.

## Verified evidence

| Behavior | Evidence | AppFlowy coverage |
| --- | --- | --- |
| Feed uses stacked database pages and supports commenting directly on posts | [Notion Feed help](https://www.notion.com/help/feeds) | `feed-interactions.feature`: a discussion popover retains its mention and attachment when dismissed |
| View settings contains property visibility controls; the eye control shows or hides a property | [Notion Feed help](https://www.notion.com/help/feeds) | `feed-interactions.feature`: visible properties appear below the title and retain their order and visibility |
| Property values appear horizontally below the title, without visible field-name labels; the property menu has drag handles | [Creator's original Notion screenshot](https://cdn.prod.website-files.com/63e37b9e98dcc9263ccc743d/6862597d45a908493a92b53e_feed_properties.jpeg), embedded in [their walkthrough](https://templatesfornotion.com/newsletters/notion-feed-view) | Same property scenario checks position, drag reordering, hide/show, view switching, and reload |
| Submitting the first inline comment replaces the composer with an avatar, reply count, and time | [Tool Finder's original Notion recording, 1:42–1:44](https://www.youtube.com/watch?v=bquos-Z9JbQ&t=102s); independently shown in [TEMP/円谷's original recording, 1:42–1:44](https://www.youtube.com/watch?v=B7jFXqwvAtU&t=102s), linked by [the creator's article](https://temp.co.jp/blog/feed-view) | Discussion scenarios check the inline composer and summary states; an active draft is preserved when the first comment arrives from another tab |
| Activating the existing-comment summary opens a floating popover above it, containing the saved comment and another composer; the Feed card does not expand | [Tool Finder's original Notion recording, 1:44–1:46](https://www.youtube.com/watch?v=bquos-Z9JbQ&t=104s) | Discussion BDD scenario verifies a popover, saved comments, and continued composing without opening row detail |
| Comments generally support person mentions and emoji reactions | [Notion comments help](https://www.notion.com/help/comments-mentions-and-reminders) | Existing Feed social tests; new discussion scenario verifies a reply mention. This general documentation does not establish the Feed popover's precise behavior |

### Recorded comment interaction

Tool Finder's recording, published June 21, 2025, provides the following visual
sequence. Timestamps were checked against decoded video frames:

- **1:42:** the user types the first comment in the card footer. Attachment,
  mention, and send controls appear beside the input.
- **1:44:** submission has replaced that composer with an avatar, `1 reply`,
  and the latest-comment time.
- **1:44.2–1:44.4:** the pointer moves onto the summary; its full row highlights
  and then darkens.
- **1:44.6–1:44.8:** a floating discussion opens above the summary. It contains
  the existing comment's author, time, and text, followed by an `Add a comment`
  composer. The summary and card remain visible underneath.
- **1:45–1:46:** the discussion stays open while the pointer moves outside it
  toward blank space on its right.
- **1:46.2:** the discussion has disappeared, with the pointer in that blank
  space. At **1:46.6**, the user scrolls upward after it has closed.

The video has no mouse-event overlay. It demonstrates summary activation and
outside dismissal, but does not prove the exact input event, whether hovering
can also open the popover, or whether dismissal was caused by a click or a timer.
It does not show typing a second comment or scrolling with the popover open.

TEMP/円谷's independent July 2025 recording shows an existing card with only its
reply summary at **1:35**, then typing into another empty card at **1:42–1:43**.
At **1:44**, that input has been replaced by a reply summary and time. It does
not show opening that summary.

I also inspected Notion's [official July 2025 release demo](https://www.notion.com/releases/2025-07-10)
([video](https://videos.ctfassets.net/spoqsaf9291f/tBuYJmohXpQ4EtXSapjcH/9c554fc5a3320ec9d3d22528d3366948/FeedView_Students.mp4)).
It shows changing Table to Feed and scrolling cards with content and reactions.
It does **not** demonstrate opening or submitting a Feed comment.

Notion's [official June 20, 2025 LinkedIn demo](https://www.linkedin.com/posts/notionhq_new-feed-view-turn-any-database-into-a-activity-7341878034183938050-yBSJ)
also shows horizontal, label-free property values at **0:04–0:06**, and empty
comment composers while scrolling. It does not demonstrate opening a discussion.

## Explicit limits of the comparison

The screenshots and recordings are historical evidence from 2025. They do not
constitute live verification of Notion's September 2026 UI. A connected,
signed-in Notion browser session is required to verify current behavior.

These details still need live verification before claiming exact Notion parity:

- Exact opening and dismissal events, Escape behavior, and popover placement
  when its preferred position does not fit the viewport.
- Reply grouping, nested replies, and default handling of resolved comments.
- Draft behavior when a discussion closes or another comment arrives.
- Scrolling with an open discussion and submitting another comment within it.
- Exact property editing interactions and current property-menu grouping.

The AppFlowy implementation uses its shared popover and row-comment components.
It opens the discussion above the summary, places the continued composer in the
popover, and replaces the initial inline composer after submission. Outside
click and Escape dismiss it while preserving drafts and uploads. If the first
comment arrives remotely while an inline draft is active, that composer remains
available until submission or cancellation. These draft protections, attachment
support, read-only protections, reply grouping, and resolved-comment handling
reuse or extend AppFlowy's behavior; they are not claimed as verified Notion
requirements. The exact placement rule and dismissal events are likewise
AppFlowy choices beyond what the recording proves.

## AppFlowy acceptance scenarios

`playwright/bdd/features/database/feed-interactions.feature` uses Given/When/Then
steps with isolated test accounts and real database collabs. The controls are
exercised through the UI. The cross-tab scenario uses two tabs in the same
browser context and account; it verifies synchronized remote updates, not
cross-user permissions.

- Show two properties, verify their horizontal positions, reorder them by
  dragging, hide one, switch views, reload, and show it again.
- **A discussion popover retains its mention and attachment when dismissed:**
  open an existing discussion, draft a reply with a mention and attachment,
  dismiss and reopen it, submit, and verify continued composing in the popover.
- **A comment arriving from another tab preserves the first inline draft:**
  open the same empty card in two tabs, submit its first comment from the second
  tab while the first holds a draft, then verify draft retention and further
  discussion updates in both tabs.
- **Switching reply threads retains drafts and each thread can be resolved:**
  compose under two parents, switch between drafts, submit each to its original
  parent, resolve both, and reopen one. Escape dismisses nested comment menus
  without closing the surrounding discussion.
- The existing `feed-readonly.feature` additionally checks toggling a visible
  checkbox without opening row detail, then locking the containing document
  and checking that the checkbox and property settings cannot be edited.

The discussion scenario also checks keeping row detail closed. The existing
core Feed browser scenario verifies reading the same comment in row detail
afterward.

Focused unit tests additionally check read-only and unauthenticated rendering,
pending uploads, remote updates, comment-map hydration/replacement, and absence
of document writes while reading.

## Validation

- All 449 unit suites passed (4,344 tests).
- Type checking passed; changed source lint passed with no errors.
- Five BDD scenarios passed: the four interaction scenarios above and the locked
  Feed scenario. Both focused core Feed E2E scenarios passed (first comment and
  switching an existing view to Feed).
- The cross-tab fixture explicitly focuses the tab being edited and verifies
  the same populated row title in both tabs before commenting.

Run the Feed BDD suite with `pnpm test:e2e:bdd:feed`; it generates the Given/When/Then
scenarios before running them. The new scenarios are tagged `@feed-interactions`.
