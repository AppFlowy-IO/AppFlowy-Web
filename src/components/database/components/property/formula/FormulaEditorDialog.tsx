import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDatabaseFields } from '@/application/database-yjs/context';
import { useUpdateFormulaTypeOption } from '@/application/database-yjs/dispatch';
import {
  parseFormulaTypeOption,
  readFormulaSchema,
  toDisplayExpression,
  toStorageExpression,
} from '@/application/database-yjs/fields/formula';
import { useFieldSelector } from '@/application/database-yjs/selector';
import { YjsDatabaseKey } from '@/application/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

import { FormulaEditor } from './FormulaEditor';

export function FormulaEditorDialog({
  fieldId,
  rowId,
  open,
  onOpenChange,
}: {
  fieldId: string;
  /** Row the editor was opened from; used as the initial preview row. */
  rowId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { field } = useFieldSelector(fieldId);
  const fields = useDatabaseFields();
  const updateFormulaTypeOption = useUpdateFormulaTypeOption(fieldId);
  const fieldName = String(field?.get(YjsDatabaseKey.name) ?? '');
  const savedExpression = useMemo(() => {
    if (!field) return '';
    return toDisplayExpression(parseFormulaTypeOption(field).formula, readFormulaSchema(fields));
  }, [field, fields]);
  const [draft, setDraft] = useState(savedExpression);
  const [valid, setValid] = useState(true);
  // Radix handles Escape in the capture phase, before the textarea can close
  // its suggestion popup; keep the dialog open while that popup is showing.
  const autocompleteOpenRef = useRef(false);
  const handleAutocompleteOpenChange = useCallback((open: boolean) => {
    autocompleteOpenRef.current = open;
  }, []);

  // Re-seed the draft each time the dialog opens so a cancelled edit is dropped.
  useEffect(() => {
    if (open) setDraft(savedExpression);
  }, [open, savedExpression]);

  const handleSave = useCallback(() => {
    if (!valid) return;
    updateFormulaTypeOption({ formula: toStorageExpression(draft, readFormulaSchema(fields)) });
    onOpenChange(false);
  }, [draft, fields, onOpenChange, updateFormulaTypeOption, valid]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size={'lg'}
        className={'flex max-h-[85vh] w-[min(920px,95vw)] max-w-none flex-col gap-4 overflow-hidden'}
        data-testid={'formula-editor-dialog'}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onEscapeKeyDown={(event) => {
          if (autocompleteOpenRef.current) event.preventDefault();
        }}
      >
        <div className={'flex items-center gap-3 pr-10'}>
          <DialogTitle className={'text-base font-medium'}>
            {t('grid.formula.editFormula', { defaultValue: 'Edit formula' })}
            {fieldName ? <span className={'ml-2 text-text-secondary'}>· {fieldName}</span> : null}
          </DialogTitle>
          <DialogDescription className={'sr-only'}>
            {t('grid.formula.dialogDescription', {
              defaultValue: 'Write a formula that computes this property from other properties.',
            })}
          </DialogDescription>
          <div className={'ml-auto flex items-center gap-2'}>
            <Button variant={'ghost'} size={'sm'} onClick={() => onOpenChange(false)} data-testid={'formula-editor-cancel'}>
              {t('button.cancel')}
            </Button>
            <Button size={'sm'} disabled={!valid} onClick={handleSave} data-testid={'formula-editor-done'}>
              {t('button.done')}
            </Button>
          </div>
        </div>
        <div className={'appflowy-scroller min-h-0 flex-1 overflow-y-auto'}>
          <FormulaEditor
            fieldId={fieldId}
            value={draft}
            onChange={setDraft}
            initialPreviewRowId={rowId}
            onSubmit={handleSave}
            onValidityChange={setValid}
            onAutocompleteOpenChange={handleAutocompleteOpenChange}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default FormulaEditorDialog;
