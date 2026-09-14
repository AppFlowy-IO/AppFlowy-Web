import { KeyboardEvent, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDatabase, useDatabaseFields, useDatabaseView, useRowMap } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import { decodeCellToText } from '@/application/database-yjs/decode';
import {
  compileFormula,
  evaluateFormulaExpression,
  FORMULA_BUILTINS,
  FORMULA_FUNCTIONS,
  FormulaBuiltinSpec,
  FormulaFieldSchema,
  FormulaFunctionSpec,
  formulaTypeOfFieldType,
  parseFormulaTypeOption,
  readFormulaSchemaForVersion,
  typeToString,
} from '@/application/database-yjs/fields/formula';
import { useDatabaseFieldsVersion } from '@/application/database-yjs/hooks/useDatabaseFieldsVersion';
import { getInlineViewRowOrders, materializeVisibleRowOrders } from '@/application/database-yjs/row-order-visibility';
import { Row, useFieldSelector, usePrimaryFieldId } from '@/application/database-yjs/selector';
import { YDatabaseRow, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { ReactComponent as ArrowDownIcon } from '@/assets/icons/alt_arrow_down.svg';
import { ReactComponent as WarningSvg } from '@/assets/icons/warning.svg';
import { FieldTypeIcon } from '@/components/database/components/field/FieldTypeIcon';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SearchInput } from '@/components/ui/search-input';
import { cn } from '@/lib/utils';

import { FormulaDocsPanel, FormulaDocsItem } from './FormulaDocsPanel';
import { HIGHLIGHT_CLASS, highlightFormula } from './highlight';

const PREVIEW_ROW_LIMIT = 50;
const AUTOCOMPLETE_LIMIT = 8;
const MONO_CLASS = 'font-mono text-sm leading-6';

export interface FormulaEditorProps {
  fieldId: string;
  /** Display-form draft (property references by name). */
  value: string;
  onChange: (value: string) => void;
  /** Row to preview with initially (the cell the editor was opened from). */
  initialPreviewRowId?: string;
  onSubmit?: () => void;
  /** Reports whether the suggestion popup is open, so the host lets Escape close only the popup. */
  onAutocompleteOpenChange?: (open: boolean) => void;
}

type Suggestion =
  | { kind: 'function'; spec: FormulaFunctionSpec }
  | { kind: 'property'; entry: FormulaFieldSchema }
  | { kind: 'builtin'; spec: FormulaBuiltinSpec };

function suggestionLabel(suggestion: Suggestion): string {
  switch (suggestion.kind) {
    case 'function':
      return `${suggestion.spec.name}()`;
    case 'property':
      return suggestion.entry.name;
    case 'builtin':
      return suggestion.spec.name;
  }
}

function suggestionInsertion(suggestion: Suggestion): { text: string; caretOffset: number } {
  switch (suggestion.kind) {
    case 'function':
      return { text: `${suggestion.spec.name}()`, caretOffset: suggestion.spec.name.length + 1 };
    case 'property': {
      const text = `prop("${suggestion.entry.name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`;

      return { text, caretOffset: text.length };
    }

    case 'builtin':
      return { text: suggestion.spec.insert, caretOffset: suggestion.spec.insert.length };
  }
}

function toDocsItem(suggestion: Suggestion): FormulaDocsItem {
  switch (suggestion.kind) {
    case 'function':
      return { kind: 'function', spec: suggestion.spec };
    case 'property':
      return { kind: 'property', entry: suggestion.entry };
    case 'builtin':
      return { kind: 'builtin', spec: suggestion.spec };
  }
}

function useSchema() {
  const fields = useDatabaseFields();
  const fieldsVersion = useDatabaseFieldsVersion();

  return readFormulaSchemaForVersion(fields, fieldsVersion);
}

