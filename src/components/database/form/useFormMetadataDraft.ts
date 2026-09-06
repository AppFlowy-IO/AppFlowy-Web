import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const FORM_METADATA_DEBOUNCE_MS = 500;

/**
 * Local draft controller shared by respondent-facing form metadata fields.
 *
 * Yjs remains the external source of truth, while the local draft prevents a
 * collab transaction on every keystroke. A focused/dirty draft wins over a
 * concurrent remote value; an untouched focused field adopts the deferred
 * remote value on blur. Navigation flushes the latest authorized draft, and a
 * permission downgrade discards it before it can write.
 */
export function useFormMetadataDraft({
  value,
  readOnly,
  onChange,
}: {
  value: string;
  readOnly: boolean;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  const lastExternal = useRef(value);
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

  useEffect(() => {
    if (value === lastExternal.current) return;
    lastExternal.current = value;

    if (focused.current || dirty.current) {
      pendingExternal.current = value;
      return;
    }

    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }

    pendingExternal.current = null;
    draftRef.current = value;
    setDraft(value);
  }, [value]);

  // Run before paint so a permission downgrade cannot leave an authorized
  // draft visible or allow its already-scheduled timer to mutate the collab.
  useLayoutEffect(() => {
    if (!readOnly) return;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }

    focused.current = false;
    dirty.current = false;
    pendingExternal.current = null;
    lastExternal.current = value;
    draftRef.current = value;
    setDraft(value);
  }, [readOnly, value]);

  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }

      const latest = draftRef.current;

      if (dirty.current && !readOnlyRef.current && latest !== lastExternal.current) {
        lastExternal.current = latest;
        onChangeRef.current(latest);
      }
    };
  }, []);

  const flush = useCallback((next: string) => {
    pendingExternal.current = null;
    dirty.current = false;
    if (readOnlyRef.current || next === lastExternal.current) return;
    lastExternal.current = next;
    onChangeRef.current(next);
  }, []);

  const handleFocus = useCallback(() => {
    focused.current = true;
    dirty.current = draftRef.current !== lastExternal.current;
  }, []);

  const handleValueChange = useCallback(
    (next: string) => {
      dirty.current = true;
      draftRef.current = next;
      setDraft(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        flush(next);
      }, FORM_METADATA_DEBOUNCE_MS);
    },
    [flush]
  );

  const handleBlur = useCallback(() => {
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
  }, [flush]);

  return {
    draft,
    handleFocus,
    handleValueChange,
    handleBlur,
  };
}
