import { useMemo } from 'react';

import { useDatabaseView } from '@/application/database-yjs/context';
import { createFormWriter, FormWriter } from '@/application/database-yjs/form-writer';

const NOOP_WRITER: FormWriter = {
  addQuestion: () => {},
  removeQuestion: () => {},
  clearQuestions: () => {},
  populateFromFields: () => {},
  reorderQuestion: () => {},
  setRequired: () => {},
  setDescriptionVisible: () => {},
  setDescription: () => {},
  setLongAnswer: () => {},
  markDecided: () => {},
  setFormDescription: () => {},
};

/**
 * Bind the form writer to the current database view. Returns a no-op
 * writer when no view is in context (read-only mode, or component
 * mounted outside the database scope) — callers don't need to defend
 * against `null` at every callsite.
 *
 * The writer is memoized on view identity, so swapping tabs hands the
 * caller a fresh closure that writes to the new view's
 * `form_field_settings` rather than the stale one.
 */
export function useFormWriter(): FormWriter {
  const view = useDatabaseView();

  return useMemo(() => (view ? createFormWriter(view) : NOOP_WRITER), [view]);
}
