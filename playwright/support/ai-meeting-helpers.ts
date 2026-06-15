import { Page, Locator, expect } from '@playwright/test';

/**
 * AI Meeting Block E2E test helpers.
 *
 * These helpers inject AI meeting blocks via the Y.Doc test utilities
 * (window.__TEST_DOC__ / window.Y) which are only available in dev builds.
 *
 * Selectors use existing DOM structure (CSS classes, data-block-type,
 * data-ai-meeting-active, text content) — no data-testid attributes required.
 */

export interface SpeakerInput {
  id: string;
  name?: string;
  email?: string;
  timestamp?: number;
  content: string;
}

export interface AIMeetingBlockOptions {
  title?: string;
  summary?: string;
  notes?: string;
  speakers?: SpeakerInput[];
  /** When true, tabs are hidden and notes are shown directly */
  showNotesDirectly?: boolean;
  /** Persisted tab index (0=summary, 1=notes, 2=transcript) */
  selectedTabIndex?: number;
  summaryTemplate?: string;
  summaryDetail?: string;
  summaryLanguage?: string;
}

/**
 * Check if Y.Doc test utilities are available on the page (dev mode only).
 */
export async function areTestUtilitiesAvailable(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const win = window as any;
    return !!(win.__TEST_DOC__ && win.Y);
  });
}

/**
 * Inject an AI meeting block into the current document via Yjs transact.
 *
 * Returns an object with the block IDs created (for later reference in tests).
 */
export async function injectAIMeetingBlock(
  page: Page,
  options: AIMeetingBlockOptions
): Promise<{ meetingBlockId: string; summaryBlockId?: string; notesBlockId?: string; transcriptBlockId?: string }> {
  return page.evaluate((opts) => {
    const win = window as any;
    const doc = win.__TEST_DOC__;
    const Y = win.Y;

    const sharedRoot = doc.getMap('data');
    const document = sharedRoot.get('document');
    const blocks = document.get('blocks');
    const meta = document.get('meta');
    const pageId = document.get('page_id');
    const childrenMap = meta.get('children_map');
    const textMap = meta.get('text_map');

    let counter = 0;
    const generateId = () => `test_meeting_${Date.now()}_${counter++}`;

    const result: {
      meetingBlockId: string;
      summaryBlockId?: string;
      notesBlockId?: string;
      transcriptBlockId?: string;
    } = { meetingBlockId: '' };

    doc.transact(() => {
      // Helper: create a block in Yjs
      const createBlock = (
        id: string,
        type: string,
        parentId: string,
        data: Record<string, unknown> = {}
      ) => {
        const block = new Y.Map();
        block.set('id', id);
        block.set('ty', type);
        block.set('children', id);
        block.set('parent', parentId);
        block.set('external_id', id);
        block.set('external_type', 'text');
        block.set('data', JSON.stringify(data));
        blocks.set(id, block);

        const blockChildren = new Y.Array();
        childrenMap.set(id, blockChildren);

        const blockText = new Y.Text();
        textMap.set(id, blockText);

        return blockChildren;
      };

      // Helper: create paragraph child with text
      const createParagraph = (parentId: string, content: string, parentChildren: any) => {
        const paragraphId = generateId();
        createBlock(paragraphId, 'paragraph', parentId);
        const paragraphText = textMap.get(paragraphId);
        if (paragraphText && content) {
          paragraphText.insert(0, content);
        }
        parentChildren.push([paragraphId]);
        return paragraphId;
      };

      // --- Main AI Meeting Block ---
      const meetingBlockId = generateId();
      result.meetingBlockId = meetingBlockId;

      const meetingData: Record<string, unknown> = {};
      if (opts.title) meetingData.title = opts.title;
      if (opts.showNotesDirectly) meetingData.show_notes_directly = true;
      if (typeof opts.selectedTabIndex === 'number') meetingData.selected_tab_index = opts.selectedTabIndex;
      if (opts.summaryTemplate) meetingData.summary_template = opts.summaryTemplate;
      if (opts.summaryDetail) meetingData.summary_detail = opts.summaryDetail;
      if (opts.summaryLanguage) meetingData.summary_language = opts.summaryLanguage;

      // Build speaker_info_map
      if (opts.speakers && opts.speakers.length > 0) {
        const speakerInfoMap: Record<string, Record<string, unknown>> = {};
        opts.speakers.forEach((speaker: any) => {
          if (speaker.name || speaker.email) {
            speakerInfoMap[speaker.id] = {
              ...(speaker.name ? { name: speaker.name } : {}),
              ...(speaker.email ? { email: speaker.email } : {}),
            };
          }
        });
        if (Object.keys(speakerInfoMap).length > 0) {
          meetingData.speaker_info_map = JSON.stringify(speakerInfoMap);
        }
      }

      const meetingChildren = createBlock(meetingBlockId, 'ai_meeting', pageId, meetingData);

      // Add to page
      const pageChildren = childrenMap.get(pageId);
      if (pageChildren) {
        pageChildren.push([meetingBlockId]);
      }

      // --- Summary Section ---
      if (opts.summary) {
        const summaryBlockId = generateId();
        result.summaryBlockId = summaryBlockId;
        const summaryChildren = createBlock(summaryBlockId, 'ai_meeting_summary', meetingBlockId);
        createParagraph(summaryBlockId, opts.summary, summaryChildren);
        meetingChildren.push([summaryBlockId]);
      }

      // --- Notes Section ---
      if (opts.notes !== undefined) {
        const notesBlockId = generateId();
        result.notesBlockId = notesBlockId;
        const notesChildren = createBlock(notesBlockId, 'ai_meeting_notes', meetingBlockId);
        createParagraph(notesBlockId, opts.notes, notesChildren);
        meetingChildren.push([notesBlockId]);
      }

      // --- Transcript Section ---
      if (opts.speakers && opts.speakers.length > 0) {
        const transcriptBlockId = generateId();
        result.transcriptBlockId = transcriptBlockId;
        const transcriptChildren = createBlock(transcriptBlockId, 'ai_meeting_transcription', meetingBlockId);

        opts.speakers.forEach((speaker: any) => {
          const speakerBlockId = generateId();
          const speakerData: Record<string, unknown> = { speaker_id: speaker.id };
          if (typeof speaker.timestamp === 'number') speakerData.timestamp = speaker.timestamp;
          const speakerChildren = createBlock(speakerBlockId, 'ai_meeting_speaker', transcriptBlockId, speakerData);
          createParagraph(speakerBlockId, speaker.content, speakerChildren);
          transcriptChildren.push([speakerBlockId]);
        });

        meetingChildren.push([transcriptBlockId]);
      }
    });

    return result;
  }, options);
}

