import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { TextareaAutosize } from '@/components/ui/textarea-autosize';

/**
 * Inline form-level description editor — the italic "Description
 * (optional)" line under the form title. Auto-sizing textarea so a
 * long blurb wraps naturally.
 *
 * Owns a local draft so each keystroke doesn't trigger a Y.js write;
 * instead we debounce-flush on blur OR after 500ms of idle typing.
 * Mirrors the desktop's `FormQuestionOverridesService` debounce
 * window.
 */
export function FormFormDescription({
  description,
  readOnly,
  onChange,
}: {
  description: string;
  readOnly: boolean;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(description);
  const draftRef = useRef(description);
  const lastExternal = useRef(description);
  const pendingExternal = useRef<string | null>(null);
  const focused = useRef(false);
  const dirty = useRef(false);
  const readOnlyRef = useRef(readOnly);
  const onChangeRef = useRef(onChange);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    onChangeRef.current = onChange;
    readOnlyRef.current = readOnly;
  }, [onChange, readOnly]);

  // Sync the draft when the description changes from elsewhere (another
  // client edited the field, or the projection rehydrated). Protect a focused
  // or dirty local draft: remember the remote value as the latest authority,
  // but let the creator either finish and flush their edit or blur an untouched
  // field and accept the deferred update.
  useEffect(() => {
    if (description !== lastExternal.current) {
      lastExternal.current = description;

      if (focused.current || dirty.current) {
        pendingExternal.current = description;
        return;
      }

      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }

      pendingExternal.current = null;
      draftRef.current = description;
      setDraft(description);
    }
  }, [description]);

  // A permission downgrade must not let an already-scheduled authoring write
  // mutate the local collab. Discard the unsaved draft and restore the
  // server-observed value when the editor becomes read-only.
  useEffect(() => {
    if (!readOnly) return;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }

    focused.current = false;
    dirty.current = false;
    pendingExternal.current = null;
    lastExternal.current = description;
    draftRef.current = description;
    setDraft(description);
  }, [description, readOnly]);

  // Navigation can unmount the editor before blur or the debounce fires.
  // Flush the latest draft synchronously through the current writer so a tab
  // switch cannot discard authored description text (Desktop does the same
  // handoff from its field/service disposal path).
  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }

      const value = draftRef.current;

      if (dirty.current && !readOnlyRef.current && value !== lastExternal.current) {
        lastExternal.current = value;
        onChangeRef.current(value);
      }
    };
  }, []);

  const flush = (value: string) => {
    pendingExternal.current = null;
    dirty.current = false;
    if (readOnlyRef.current || value === lastExternal.current) return;
    lastExternal.current = value;
    onChangeRef.current(value);
  };

  if (readOnly) {
    if (!description) return null;
    return <p className='text-sm italic text-text-caption'>{description}</p>;
  }

  return (
    <TextareaAutosize
      value={draft}
      onFocus={() => {
        focused.current = true;
        dirty.current = draftRef.current !== lastExternal.current;
      }}
      onChange={(e) => {
        const v = e.target.value;

        dirty.current = true;
        draftRef.current = v;
        setDraft(v);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          timer.current = null;
          flush(v);
        }, 500);
      }}
      onBlur={() => {
        focused.current = false;
        if (timer.current) {
          clearTimeout(timer.current);
          timer.current = null;
        }

        if (dirty.current) {
          flush(draftRef.current);
          return;
        }

        if (pendingExternal.current !== null) {
          const external = pendingExternal.current;

          pendingExternal.current = null;
          draftRef.current = external;
          setDraft(external);
        }
      }}
      placeholder='Description (optional)'
      variant='ghost'
      className='italic text-text-caption'
      minRows={1}
    />
  );
}
