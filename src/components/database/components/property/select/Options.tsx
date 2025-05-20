import { SelectOption } from '@/application/database-yjs';
import Option from '@/components/database/components/property/select/Option';
import {
  OptionDragContext,
  useOptionDragContextValue,
} from '@/components/database/components/property/select/useOptionDragContext';
import React, { useCallback, useRef } from 'react';

function Options ({
  fieldId,
  selectedOptionIds,
  onSelectOption,
  hoveredId,
  onHover,
  options,
}: {
  fieldId: string;
  selectedOptionIds?: string[];
  onSelectOption?: (optionId: string) => void;
  hoveredId?: string;
  onHover?: (id: string) => void;
  options: SelectOption[];
}) {
  const [container, setContainer] = React.useState<HTMLDivElement | null>(null);

  const contextValue = useOptionDragContextValue(fieldId, options, container);

  const isScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleHovered = useCallback((id: string) => {
    const isScrolling = isScrollingRef.current;

    if (isScrolling) return;

    if (onHover) {
      onHover(id);
    }
  }, [onHover]);

  const handleScroll = useCallback(() => {
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    isScrollingRef.current = true;

    scrollTimeoutRef.current = setTimeout(() => {
      isScrollingRef.current = false;
    }, 100);
  }, []);

  return (
    <OptionDragContext.Provider value={contextValue}>
      <div
        ref={setContainer}
        onScroll={handleScroll}
        className={'pt-1 w-full overflow-hidden max-h-[260px] appflowy-scroller overflow-y-auto'}
      >
        {options.map((option) => (
          <Option
            key={option.id}
            option={option}
            fieldId={fieldId}
            isSelected={selectedOptionIds?.includes(option.id)}
            onSelect={onSelectOption}
            isHovered={hoveredId === option.id}
            onHover={handleHovered}
          />
        ))}
      </div>
    </OptionDragContext.Provider>
  );
}

export default Options;