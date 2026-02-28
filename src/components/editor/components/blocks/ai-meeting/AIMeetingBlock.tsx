import { CircularProgress, IconButton, Tooltip } from '@mui/material';
import { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Element, Node } from 'slate';
import { useReadOnly, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { AIMeetingBlockData, BlockType } from '@/application/types';
import { ReactComponent as TranscriptIcon } from '@/assets/icons/ai_meeting_transcript_tab.svg';
import { ReactComponent as NotesIcon } from '@/assets/icons/ai_notes.svg';
import { ReactComponent as RegenerateIcon } from '@/assets/icons/ai_summary.svg';
import { ReactComponent as SummaryIcon } from '@/assets/icons/ai_summary_tab.svg';
import { ReactComponent as TemplateApplyIcon } from '@/assets/icons/ai_template_apply.svg';
import { ReactComponent as ArrowDownIcon } from '@/assets/icons/alt_arrow_down_small.svg';
import { ReactComponent as CheckIcon } from '@/assets/icons/check.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { notify } from '@/components/_shared/notify';
import { Popover } from '@/components/_shared/popover';
import { WriterRequest } from '@/components/chat/request';
import { AIAssistantType } from '@/components/chat/types';
import { AIMeetingNode, EditorElementProps } from '@/components/editor/editor.type';
import { useEditorContext } from '@/components/editor/EditorContext';
import { cn } from '@/lib/utils';

import {
  buildSummaryRegeneratePrompt,
  FALLBACK_SUMMARY_REGENERATE_TEMPLATE_CONFIG,
  fetchSummaryRegenerateTemplateConfig,
  getSummaryDetailId,
  getSummaryLanguageCode,
  getSummaryTemplateId,
  normalizeGeneratedSummaryMarkdown,
  replaceBlockChildrenWithMarkdown,
  SUMMARY_LANGUAGE_OPTIONS,
} from './ai-meeting.summary-regenerate';
import type { SummaryTemplateOption } from './ai-meeting.summary-regenerate';
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
      const { workspaceId, viewId, requestInstance } = useEditorContext();
      const slateReadOnly = useReadOnly();
      const readOnly = slateReadOnly || editor.isElementReadOnly(node as unknown as Element);
      const data = node.data ?? {};
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
        if (readOnly) return 0;

        const raw = data.selected_tab_index;

        if (typeof raw === 'number' && !Number.isNaN(raw)) return raw;

        if (typeof raw === 'string' && raw.trim()) {
          const parsed = Number(raw);

          if (!Number.isNaN(parsed)) return parsed;
        }

        return 0;
      }, [readOnly, data.selected_tab_index]);

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

      const [summaryTemplateConfig, setSummaryTemplateConfig] = useState(
        FALLBACK_SUMMARY_REGENERATE_TEMPLATE_CONFIG
      );

      const selectedSummaryTemplate = getSummaryTemplateId(
        data.summary_template,
        summaryTemplateConfig.templateOptions
      );
      const selectedSummaryDetail = getSummaryDetailId(
        data.summary_detail,
        summaryTemplateConfig.detailOptions
      );
      const selectedSummaryLanguage = getSummaryLanguageCode(data.summary_language);

      const [isRegeneratingSummary, setIsRegeneratingSummary] = useState(false);
      const [regenerateMenuAnchor, setRegenerateMenuAnchor] = useState<HTMLElement | null>(null);
      const regenerateMenuOpen = Boolean(regenerateMenuAnchor);
      const handleRegenerateMenuClose = useCallback(() => setRegenerateMenuAnchor(null), []);

      const updateSummaryOptions = useCallback(
        (updates: Partial<Pick<AIMeetingBlockData, 'summary_template' | 'summary_detail' | 'summary_language'>>) => {
          if (readOnly) return;
          CustomEditor.setBlockData(editor, node.blockId, updates);
        },
        [editor, node.blockId, readOnly]
      );

      useEffect(() => {
        let cancelled = false;

        void (async () => {
          const remoteConfig = await fetchSummaryRegenerateTemplateConfig(requestInstance ?? undefined);

          if (cancelled || !remoteConfig) return;
          setSummaryTemplateConfig(remoteConfig);
        })();

        return () => {
          cancelled = true;
        };
      }, [requestInstance]);

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

      const handleRegenerateSummary = useCallback(async (overrides?: {
        templateId?: string;
        detailId?: string;
        languageCode?: string;
      }) => {
        if (readOnly || isRegeneratingSummary) return;

        const summaryBlockId = (sectionNodes.summaryNode as (Node & { blockId?: string }) | undefined)?.blockId;

        if (!summaryBlockId) return;

        const transcriptText =
          sectionNodes.transcriptNode && Element.isElement(sectionNodes.transcriptNode)
            ? buildTranscriptCopyText(sectionNodes.transcriptNode, resolveSpeakerName)
            : '';
        const notesText = sectionNodes.notesNode ? buildCopyText(sectionNodes.notesNode) : '';

        if (!transcriptText.trim() && !notesText.trim()) {
          notify.error(
            t('document.aiMeeting.regenerate.noSource', {
              defaultValue: 'No transcript or notes available to regenerate summary',
            })
          );
          return;
        }

        if (!workspaceId || !viewId) {
          notify.error(
            t('document.aiMeeting.regenerate.failed', {
              defaultValue: 'Failed to regenerate summary',
            })
          );
          return;
        }

        const sourceText = [
          transcriptText.trim() ? `Transcript:\n${transcriptText.trim()}` : '',
          notesText.trim() ? `Manual Notes:\n${notesText.trim()}` : '',
        ]
          .filter(Boolean)
          .join('\n\n');
        const templateId = getSummaryTemplateId(
          overrides?.templateId ?? selectedSummaryTemplate,
          summaryTemplateConfig.templateOptions
        );
        const detailId = getSummaryDetailId(
          overrides?.detailId ?? selectedSummaryDetail,
          summaryTemplateConfig.detailOptions
        );
        const languageCode = getSummaryLanguageCode(overrides?.languageCode ?? selectedSummaryLanguage);
        const customPrompt = buildSummaryRegeneratePrompt({
          templateId,
          detailId,
          languageCode,
          templateConfig: summaryTemplateConfig,
          speakerInfoMap,
        });

        setIsRegeneratingSummary(true);
        handleRegenerateMenuClose();

        try {
          const request = new WriterRequest(workspaceId, viewId, requestInstance ?? undefined);
          let generatedContent = '';

          const { streamPromise } = await request.fetchAIAssistant(
            {
              inputText: sourceText,
              assistantType: AIAssistantType.CustomPrompt,
              ragIds: [],
              completionHistory: [],
              customPrompt,
            },
            (text, comment) => {
              const candidate = text.trim() ? text : comment;

              generatedContent = candidate;
            }
          );

          await streamPromise;

          const normalizedMarkdown = normalizeGeneratedSummaryMarkdown(generatedContent);

          if (!normalizedMarkdown) {
            throw new Error('Empty generated summary');
          }

          const replaced = replaceBlockChildrenWithMarkdown({
            editor,
            blockId: summaryBlockId,
            markdown: normalizedMarkdown,
          });

          if (!replaced) {
            throw new Error('Unable to replace summary content');
          }

          notify.success(
            t('document.aiMeeting.regenerate.success', {
              defaultValue: 'Summary regenerated',
            })
          );
        } catch (error) {
          const baseMessage = t('document.aiMeeting.regenerate.failed', {
            defaultValue: 'Failed to regenerate summary',
          });
          const reason =
            error instanceof Error && error.message.trim()
              ? error.message.trim()
              : '';

          console.error('AI meeting regenerate failed:', error);
          notify.error(reason ? `${baseMessage}: ${reason}` : baseMessage);
        } finally {
          setIsRegeneratingSummary(false);
        }
      }, [
        editor,
        handleRegenerateMenuClose,
        isRegeneratingSummary,
        readOnly,
        requestInstance,
        resolveSpeakerName,
        sectionNodes.notesNode,
        sectionNodes.summaryNode,
        sectionNodes.transcriptNode,
        selectedSummaryDetail,
        selectedSummaryLanguage,
        selectedSummaryTemplate,
        speakerInfoMap,
        summaryTemplateConfig,
        t,
        viewId,
        workspaceId,
      ]);

      const handleSummaryOptionSelect = useCallback(
        (updates: Partial<Pick<AIMeetingBlockData, 'summary_template' | 'summary_detail' | 'summary_language'>>) => {
          if (readOnly || isRegeneratingSummary) return;

          updateSummaryOptions(updates);

          const templateId = getSummaryTemplateId(
            updates.summary_template ?? selectedSummaryTemplate,
            summaryTemplateConfig.templateOptions
          );
          const detailId = getSummaryDetailId(
            updates.summary_detail ?? selectedSummaryDetail,
            summaryTemplateConfig.detailOptions
          );
          const languageCode = getSummaryLanguageCode(updates.summary_language ?? selectedSummaryLanguage);

          void handleRegenerateSummary({
            templateId,
            detailId,
            languageCode,
          });
        },
        [
          handleRegenerateSummary,
          isRegeneratingSummary,
          readOnly,
          selectedSummaryDetail,
          selectedSummaryLanguage,
          selectedSummaryTemplate,
          summaryTemplateConfig.detailOptions,
          summaryTemplateConfig.templateOptions,
          updateSummaryOptions,
        ]
      );

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

      const showSummaryRegenerate = activeTabKey === 'summary' && activeCopyItem.hasContent;
      const templateSections = summaryTemplateConfig.templateSections.length
        ? summaryTemplateConfig.templateSections
        : FALLBACK_SUMMARY_REGENERATE_TEMPLATE_CONFIG.templateSections;
      const detailOptions = summaryTemplateConfig.detailOptions.length
        ? summaryTemplateConfig.detailOptions
        : FALLBACK_SUMMARY_REGENERATE_TEMPLATE_CONFIG.detailOptions;
      const getRegenerateOptionLabel = useCallback(
        (option: Pick<SummaryTemplateOption, 'labelKey' | 'defaultLabel'>) =>
          option.labelKey ? t(option.labelKey, { defaultValue: option.defaultLabel }) : option.defaultLabel,
        [t]
      );

      useEffect(() => {
        if (activeTabKey !== 'summary') {
          handleRegenerateMenuClose();
        }
      }, [activeTabKey, handleRegenerateMenuClose]);

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
                    {showSummaryRegenerate && !readOnly && (
                      <>
                        <div className={cn('inline-flex items-stretch', isRegeneratingSummary ? 'opacity-60' : '')}>
                          <button
                            type="button"
                            disabled={isRegeneratingSummary}
                            onClick={() => {
                              void handleRegenerateSummary();
                            }}
                            className={cn(
                              'inline-flex h-8 items-center gap-2 rounded-l-md border border-r-0 border-border-primary py-1.5 pl-4 pr-[10px] text-sm text-text-primary',
                              isRegeneratingSummary
                                ? 'cursor-not-allowed'
                                : 'hover:bg-fill-list-hover'
                            )}
                          >
                            {isRegeneratingSummary ? (
                              <CircularProgress size={16} thickness={4.5} sx={{ color: 'currentColor' }} />
                            ) : (
                              <RegenerateIcon className="h-5 w-5" />
                            )}
                            <span>
                              {isRegeneratingSummary
                                ? t('document.aiMeeting.regenerate.generating', { defaultValue: 'Generating' })
                                : t('document.aiMeeting.regenerate.regenerate', { defaultValue: 'Regenerate' })}
                            </span>
                          </button>
                          <button
                            type="button"
                            disabled={isRegeneratingSummary}
                            onClick={(event) => setRegenerateMenuAnchor(event.currentTarget)}
                            className={cn(
                              'inline-flex h-8 items-center rounded-r-md border border-border-primary px-3 text-text-secondary',
                              isRegeneratingSummary
                                ? 'cursor-not-allowed'
                                : 'hover:bg-fill-list-hover'
                            )}
                          >
                            <ArrowDownIcon className="h-4 w-4" />
                          </button>
                        </div>
                        <Popover
                          open={regenerateMenuOpen}
                          anchorEl={regenerateMenuAnchor}
                          onClose={handleRegenerateMenuClose}
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
                            {templateSections.map((section, sectionIndex) => (
                              <div key={section.id}>
                                <div className="px-2 py-1 text-xs text-text-tertiary">{section.title}</div>
                                {section.options.map((option) => {
                                  const selected = selectedSummaryTemplate === option.id;

                                  return (
                                    <button
                                      key={option.id}
                                      type="button"
                                      className={cn(
                                        'group flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-text-primary hover:bg-fill-list-hover'
                                      )}
                                      onClick={() => handleSummaryOptionSelect({ summary_template: option.id })}
                                    >
                                      <span className="flex items-center gap-2">
                                        {option.icon ? <span>{option.icon}</span> : null}
                                        <span>{getRegenerateOptionLabel(option)}</span>
                                      </span>
                                      {selected ? (
                                        <CheckIcon className="h-4 w-4 text-fill-theme-thick" />
                                      ) : (
                                        <TemplateApplyIcon className="h-4 w-4 text-text-secondary opacity-0 transition-opacity group-hover:opacity-100" />
                                      )}
                                    </button>
                                  );
                                })}
                                {sectionIndex < templateSections.length - 1 && (
                                  <div className="my-1 border-t border-border-primary" />
                                )}
                              </div>
                            ))}
                            <div className="my-1 border-t border-border-primary" />
                            <div className="px-2 py-1 text-xs text-text-tertiary">
                              {t('document.aiMeeting.regenerate.summaryDetail', {
                                defaultValue: 'Summary detail',
                              })}
                            </div>
                            {detailOptions.map((option) => {
                              const selected = selectedSummaryDetail === option.id;

                              return (
                                <button
                                  key={option.id}
                                  type="button"
                                  className={cn(
                                    'group flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-text-primary hover:bg-fill-list-hover'
                                  )}
                                  onClick={() => handleSummaryOptionSelect({ summary_detail: option.id })}
                                >
                                  <span>{getRegenerateOptionLabel(option)}</span>
                                  {selected ? (
                                    <CheckIcon className="h-4 w-4 text-fill-theme-thick" />
                                  ) : (
                                    <TemplateApplyIcon className="h-4 w-4 text-text-secondary opacity-0 transition-opacity group-hover:opacity-100" />
                                  )}
                                </button>
                              );
                            })}
                            <div className="my-1 border-t border-border-primary" />
                            <div className="px-2 py-1 text-xs text-text-tertiary">
                              {t('document.aiMeeting.regenerate.summaryLanguage', {
                                defaultValue: 'Summary language',
                              })}
                            </div>
                            <div className="max-h-[360px] overflow-y-auto">
                              {SUMMARY_LANGUAGE_OPTIONS.map((option) => {
                                const selected =
                                  selectedSummaryLanguage.toLowerCase() === option.code.toLowerCase();

                                return (
                                  <button
                                    key={option.code}
                                    type="button"
                                    className={cn(
                                      'group flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-text-primary hover:bg-fill-list-hover'
                                    )}
                                    onClick={() => handleSummaryOptionSelect({ summary_language: option.code })}
                                  >
                                    <span>{t(option.labelKey, { defaultValue: option.defaultLabel })}</span>
                                    {selected ? (
                                      <CheckIcon className="h-4 w-4 text-fill-theme-thick" />
                                    ) : (
                                      <TemplateApplyIcon className="h-4 w-4 text-text-secondary opacity-0 transition-opacity group-hover:opacity-100" />
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </Popover>
                      </>
                    )}
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
