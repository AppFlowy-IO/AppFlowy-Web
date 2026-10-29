import { lazy, Suspense } from 'react';

import { applyRegisteredMarks } from '@/components/editor/components/leaf/mark-style';
import { getFontFamily } from '@/utils/font';

import type { SourceBlock } from './types';

type RichText = NonNullable<SourceBlock['richText']>;

const SourceInline = lazy(() => import('./SourceInline'));
// Snapshot runs are never mutated, so each array is serialized once rather than on every render.
const inlineKeys = new WeakMap<RichText, string>();

/** A detached editor reads its value once: remount it when the runs' content changes. */
function inlineKey(richText: RichText) {
  let key = inlineKeys.get(richText);

  if (key === undefined) {
    key = JSON.stringify(richText);
    inlineKeys.set(richText, key);
  }

  return key;
}

/** Share the editor's mark renderer so table cell colors and emphasis survive presentation. */
export default function SourceText({ block }: { block: SourceBlock }) {
  if (!block.richText) return <>{block.text}</>;
  if (block.richText.some((run) => run.mention || run.formula || run.href)) {
    return (
      <Suspense fallback={<span>{block.text}</span>}>
        <SourceInline key={inlineKey(block.richText)} block={block} />
      </Suspense>
    );
  }

  return (
    <>
      {block.richText.map((run, index) => {
        const marks = applyRegisteredMarks(run, run.text);

        if (run.font_family) marks.style.fontFamily = getFontFamily(run.font_family);

        return (
          <span key={index} className={marks.classList.join(' ')} style={marks.style}>
            {marks.children}
          </span>
        );
      })}
    </>
  );
}
