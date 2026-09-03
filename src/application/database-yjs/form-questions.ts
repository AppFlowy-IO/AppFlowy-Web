import * as Y from 'yjs';

import { DatabaseViewLayout, YDatabaseFormFieldSettings, YDatabaseView, YjsDatabaseKey } from '@/application/types';

/// Sentinels reserved by the cloud's biz layer
/// (`appflowy-cloud/src/biz/forms/share.rs` — `FORM_DECIDED_SENTINEL`
/// and `FORM_DESCRIPTION_SENTINEL`). They share the `form_field_settings`
/// map with real question entries but key off ids that can't collide
/// with a UUID field id. The projection reader must skip them.
export const FORM_DECIDED_SENTINEL = '__form_decided__';
export const FORM_DESCRIPTION_SENTINEL = '__form_description__';

/// Per-question keys in the `FormFieldSettings` YJS map. Matches the
/// constants in `libs/collab/src/database/views/form_field_settings.rs`
/// — keep these in lockstep with the rust side.
export const FORM_INCLUDED = 'included';
export const FORM_REQUIRED = 'required';
export const FORM_DESCRIPTION_VISIBLE = 'description_visible';
export const FORM_DESCRIPTION = 'description';
export const FORM_TITLE = 'title';
export const FORM_LONG_ANSWER = 'long_answer';
export const FORM_ORDER = 'order';

/// Sentinel used by `FormFieldSettings.order` when the field was
/// written before the projection model added the `order` key. Same
/// magic value as `u32::MAX` on the rust side; legacy entries sort to
/// the end behind anything the user has explicitly placed.
export const FORM_ORDER_LEGACY = 0xffff_ffff;

export interface FormQuestionEntry {
  fieldId: string;
  included: boolean;
  required: boolean;
  descriptionVisible: boolean;
  description: string;
  longAnswer: boolean;
  /// Stable rank within the form view. Legacy entries (no `order` key
  /// in the stored map) decode to `FORM_ORDER_LEGACY` so they sort to
  /// the end instead of bunching at position 0.
  order: number;
}

export interface FormLayoutSnapshot {
  /// Has the form-builder's auto-create modal been resolved (Create-N /
  /// Start-from-scratch)? Mirrors `FormLayoutSetting.decided` on the
  /// desktop. The web's authoring surface uses this to suppress the
  /// modal on second open; respondent UI ignores it.
  decided: boolean;
  /// Authoritative property sequence for this Form view. `null` means the
  /// view metadata is not resolved yet; an empty array is a resolved view
  /// with no fields. Auto-create must not write while this is `null`.
  fieldOrderIds: readonly string[] | null;
  /// Explicit legacy opt-out rows. Auto-create must preserve these exclusions
  /// when it materializes the decided sentinel; merely opening a legacy Form
  /// must never re-add a question its creator removed.
  explicitlyExcludedFieldIds: readonly string[];
  /// Form-level description (the "Description (optional)" line below
  /// the title). Stored under `FORM_DESCRIPTION_SENTINEL`.
  description: string;
  /// Respondent-facing title. This is deliberately independent from the
  /// Folder-backed database-view name and is stored as `title` inside the
  /// existing `FORM_DESCRIPTION_SENTINEL` metadata entry.
  respondentTitle: string;
  /// Visible questions, sorted by `order`. Excludes sentinels, orphans
  /// (entries whose `field_id` no longer exists on the database — the
  /// caller resolves orphans), and entries with `included == false`.
  questions: FormQuestionEntry[];
}

const EMPTY_SNAPSHOT: FormLayoutSnapshot = Object.freeze({
  decided: false,
  fieldOrderIds: null,
  explicitlyExcludedFieldIds: [],
  description: '',
  respondentTitle: '',
  questions: [],
});

function isSentinel(key: string): boolean {
  return key === FORM_DECIDED_SENTINEL || key === FORM_DESCRIPTION_SENTINEL;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

// Exported so the writer can apply the same "missing/wrong-type → default"
// semantics when deciding whether to flip an `included` entry back on.
export function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asOrder(value: unknown): number {
  // YJS stores numbers as `number`; rust persists `Any::BigInt(i64)` which
  // decodes through `Any` to `number` on the wire. Clamp negatives /
  // non-finite values to the legacy sentinel so a corrupted row still
  // sorts predictably to the end.
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return FORM_ORDER_LEGACY;
  }

  return value;
}

