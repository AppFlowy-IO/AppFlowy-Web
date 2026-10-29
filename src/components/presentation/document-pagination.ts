import { meetingMeasureKey } from './document-content';
import { isSimpleTable, paginateTable, type TablePage } from './table-pagination';

import type { DocumentSlide } from './source';

export interface DocumentPage extends DocumentSlide {
  key: string;
  sourceKeys: string[];
  part: number;
  partCount: number;
  scrollTop: number;
  table?: TablePage;
  prefixHeight?: number;
  database?: boolean;
  frameHeight?: number;
}

export const documentUnitKey = (section: number, block: number) => `${section}:${block}`;

/**
 * Fit blocks to the viewport, keeping table introductions together and body rows unique.
 * `condensedTables` collects the tables whose compact and dense measurements can change a slide.
 */
export function paginateDocument(
  sections: DocumentSlide[],
  heights: Record<string, number>,
  availableHeight: number,
  condensedTables?: Set<string>
): DocumentPage[] {
  const pages: DocumentPage[] = [];

  sections.forEach((section, sectionIndex) => {
    const frameHeight = section.meeting ? heights[meetingMeasureKey(sectionIndex)] ?? 0 : 0;
    const capacity = Math.max(1, availableHeight - frameHeight);
    let blocks: DocumentSlide['blocks'] = [];
    let keys: string[] = [];
    let used = 0;
    const append = (content: DocumentSlide, sourceKeys: string[], height: number) => {
      // Oversized non-table blocks use overlapping windows so no line is lost at the viewport edge.
      const stride = capacity - Math.min(64, capacity * 0.15);
      const partCount = Math.max(1, 1 + Math.ceil((height - capacity) / stride));

      for (let part = 0; part < partCount; part++) {
        pages.push({
          ...section,
          ...content,
          frameHeight,
          key: `${sourceKeys[0]}:part-${part}`,
          sourceKeys,
          part,
          partCount,
          scrollTop: Math.min(part * stride, Math.max(0, height - capacity)),
        });
      }
    };

    const flush = () => {
      if (blocks.length) append({ title: section.title, blocks }, keys, used);
      blocks = [];
      keys = [];
      used = 0;
    };

    if (section.titleSlide) {
      append(section, ['title'], heights.title ?? 0);
      return;
    }

    for (let index = 0; index < section.blocks.length; index++) {
      const group = [section.blocks[index]];
      const groupKeys = [documentUnitKey(sectionIndex, index)];
      const keepWithNext = () => {
        const block = section.blocks[index];

        return block.type === 'heading' || (block.type === 'paragraph' && !block.text.trim() && !block.children.length);
      };

      while (keepWithNext() && index + 1 < section.blocks.length) {
        group.push(section.blocks[++index]);
        groupKeys.push(documentUnitKey(sectionIndex, index));
      }

      // Start a complete numbered list on a fresh slide if it fits there.
      // Longer lists retain item boundaries and their original numbering.
      if (section.blocks[index].type === 'numbered_list' && section.blocks[index - 1]?.type !== 'numbered_list') {
        let end = index;
        let height = groupKeys.reduce((sum, key) => sum + (heights[key] ?? 0), 0);

        while (section.blocks[end + 1]?.type === 'numbered_list') {
          height += heights[documentUnitKey(sectionIndex, ++end)] ?? 0;
        }

        if (height <= capacity) {
          while (index < end) {
            group.push(section.blocks[++index]);
            groupKeys.push(documentUnitKey(sectionIndex, index));
          }
        }
      }

      const last = group[group.length - 1];

      if (last.database) {
        flush();
        const prefix = group.slice(0, -1);
        const prefixKeys = groupKeys.slice(0, -1);
        let prefixHeight = prefixKeys.reduce((sum, key) => sum + (heights[key] ?? 0), 0);

        // A database owns a scrollable, virtualized viewport. Never slice or
        // mount it again for measuring, which duplicates rows and subscriptions.
        if (prefix.length && prefixHeight > capacity - 160) {
          append({ title: section.title, blocks: prefix }, prefixKeys, prefixHeight);
          prefix.length = 0;
          prefixHeight = 0;
        }

        const key = groupKeys[groupKeys.length - 1];

        pages.push({
          ...section,
          frameHeight,
          title: section.title,
          blocks: [...prefix, last],
          key: `${key}:database`,
          sourceKeys: [key, ...(prefix.length ? prefixKeys : [])],
          part: 0,
          partCount: 1,
          scrollTop: 0,
          prefixHeight,
          database: true,
        });
        continue;
      }

      if (isSimpleTable(last)) {
        const prefix = group.slice(0, -1);
        const headingHeight = groupKeys.slice(0, -1).reduce((sum, key) => sum + (heights[key] ?? 0), 0);
        const tableKey = groupKeys[groupKeys.length - 1];
        let tablePages = paginateTable(
          last,
          tableKey,
          heights,
          capacity - headingHeight,
          capacity - headingHeight,
          condensedTables
        );
        let introduction: DocumentSlide['blocks'] = [];
        let introductionKeys: string[] = [];
        let introductionHeight = 0;

        // An immediate table heading starts a new topic. Otherwise use the remaining
        // space below the existing introduction, without duplicating it on continuations.
        if (!prefix.some((block) => block.type === 'heading') && blocks.length && used + headingHeight < capacity) {
          const combined = paginateTable(
            last,
            tableKey,
            heights,
            capacity - headingHeight,
            capacity - used - headingHeight,
            condensedTables
          );

          if (combined[0].height <= capacity - used - headingHeight && combined.length <= tablePages.length + 1) {
            tablePages = combined;
            introduction = blocks;
            introductionKeys = keys;
            introductionHeight = used;
            blocks = [];
            keys = [];
            used = 0;
          }
        }

        flush();

        tablePages.forEach((page, pageIndex) => {
          pages.push({
            ...section,
            frameHeight,
            title: section.title,
            blocks: [...(pageIndex === 0 ? introduction : []), ...prefix, page.block],
            key: `${page.sourceKeys[0]}:table`,
            sourceKeys: [
              ...page.sourceKeys,
              ...(pageIndex === 0 ? [...introductionKeys, ...groupKeys.slice(0, -1)] : []),
            ],
            part: 0,
            partCount: 1,
            scrollTop: 0,
            table: page.layout,
            prefixHeight: headingHeight + (pageIndex === 0 ? introductionHeight : 0),
          });
        });
        continue;
      }

      const height = groupKeys.reduce((sum, key) => sum + (heights[key] ?? 0), 0);

      if (blocks.length && used + height > capacity) flush();
      blocks.push(...group);
      keys.push(...groupKeys);
      used += height;
      if (used > capacity) flush();
    }

    flush();
  });
  return pages;
}
