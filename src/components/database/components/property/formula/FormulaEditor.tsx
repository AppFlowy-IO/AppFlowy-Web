import { KeyboardEvent, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDatabase, useDatabaseFields, useDatabaseView, useRowMap } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import { decodeCellToText } from '@/application/database-yjs/decode';
import {
  collectExpressionExternalReferences,
  compileFormula,
  evaluateFormulaExpression,
  FORMULA_BUILTINS,
  FORMULA_FUNCTIONS,
  FormulaBuiltinSpec,
  FormulaFieldSchema,
  FormulaFunctionSpec,
  formulaPropertyReference,
  formulaTypeOfField,
  NO_EXTERNAL_REFERENCES,
  parseFormulaTypeOption,
  readFormulaSchemaForVersion,
  typeToString,
} from '@/application/database-yjs/fields/formula';
import { useFormulaReadContext } from '@/application/database-yjs/formula/read-context';
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

/** An autocomplete suggestion is a documented item: a function, property or built-in. */
type Suggestion = FormulaDocsItem;

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

function suggestionInsertion(suggestion: Suggestion, schema: FormulaFieldSchema[]): { text: string; caretOffset: number } {
  switch (suggestion.kind) {
    case 'function':
      return { text: `${suggestion.spec.name}()`, caretOffset: suggestion.spec.name.length + 1 };
    case 'property': {
      const text = formulaPropertyReference(suggestion.entry.id, schema);

      return { text, caretOffset: text.length };
    }

    case 'builtin':
      return { text: suggestion.spec.insert, caretOffset: suggestion.spec.insert.length };
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
  // The editor opens with the caret after the saved formula.
  const [caret, setCaret] = useState(() => value.length);
  const [search, setSearch] = useState('');
  // The catalogue item whose docs are showing. It stays after the pointer
  // leaves so its examples can be reached and inserted.
  const [selected, setSelected] = useState<FormulaDocsItem | null>(null);
  // The highlighted suggestion belongs to the word it was picked for; typing
  // another word starts again at the first suggestion.
  const [activeState, setActiveState] = useState({ word: '', index: 0 });
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
  const [previewRowId, setPreviewRowId] = useState<string | undefined>(initialPreviewRowId);

  // Every field but this one, skipping types the language cannot read yet.
  const referenceableFields = useMemo(
    () =>
      schema.filter(
        (entry) =>
          entry.id !== fieldId && (entry.type === FieldType.Formula || formulaTypeOfField(entry) !== 'any')
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
    const positions = new Map(rowIds.map((id, index) => [id, index + 1]));
    const ids = rowIds.slice(0, PREVIEW_ROW_LIMIT);

    if (initialPreviewRowId && !ids.includes(initialPreviewRowId) && positions.has(initialPreviewRowId)) {
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
            label || t('grid.formula.untitledRow', { defaultValue: 'Row {{index}}', index: positions.get(id) }),
        };
      })
      .filter((entry) => entry.row);
  }, [rowIds, rowMap, primaryFieldId, schema, initialPreviewRowId, t]);

  const previewRow = previewRows.find((entry) => entry.id === previewRowId) ?? previewRows[0];
  const previewDatabaseRow = previewRow?.row;
  const previewId = previewRow?.id ?? '';

  // The preview follows edits to its row, like the cell does.
  const [previewClock, setPreviewClock] = useState(0);

  useEffect(() => {
    if (!previewDatabaseRow) return;
    const bump = () => setPreviewClock((clock) => clock + 1);

    previewDatabaseRow.observeDeep(bump);
    return () => previewDatabaseRow.unobserveDeep(bump);
  }, [previewDatabaseRow]);

  // Names, related titles and rollups the draft reads, loaded like the cell's.
  const previewReferences = useMemo(
    () => (compiled.error ? NO_EXTERNAL_REFERENCES : collectExpressionExternalReferences(value, schema, fieldId)),
    [compiled.error, value, schema, fieldId]
  );
  const { context: previewContext, revision: previewRevision } = useFormulaReadContext({
    references: previewReferences,
    row: previewDatabaseRow,
    rowId: previewId,
    rowClock: previewClock,
  });

  const preview = useMemo(() => {
    if (!field || !previewDatabaseRow || compiled.error) return null;
    void previewClock;
    void previewRevision;
    return evaluateFormulaExpression({
      ...previewContext,
      expression: value,
      schema,
      field,
      fieldId,
      row: previewDatabaseRow,
      rowId: previewId,
      // Preview the value the way the cell shows it.
      format: { numberFormat: parseFormulaTypeOption(field).format },
    });
  }, [
    field,
    previewDatabaseRow,
    previewId,
    previewClock,
    previewRevision,
    previewContext,
    compiled.error,
    value,
    schema,
    fieldId,
  ]);

  const errorMessage = compiled.error?.displayMessage ?? preview?.error;
  const missingPropertyRef = compiled.error?.missingPropertyRef ?? preview?.missingPropertyRef;

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

  const activeSuggestion =
    activeState.word === currentWord.query && activeState.index < suggestions.length ? activeState.index : 0;
  const setActiveSuggestion = useCallback(
    (index: number) => setActiveState({ word: currentWord.query, index }),
    [currentWord.query]
  );

  const autocompleteOpen = suggestions.length > 0;

  useEffect(() => {
    onAutocompleteOpenChange?.(autocompleteOpen);
  }, [autocompleteOpen, onAutocompleteOpenChange]);

  const acceptSuggestion = useCallback(
    (suggestion: Suggestion) => {
      const { text, caretOffset } = suggestionInsertion(suggestion, schema);
      const textarea = textareaRef.current;
      const end = textarea?.selectionEnd ?? caret;
      const next = value.slice(0, currentWord.start) + text + value.slice(end);
      const nextCaret = currentWord.start + caretOffset;

      pendingCaretRef.current = nextCaret;
      onChange(next);
      setCaret(nextCaret);
      setSuggestionsDismissed(true);
    },
    [caret, currentWord.start, onChange, value, schema]
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
          setActiveSuggestion((activeSuggestion + 1) % suggestions.length);
          return;
        }

        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setActiveSuggestion((activeSuggestion - 1 + suggestions.length) % suggestions.length);
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
    [acceptSuggestion, activeSuggestion, insertAtCaret, onSubmit, setActiveSuggestion, suggestions]
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
  const nextDocsItem =
    activeSuggestionItem ??
    selected ??
    (catalogue.properties[0] ? ({ kind: 'property', entry: catalogue.properties[0] } as const) : null) ??
    (catalogue.functions[0] ? ({ kind: 'function', spec: catalogue.functions[0] } as const) : null);
  // Keep one object per documented item (and schema) so the memoized panel
  // skips keystrokes that do not change what it documents.
  const docsKey = nextDocsItem ? docsItemKey(nextDocsItem) : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const docsItem = useMemo<FormulaDocsItem | null>(() => nextDocsItem, [docsKey, schema]);
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
            <span className={'break-words'}>
              {missingPropertyRef !== undefined ? (
                <span className={'block'}>
                  {t('grid.formula.missingPropertyDescription', {
                    defaultValue: 'A property used by this formula is missing. It may have been deleted.',
                  })}
                </span>
              ) : null}
              {errorMessage}
            </span>
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
          schema={schema}
          search={search}
          onSearchChange={setSearch}
          properties={catalogue.properties}
          builtins={catalogue.builtins}
          functions={catalogue.functions}
          selected={selected}
          onSelect={setSelected}
          onInsert={insertAtCaret}
        />
        <FormulaDocsPanel item={docsItem} schema={schema} onInsert={insertDocsExample} />
      </div>
    </div>
  );
}

