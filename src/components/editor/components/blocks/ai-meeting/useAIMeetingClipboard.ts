import { useCallback, useEffect, useRef } from 'react';
import { Element, Node } from 'slate';

import { CustomEditor } from '@/application/slate-yjs/command';
import { BlockType } from '@/application/types';
import { notify } from '@/components/_shared/notify';
import {
  documentFragmentToHTML,
  isRangeInsideElement,
  normalizeAppFlowyClipboardHTML,
  plainTextToHTML,
  selectionToContextualHTML,
  stripTranscriptReferences,
} from './ai-meeting.utils';

type TabKey = 'summary' | 'notes' | 'transcript';

interface CopyMeta {
  tabKey: TabKey;
  node?: Node;
  labelKey: string;
  successKey: string;
  dataBlockType: string;
  hasContent: boolean;
}

interface ClipboardPayload {
  plainText: string;
  html: string;
}

interface PayloadBuildOptions {
  stripReferences?: boolean;
}

const normalizePlainText = (text: string) => text.replace(/\u00a0/g, ' ');

const buildCopyText = (node?: Node) => {
  if (!node || !Element.isElement(node)) return '';

  const lines = node.children
    .map((child) => CustomEditor.getBlockTextContent(child).trim())
    .filter((line) => line.length > 0);

  if (lines.length) return lines.join('\n');

  return CustomEditor.getBlockTextContent(node).trim();
};

const buildTranscriptCopyText = (node: Node, resolveSpeakerName: (speakerId?: string) => string) => {
  if (!Element.isElement(node)) return '';

  const lines: string[] = [];

  node.children.forEach((child) => {
    if (Element.isElement(child) && child.type === BlockType.AIMeetingSpeakerBlock) {
      const speakerData = child.data as Record<string, unknown> | undefined;
      const speakerId = (speakerData?.speaker_id || speakerData?.speakerId) as string | undefined;
      const speakerName = resolveSpeakerName(speakerId);
      const transcript = stripTranscriptReferences(
        child.children
          .map((speakerChild) => CustomEditor.getBlockTextContent(speakerChild).trim())
          .filter((line) => line.length > 0)
          .join(' ')
      );

      lines.push(transcript ? `${speakerName}: ${transcript}` : `${speakerName}:`);
    }
  });

  return lines.join('\n');
};

const buildTranscriptCopyTextFromElement = (element: HTMLElement) => {
  const speakerElements = Array.from(
    element.querySelectorAll<HTMLElement>('[data-block-type="ai_meeting_speaker"]')
  );

  if (speakerElements.length === 0) return '';

  const lines = speakerElements
    .map((speakerElement) => {
      const speakerName = speakerElement.querySelector<HTMLElement>('.ai-meeting-speaker__name')?.innerText?.trim();
      const contentElement = speakerElement.querySelector<HTMLElement>('.ai-meeting-speaker__content');
      const transcript = stripTranscriptReferences(
        (contentElement?.innerText ?? '').replace(/\u00a0/g, ' ').trim()
      );

      if (!transcript) return '';

      return speakerName ? `${speakerName}: ${transcript}` : transcript;
    })
    .filter((line) => line.length > 0);

  return lines.join('\n');
};

const COPY_META: Record<TabKey, Omit<CopyMeta, 'tabKey' | 'node' | 'hasContent'>> = {
  summary: {
    labelKey: 'document.aiMeeting.copy.summary',
    successKey: 'document.aiMeeting.copy.summarySuccess',
    dataBlockType: 'ai_meeting_summary',
  },
  notes: {
    labelKey: 'document.aiMeeting.copy.notes',
    successKey: 'document.aiMeeting.copy.notesSuccess',
    dataBlockType: 'ai_meeting_notes',
  },
  transcript: {
    labelKey: 'document.aiMeeting.copy.transcript',
    successKey: 'document.aiMeeting.copy.transcriptSuccess',
    dataBlockType: 'ai_meeting_transcription',
  },
};

