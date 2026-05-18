import * as Y from 'yjs';

import {
  FORM_DECIDED_SENTINEL,
  FORM_DESCRIPTION,
  FORM_DESCRIPTION_SENTINEL,
  FORM_DESCRIPTION_VISIBLE,
  FORM_INCLUDED,
  FORM_LONG_ANSWER,
  FORM_ORDER,
  FORM_REQUIRED,
} from '@/application/database-yjs/form-questions';
import { YDatabaseFormFieldSettings, YDatabaseView, YjsDatabaseKey } from '@/application/types';

/**
 * Mutation primitives for the form-builder projection. All writes go
 * through `YDoc.transact` so a single user-initiated change (e.g.
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
function ensureEntry(
  view: YDatabaseView,
  fieldId: string,
): Y.Map<unknown> {
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
  /// Drop the entry for `fieldId`. The underlying database field stays
  /// — same projection-model semantics as the desktop's "Remove from
  /// form" action.
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
  /// keeps the rust-side sort deterministic without negotiation.
  reorderQuestion(fieldId: string, newIndex: number): void;
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

  function txn(fn: () => void) {
    // `'local'` origin tag matches the convention the rest of the
    // database-yjs writers use — observers can distinguish local
    // writes from remote sync updates by inspecting the transaction
    // origin.
    doc.transact(fn, 'local');
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
      txn(() => {
        const map = ensureMap(view);
        if (map.get(fieldId)) return;
        const order = currentEntryIds().length;
        const entry = ensureEntry(view, fieldId);
        entry.set(FORM_ORDER, order);
      });
    },

    removeQuestion(fieldId) {
      txn(() => {
        const map = view.get(YjsDatabaseKey.form_field_settings);
        if (!map?.get(fieldId)) return;
        map.delete(fieldId);
        // Pack `order` so subsequent adds don't collide with the
        // now-vacant slot. Cheap (O(N) where N = question count).
        repackOrder(view);
      });
    },

    clearQuestions() {
      txn(() => {
        const map = view.get(YjsDatabaseKey.form_field_settings);
        if (!map) return;
        for (const id of currentEntryIds()) {
          map.delete(id);
        }
      });
    },

    populateFromFields(fieldIds) {
      txn(() => {
        // Wipe existing entries first so the projection matches the
        // input list exactly. Order = list index, no gaps.
        const map = view.get(YjsDatabaseKey.form_field_settings);
        if (map) {
          for (const id of currentEntryIds()) {
            map.delete(id);
          }
        }
        fieldIds.forEach((fieldId, idx) => {
          const entry = ensureEntry(view, fieldId);
          entry.set(FORM_ORDER, idx);
        });
      });
    },

    reorderQuestion(fieldId, newIndex) {
      txn(() => {
        const map = view.get(YjsDatabaseKey.form_field_settings);
        if (!map?.get(fieldId)) return;
        // Build the desired-order id list, then re-stamp every entry's
        // `order` value. Easier to reason about than swapping pairs,
        // and the per-entry write is cheap.
        const ids = currentEntryIdsSorted(view);
        const without = ids.filter((id) => id !== fieldId);
        const clamped = Math.max(0, Math.min(newIndex, without.length));
        without.splice(clamped, 0, fieldId);
        without.forEach((id, idx) => {
          const entry = map.get(id);
          entry?.set(FORM_ORDER, idx);
        });
      });
    },

    setRequired(fieldId, value) {
      txn(() => {
        const entry = ensureEntry(view, fieldId);
        entry.set(FORM_REQUIRED, value);
      });
    },

    setDescriptionVisible(fieldId, value) {
      txn(() => {
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
      txn(() => {
        const entry = ensureEntry(view, fieldId);
        entry.set(FORM_DESCRIPTION, value);
        // Typing in the input implies the row is open; persist the
        // visibility flag so a tab reload doesn't hide the text.
        entry.set(FORM_DESCRIPTION_VISIBLE, true);
      });
    },

    setLongAnswer(fieldId, value) {
      txn(() => {
        const entry = ensureEntry(view, fieldId);
        entry.set(FORM_LONG_ANSWER, value);
      });
    },

    markDecided() {
      txn(() => {
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
      txn(() => {
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

function currentEntryIdsSorted(view: YDatabaseView): string[] {
  const map = view.get(YjsDatabaseKey.form_field_settings);
  if (!map) return [];
  const pairs: Array<{ id: string; order: number }> = [];
  map.forEach((value, key) => {
    if (typeof key !== 'string') return;
    if (!(value instanceof Y.Map)) return;
    if (key === FORM_DECIDED_SENTINEL || key === FORM_DESCRIPTION_SENTINEL) {
      return;
    }
    const raw = value.get(FORM_ORDER);
    const order = typeof raw === 'number' && Number.isFinite(raw) ? raw : Number.MAX_SAFE_INTEGER;
    pairs.push({ id: key, order });
  });
  pairs.sort((a, b) =>
    a.order === b.order ? a.id.localeCompare(b.id) : a.order - b.order,
  );
  return pairs.map((p) => p.id);
}

function repackOrder(view: YDatabaseView) {
  const map = view.get(YjsDatabaseKey.form_field_settings);
  if (!map) return;
  const ids = currentEntryIdsSorted(view);
  ids.forEach((id, idx) => {
    const entry = map.get(id);
    entry?.set(FORM_ORDER, idx);
  });
}
