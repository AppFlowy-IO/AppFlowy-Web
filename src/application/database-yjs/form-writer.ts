import * as Y from 'yjs';

import {
  asBool,
  FORM_DECIDED_SENTINEL,
  FORM_DESCRIPTION,
  FORM_DESCRIPTION_SENTINEL,
  FORM_DESCRIPTION_VISIBLE,
  FORM_INCLUDED,
  FORM_LONG_ANSWER,
  FORM_ORDER,
  FORM_REQUIRED,
} from '@/application/database-yjs/form-questions';
import { runDatabaseAction } from '@/application/database-yjs/history';
import { YDatabaseFormFieldSettings, YDatabaseView, YjsDatabaseKey } from '@/application/types';

/**
 * Mutation primitives for the form-builder projection. All writes go
 * through the database history transaction helper so a single
 * user-initiated change (e.g.
 * "Required ON" → schedule write) shows up as one collab update on the
 * wire, not as five property-by-property updates.
 *
 * The writer is intentionally low-level — React hooks (see
 * `useFormWriter`) layer the per-action debounce / projection-snapshot
 * coercion on top. This file is the only place we touch the YJS map
 * directly, so any change to the schema (a new key, a renamed key) has
 * exactly one site to update.
 */

/**
 * Acquire the `form_field_settings` Y.Map for a view, creating it on
 * first write. The map is intentionally optional on read (non-form
 * layouts don't have one); on write we must materialize it so the
 * subsequent `set` operates against a registered Y.Map (not a
 * detached one yjs can't observe).
 */
function ensureMap(view: YDatabaseView): YDatabaseFormFieldSettings {
  const existing = view.get(YjsDatabaseKey.form_field_settings);

  if (existing) return existing;
  const created = new Y.Map<unknown>();

  // `Y.Map.set` writes through to the parent — `view` is a Y.Map<unknown>,
  // and yjs accepts the nested map as the value. The next read picks up
  // the new map via the typed get-overload.
  (view as Y.Map<unknown>).set(YjsDatabaseKey.form_field_settings, created);
  return view.get(YjsDatabaseKey.form_field_settings)!;
}

/**
 * Acquire (or create) the per-entry Y.Map for `fieldId` inside the
 * form_field_settings container. Used by every per-question write so
 * we don't accidentally clobber a partial map.
 */
function ensureEntry(view: YDatabaseView, fieldId: string): Y.Map<unknown> {
  const map = ensureMap(view);
  const existing = map.get(fieldId);

  if (existing) return existing;
  const created = new Y.Map<unknown>();

  // Seed `included = true` so a fresh entry surfaces in the projection
  // immediately. Other defaults (`required = false`, etc) are absent on
  // disk and resolved by the reader's defaults — keeps the persisted
  // blob small.
  created.set(FORM_INCLUDED, true);
  map.set(fieldId, created);
  return map.get(fieldId)!;
}

/// Doc that owns the view's Y.Map. Required for `transact` so the
/// caller's batch fires as one collab update rather than per-key.
function docOf(view: YDatabaseView): Y.Doc {
  return view.doc as Y.Doc;
}

export interface FormWriter {
  /// Append a `fieldId` to the projection. No-op when the field is
  /// already on the form. `order` is auto-assigned to current entry
  /// count, so adds land at the bottom.
  addQuestion(fieldId: string): void;
  /// Exclude `fieldId` from the projection. Builder-mode views drop the
  /// explicit entry; legacy opt-out views persist `included = false` so the
  /// question cannot reappear through the legacy default.
  removeQuestion(fieldId: string): void;
  /// Wipe the projection. Used by the "Start from scratch" auto-create
  /// branch. Sentinels are preserved.
  clearQuestions(): void;
  /// Populate the projection from a list of field ids (typically every
  /// supported-type field on the database). Used by Create-N + the
  /// silent sidebar-create seed. Existing entries are wiped first so
  /// `order` stays packed (no holes).
  populateFromFields(fieldIds: readonly string[]): void;
  /// Move a question to a new index in the projection. Implemented by
  /// rewriting every `order` so the persisted values stay packed —
  /// keeps the rust-side sort deterministic without negotiation. The
  /// optional visible-id list lets the UI exclude unsupported fields in
  /// addition to the writer's included/orphan filtering.
  reorderQuestion(fieldId: string, newIndex: number, visibleFieldIds?: readonly string[]): void;
  /// Toggle the Required asterisk. No-op if `fieldId` isn't on the form.
  setRequired(fieldId: string, value: boolean): void;
  /// Toggle the description-row visibility. Turning OFF also clears the
  /// stored text so the next ON-toggle doesn't surface stale content.
  setDescriptionVisible(fieldId: string, value: boolean): void;
  /// Update the description text. Implies `description_visible = true`
  /// — the only way to type into the input is to have it open.
  setDescription(fieldId: string, value: string): void;
  /// RichText-only "Long answer" toggle. The cloud collab doesn't gate
  /// this by field type; the UI does.
  setLongAnswer(fieldId: string, value: boolean): void;
  /// Mark the auto-create modal as resolved. Persists the
  /// `__form_decided__` sentinel so reopens skip the modal.
  markDecided(): void;
  /// Form-level description (the "Description (optional)" row under
  /// the title). Stored in the `__form_description__` sentinel entry.
  setFormDescription(value: string): void;
}