/** Standard page error filter for AI meeting tests */
export function setupPageErrorFilter(page: Page) {
  page.on('pageerror', (err) => {
    if (
      err.message.includes('Minified React error') ||
      err.message.includes('View not found') ||
      err.message.includes('No workspace or service found') ||
      err.message.includes('Cannot resolve a DOM point from Slate point') ||
      err.message.includes('Cannot resolve a DOM node from Slate node') ||
      err.message.includes('Cannot resolve a Slate point from DOM point') ||
      err.message.includes('Cannot resolve a Slate node from DOM node') ||
      err.message.includes("Cannot read properties of undefined (reading '_dEH')") ||
      err.message.includes('unobserveDeep') ||
      err.message.includes('Invalid hook call')
    ) {
      return;
    }
  });
}

/**
 * Standard setup: sign in, create a new blank document page, wait for editor.
 * Creates a fresh page so we don't need to clear existing content.
 */
export async function setupEditorWithCleanPage(
  page: Page,
  request: import('@playwright/test').APIRequestContext,
  testEmail: string
) {
  const { signInAndWaitForApp } = await import('./auth-flow-helpers');
  const { createDocumentPageAndNavigate } = await import('./page-utils');

  await signInAndWaitForApp(page, request, testEmail);
  await expect(page).toHaveURL(/\/app/, { timeout: 30000 });

  // Create a fresh blank document page instead of using "Getting started"
  await createDocumentPageAndNavigate(page);
  await page.waitForTimeout(1000);
}

/**
 * Clear editor content without re-signing in. Use between tests in the same
 * session to quickly reset the editor for the next block injection.
 */
