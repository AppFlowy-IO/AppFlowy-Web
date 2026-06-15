import React, { useCallback, useEffect, useMemo, useRef } from 'react';

import ToolbarActions from '@/components/editor/components/toolbar/selection-toolbar/ToolbarActions';

import { SelectionToolbarContext, useToolbarPosition, useVisible } from './SelectionToolbar.hooks';

export function SelectionToolbar() {
  const { visible, forceShow, getDecorateState } = useVisible();
  const ref = useRef<HTMLDivElement | null>(null);
  const {
    hideToolbar,
    showToolbar,
  } = useToolbarPosition();

  useEffect(() => {
    const el = ref.current;

    if (!el) return;

    const onScroll = () => {
      showToolbar(el);
    };

    if (!visible) {
      hideToolbar(el);
    } else {
      showToolbar(el);
      window.addEventListener('scroll', onScroll, true);
    }

    return () => {
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [hideToolbar, showToolbar, visible]);

  const rePosition = useCallback(() => {
    const el = ref.current;

    if (!el) return;

    showToolbar(el);
  }, [showToolbar]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // prevent toolbar from taking focus away from editor
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const contextValue = useMemo(
    () => ({ visible, forceShow, rePosition, getDecorateState }),
    [visible, forceShow, rePosition, getDecorateState]
  );

  return (
    <SelectionToolbarContext.Provider value={contextValue}>
      <div
        ref={ref}
        data-testid="selection-toolbar"
        className={
          'selection-toolbar pointer-events-none transform transition-opacity duration-200 absolute z-[100] flex min-h-[32px] w-fit flex-grow items-center rounded-lg bg-[var(--fill-toolbar)] px-2 opacity-0 shadow-lg'
        }
        onMouseDown={handleMouseDown}
      >
        <ToolbarActions/>
      </div>
    </SelectionToolbarContext.Provider>
  );
}

export default SelectionToolbar;
