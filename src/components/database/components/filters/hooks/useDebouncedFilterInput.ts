import { debounce } from 'lodash-es';
import { useCallback, useEffect, useMemo, useState } from 'react';

export const FILTER_INPUT_DEBOUNCE_MS = 500;

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
}

export function useDebouncedFilterInput({
  content,
  filterId,
  fieldId,
  updateFilter,
}: UseDebouncedFilterInputParams) {
  const [value, setValue] = useState(content);
  const debouncedUpdate = useMemo(
    () =>
      debounce((nextContent: string) => {
        updateFilter({
          filterId,
          fieldId,
          content: nextContent,
        });
      }, FILTER_INPUT_DEBOUNCE_MS),
    [fieldId, filterId, updateFilter]
  );

  useEffect(() => {
    debouncedUpdate.cancel();
    setValue(content);
  }, [content, debouncedUpdate]);

  useEffect(() => {
    return () => {
      debouncedUpdate.flush();
    };
  }, [debouncedUpdate]);

  const updateValue = useCallback(
    (nextValue: string) => {
      setValue(nextValue);
      debouncedUpdate(nextValue);
    },
    [debouncedUpdate]
  );

  return {
    value,
    updateValue,
  };
}