/// Decode a `FormFieldSettings` Y.Map (the per-entry value) into a typed
/// `FormQuestionEntry`. The map is the second-level value inside
/// `form_field_settings` — keyed by field id on the parent level, this
/// is the map of property-name → value.
function decodeEntry(fieldId: string, raw: Y.Map<unknown>): FormQuestionEntry {
  return {
    fieldId,
    // `included` defaults to true. The collab's `FormFieldSettings::default_for`
    // matches this. A missing key on disk represents a legacy entry where
    // the projection-model hadn't shipped yet — treat as "this field is a
    // question" so reads degrade gracefully.
    included: asBool(raw.get(FORM_INCLUDED), true),
    required: asBool(raw.get(FORM_REQUIRED), false),
    descriptionVisible: asBool(raw.get(FORM_DESCRIPTION_VISIBLE), false),
    description: asString(raw.get(FORM_DESCRIPTION)),
    longAnswer: asBool(raw.get(FORM_LONG_ANSWER), false),
    order: asOrder(raw.get(FORM_ORDER)),
  };
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

/// Project the per-view `form_field_settings` map into a `FormLayoutSnapshot`.
///
/// The decided sentinel selects the same inclusion mode as the cloud:
///   * sentinel present -> builder opt-in (only explicit included entries)
///   * sentinel absent  -> legacy opt-out (every field-order entry defaults
///     to included unless an explicit `included = false` override hides it)
///
/// `field_orders` is the authoritative field sequence used by the cloud's
/// `get_fields_in_view` projection. Reading it here also prevents orphaned
/// settings rows from surfacing after their database field was deleted.
export function readFormLayoutSnapshot(view: YDatabaseView | undefined): FormLayoutSnapshot {
  if (!view) return EMPTY_SNAPSHOT;
  if (Number(view.get(YjsDatabaseKey.layout)) !== DatabaseViewLayout.Form) {
    return EMPTY_SNAPSHOT;
  }

  const map = view.get(YjsDatabaseKey.form_field_settings);
  const fieldOrderIds = readFieldOrderIds(view);

  if (!map && fieldOrderIds === undefined) return EMPTY_SNAPSHOT;
  return decodeSnapshot(map, fieldOrderIds);
}

/// Lower-level decode used by the snapshot helper above and by the
/// observer subscription in `useFormLayoutSnapshot`. Splits sentinel
/// handling from container traversal so unit tests can feed a synthetic
/// `Y.Map`.
export function decodeSnapshot(
  map: YDatabaseFormFieldSettings | undefined,
  fieldOrderIds?: readonly string[]
): FormLayoutSnapshot {
  let decided = false;
  let description = '';
  let respondentTitle = '';
  const settingsByFieldId = new Map<string, FormQuestionEntry>();

  map?.forEach((value, key) => {
    if (typeof key !== 'string') return;
    if (!(value instanceof Y.Map)) return;
    if (key === FORM_DECIDED_SENTINEL) {
      // The decided sentinel is intentionally written as a non-default
      // `FormFieldSettings` row (cloud-side, so it survives any
      // is-default-skip optimization). We only care about its
      // existence — the field-by-field values are irrelevant here.
      decided = true;
      return;
    }

    if (key === FORM_DESCRIPTION_SENTINEL) {
      description = asString(value.get(FORM_DESCRIPTION));
      respondentTitle = asString(value.get(FORM_TITLE));
      return;
    }

    if (isSentinel(key)) return;
    settingsByFieldId.set(key, decodeEntry(key, value));
  });

  // When field order is available, use it in both modes. Besides excluding
  // orphan settings, it is the cloud projection's stable tie-break for
  // legacy entries whose order is `u32::MAX`. The lower-level decoder keeps
  // accepting a bare map for focused tests and preview helpers.
  const candidateIds = fieldOrderIds ?? Array.from(settingsByFieldId.keys());
  const explicitlyExcludedFieldIds = candidateIds.filter(
    (fieldId) => settingsByFieldId.get(fieldId)?.included === false
  );
  const entries = candidateIds
    .map((fieldId, fieldOrderIndex) => {
      const explicit = settingsByFieldId.get(fieldId);

      // Builder mode is opt-in. Legacy mode is opt-out and therefore
      // materializes the same default used by `FormFieldSettings::default_for`
      // in the cloud for every missing per-field entry.
      if (!explicit && decided) return null;
      const entry = explicit ?? decodeEntry(fieldId, new Y.Map<unknown>());

      if (!entry.included) return null;
      return { entry, fieldOrderIndex };
    })
    .filter((value): value is { entry: FormQuestionEntry; fieldOrderIndex: number } => value !== null);

  entries.sort((a, b) =>
    a.entry.order === b.entry.order ? a.fieldOrderIndex - b.fieldOrderIndex : a.entry.order - b.entry.order
  );

  return {
    decided,
    fieldOrderIds: fieldOrderIds ? [...fieldOrderIds] : null,
    explicitlyExcludedFieldIds,
    description,
    respondentTitle,
    questions: entries.map(({ entry }) => entry),
  };
}
