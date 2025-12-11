import { FC, forwardRef, memo, SVGProps, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Node } from 'slate';
import { useReadOnly, useSlateStatic } from 'slate-react';

import { BlockType } from '@/application/types';
import { ReactComponent as AIMeetingSummaryIcon } from '@/assets/icons/ai_meeting_summary.svg';
import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';
import { ReactComponent as TranscriptionIcon } from '@/assets/icons/transcription.svg';

import LoadingDots from '@/components/_shared/LoadingDots';
import { AIMeetingNode, EditorElementProps } from '@/components/editor/editor.type';
import { useEditorContext } from '@/components/editor/EditorContext';
import { cn } from '@/lib/utils';

import { AudioUpload } from './components/AudioUpload';
// TODO(nathan): Re-enable EmptyState when feature is ready
// import { EmptyState } from './components/EmptyState';
import { DetailLevel } from './components/RegenerateMenu';
import { TabActions } from './components/TabActions';
import { AIMeetingService } from './services';
import {
  getCachedTemplates,
  isCacheExpired,
  setCachedTemplates,
} from './services/template-cache';
import {
  buildSummaryPrompt,
  SummaryInstruction,
  SummaryTemplate,
  SummaryTemplateResult,
  SummaryTemplateSection,
  TranscriptionOptions,
  TranscriptionResult,
} from './services/types';
import {
  // TODO(nathan): Re-enable createNotesContent when EmptyState is re-enabled
  // createNotesContent,
  createSpeakerNodesFromTranscription,
  extractMeetingContent,
  updateMeetingTitle,
  updateSummaryContent,
} from './utils';

type TabType = 'summary' | 'notes' | 'transcript';

interface TabConfig {
  id: TabType;
  labelKey: string;
  blockType: BlockType;
  dataBlockType: string;
  Icon: FC<SVGProps<SVGSVGElement>>;
}

const TAB_CONFIGS: TabConfig[] = [
  {
    id: 'summary',
    labelKey: 'aiMeeting.tabs.summary',
    blockType: BlockType.AIMeetingSummary,
    dataBlockType: 'ai_meeting_summary',
    Icon: AIMeetingSummaryIcon
  },
  {
    id: 'notes',
    labelKey: 'aiMeeting.tabs.notes',
    blockType: BlockType.AIMeetingNotes,
    dataBlockType: 'ai_meeting_notes',
    Icon: EditIcon
  },
  {
    id: 'transcript',
    labelKey: 'aiMeeting.tabs.transcript',
    blockType: BlockType.AIMeetingTranscription,
    dataBlockType: 'ai_meeting_transcription',
    Icon: TranscriptionIcon
  },
];

