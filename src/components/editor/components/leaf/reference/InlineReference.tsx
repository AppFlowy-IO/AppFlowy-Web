import { memo, useMemo, useState } from 'react';
import { Editor, Element, Node, Text } from 'slate';
import { ReactEditor, useReadOnly, useSlateStatic } from 'slate-react';
import smoothScrollIntoViewIfNeeded from 'smooth-scroll-into-view-if-needed';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { BlockType } from '@/application/types';
import { ReactComponent as NotesIcon } from '@/assets/icons/ai_summary_ref_notes.svg';
import { ReactComponent as TranscriptIcon } from '@/assets/icons/ai_summary_ref_transcript.svg';
import { ReactComponent as WarningIcon } from '@/assets/icons/ai_reference_warning.svg';
import { RichTooltip } from '@/components/_shared/popover';
import { useLeafSelected } from '@/components/editor/components/leaf/leaf.hooks';
import { useTranslation } from 'react-i18next';

import { InlineReferenceData } from './utils';

type ReferenceSourceType = 'transcript' | 'notes';

interface ReferenceBlockStatus {
  blockId: string;
  status: 'exists' | 'deleted';
  content?: string;
  sourceType?: ReferenceSourceType;
  timestamp?: number;
}

const formatTimestamp = (value?: number) => {
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

const normalizeTimestamp = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) return parsed;
  }

  return undefined;
};

const buildContent = (node: Node) => CustomEditor.getBlockTextContent(node).trim();

const findInChildren = (
  node: Node,
  blockId: string,
  sourceType: ReferenceSourceType,
  timestamp?: number
): ReferenceBlockStatus | null => {
  if (!Element.isElement(node)) return null;

  for (const child of node.children) {
    if (!Element.isElement(child)) continue;

    if (child.blockId === blockId) {
      return {
        blockId,
        status: 'exists',
        content: buildContent(child),
        sourceType,
        timestamp,
      };
    }

    const nested = findInChildren(child, blockId, sourceType, timestamp);

    if (nested) return nested;
  }

  return null;
};

const findInTranscript = (node: Element, blockId: string): ReferenceBlockStatus | null => {
  for (const child of node.children) {
    if (!Element.isElement(child)) continue;

    if (child.type === BlockType.AIMeetingSpeakerBlock) {
      const timestamp = normalizeTimestamp((child.data as Record<string, unknown> | undefined)?.timestamp);
      const found = findInChildren(child, blockId, 'transcript', timestamp);

      if (found) return found;
      continue;
    }

    if (child.blockId === blockId) {
      return {
        blockId,
        status: 'exists',
        content: buildContent(child),
        sourceType: 'transcript',
      };
    }

    const nested = findInChildren(child, blockId, 'transcript');

    if (nested) return nested;
  }

  return null;
};

const findInNotes = (node: Element, blockId: string): ReferenceBlockStatus | null => {
  for (const child of node.children) {
    if (!Element.isElement(child)) continue;

    if (child.blockId === blockId) {
      return {
        blockId,
        status: 'exists',
        content: buildContent(child),
        sourceType: 'notes',
      };
    }

    const nested = findInChildren(child, blockId, 'notes');

    if (nested) return nested;
  }

  return null;
};

const getAvailableTabs = (meetingNode: Element) => {
  const children = meetingNode.children ?? [];
  const summaryNode = children.find(
    (child) => Element.isElement(child) && child.type === BlockType.AIMeetingSummaryBlock
  ) as Element | undefined;
  const transcriptNode = children.find(
    (child) => Element.isElement(child) && child.type === BlockType.AIMeetingTranscriptionBlock
  ) as Element | undefined;

  const tabs: Array<'summary' | 'notes' | 'transcript'> = [];

  if (summaryNode && buildContent(summaryNode).length > 0) {
    tabs.push('summary');
  }

  tabs.push('notes');

  if (transcriptNode && buildContent(transcriptNode).length > 0) {
    tabs.push('transcript');
  }

  return tabs;
};

