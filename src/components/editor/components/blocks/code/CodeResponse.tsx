import { lazy, memo, Suspense, useMemo } from 'react';

import { BlockType, CodeBlockData } from '@/application/types';
import { StaticBlocks } from '@/components/editor/components/static/static-blocks';
import { parseMarkdown } from '@/components/editor/parsers/markdown-parser';

import './code-ai.scss';

const HighlightedCode = lazy(() => import('./HighlightedCode'));

const CLASS_NAMES = { math: 'code-response-math', table: 'code-response-table', taskList: 'task-list' };

// Reuse the document parser and mark styles without mounting a second editable
// Slate tree or applying editor transactions for every streamed response chunk.
export const CodeResponse = memo(function CodeResponse({ content }: { content: string }) {
  const blocks = useMemo(() => parseMarkdown(content), [content]);

  return (
    <div className='code-response' data-testid='code-response'>
      <StaticBlocks
        blocks={blocks}
        classNames={CLASS_NAMES}
        renderBlock={(block) =>
          block.type === BlockType.CodeBlock ? (
            <Suspense
              fallback={
                <pre>
                  <code>{block.text}</code>
                </pre>
              }
            >
              <HighlightedCode text={block.text} data={block.data as CodeBlockData} />
            </Suspense>
          ) : undefined
        }
      />
    </div>
  );
});
