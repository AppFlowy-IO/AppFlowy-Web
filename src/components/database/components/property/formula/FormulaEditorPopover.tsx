import { useCallback, useId } from 'react';

import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';

import { FormulaEditorHostProps, FormulaEditorPanel, useFormulaEditorHost } from './FormulaEditorPanel';

/** Space kept between the editor and the window edges; the width class leaves twice this. */
const VIEWPORT_MARGIN = 12;

/** Space between the cell and the editor, on either side; the desktop app uses the same gap. */
const CELL_GAP = 4;

/**
 * The formula editor opened from a cell: a popover below the cell, aligned
 * with its left edge, like the date picker. It flips above the cell when
 * there is no room below and shifts to stay inside the window.
 *
 * The anchor fills the nearest positioned ancestor, which is the grid cell or
 * the row page's property value; render this inside that element.
 */
export function FormulaEditorPopover({ fieldId, rowId, open, onOpenChange }: FormulaEditorHostProps) {
  const { contentProps, onAutocompleteOpenChange } = useFormulaEditorHost();
  const handleClose = useCallback(() => onOpenChange(false), [onOpenChange]);
  const titleId = useId();
  const descriptionId = useId();

  return (
    // Modal: a click outside only closes the editor (like the dialog it
    // replaces for cells) and the grid cannot scroll the cell away meanwhile.
    <Popover open={open} onOpenChange={onOpenChange} modal>
      <PopoverAnchor
        aria-hidden
        data-testid={'formula-editor-anchor'}
        className={'pointer-events-none absolute inset-0'}
      />
      <PopoverContent
        side={'bottom'}
        align={'start'}
        sideOffset={CELL_GAP}
        avoidCollisions
        collisionPadding={VIEWPORT_MARGIN}
        // Stay fully inside the window, even if that moves the editor off the cell's edge.
        sticky={'always'}
        data-testid={'formula-editor-dialog'}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className={
          'flex max-h-[min(640px,var(--radix-popover-content-available-height))] w-[min(760px,calc(100vw_-_24px))] flex-col overflow-hidden p-4'
        }
        {...contentProps}
      >
        <FormulaEditorPanel
          fieldId={fieldId}
          rowId={rowId}
          onClose={handleClose}
          onAutocompleteOpenChange={onAutocompleteOpenChange}
          titleId={titleId}
          descriptionId={descriptionId}
        />
      </PopoverContent>
    </Popover>
  );
}

export default FormulaEditorPopover;
