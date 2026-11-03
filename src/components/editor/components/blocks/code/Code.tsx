import { PopoverOrigin } from '@mui/material';
import TextareaAutosize from '@mui/material/TextareaAutosize';
import { forwardRef, lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Editor, Node, Transforms } from 'slate';
import { ReactEditor, useReadOnly, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { YHistoryEditor } from '@/application/slate-yjs/plugins/withHistory';
import { CodeAIAction, usePopoverContext } from '@/components/editor/components/block-popover/BlockPopoverContext';
import { CodeNode, EditorElementProps } from '@/components/editor/editor.type';
import { useEditorLocalState } from '@/components/editor/EditorContext';

import { pointAt } from './code-keyboard';
import { useCodeBlock } from './Code.hooks';
import { CodeLiteralContext } from './CodeLiteralContext';
import { CodeMenu, CodeMenuView } from './CodeMenu';
import CodeToolbar from './CodeToolbar';
import { codeLanguageLabel } from './constants';
import './code.scss';

const MermaidPreview = lazy(() => import('./MermaidPreview'));
const CodeAI = lazy(() => import('./CodeAI'));

const menuOrigins: Partial<Record<CodeMenuView, { anchorOrigin: PopoverOrigin; transformOrigin: PopoverOrigin }>> = {
  language: {
    anchorOrigin: { vertical: 'bottom', horizontal: 'left' },
    transformOrigin: { vertical: -4, horizontal: 'left' },
  },
  display: {
    anchorOrigin: { vertical: 'bottom', horizontal: 'center' },
    transformOrigin: { vertical: 'top', horizontal: 'center' },
  },
};

export const CodeBlock = forwardRef<HTMLDivElement, EditorElementProps<CodeNode>>(
  ({ node, children, className, ...attributes }, ref) => {
    const { language } = useCodeBlock(node);
    const editor = useSlateStatic() as YjsEditor;
    const readOnly = useReadOnly() || editor.isElementReadOnly(node);
    const { t } = useTranslation();
    const [menu, setMenu] = useState<{ view: CodeMenuView; anchor: HTMLElement }>();
    const { selectedBlockIds, setSelectedBlockIds } = useEditorLocalState();
    const { codeBlockAction, closeCodeBlockAction } = usePopoverContext();
    const action = codeBlockAction?.blockId === node.blockId ? codeBlockAction : undefined;
    const caption = useRef<HTMLTextAreaElement>(null);
    const showCaption = (node.data.caption !== null && node.data.caption !== undefined) || action?.action === 'caption';
    const isMermaid = language === 'mermaid';
    const mode = node.data.mermaid_display_mode ?? 'split';
    const isAI = action && !['caption', 'expand'].includes(action.action);
    const selected = selectedBlockIds?.includes(node.blockId);

    useEffect(() => {
      if (action?.action === 'caption' && !readOnly) caption.current?.focus();
    }, [action, readOnly]);

    const openMenu = (view: CodeMenuView, anchor: HTMLElement) => {
      if (readOnly) return;
      setMenu({ view, anchor });
      if (view === 'main') setSelectedBlockIds?.([node.blockId]);
    };

    const closeMenu = () => {
      setMenu(undefined);
      setSelectedBlockIds?.([]);
    };

    return (
      <div
        {...attributes}
        ref={ref}
        className={`${className ?? ''} code-block relative my-0.5 w-full min-w-0`}
        data-menu-open={!!menu}
        data-selected={!!selected}
        data-language={language}
      >
        <div className='code-block-surface'>
          <div contentEditable={false} className='code-block-header'>
            <button
              type='button'
              className='code-language-trigger'
              data-pinned={!!node.data.pin_language}
              disabled={readOnly}
              aria-label={`${t('document.plugins.codeBlock.language', {
                defaultValue: 'Language',
              })}: ${codeLanguageLabel(language)}`}
              onClick={(event) => openMenu('language', event.currentTarget)}
            >
              {codeLanguageLabel(language)}
            </button>
          </div>
          <div className='code-block-body'>
            <pre
              spellCheck={false}
              onMouseDown={(event) => {
                if (event.detail >= 3) {
                  event.preventDefault();
                  event.stopPropagation();
                }
              }}
              onClick={(event) => {
                if (event.detail < 3) return;
                event.preventDefault();
                event.stopPropagation();
                const path = ReactEditor.findPath(editor, node).concat(0);

                if (event.detail >= 4) {
                  Transforms.select(editor, Editor.range(editor, path));
                  return;
                }

                const range = ReactEditor.findEventRange(editor, event);
                const text = Node.string(node);
                const offset = Editor.string(editor, { anchor: Editor.start(editor, path), focus: range.focus }).length;
                const start = offset === 0 ? 0 : text.lastIndexOf('\n', offset - 1) + 1;
                const end = text.indexOf('\n', offset);

                Transforms.select(editor, {
                  anchor: pointAt(editor, path, start),
                  focus: pointAt(editor, path, end < 0 ? text.length : end),
                });
              }}
              className={`code-block-source appflowy-scroller ${node.data.wrap_code ? 'is-wrapped' : ''} ${
                isMermaid && mode === 'preview' ? 'code-source-hidden' : ''
              }`}
            >
              <code>
                <CodeLiteralContext.Provider value>{children}</CodeLiteralContext.Provider>
              </code>
            </pre>
            {isMermaid && (mode !== 'code' || action?.action === 'expand') && (
              <Suspense
                fallback={
                  <div contentEditable={false} role='status'>
                    {t('document.plugins.codeBlock.rendering', { defaultValue: 'Rendering diagram…' })}
                  </div>
                }
              >
                <MermaidPreview
                  source={Node.string(node)}
                  expanded={action?.action === 'expand'}
                  showPreview={mode !== 'code'}
                  onClose={() => closeCodeBlockAction?.()}
                />
              </Suspense>
            )}
          </div>
          <CodeToolbar node={node} readOnly={readOnly} onOpen={openMenu} />
        </div>
        {showCaption && (
          <TextareaAutosize
            ref={caption}
            contentEditable={false}
            readOnly={readOnly}
            minRows={1}
            className='code-block-caption'
            aria-label={t('document.plugins.codeBlock.caption', { defaultValue: 'Caption' })}
            placeholder={t('document.plugins.codeBlock.captionPlaceholder', { defaultValue: 'Write a caption…' })}
            value={node.data.caption ?? ''}
            onChange={(event) => {
              if (!readOnly && !editor.readOnly)
                CustomEditor.setBlockData(editor, node.blockId, { caption: event.target.value });
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.nativeEvent.isComposing || readOnly || editor.readOnly) return;
              if (
                event.key === 'Backspace' &&
                event.currentTarget.selectionStart === 0 &&
                event.currentTarget.selectionEnd === 0
              ) {
                event.preventDefault();
                const text = event.currentTarget.value;
                const path = ReactEditor.findPath(editor, node).concat(0);

                // Flutter joins a caption at its start without discarding any remaining text.
                // Keep the join separate from caption typing and subsequent code edits in undo.
                editor.flushLocalChanges();
                if (YHistoryEditor.isYHistoryEditor(editor)) editor.undoManager.stopCapturing();
                Editor.withoutNormalizing(editor, () => {
                  CustomEditor.setBlockData(editor, node.blockId, {
                    caption: null,
                    ...(isMermaid && mode === 'preview' ? { mermaid_display_mode: 'split' } : {}),
                  });
                  if (text) Transforms.insertText(editor, text, { at: Editor.end(editor, path) });
                  Transforms.select(editor, Editor.end(editor, path));
                });
                editor.flushLocalChanges();
                if (YHistoryEditor.isYHistoryEditor(editor)) editor.undoManager.stopCapturing();
                if (action?.action === 'caption') closeCodeBlockAction?.();
                ReactEditor.focus(editor);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                event.currentTarget.blur();
                closeCodeBlockAction?.();
              }
            }}
            onClick={(event) => event.stopPropagation()}
          />
        )}
        {menu && !readOnly && (
          <CodeMenu
            node={node}
            view={menu.view}
            anchorEl={menu.anchor}
            onClose={closeMenu}
            anchorOrigin={menuOrigins[menu.view]?.anchorOrigin}
            transformOrigin={menuOrigins[menu.view]?.transformOrigin}
          />
        )}
        {isAI && !readOnly && (
          <Suspense>
            <CodeAI
              key={action.requestId}
              node={node}
              action={action.action as CodeAIAction}
              onClose={() => closeCodeBlockAction?.()}
            />
          </Suspense>
        )}
      </div>
    );
  }
);
CodeBlock.displayName = 'CodeBlock';
export default CodeBlock;
