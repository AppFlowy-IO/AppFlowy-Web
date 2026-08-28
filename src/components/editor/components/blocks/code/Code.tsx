import { forwardRef, lazy, Suspense, useState } from 'react';
import { Element } from 'slate';
import { ReactEditor, useReadOnly, useSlateStatic } from 'slate-react';

import { useCodeBlock } from '@/components/editor/components/blocks/code/Code.hooks';
import { CodeNode, EditorElementProps } from '@/components/editor/editor.type';

import CodeToolbar from './CodeToolbar';
import LanguageSelect from './SelectLanguage';

const MermaidChat = lazy(() => import('./MermaidChat'));

export const CodeBlock = forwardRef<HTMLDivElement, EditorElementProps<CodeNode>>(
  ({ node, children, ...attributes }, ref) => {
    const { language, handleChangeLanguage } = useCodeBlock(node);
    const [showToolbar, setShowToolbar] = useState(false);
    const isMermaid = language === 'mermaid';

    const editor = useSlateStatic();
    const readOnly = useReadOnly() || editor.isElementReadOnly(node as unknown as Element);

    return (
      <div
        className={'relative my-0.5 w-full'}
        onMouseEnter={() => {
          setShowToolbar(true);
        }}
        onMouseLeave={() => setShowToolbar(false)}
      >
        {
          <div
            contentEditable={false}
            style={{
              visibility: showToolbar ? 'visible' : 'hidden',
            }}
            className={'absolute flex h-12 w-full select-none items-center px-2'}
          >
            <LanguageSelect
              readOnly={readOnly}
              language={language}
              onChangeLanguage={handleChangeLanguage}
              onClose={() => {
                window.getSelection()?.removeAllRanges();
                ReactEditor.focus(editor);
                const path = ReactEditor.findPath(editor, node);

                editor.select(editor.start(path));
              }}
            />
          </div>
        }

        <div {...attributes} ref={ref} className={`${attributes.className ?? ''} flex w-full`}>
          <pre
            spellCheck={false}
            className={`appflowy-scroller relative flex w-full flex-col overflow-auto rounded-[8px] border border-border-primary bg-fill-list-active p-5 pt-12`}
          >
            <code
              className={
                isMermaid
                  ? 'pointer-events-none absolute h-px w-px overflow-hidden opacity-0'
                  : undefined
              }
            >
              {children}
            </code>
            {isMermaid && (
              <Suspense>
                <MermaidChat node={node} />
              </Suspense>
            )}
          </pre>
        </div>

        {showToolbar && <CodeToolbar node={node} />}
      </div>
    );
  }
);
export default CodeBlock;
