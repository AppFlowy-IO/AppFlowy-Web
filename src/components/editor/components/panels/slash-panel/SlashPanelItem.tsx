import { Button } from '@mui/material';
import { memo, useCallback } from 'react';

import { SlashMenuOption } from './slash-panel.utils';

interface SlashPanelItemProps {
  option: SlashMenuOption;
  isSelected: boolean;
  onSelect: (key: string) => void;
}

/**
 * A single item in the slash menu.
 * Memoized to prevent re-renders when other items' selection state changes.
 */
export const SlashPanelItem = memo(function SlashPanelItem({
  option,
  isSelected,
  onSelect,
}: SlashPanelItemProps) {
  const handleClick = useCallback(() => {
    onSelect(option.key);
    option.onClick?.();
  }, [option, onSelect]);

  return (
    <Button
      size={'small'}
      color={'inherit'}
      startIcon={option.icon}
      data-testid={`slash-menu-${option.key}`}
      data-option-key={option.key}
      onClick={handleClick}
      className={`scroll-m-2 justify-start hover:bg-fill-content-hover ${
        isSelected ? 'bg-fill-content-hover' : ''
      }`}
    >
      {option.label}
    </Button>
  );
});

export default SlashPanelItem;