export const AIMeetingBlock = memo(
  forwardRef<HTMLDivElement, EditorElementProps<AIMeetingNode>>(
    ({ node, children, ...attributes }, ref) => {
      const { t } = useTranslation();
      const editor = useSlateStatic();
      const readOnly = useReadOnly();
      const { workspaceId, viewId, requestInstance } = useEditorContext();
      const { data } = node;

      // API integration state
      const [audioUploadOpen, setAudioUploadOpen] = useState(false);
      const [templates, setTemplates] = useState<SummaryTemplateResult | null>(null);
      const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
      const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
      const [isTranscribing, setIsTranscribing] = useState(false);
      const [transcriptionProgress, setTranscriptionProgress] = useState<number | undefined>(undefined);
      const summaryStreamRef = useRef<{ cancel: () => void } | null>(null);

      // Template selection state for regenerate menu
      const [selectedTemplate, setSelectedTemplate] = useState<SummaryTemplate | null>(null);
      const [_selectedSection, setSelectedSection] = useState<SummaryTemplateSection | null>(null);
      const [selectedDetail, setSelectedDetail] = useState<DetailLevel>('Balanced');
      const [selectedInstruction, setSelectedInstruction] = useState<SummaryInstruction | null>(null);
      const [selectedLanguage, setSelectedLanguage] = useState('en');

      // Create service instance
      const service = useMemo(() => {
        if (!workspaceId || !requestInstance) return null;
        return new AIMeetingService(workspaceId, requestInstance);
      }, [workspaceId, requestInstance]);

      // Cleanup on unmount
      useEffect(() => {
        return () => {
          summaryStreamRef.current?.cancel();
        };
      }, []);

      // Load cached templates once on mount (sync, but fast localStorage read)
      const cachedTemplatesRef = useRef<SummaryTemplateResult | null>(null);
      const hasLoadedCacheRef = useRef(false);

      if (!hasLoadedCacheRef.current) {
        hasLoadedCacheRef.current = true;
        cachedTemplatesRef.current = getCachedTemplates();
      }

      // Fetch templates on mount with stale-while-revalidate caching
      useEffect(() => {
        // Skip if already loaded or loading
        if (templates || isLoadingTemplates) return;

        const cached = cachedTemplatesRef.current;

        // 1. Load cached templates immediately (stale data)
        if (cached) {
          setTemplates(cached);

          // Set default instruction from cache
          const balancedInstruction = cached.instructions.find(i => i.key === 'Balanced');

          if (balancedInstruction) {
            setSelectedInstruction(balancedInstruction);
          }
        }

        // 2. Fetch fresh templates in background (revalidate)
        const fetchFreshTemplates = async () => {
          if (!service) return;

          // Only show loading if no cached data
          if (!cached) {
            setIsLoadingTemplates(true);
          }

          try {
            // Only fetch if cache expired or no cache
            if (!cached || isCacheExpired()) {
              const result = await service.getSummaryTemplates();

              // Update state and cache
              setTemplates(result);
              setCachedTemplates(result);

              // Set default instruction
              const balancedInstruction = result.instructions.find(i => i.key === 'Balanced');

              if (balancedInstruction) {
                setSelectedInstruction(balancedInstruction);
              }
            }
          } catch (error) {
            console.error('[AIMeetingBlock] Failed to load templates:', error);
          } finally {
            setIsLoadingTemplates(false);
          }
        };

        void fetchFreshTemplates();
      }, [service, templates, isLoadingTemplates]);

      // Determine which tabs have content
      // Uses Slate's optimized Node.string() for efficient text extraction
      const tabsWithContent = useMemo(() => {
        const result: TabType[] = [];
        const nodeChildren = node.children || [];

        for (const config of TAB_CONFIGS) {
          const childNode = nodeChildren.find(
            (child) => 'type' in child && child.type === config.blockType
          ) as Node | undefined;

          if (childNode) {
            // Use Slate's Node.string() - much faster than recursive checking
            const textContent = Node.string(childNode);

            if (textContent.trim()) {
              result.push(config.id);
            }
          }
        }

        return result;
      }, [node.children]);

      // Determine which tabs to show (always show notes tab like desktop)
      const tabsToShow = useMemo(() => {
        const tabs = new Set<TabType>(tabsWithContent);

        // Always show notes tab (matches desktop behavior)
        tabs.add('notes');

        if (tabsWithContent.includes('notes') || tabsWithContent.includes('transcript')) {
          // This allows users to navigate to summary tab and generate a summary
          tabs.add('summary');
        }

        // Return in consistent order: summary, notes, transcript
        return TAB_CONFIGS.map(c => c.id).filter(id => tabs.has(id));
      }, [tabsWithContent]);

      // Get default tab - prefer summary, then transcript, then notes
      const defaultTab = useMemo(() => {
        if (tabsWithContent.includes('summary')) {
          return 'summary';
        }

        if (tabsWithContent.includes('transcript')) {
          return 'transcript';
        }

        return tabsWithContent[0] || 'notes';
      }, [tabsWithContent]);

      const [activeTab, setActiveTab] = useState<TabType>(defaultTab);

      // Keep active tab in sync when available tabs change (e.g., new content adds new tabs)
      useEffect(() => {
        if (tabsToShow.length === 0) return;

        if (!tabsToShow.includes(activeTab)) {
          const nextTab = tabsToShow.includes(defaultTab) ? defaultTab : tabsToShow[0];

          setActiveTab(nextTab);
        }
      }, [tabsToShow, defaultTab, activeTab]);

      const hasAnyContent = tabsToShow.length > 0;
      const title = data?.title?.trim();
      const date = data?.date;

      // Get active data-block-type for CSS targeting
      const activeDataBlockType = TAB_CONFIGS.find((c) => c.id === activeTab)?.dataBlockType || '';

      // Handle title change
      const handleTitleChange = useCallback(
        (newTitle: string) => {
          updateMeetingTitle(editor, node, newTitle);
        },
        [editor, node]
      );

      // Generate summary from template
      const handleGenerateSummary = useCallback(
        async (template: SummaryTemplate, instruction: SummaryInstruction, fixedPrompt: string) => {
          if (!service) return;

          setIsGeneratingSummary(true);

          // Store the selections for regenerate menu
          setSelectedTemplate(template);
          setSelectedInstruction(instruction);

          // Build custom prompt using Flutter's format
          const customPrompt = buildSummaryPrompt({
            fixedPrompt,
            instructionPrompt: instruction.value,
            templatePrompt: template.prompt,
            languageCode: selectedLanguage,
          });

          // Extract content from transcript and notes
          const content = extractMeetingContent(node);

          if (!content.trim()) {
            console.warn('[AIMeetingBlock] No content to summarize');
            setIsGeneratingSummary(false);
            return;
          }

          try {
            const { cancel, streamPromise } = await service.generateSummary(
              content,
              {
                customPrompt,
                objectId: viewId,
              },
              (text, done) => {
                // Update summary content as it streams
                updateSummaryContent(editor, node, text, done);

                if (done) {
                  setIsGeneratingSummary(false);
                  summaryStreamRef.current = null;
                }
              }
            );

            summaryStreamRef.current = { cancel };
            await streamPromise;
          } catch (error) {
            console.error('[AIMeetingBlock] Failed to generate summary:', error);
            setIsGeneratingSummary(false);
          }
        },
        [service, editor, node, selectedLanguage, viewId]
      );

      // Handle regenerate with current selections or defaults
      const handleRegenerate = useCallback(async () => {
        if (!templates) {
          console.warn('[AIMeetingBlock] Templates not loaded yet');
          return;
        }

        // Use selected template or default to first template
        const template = selectedTemplate || templates.sections[0]?.templates[0];
        // Use selected instruction or default to "Balanced"
        const instruction = selectedInstruction || templates.instructions.find(i => i.key === 'Balanced') || templates.instructions[0];

        if (!template || !instruction) {
          console.warn('[AIMeetingBlock] No template or instruction available');
          return;
        }

        await handleGenerateSummary(template, instruction, templates.fixed_prompt);
      }, [templates, selectedTemplate, selectedInstruction, handleGenerateSummary]);

      // Handle template selection from RegenerateMenu
      const handleTemplateSelect = useCallback((template: SummaryTemplate, section: SummaryTemplateSection) => {
        setSelectedTemplate(template);
        setSelectedSection(section);

        // Auto-regenerate if we have all required data
        if (templates && selectedInstruction) {
          void handleGenerateSummary(template, selectedInstruction, templates.fixed_prompt);
        }
      }, [templates, selectedInstruction, handleGenerateSummary]);

      // Handle detail level selection from RegenerateMenu
      const handleDetailSelect = useCallback((detail: DetailLevel, instruction: SummaryInstruction) => {
        setSelectedDetail(detail);
        setSelectedInstruction(instruction);

        // Auto-regenerate if we have all required data
        if (templates && selectedTemplate) {
          void handleGenerateSummary(selectedTemplate, instruction, templates.fixed_prompt);
        }
      }, [templates, selectedTemplate, handleGenerateSummary]);

      // Handle language selection from RegenerateMenu
      const handleLanguageSelect = useCallback((languageCode: string) => {
        setSelectedLanguage(languageCode);

        // Auto-regenerate with new language if we have all required data
        if (!service || !templates || !selectedTemplate || !selectedInstruction) {
          return;
        }

        // Need to rebuild prompt with new language
        const customPrompt = buildSummaryPrompt({
          fixedPrompt: templates.fixed_prompt,
          instructionPrompt: selectedInstruction.value,
          templatePrompt: selectedTemplate.prompt,
          languageCode,
        });

        // Start generation with new prompt
        setIsGeneratingSummary(true);
        const content = extractMeetingContent(node);

        if (!content.trim()) {
          setIsGeneratingSummary(false);
          return;
        }

        service.generateSummary(
          content,
          { customPrompt, objectId: viewId },
          (text, done) => {
            updateSummaryContent(editor, node, text, done);
            if (done) {
              setIsGeneratingSummary(false);
              summaryStreamRef.current = null;
            }
          }
        ).then(({ cancel, streamPromise }) => {
          summaryStreamRef.current = { cancel };
          return streamPromise;
        }).catch((error) => {
          console.error('[AIMeetingBlock] Failed to regenerate summary:', error);
          setIsGeneratingSummary(false);
        });
      }, [templates, selectedTemplate, selectedInstruction, service, editor, node, viewId]);

      // Get selected template ID for the menu
      const selectedTemplateId = useMemo(() => {
        if (!selectedTemplate) return 'auto';
        return selectedTemplate.prompt_name.toLowerCase().replace(/\s+/g, '_');
      }, [selectedTemplate]);

      // Handle audio upload and transcription
      const handleAudioUpload = useCallback(
        async (file: File, options: TranscriptionOptions) => {
          if (!service) return;

          setIsTranscribing(true);
          setTranscriptionProgress(0);

          // Simulate progress updates since the API doesn't stream progress
          const progressInterval = setInterval(() => {
            setTranscriptionProgress((prev) => {
              if (prev === undefined || prev >= 90) return prev;
              return prev + 10;
            });
          }, 2000);

          try {
            const result: TranscriptionResult = await service.transcribeAudio(file, options);

            setTranscriptionProgress(100);

            // Create speaker nodes from transcription result
            createSpeakerNodesFromTranscription(editor, node, result);
          } catch (error) {
            console.error('[AIMeetingBlock] Failed to transcribe audio:', error);
            throw error; // Re-throw so AudioUpload can show error
          } finally {
            clearInterval(progressInterval);
            setIsTranscribing(false);
            setTranscriptionProgress(undefined);
          }
        },
        [service, editor, node]
      );

      // Format date for display
      const formattedDate = useMemo(() => {
        if (!date) return 'Today';
        const d = new Date(date);
        const today = new Date();

        if (d.toDateString() === today.toDateString()) return 'Today';
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }, [date]);

      // Handle copy to clipboard
      const handleCopy = useCallback(() => {
        const content = extractMeetingContent(node);

        if (content.trim()) {
          void navigator.clipboard.writeText(content);
        }
      }, [node]);

      // Handle open audio upload
      const _handleOpenAudioUpload = useCallback(() => {
        setAudioUploadOpen(true);
      }, []);

      // TODO(nathan): Re-enable handleNewNotes when EmptyState is re-enabled
      // const handleNewNotes = useCallback(() => {
      //   createNotesContent(editor, node);
      // }, [editor, node]);

      return (
        <div
          {...attributes}
          ref={ref}
          className={cn(
            attributes.className,
            'ai-meeting-block my-2 flex flex-col rounded-2xl border border-line-divider bg-fill-list-active'
          )}
        >
          {/* Header - Title + @Date mention */}
          <div className="flex items-center gap-2 px-4 py-3" contentEditable={false}>
            {readOnly ? (
              <h2 className="text-2xl font-semibold leading-9 text-text-primary">
                {title || t('aiMeeting.untitled', 'Meeting')}
              </h2>
            ) : (
              <input
                type="text"
                value={title || ''}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder={t('aiMeeting.untitled', 'Meeting')}
                className="min-w-[80px] max-w-[300px] bg-transparent text-2xl font-semibold leading-9 text-text-primary placeholder:text-text-placeholder focus:outline-none"
                size={Math.max((title || '').length || 7, 7)}
                autoComplete="off"
                data-lpignore="true"
                data-form-type="other"
              />
            )}
            <span className="flex shrink-0 items-center gap-1 pr-2 text-base font-semibold leading-[22px]">
              <span className="text-text-tertiary">@</span>
              <span className="text-text-secondary">{formattedDate}</span>
            </span>
          </div>

          {hasAnyContent ? (
            <>
              {/* Tab bar with actions */}
              <div className="flex items-center justify-between px-5 pb-3" contentEditable={false}>
                {/* Tabs */}
                <div className="flex items-center gap-1">
                  {TAB_CONFIGS.filter((config) => tabsToShow.includes(config.id)).map((config) => {
                    const isActive = activeTab === config.id;

                    return (
                      <button
                        key={config.id}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setActiveTab(config.id);
                        }}
                        className={cn(
                          'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                          isActive
                            ? 'bg-fill-theme-select text-fill-theme-thick'
                            : 'text-text-secondary hover:bg-fill-list-hover'
                        )}
                      >
                        <config.Icon className={cn('h-5 w-5 shrink-0', isActive ? 'text-fill-theme-thick' : 'text-icon-secondary')} />
                        <span>{t(config.labelKey, config.id)}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Tab Actions */}
                <TabActions
                  onRegenerate={handleRegenerate}
                  onCopy={handleCopy}
                  isGenerating={isGeneratingSummary}
                  isLoadingTemplates={isLoadingTemplates}
                  showRegenerate={activeTab === 'summary' && tabsToShow.includes('summary')}
                  readOnly={readOnly}
                  templates={templates}
                  selectedTemplate={selectedTemplateId}
                  selectedDetail={selectedDetail}
                  selectedLanguage={selectedLanguage}
                  onTemplateSelect={handleTemplateSelect}
                  onDetailSelect={handleDetailSelect}
                  onLanguageSelect={handleLanguageSelect}
                />
              </div>

              {/* Content area - editable */}
              <div className="rounded-2xl border border-line-divider bg-bg-body px-4 pb-4 pt-2">
                {/* Generating indicator */}
                {isGeneratingSummary && activeTab === 'summary' && (
                  <div className="flex items-center gap-0 py-1" contentEditable={false}>
                    <span className="text-base font-semibold leading-[22px] text-text-tertiary">
                      {t('aiMeeting.summary.generating', 'Generating')}
                    </span>
                    <LoadingDots
                      className="flex items-center justify-center px-2"
                      colors={['#9327FF', '#e3006d', '#f7931e']}
                    />
                  </div>
                )}
                <div
                  className="ai-meeting-content relative flex flex-col gap-2"
                  data-active-tab={activeDataBlockType}
                >
                  <style>{`
                    .ai-meeting-content > .block-element[data-block-type="ai_meeting_summary"],
                    .ai-meeting-content > .block-element[data-block-type="ai_meeting_notes"],
                    .ai-meeting-content > .block-element[data-block-type="ai_meeting_transcription"] {
                      display: none !important;
                    }
                    .ai-meeting-content[data-active-tab="ai_meeting_summary"] > .block-element[data-block-type="ai_meeting_summary"],
                    .ai-meeting-content[data-active-tab="ai_meeting_notes"] > .block-element[data-block-type="ai_meeting_notes"],
                    .ai-meeting-content[data-active-tab="ai_meeting_transcription"] > .block-element[data-block-type="ai_meeting_transcription"] {
                      display: flex !important;
                    }
                    /* Remove extra styling from block elements inside AI Meeting */
                    .ai-meeting-content .block-element {
                      padding-left: 0 !important;
                      margin-left: 0 !important;
                      border: none !important;
                      border-radius: 0 !important;
                      background-color: transparent !important;
                    }
                    .ai-meeting-content .block-element.selected {
                      background-color: transparent !important;
                    }
                  `}</style>
                  {children}
                </div>
              </div>
            </>
          ) : null}
          {/* TODO(nathan): Re-enable EmptyState when feature is ready
          ) : (
            <div className="rounded-2xl border border-line-divider bg-bg-body">
              <EmptyState
                onNewNotes={handleNewNotes}
                onUploadAudio={handleOpenAudioUpload}
                readOnly={readOnly}
              />
            </div>
          )} */}

          {/* Audio Upload Dialog */}
          <AudioUpload
            open={audioUploadOpen}
            onOpenChange={setAudioUploadOpen}
            onUpload={handleAudioUpload}
            isTranscribing={isTranscribing}
            progress={transcriptionProgress}
          />
        </div>
      );
    }
  )
);

AIMeetingBlock.displayName = 'AIMeetingBlock';
