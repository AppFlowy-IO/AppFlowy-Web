import { memo, useCallback, useMemo, useState } from 'react';
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
import { formatTimestamp } from '@/components/editor/components/blocks/ai-meeting/ai-meeting.utils';
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

const HIGHLIGHT_DURATION_MS = 5000;

const highlightDomElement = (dom: HTMLElement) => {
  dom.classList.add('highlight-block');
  setTimeout(() => {
    dom.classList.remove('highlight-block');
  }, HIGHLIGHT_DURATION_MS);
};

const scrollAndHighlight = (editor: ReactEditor, yjsEditor: YjsEditor, blockId: string) => {
  const entry = findSlateEntryByBlockId(yjsEditor, blockId);

  if (!entry) return;

  const [node] = entry;
  const dom = ReactEditor.toDOMNode(editor, node);

  void smoothScrollIntoViewIfNeeded(dom, {
    behavior: 'smooth',
    scrollMode: 'if-needed',
    block: 'center',
  });
  highlightDomElement(dom);
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

const ReferencePopoverContent = memo(({
  statuses,
  referenceNumber,
  editorReadOnly,
  meetingNode,
  onClose,
}: {
  statuses: ReferenceBlockStatus[];
  referenceNumber: number;
  editorReadOnly: boolean;
  meetingNode: Element;
  onClose: () => void;
}) => {
  const { t } = useTranslation();
  const editor = useSlateStatic() as ReactEditor;
  const yjsEditor = editor as unknown as YjsEditor;

  const handleReferenceClick = useCallback((status: ReferenceBlockStatus) => {
    if (!status.sourceType) return;

    onClose();

    // Wait for popover close animation, then switch tab and scroll
    requestAnimationFrame(() => {
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

          const shouldSwitch = !Number.isNaN(currentIndex) ? currentIndex !== targetIndex : true;

          shouldDelayScroll = shouldSwitch;

          if (editorReadOnly) {
            try {
              const meetingDom = ReactEditor.toDOMNode(editor, meetingNode);
              const inner = meetingDom.querySelector('.ai-meeting-block');
              const target = inner ?? meetingDom;

              target.dispatchEvent(
                new CustomEvent('ai-meeting-switch-tab', {
                  detail: { tabKey: targetKey },
                  bubbles: true,
                })
              );
            } catch {
              // ignore
            }
          } else if (shouldSwitch) {
            CustomEditor.setBlockData(yjsEditor, meetingNode.blockId, {
              selected_tab_index: targetIndex,
            });
          }
        }
      }

      const doScroll = () => scrollAndHighlight(editor, yjsEditor, status.blockId);

      if (shouldDelayScroll) {
        // Allow the tab switch to render before scrolling
        requestAnimationFrame(doScroll);
      } else {
        doScroll();
      }
    });
  }, [editor, editorReadOnly, meetingNode, onClose, yjsEditor]);

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
              <ReferenceBadge number={referenceNumber} hasError />
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
            onClick={() => handleReferenceClick(status)}
          >
            <div className="flex items-center gap-2">
              <ReferenceBadge number={referenceNumber} />
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
});

ReferencePopoverContent.displayName = 'ReferencePopoverContent';

export const InlineReference = memo(
  ({ reference, text, children }: { reference: InlineReferenceData; text: Text; children: React.ReactNode }) => {
    const editor = useSlateStatic();
    const { t } = useTranslation();
    const editorReadOnly = useReadOnly();
    const elementReadOnly = useMemo(() => {
      try {
        const path = ReactEditor.findPath(editor, text);
        const match = Editor.above(editor, {
          at: path,
          match: (n) => !Editor.isEditor(n) && Element.isElement(n),
        });

        if (!match) return false;

        return editor.isElementReadOnly(match[0] as Element);
      } catch {
        return false;
      }
    }, [editor, text]);
    const readOnly = editorReadOnly || elementReadOnly;
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
    const hasStatuses = statuses.length > 0;

    const handleClose = useCallback(() => setOpen(false), []);

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
          onClose={handleClose}
          placement="bottom-start"
          PaperProps={{
            className: 'bg-background-primary shadow-md',
          }}
          content={
            hasStatuses ? (
              <ReferencePopoverContent
                statuses={statuses}
                referenceNumber={reference.number}
                editorReadOnly={editorReadOnly}
                meetingNode={meetingNode}
                onClose={handleClose}
              />
            ) : (
              <div />
            )
          }
        >
          <span
            contentEditable={false}
            className={[
              'ai-meeting-reference inline-flex items-center ml-1 cursor-pointer',
              (isSelected || open) && 'rounded-full bg-fill-list-active',
            ].join(' ')}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation();

              if (!readOnly) {
                select();
              }

              if (hasStatuses) {
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
