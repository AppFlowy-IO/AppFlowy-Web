import { debounce } from 'lodash-es';
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { FilterInputFlushContext } from './FilterInputFlushContext';

/** A saved (view) filter's text value waits this long after the last key before it is written. */
export const FILTER_INPUT_DEBOUNCE_MS = 500;
/**
 * A dashboard global filter's text input (its value and its name) waits this
 * long: the desktop value (`globalFilterInputDebounce`), so both clients
 * re-filter after the same pause.
 */
export const GLOBAL_FILTER_INPUT_DEBOUNCE_MS = 300;

type UpdateFilterContent = (params: {
  filterId: string;
  fieldId: string;
  content: string;
}) => void;

interface UseDebouncedFilterInputParams {
  content: string;
  filterId: string;
  fieldId: string;
  updateFilter: UpdateFilterContent;
  /** How long the input waits after the last edit; `FILTER_INPUT_DEBOUNCE_MS` by default. */
  debounceMs?: number;
}

type FilterInputTarget = Pick<UseDebouncedFilterInputParams, 'filterId' | 'fieldId'>;

export function useDebouncedFilterInput({
  content,
  filterId,
  fieldId,
  updateFilter,
  debounceMs = FILTER_INPUT_DEBOUNCE_MS,
}: UseDebouncedFilterInputParams) {
  const inputFlushers = useContext(FilterInputFlushContext);
  const [value, setValue] = useState(content);
  const updateFilterRef = useRef(updateFilter);

  useEffect(() => {
    updateFilterRef.current = updateFilter;
  }, [updateFilter]);

  const debouncedUpdate = useMemo(
    () =>
      debounce((nextContent: string, target: FilterInputTarget) => {
        updateFilterRef.current({
          ...target,
          content: nextContent,
        });
      }, debounceMs),
    [debounceMs]
  );

  useEffect(() => {
    debouncedUpdate.cancel();
    setValue(content);
  }, [content, debouncedUpdate, fieldId, filterId]);

  useLayoutEffect(() => {
    if (!inputFlushers) return;
    const flush = () => {
      debouncedUpdate.flush();
    };

    inputFlushers.add(flush);
    return () => {
      // On a scope change the child can clean up before its host. Commit the
      // old input before unregistering it so the host still collects the edit.
      flush();
      inputFlushers.delete(flush);
    };
  }, [debouncedUpdate, inputFlushers]);

  useEffect(() => {
    return () => {
      debouncedUpdate.flush();
    };
  }, [debouncedUpdate]);

  const updateValue = useCallback(
    (nextValue: string) => {
      setValue(nextValue);
      debouncedUpdate(nextValue, { filterId, fieldId });
    },
    [debouncedUpdate, fieldId, filterId]
  );

  return {
    value,
    updateValue,
  };
}