interface FormulaCatalogueProps {
  schema: FormulaFieldSchema[];
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
 * stable props so typing in the formula does not re-render ~80 buttons, and
 * each row is memoized so hovering re-renders only the rows whose selection
 * changed.
 */
const FormulaCatalogue = memo(function FormulaCatalogue({
  schema,
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
  const selectedKey = selected ? docsItemKey(selected) : '';
  const sections: Array<{ title: string; items: FormulaDocsItem[] }> = [
    {
      title: t('grid.formula.properties', { defaultValue: 'Properties' }),
      items: properties.map((entry) => ({ kind: 'property', entry })),
    },
    {
      title: t('grid.formula.builtins', { defaultValue: 'Built-ins' }),
      items: builtins.map((spec) => ({ kind: 'builtin', spec })),
    },
    {
      title: t('grid.formula.functions', { defaultValue: 'Functions' }),
      items: functions.map((spec) => ({ kind: 'function', spec })),
    },
  ];

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
        {sections.map((section, index) =>
          section.items.length > 0 ? (
            <div key={section.title} className={index < sections.length - 1 ? 'mb-2' : undefined}>
              <div className={'px-2 py-1 text-xs font-medium text-text-tertiary'} data-testid={'formula-catalogue-section'}>
                {section.title}
              </div>
              {section.items.map((item) => {
                const key = docsItemKey(item);

                return (
                  <FormulaCatalogueItem
                    schema={schema}
                    key={key}
                    itemKey={key}
                    item={item}
                    isSelected={key === selectedKey}
                    onSelect={onSelect}
                    onInsert={onInsert}
                  />
                );
              })}
            </div>
          ) : null
        )}
      </div>
    </div>
  );
});

const FormulaCatalogueItem = memo(function FormulaCatalogueItem({
  schema,
  itemKey,
  item,
  isSelected,
  onSelect,
  onInsert,
}: {
  schema: FormulaFieldSchema[];
  itemKey: string;
  item: FormulaDocsItem;
  isSelected: boolean;
  onSelect: (item: FormulaDocsItem) => void;
  onInsert: (text: string, caretOffset: number) => void;
}) {
  return (
    <button
      type={'button'}
      data-testid={`formula-catalogue-${itemKey}`}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-300 px-2 text-left text-sm text-text-primary hover:bg-fill-content-hover',
        isSelected && 'bg-fill-content-hover'
      )}
      onMouseEnter={() => onSelect(item)}
      onFocus={() => onSelect(item)}
      onClick={() => {
        const { text, caretOffset } = suggestionInsertion(item, schema);

        onSelect(item);
        onInsert(text, caretOffset);
      }}
    >
      {item.kind === 'property' ? (
        <>
          <FieldTypeIcon type={item.entry.type} className={'h-4 w-4 shrink-0 text-icon-secondary'} />
          <span className={'truncate'}>{item.entry.name}</span>
        </>
      ) : (
        <span className={'truncate font-mono'}>{suggestionLabel(item)}</span>
      )}
    </button>
  );
});

/** Stable identity of a documented item; also its catalogue test id. */
function docsItemKey(item: FormulaDocsItem): string {
  switch (item.kind) {
    case 'property':
      return `property-${item.entry.id}`;
    case 'function':
      return `function-${item.spec.name}`;
    case 'builtin':
      return `builtin-${item.spec.name}`;
  }
}

export default FormulaEditor;
