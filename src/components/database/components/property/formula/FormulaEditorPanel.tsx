import { ElementType, KeyboardEvent, MouseEvent, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDatabaseFields } from '@/application/database-yjs/context';
import { useUpdateFormulaTypeOption } from '@/application/database-yjs/dispatch';
import {
  compileFormula,
  parseFormulaTypeOption,
  readFormulaSchema,
  readFormulaSchemaForVersion,
  toDisplayExpression,
  toStorageExpression,
} from '@/application/database-yjs/fields/formula';
import { useDatabaseFieldsVersion } from '@/application/database-yjs/hooks/useDatabaseFieldsVersion';
import { useFieldSelector } from '@/application/database-yjs/selector';
import { YjsDatabaseKey } from '@/application/types';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { Button } from '@/components/ui/button';

import { FormulaEditor } from './FormulaEditor';

export interface FormulaEditorHostProps {
  /** Row the editor was opened from; used as the initial preview row. */
  rowId?: string;
  fieldId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Wiring every host of the formula editor (dialog or cell popover) puts on its
 * content element, plus the callback the panel reports its autocomplete with.
 */
export function useFormulaEditorHost() {
  // Radix handles Escape in the capture phase, before the formula input can
  // close its suggestion popup; keep the editor open while that popup shows.
  const autocompleteOpenRef = useRef(false);
  const onAutocompleteOpenChange = useCallback((open: boolean) => {
    autocompleteOpenRef.current = open;
  }, []);

  const contentProps = useMemo(
    () => ({
      // The editor renders inside a cell or menu; keep its clicks and keys
      // from reaching grid shortcuts and row handlers through the React tree.
      onClick: (event: MouseEvent) => event.stopPropagation(),
      onKeyDown: (event: KeyboardEvent) => event.stopPropagation(),
      onEscapeKeyDown: (event: globalThis.KeyboardEvent) => {
        const target = event.target;
        // The formula input is the editor's only multiline text box (`FormulaSourceInput`).
        const fromFormulaInput =
          target instanceof Element && target.closest('[role="textbox"][aria-multiline="true"]') !== null;

        // Only the formula input closes its suggestion list on Escape; from
        // anywhere else, Escape closes the editor.
        if (autocompleteOpenRef.current && fromFormulaInput) event.preventDefault();
      },
    }),
    []
  );

  return { contentProps, onAutocompleteOpenChange };
}

export interface FormulaEditorPanelProps {
  fieldId: string;
  /** Row the editor was opened from; used as the initial preview row. */
  rowId?: string;
  /** Closes the editor without saving; also called after a save. */
  onClose: () => void;
  onAutocompleteOpenChange: (open: boolean) => void;
  /** Title element; a dialog passes its title primitive so it labels the dialog. */
  titleAs?: ElementType;
  descriptionAs?: ElementType;
  titleId?: string;
  descriptionId?: string;
}

/**
 * The formula editor's content: header (title, Cancel, Done, close) and the
 * editor, holding the draft until it is saved. Hosts mount it only while
 * open, so each opening starts from the saved formula and a cancelled draft
 * is dropped with the component.
 */
export function FormulaEditorPanel({
  fieldId,
  rowId,
  onClose,
  onAutocompleteOpenChange,
  titleAs: Title = 'h2',
  descriptionAs: Description = 'p',
  titleId,
  descriptionId,
}: FormulaEditorPanelProps) {
  const { t } = useTranslation();
  const { field } = useFieldSelector(fieldId);
  const fields = useDatabaseFields();
  const fieldsVersion = useDatabaseFieldsVersion();
  const schema = readFormulaSchemaForVersion(fields, fieldsVersion);
  const updateFormulaTypeOption = useUpdateFormulaTypeOption(fieldId);
  const fieldName = String(field?.get(YjsDatabaseKey.name) ?? '');
  // Read the schema fresh here: this runs once, before the version subscription attaches.
  const [draftState, setDraftState] = useState(() => {
    const initialSchema = readFormulaSchema(fields);

    return {
      value: field ? toDisplayExpression(parseFormulaTypeOption(field).formula, initialSchema) : '',
      schema: initialSchema,
    };
  });
  // Resolve against the schema used to display this draft, before a rename can
  // give its old name to another field. Preview and save both keep those IDs.
  const storageExpression = toStorageExpression(draftState.value, draftState.schema);
  const draft = draftState.schema === schema ? draftState.value : toDisplayExpression(storageExpression, schema);

  if (draftState.schema !== schema) setDraftState({ value: draft, schema });
  const setDraft = useCallback((value: string) => setDraftState({ value, schema }), [schema]);
  // Derived, not reported back by the editor: the compile cache makes this a lookup.
  const valid = useMemo(() => !compileFormula(draft, schema, fieldId).error, [draft, schema, fieldId]);

  const handleSave = useCallback(() => {
    if (!valid) return;
    updateFormulaTypeOption({ formula: storageExpression });
    onClose();
  }, [storageExpression, onClose, updateFormulaTypeOption, valid]);

  return (
    <div className={'flex min-h-0 flex-1 flex-col gap-4'}>
      <div className={'flex shrink-0 items-center gap-3'}>
        {/* Only pass ids a host asks for: a dialog's title primitive supplies its own. */}
        <Title {...(titleId ? { id: titleId } : undefined)} className={'min-w-0 truncate text-base font-medium'}>
          {t('grid.formula.editFormula', { defaultValue: 'Edit formula' })}
          {fieldName ? <span className={'ml-2 text-text-secondary'}>· {fieldName}</span> : null}
        </Title>
        <Description {...(descriptionId ? { id: descriptionId } : undefined)} className={'sr-only'}>
          {t('grid.formula.dialogDescription', {
            defaultValue: 'Write a formula that computes this property from other properties.',
          })}
        </Description>
        <div className={'ml-auto flex shrink-0 items-center gap-2'}>
          <Button variant={'ghost'} size={'sm'} onClick={onClose} data-testid={'formula-editor-cancel'}>
            {t('button.cancel')}
          </Button>
          <Button size={'sm'} disabled={!valid} onClick={handleSave} data-testid={'formula-editor-done'}>
            {t('button.done')}
          </Button>
          <Button
            variant={'ghost'}
            size={'icon'}
            aria-label={t('button.close', { defaultValue: 'Close' })}
            onClick={onClose}
            data-testid={'formula-editor-close'}
          >
            <CloseIcon aria-hidden={'true'} className={'h-5 w-5'} />
          </Button>
        </div>
      </div>
      {/* The editor keeps its formula rows in place and scrolls only the
          catalogue and docs; this scrolls only when even their minimum height
          does not fit. */}
      <div className={'appflowy-scroller flex min-h-0 flex-1 flex-col overflow-y-auto'}>
        <FormulaEditor
          fieldId={fieldId}
          value={draft}
          onChange={setDraft}
          initialPreviewRowId={rowId}
          onSubmit={handleSave}
          onAutocompleteOpenChange={onAutocompleteOpenChange}
        />
      </div>
    </div>
  );
}

export default FormulaEditorPanel;
