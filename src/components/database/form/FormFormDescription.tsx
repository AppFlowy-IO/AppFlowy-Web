import { useEffect, useRef, useState } from 'react';

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
  const lastExternal = useRef(description);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync the draft when the description changes from elsewhere (another
  // client edited the field, or the projection rehydrated). Cancel any local
  // debounce first so its stale closure cannot overwrite the newer external
  // value after this effect accepts it.
  useEffect(() => {
    if (description !== lastExternal.current) {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }

      lastExternal.current = description;
      setDraft(description);
    }
  }, [description]);

  // Cancel the pending debounce on unmount so a late timer doesn't fire
  // `onChange` against a stale closure after the component has been
  // detached (e.g. user switched views within the 500ms idle window).
  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, []);

  const flush = (value: string) => {
    if (value === lastExternal.current) return;
    lastExternal.current = value;
    onChange(value);
  };

  if (readOnly) {
    if (!description) return null;
    return (
      <p className='text-sm italic text-text-caption'>{description}</p>
    );
  }

  return (
    <TextareaAutosize
      value={draft}
      onChange={(e) => {
        const v = e.target.value;

        setDraft(v);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          timer.current = null;
          flush(v);
        }, 500);
      }}
      onBlur={() => {
        if (timer.current) {
          clearTimeout(timer.current);
          timer.current = null;
        }

        flush(draft);
      }}
      placeholder='Description (optional)'
      variant='ghost'
      className='italic text-text-caption'
      minRows={1}
    />
  );
}