export async function clearEditorContent(page: Page) {
  const { EditorSelectors } = await import('./selectors');

  const editor = EditorSelectors.slateEditor(page);
  await editor.click({ force: true });
  await page.keyboard.press('Meta+A');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(500);
}

/**
 * Navigate to the Getting Started page (if not already there) and clear it.
 * Much faster than full setupEditorWithCleanPage since it skips sign-in.
 */
export async function navigateAndClearEditor(page: Page) {
  // Click Getting started in sidebar
  await page.getByTestId('page-name').filter({ hasText: 'Getting started' }).first().click();
  await page.waitForTimeout(1000);

  await page.keyboard.press('Escape');
  await clearEditorContent(page);
}

/**
 * AI Meeting block selectors — uses existing DOM classes/attributes, no data-testid needed.
 *
 * The component renders:
 * - `.ai-meeting-block` with `data-ai-meeting-active` attribute on root
 * - `<input>` for title inside the block
 * - Tab buttons as `<button>` with tab label text ("Summary", "Notes", "Transcript")
 * - `data-block-type="ai_meeting_summary|notes|transcription|speaker"` on sections
 * - `.ai-meeting-speaker__name`, `.ai-meeting-speaker__timestamp` classes
 * - "Regenerate" / "Generating" text on the regenerate button
 * - MUI `IconButton` for more menu (contains MoreIcon SVG)
 * - "Copy summary" / "Copy notes" / "Copy transcript" text in copy popover
 * - `.ai-meeting-reference` class on inline reference badges
 */
export const AIMeetingSelectors = {
  /** The root .ai-meeting-block element */
  block: (page: Page) => page.locator('.ai-meeting-block'),
  /** The title <input> inside the meeting block */
  title: (page: Page) => page.locator('.ai-meeting-block input').first(),
  /** A tab button by its label text */
  tab: (page: Page, key: 'summary' | 'notes' | 'transcript') => {
    const labels: Record<string, string> = {
      summary: 'Summary',
      notes: 'Notes',
      transcript: 'Transcript',
    };
    return page.locator('.ai-meeting-tabs button').filter({ hasText: labels[key] });
  },
  /** The "Regenerate" / "Generating" button (left side of split button) */
  regenerateButton: (page: Page) =>
    page.locator('.ai-meeting-block button').filter({ hasText: /^(Regenerate|Generating)$/ }),
  /** The dropdown arrow button next to Regenerate (right side of split button) */
  regenerateOptionsButton: (page: Page) => {
    // It's the sibling button right after the Regenerate button, within the same inline-flex div
    return page.locator('.ai-meeting-block .inline-flex > button:last-child').first();
  },
  /** The regenerate options popover content (appears inside a MUI Popover) */
  regeneratePopover: (page: Page) =>
    page.locator('.MuiPopover-paper').filter({ hasText: 'Summary detail' }),
  /** A template option button by its label text */
  templateOption: (page: Page, label: string) =>
    page.locator('.MuiPopover-paper button').filter({ hasText: label }),
  /** A detail option button by its label text */
  detailOption: (page: Page, label: string) =>
    page.locator('.MuiPopover-paper button').filter({ hasText: label }),
  /** A language option button by its label text */
  languageOption: (page: Page, label: string) =>
    page.locator('.MuiPopover-paper button').filter({ hasText: label }),
  /** The more (...) menu IconButton */
  moreMenu: (page: Page) =>
    page.locator('.ai-meeting-block .ai-meeting-tabs button[class*="MuiIconButton"]'),
  /** The copy button inside the more menu popover */
  copyButton: (page: Page) =>
    page.locator('.MuiPopover-paper button').filter({ hasText: /^Copy (summary|notes|transcript)$/ }),
  /** Inline reference badge by number */
  refBadge: (page: Page, number: number) =>
    page.locator('.ai-meeting-reference').filter({ hasText: String(number) }),
  /** Section locators by data-block-type */
  summarySection: (page: Page) => page.locator('[data-block-type="ai_meeting_summary"]'),
  notesSection: (page: Page) => page.locator('[data-block-type="ai_meeting_notes"]'),
  transcriptSection: (page: Page) => page.locator('[data-block-type="ai_meeting_transcription"]'),
  speakerBlocks: (page: Page) => page.locator('[data-block-type="ai_meeting_speaker"]'),
};