export function createFormWriter(view: YDatabaseView): FormWriter {
  const doc = docOf(view);

  function txn(action: string, fn: () => void) {
    runDatabaseAction(doc, { type: `database.form.${action}` }, fn);
  }

  function currentEntryIds(): string[] {
    const map = view.get(YjsDatabaseKey.form_field_settings);

    if (!map) return [];
    const out: string[] = [];

    map.forEach((_, key) => {
      if (typeof key !== 'string') return;
      if (key === FORM_DECIDED_SENTINEL || key === FORM_DESCRIPTION_SENTINEL) {
        return;
      }

      out.push(key);
    });
    return out;
  }

  return {
    addQuestion(fieldId) {
      txn('add-question', () => {
        // In legacy opt-out mode a field with no settings entry is already a
        // visible question. Treat that exactly like an explicit included row
        // so a stale picker action cannot move it unexpectedly.
        if (currentEntryIdsSorted(view).includes(fieldId)) return;

        // Three cases:
        //   * No entry yet → fall through, create one via `ensureEntry`.
        //   * Existing/default-included entry → handled by the guard above;
        //     no-op so we don't disturb the user's current ordering.
        //   * Existing entry with `included: false` → another client (or
        //     a prior remove) left a stale settings row. Flip it back to
        //     `included: true` and assign a fresh max-order so the
        //     respondent UI re-renders it at the bottom. Without this
        //     branch the picker would no-op silently and the user couldn't
        //     re-add the question without manual collab editing.
        // Repack legacy entries before computing the append position.
        // `maxExistingOrder()` deliberately ignores `FORM_ORDER_LEGACY`
        // (0xFFFFFFFF) entries — without a repack a form composed entirely
        // of legacy entries makes max=-1, the new question gets order=0,
        // and `decodeSnapshot` sorts it BEFORE the legacy ones (which sort
        // to the end via the LEGACY sentinel). Repack is gated on
        // detecting legacy entries to keep the common (already-packed)
        // case allocation-free.
        if (hasLegacyOrderEntry(view)) {
          repackOrder(view);
        }

        // Append-to-bottom semantics. Use max+1 so the new question is
        // strictly greater than every existing order — guaranteeing
        // "bottom" in `decodeSnapshot`'s sort even after concurrent
        // edits from other clients.
        const order = maxExistingOrder(view) + 1;
        const entry = ensureEntry(view, fieldId);

        entry.set(FORM_INCLUDED, true);
        entry.set(FORM_ORDER, order);
      });
    },

    removeQuestion(fieldId) {
      txn('remove-question', () => {
        const map = view.get(YjsDatabaseKey.form_field_settings);

        if (!currentEntryIdsSorted(view).includes(fieldId)) return;
        if (isBuilderMode(map)) {
          // Builder mode is opt-in: absence means excluded.
          map?.delete(fieldId);
        } else {
          // Legacy mode is opt-out: deleting the row would make the cloud's
          // default_for(fieldId) include it again. Persist an explicit false
          // override so removal survives refresh and public projection.
          ensureEntry(view, fieldId).set(FORM_INCLUDED, false);
        }

        // Pack `order` so subsequent adds don't collide with the
        // now-vacant slot. Cheap (O(N) where N = question count).
        repackOrder(view);
      });
    },

    clearQuestions() {
      txn('clear-questions', () => {
        const map = view.get(YjsDatabaseKey.form_field_settings);

        if (isBuilderMode(map)) {
          if (!map) return;
          for (const id of currentEntryIds()) {
            map.delete(id);
          }

          return;
        }

        // `clearQuestions` and the subsequent `markDecided` are separate
        // public writer calls. Hide every legacy-defaulted field immediately
        // so there is no interval where deleting settings exposes all fields.
        for (const id of currentEntryIdsSorted(view)) {
          ensureEntry(view, id).set(FORM_INCLUDED, false);
        }
      });
    },

    populateFromFields(fieldIds) {
      txn('populate-from-fields', () => {
        // Wipe existing entries first so the projection matches the
        // input list exactly. Order = list index, no gaps.
        const map = view.get(YjsDatabaseKey.form_field_settings);
        const builderMode = isBuilderMode(map);

        if (map) {
          for (const id of currentEntryIds()) {
            map.delete(id);
          }
        }

        if (!builderMode) {
          // Legacy mode defaults missing rows to included. Materialize false
          // overrides for every unselected view field before adding the
          // requested subset, keeping the public schema exact even before
          // the caller writes the decided sentinel.
          const selected = new Set(fieldIds);

          for (const id of readFieldOrderIds(view) ?? []) {
            if (!selected.has(id)) {
              ensureEntry(view, id).set(FORM_INCLUDED, false);
            }
          }
        }

        fieldIds.forEach((fieldId, idx) => {
          const entry = ensureEntry(view, fieldId);

          entry.set(FORM_INCLUDED, true);
          entry.set(FORM_ORDER, idx);
        });
      });
    },

    reorderQuestion(fieldId, newIndex, visibleFieldIds) {
      txn('reorder-question', () => {
        // Build the desired-order id list, then re-stamp every entry's
        // `order` value. The current visible list filters included:false,
        // orphaned, and (when supplied by the UI) unsupported field entries.
        const ids = currentEntryIdsSorted(view, visibleFieldIds);

        if (!ids.includes(fieldId)) return;
        const without = ids.filter((id) => id !== fieldId);
        const clamped = Math.max(0, Math.min(newIndex, without.length));

        without.splice(clamped, 0, fieldId);
        without.forEach((id, idx) => {
          const entry = ensureEntry(view, id);

          entry.set(FORM_INCLUDED, true);
          entry.set(FORM_ORDER, idx);
        });
      });
    },

    setRequired(fieldId, value) {
      txn('set-required', () => {
        const entry = ensureEntry(view, fieldId);

        entry.set(FORM_REQUIRED, value);
      });
    },

    setDescriptionVisible(fieldId, value) {
      txn('set-description-visible', () => {
        const entry = ensureEntry(view, fieldId);

        entry.set(FORM_DESCRIPTION_VISIBLE, value);
        if (!value) {
          // Clear the stored text so re-enabling doesn't surface stale
          // content. Mirrors `FormQuestionOverridesService.setDescriptionVisible`
          // on the desktop.
          entry.set(FORM_DESCRIPTION, '');
        }
      });
    },

    setDescription(fieldId, value) {
      txn('set-description', () => {
        const entry = ensureEntry(view, fieldId);

        entry.set(FORM_DESCRIPTION, value);
        // Typing in the input implies the row is open; persist the
        // visibility flag so a tab reload doesn't hide the text.
        entry.set(FORM_DESCRIPTION_VISIBLE, true);
      });
    },

    setLongAnswer(fieldId, value) {
      txn('set-long-answer', () => {
        const entry = ensureEntry(view, fieldId);

        entry.set(FORM_LONG_ANSWER, value);
      });
    },

    markDecided() {
      txn('mark-decided', () => {
        const map = ensureMap(view);

        if (map.get(FORM_DECIDED_SENTINEL)) return;
        const sentinel = new Y.Map<unknown>();

        // Write a non-default `included = false` so any future
        // is-default-skip filter still persists the row. The reader
        // treats the entry's existence as the decided signal — the
        // inner values are irrelevant.
        sentinel.set(FORM_INCLUDED, false);
        map.set(FORM_DECIDED_SENTINEL, sentinel);
      });
    },

    setFormDescription(value) {
      txn('set-form-description', () => {
        const map = ensureMap(view);
        const sentinel = map.get(FORM_DESCRIPTION_SENTINEL) ?? new Y.Map<unknown>();

        sentinel.set(FORM_INCLUDED, false);
        sentinel.set(FORM_DESCRIPTION, value);
        if (!map.get(FORM_DESCRIPTION_SENTINEL)) {
          map.set(FORM_DESCRIPTION_SENTINEL, sentinel);
        }
      });
    },
  };
}