export { buildCopyText, buildTranscriptCopyText, COPY_META, type CopyMeta, type TabKey };

export function useAIMeetingClipboard({
  contentRef,
  activeCopyItem,
  resolveSpeakerName,
  t,
}: {
  contentRef: React.RefObject<HTMLDivElement | null>;
  activeCopyItem: CopyMeta;
  resolveSpeakerName: (speakerId?: string) => string;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const isProgrammaticCopyRef = useRef(false);

  const getSectionElementByTab = useCallback((tabKey: TabKey) => {
    const contentElement = contentRef.current;

    if (!contentElement) return null;

    return contentElement.querySelector<HTMLElement>(
      `.block-element[data-block-type="${COPY_META[tabKey].dataBlockType}"]`
    );
  }, [contentRef]);

  const buildPayloadFromElement = useCallback(
    (element: HTMLElement, options?: PayloadBuildOptions): ClipboardPayload => {
      const range = document.createRange();

      range.selectNodeContents(element);
      const rawHTML = documentFragmentToHTML(range.cloneContents()).trim();
      const html = normalizeAppFlowyClipboardHTML(rawHTML);
      const rawPlainText = normalizePlainText(element.innerText ?? '').trim();
      const plainText = options?.stripReferences ? stripTranscriptReferences(rawPlainText) : rawPlainText;

      return {
        plainText,
        html: html.trim() || plainTextToHTML(plainText),
      };
    },
    []
  );

  const buildSelectionPayload = useCallback(
    (selection: Selection, options?: PayloadBuildOptions): ClipboardPayload => {
      const rawPlainText = normalizePlainText(selection.toString()).trim();
      const plainText = options?.stripReferences ? stripTranscriptReferences(rawPlainText) : rawPlainText;
      const rawHTML = selectionToContextualHTML(selection).trim();
      const html = normalizeAppFlowyClipboardHTML(rawHTML);

      return {
        plainText,
        html: html.trim() || plainTextToHTML(plainText),
      };
    },
    []
  );

  const fallbackCopyWithExecCommand = useCallback((payload: ClipboardPayload) => {
    let captured = false;
    const handler = (event: ClipboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      event.clipboardData?.setData('text/plain', payload.plainText);
      if (payload.html) {
        event.clipboardData?.setData('text/html', payload.html);
      }

      captured = true;
    };

    document.addEventListener('copy', handler, true);
    let commandSucceeded = false;

    try {
      // Legacy fallback for browsers without clipboard.write support
      commandSucceeded = document.execCommand('copy');
    } catch {
      commandSucceeded = false;
    }

    document.removeEventListener('copy', handler, true);
    return captured || commandSucceeded;
  }, []);

  const writePayloadToClipboard = useCallback(async (payload: ClipboardPayload) => {
    if (!payload.plainText) return false;
    if (!navigator.clipboard) return false;

    try {
      if (typeof navigator.clipboard.write === 'function' && typeof ClipboardItem !== 'undefined') {
        const item: Record<string, Blob> = {
          'text/plain': new Blob([payload.plainText], { type: 'text/plain' }),
        };

        if (payload.html) {
          item['text/html'] = new Blob([payload.html], { type: 'text/html' });
        }

        await navigator.clipboard.write([new ClipboardItem(item)]);
        return true;
      }

      await navigator.clipboard.writeText(payload.plainText);
      return true;
    } catch {
      return false;
    }
  }, []);

  const handleCopy = useCallback(async () => {
    let payload: ClipboardPayload | null = null;

    if (activeCopyItem.hasContent) {
      if (activeCopyItem.tabKey === 'transcript' && activeCopyItem.node) {
        const transcriptElement = getSectionElementByTab('transcript');
        const transcriptTextFromNode = buildTranscriptCopyText(activeCopyItem.node, resolveSpeakerName);
        const transcriptTextFromElement = transcriptElement
          ? buildTranscriptCopyTextFromElement(transcriptElement)
          : '';
        const fallbackText = stripTranscriptReferences(
          normalizePlainText(transcriptElement?.innerText ?? buildCopyText(activeCopyItem.node))
        );
        const plainText = transcriptTextFromNode || transcriptTextFromElement || fallbackText;

        if (plainText.trim()) {
          payload = {
            plainText,
            html: plainTextToHTML(plainText),
          };
        }
      } else {
        const sectionElement = getSectionElementByTab(activeCopyItem.tabKey);
        const stripReferences = activeCopyItem.tabKey === 'summary';

        if (sectionElement) {
          payload = buildPayloadFromElement(sectionElement, { stripReferences });
        } else if (activeCopyItem.node) {
          const rawPlainText = buildCopyText(activeCopyItem.node);
          const plainText = stripReferences
            ? stripTranscriptReferences(rawPlainText)
            : rawPlainText;

          if (plainText) {
            payload = {
              plainText,
              html: plainTextToHTML(plainText),
            };
          }
        }
      }
    }

    if (!payload?.plainText.trim()) {
      return false;
    }

    let copied = await writePayloadToClipboard(payload);

    if (!copied) {
      isProgrammaticCopyRef.current = true;
      copied = fallbackCopyWithExecCommand(payload);
      isProgrammaticCopyRef.current = false;
    }

    if (copied) {
      notify.success(t(activeCopyItem.successKey));
    }

    return copied;
  }, [
    activeCopyItem,
    buildPayloadFromElement,
    fallbackCopyWithExecCommand,
    getSectionElementByTab,
    resolveSpeakerName,
    t,
    writePayloadToClipboard,
  ]);

  // Intercept native copy events within the meeting block to strip references
  useEffect(() => {
    const handleSelectionCopy = (event: ClipboardEvent) => {
      if (isProgrammaticCopyRef.current) return;
      if (!event.clipboardData) return;

      const contentElement = contentRef.current;

      if (!contentElement) return;

      const selection = window.getSelection();

      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;

      for (let index = 0; index < selection.rangeCount; index += 1) {
        const range = selection.getRangeAt(index);

        if (!isRangeInsideElement(range, contentElement)) {
          return;
        }
      }

      const transcriptElement = getSectionElementByTab('transcript');
      let isTranscriptSelection = Boolean(transcriptElement);

      if (transcriptElement) {
        for (let index = 0; index < selection.rangeCount; index += 1) {
          const range = selection.getRangeAt(index);

          if (!isRangeInsideElement(range, transcriptElement)) {
            isTranscriptSelection = false;
            break;
          }
        }
      }

      if (isTranscriptSelection) {
        const plainText = stripTranscriptReferences(normalizePlainText(selection.toString())).trim();

        if (!plainText) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        event.clipboardData.setData('text/plain', plainText);
        event.clipboardData.setData('text/html', plainTextToHTML(plainText));
        return;
      }

      const summaryElement = getSectionElementByTab('summary');
      let isSummarySelection = Boolean(summaryElement);

      if (summaryElement) {
        for (let index = 0; index < selection.rangeCount; index += 1) {
          const range = selection.getRangeAt(index);

          if (!isRangeInsideElement(range, summaryElement)) {
            isSummarySelection = false;
            break;
          }
        }
      }

      const payload = buildSelectionPayload(selection, { stripReferences: isSummarySelection });

      if (!payload.plainText) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      event.clipboardData.setData('text/plain', payload.plainText);

      if (payload.html) {
        event.clipboardData.setData('text/html', payload.html);
      }
    };

    document.addEventListener('copy', handleSelectionCopy, true);

    return () => {
      document.removeEventListener('copy', handleSelectionCopy, true);
    };
  }, [buildSelectionPayload, contentRef, getSectionElementByTab]);

  return {
    handleCopy,
    getSectionElementByTab,
  };
}
