import { lazy, Suspense } from 'react';

import { applyRegisteredMarks } from '@/components/editor/components/leaf/mark-style';
import { getFontFamily } from '@/utils/font';

import type { SourceBlock } from './types';

const SourceInline = lazy(() => import('./SourceInline'));

/** Share the editor's mark renderer so table cell colors and emphasis survive presentation. */
export default function SourceText({ block }: { block: SourceBlock }) {
  if (!block.richText) return <>{block.text}</>;
  if (block.richText.some((run) => run.mention || run.formula || run.href)) {
    return (
      <Suspense fallback={<span>{block.text}</span>}>
        <SourceInline key={JSON.stringify(block.richText)} block={block} />
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
