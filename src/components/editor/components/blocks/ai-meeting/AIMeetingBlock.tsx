import { forwardRef, memo, startTransition, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Element, Node } from 'slate';
import { useReadOnly, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { BlockType } from '@/application/types';
import { ReactComponent as SummaryIcon } from '@/assets/icons/ai_summary_tab.svg';
import { ReactComponent as NotesIcon } from '@/assets/icons/ai_notes.svg';
import { ReactComponent as TranscriptIcon } from '@/assets/icons/ai_meeting_transcript_tab.svg';
import { AIMeetingNode, EditorElementProps } from '@/components/editor/editor.type';
import { notify } from '@/components/_shared/notify';
import { cn } from '@/lib/utils';

import './ai-meeting.scss';

const DEFAULT_TITLE = 'Meeting';

const READONLY_BLOCK_SELECTOR =
  '[data-block-type="ai_meeting_summary"], [data-block-type="ai_meeting_notes"], [data-block-type="ai_meeting_transcription"], [data-block-type="ai_meeting_speaker"]';

const TAB_DEFS = [
  {
    key: 'summary',
    type: BlockType.AIMeetingSummaryBlock,
    labelKey: 'document.aiMeeting.tab.summary',
    Icon: SummaryIcon,
  },
  {
    key: 'notes',
    type: BlockType.AIMeetingNotesBlock,
    labelKey: 'document.aiMeeting.tab.notes',
    Icon: NotesIcon,
  },
  {
    key: 'transcript',
    type: BlockType.AIMeetingTranscriptionBlock,
    labelKey: 'document.aiMeeting.tab.transcript',
    Icon: TranscriptIcon,
  },
] as const;

const hasNodeContent = (node?: Node) => {
  if (!node) return false;

  const text = CustomEditor.getBlockTextContent(node).trim();

  return text.length > 0;
};

export const AIMeetingBlock = memo(
  forwardRef<HTMLDivElement, EditorElementProps<AIMeetingNode>>(
    ({ node, children, className, ...attributes }, ref) => {
      const { t } = useTranslation();
      const editor = useSlateStatic() as YjsEditor;
      const slateReadOnly = useReadOnly();
      const readOnly = slateReadOnly || editor.isElementReadOnly(node as unknown as Element);
      const data = useMemo(() => node.data ?? {}, [node.data]);

      const storedTitle = typeof data.title === 'string' ? data.title.trim() : '';
      const hasStoredTitle = storedTitle.length > 0;
      const defaultTitle = t('document.aiMeeting.titleDefault', { defaultValue: DEFAULT_TITLE });
      const displayTitle = storedTitle || defaultTitle;
      const [title, setTitle] = useState(displayTitle);

      useEffect(() => {
        setTitle(displayTitle);
      }, [displayTitle]);

      const availableTabs = useMemo(() => {
        const childrenList = (node.children ?? []) as Array<Node & { type?: BlockType }>;

        return TAB_DEFS.filter((tab) => {
          const match = childrenList.find((child) => child.type === tab.type);

          if (!match) return false;

          if (
            tab.type === BlockType.AIMeetingSummaryBlock ||
            tab.type === BlockType.AIMeetingTranscriptionBlock
          ) {
            return hasNodeContent(match);
          }

          return true;
        });
      }, [node.children]);

      const showNotesDirectly = Boolean(data.show_notes_directly);
      const showTabs = !showNotesDirectly && availableTabs.length > 1;
      const fallbackTab = availableTabs[0] ?? TAB_DEFS[1];

      const selectedIndex = useMemo(() => {
        const raw = data.selected_tab_index;

        if (typeof raw === 'number' && !Number.isNaN(raw)) return raw;

        if (typeof raw === 'string' && raw.trim()) {
          const parsed = Number(raw);

          if (!Number.isNaN(parsed)) return parsed;
        }

        return 0;
      }, [data.selected_tab_index]);

      const [activeIndex, setActiveIndex] = useState(0);

      useEffect(() => {
        const maxIndex = Math.max(availableTabs.length - 1, 0);
        const safeIndex = Math.min(Math.max(selectedIndex, 0), maxIndex);

        setActiveIndex(safeIndex);
      }, [availableTabs.length, selectedIndex]);

      const notesTab = TAB_DEFS.find((tab) => tab.key === 'notes') ?? fallbackTab;
      const activeTab = showNotesDirectly ? notesTab : (availableTabs[activeIndex] ?? fallbackTab);
      const activeTabKey = activeTab?.key ?? 'notes';

      const commitTitle = useCallback(() => {
        const trimmed = title.trim();

        if (!trimmed) {
          setTitle(displayTitle);
          return;
        }

        if (!hasStoredTitle && trimmed === defaultTitle) {
          setTitle(defaultTitle);
          return;
        }

        if (!readOnly && editor && trimmed !== storedTitle) {
          CustomEditor.setBlockData(editor, node.blockId, { title: trimmed });
        }

        setTitle(trimmed);
      }, [defaultTitle, displayTitle, editor, hasStoredTitle, node.blockId, readOnly, storedTitle, title]);

      const handleTabChange = useCallback(
        (index: number) => {
          setActiveIndex(index);
          if (!readOnly && editor && index !== selectedIndex) {
            CustomEditor.setBlockData(editor, node.blockId, { selected_tab_index: index });
          }
        },
        [editor, node.blockId, readOnly, selectedIndex]
      );

      return (
        <div
          {...attributes}
          ref={ref}
          data-ai-meeting-active={activeTabKey}
          className={cn(
            'ai-meeting-block my-2 overflow-hidden rounded-2xl border border-border-primary bg-fill-list-active',
            className
          )}
        >
          <div className="px-4 py-4" contentEditable={false}>
            <div className="flex flex-wrap items-baseline gap-2">
              <input
                className="min-w-[120px] flex-1 bg-transparent text-3xl font-semibold text-text-primary outline-none"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onBlur={commitTitle}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commitTitle();
                    (event.currentTarget as HTMLInputElement).blur();
                  }
                }}
                disabled={readOnly}
              />
            </div>
          </div>

          <div className="mx-px mb-px rounded-2xl bg-bg-body">
            {showTabs && (
              <div className="ai-meeting-tabs px-4 pt-3" contentEditable={false}>
                <div className="flex flex-wrap items-center gap-2">
                  {availableTabs.map((tab, index) => {
                    const isActive = index === activeIndex;
                    const Icon = tab.Icon;

                    return (
                      <button
                        key={tab.key}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => handleTabChange(index)}
                        className={cn(
                          'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                          isActive
                            ? 'bg-fill-list-active text-text-primary'
                            : 'text-text-secondary hover:bg-fill-list-hover'
                        )}
                      >
                        <Icon
                          className={cn(
                            tab.key === 'notes' ? 'h-4 w-4' : 'h-5 w-5',
                            'text-current'
                          )}
                        />
                        <span>{t(tab.labelKey)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div
              className={cn('ai-meeting-content px-4 pb-4', showTabs ? 'pt-4' : 'pt-2')}
              onClickCapture={(event) => {
                const target = event.target as HTMLElement | null;

                if (!target) return;
                if (!target.closest(READONLY_BLOCK_SELECTOR)) return;
                if (target.closest('.ai-meeting-reference') || target.closest('.ai-meeting-reference-popover')) {
                  return;
                }

                startTransition(() => {
                  notify.info({
                    message: t('document.aiMeeting.readOnlyHint'),
                    showActions: false,
                  });
                });
              }}
            >
              {children}
            </div>
          </div>
        </div>
      );
    }
  )
);

AIMeetingBlock.displayName = 'AIMeetingBlock';
