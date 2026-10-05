import * as Y from 'yjs';

import { isNewerRichTextCell, jsonDeepEqual } from '@/application/database-yjs/fields/text/rich-text';
import { YDatabaseCell, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

/**
 * The one guard every web write to an existing cell goes through (rich text
 * spec section 13). A cell whose formatting needs a newer client is shown but
 * never changed by this version: a write that would change nothing a reader
 * shows writes nothing at all, and any other write is refused. Every other
 * cell is written as before.
 *
 * Callers check inside the transaction that writes, before its first `set`,
 * so that no other change can come in between (R50). The Jest inventory in
 * database-yjs/__tests__/cell-write-inventory.test.ts fails when a new helper
 * writes cell data without being listed as guarded.
 */

/** Keys that change nothing a reader shows (spec section 0). */
const BOOKKEEPING_KEYS = new Set<string>([
  YjsDatabaseKey.field_type,
  YjsDatabaseKey.source_field_type,
  YjsDatabaseKey.last_modified,
  YjsDatabaseKey.created_at,
]);

/** The keys a write would set and delete on an existing cell. */
export interface CellWriteIntent {
  set?: Record<string, unknown>;
  delete?: readonly string[];
}

/** `proceed`: write as usual. `noop`: write nothing, report success. `refuse`: write nothing, tell the user. */
export type CellWriteCheck = 'proceed' | 'noop' | 'refuse';

/** What a guarded helper did with a write. */
export type CellWriteStatus = 'written' | 'noop' | 'refused-rich-text-newer' | 'cancelled';

function toJsonValue(value: unknown): unknown {
  if (value instanceof Y.AbstractType) return value.toJSON();
  if (typeof value === 'bigint') return value.toString();
  return value;
}

/**
 * Checks a write to an existing cell (R49). `next` lists the keys the write
 * would set and delete, or is `null` when it would remove the whole cell.
 */
export function checkExistingCellWrite(
  cell: YDatabaseCell | undefined | null,
  next: CellWriteIntent | null
): CellWriteCheck {
  if (!cell || !isNewerRichTextCell(cell)) return 'proceed';
  if (next === null) return 'refuse';

  const setChanges = Object.entries(next.set ?? {}).some(
    ([key, value]) => !BOOKKEEPING_KEYS.has(key) && !jsonDeepEqual(toJsonValue(cell.get(key)), toJsonValue(value))
  );
  const deleteChanges = (next.delete ?? []).some((key) => !BOOKKEEPING_KEYS.has(key) && cell.has(key));

  return setChanges || deleteChanges ? 'refuse' : 'noop';
}

/** Whether a bulk schema operation (a field type switch) must leave the cell untouched (R49b). */
export function shouldSkipBulkRewrite(cell: YDatabaseCell | undefined | null): boolean {
  return isNewerRichTextCell(cell);
}

/** The status a guarded helper reports for a check that stopped its write. */
export function writeStatusFor(check: Exclude<CellWriteCheck, 'proceed'>): CellWriteStatus {
  return check === 'noop' ? 'noop' : 'refused-rich-text-newer';
}

// ---- undo and redo (R49c)

/** The origin of the read-only check transaction: no history or sync handler acts on it. */
const REPLAY_CHECK_ORIGIN = Symbol('rich-text-replay-check');

type StackItemLike = Pick<Y.UndoManager['undoStack'][number], 'insertions' | 'deletions'>;

/** Where an item sits: a whole cell in `cells`, or a key of a cell (possibly inside its value). */
type ItemLocation = { kind: 'cell'; fieldId: string } | { kind: 'key'; cell: YDatabaseCell; key: string; nested: boolean };

function rowCellsOf(doc: Y.Doc): Y.Map<unknown> | undefined {
  const row = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row);

  if (!(row instanceof Y.Map)) return undefined;
  const cells = row.get(YjsDatabaseKey.cells);

  return cells instanceof Y.Map ? cells : undefined;
}

