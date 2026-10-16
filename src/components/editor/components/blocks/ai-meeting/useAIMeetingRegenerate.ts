import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Element } from 'slate';
import { useReadOnly, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { traverseBlock } from '@/application/slate-yjs/utils/convert';
import { getBlock } from '@/application/slate-yjs/utils/yjs';
import { AIMeetingBlockData, BlockType } from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { useAIEnabled } from '@/components/app/app.hooks';
import { WriterRequest } from '@/components/chat/request/writer-request';
import { AIAssistantType } from '@/components/chat/types/writer';
import { useEditorContext } from '@/components/editor/EditorContext';
import { getAPIErrorCode, getErrorMessage } from '@/utils/errors';

import { initializeMeetingSections, updateMeetingData } from './ai-meeting.import';
import { extractMeetingSummarySources, formatMeetingSummarySources } from './ai-meeting.references';
import {
  buildSpeakerInferenceTranscript,
  getDefaultSpeakers,
  inferMeetingSpeakers,
  mergeSpeakerInference,
  readSpeakerInfoMap,
  resolveMeetingSpeakerName,
} from './ai-meeting.speaker-inference';
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
import { buildCopyText } from './ai-meeting.utils';

import type { SummaryRegenerateTemplateConfig, SummaryTemplateOption } from './ai-meeting.summary-regenerate';

export { SUMMARY_LANGUAGE_OPTIONS, type SummaryTemplateOption };

export function useAIMeetingRegenerate({
  node,
}: {
  node: { blockId: string; data?: AIMeetingBlockData };
}) {
  const { t } = useTranslation();
  const editor = useSlateStatic() as YjsEditor;
  const slateReadOnly = useReadOnly();
  const readOnly = slateReadOnly || Boolean(editor.isElementReadOnly?.(node as Element));
  const { workspaceId, viewId, requestInstance } = useEditorContext();
  const isAIEnabled = useAIEnabled();
  const data = node.data ?? ({} as AIMeetingBlockData);

  const [summaryTemplateConfig, setSummaryTemplateConfig] = useState<SummaryRegenerateTemplateConfig>(
    FALLBACK_SUMMARY_REGENERATE_TEMPLATE_CONFIG
  );
  const [isRegeneratingSummary, setIsRegeneratingSummary] = useState(false);
  const [isPreprocessingSpeakers, setIsPreprocessingSpeakers] = useState(false);
  const [summaryError, setSummaryError] = useState<{ message: string; code?: number }>();
  const dismissSummaryError = useCallback(() => setSummaryError(undefined), []);
  const isRegeneratingRef = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);
  const [regenerateMenuOpen, setRegenerateMenuOpen] = useState(false);
  const handleRegenerateMenuClose = useCallback(() => setRegenerateMenuOpen(false), []);

  const handleCancelSummary = useCallback(() => {
    const controller = activeRequest.current;

    if (!controller) return;
    activeRequest.current = null;
    controller.abort();
    isRegeneratingRef.current = false;
    setIsPreprocessingSpeakers(false);
    setIsRegeneratingSummary(false);
  }, []);

  useEffect(() => {
    setSummaryError(undefined);
    setRegenerateMenuOpen(false);
    return handleCancelSummary;
  }, [editor, handleCancelSummary, isAIEnabled, node.blockId, readOnly, viewId, workspaceId]);

  const selectedSummaryTemplate = getSummaryTemplateId(
    data.summary_template,
    summaryTemplateConfig.templateOptions
  );
  const selectedSummaryDetail = getSummaryDetailId(
    data.summary_detail,
    summaryTemplateConfig.detailOptions
  );
  const selectedSummaryLanguage = getSummaryLanguageCode(data.summary_language);

  const updateSummaryOptions = useCallback(
    (updates: Partial<Pick<AIMeetingBlockData, 'summary_template' | 'summary_detail' | 'summary_language'>>) => {
      if (readOnly) return;
      CustomEditor.setBlockData(editor, node.blockId, updates);
    },
    [editor, node.blockId, readOnly]
  );

  useEffect(() => {
    if (!isAIEnabled) return;

    let cancelled = false;

    void (async () => {
      const remoteConfig = await fetchSummaryRegenerateTemplateConfig(requestInstance ?? undefined);

      if (cancelled || !remoteConfig) return;
      setSummaryTemplateConfig(remoteConfig);
    })();

    return () => {
      cancelled = true;
    };
  }, [isAIEnabled, requestInstance]);

  const handleRegenerateSummary = useCallback(async (overrides?: {
    templateId?: string;
    detailId?: string;
    languageCode?: string;
    skipSummaryIfPresent?: boolean;
  }) => {
    if (!isAIEnabled || readOnly || isRegeneratingRef.current) return;

    // Transcription writes to Yjs before Slate's next render. Read that current
    // tree so automatic summaries include the new paragraphs and their IDs.
    if (!getBlock(node.blockId, editor.sharedRoot)) return;
    initializeMeetingSections(editor, node.blockId);
    let meeting = traverseBlock(node.blockId, editor.sharedRoot);
    let sections = meeting?.children.filter(Element.isElement) ?? [];
    const summaryBlockId = sections.find((section) => section.type === BlockType.AIMeetingSummaryBlock)?.blockId;

    if (!summaryBlockId) return;
    const transcriptNode = sections.find((section) => section.type === BlockType.AIMeetingTranscriptionBlock);
    const notes = buildCopyText(sections.find((section) => section.type === BlockType.AIMeetingNotesBlock));
    let currentData = (meeting?.data ?? {}) as AIMeetingBlockData;
    let speakerInfoMap = readSpeakerInfoMap(currentData.speaker_info_map);
    const speakerLabel = (id: string) => t('document.aiMeeting.speakerFallback', { id, defaultValue: `Speaker ${id}` });
    const unknownLabel = t('document.aiMeeting.speakerUnknown', { defaultValue: 'Unknown speaker' });
    const defaultTitle = t('document.aiMeeting.titleDefault', { defaultValue: 'Meeting' });
    const resolveSpeakerName = (id?: string) => resolveMeetingSpeakerName(id, speakerInfoMap, speakerLabel, unknownLabel);
    const transcript = buildSpeakerInferenceTranscript(transcriptNode, resolveSpeakerName);

    if (!transcript && !notes) {
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

    const languageCode = getSummaryLanguageCode(overrides?.languageCode ?? currentData.summary_language ?? selectedSummaryLanguage);
    const defaultSpeakers = getDefaultSpeakers(transcriptNode, speakerInfoMap, speakerLabel);
    const title = currentData.title?.trim() ?? '';
    const shouldInfer = Boolean(transcript && (Object.keys(defaultSpeakers).length || !title || title === defaultTitle));
    const hasSummary = () => Boolean(buildCopyText(sections.find((section) => section.type === BlockType.AIMeetingSummaryBlock)));

    if (!shouldInfer && overrides?.skipSummaryIfPresent && hasSummary()) return;
    const controller = new AbortController();

    activeRequest.current = controller;

    isRegeneratingRef.current = true;
    setSummaryError(undefined);
    setIsRegeneratingSummary(true);
    CustomEditor.setBlockData(editor, node.blockId, { selected_tab_index: 0, show_notes_directly: false });
    handleRegenerateMenuClose();

    try {
      // Template loading and speaker inference are independent. Start both
      // before waiting for the template used by the final summary.
      const templateConfigRequest = summaryTemplateConfig.fixedPrompt
        ? Promise.resolve(summaryTemplateConfig)
        : fetchSummaryRegenerateTemplateConfig(requestInstance ?? undefined);
      const request = new WriterRequest(workspaceId, viewId, requestInstance ?? undefined);

      if (shouldInfer) {
        setIsPreprocessingSpeakers(true);
        const inference = await inferMeetingSpeakers({
          request,
          transcript,
          defaultSpeakers,
          languageCode,
          notes,
          signal: controller.signal,
          loadWorkspaceMembers: async () => {
            const { loadMentionableUsers } = await import('@/components/database/components/cell/person/useMentionableUsers');

            return loadMentionableUsers(workspaceId);
          },
        });

        if (controller.signal.aborted || !getBlock(node.blockId, editor.sharedRoot)) return;
        // A collaborator may have renamed a speaker/title while inference streamed.
        meeting = traverseBlock(node.blockId, editor.sharedRoot);
        currentData = (meeting?.data ?? {}) as AIMeetingBlockData;
        if (inference) {
          const updates = mergeSpeakerInference({ inference, defaultSpeakers, currentData, speakerLabel, defaultTitle });

          if (Object.keys(updates).length) updateMeetingData(editor, node.blockId, updates);
        }

        setIsPreprocessingSpeakers(false);
      }

      const activeTemplateConfig = (await templateConfigRequest) ?? summaryTemplateConfig;

      // Read the persisted names and paragraph IDs again, including edits made during inference.
      if (controller.signal.aborted || !getBlock(node.blockId, editor.sharedRoot)) return;
      meeting = traverseBlock(node.blockId, editor.sharedRoot);
      sections = meeting?.children.filter(Element.isElement) ?? [];
      currentData = (meeting?.data ?? {}) as AIMeetingBlockData;
      speakerInfoMap = readSpeakerInfoMap(currentData.speaker_info_map);
      if (overrides?.skipSummaryIfPresent && hasSummary()) return;
      const templateId = getSummaryTemplateId(
        overrides?.templateId ?? currentData.summary_template ?? selectedSummaryTemplate,
        activeTemplateConfig.templateOptions
      );
      const detailId = getSummaryDetailId(
        overrides?.detailId ?? currentData.summary_detail ?? selectedSummaryDetail,
        activeTemplateConfig.detailOptions
      );
      const sources = extractMeetingSummarySources({
        transcriptNode: sections.find((section) => section.type === BlockType.AIMeetingTranscriptionBlock),
        notesNode: sections.find((section) => section.type === BlockType.AIMeetingNotesBlock),
        resolveSpeakerName,
      });
      const sourceText = formatMeetingSummarySources(sources);

      if (!sourceText) return;
      const customPrompt = buildSummaryRegeneratePrompt({ templateId, detailId, languageCode, templateConfig: activeTemplateConfig, speakerInfoMap });
      let generatedContent = '';

      const { streamPromise } = await request.fetchAIAssistant(
        {
          inputText: sourceText,
          assistantType: AIAssistantType.CustomPrompt,
          ragIds: [],
          completionHistory: [],
          customPrompt,
          signal: controller.signal,
        },
        (text, comment) => {
          const candidate = text.trim() ? text : comment;

          generatedContent = candidate;
        }
      );

      await streamPromise;

      if (controller.signal.aborted || !getBlock(node.blockId, editor.sharedRoot)) return;

      const normalizedMarkdown = normalizeGeneratedSummaryMarkdown(generatedContent);

      if (!normalizedMarkdown) {
        throw new Error('Empty generated summary');
      }

      const replaced = replaceBlockChildrenWithMarkdown({
        editor,
        blockId: summaryBlockId,
        markdown: normalizedMarkdown,
        referenceBlockIds: new Set(sources.map((source) => source.blockId)),
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
      if (controller.signal.aborted) return;
      const baseMessage = t('document.aiMeeting.regenerate.failed', {
        defaultValue: 'Failed to regenerate summary',
      });
      const reason = getErrorMessage(error, '').trim();
      const message = reason ? `${baseMessage}: ${reason}` : baseMessage;

      console.error('AI meeting regenerate failed:', error);
      setSummaryError({ message, code: getAPIErrorCode(error) });
      notify.error(message);
    } finally {
      // A cancelled request can finish after the user starts another one.
      // Only the current request may clear the new request's loading state.
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        isRegeneratingRef.current = false;
        setIsPreprocessingSpeakers(false);
        setIsRegeneratingSummary(false);
      }
    }
  }, [
    editor,
    handleRegenerateMenuClose,
    isAIEnabled,
    node.blockId,
    readOnly,
    requestInstance,
    selectedSummaryDetail,
    selectedSummaryLanguage,
    selectedSummaryTemplate,
    summaryTemplateConfig,
    t,
    viewId,
    workspaceId,
  ]);

  const handleTranscriptReady = useCallback(
    () => handleRegenerateSummary({ skipSummaryIfPresent: true }),
    [handleRegenerateSummary]
  );

  const handleSummaryOptionSelect = useCallback(
    (updates: Partial<Pick<AIMeetingBlockData, 'summary_template' | 'summary_detail' | 'summary_language'>>) => {
      if (readOnly || isRegeneratingRef.current) return;

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
      readOnly,
      selectedSummaryDetail,
      selectedSummaryLanguage,
      selectedSummaryTemplate,
      summaryTemplateConfig.detailOptions,
      summaryTemplateConfig.templateOptions,
      updateSummaryOptions,
    ]
  );

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

  return {
    isRegeneratingSummary,
    isPreprocessingSpeakers,
    summaryError: summaryError?.message,
    summaryErrorCode: summaryError?.code,
    dismissSummaryError,
    regenerateMenuOpen,
    setRegenerateMenuOpen,
    handleRegenerateMenuClose,
    handleRegenerateSummary,
    handleCancelSummary,
    handleTranscriptReady,
    handleSummaryOptionSelect,
    selectedSummaryTemplate,
    selectedSummaryDetail,
    selectedSummaryLanguage,
    templateSections,
    detailOptions,
    getRegenerateOptionLabel,
    isAIEnabled,
  };
}
