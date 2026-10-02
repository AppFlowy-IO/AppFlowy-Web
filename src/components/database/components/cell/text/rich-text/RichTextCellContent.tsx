import { CSSProperties, memo, ReactNode, useMemo, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { createEditor } from 'slate';
import { Editable, RenderElementProps, Slate, withReact } from 'slate-react';

import type { RichTextDelta, RichTextInsert } from '@/application/database-yjs/fields/text/rich-text';
import { Leaf } from '@/components/editor/components/leaf/Leaf';
import { cn } from '@/lib/utils';
import { renderColor } from '@/utils/color';
import { openUrl } from '@/utils/url';

import RichTextCellContext from './RichTextCellContext';
import { richTextToSlateValue, withRichTextCellCopy } from './rich-text-slate';

/** Leaves that act on their own click (open a link or page). */
const SELF_HANDLED_CLICK_SELECTOR = ['.href-link', '[data-mention-link]', '.mention-inline[data-mention-id]'].join(',');

function lineClassName(wrap?: boolean) {
  return wrap ? 'whitespace-pre-wrap break-words' : 'truncate whitespace-nowrap';
}

function hasChips(delta: RichTextDelta) {
  return delta.some(({ attributes }) => Boolean(attributes?.mention || attributes?.formula));
}

/**
 * One run of marked text, drawn the way the document's `Leaf` draws it (same
 * elements, classes and colors), for cells without mentions or equations.
 */
function StaticRun({ insert, attributes = {} }: RichTextInsert) {
  const marks = attributes as Record<string, string | boolean | undefined>;
  const classList: string[] = [];
  const style: CSSProperties = {};
  let children: ReactNode = insert;

  if (marks.underline) children = <u>{children}</u>;
  if (marks.strikethrough) children = <s>{children}</s>;
  if (marks.italic) children = <em>{children}</em>;
  if (marks.bold) children = <strong>{children}</strong>;

  const textColor = marks.af_text_color || marks.font_color;
  const backgroundColor = marks.af_background_color || marks.bg_color;

  if (typeof textColor === 'string') {
    classList.push('text-color');
    style.color = renderColor(textColor);
  }

  if (typeof backgroundColor === 'string') {
    classList.push('bg-color');
    style.backgroundColor = renderColor(backgroundColor);
  }

  if (marks.code) {
    children = (
      <span className={cn('bg-border-primary font-medium', style.color ? undefined : 'text-[#EB5757]')}>{children}</span>
    );
  }

  const href = marks.href;

  if (typeof href === 'string' && insert.trim()) {
    children = (
      <span
        onClick={() => void openUrl(href, '_blank')}
        style={{ color: style.color || 'var(--text-action)' }}
        className={'href-link cursor-pointer select-auto py-0.5 underline'}
      >
        {children}
      </span>
    );
  }

  return (
    <span style={style} className={classList.join(' ')}>
      {children}
    </span>
  );
}

/**
 * Most formatted cells (bold, links, colors, ...) render as plain elements:
 * a grid, list or gallery can show hundreds of them, and a Slate editor per
 * cell costs listeners and work on every selection change of the page.
 */
function StaticRichText({ delta, wrap }: { delta: RichTextDelta; wrap?: boolean }) {
  return (
    <div data-rich-text-cell-line className={lineClassName(wrap)}>
      {delta.map((insert, index) => (insert.insert ? <StaticRun key={index} {...insert} /> : null))}
    </div>
  );
}

/** Mentions and equations need the document's leaf renderers, which need a Slate editor. */
function RichTextCellDocument({ delta, wrap }: { delta: RichTextDelta; wrap?: boolean }) {
  const [editor] = useState(() => withRichTextCellCopy(withReact(createEditor())));
  const initialValue = useMemo(() => richTextToSlateValue(delta), [delta]);

  const renderElement = ({ attributes, children }: RenderElementProps) => (
    <div {...attributes} data-rich-text-cell-line className={lineClassName(wrap)}>
      {children}
    </div>
  );

  return (
    <Slate editor={editor} initialValue={initialValue}>
      <Editable readOnly renderElement={renderElement} renderLeaf={Leaf} className={'outline-none'} />
    </Slate>
  );
}

/**
 * Read-only rendering of a formatted Text cell (grid, cards, list, gallery,
 * row detail, publish). Links open in a new tab and page mentions navigate,
 * without putting the cell into edit mode. Content that cannot be rendered
 * shows as the cell's plain `text`.
 */
function RichTextCellContent({
  rowId,
  delta,
  text,
  wrap,
}: {
  rowId: string;
  delta: RichTextDelta;
  text: string;
  wrap?: boolean;
}) {
  // Slate keeps its first value, so a new delta mounts a new document.
  const key = useMemo(() => JSON.stringify(delta), [delta]);
  const chips = useMemo(() => hasChips(delta), [delta]);

  return (
    <div
      data-testid={'rich-text-cell-content'}
      className={'w-full'}
      onClick={(e) => {
        // Links and link chips open their URL themselves; the click must not
        // also start editing the cell or open the row.
        if (e.target instanceof Element && e.target.closest(SELF_HANDLED_CLICK_SELECTOR)) {
          e.stopPropagation();
        }
      }}
    >
      <ErrorBoundary fallback={<div className={lineClassName(wrap)}>{text}</div>} resetKeys={[key]}>
        {chips ? (
          <RichTextCellContext rowId={rowId} readOnly>
            <RichTextCellDocument key={key} delta={delta} wrap={wrap} />
          </RichTextCellContext>
        ) : (
          <StaticRichText delta={delta} wrap={wrap} />
        )}
      </ErrorBoundary>
    </div>
  );
}

export default memo(RichTextCellContent);