const buildStatuses = (meetingNode: Element, blockIds: string[]): ReferenceBlockStatus[] => {
  const transcriptionNode = meetingNode.children.find(
    (child) => Element.isElement(child) && child.type === BlockType.AIMeetingTranscriptionBlock
  ) as Element | undefined;
  const notesNode = meetingNode.children.find(
    (child) => Element.isElement(child) && child.type === BlockType.AIMeetingNotesBlock
  ) as Element | undefined;

  return blockIds.map((blockId) => {
    if (transcriptionNode) {
      const found = findInTranscript(transcriptionNode, blockId);

      if (found) return found;
    }

    if (notesNode) {
      const found = findInNotes(notesNode, blockId);

      if (found) return found;
    }

    return {
      blockId,
      status: 'deleted',
    };
  });
};

const ReferenceBadge = memo(({ number, hasError }: { number: number; hasError?: boolean }) => {
  return (
    <span
      className={[
        'ai-meeting-reference',
        'inline-flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-medium',
        hasError ? 'border-border-error-thick text-text-error' : 'border-border-primary text-text-secondary',
      ].join(' ')}
    >
      {number}
    </span>
  );
});

ReferenceBadge.displayName = 'ReferenceBadge';

export const InlineReference = memo(
  ({ reference, text, children }: { reference: InlineReferenceData; text: Text; children: React.ReactNode }) => {
    const editor = useSlateStatic();
    const yjsEditor = editor as YjsEditor;
    const { t } = useTranslation();
    const readOnly = useReadOnly() || editor.isElementReadOnly(text as unknown as Element);
    const { isSelected, isCursorBefore, select } = useLeafSelected(text);
    const [open, setOpen] = useState(false);

    const meetingNode = useMemo(() => {
      try {
        const path = ReactEditor.findPath(editor, text);
        const match = Editor.above(editor, {
          at: path,
          match: (n) =>
            !Editor.isEditor(n) && Element.isElement(n) && n.type === BlockType.AIMeetingBlock,
        });

        if (!match) return null;

        return match[0] as Element;
      } catch {
        return null;
      }
    }, [editor, text]);

    const normalizedBlockIds = useMemo(() => {
      const unique = Array.from(new Set(reference.blockIds));

      return unique;
    }, [reference.blockIds]);

    const statuses = useMemo(() => {
      if (!meetingNode || normalizedBlockIds.length === 0) return [];
      return buildStatuses(meetingNode, normalizedBlockIds);
    }, [meetingNode, normalizedBlockIds]);

    const hasDeleted = statuses.some((status) => status.status === 'deleted');
    const popoverContent = useMemo(() => {
      if (!statuses.length) return null;

      return (
        <div
          className="ai-meeting-reference-popover w-[360px] max-w-[360px] max-h-[300px] overflow-y-auto"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {statuses.map((status) => {
            if (status.status === 'deleted') {
              return (
                <div
                  key={status.blockId}
                  className="flex items-center gap-2 px-4 py-3"
                >
                  <ReferenceBadge number={reference.number} hasError />
                  <WarningIcon className="h-4 w-4 text-text-error" />
                  <span className="text-xs text-text-error">{t('document.aiMeeting.reference.deleted')}</span>
                </div>
              );
            }

            const isTranscript = status.sourceType === 'transcript';
            const timestampLabel = isTranscript ? formatTimestamp(status.timestamp) : '';

            return (
              <button
                key={status.blockId}
                type="button"
                className="flex w-full flex-col items-start gap-2 rounded-xl px-4 py-3 text-left hover:bg-fill-list-hover"
                onClick={() => {
                  if (!meetingNode || !status.sourceType) return;

                  let shouldDelayScroll = false;

                  if (meetingNode.blockId) {
                    const tabs = getAvailableTabs(meetingNode);
                    const targetKey = status.sourceType === 'transcript' ? 'transcript' : 'notes';
                    const targetIndex = Math.max(0, tabs.indexOf(targetKey));

                    if (targetIndex >= 0 && Number.isFinite(targetIndex)) {
                      const currentIndexRaw = (meetingNode.data as Record<string, unknown> | undefined)
                        ?.selected_tab_index;
                      const currentIndex =
                        typeof currentIndexRaw === 'number'
                          ? currentIndexRaw
                          : typeof currentIndexRaw === 'string'
                            ? Number(currentIndexRaw)
                            : NaN;

                      shouldDelayScroll = !Number.isNaN(currentIndex) ? currentIndex !== targetIndex : true;
                      CustomEditor.setBlockData(yjsEditor, meetingNode.blockId, {
                        selected_tab_index: targetIndex,
                      });
                    }
                  }

                  const scrollToTarget = () => {
                    const entry = findSlateEntryByBlockId(yjsEditor, status.blockId);

                    if (entry) {
                      const [node] = entry;
                      const dom = ReactEditor.toDOMNode(editor, node);

                      void smoothScrollIntoViewIfNeeded(dom, {
                        behavior: 'smooth',
                        scrollMode: 'if-needed',
                        block: 'center',
                      });
                      dom.className += ' highlight-block';
                      setTimeout(() => {
                        dom.className = dom.className.replace('highlight-block', '');
                      }, 5000);
                    }
                  };

                  if (shouldDelayScroll) {
                    setTimeout(scrollToTarget, 80);
                  } else {
                    scrollToTarget();
                  }

                  setOpen(false);
                }}
              >
                <div className="flex items-center gap-2">
                  <ReferenceBadge number={reference.number} />
                  {isTranscript ? (
                    <TranscriptIcon className="h-4 w-4 text-icon-secondary" />
                  ) : (
                    <NotesIcon className="h-4 w-4 text-icon-secondary" />
                  )}
                  {timestampLabel && (
                    <span className="inline-flex items-center rounded-md bg-fill-list-active px-2 py-[1px] text-[11px] text-text-secondary">
                      {timestampLabel}
                    </span>
                  )}
                </div>
                {status.content && (
                  <div className="text-sm text-text-primary whitespace-pre-wrap break-words">
                    {status.content}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      );
    }, [editor, meetingNode, reference.number, statuses, t, yjsEditor]);

    if (!meetingNode || normalizedBlockIds.length === 0) {
      return <>{children}</>;
    }

    const tooltipLabel = hasDeleted
      ? t('document.aiMeeting.reference.deletedTooltip')
      : t('document.aiMeeting.reference.sourcesTooltip');

    return (
      <>
        <span
          style={{
            left: isCursorBefore ? 0 : 'auto',
            right: isCursorBefore ? 'auto' : 0,
            top: isCursorBefore ? 0 : 'auto',
            bottom: isCursorBefore ? 'auto' : 0,
          }}
          className={'absolute right-0 bottom-0 overflow-hidden !text-transparent pointer-events-none'}
        >
          {children}
        </span>
        <RichTooltip
          open={open}
          onClose={() => setOpen(false)}
          placement="bottom-start"
          PaperProps={{
            className: 'bg-background-primary shadow-md',
          }}
          content={popoverContent ?? <div />}
        >
          <span
            contentEditable={false}
            className={[
              'ai-meeting-reference inline-flex items-center ml-1',
              (isSelected || open) && 'rounded-full bg-fill-list-active',
            ].join(' ')}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation();

              if (!readOnly) {
                select();
              }

              if (popoverContent) {
                setOpen((prev) => !prev);
              }
            }}
            title={tooltipLabel}
            aria-label={tooltipLabel}
          >
            <ReferenceBadge number={reference.number} hasError={hasDeleted} />
          </span>
        </RichTooltip>
      </>
    );
  }
);

InlineReference.displayName = 'InlineReference';
