import { ClipboardEvent, memo, ReactNode, Suspense, useMemo } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

import {
  type RichTextDelta,
  type RichTextInsert,
  sanitizeRichTextAttributes,
} from '@/application/database-yjs/fields/text/rich-text';
import { applyRegisteredMarks } from '@/components/editor/components/leaf/mark-style';
import { openUrl } from '@/utils/url';

import { RichTextCellDocument } from './load';

/** Leaves that act on their own click (open a link or page). */
const SELF_HANDLED_CLICK_SELECTOR = ['.href-link', '[data-mention-link]', '.mention-inline[data-mention-id]'].join(',');

function lineClassName(wrap?: boolean) {
  return wrap ? 'whitespace-pre-wrap break-words' : 'truncate whitespace-nowrap';
}

function hasChips(delta: RichTextDelta) {
  return delta.some(({ attributes }) => Boolean(attributes?.mention || attributes?.formula));
}

/**
 * One run of marked text, drawn with the document's `Leaf` mark mapping
 * (same elements, classes and colors), for cells without mentions or
 * equations. Only registered attributes reach it: preserved ones are never
 * rendered (rich text spec R13).
 */
function StaticRun({ insert, attributes = {} }: RichTextInsert) {
  const marks = applyRegisteredMarks(attributes, insert);
  let children: ReactNode = marks.children;
  const href = attributes.href;

  if (typeof href === 'string' && insert.trim()) {
    children = (
      <span
        onClick={() => void openUrl(href, '_blank')}
        style={{ color: marks.style.color || 'var(--text-action)' }}
        className={'href-link cursor-pointer select-auto py-0.5 underline'}
      >
        {children}
      </span>
    );
  }

  return (
    <span style={marks.style} className={marks.classList.join(' ')}>
      {children}
    </span>
  );
}

function copyStaticRichText(event: ClipboardEvent<HTMLDivElement>, delta: RichTextDelta) {
  const root = event.currentTarget;
  const document = root.ownerDocument;
  const selection = document.getSelection();

  if (event.defaultPrevented || !selection || selection.isCollapsed || selection.rangeCount !== 1) return;
  const range = selection.getRangeAt(0);

  // Let the browser copy selections spanning other cells or surrounding text.
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return;
  const prefix = document.createRange();

  prefix.selectNodeContents(root);
  prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length;
  const end = start + range.toString().length;
  let offset = 0;
  const texts = delta.flatMap(({ insert, attributes }) => {
    const runStart = offset;

    offset += insert.length;
    if (offset <= start || runStart >= end) return [];
    return [
      {
        ...sanitizeRichTextAttributes(attributes),
        text: insert.slice(Math.max(0, start - runStart), end - runStart),
      },
    ];
  });

  if (texts.length === 0) return;
  // Match the document-compatible shape used by cell editors, without loading
  // Slate or adding selection listeners to every static cell in a grid.
  const fragment = [{ type: 'paragraph', data: {}, children: [{ type: 'text', children: texts }] }];
  const encoded = window.btoa(encodeURIComponent(JSON.stringify(fragment)));
  const html = document.createElement('span');

  html.setAttribute('data-slate-fragment', encoded);
  html.append(range.cloneContents());
  event.clipboardData.setData('application/x-slate-fragment', encoded);
  event.clipboardData.setData('text/html', html.outerHTML);
  event.clipboardData.setData('text/plain', texts.map(({ text }) => text).join(''));
  event.preventDefault();
  event.stopPropagation();
}

/**
 * Most formatted cells (bold, links, colors, ...) render as plain elements:
 * a grid, list or gallery can show hundreds of them, and a Slate editor per
 * cell costs listeners and work on every selection change of the page. They
 * also need no code beyond this module, so they show at once instead of
 * waiting for the chip renderers to load.
 */
function StaticRichText({ delta, wrap }: { delta: RichTextDelta; wrap?: boolean }) {
  return (
    <div data-rich-text-cell-line className={lineClassName(wrap)} onCopy={(event) => copyStaticRichText(event, delta)}>
      {delta.map((insert, index) => (insert.insert ? <StaticRun key={index} {...insert} /> : null))}
    </div>
  );
}

/**
 * Read-only rendering of a formatted Text cell (grid, cards, list, gallery,
 * row detail, publish). Links open in a new tab and page mentions navigate,
 * without putting the cell into edit mode. Mentions and equations are drawn
 * by the document's leaf renderers, which load on first use; until they have,
 * and for content that cannot be rendered (or renderers that cannot be
 * loaded), the cell shows its plain `text`.
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
  const plainText = <div className={lineClassName(wrap)}>{text}</div>;

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
      <ErrorBoundary fallback={plainText} resetKeys={[key]}>
        {chips ? (
          <Suspense fallback={plainText}>
            <RichTextCellDocument key={key} rowId={rowId} delta={delta} lineClassName={lineClassName(wrap)} />
          </Suspense>
        ) : (
          <StaticRichText delta={delta} wrap={wrap} />
        )}
      </ErrorBoundary>
    </div>
  );
}

export default memo(RichTextCellContent);
