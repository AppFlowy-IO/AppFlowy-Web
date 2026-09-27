import {
  DragEvent,
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
import { BaseRange, createEditor, Descendant, Editor, NodeEntry, Range, RangeRef, Text, Transforms } from 'slate';
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

import {
  FormulaFieldSchema,
  resolveFormulaField,
  toDisplayExpression,
  toStorageExpression,
} from '@/application/database-yjs/fields/formula';
import { cn } from '@/lib/utils';

import { formulaBoundVariables, formulaPasteContext, normalizePastedFormula } from './formula-paste';
import {
  editorSource,
  ejectCaretFromToken,
  FormulaPropElement,
  isFormulaProp,
  moveCaret,
  offsetToPoint,
  rebindTextCalls,
  rebindTokens,
  remapOffset,
  replaceSourceRange,
  resetSource,
  selectionOffsets,
  sourceToNodes,
  textOffsets,
  tokenRangeAt,
  withFormulaTokens,
} from './formula-slate';
import { FormulaPropChip } from './FormulaPropChip';
import { HIGHLIGHT_CLASS, HighlightKind, highlightFormula } from './highlight';

export interface FormulaSourceInputHandle {
  /** Replaces `[start, end)` of the formula and puts the caret `caretOffset` into the new text. */
  replaceRange: (start: number, end: number, text: string, caretOffset: number) => void;
  /** Inserts at the selection (replacing it); `caretOffset` is relative to the insertion. */
  insert: (text: string, caretOffset: number) => void;
  /** The selection as offsets into the formula source. */
  selection: () => { start: number; end: number } | null;
}

/**
 * Why the source changed: the user edited it, or its tokens were rewritten
 * for properties a collaborator renamed or deleted.
 */
export type FormulaSourceChange = 'edit' | 'rebind';

interface FormulaSourceInputProps {
  /** Formula source in display form. */
  value: string;
  onChange: (value: string, change: FormulaSourceChange) => void;
  /** Collapsed caret (or selection focus) as an offset into the source. */
  onCaretChange: (caret: number) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  schema: FormulaFieldSchema[];
  /**
   * The database the properties belong to. Tokens copied here paste back as
   * the properties they showed, even after one is renamed or its name reused;
   * elsewhere they paste by name.
   */
  clipboardScope?: string;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}

type HighlightRange = BaseRange & { highlight: HighlightKind };

const EDITABLE_STYLE = { minHeight: undefined };

// Slate pins the placeholder to the top of the editable's padding box; `top:
// auto` keeps it where the caret is, inside the padding.
function renderPlaceholder({ attributes, children }: RenderPlaceholderProps) {
  return (
    <span
      {...attributes}
      style={{ ...attributes.style, top: 'auto', width: 'auto' }}
      className={'text-text-tertiary !opacity-100'}
    >
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
    { value, onChange, onCaretChange, onKeyDown, schema, clipboardScope, placeholder, ariaLabel, className },
    ref
  ) {
    // The host recreates its handlers on most renders; reading them through a
    // ref keeps this component's own callbacks stable so memo can skip renders.
    const handlersRef = useRef({ onChange, onCaretChange, onKeyDown });

    useLayoutEffect(() => {
      handlersRef.current = { onChange, onCaretChange, onKeyDown };
    });

    // Pasted text is read against the current properties, which change while the editor is open.
    const schemaRef = useRef(schema);
    const clipboardScopeRef = useRef(clipboardScope);

    useLayoutEffect(() => {
      schemaRef.current = schema;
      clipboardScopeRef.current = clipboardScope;
    });
    // The properties the document's tokens, and those in its undo history, name.
    const boundSchemaRef = useRef(schema);
    const [editor] = useState(() =>
      withFormulaTokens(
        withReact(withHistory(createEditor())),
        (text, { before, after }) =>
          normalizePastedFormula(
            text,
            schemaRef.current.map((entry) => entry.name),
            {
              // Pasted into a string or a comment, the text stays as it is;
              // in code, the character before it can change how it reads.
              context: formulaPasteContext(before),
              // Variables a let() around the paste binds are not properties.
              reservedWords: formulaBoundVariables(before + text + after),
            }
          ),
        {
          scope: () => clipboardScopeRef.current,
          // A copied token keeps its property's id and pastes named for the
          // properties as they are then, like the tokens rebound below.
          bind: (source) => toStorageExpression(source, boundSchemaRef.current),
          unbind: (bound) => toDisplayExpression(bound, boundSchemaRef.current),
        }
      )
    );
    const [initialValue] = useState<Descendant[]>(() => sourceToNodes(value));
    // The source the document currently serializes to; a different `value`
    // prop means the formula was replaced from outside.
    const sourceRef = useRef(value);
    const [children, setChildren] = useState(initialValue);

    // Update the document before paint, so the new source's highlighting is
    // never drawn over the old document.
    useLayoutEffect(() => {
      const boundSchema = boundSchemaRef.current;
      let rebind: ((source: string) => string) | null = null;
      let rebound = false;
      // The draft as the host rewrites it for the current properties.
      let hostRebound = sourceRef.current;

      if (schema !== boundSchema) {
        boundSchemaRef.current = schema;
        // Renamed or deleted properties: rewrite the tokens in place, the way
        // the host rewrites the draft, so the caret and an IME composition
        // stay put. History is rewritten too, so undo restores the property an
        // edit read. Names resolve against the properties they were written
        // for, before a rename or deletion let another property take them.
        rebind = (source: string) => toDisplayExpression(toStorageExpression(source, boundSchema), schema);
        rebound = rebindTokens(editor, rebind);
        hostRebound = rebind(sourceRef.current);
      }

      if (value === sourceRef.current && !rebound) return;
      const current = editorSource(editor);
      const caret = selectionOffsets(editor)?.end;

      // The host reads references off the draft's text, which stops reading a
      // token as one after a string or comment the user has not closed yet;
      // then its rewrite leaves that token naming what may now be another
      // property. The tokens are what the user sees: keep their rewrite, with
      // its history, and hand it to the host.
      if (rebind && rebound && value === hostRebound && value !== current) {
        // The host's rewrite also covers calls the editor keeps as text, e.g.
        // one split over lines; those follow the host.
        const merged = rebindTextCalls(editor, rebind);

        if (merged === current) {
          sourceRef.current = current;
          setChildren(editor.children);
          handlersRef.current.onChange(current, 'rebind');
          return;
        }

        // Both kinds changed: start over from the tokens' rewrite with the
        // host's rewrite of the text calls.
        if (merged !== value) {
          resetSource(editor, merged, caret === undefined ? undefined : remapOffset(current, merged, caret));
          sourceRef.current = merged;
          setChildren(editor.children);
          handlersRef.current.onChange(merged, 'rebind');
          return;
        }
      }

      // Anything else replaced the formula: start over, keeping the caret in
      // the text around the change.
      if (value !== current) {
        resetSource(editor, value, caret === undefined ? undefined : remapOffset(current, value, caret));
      }

      sourceRef.current = value;
      setChildren(editor.children);
    }, [editor, schema, value]);

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
          handlersRef.current.onChange(next, 'edit');
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

    // A drag this input started from a token: the source it carries and where that sits.
    const tokenDragRef = useRef<{ text: string; range: RangeRef } | null>(null);
    const endTokenDrag = useCallback(() => {
      tokenDragRef.current?.range.unref();
      tokenDragRef.current = null;
    }, []);

    // Slate turns a drag that starts on a token into a caret inside it, which
    // carries no source and makes the drop delete what follows the token.
    // Start such a drag here instead: it carries the selection holding the
    // token, or else the token alone.
    const handleDragStart = useCallback(
      (event: DragEvent<HTMLDivElement>) => {
        endTokenDrag();
        const token = tokenAtTarget(editor, event.target);

        if (!token) return false;
        const { selection } = editor;
        const selected = selection && Range.isExpanded(selection) ? selectionOffsets(editor) : null;
        const dragged =
          selection && selected && selected.start <= token.start && token.end <= selected.end
            ? selection
            : { anchor: offsetToPoint(editor, token.start), focus: offsetToPoint(editor, token.end) };

        Transforms.select(editor, dragged);
        ReactEditor.setFragmentData(editor, event.dataTransfer, 'drag');
        tokenDragRef.current = { text: event.dataTransfer.getData('text/plain'), range: Editor.rangeRef(editor, dragged) };
        return true;
      },
      [editor, endTokenDrag]
    );

    // Drops a token drag started here as a move, the way Slate drops its own drags.
    const handleDrop = useCallback(
      (event: DragEvent<HTMLDivElement>) => {
        const drag = tokenDragRef.current;
        const dragged = drag?.range.current;

        endTokenDrag();
        if (!drag || event.dataTransfer.getData('text/plain') !== drag.text) return false;
        event.preventDefault();
        let at: Range;

        try {
          at = ReactEditor.findEventRange(editor, event);
        } catch {
          return true;
        }

        Transforms.select(editor, at);
        if (dragged && !Range.equals(dragged, at) && !Editor.void(editor, { at, voids: true })) {
          Transforms.delete(editor, { at: dragged });
        }

        ReactEditor.insertData(editor, event.dataTransfer);
        if (!ReactEditor.isFocused(editor)) ReactEditor.focus(editor);
        return true;
      },
      [editor, endTokenDrag]
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
          onDragStart={handleDragStart}
          onDrop={handleDrop}
          // Slate reports the end of a drag only for its own drags.
          onDragEndCapture={endTokenDrag}
          className={className}
          // Slate sizes an empty editor to its placeholder with an inline
          // min-height; dropping it lets the host's min height apply, so the
          // box does not jump when the first character is typed.
          style={EDITABLE_STYLE}
        />
      </Slate>
    );
  })
);

/** The source range of the token a DOM event happened on, or null. */
function tokenAtTarget(editor: ReactEditor, target: EventTarget | null): { start: number; end: number } | null {
  if (!ReactEditor.hasTarget(editor, target)) return null;
  try {
    return tokenRangeAt(editor, ReactEditor.findPath(editor, ReactEditor.toSlateNode(editor, target)));
  } catch {
    return null;
  }
}

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
    <FormulaPropChip
      {...attributes}
      contentEditable={false}
      data-testid={'formula-token'}
      data-ref={token.ref}
      title={token.source}
      entry={entry}
      reference={token.ref}
      className={cn(selected && focused && 'ring-2 ring-border-theme-thick')}
    >
      {children}
    </FormulaPropChip>
  );
}