export function FormulaEditor({
  fieldId,
  value,
  onChange,
  initialPreviewRowId,
  onSubmit,
  onAutocompleteOpenChange,
}: FormulaEditorProps) {
  const { t } = useTranslation();
  const schema = useSchema();
  const { field } = useFieldSelector(fieldId);
  const rowMap = useRowMap();
  const database = useDatabase();
  const view = useDatabaseView();
  const primaryFieldId = usePrimaryFieldId();
  // Row ids in view order, read once. The picker does not need the live
  // sort/filter pipeline useRowOrdersSelector would run while the editor is open.
  const rowIds = useMemo(() => {
    const rowOrders = view?.get(YjsDatabaseKey.row_orders)?.toJSON() as Row[] | undefined;
    const canonical = getInlineViewRowOrders(database)?.toJSON() as Row[] | undefined;

    return (materializeVisibleRowOrders(rowOrders, canonical) ?? []).map((row) => row.id);
  }, [database, view]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [search, setSearch] = useState('');
  // The catalogue item whose docs are showing. It stays after the pointer
  // leaves so its examples can be reached and inserted.
  const [selected, setSelected] = useState<FormulaDocsItem | null>(null);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
  const [previewRowId, setPreviewRowId] = useState<string | undefined>(initialPreviewRowId);

  // Every field but this one, skipping types the language cannot read yet.
  const referenceableFields = useMemo(
    () =>
      schema.filter(
        (entry) =>
          entry.id !== fieldId && (entry.type === FieldType.Formula || formulaTypeOfFieldType(entry.type) !== 'any')
      ),
    [schema, fieldId]
  );

  // Compile what the user typed (names resolve like ids) so error positions
  // point into the visible text rather than the id-rewritten storage form.
  const compiled = useMemo(() => compileFormula(value, schema, fieldId), [value, schema, fieldId]);

  // Preview rows: the view's row order, capped, labelled by their primary cell.
  // The row the editor was opened from is always offered, even past the cap.
  const previewRows = useMemo(() => {
    const primaryField = primaryFieldId ? schema.find((entry) => entry.id === primaryFieldId)?.field : undefined;
    const ids = rowIds.slice(0, PREVIEW_ROW_LIMIT);

    if (initialPreviewRowId && !ids.includes(initialPreviewRowId) && rowIds.includes(initialPreviewRowId)) {
      ids.unshift(initialPreviewRowId);
    }

    return ids
      .map((id) => {
        const rowDoc = rowMap?.[id];
        const databaseRow = rowDoc?.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as
          | YDatabaseRow
          | undefined;
        const primaryCell = primaryFieldId ? databaseRow?.get(YjsDatabaseKey.cells)?.get(primaryFieldId) : undefined;
        const label = primaryCell && primaryField ? decodeCellToText(primaryCell, primaryField).trim() : '';

        return {
          id,
          row: databaseRow,
          label:
            label || t('grid.formula.untitledRow', { defaultValue: 'Row {{index}}', index: rowIds.indexOf(id) + 1 }),
        };
      })
      .filter((entry) => entry.row);
  }, [rowIds, rowMap, primaryFieldId, schema, initialPreviewRowId, t]);

  const previewRow = previewRows.find((entry) => entry.id === previewRowId) ?? previewRows[0];

  const preview = useMemo(() => {
    if (!field || !previewRow?.row || compiled.error) return null;
    return evaluateFormulaExpression({
      expression: value,
      schema,
      field,
      fieldId,
      row: previewRow.row,
      rowId: previewRow.id,
      // Preview the value the way the cell shows it.
      format: { numberFormat: parseFormulaTypeOption(field).format },
    });
  }, [field, previewRow, compiled.error, value, schema, fieldId]);

  const errorMessage = compiled.error?.displayMessage ?? preview?.error;

  // ---- editing helpers -------------------------------------------------

  // A programmatic value change makes the browser park the caret at the end;
  // restore the intended position right after React commits the new value.
  const pendingCaretRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    const pending = pendingCaretRef.current;

    if (!textarea || pending === null) return;
    pendingCaretRef.current = null;
    textarea.focus();
    textarea.setSelectionRange(pending, pending);
  }, [value]);

  // Latest draft for callbacks that must stay stable (catalogue, docs examples).
  const valueRef = useRef(value);

  useLayoutEffect(() => {
    valueRef.current = value;
  }, [value]);

  const insertAtCaret = useCallback(
    (text: string, caretOffset: number, replaceFrom?: number) => {
      const current = valueRef.current;
      const textarea = textareaRef.current;
      const start = replaceFrom ?? textarea?.selectionStart ?? current.length;
      const end = textarea?.selectionEnd ?? start;
      const next = current.slice(0, start) + text + current.slice(end);
      const nextCaret = start + caretOffset;

      pendingCaretRef.current = nextCaret;
      onChange(next);
      setCaret(nextCaret);
      setSuggestionsDismissed(true);
    },
    [onChange]
  );

  const currentWord = useMemo(() => {
    let start = caret;

    while (start > 0 && /[A-Za-z0-9_]/.test(value[start - 1])) start -= 1;
    // Inside a string literal we never suggest.
    const before = value.slice(0, start);
    const quotes = (before.match(/(?<!\\)"/g) ?? []).length;

    if (quotes % 2 === 1) return { start, query: '' };
    return { start, query: value.slice(start, caret) };
  }, [caret, value]);

  const suggestions = useMemo<Suggestion[]>(() => {
    const query = currentWord.query.toLowerCase();

    if (!query || suggestionsDismissed) return [];
    const matches: Suggestion[] = [];

    FORMULA_FUNCTIONS.forEach((spec) => {
      if (spec.name.toLowerCase().startsWith(query)) matches.push({ kind: 'function', spec });
    });
    FORMULA_BUILTINS.forEach((spec) => {
      if (/^[a-z]/.test(spec.name) && spec.name.startsWith(query)) matches.push({ kind: 'builtin', spec });
    });
    referenceableFields.forEach((entry) => {
      if (entry.name.toLowerCase().includes(query)) matches.push({ kind: 'property', entry });
    });

    return matches.slice(0, AUTOCOMPLETE_LIMIT);
  }, [currentWord.query, suggestionsDismissed, referenceableFields]);

  useEffect(() => {
    setActiveSuggestion(0);
  }, [suggestions.length, currentWord.query]);

  const autocompleteOpen = suggestions.length > 0;

  useEffect(() => {
    onAutocompleteOpenChange?.(autocompleteOpen);
  }, [autocompleteOpen, onAutocompleteOpenChange]);

  const acceptSuggestion = useCallback(
    (suggestion: Suggestion) => {
      const { text, caretOffset } = suggestionInsertion(suggestion);
      const textarea = textareaRef.current;
      const end = textarea?.selectionEnd ?? caret;
      const next = value.slice(0, currentWord.start) + text + value.slice(end);
      const nextCaret = currentWord.start + caretOffset;

      pendingCaretRef.current = nextCaret;
      onChange(next);
      setCaret(nextCaret);
      setSuggestionsDismissed(true);
    },
    [caret, currentWord.start, onChange, value]
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter and Tab confirm an IME composition; never treat them as editor commands.
      if (event.nativeEvent.isComposing) return;
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        onSubmit?.();
        return;
      }

      if (suggestions.length > 0) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setActiveSuggestion((index) => (index + 1) % suggestions.length);
          return;
        }

        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setActiveSuggestion((index) => (index - 1 + suggestions.length) % suggestions.length);
          return;
        }

        // Shift+Enter always adds a line, even while suggestions are showing.
        if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
          event.preventDefault();
          acceptSuggestion(suggestions[activeSuggestion] ?? suggestions[0]);
          return;
        }

        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          setSuggestionsDismissed(true);
          return;
        }
      }

      if (event.key === 'Tab') {
        event.preventDefault();
        insertAtCaret('  ', 2);
      }
    },
    [acceptSuggestion, activeSuggestion, insertAtCaret, onSubmit, suggestions]
  );

  const syncCaret = useCallback(() => {
    const textarea = textareaRef.current;

    if (textarea) setCaret(textarea.selectionStart);
  }, []);

  // Keep the textarea as tall as its content so the highlight overlay lines up;
  // measure before paint so a multi-line formula does not open short and jump.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) return;
    textarea.style.height = '0px';
    textarea.style.height = `${Math.max(textarea.scrollHeight, 72)}px`;
  }, [value]);

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    setCaret(textarea.value.length);
  }, []);

  // ---- catalogue -------------------------------------------------------

  const normalizedSearch = search.trim().toLowerCase();
  const catalogue = useMemo(
    () => ({
      properties: referenceableFields.filter(
        (entry) => !normalizedSearch || entry.name.toLowerCase().includes(normalizedSearch)
      ),
      builtins: FORMULA_BUILTINS.filter((spec) => !normalizedSearch || spec.name.toLowerCase().includes(normalizedSearch)),
      functions: FORMULA_FUNCTIONS.filter(
        (spec) => !normalizedSearch || spec.name.toLowerCase().includes(normalizedSearch)
      ),
    }),
    [referenceableFields, normalizedSearch]
  );

  const activeSuggestionItem = suggestions.length > 0 ? suggestions[activeSuggestion] ?? suggestions[0] : undefined;
  const docsItem = useMemo<FormulaDocsItem | null>(
    () =>
      (activeSuggestionItem ? toDocsItem(activeSuggestionItem) : null) ??
      selected ??
      (catalogue.properties[0] ? { kind: 'property', entry: catalogue.properties[0] } : null) ??
      (catalogue.functions[0] ? { kind: 'function', spec: catalogue.functions[0] } : null),
    [activeSuggestionItem, selected, catalogue]
  );
  const insertDocsExample = useCallback((text: string) => insertAtCaret(text, text.length), [insertAtCaret]);

  const segments = useMemo(() => highlightFormula(value), [value]);

  return (
    <div className={'flex min-h-0 flex-col gap-3'} data-testid={'formula-editor'}>
      <div className={'relative'}>
        <pre
          aria-hidden
          className={cn(
            MONO_CLASS,
            'pointer-events-none absolute inset-0 m-0 overflow-hidden whitespace-pre-wrap break-words rounded-400 border border-transparent px-3 py-2 text-text-primary'
          )}
        >
          {segments.map((segment, index) => (
            <span key={index} className={HIGHLIGHT_CLASS[segment.kind]} data-highlight={segment.kind}>
              {segment.text}
            </span>
          ))}
          {'\n'}
        </pre>
        <textarea
          ref={textareaRef}
          data-testid={'formula-editor-input'}
          aria-label={t('grid.formula.title', { defaultValue: 'Formula' })}
          spellCheck={false}
          autoComplete={'off'}
          autoCorrect={'off'}
          autoCapitalize={'off'}
          placeholder={t('grid.formula.placeholder', { defaultValue: 'Type a formula, e.g. prop("Price") * 2' })}
          value={value}
          className={cn(
            MONO_CLASS,
            'relative block w-full resize-none overflow-hidden whitespace-pre-wrap break-words rounded-400 border border-border-primary bg-transparent px-3 py-2 text-transparent caret-text-primary outline-none placeholder:text-text-tertiary focus-visible:border-border-theme-thick'
          )}
          onChange={(event) => {
            onChange(event.target.value);
            setSuggestionsDismissed(false);
            setCaret(event.target.selectionStart);
          }}
          onKeyDown={handleKeyDown}
          onKeyUp={syncCaret}
          onClick={syncCaret}
          onSelect={syncCaret}
        />
        {suggestions.length > 0 ? (
          <div
            role={'listbox'}
            data-testid={'formula-autocomplete'}
            className={
              'absolute left-0 top-full z-10 mt-1 max-h-64 w-64 overflow-y-auto rounded-400 border border-border-primary bg-surface-primary p-1 shadow-md'
            }
          >
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion.kind === 'property' ? `property-${suggestion.entry.id}` : `${suggestion.kind}-${suggestionLabel(suggestion)}`}
                type={'button'}
                role={'option'}
                aria-selected={index === activeSuggestion}
                data-testid={`formula-suggestion-${suggestionLabel(suggestion)}`}
                className={cn(
                  'flex h-8 w-full items-center gap-2 rounded-300 px-2 text-left text-sm',
                  index === activeSuggestion ? 'bg-fill-content-hover' : 'hover:bg-fill-content-hover'
                )}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveSuggestion(index)}
                onClick={() => acceptSuggestion(suggestion)}
              >
                {suggestion.kind === 'property' ? (
                  <FieldTypeIcon type={suggestion.entry.type} className={'h-4 w-4 shrink-0 text-icon-secondary'} />
                ) : (
                  <span className={'w-4 shrink-0 text-center text-xs text-text-tertiary'}>
                    {suggestion.kind === 'function' ? 'ƒ' : '∙'}
                  </span>
                )}
                <span className={cn('truncate', suggestion.kind !== 'property' && 'font-mono')}>
                  {suggestionLabel(suggestion)}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className={'flex min-h-6 flex-wrap items-center gap-x-4 gap-y-1 text-xs'}>
        {errorMessage ? (
          <span className={'flex min-w-0 items-center gap-1 text-text-error'} data-testid={'formula-editor-error'}>
            <WarningSvg className={'h-4 w-4 shrink-0'} />
            <span className={'break-words'}>{errorMessage}</span>
          </span>
        ) : null}
        <span className={'ml-auto rounded-300 bg-fill-secondary px-2 py-0.5 text-text-secondary'} data-testid={'formula-editor-type'}>
          {t('grid.formula.type', { defaultValue: 'Type' })}: {typeToString(compiled.resultType)}
        </span>
      </div>

      {previewRows.length > 0 ? (
        <div className={'flex min-h-8 items-center gap-2 text-sm'} data-testid={'formula-editor-preview'}>
          <span className={'shrink-0 text-text-secondary'}>
            {t('grid.formula.previewWith', { defaultValue: 'Preview with' })}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant={'ghost'} size={'sm'} className={'max-w-[220px] gap-1 px-2'} data-testid={'formula-preview-row'}>
                <span className={'truncate'}>{previewRow?.label}</span>
                <ArrowDownIcon className={'h-4 w-4 shrink-0 text-icon-secondary'} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={'start'} className={'max-h-72 w-[240px] overflow-y-auto'}>
              {previewRows.map((entry) => (
                <DropdownMenuItem key={entry.id} onSelect={() => setPreviewRowId(entry.id)}>
                  <span className={'truncate'}>{entry.label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <span className={'min-w-0 flex-1 truncate font-mono text-text-primary'} data-testid={'formula-preview-value'}>
            {preview && !preview.error ? preview.text || (preview.value.type === 'empty' ? '—' : '') : ''}
          </span>
        </div>
      ) : null}

      <div className={'grid min-h-[280px] grid-cols-1 gap-3 border-t border-border-primary pt-3 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)]'}>
        <FormulaCatalogue
          search={search}
          onSearchChange={setSearch}
          properties={catalogue.properties}
          builtins={catalogue.builtins}
          functions={catalogue.functions}
          selected={selected}
          onSelect={setSelected}
          onInsert={insertAtCaret}
        />
        <FormulaDocsPanel item={docsItem} onInsert={insertDocsExample} />
      </div>
    </div>
  );
}

interface FormulaCatalogueProps {
  search: string;
  onSearchChange: (search: string) => void;
  properties: FormulaFieldSchema[];
  builtins: FormulaBuiltinSpec[];
  functions: FormulaFunctionSpec[];
  selected: FormulaDocsItem | null;
  onSelect: (item: FormulaDocsItem) => void;
  onInsert: (text: string, caretOffset: number) => void;
}

/**
 * The searchable list of properties, built-ins and functions. Memoized with
 * stable props so typing in the formula does not re-render ~80 buttons.
 */
const FormulaCatalogue = memo(function FormulaCatalogue({
  search,
  onSearchChange,
  properties,
  builtins,
  functions,
  selected,
  onSelect,
  onInsert,
}: FormulaCatalogueProps) {
  const { t } = useTranslation();
  const isEmpty = properties.length === 0 && builtins.length === 0 && functions.length === 0;

  const renderItem = (item: FormulaDocsItem, key: string, label: React.ReactNode, onPick: () => void) => (
    <button
      key={key}
      type={'button'}
      data-testid={`formula-catalogue-${key}`}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-300 px-2 text-left text-sm text-text-primary hover:bg-fill-content-hover',
        selected && sameDocsItem(selected, item) && 'bg-fill-content-hover'
      )}
      onMouseEnter={() => onSelect(item)}
      onFocus={() => onSelect(item)}
      onClick={() => {
        onSelect(item);
        onPick();
      }}
    >
      {label}
    </button>
  );

  return (
    <div className={'flex min-h-0 flex-col gap-1'}>
      <SearchInput
        placeholder={t('search.label', { defaultValue: 'Search' })}
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        data-testid={'formula-catalogue-search'}
      />
      <div className={'appflowy-scroller max-h-[320px] min-h-0 overflow-y-auto pr-1'} data-testid={'formula-catalogue'}>
        {isEmpty ? (
          <div className={'px-2 py-3 text-sm text-text-tertiary'}>{t('grid.rollup.noResult', { defaultValue: 'No result' })}</div>
        ) : null}
        {properties.length > 0 ? (
          <div className={'mb-2'}>
            <div className={'px-2 py-1 text-xs font-medium text-text-tertiary'} data-testid={'formula-catalogue-section'}>
              {t('grid.formula.properties', { defaultValue: 'Properties' })}
            </div>
            {properties.map((entry) =>
              renderItem(
                { kind: 'property', entry },
                `property-${entry.id}`,
                <>
                  <FieldTypeIcon type={entry.type} className={'h-4 w-4 shrink-0 text-icon-secondary'} />
                  <span className={'truncate'}>{entry.name}</span>
                </>,
                () => {
                  const { text, caretOffset } = suggestionInsertion({ kind: 'property', entry });

                  onInsert(text, caretOffset);
                }
              )
            )}
          </div>
        ) : null}
        {builtins.length > 0 ? (
          <div className={'mb-2'}>
            <div className={'px-2 py-1 text-xs font-medium text-text-tertiary'} data-testid={'formula-catalogue-section'}>
              {t('grid.formula.builtins', { defaultValue: 'Built-ins' })}
            </div>
            {builtins.map((spec) =>
              renderItem(
                { kind: 'builtin', spec },
                `builtin-${spec.name}`,
                <span className={'truncate font-mono'}>{spec.name}</span>,
                () => onInsert(spec.insert, spec.insert.length)
              )
            )}
          </div>
        ) : null}
        {functions.length > 0 ? (
          <div>
            <div className={'px-2 py-1 text-xs font-medium text-text-tertiary'} data-testid={'formula-catalogue-section'}>
              {t('grid.formula.functions', { defaultValue: 'Functions' })}
            </div>
            {functions.map((spec) =>
              renderItem(
                { kind: 'function', spec },
                `function-${spec.name}`,
                <span className={'truncate font-mono'}>{spec.name}()</span>,
                () => onInsert(`${spec.name}()`, spec.name.length + 1)
              )
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
});

function sameDocsItem(a: FormulaDocsItem, b: FormulaDocsItem) {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'property' && b.kind === 'property') return a.entry.id === b.entry.id;
  if (a.kind === 'function' && b.kind === 'function') return a.spec.name === b.spec.name;
  if (a.kind === 'builtin' && b.kind === 'builtin') return a.spec.name === b.spec.name;
  return false;
}

export default FormulaEditor;
