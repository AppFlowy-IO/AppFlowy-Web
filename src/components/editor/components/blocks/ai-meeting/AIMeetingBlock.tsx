import { IconButton, Tooltip } from '@mui/material';
import { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Element, Node } from 'slate';
import { useReadOnly, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { BlockType } from '@/application/types';
import { ReactComponent as TranscriptIcon } from '@/assets/icons/ai_meeting_transcript_tab.svg';
import { ReactComponent as NotesIcon } from '@/assets/icons/ai_notes.svg';
import { ReactComponent as SummaryIcon } from '@/assets/icons/ai_summary_tab.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { notify } from '@/components/_shared/notify';
import { Popover } from '@/components/_shared/popover';
import { AIMeetingNode, EditorElementProps } from '@/components/editor/editor.type';
import { cn } from '@/lib/utils';

import {
  documentFragmentToHTML,
  isRangeInsideElement,
  normalizeAppFlowyClipboardHTML,
  plainTextToHTML,
  selectionToContextualHTML,
  stripTranscriptReferences,
} from './ai-meeting.utils';
import './ai-meeting.scss';

const DEFAULT_TITLE = 'Meeting';

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

type TabKey = (typeof TAB_DEFS)[number]['key'];

type CopyLabelKey =
  | 'document.aiMeeting.copy.summary'
  | 'document.aiMeeting.copy.notes'
  | 'document.aiMeeting.copy.transcript';
type CopySuccessKey =
  | 'document.aiMeeting.copy.summarySuccess'
  | 'document.aiMeeting.copy.notesSuccess'
  | 'document.aiMeeting.copy.transcriptSuccess';

interface CopyMeta {
  tabKey: TabKey;
  node?: Node;
  labelKey: CopyLabelKey;
  successKey: CopySuccessKey;
  dataBlockType: string;
  hasContent: boolean;
}

const hasNodeContent = (node?: Node) => {
  if (!node) return false;

  const text = CustomEditor.getBlockTextContent(node).trim();

  return text.length > 0;
};

const buildCopyText = (node?: Node) => {
  if (!node || !Element.isElement(node)) return '';

  const lines = node.children
    .map((child) => CustomEditor.getBlockTextContent(child).trim())
    .filter((line) => line.length > 0);

  if (lines.length) return lines.join('\n');

  return CustomEditor.getBlockTextContent(node).trim();
};

const parseSpeakerInfoMap = (raw: unknown) => {
  if (!raw) return null;

  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as Record<string, Record<string, unknown>>;

      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      return null;
    }
  }

  if (typeof raw === 'object') {
    return raw as Record<string, Record<string, unknown>>;
  }

  return null;
};