function locateItem(item: Y.Item, cells: Y.Map<unknown>): ItemLocation | null {
  if (item.parent === cells) return item.parentSub ? { kind: 'cell', fieldId: item.parentSub } : null;

  let type = item.parent as Y.AbstractType<unknown> | null;
  let key = item.parentSub;
  let nested = false;

  while (type) {
    const parentItem = type._item;

    if (!parentItem) return null;

    if (parentItem.parent === cells) {
      return key ? { kind: 'key', cell: type as unknown as YDatabaseCell, key, nested } : null;
    }

    nested = true;
    key = parentItem.parentSub;
    type = parentItem.parent as Y.AbstractType<unknown>;
  }

  return null;
}

function lastContentValue(item: Y.Item): unknown {
  const content = item.content.getContent();

  return toJsonValue(content[content.length - 1]);
}

/** Whether Yjs would restore a deleted map value: not when another client wrote the key since. */
function canRestoreMapItem(item: Y.Item, ownClientId: number) {
  if (item.redone !== null) return false;

  for (let right = item.right; right; right = right.right) {
    if (right.id.client !== ownClientId) return false;
  }

  return true;
}

/**
 * Whether undoing or redoing a database history stack item would change a
 * cell whose formatting needs a newer client, beyond its bookkeeping keys
 * (rich text spec R49c). Yjs restores values per key, so undoing an older
 * text change could otherwise leave `data` out of step with a newer
 * client's later formatting, which every version then ignores for good.
 *
 * It errs on the side of refusing: a nested change of a cell's value counts
 * as a change.
 */
export function replayChangesNewerCell(doc: Y.Doc, stackItem: StackItemLike): boolean {
  const cells = rowCellsOf(doc);

  if (!cells) return false;

  // The value each affected key of a newer cell would end with (`undefined`: removed).
  const nextValues = new Map<YDatabaseCell, Map<string, unknown>>();
  let refused = false;

  const nextValuesOf = (cell: YDatabaseCell) => {
    let values = nextValues.get(cell);

    if (!values) {
      values = new Map();
      nextValues.set(cell, values);
    }

    return values;
  };

  const record = (item: Y.Item, restore: boolean) => {
    const location = locateItem(item, cells);

    if (!location) return;

    if (location.kind === 'cell') {
      // Removing or replacing a whole cell.
      if (checkExistingCellWrite(cells.get(location.fieldId) as YDatabaseCell | undefined, null) === 'refuse') {
        refused = true;
      }

      return;
    }

    const { cell, key, nested } = location;

    // Only the cell currently stored for its field is shown.
    if (cell._item?.deleted || !isNewerRichTextCell(cell)) return;
    if (BOOKKEEPING_KEYS.has(key) && !nested) return;

    if (nested) {
      refused = true;
    } else if (restore) {
      nextValuesOf(cell).set(key, lastContentValue(item));
    } else if (!nextValuesOf(cell).has(key)) {
      nextValuesOf(cell).set(key, undefined);
    }
  };

  // Read-only: iterating only splits items, which changes no content.
  doc.transact((transaction) => {
    const restored: Y.Item[] = [];

    Y.iterateDeletedStructs(transaction, stackItem.insertions, (struct) => {
      let item = struct instanceof Y.Item ? struct : null;

      while (item?.redone) {
        const redone = Y.getItem(doc.store, item.redone);

        item = redone instanceof Y.Item ? redone : null;
      }

      if (item && !item.deleted) record(item, false);
    });
    Y.iterateDeletedStructs(transaction, stackItem.deletions, (struct) => {
      if (!(struct instanceof Y.Item) || Y.isDeleted(stackItem.insertions, struct.id)) return;
      if (struct.parentSub !== null && !canRestoreMapItem(struct, doc.clientID)) return;
      restored.push(struct);
    });
    // Restored values win over removals of the same key.
    restored.forEach((item) => record(item, true));
  }, REPLAY_CHECK_ORIGIN);

  if (refused) return true;

  for (const [cell, values] of nextValues) {
    for (const [key, value] of values) {
      if (!jsonDeepEqual(toJsonValue(cell.get(key)), value)) return true;
    }
  }

  return false;
}
