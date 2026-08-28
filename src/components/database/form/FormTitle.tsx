import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

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
 * This is the database-view name used by authoring/navigation chrome. The
 * public respondent schema does not project it yet, so preview deliberately
 * uses the server's current default heading instead.
 */
export function FormTitle({ readOnly }: { readOnly: boolean }) {
  const view = useDatabaseView();
  const viewId = useDatabaseViewId();
  const updateView = useUpdateDatabaseView();
  const name = view?.get(YjsDatabaseKey.name) ?? '';
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);
  const authoritativeName = useRef(name);
  const pendingExternalName = useRef<string | null>(null);
  const focused = useRef(false);
  const dirty = useRef(false);
  const savingRef = useRef(false);

  // Sync from external rename (another tab / desktop) when the input is
  // NOT focused. If the user is currently editing, leave their caret
  // alone — clobbering would be surprising.
  useEffect(() => {
    if (name === authoritativeName.current) return;

    authoritativeName.current = name;
    if (focused.current || savingRef.current) {
      pendingExternalName.current = name;
      return;
    }

    pendingExternalName.current = null;
    dirty.current = false;
    setDraft(name);
  }, [name]);

  if (readOnly) {
    return <h1 className='text-3xl font-bold'>{name || 'Form'}</h1>;
  }

  const flush = async () => {
    if (!viewId || savingRef.current) return;
    const next = draft.trim();

    if (next === authoritativeName.current) {
      pendingExternalName.current = null;
      dirty.current = false;
      if (next !== draft) setDraft(next);
      return;
    }

    if (!next) {
      // Empty input → revert (matches desktop behavior). Forms must
      // have a non-empty name; the sidebar would render "Untitled"
      // anyway, but we keep the previous explicit name instead.
      pendingExternalName.current = null;
      dirty.current = false;
      setDraft(authoritativeName.current);
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      await updateView(viewId, { name: next });
      // Only acknowledge the draft after both the page rename and Yjs update
      // complete. A rejected request leaves the draft dirty, so the next blur
      // retries the same value instead of silently treating it as saved.
      authoritativeName.current = next;
      pendingExternalName.current = null;
      dirty.current = false;
      setDraft(next);
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : 'Failed to rename form');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Input
      variant='ghost'
      value={draft}
      onChange={(e) => {
        dirty.current = true;
        setDraft(e.target.value);
      }}
      disabled={saving}
      aria-busy={saving}
      onFocus={() => {
        focused.current = true;
        dirty.current = draft.trim() !== authoritativeName.current;
      }}
      onBlur={() => {
        focused.current = false;

        // If the user only focused the field, accept a remote rename that
        // arrived while the caret was active. A genuinely edited draft still
        // wins on blur and is saved against the latest authoritative name.
        if (!dirty.current && pendingExternalName.current !== null) {
          const externalName = pendingExternalName.current;

          pendingExternalName.current = null;
          setDraft(externalName);
          return;
        }

        void flush();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
      placeholder='Form'
      className='!h-auto !px-0 !text-3xl !font-bold'
    />
  );
}
