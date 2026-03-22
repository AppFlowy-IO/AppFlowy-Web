# Bug: Embedded Database Persists After Deletion From Sidebar

**Video**: [DatabaseDeletionFromLeftIndex.mov](https://drive.google.com/file/d/1jjAqObX5t9pRwITbHq_X8GQ64GkOPO-L/view)

---

## How Notion Handles This Case

Before diving into our bug, here is how Notion — the closest comparable product — handles the same scenario. This serves as the UX reference for our fix.

### Notion's Architecture

Notion uses a **block-based architecture** where every piece of content (text, images, databases) is an atomic block with a unique UUID, properties, a type, and parent/child pointers. Databases are blocks that contain **data sources** (the actual rows + schema) and **views** (Grid, Board, Calendar — different ways to display a data source). Inline/embedded databases appear as sub-pages in the sidebar under their parent page.

### What Notion Does When the Source Database Is Deleted

When a user deletes the original database (the data source), any **linked database views** that reference it display a clear message:

> **"The original database has been deleted and cannot be edited"**

Key behaviors:
- The linked view block is **not removed** from the page — it stays in place as a placeholder
- The placeholder **replaces the grid/board/calendar** with a non-editable message
- The user is informed about what happened (the source was deleted) rather than seeing a broken or empty grid
- The deleted database goes to Trash and remains recoverable for 30 days
- If the user restores the database from Trash, the linked views reconnect automatically

### Notion's Design Principles at Play

1. **Transparency over silent failure**: Rather than showing a broken grid with console errors, Notion shows a clear human-readable message explaining what happened.
2. **Non-destructive**: The block stays in the document (not auto-removed), preserving the user's page layout. The user can manually remove it or restore the source.
3. **Separation of data source and view**: Notion separates "data sources" from "views". Deleting a view doesn't affect the data source. Deleting a data source shows a message in all linked views but doesn't delete those view blocks.
4. **Recoverability**: Since deleted content goes to Trash for 30 days, showing a placeholder (instead of auto-removing the block) gives users a chance to undo the deletion and have everything reconnect.

### How This Applies to AppFlowy

Our current behavior (broken grid with console errors) is strictly worse than Notion's approach. Our proposed fix achieves the same core behavior:

| Aspect | Notion | AppFlowy (proposed) |
|--------|--------|-------------------|
| Detects deletion | Yes — linked views detect source is gone | Yes — `OUTLINE_LOADED` event listener |
| Shows placeholder | "The original database has been deleted and cannot be edited" | `t('error.generalError')` — "Something went wrong. Please try again later" |
| Block auto-removed | No — block stays, shows message | No — block stays, shows message |
| Recoverable | Yes — restore from Trash reconnects | Partially — Trash exists but reconnection not yet implemented |

**Future improvement**: Our placeholder message (`"Something went wrong"`) is less informative than Notion's. A follow-up could use a dedicated message like `"This database has been deleted"` with a link to Trash or an undo action.

### Sources

- [Data sources — Notion Help Center](https://www.notion.com/help/data-sources-and-linked-databases)
- [Linked Notion databases from deleted databases](https://templatesfornotion.com/newsletters/linked-notion-databases-from-deleted-databases)
- [Delete & restore content — Notion Help Center](https://www.notion.com/help/duplicate-delete-and-restore-content)
- [Exploring Notion's Data Model: A Block-Based Architecture](https://www.notion.com/blog/data-model-behind-notion)
- [Intro to databases — Notion Help Center](https://www.notion.com/help/intro-to-databases)
- [Notion Databases and Data Sources: The Complete Guide](https://thomasjfrank.com/notion-databases-can-now-have-multiple-data-sources/)

---

## How AppFlowy Desktop (Flutter) Handles This Case

The Flutter desktop app already handles this correctly through a **multi-layer reactive system**. The web app needs to match this behavior.

### Detection: `BuiltInPageWidget` + Backend Notifications

When a database block loads its referenced view, the desktop app calls `ViewBackendService.getView(childViewId)`. If the view is not found, it checks trash to determine the status:

| Status | Meaning |
|--------|---------|
| `inTrash` | Database was moved to trash (recoverable) |
| `deleted` | Database was permanently deleted |
| `noPermission` | User doesn't have access |
| `found` | Database exists and is accessible |

### Real-Time Notification Flow

```
User deletes database from sidebar
    |
    v
Backend fires DidMoveViewToTrash notification
    |
    v
AllViewsListener / ViewListener broadcasts to all components
    |
    v
DatabaseTabBarBloc.didUpdateChildViews() receives deleteChildViews list
    |
    v
Tab removed from tabBars, controller disposed
    |
    v
onViewIdsChanged callback fires in DatabaseViewWidget
    |
    v
DatabaseBlockUtils.removeViewId() updates document node attributes
    |
    v
Document transaction persists the change
```

### Placeholder UI: `NoPermissionWidget`

When a database view cannot be loaded, the desktop app shows a `NoPermissionWidget` with status-specific messages:

- **In Trash**: `"This database is in the trash"` (via `LocaleKeys.document_inlineDatabase_viewInTrash`)
- **Deleted**: `"This database was deleted"` (via `LocaleKeys.document_inlineDatabase_viewDeleted`)
- **No Permission**: `"No permission to view this database"` (via `LocaleKeys.document_inlineDatabase_noPermission`)

Each message is shown with a warning icon, replacing the database grid.

### Undo/Redo Support

The desktop app has a `DatabaseBlockTrashDeleteQueue` that defers actual deletion:
- When a database block is deleted from a document, view IDs are **queued** (not immediately trashed)
- This allows the user to **undo** the deletion without needing to restore from trash
- On document close/switch, `flush()` moves queued views to actual trash
- On undo, `_restoreViewsFromTrash()` calls `TrashService.putback()`

### Key Desktop Files

| File | Role |
|------|------|
| `database_view_block_component.dart` | Renders embedded database blocks, loads views via `BuiltInPageWidget` |
| `database_block_utils.dart` | View ID add/remove with backward compatibility |
| `built_in_page_widget.dart` | Loads views, detects trash/delete/permission status |
| `no_permission_widget.dart` | Placeholder messages for unavailable databases |
| `database_view_widget.dart` | Hosts database UI, `onViewIdsChanged` callback |
| `tab_bar_bloc.dart` | Manages tabs, handles `didUpdateChildViews` deletion notifications |
| `database_block_transaction_handler.dart` | Deferred deletion queue, undo/redo support |
| `view_listener.dart` | Single view change listener |
| `all_views_listener.dart` | All workspace view changes listener |

### Web vs Desktop: Gap Analysis

| Feature | Desktop (Flutter) | Web (before) | Web (after this PR) |
|---------|------------------|--------------|---------------------|
| Detects sidebar deletion | `AllViewsListener` + `DidMoveViewToTrash` | None | `OUTLINE_LOADED` event + trash API check |
| Placeholder message | `"This database is in the trash"` / `"This database was deleted"` | N/A (broken grid persists) | `"This database is in the trash"` |
| Distinguishes trash vs deleted | Yes — 3 distinct states | No | Partial — `inTrash` boolean |
| Auto-removes view ID from block | Yes — `onViewIdsChanged` callback chain | No | No (deferred) |
| Undo support | Yes — `DatabaseBlockTrashDeleteQueue` | No | No (deferred) |
| Real-time via backend events | Yes — folder notifications | No | Via `OUTLINE_LOADED` + on-mount check |
| Trash restoration | Yes — reconnects automatically | No | Yes — clears `notFound` when view leaves trash |

### Remaining Follow-Up Work (to reach full desktop parity)

1. **Full status enum**: Replace `notFound` boolean + `inTrash` boolean with a single status enum (`inTrash | deleted | noPermission | found`) matching desktop's `BuiltInPageLoadStatus`
2. **Auto-remove view ID from block data (Option C)**: When a view is confirmed permanently deleted (not just trashed), update the Slate node to remove the stale `view_id`. This requires a deferred deletion queue to support undo.
3. **Undo support**: Implement `DatabaseBlockTrashDeleteQueue` equivalent for web — queue view deletions until document close, allow undo to cancel them

---

## Problem

When a user deletes a database page from the left sidebar (e.g., right-click > Delete on "New Database"), the embedded database grid inside the parent document **continues to render** instead of showing a "not found" or error state.

### Symptoms

1. The database page disappears from the sidebar (correct)
2. The embedded grid in the document remains fully visible (incorrect)
3. Console errors appear: `No range and node found`, failed POST requests
4. A stale "Grid" child view may appear under a sibling database in the sidebar

### Reproduction Steps

1. Create a document page (e.g., "Share my life")
2. Insert two embedded Grid databases via `/grid` command
3. Both databases appear as "New Database" children in the sidebar
4. Right-click one "New Database" in the sidebar > Delete
5. **Expected**: The embedded grid shows an error/placeholder state
6. **Actual**: The embedded grid remains visible with broken behavior

## Root Cause

There is a **missing notification path** between the sidebar deletion and the embedded database block.

### Deletion Flow (current)

```
User deletes database from sidebar
    |
    v
usePageOperations.deletePage(viewId)
    |
    v
PageService.moveToTrash(workspaceId, viewId)
    |
    v
Backend removes page from folder structure
    |
    v
loadOutline() refreshes sidebar  -->  OUTLINE_LOADED event fires
    |
    v
Sidebar removes the "New Database" entry  [OK]
    |
    X  <-- No notification to embedded DatabaseBlock
    |
    v
DatabaseBlock still has view_ids pointing to deleted page
    |
    v
Grid continues rendering with stale data + console errors
```

### Why the block is not notified

The `DatabaseBlock` component (`src/components/editor/components/blocks/database/DatabaseBlock.tsx`) loads the database document on mount via `useDocumentLoader` and the view metadata via `useViewMeta`. Both only run on **initial mount** — neither re-checks whether the view still exists after the initial load.

The `DatabaseTabs` component does handle view deletion, but only when a view tab is deleted **from within the database UI** (the `onDeleted` callback in `DeleteViewConfirm`). It does **not** react to external deletion from the sidebar.

### Key files involved

| File | Role |
|------|------|
| `src/components/app/hooks/usePageOperations.ts` | `deletePage()` calls `PageService.moveToTrash()` + `loadOutline()` |
| `src/components/editor/components/blocks/database/DatabaseBlock.tsx` | Renders embedded database; holds `view_ids` in block data |
| `src/components/editor/components/blocks/database/hooks/useDocumentLoader.ts` | Loads the YDoc for the database view (one-time) |
| `src/components/editor/components/blocks/database/hooks/useViewMeta.ts` | Loads view metadata (one-time) |
| `src/components/editor/components/blocks/database/components/DatabaseContent.tsx` | Renders `<Database>` or error state based on `notFound` |
| `src/components/database/components/tabs/DatabaseTabs.tsx` | Handles view tab deletion within database UI |
| `src/components/editor/EditorContext.tsx` | Provides `eventEmitter` to editor components |
| `src/components/_shared/outline/utils.ts` | `findView()` — recursive search in outline tree |
| `src/application/constants.ts` | `APP_EVENTS.OUTLINE_LOADED` event name |

## Implemented Fix — Option A: Dynamic Detection (no document mutation)

**Design decision**: We chose **dynamic-only detection** — the document's Yjs data (`view_ids`) is never modified. The `notFound` and `inTrash` states are computed at runtime. This is the simplest approach that:

- Preserves the `view_id` in the document, so **Trash restoration automatically reconnects** the database
- Avoids document mutations, eliminating undo/redo edge cases
- Requires no new infrastructure (no deferred deletion queue, no trash putback integration)

### Why the outline-based approach didn't work

The initial implementation tried to check the `OUTLINE_LOADED` event's outline tree for the database view. This failed because:

1. **Database views are not in the outline tree** — The outline tree returned by the server contains document pages and spaces, but database views (children of database containers) are not included as children of document pages in the outline data.
2. **The server API returns trashed views** — `ViewService.get()` returns view metadata even for trashed views, making it impossible to distinguish active from trashed views via the standard API.
3. **The `trashList` state has race conditions** — The app's `trashList` state is updated asynchronously after `loadTrash()` completes, which may not happen before the `OUTLINE_LOADED` handler runs.

### Actual implementation: Trash API check

The fix directly fetches the trash list from the server on each `OUTLINE_LOADED` event AND on initial mount, then checks if the view's database container is in the trash.

**Files changed:**

| File | Change |
|------|--------|
| `DatabaseBlock.tsx` | New `useEffect` with trash API check, `inTrash` state |
| `DatabaseContent.tsx` | New `inTrash` prop, shows "This database is in the trash" message |

**In `DatabaseBlock.tsx`**, after the existing hooks:

```typescript
import { APP_EVENTS } from '@/application/constants';
import { ViewService } from '@/application/services/domains';

// New state
const [inTrash, setInTrash] = useState(false);

// Effect: check trash on mount and on OUTLINE_LOADED
useEffect(() => {
  const eventEmitter = context.eventEmitter;
  if (!eventEmitter || !viewId || !hasDatabase || !workspaceId) return;

  let cancelled = false;

  const checkView = async () => {
    try {
      const [trashItems, viewMeta] = await Promise.all([
        ViewService.getTrash(workspaceId),
        ViewService.get(workspaceId, viewId).catch(() => null),
      ]);

      // Check both the view ID and its parent container ID.
      // When a database container is trashed, only the container appears
      // in trash — not its child view IDs.
      const idsToCheck = new Set<string>([viewId]);
      if (viewMeta?.parent_view_id) {
        idsToCheck.add(viewMeta.parent_view_id);
      }

      const isInTrash = trashItems?.some((item) => idsToCheck.has(item.view_id));

      if (cancelled) return;

      if (isInTrash && !notFound) {
        setInTrash(true);
        setNotFound(true);
      } else if (!isInTrash && notFound) {
        setInTrash(false);
        setNotFound(false);
      }
    } catch {
      // Network error — keep current state
    }
  };

  // Check on mount (covers navigating back after deletion)
  void checkView();

  // Check on every folder change
  eventEmitter.on(APP_EVENTS.OUTLINE_LOADED, checkView);
  return () => {
    cancelled = true;
    eventEmitter.off(APP_EVENTS.OUTLINE_LOADED, checkView);
  };
}, [context.eventEmitter, viewId, workspaceId, hasDatabase, notFound, setNotFound]);
```

**In `DatabaseContent.tsx`**, the placeholder now shows a specific message:

```tsx
const getNotFoundMessage = () => {
  if (isPublishVarient) return t('publish.hasNotBeenPublished');
  if (inTrash) return t('document.inlineDatabase.viewInTrash', 'This database is in the trash');
  return t('error.generalError');
};
```

### Key design details

1. **Checks on mount + on events**: The `checkView` function runs immediately when the effect mounts (not just on `OUTLINE_LOADED`). This covers the case where the user navigates away, deletes the database, and navigates back — the fresh mount detects the trash state.

2. **Checks parent container ID**: When a database container page is trashed, only the container's view ID appears in the trash list — not the child view IDs (grid/board/calendar). The fix uses `ViewService.get(viewId)` to get the view's `parent_view_id`, then checks both IDs against the trash list.

3. **Bidirectional**: The same check handles both deletion (`inTrash && !notFound → set`) and restoration (`!inTrash && notFound → clear`).

4. **`inTrash` state**: A separate boolean tracks whether the deletion was specifically a trash operation, allowing `DatabaseContent` to show `"This database is in the trash"` instead of the generic error message.

### Verified behavior

- **Normal operation**: Database loads and renders correctly; expanding/collapsing the sidebar does not trigger false `notFound`
- **After deletion**: Deleting the database page from sidebar replaces the grid with "This database is in the trash"
- **After restoration**: Restoring from Trash clears the message and re-renders the grid
- **Navigate back after deletion**: Returning to the page after deleting from a different page shows the trash message
- **Lint**: Passes `pnpm run lint` (tsc + eslint) with zero errors and zero warnings

---

## Playwright E2E Tests

Test file: `playwright/e2e/embeded/database/database-sidebar-deletion.spec.ts`

These tests follow the existing patterns in `database-sync.spec.ts` and `database-container-embedded-create-delete.spec.ts`. Each scenario uses BDD-style Given/When/Then structure.

### Scenario 1: Embedded database shows placeholder after deletion from sidebar (IMPLEMENTED)

```gherkin
Given a document page with one embedded Grid database
  And the sidebar shows the database as a "New Database" child of the document page
  And the embedded Grid is visible in the document with columns (Name, Type, Done)
When the user right-clicks "New Database" in the sidebar and selects "Delete"
Then the "New Database" entry disappears from the sidebar
  And the embedded Grid is replaced with an error placeholder message
  And the document page title remains visible and unchanged
  And no console errors related to "No range and node found" appear
```

**Implementation notes**:
- Use `createDocumentPageAndNavigate()` to create the document
- Insert grid via slash menu (`/grid`) following the `database-sync.spec.ts` pattern
- Close the creation modal, verify the grid renders in the document
- Expand the page in the sidebar, verify "New Database" child is visible
- Use `deletePageByName(page, 'New Database')` or the more-actions popover to delete
- Assert the grid container is replaced with error text
- Assert the sidebar no longer contains the "New Database" entry

### Scenario 2: Embedded database with two grids — deleting one preserves the other (IMPLEMENTED)

```gherkin
Given a document page with two embedded Grid databases
  And the sidebar shows both as "New Database" children of the document page
  And both grids are visible in the document
When the user deletes the first "New Database" from the sidebar
Then only the first embedded Grid shows an error placeholder
  And the second embedded Grid continues to render correctly with its data
  And the sidebar shows only the second "New Database" child
```

**Implementation notes**:
- Insert two grids via slash menu sequentially
- After deleting the first, verify the second grid still has its columns and rows
- Use `page.locator('[class*="appflowy-database"]')` with `.nth(0)` and `.nth(1)` to distinguish the two grids

### Scenario 3: Restored database reconnects in the embedded block (IMPLEMENTED)

```gherkin
Given a document page with one embedded Grid database
  And the database has been deleted from the sidebar
  And the embedded block shows an error placeholder
When the user navigates to Trash
  And restores the deleted database
  And navigates back to the document page
Then the embedded Grid re-renders with its original data
  And the sidebar shows "New Database" as a child again
```

**Implementation notes**:
- After deleting, click the Trash button in the sidebar (`[data-testid="sidebar-trash-button"]`)
- Find the deleted database in the trash table (`[data-testid="trash-table-row"]`)
- Click restore (`[data-testid="trash-restore-button"]`)
- Navigate back to the document page
- Assert the grid is visible again (the `OUTLINE_LOADED` event after restore should clear `notFound`)

### Scenario 4: Normal sidebar interactions do not break embedded databases (IMPLEMENTED)

```gherkin
Given a document page with one embedded Grid database that is rendering correctly
When the user expands and collapses the space in the sidebar
  And expands the document page to see its children
  And collapses the document page
Then the embedded Grid remains visible and functional throughout
  And no error placeholders appear at any point
```

**Implementation notes**:
- This is a regression/safety test to ensure the `parentInOutline` guard works
- Use `expandSpace()` / collapse, `expandPageByName()` / collapse
- After each sidebar interaction, assert the grid is still visible and contains expected content

### Scenario 5: Deleting database while on a different page (IMPLEMENTED)

```gherkin
Given a document page "Page A" with one embedded Grid database
  And the user navigates to a different page "Page B"
When the user deletes "New Database" (child of "Page A") from the sidebar
  And navigates back to "Page A"
Then the embedded block shows an error placeholder (not the stale grid)
```

**Implementation notes**:
- This tests that the detection works even when the document is re-opened after deletion
- The `useDocumentLoader` should fail to load the view, or the initial `OUTLINE_LOADED` after navigation should detect the missing view

### Test Helpers Needed

```typescript
/**
 * Insert an embedded grid database via the slash menu.
 * Returns after the grid is visible in the document.
 */
async function insertEmbeddedGrid(page: Page, editorLocator: Locator): Promise<void>;

/**
 * Delete a page by name from the sidebar using the more-actions popover.
 */
async function deletePageFromSidebar(page: Page, pageName: string): Promise<void>;

/**
 * Assert that an embedded database block at the given index shows the error placeholder.
 */
async function expectDatabasePlaceholder(page: Page, index?: number): Promise<void>;

/**
 * Assert that an embedded database block at the given index shows a working grid.
 */
async function expectDatabaseGrid(page: Page, index?: number): Promise<void>;

/**
 * Restore a page from trash by name.
 */
async function restorePageFromTrash(page: Page, pageName: string): Promise<void>;
```

### Selectors Reference

| Element | Selector |
|---------|----------|
| Embedded database container | `page.locator('[class*="appflowy-database"]')` |
| Grid view | `page.locator('[data-testid="database-grid"]')` |
| Error placeholder | `page.locator('.container-bg').filter({ hasText: /Something went wrong/ })` |
| Sidebar page item by name | `PageSelectors.itemByName(page, name)` |
| Page more-actions button | `PageSelectors.moreActionsButton(page, name)` |
| Sidebar expand toggle | `page.getByTestId('outline-toggle-expand')` |
| Trash button | `page.getByTestId('sidebar-trash-button')` |
| Trash table row | `page.getByTestId('trash-table-row')` |
| Trash restore button | `page.getByTestId('trash-restore-button')` |
| Slash menu panel | `SlashCommandSelectors.slashPanel(page)` |
| Slash menu grid item | `SlashCommandSelectors.slashMenuItem(page, 'Grid')` |

---

## Follow-Up Work

These items are out of scope for this PR but needed to reach full desktop parity:

1. ~~**Dedicated placeholder messages**~~ — DONE in this PR: shows `"This database is in the trash"`
2. **Full status enum**: Replace `notFound` boolean + `inTrash` boolean with a single status enum (`inTrash | deleted | noPermission | found`) matching desktop's `BuiltInPageLoadStatus`
3. **Auto-remove view ID from block data (Option C)**: When a view is confirmed permanently deleted (not just trashed), update the Slate node to remove the stale `view_id`. This requires a deferred deletion queue to support undo.
4. **Undo support**: Implement `DatabaseBlockTrashDeleteQueue` equivalent for web — queue view deletions until document close, allow undo to cancel them
5. ~~**Scenario 2 test**~~ — DONE in this PR: two grids, delete one, verify the other is preserved.
