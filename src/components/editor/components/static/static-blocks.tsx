import { Fragment, ReactNode, Suspense } from 'react';

import { BlockType, ImageBlockData } from '@/application/types';
import { KatexMath } from '@/components/_shared/katex-math';
import { applyRegisteredMarks, RegisteredMarks } from '@/components/editor/components/leaf/mark-style';
import { parsedBlockToTextNodes } from '@/components/editor/parsers/parsed-block-to-slate';
import type { ParsedBlock } from '@/components/editor/parsers/types';

type StaticLeaf = RegisteredMarks & { text: string; href?: unknown; formula?: unknown };

/** Links keep to web schemes so a model cannot place a `javascript:` URL in a response. */
export function safeHref(href: string): string | undefined {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(href, 'https://appflowy.io').protocol) ? href : undefined;
  } catch {
    return undefined;
  }
}

/** The rich text of one parsed block: the editor's marks, inline TeX and safe links. */
export function InlineContent({ block }: { block: ParsedBlock }) {
  const leaves = parsedBlockToTextNodes(block) as StaticLeaf[];

  return (
    <>
      {leaves.map((leaf, index) => {
        const formula = typeof leaf.formula === 'string' ? leaf.formula : undefined;
        const content = formula ? (
          <Suspense fallback={formula}>
            <KatexMath latex={formula} isInline />
          </Suspense>
        ) : (
          leaf.text
        );
        const marks = applyRegisteredMarks(leaf, content, { inlineObject: Boolean(formula) });
        const href = typeof leaf.href === 'string' ? safeHref(leaf.href) : undefined;
        const text = (
          <span className={marks.classList.join(' ') || undefined} style={marks.style}>
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

const LIST_TYPES = new Set<BlockType>([
  BlockType.BulletedListBlock,
  BlockType.NumberedListBlock,
  BlockType.TodoListBlock,
]);

/** Consecutive list items of one kind are siblings from the parser and one list on screen. */
export function groupBlocks(blocks: ParsedBlock[]): ParsedBlock[][] {
  const groups: ParsedBlock[][] = [];

  for (const block of blocks) {
    const previous = groups[groups.length - 1];

    if (LIST_TYPES.has(block.type) && previous?.[0].type === block.type) previous.push(block);
    else groups.push([block]);
  }

  return groups;
}

export interface StaticBlockClassNames {
  /** Wrapper of a display equation. */
  math?: string;
  /** Scroll container of a table. */
  table?: string;
  /** Applied to the `ul` of a task list. */
  taskList?: string;
}

export interface StaticBlocksProps {
  blocks: ParsedBlock[];
  classNames?: StaticBlockClassNames;
  /**
   * Replaces the default rendering of one block. Return `undefined` to keep the
   * default, so consumers override only the blocks they care about.
   */
  renderBlock?: (block: ParsedBlock) => ReactNode | undefined;
}

/**
 * Renders parsed Markdown blocks statically, without an editor. The document
 * parser produces the blocks, so every consumer (AI responses in code and
 * equation blocks, chat answers) shows the same structure and marks.
 */
export function StaticBlocks({ blocks, classNames, renderBlock }: StaticBlocksProps) {
  return (
    <>
      {groupBlocks(blocks).map((group, index) =>
        LIST_TYPES.has(group[0].type) ? (
          <ListGroup key={index} items={group} classNames={classNames} renderBlock={renderBlock} />
        ) : (
          <StaticBlock key={index} block={group[0]} classNames={classNames} renderBlock={renderBlock} />
        )
      )}
    </>
  );
}

type BlockProps = Omit<StaticBlocksProps, 'blocks'>;

function ListGroup({ items, ...rest }: BlockProps & { items: ParsedBlock[] }) {
  const type = items[0].type;
  const children = items.map((item, index) => (
    <li key={index} value={type === BlockType.NumberedListBlock ? (item.data as { number?: number }).number : undefined}>
      {type === BlockType.TodoListBlock ? (
        <input type='checkbox' checked={Boolean((item.data as { checked?: boolean }).checked)} readOnly />
      ) : null}
      <InlineContent block={item} />
      {item.children.length > 0 ? <StaticBlocks blocks={item.children} {...rest} /> : null}
    </li>
  ));

  if (type === BlockType.NumberedListBlock) return <ol>{children}</ol>;

  return <ul className={type === BlockType.TodoListBlock ? rest.classNames?.taskList : undefined}>{children}</ul>;
}

function StaticBlock({ block, classNames, renderBlock }: BlockProps & { block: ParsedBlock }) {
  const custom = renderBlock?.(block);

  if (custom !== undefined) return <>{custom}</>;

  switch (block.type) {
    case BlockType.EquationBlock: {
      const latex = (block.data as { formula?: string }).formula ?? '';

      return (
        <div className={classNames?.math}>
          <Suspense fallback={<code>{latex}</code>}>
            <KatexMath latex={latex} />
          </Suspense>
        </div>
      );
    }

    case BlockType.HeadingBlock: {
      const level = Math.min(6, Math.max(1, (block.data as { level?: number }).level || 1));
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

    case BlockType.ImageBlock: {
      const url = (block.data as ImageBlockData).url;
      const src = url ? safeHref(url) : undefined;

      return src ? <img src={src} alt='' /> : null;
    }

    case BlockType.SimpleTableBlock:
      return (
        <div className={classNames?.table}>
          <table>
            <tbody>
              {block.children.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.children.map((cell, cellIndex) => {
                    const Cell = (cell.data as { isHeader?: boolean }).isHeader ? 'th' : 'td';

                    return (
                      <Cell key={cellIndex}>
                        <StaticBlocks blocks={cell.children} classNames={classNames} renderBlock={renderBlock} />
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
