import type { PageSnapshot, Slide, SourceBlock, StoryPlan } from './types';

export interface SourceDetails {
  documentTitle: string;
  section?: string;
  excerpt: string;
}

export interface SlideSourceReference extends SourceDetails {
  number: number;
}

const excerptLimit = 320;
const excerpt = (text: string) =>
  text.length > excerptLimit ? `${text.slice(0, excerptLimit).trimEnd()}…` : text;

/** Resolve readable passages once per snapshot, including nested table cells and row properties. */
export function describeSlideSources(snapshot: PageSnapshot): ReadonlyMap<string, SourceDetails> {
  const details = new Map<string, SourceDetails>();
  const documentTitle = snapshot.title;

  details.set(snapshot.pageId, { documentTitle, excerpt: 'Document title' });

  function visit(blocks: SourceBlock[], ancestors: { level: number; title: string }[] = []): string {
    const headings = [...ancestors];
    const passages: string[] = [];
    let passageLength = 0;

    for (const block of blocks) {
      if (block.type === 'heading') {
        const level = block.level ?? 1;

        while (headings.length && headings[headings.length - 1].level >= level) headings.pop();
        headings.push({ level, title: block.text || block.headingText || '' });
      }

      const children = visit(block.children, headings);
      const ownText = block.text || block.formula || block.headingText || block.meeting?.title || '';
      const passage = excerpt([excerpt(ownText.trim()), children].filter(Boolean).join('\n'));

      details.set(block.id, {
        documentTitle,
        section: headings.map((heading) => heading.title).filter(Boolean).join(' › '),
        excerpt: passage || 'Open this source to view its content.',
      });
      // Parents only need a short preview; each child's own details remain available.
      if (passageLength <= excerptLimit && passage) {
        passages.push(passage);
        passageLength += passage.length + 1;
      }
    }

    return excerpt(passages.join('\n'));
  }

  visit(snapshot.blocks);
  for (const property of snapshot.properties) {
    details.set(property.id, {
      documentTitle,
      section: property.name,
      excerpt: excerpt(`${property.name}: ${property.value ?? 'Not provided'}`),
    });
  }

  return details;
}

export function slideSourceIds(slide: Slide): string[] {
  return [...new Set([
    ...slide.sourceIds,
    ...(slide.table?.sourceIds ?? []),
    ...(slide.chart?.items.map((item) => item.sourceId) ?? []),
  ])];
}

/** One number per document location across the full deck, in order of first citation. */
export function numberSlideSources(
  plan: StoryPlan | undefined,
  details: ReadonlyMap<string, SourceDetails>
): ReadonlyMap<string, SlideSourceReference> {
  const references = new Map<string, SlideSourceReference>();

  for (const slide of plan?.slides ?? []) {
    for (const id of slideSourceIds(slide)) {
      if (references.has(id)) continue;
      references.set(id, {
        number: references.size + 1,
        ...(details.get(id) ?? {
          documentTitle: 'Source unavailable',
          excerpt: 'This location is not available in the saved document snapshot.',
        }),
      });
    }
  }

  return references;
}
