import { debounce } from 'lodash-es';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

type FilterInputTarget = Pick<UseDebouncedFilterInputParams, 'filterId' | 'fieldId'>;

export function useDebouncedFilterInput({
  content,
  filterId,
  fieldId,
  updateFilter,
}: UseDebouncedFilterInputParams) {
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
      }, FILTER_INPUT_DEBOUNCE_MS),
    []
  );

  useEffect(() => {
    debouncedUpdate.cancel();
    setValue(content);
  }, [content, debouncedUpdate, fieldId, filterId]);

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
