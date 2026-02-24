export const formatTimestamp = (value?: number) => {
  if (!Number.isFinite(value)) return '';

  const totalSeconds = Math.max(0, Math.floor(value as number));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds
      .toString()
      .padStart(2, '0')}`;
  }

  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

export const shouldUseRichCopyForTab = (tabKey: string) => {
  return tabKey === 'notes' || tabKey === 'transcript';
};

export const documentFragmentToHTML = (fragment: DocumentFragment) => {
  const container = document.createElement('div');

  container.appendChild(fragment);
  return container.innerHTML;
};

const escapeHTML = (text: string) => {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

export const plainTextToHTML = (text: string) => {
  const lines = text.split(/\r\n|\r|\n/);

  if (lines.length === 0) return '';

  return lines.map((line) => `<p>${escapeHTML(line)}</p>`).join('');
};

export const stripTranscriptReferences = (text: string) => {
  if (!text) return '';

  const normalized = text.replace(/\r\n|\r/g, '\n');
  const lines = normalized.split('\n');
  const sanitizedLines: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index] ?? '';
    const trimmed = current.trim();

    // Handle standalone reference lines in copied plain text:
    // "^" on one line and its number on the next line.
    if (/^\^\s*$/.test(trimmed)) {
      const nextLine = lines[index + 1] ?? '';

      if (/^\d+\s*$/.test(nextLine.trim())) {
        index += 1;
      }

      continue;
    }

    // Handle a line that is only "^12".
    if (/^\^\d+\s*$/.test(trimmed)) {
      continue;
    }

    const cleaned = current
      .replace(/\s*\^\d+\b/g, '')
      .replace(/\s*\^(?=\s|$)/g, '')
      .trimEnd();

    sanitizedLines.push(cleaned);
  }

  const withoutRefs = sanitizedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  return withoutRefs;
};

const getHeadingLevel = (block: HTMLElement) => {
  const heading = block.querySelector('.heading');
  const levelClass = heading?.className.match(/level-(\d)/);
  const level = Number(levelClass?.[1] ?? 1);

  if (!Number.isFinite(level) || level < 1) return 1;
  if (level > 6) return 6;
  return level;
};

const getBlockInlineHTML = (block: HTMLElement) => {
  const textContent = block.querySelector('.text-content');

  if (textContent) {
    return textContent.innerHTML;
  }

  return '';
};

const createParagraphElement = (doc: Document, html: string) => {
  const paragraph = doc.createElement('p');

  paragraph.innerHTML = html;
  return paragraph;
};

const convertBlockElementToSemantic = (block: HTMLElement, doc: Document) => {
  const blockType = block.getAttribute('data-block-type');

  if (!blockType) return null;

  const inlineHTML = getBlockInlineHTML(block);

  switch (blockType) {
    case 'heading': {
      const heading = doc.createElement(`h${getHeadingLevel(block)}`);

      heading.innerHTML = inlineHTML;
      return heading;
    }

    case 'paragraph': {
      return createParagraphElement(doc, inlineHTML);
    }

    case 'bulleted_list': {
      const ul = doc.createElement('ul');
      const li = doc.createElement('li');

      li.innerHTML = inlineHTML;
      ul.appendChild(li);
      return ul;
    }

    case 'numbered_list': {
      const ol = doc.createElement('ol');
      const li = doc.createElement('li');

      li.innerHTML = inlineHTML;
      ol.appendChild(li);
      return ol;
    }

    case 'todo_list': {
      const ul = doc.createElement('ul');
      const li = doc.createElement('li');
      const input = doc.createElement('input');

      input.type = 'checkbox';
      if (block.classList.contains('checked') || block.querySelector('.checked')) {
        input.setAttribute('checked', 'checked');
      }

      li.appendChild(input);

      const span = doc.createElement('span');

      span.innerHTML = inlineHTML;
      li.appendChild(span);
      ul.appendChild(li);
      return ul;
    }

    case 'quote': {
      const quote = doc.createElement('blockquote');

      quote.innerHTML = inlineHTML;
      return quote;
    }

    case 'code': {
      const pre = doc.createElement('pre');
      const code = doc.createElement('code');
      const codeText = block.querySelector('pre code')?.textContent ?? block.textContent ?? '';

      code.innerHTML = escapeHTML(codeText);
      pre.appendChild(code);
      return pre;
    }

    case 'divider': {
      return doc.createElement('hr');
    }

    default: {
      return null;
    }
  }
};

const unwrapAIMeetingWrappers = (container: HTMLElement) => {
  const selectors = [
    '[data-block-type="ai_meeting_summary"]',
    '[data-block-type="ai_meeting_notes"]',
    '[data-block-type="ai_meeting_transcription"]',
    '[data-block-type="ai_meeting_speaker"]',
    '.ai-meeting-section',
    '.ai-meeting-speaker',
    '.ai-meeting-speaker__content',
  ].join(',');

  container.querySelectorAll<HTMLElement>(selectors).forEach((element) => {
    const parent = element.parentNode;

    if (!parent) return;

    while (element.firstChild) {
      parent.insertBefore(element.firstChild, element);
    }

    parent.removeChild(element);
  });
};

const convertHeadingContainers = (container: HTMLElement) => {
  const headingElements = Array.from(container.querySelectorAll<HTMLElement>('.heading'));

  headingElements.forEach((headingElement) => {
    if (/^h[1-6]$/i.test(headingElement.tagName)) return;

    const levelClass = headingElement.className.match(/level-(\d)/);
    const level = Number(levelClass?.[1] ?? 1);
    const safeLevel = Number.isFinite(level) ? Math.min(Math.max(level, 1), 6) : 1;
    const headingTag = document.createElement(`h${safeLevel}`);
    const content = headingElement.querySelector('.text-content');

    headingTag.innerHTML = content ? content.innerHTML : headingElement.innerHTML;
    headingElement.replaceWith(headingTag);
  });
};

const removeInlineReferenceArtifacts = (container: HTMLElement) => {
  container.querySelectorAll<HTMLElement>('.ai-meeting-reference, .ai-meeting-reference-popover').forEach((el) => {
    el.remove();
  });

  container.querySelectorAll<HTMLElement>('span').forEach((span) => {
    const text = (span.textContent || '').trim();
    const className = String(span.className || '');

    if (text !== '^') return;
    if (!className.includes('text-transparent')) return;
    if (!className.includes('pointer-events-none')) return;

    span.remove();
  });
};

export const normalizeAppFlowyClipboardHTML = (html: string) => {
  if (!html.trim()) return '';

  const container = document.createElement('div');

  container.innerHTML = html;
  container.querySelectorAll('meta').forEach((meta) => meta.remove());
  removeInlineReferenceArtifacts(container);

  const semanticBlockTypes = new Set([
    'heading',
    'paragraph',
    'bulleted_list',
    'numbered_list',
    'todo_list',
    'quote',
    'code',
    'divider',
  ]);

  const blocks = Array.from(container.querySelectorAll<HTMLElement>('.block-element[data-block-type]'));

  blocks.forEach((block) => {
    const blockType = block.getAttribute('data-block-type');

    if (!blockType || !semanticBlockTypes.has(blockType)) return;

    const semantic = convertBlockElementToSemantic(block, document);

    if (semantic) {
      block.replaceWith(semantic);
    }
  });

  convertHeadingContainers(container);
  unwrapAIMeetingWrappers(container);
  return container.innerHTML;
};

export const selectionToHTML = (selection: Selection) => {
  let html = '';

  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);

    html += documentFragmentToHTML(range.cloneContents());
  }

  return html;
};

const closestBlockElement = (node: Node | null): HTMLElement | null => {
  if (!node) return null;

  const element = node instanceof HTMLElement ? node : node.parentElement;

  if (!element) return null;

  return element.closest('.block-element[data-block-type]');
};

const wrapRangeHTMLWithBlockContext = (range: Range, html: string) => {
  const startBlock = closestBlockElement(range.startContainer);
  const endBlock = closestBlockElement(range.endContainer);

  if (!startBlock || !endBlock || startBlock !== endBlock) {
    return html;
  }

  const blockType = startBlock.getAttribute('data-block-type');

  if (!blockType) return html;

  switch (blockType) {
    case 'heading': {
      const level = getHeadingLevel(startBlock);

      return `<h${level}>${html}</h${level}>`;
    }

    case 'bulleted_list':
      return `<ul><li>${html}</li></ul>`;

    case 'numbered_list':
      return `<ol><li>${html}</li></ol>`;

    case 'todo_list': {
      const checked = startBlock.classList.contains('checked') || startBlock.querySelector('.checked');

      return `<ul><li><input type="checkbox"${checked ? ' checked="checked"' : ''}><span>${html}</span></li></ul>`;
    }

    case 'quote':
      return `<blockquote>${html}</blockquote>`;

    default:
      return html;
  }
};

export const selectionToContextualHTML = (selection: Selection) => {
  let html = '';

  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    const rawHTML = documentFragmentToHTML(range.cloneContents());

    html += wrapRangeHTMLWithBlockContext(range, rawHTML);
  }

  return html;
};

export const isRangeInsideElement = (range: Range, container: HTMLElement) => {
  return container.contains(range.commonAncestorContainer);
};
