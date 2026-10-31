import { splitDocument, type DocumentSlide } from './source';

import type { PageSnapshot, SourceBlock } from './types';

export const meetingMeasureKey = (section: number) => `meeting:${section}`;

/** Meeting presentations always show the summary, independently of the editor's selected tab. */
export function presentedChildren(block: SourceBlock): SourceBlock[] {
  return block.type === 'ai_meeting'
    ? block.children.filter((child) => child.type === 'ai_meeting_summary')
    : block.children;
}

/** Summary children are pagination units, so lists and headings keep their normal slide rules. */
export function presentationSections(snapshot: PageSnapshot): DocumentSlide[] {
  return splitDocument(snapshot).flatMap((section) => {
    if (section.titleSlide) return [section];
    const sections: DocumentSlide[] = [];
    let blocks: SourceBlock[] = [];
    const flush = () => {
      if (blocks.length) sections.push({ ...section, blocks });
      blocks = [];
    };

    for (const block of section.blocks) {
      if (block.type !== 'ai_meeting') {
        blocks.push(block);
        continue;
      }

      flush();
      const summary = presentedChildren(block).flatMap((part) => [
        ...(part.text.trim() ? [{ ...part, children: [] }] : []),
        ...part.children,
      ]);

      sections.push({
        title: section.title,
        meeting: block,
        blocks: summary.length
          ? summary
          : [{ id: `${block.id}:empty-summary`, type: 'paragraph', text: '', children: [] }],
      });
    }

    flush();
    return sections;
  });
}