function isBuilderMode(map: YDatabaseFormFieldSettings | undefined): boolean {
  return Boolean(map?.get(FORM_DECIDED_SENTINEL));
}

function readFieldOrderIds(view: YDatabaseView): string[] | undefined {
  const fieldOrders = view.get(YjsDatabaseKey.field_orders);

  if (!(fieldOrders instanceof Y.Array)) return undefined;
  const seen = new Set<string>();
  const ids: string[] = [];

  fieldOrders.forEach((order) => {
    const id = order?.id;

    if (typeof id !== 'string' || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  });
  return ids;
}

function currentEntryIdsSorted(view: YDatabaseView, visibleFieldIds?: readonly string[]): string[] {
  const map = view.get(YjsDatabaseKey.form_field_settings);
  const fieldOrderIds = readFieldOrderIds(view);
  const allowedFieldIds = fieldOrderIds === undefined ? undefined : new Set(fieldOrderIds);
  const sourceIds = visibleFieldIds ?? fieldOrderIds ?? currentExplicitEntryIds(map);
  const seen = new Set<string>();
  const pairs: Array<{ id: string; order: number; sourceIndex: number }> = [];

  sourceIds.forEach((id, sourceIndex) => {
    if (typeof id !== 'string' || seen.has(id)) return;
    seen.add(id);
    if (allowedFieldIds && !allowedFieldIds.has(id)) return;
    const entry = map?.get(id);

    if (!entry && isBuilderMode(map)) return;
    if (entry && !asBool(entry.get(FORM_INCLUDED), true)) return;
    const raw = entry?.get(FORM_ORDER);
    const order = typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : Number.MAX_SAFE_INTEGER;

    pairs.push({ id, order, sourceIndex });
  });
  pairs.sort((a, b) => (a.order === b.order ? a.sourceIndex - b.sourceIndex : a.order - b.order));
  return pairs.map((p) => p.id);
}

function currentExplicitEntryIds(map: YDatabaseFormFieldSettings | undefined): string[] {
  if (!map) return [];
  const ids: string[] = [];

  map.forEach((value, key) => {
    if (typeof key !== 'string' || !(value instanceof Y.Map)) return;
    if (key === FORM_DECIDED_SENTINEL || key === FORM_DESCRIPTION_SENTINEL) return;
    ids.push(key);
  });
  return ids;
}

function repackOrder(view: YDatabaseView) {
  const ids = currentEntryIdsSorted(view);

  ids.forEach((id, idx) => {
    const entry = ensureEntry(view, id);

    entry.set(FORM_INCLUDED, true);
    entry.set(FORM_ORDER, idx);
  });
}

/// True when any non-sentinel entry carries a legacy-order marker
/// (missing/negative/non-finite/`FORM_ORDER_LEGACY` value of `FORM_ORDER`).
/// Used by `addQuestion` to decide whether to repack before computing
/// the append index — without that repack, a form composed entirely of
/// legacy entries would let the new question land at order=0 (sorting
/// it BEFORE the legacy ones, which decode to 0xFFFFFFFF and sort to
/// the end).
function hasLegacyOrderEntry(view: YDatabaseView): boolean {
  const map = view.get(YjsDatabaseKey.form_field_settings);

  return currentEntryIdsSorted(view).some((id) => {
    const raw = map?.get(id)?.get(FORM_ORDER);

    return typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw === 0xffff_ffff;
  });
}

/// Largest `FORM_ORDER` across non-sentinel entries. Legacy entries
/// (`FORM_ORDER_LEGACY`) are excluded so we don't try to append at
/// `0xFFFFFFFF + 1` — that would overflow into NaN territory and also
/// undermine the legacy sentinel's "sorts to the end" contract.
/// Returns -1 when there are no real questions yet, so callers can
/// use `max + 1` as the first explicit order without special-casing.
function maxExistingOrder(view: YDatabaseView): number {
  const map = view.get(YjsDatabaseKey.form_field_settings);
  let max = -1;

  currentEntryIdsSorted(view).forEach((id) => {
    const raw = map?.get(id)?.get(FORM_ORDER);

    if (typeof raw !== 'number' || !Number.isFinite(raw)) return;
    if (raw < 0) return;
    if (raw === 0xffff_ffff) return; // legacy sentinel
    if (raw > max) max = raw;
  });
  return max;
}
