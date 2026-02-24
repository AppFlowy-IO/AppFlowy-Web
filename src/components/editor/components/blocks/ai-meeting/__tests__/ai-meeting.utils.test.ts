import { expect, describe, it } from '@jest/globals';

import {
  documentFragmentToHTML,
  formatTimestamp,
  isRangeInsideElement,
  normalizeAppFlowyClipboardHTML,
  plainTextToHTML,
  selectionToContextualHTML,
  selectionToHTML,
  stripTranscriptReferences,
  shouldUseRichCopyForTab,
} from '../ai-meeting.utils';

describe('formatTimestamp', () => {
  describe('valid timestamps', () => {
    it('should format seconds only (< 60)', () => {
      expect(formatTimestamp(0)).toBe('00:00');
      expect(formatTimestamp(5)).toBe('00:05');
      expect(formatTimestamp(59)).toBe('00:59');
    });

    it('should format minutes and seconds (< 3600)', () => {
      expect(formatTimestamp(60)).toBe('01:00');
      expect(formatTimestamp(125)).toBe('02:05');
      expect(formatTimestamp(3599)).toBe('59:59');
    });

    it('should format hours, minutes and seconds (>= 3600)', () => {
      expect(formatTimestamp(3600)).toBe('01:00:00');
      expect(formatTimestamp(3661)).toBe('01:01:01');
      expect(formatTimestamp(7325)).toBe('02:02:05');
      expect(formatTimestamp(36000)).toBe('10:00:00');
    });

    it('should pad numbers with leading zeros', () => {
      expect(formatTimestamp(1)).toBe('00:01');
      expect(formatTimestamp(61)).toBe('01:01');
      expect(formatTimestamp(3601)).toBe('01:00:01');
    });

    it('should handle decimal values by flooring', () => {
      expect(formatTimestamp(5.9)).toBe('00:05');
      expect(formatTimestamp(65.5)).toBe('01:05');
    });
  });

  describe('edge cases', () => {
    it('should return empty string for undefined', () => {
      expect(formatTimestamp(undefined)).toBe('');
    });

    it('should return empty string for NaN', () => {
      expect(formatTimestamp(NaN)).toBe('');
    });

    it('should return empty string for Infinity', () => {
      expect(formatTimestamp(Infinity)).toBe('');
      expect(formatTimestamp(-Infinity)).toBe('');
    });

    it('should treat negative values as zero', () => {
      expect(formatTimestamp(-1)).toBe('00:00');
      expect(formatTimestamp(-100)).toBe('00:00');
    });
  });
});

describe('shouldUseRichCopyForTab', () => {
  it('should return true for notes and transcript tabs', () => {
    expect(shouldUseRichCopyForTab('notes')).toBe(true);
    expect(shouldUseRichCopyForTab('transcript')).toBe(true);
  });

  it('should return false for other tabs', () => {
    expect(shouldUseRichCopyForTab('summary')).toBe(false);
    expect(shouldUseRichCopyForTab('')).toBe(false);
  });
});