const getBaseSpeakerId = (speakerId: string) => {
  const [base] = speakerId.split('_');

  return base || speakerId;
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

interface ClipboardPayload {
  plainText: string;
  html: string;
}

interface PayloadBuildOptions {
  stripReferences?: boolean;
}

const normalizePlainText = (text: string) => text.replace(/\u00a0/g, ' ');

export const AIMeetingBlock = memo(
  forwardRef<HTMLDivElement, EditorElementProps<AIMeetingNode>>(
    ({ node, children, className, ...attributes }, ref) => {
      const { t } = useTranslation();
      const editor = useSlateStatic() as YjsEditor;
      const slateReadOnly = useReadOnly();
      const readOnly = slateReadOnly || editor.isElementReadOnly(node as unknown as Element);
      const data = useMemo(() => node.data ?? {}, [node.data]);
      const containerRef = useRef<HTMLDivElement | null>(null);
      const contentRef = useRef<HTMLDivElement | null>(null);
      const setRefs = useCallback(
        (element: HTMLDivElement | null) => {
          containerRef.current = element;
          if (!ref) return;
          if (typeof ref === 'function') {
            ref(element);
          } else {
            ref.current = element;
          }
        },
        [ref]
      );

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
      const speakerInfoMap = useMemo(() => parseSpeakerInfoMap(data.speaker_info_map), [data.speaker_info_map]);
      const unknownSpeakerLabel = t('document.aiMeeting.speakerUnknown');
      const getFallbackSpeakerLabel = useCallback(
        (id: string) => t('document.aiMeeting.speakerFallback', { id }),
        [t]
      );
      const resolveSpeakerName = useCallback(
        (speakerId?: string) => {
          if (!speakerId) return unknownSpeakerLabel;

          const baseId = getBaseSpeakerId(speakerId);
          const info = speakerInfoMap?.[speakerId] ?? speakerInfoMap?.[baseId];
          const name = typeof info?.name === 'string' ? info?.name.trim() : '';

          if (name) return name;

          return getFallbackSpeakerLabel(baseId);
        },
        [getFallbackSpeakerLabel, speakerInfoMap, unknownSpeakerLabel]
      );

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
      const activeTabKey: TabKey = activeTab?.key ?? 'notes';

      const handleLocalTabSwitch = useCallback(
        (tabKey?: string) => {
          if (!tabKey || showNotesDirectly) return;

          const index = availableTabs.findIndex((tab) => tab.key === tabKey);

          if (index < 0) return;

          setActiveIndex(index);
        },
        [availableTabs, showNotesDirectly]
      );

      useEffect(() => {
        const handler = (event: Event) => {
          const element = containerRef.current;

          if (!element) return;

          const target = event.target as HTMLElement | null;

          if (!target) return;
          if (!(target === element || element.contains(target) || target.contains(element))) return;

          const detail = (event as CustomEvent<{ tabKey?: string }>).detail;

          handleLocalTabSwitch(detail?.tabKey);
        };

        document.addEventListener('ai-meeting-switch-tab', handler as EventListener);

        return () => {
          document.removeEventListener('ai-meeting-switch-tab', handler as EventListener);
        };
      }, [handleLocalTabSwitch]);

      const sectionNodes = useMemo(() => {
        const childrenList = (node.children ?? []) as Array<Node & { type?: BlockType }>;
        const summaryNode = childrenList.find((child) => child.type === BlockType.AIMeetingSummaryBlock);
        const notesNode = childrenList.find((child) => child.type === BlockType.AIMeetingNotesBlock);
        const transcriptNode = childrenList.find((child) => child.type === BlockType.AIMeetingTranscriptionBlock);

        return {
          summaryNode,
          notesNode,
          transcriptNode,
        };
      }, [node.children]);

      const activeCopyItem = useMemo<CopyMeta>(() => {
        const nodeByTab: Record<TabKey, Node | undefined> = {
          summary: sectionNodes.summaryNode,
          notes: sectionNodes.notesNode,
          transcript: sectionNodes.transcriptNode,
        };
        const sectionNode = nodeByTab[activeTabKey];
        const meta = COPY_META[activeTabKey];

        return {
          tabKey: activeTabKey,
          node: sectionNode,
          labelKey: meta.labelKey,
          successKey: meta.successKey,
          dataBlockType: meta.dataBlockType,
          hasContent: Boolean(buildCopyText(sectionNode)),
        };
      }, [activeTabKey, sectionNodes.notesNode, sectionNodes.summaryNode, sectionNodes.transcriptNode]);

      const isProgrammaticCopyRef = useRef(false);

      const getSectionElementByTab = useCallback((tabKey: TabKey) => {
        const contentElement = contentRef.current;

        if (!contentElement) return null;

        return contentElement.querySelector<HTMLElement>(
          `.block-element[data-block-type="${COPY_META[tabKey].dataBlockType}"]`
        );
      }, []);

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

      const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
      const menuOpen = Boolean(menuAnchor);
      const handleMenuClose = useCallback(() => setMenuAnchor(null), []);
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
          handleMenuClose();
          return;
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

        handleMenuClose();
      }, [
        activeCopyItem,
        buildPayloadFromElement,
        fallbackCopyWithExecCommand,
        getSectionElementByTab,
        handleMenuClose,
        resolveSpeakerName,
        t,
        writePayloadToClipboard,
      ]);

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
      }, [buildSelectionPayload, getSectionElementByTab]);

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
          ref={setRefs}
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

          <div className="mx-[0.5px] mb-[0.5px] rounded-2xl bg-bg-body">
            {showTabs && (
              <div className="ai-meeting-tabs px-4 pt-3" contentEditable={false}>
                <div className="flex flex-wrap items-center justify-between gap-2">
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
                  <div className="flex items-center gap-2">
                    <IconButton
                      size="small"
                      onClick={(event) => setMenuAnchor(event.currentTarget)}
                      className="rounded-md text-text-secondary hover:bg-fill-list-hover"
                    >
                      <MoreIcon className="h-5 w-5 text-current" />
                    </IconButton>
                    <Popover
                      open={menuOpen}
                      anchorEl={menuAnchor}
                      onClose={handleMenuClose}
                      anchorOrigin={{
                        vertical: 'bottom',
                        horizontal: 'right',
                      }}
                      transformOrigin={{
                        vertical: 'top',
                        horizontal: 'right',
                      }}
                    >
                      <div className="flex w-[240px] flex-col p-2 text-sm">
                        {activeCopyItem.hasContent ? (
                          <button
                            type="button"
                            className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-text-primary hover:bg-fill-list-hover"
                            onClick={() => {
                              void handleCopy();
                            }}
                          >
                            {t(activeCopyItem.labelKey)}
                          </button>
                        ) : (
                          <Tooltip title={t('document.aiMeeting.copy.noContent')}>
                            <span>
                              <button
                                type="button"
                                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-text-tertiary"
                                disabled
                              >
                                {t(activeCopyItem.labelKey)}
                              </button>
                            </span>
                          </Tooltip>
                        )}
                      </div>
                    </Popover>
                  </div>
                </div>
              </div>
            )}

            <div ref={contentRef} className={cn('ai-meeting-content px-4 pb-4', showTabs ? 'pt-4' : 'pt-2')}>
              {children}
            </div>
          </div>
        </div>
      );
    }
  )
);

AIMeetingBlock.displayName = 'AIMeetingBlock';
