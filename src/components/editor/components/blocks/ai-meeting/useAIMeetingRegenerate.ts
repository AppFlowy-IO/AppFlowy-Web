import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Element, Node } from 'slate';
import { useReadOnly, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { AIMeetingBlockData } from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { WriterRequest } from '@/components/chat/request';
import { AIAssistantType } from '@/components/chat/types';
import { useEditorContext } from '@/components/editor/EditorContext';

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
import type { SummaryRegenerateTemplateConfig, SummaryTemplateOption } from './ai-meeting.summary-regenerate';
import { buildCopyText, buildTranscriptCopyText } from './ai-meeting.utils';

export { SUMMARY_LANGUAGE_OPTIONS, type SummaryTemplateOption };

export function useAIMeetingRegenerate({
  node,
  sectionNodes,
  resolveSpeakerName,
  speakerInfoMap,
}: {
  node: { blockId: string; data?: AIMeetingBlockData };
  sectionNodes: {
    summaryNode?: Node;
    notesNode?: Node;
    transcriptNode?: Node;
  };
  resolveSpeakerName: (speakerId?: string) => string;
  speakerInfoMap: Record<string, Record<string, unknown>> | null;
}) {
  const { t } = useTranslation();
  const editor = useSlateStatic() as YjsEditor;
  const readOnly = useReadOnly();
  const { workspaceId, viewId, requestInstance } = useEditorContext();
  const data = node.data ?? ({} as AIMeetingBlockData);

  const [summaryTemplateConfig, setSummaryTemplateConfig] = useState<SummaryRegenerateTemplateConfig>(
    FALLBACK_SUMMARY_REGENERATE_TEMPLATE_CONFIG
  );
  const [isRegeneratingSummary, setIsRegeneratingSummary] = useState(false);
  const isRegeneratingRef = useRef(false);
  const [regenerateMenuAnchor, setRegenerateMenuAnchor] = useState<HTMLElement | null>(null);
  const regenerateMenuOpen = Boolean(regenerateMenuAnchor);
  const handleRegenerateMenuClose = useCallback(() => setRegenerateMenuAnchor(null), []);

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

  const handleRegenerateSummary = useCallback(async (overrides?: {
    templateId?: string;
    detailId?: string;
    languageCode?: string;
  }) => {
    if (readOnly || isRegeneratingRef.current) return;

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

    isRegeneratingRef.current = true;
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
      isRegeneratingRef.current = false;
      setIsRegeneratingSummary(false);
    }
  }, [
    editor,
    handleRegenerateMenuClose,
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
    regenerateMenuAnchor,
    regenerateMenuOpen,
    setRegenerateMenuAnchor,
    handleRegenerateMenuClose,
    handleRegenerateSummary,
    handleSummaryOptionSelect,
    selectedSummaryTemplate,
    selectedSummaryDetail,
    selectedSummaryLanguage,
    templateSections,
    detailOptions,
    getRegenerateOptionLabel,
  };
}
