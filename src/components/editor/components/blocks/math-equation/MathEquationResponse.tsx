import { Fragment, memo, Suspense, useMemo } from 'react';

import { BlockType } from '@/application/types';
import { KatexMath } from '@/components/_shared/katex-math';
import { applyRegisteredMarks } from '@/components/editor/components/leaf/mark-style';
import { parsedBlockToTextNodes } from '@/components/editor/parsers/parsed-block-to-slate';
import { ParsedBlock } from '@/components/editor/parsers/types';

import { parseEquationResponse } from './math-equation-ai';
import './math-equation-ai.scss';

function safeHref(href: string) {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(href, 'https://appflowy.io').protocol) ? href : undefined;
  } catch {
    return undefined;
  }
}

function InlineContent({ block }: { block: ParsedBlock }) {
  return (
    <>
      {parsedBlockToTextNodes(block).map((leaf, index) => {
        const content = leaf.formula ? (
          <Suspense fallback={leaf.formula}>
            <KatexMath latex={leaf.formula} isInline />
          </Suspense>
        ) : (
          leaf.text
        );
        const marks = applyRegisteredMarks(leaf, content, { inlineObject: Boolean(leaf.formula) });
        const href = leaf.href ? safeHref(leaf.href) : undefined;
        const text = (
          <span className={marks.classList.join(' ')} style={marks.style}>
            {marks.children}
          </span>
        );

        return href ? (
          <a key={index} href={href} target='_blank' rel='noopener noreferrer'>
            {text}
          </a>
        ) : (
          <Fragment key={index}>{text}</Fragment>
        );
      })}
    </>
  );
}

const listTypes = new Set([BlockType.BulletedListBlock, BlockType.NumberedListBlock, BlockType.TodoListBlock]);

function ResponseBlocks({ blocks }: { blocks: ParsedBlock[] }) {
  const groups: ParsedBlock[][] = [];

  for (const block of blocks) {
    const previous = groups[groups.length - 1];

    if (listTypes.has(block.type) && previous?.[0].type === block.type) previous.push(block);
    else groups.push([block]);
  }

  return (
    <>
      {groups.map((group, index) => {
        const block = group[0];

        if (listTypes.has(block.type)) {
          const items = group.map((item, itemIndex) => (
            <li key={itemIndex} value={(item.data as { number?: number }).number}>
              {item.type === BlockType.TodoListBlock && (
                <input type='checkbox' checked={Boolean((item.data as { checked?: boolean }).checked)} disabled />
              )}
              <InlineContent block={item} />
              {item.children.length > 0 && <ResponseBlocks blocks={item.children} />}
            </li>
          ));

          return block.type === BlockType.NumberedListBlock ? (
            <ol key={index}>{items}</ol>
          ) : (
            <ul key={index} className={block.type === BlockType.TodoListBlock ? 'task-list' : undefined}>
              {items}
            </ul>
          );
        }

        return <ResponseBlock key={index} block={block} />;
      })}
    </>
  );
}

function ResponseBlock({ block }: { block: ParsedBlock }) {
  switch (block.type) {
    case BlockType.EquationBlock: {
      const latex = (block.data as { formula: string }).formula;

      return (
        <div className='equation-response-math'>
          <Suspense fallback={latex}>
            <KatexMath latex={latex} />
          </Suspense>
        </div>
      );
    }

    case BlockType.HeadingBlock: {
      const level = Math.min(6, Math.max(1, (block.data as { level: number }).level));
      const Heading = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

      return (
        <Heading>
          <InlineContent block={block} />
        </Heading>
      );
    }

    case BlockType.CodeBlock:
      return (
        <pre>
          <code>{block.text}</code>
        </pre>
      );
    case BlockType.QuoteBlock:
      return (
        <blockquote>
          <InlineContent block={block} />
        </blockquote>
      );
    case BlockType.DividerBlock:
      return <hr />;
    case BlockType.SimpleTableBlock:
      return (
        <div className='equation-response-table'>
          <table>
            <tbody>
              {block.children.map((row, index) => (
                <tr key={index}>
                  {row.children.map((cell, cellIndex) => {
                    const Cell = (cell.data as { isHeader?: boolean }).isHeader ? 'th' : 'td';

                    return (
                      <Cell key={cellIndex}>
                        <ResponseBlocks blocks={cell.children} />
                      </Cell>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return (
        <p>
          <InlineContent block={block} />
        </p>
      );
  }
}

// Reuse the document parser and mark styles without mounting a second editable
// Slate tree or applying editor transactions for every streamed response chunk.
export const MathEquationResponse = memo(function MathEquationResponse({ content }: { content: string }) {
  const blocks = useMemo(() => parseEquationResponse(content), [content]);

  return (
    <div className='math-equation-response' data-testid='math-equation-response'>
      <ResponseBlocks blocks={blocks} />
    </div>
  );
});
