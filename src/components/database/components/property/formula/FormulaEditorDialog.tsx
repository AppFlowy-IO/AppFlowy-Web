import { useCallback } from 'react';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

import { FormulaEditorHostProps, FormulaEditorPanel, useFormulaEditorHost } from './FormulaEditorPanel';

/**
 * The formula editor as a centered dialog, opened from the property menu and
 * the property type list. Cells open it as a popover (FormulaEditorPopover).
 */
export function FormulaEditorDialog({ fieldId, rowId, open, onOpenChange }: FormulaEditorHostProps) {
  const { contentProps, onAutocompleteOpenChange } = useFormulaEditorHost();
  const handleClose = useCallback(() => onOpenChange(false), [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size={'lg'}
        // The panel's header has its own close button.
        showCloseButton={false}
        className={'flex max-h-[85vh] w-[min(920px,95vw)] max-w-none flex-col gap-4 overflow-hidden'}
        data-testid={'formula-editor-dialog'}
        {...contentProps}
      >
        <FormulaEditorPanel
          fieldId={fieldId}
          rowId={rowId}
          onClose={handleClose}
          onAutocompleteOpenChange={onAutocompleteOpenChange}
          titleAs={DialogTitle}
          descriptionAs={DialogDescription}
        />
      </DialogContent>
    </Dialog>
  );
}

export default FormulaEditorDialog;
