import { useEffect, useState } from 'react';
import * as Y from 'yjs';

import { useDatabaseView } from '@/application/database-yjs/context';
import {
  decodeSnapshot,
  FormLayoutSnapshot,
  FormQuestionEntry,
  readFormLayoutSnapshot,
} from '@/application/database-yjs/form-questions';

const EMPTY: FormLayoutSnapshot = Object.freeze({
  decided: false,
  description: '',
  questions: [],
});

function questionsEqual(a: FormQuestionEntry, b: FormQuestionEntry): boolean {
  return (
    a.fieldId === b.fieldId &&
    a.included === b.included &&
    a.required === b.required &&
    a.descriptionVisible === b.descriptionVisible &&
    a.description === b.description &&
    a.longAnswer === b.longAnswer &&
    a.order === b.order
  );
}

function snapshotsEqual(a: FormLayoutSnapshot, b: FormLayoutSnapshot): boolean {
  if (a === b) return true;
  if (a.decided !== b.decided) return false;
  if (a.description !== b.description) return false;
  if (a.questions.length !== b.questions.length) return false;
  for (let i = 0; i < a.questions.length; i += 1) {
    if (!questionsEqual(a.questions[i], b.questions[i])) return false;
  }
  return true;
}

/**
 * Subscribe to the current database view's `form_field_settings` map and
 * surface a typed snapshot. Re-emits on any deep mutation (entry add /
 * remove / value patch) so the form-builder UI re-renders without
 * polling.
 *
 * Returns the frozen empty snapshot when:
 *   - no view is in context (caller mounted outside the database scope)
 *   - the view exists but isn't a Form layout (no `form_field_settings` key)
 *
 * The hook re-subscribes when the underlying view reference changes —
 * e.g. user switches database tabs — so a stale observer can't fire
 * against a different view's data.
 */
export function useFormLayoutSnapshot(): FormLayoutSnapshot {
  const view = useDatabaseView();
  // Start from the frozen empty snapshot; the effect below seeds the
  // real value on mount. Decoding twice (once in the initializer, once
  // in the effect) was wasted work — the effect runs synchronously
  // before commit so the first paint sees the seeded value.
  const [snapshot, setSnapshot] = useState<FormLayoutSnapshot>(EMPTY);

  useEffect(() => {
    if (!view) {
      setSnapshot(EMPTY);
      return;
    }

    // Seed so a view-swap doesn't render with the previous map's
    // contents until the first mutation arrives.
    setSnapshot(readFormLayoutSnapshot(view));

    // Observe the view's Y.Map deeply, not just the
    // `form_field_settings` child. On a fresh form view the
    // child map doesn't exist yet — the writer creates it on the
    // first `addQuestion` / `markDecided` call. If we only attached
    // to the child, that first write would slip past unnoticed and
    // the snapshot would stay frozen at `EMPTY` until a tab swap
    // forced a re-subscribe.
    //
    // Deep-observing the view itself catches both the child creation
    // AND every subsequent per-entry write, since `observeDeep`
    // propagates events from nested maps. The trade-off is firing on
    // unrelated view-level keys (name, layout_settings, etc.) — we
    // short-circuit those by returning the previous snapshot when the
    // decoded value is shallow-equal, so renaming the form via
    // `FormTitle` doesn't invalidate every downstream `useMemo` keyed
    // on the snapshot (preview schema, resolved questions list, etc.).
    const observer = () => {
      setSnapshot((prev) => {
        const next = readFormLayoutSnapshot(view);
        return snapshotsEqual(prev, next) ? prev : next;
      });
    };

    view.observeDeep(observer);
    return () => {
      view.unobserveDeep(observer);
    };
  }, [view]);

  return snapshot;
}

/// Variant that takes an explicit view rather than reading the current
/// one from context — used by the preview overlay, which renders against
/// a draft `FormLayoutSnapshot` that's *already* in memory and doesn't
/// need a fresh subscription. Kept here so the import surface for form
/// authoring lives in one module.
export function asSnapshot(map: Y.Map<unknown> | undefined): FormLayoutSnapshot {
  if (!map) return EMPTY;
  return decodeSnapshot(map as never);
}