describe('HTML copy utils', () => {
  it('should strip transcript references like ^5 and dangling ^', () => {
    const input = `Case discussion: John\nKey point one ^5\nKey point two ^\nKey point three ^  `;
    const output = stripTranscriptReferences(input);

    expect(output).toBe(`Case discussion: John\nKey point one\nKey point two\nKey point three`);
  });

  it('should strip split-line references like "^" then "2"', () => {
    const input = `DISCUSSION SUMMARY\nKey point: Text line\n^\n2\nNext line ^\n10`;
    const output = stripTranscriptReferences(input);

    expect(output).toBe(`DISCUSSION SUMMARY\nKey point: Text line\nNext line\n10`);
  });

  it('should convert plain text to paragraph HTML', () => {
    expect(plainTextToHTML('Line 1\nLine 2')).toBe('<p>Line 1</p><p>Line 2</p>');
  });

  it('should escape HTML characters in plain text conversion', () => {
    expect(plainTextToHTML('<script>alert(1)</script>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  });

  it('should serialize document fragment to HTML', () => {
    const fragment = document.createDocumentFragment();
    const strong = document.createElement('strong');

    strong.textContent = 'Hello';
    fragment.appendChild(strong);

    expect(documentFragmentToHTML(fragment)).toBe('<strong>Hello</strong>');
  });

  it('should serialize selection ranges to HTML', () => {
    document.body.innerHTML = '<div id="root"><p><strong>Hello</strong> world</p></div>';

    const root = document.getElementById('root');
    const paragraph = root?.querySelector('p');

    if (!paragraph) {
      throw new Error('Paragraph not found');
    }

    const selection = window.getSelection();

    if (!selection) {
      throw new Error('Selection is not available');
    }

    const range = document.createRange();

    range.selectNodeContents(paragraph);
    selection.removeAllRanges();
    selection.addRange(range);

    expect(selectionToHTML(selection)).toContain('<strong>Hello</strong> world');
  });

  it('should add heading context for selection HTML', () => {
    document.body.innerHTML = `
      <div class="block-element" data-block-type="heading">
        <div class="heading level-2">
          <span class="text-element"><span class="text-content">Heading text</span></span>
        </div>
      </div>
    `;

    const headingText = document.querySelector('.text-content');
    const textNode = headingText?.firstChild;

    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
      throw new Error('Expected heading text node not found');
    }

    const selection = window.getSelection();

    if (!selection) {
      throw new Error('Selection is not available');
    }

    const range = document.createRange();

    range.setStart(textNode, 0);
    range.setEnd(textNode, 7);
    selection.removeAllRanges();
    selection.addRange(range);

    expect(selectionToContextualHTML(selection)).toContain('<h2>Heading</h2>');
  });

  it('should verify range location under target element', () => {
    document.body.innerHTML = '<div id="container"><p id="inside">Inside</p></div><p id="outside">Outside</p>';

    const container = document.getElementById('container');
    const inside = document.getElementById('inside');
    const outside = document.getElementById('outside');

    if (!container || !inside || !outside) {
      throw new Error('Expected elements not found');
    }

    const insideRange = document.createRange();
    const outsideRange = document.createRange();

    insideRange.selectNodeContents(inside);
    outsideRange.selectNodeContents(outside);

    expect(isRangeInsideElement(insideRange, container)).toBe(true);
    expect(isRangeInsideElement(outsideRange, container)).toBe(false);
  });

  it('should normalize heading/list/todo blocks to semantic HTML', () => {
    const html = `
      <div class="block-element" data-block-type="heading">
        <div class="heading level-2">
          <span class="text-element"><span class="text-content"><strong>Title</strong></span></span>
        </div>
      </div>
      <div class="block-element" data-block-type="bulleted_list">
        <span class="text-element"><span class="text-content">Bullet item</span></span>
      </div>
      <div class="block-element checked" data-block-type="todo_list">
        <span class="text-element"><span class="text-content">Todo item</span></span>
      </div>
    `;

    const normalized = normalizeAppFlowyClipboardHTML(html);

    expect(normalized).toContain('<h2><strong>Title</strong></h2>');
    expect(normalized).toContain('<ul><li>Bullet item</li></ul>');
    expect(normalized).toContain('<input type="checkbox" checked="checked">');
    expect(normalized).toContain('<span>Todo item</span>');
  });

  it('should unwrap ai meeting wrapper blocks', () => {
    const html = `
      <div class="block-element" data-block-type="ai_meeting_summary">
        <div class="block-element" data-block-type="paragraph">
          <span class="text-element"><span class="text-content">Inside summary</span></span>
        </div>
      </div>
    `;

    const normalized = normalizeAppFlowyClipboardHTML(html);

    expect(normalized).not.toContain('ai_meeting_summary');
    expect(normalized).toContain('<p>Inside summary</p>');
  });

  it('should convert heading containers without block wrapper', () => {
    const html = `
      <div class="flex w-full flex-col heading level-2">
        <span class="text-element"><span class="text-content">Loose heading</span></span>
      </div>
    `;

    const normalized = normalizeAppFlowyClipboardHTML(html);

    expect(normalized).toContain('<h2>Loose heading</h2>');
  });

  it('should unwrap ai meeting section container wrappers', () => {
    const html = `
      <div class="ai-meeting-section ai-meeting-section-summary flex w-full flex-col">
        <h2>OVERVIEW</h2>
        <ul><li>Key point</li></ul>
      </div>
    `;

    const normalized = normalizeAppFlowyClipboardHTML(html);

    expect(normalized).not.toContain('ai-meeting-section');
    expect(normalized).toContain('<h2>OVERVIEW</h2>');
    expect(normalized).toContain('<ul><li>Key point</li></ul>');
  });

  it('should remove inline reference artifacts from copied HTML', () => {
    const html = `
      <div class="block-element" data-block-type="paragraph">
        <span class="text-element">
          <span class="text-content">
            Content line
            <span class="absolute right-0 bottom-0 overflow-hidden !text-transparent pointer-events-none">
              <span data-slate-string="true">^</span>
            </span>
            <span contenteditable="false" class="ai-meeting-reference inline-flex">2</span>
          </span>
        </span>
      </div>
    `;

    const normalized = normalizeAppFlowyClipboardHTML(html);

    expect(normalized).toContain('<p>');
    expect(normalized).toContain('Content line');
    expect(normalized).not.toContain('ai-meeting-reference');
    expect(normalized).not.toContain('^');
    expect(normalized).not.toContain('>2<');
  });
});
