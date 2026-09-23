import {
  forwardRef,
  KeyboardEvent,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { BaseRange, createEditor, Descendant, NodeEntry, Text, Transforms } from 'slate';
import { withHistory } from 'slate-history';
import {
  Editable,
  ReactEditor,
  RenderElementProps,
  RenderLeafProps,
  RenderPlaceholderProps,
  Slate,
  useFocused,
  useSelected,
  withReact,
} from 'slate-react';

import { FormulaFieldSchema, resolveFormulaField } from '@/application/database-yjs/fields/formula';
import { FieldTypeIcon } from '@/components/database/components/field/FieldTypeIcon';
import { cn } from '@/lib/utils';

import {
  editorSource,
  ejectCaretFromToken,
  FormulaPropElement,
  isFormulaProp,
  moveCaret,
  offsetToPoint,
  replaceSourceRange,
  resetSource,
  selectionOffsets,
  sourceToNodes,
  textOffsets,
  withFormulaTokens,
} from './formula-slate';
import { HIGHLIGHT_CLASS, HighlightKind, highlightFormula } from './highlight';

export interface FormulaSourceInputHandle {
  /** Replaces `[start, end)` of the formula and puts the caret `caretOffset` into the new text. */
  replaceRange: (start: number, end: number, text: string, caretOffset: number) => void;
  /** Inserts at the selection (replacing it); `caretOffset` is relative to the insertion. */
  insert: (text: string, caretOffset: number) => void;
  /** The selection as offsets into the formula source. */
  selection: () => { start: number; end: number } | null;
}

interface FormulaSourceInputProps {
  /** Formula source in display form. */
  value: string;
  onChange: (value: string) => void;
  /** Collapsed caret (or selection focus) as an offset into the source. */
  onCaretChange: (caret: number) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  schema: FormulaFieldSchema[];
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}

type HighlightRange = BaseRange & { highlight: HighlightKind };

function renderPlaceholder({ attributes, children }: RenderPlaceholderProps) {
  return (
    <span {...attributes} className={'!opacity-100 text-text-tertiary'}>
      {children}
    </span>
  );
}

/**
 * The formula text box. Property references render as tokens showing the
 * property's icon and name; the rest of the source is syntax highlighted.
 * The source string stays the single source of truth for the host.
 */
export const FormulaSourceInput = memo(
  forwardRef<FormulaSourceInputHandle, FormulaSourceInputProps>(function FormulaSourceInput(
    { value, onChange, onCaretChange, onKeyDown, schema, placeholder, ariaLabel, className },
    ref
  ) {
    // The host recreates its handlers on most renders; reading them through a
    // ref keeps this component's own callbacks stable so memo can skip renders.
    const handlersRef = useRef({ onChange, onCaretChange, onKeyDown });

    useLayoutEffect(() => {
      handlersRef.current = { onChange, onCaretChange, onKeyDown };
    });

    const [editor] = useState(() => withFormulaTokens(withReact(withHistory(createEditor()))));
    const [initialValue] = useState<Descendant[]>(() => sourceToNodes(value));
    // The source the document currently serializes to; a different `value`
    // prop means the formula was replaced from outside.
    const sourceRef = useRef(value);
    const [children, setChildren] = useState(initialValue);

    // Replace the document before paint, so the new source's highlighting is
    // never drawn over the old document.
    useLayoutEffect(() => {
      if (value === sourceRef.current) return;
      sourceRef.current = value;
      resetSource(editor, value);
      setChildren(editor.children);
    }, [editor, value]);

    const focusAt = useCallback(
      (offset: number) => {
        ReactEditor.focus(editor);
        Transforms.select(editor, offsetToPoint(editor, offset));
      },
      [editor]
    );

    // Slate syncs native caret moves (Home, End, clicks) on a throttle; read
    // the DOM selection first so an insertion right after one lands there.
    const syncSelectionFromDOM = useCallback(() => {
      const domSelection = window.getSelection();

      if (!domSelection || domSelection.rangeCount === 0 || !domSelection.anchorNode) return;
      if (!ReactEditor.hasDOMNode(editor, domSelection.anchorNode)) return;
      const range = ReactEditor.toSlateRange(editor, domSelection, { exactMatch: false, suppressThrow: true });

      if (range) Transforms.select(editor, range);
    }, [editor]);

    useImperativeHandle(
      ref,
      () => ({
        replaceRange: (start, end, text, caretOffset) => {
          ReactEditor.focus(editor);
          replaceSourceRange(editor, start, end, text, caretOffset);
        },
        insert: (text, caretOffset) => {
          syncSelectionFromDOM();
          const offsets = selectionOffsets(editor);
          const start = offsets?.start ?? editorSource(editor).length;

          ReactEditor.focus(editor);
          replaceSourceRange(editor, start, offsets?.end ?? start, text, caretOffset);
        },
        selection: () => {
          syncSelectionFromDOM();
          return selectionOffsets(editor);
        },
      }),
      [editor, syncSelectionFromDOM]
    );

    // The editor opens focused with the caret after the formula.
    useEffect(() => {
      focusAt(editorSource(editor).length);
    }, [editor, focusAt]);

    const handleChange = useCallback(
      (nodes: Descendant[]) => {
        const next = editorSource(editor);
        const offsets = selectionOffsets(editor);

        ejectCaretFromToken(editor);
        setChildren(nodes);
        if (next !== sourceRef.current) {
          sourceRef.current = next;
          handlersRef.current.onChange(next);
        }

        if (offsets) handlersRef.current.onCaretChange(offsets.end);
      },
      [editor]
    );

    // Syntax colours come from the whole source, then are cut to each text node.
    const segments = useMemo(() => highlightFormula(value), [value]);
    const offsets = useMemo(() => textOffsets(children), [children]);
    const decorate = useCallback(
      ([node, path]: NodeEntry): HighlightRange[] => {
        if (!Text.isText(node) || node.text === '') return [];
        const start = offsets.get(path.join('.'));

        if (start === undefined) return [];
        const end = start + node.text.length;
        const ranges: HighlightRange[] = [];
        let cursor = 0;

        for (const segment of segments) {
          const segmentStart = cursor;
          const segmentEnd = cursor + segment.text.length;

          cursor = segmentEnd;
          if (segmentEnd <= start || segment.kind === 'plain') continue;
          if (segmentStart >= end) break;
          ranges.push({
            anchor: { path, offset: Math.max(segmentStart, start) - start },
            focus: { path, offset: Math.min(segmentEnd, end) - start },
            highlight: segment.kind,
          });
        }

        return ranges;
      },
      [offsets, segments]
    );

    const renderElement = useCallback(
      (props: RenderElementProps) => {
        if (isFormulaProp(props.element)) return <FormulaPropToken {...props} schema={schema} />;
        return (
          <div {...props.attributes} className={'min-h-6'}>
            {props.children}
          </div>
        );
      },
      [schema]
    );

    const handleKeyDown = useCallback(
      (event: KeyboardEvent<HTMLDivElement>) => {
        // Select all selects the formula, not the page.
        if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'a') {
          event.preventDefault();
          Transforms.select(editor, []);
          return;
        }

        handlersRef.current.onKeyDown(event);
        if (event.defaultPrevented) return;

        // Left/Right (and Shift+Left/Right) step over a whole token; Chrome
        // cannot place a caret inside one, so Slate's default move would lose it.
        if (
          (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
          !event.altKey &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.nativeEvent.isComposing
        ) {
          syncSelectionFromDOM();
          if (moveCaret(editor, event.key === 'ArrowLeft', event.shiftKey)) event.preventDefault();
        }
      },
      [editor, syncSelectionFromDOM]
    );

    const renderLeaf = useCallback(({ attributes, children, leaf }: RenderLeafProps) => {
      const highlight = (leaf as { highlight?: HighlightKind }).highlight;

      return (
        <span {...attributes} className={highlight ? HIGHLIGHT_CLASS[highlight] : undefined} data-highlight={highlight}>
          {children}
        </span>
      );
    }, []);

    return (
      <Slate editor={editor} initialValue={initialValue} onChange={handleChange}>
        <Editable
          data-testid={'formula-editor-input'}
          data-value={value}
          role={'textbox'}
          aria-multiline
          aria-label={ariaLabel}
          spellCheck={false}
          autoCorrect={'off'}
          autoCapitalize={'off'}
          placeholder={placeholder}
          renderPlaceholder={renderPlaceholder}
          decorate={decorate}
          renderElement={renderElement}
          renderLeaf={renderLeaf}
          onKeyDown={handleKeyDown}
          className={className}
        />
      </Slate>
    );
  })
);

function FormulaPropToken({
  attributes,
  children,
  element,
  schema,
}: RenderElementProps & { schema: FormulaFieldSchema[] }) {
  const token = element as unknown as FormulaPropElement;
  const entry = resolveFormulaField(schema, token.ref);
  const selected = useSelected();
  const focused = useFocused();

  return (
    <span
      {...attributes}
      contentEditable={false}
      data-testid={'formula-token'}
      data-highlight={'prop'}
      data-ref={token.ref}
      data-missing={entry ? undefined : 'true'}
      title={token.source}
      className={cn(
        'mx-px inline-flex max-w-full select-none items-center gap-1 rounded-[4px] px-1 align-baseline font-sans leading-5',
        entry ? 'bg-fill-secondary text-text-primary' : 'bg-fill-error-light text-text-error',
        selected && focused && 'ring-2 ring-border-theme-thick'
      )}
    >
      {entry ? <FieldTypeIcon type={entry.type} className={'h-3.5 w-3.5 shrink-0 text-icon-secondary'} /> : null}
      <span className={'truncate'}>{entry?.name ?? token.ref}</span>
      {children}
    </span>
  );
}
