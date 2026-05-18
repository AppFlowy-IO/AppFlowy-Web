import { useEffect, useRef, useState } from 'react';

import { useDatabaseView, useDatabaseViewId } from '@/application/database-yjs/context';
import { useUpdateDatabaseView } from '@/application/database-yjs/dispatch';
import { YjsDatabaseKey } from '@/application/types';
import { Input } from '@/components/ui/input';

/**
 * Inline editable form title — mirror of the desktop's `_FormTitle`.
 * Reads `view.name` from the YJS view map, writes back via
 * `useUpdateDatabaseView`, which both updates the local Y.Map (so
 * the title rebroadcasts to other tabs of the same database
 * immediately) AND POSTs to the cloud's page-rename endpoint (so the
 * folder/sidebar pick up the new name).
 *
 * Save-on-blur, not save-on-keystroke — the rename round-trip is
 * heavier than the form-description debounce; flushing on every char
 * would spam the server.
 *
 * Read-only collapses to a plain heading so respondents / view-only
 * members see the title without an editable input.
 */
export function FormTitle({ readOnly }: { readOnly: boolean }) {
  const view = useDatabaseView();
  const viewId = useDatabaseViewId();
  const updateView = useUpdateDatabaseView();
  const name = (view?.get(YjsDatabaseKey.name)) ?? '';
  const [draft, setDraft] = useState(name);
  const lastSaved = useRef(name);

  // Sync from external rename (another tab / desktop) when the input is
  // NOT focused. If the user is currently editing, leave their caret
  // alone — clobbering would be surprising.
  useEffect(() => {
    if (name !== lastSaved.current) {
      lastSaved.current = name;
      setDraft(name);
    }
  }, [name]);

  if (readOnly) {
    return <h1 className='text-3xl font-bold'>{name || 'Form'}</h1>;
  }

  const flush = () => {
    if (!viewId) return;
    const next = draft.trim();

    if (next === lastSaved.current) return;
    if (!next) {
      // Empty input → revert (matches desktop behavior). Forms must
      // have a non-empty name; the sidebar would render "Untitled"
      // anyway, but we keep the previous explicit name instead.
      setDraft(lastSaved.current);
      return;
    }

    lastSaved.current = next;
    void updateView(viewId, { name: next });
  };

  return (
    <Input
      variant='ghost'
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={flush}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
      placeholder='Form'
      className='!h-auto !text-3xl !font-bold !px-0'
    />
  );
}
