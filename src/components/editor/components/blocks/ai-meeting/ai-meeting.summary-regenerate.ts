import { Element, Text } from 'slate';

import { YjsEditor } from '@/application/slate-yjs';
import { slateContentInsertToYData } from '@/application/slate-yjs/utils/convert';
import { assertDocExists, deleteBlock, getBlock, getChildrenArray } from '@/application/slate-yjs/utils/yjs';
import { BlockData, BlockType, YjsEditorKey } from '@/application/types';
import { createInitialInstance, requestInterceptor } from '@/components/chat/lib/requets';
import { parseMarkdown } from '@/components/editor/parsers/markdown-parser';
import { ParsedBlock } from '@/components/editor/parsers/types';

import { parseSummaryReferences } from './ai-meeting.references';

import type { AxiosInstance } from 'axios';

export interface SummaryTemplateOption {
  id: string;
  labelKey?: string;
  defaultLabel: string;
  prompt: string;
  icon?: string;
}

export interface SummaryDetailOption {
  id: string;
  labelKey?: string;
  defaultLabel: string;
  prompt: string;
}

export interface SummaryLanguageOption {
  code: string;
  labelKey: string;
  defaultLabel: string;
}

export const DEFAULT_SUMMARY_TEMPLATE = 'auto';
export const DEFAULT_SUMMARY_DETAIL = 'balanced';
export const DEFAULT_SUMMARY_LANGUAGE = 'en';

export const SUMMARY_TEMPLATE_OPTIONS: SummaryTemplateOption[] = [
  {
    id: 'auto',
    labelKey: 'document.aiMeeting.regenerate.template.auto',
    defaultLabel: 'Auto',
    prompt:
      'Create a structured meeting summary with key outcomes, rationale, and practical follow-ups. Prefer clear headings and bullet lists.',
  },
  {
    id: 'meeting_minutes',
    labelKey: 'document.aiMeeting.regenerate.template.meetingMinutes',
    defaultLabel: 'Meeting minutes',
    prompt:
      'Write formal meeting minutes. Focus on chronology, decisions, attendees mentioned in context, and action ownership.',
  },
  {
    id: 'action_focused',
    labelKey: 'document.aiMeeting.regenerate.template.actionFocused',
    defaultLabel: 'Action focused',
    prompt:
      'Prioritize actionable outcomes. Emphasize next steps, owners, deadlines, and risks that can block execution.',
  },
  {
    id: 'executive',
    labelKey: 'document.aiMeeting.regenerate.template.executive',
    defaultLabel: 'Executive',
    prompt:
      'Write an executive-level summary with concise business impact, major decisions, and strategic implications.',
  },
];

export const SUMMARY_DETAIL_OPTIONS: SummaryDetailOption[] = [
  {
    id: 'concise',
    labelKey: 'document.aiMeeting.regenerate.detail.concise',
    defaultLabel: 'Concise',
    prompt: 'Keep it short and high-signal. Minimize wording and avoid repetition.',
  },
  {
    id: 'balanced',
    labelKey: 'document.aiMeeting.regenerate.detail.balanced',
    defaultLabel: 'Balanced',
    prompt: 'Keep a balanced level of detail suitable for cross-functional collaboration.',
  },
  {
    id: 'detailed',
    labelKey: 'document.aiMeeting.regenerate.detail.detailed',
    defaultLabel: 'Detailed',
    prompt: 'Provide comprehensive detail, including context, tradeoffs, and nuanced decisions.',
  },
];

export const SUMMARY_LANGUAGE_OPTIONS: SummaryLanguageOption[] = [
  { code: 'en', labelKey: 'document.aiMeeting.regenerate.language.english', defaultLabel: 'English' },
  { code: 'zh-CN', labelKey: 'document.aiMeeting.regenerate.language.chineseSimplified', defaultLabel: 'Chinese (Simplified)' },
  { code: 'zh-TW', labelKey: 'document.aiMeeting.regenerate.language.chineseTraditional', defaultLabel: 'Chinese (Traditional)' },
  { code: 'es', labelKey: 'document.aiMeeting.regenerate.language.spanish', defaultLabel: 'Spanish' },
  { code: 'fr', labelKey: 'document.aiMeeting.regenerate.language.french', defaultLabel: 'French' },
  { code: 'de', labelKey: 'document.aiMeeting.regenerate.language.german', defaultLabel: 'German' },
  { code: 'ja', labelKey: 'document.aiMeeting.regenerate.language.japanese', defaultLabel: 'Japanese' },
  { code: 'ko', labelKey: 'document.aiMeeting.regenerate.language.korean', defaultLabel: 'Korean' },
  { code: 'pt', labelKey: 'document.aiMeeting.regenerate.language.portuguese', defaultLabel: 'Portuguese' },
  { code: 'ru', labelKey: 'document.aiMeeting.regenerate.language.russian', defaultLabel: 'Russian' },
  { code: 'th', labelKey: 'document.aiMeeting.regenerate.language.thai', defaultLabel: 'Thai' },
  { code: 'vi', labelKey: 'document.aiMeeting.regenerate.language.vietnamese', defaultLabel: 'Vietnamese' },
  { code: 'da', labelKey: 'document.aiMeeting.regenerate.language.danish', defaultLabel: 'Danish' },
  { code: 'fi', labelKey: 'document.aiMeeting.regenerate.language.finnish', defaultLabel: 'Finnish' },
  { code: 'no', labelKey: 'document.aiMeeting.regenerate.language.norwegian', defaultLabel: 'Norwegian' },
  { code: 'nl', labelKey: 'document.aiMeeting.regenerate.language.dutch', defaultLabel: 'Dutch' },
  { code: 'it', labelKey: 'document.aiMeeting.regenerate.language.italian', defaultLabel: 'Italian' },
  { code: 'sv', labelKey: 'document.aiMeeting.regenerate.language.swedish', defaultLabel: 'Swedish' },
];

export interface SummaryTemplateSection {
  id: string;
  title: string;
  options: SummaryTemplateOption[];
}

export interface SummaryRegenerateTemplateConfig {
  templateSections: SummaryTemplateSection[];
  templateOptions: SummaryTemplateOption[];
  detailOptions: SummaryDetailOption[];
  fixedPrompt: string;
}

interface APIResponse<T> {
  code: number;
  data: T;
  message?: string;
}

interface RemoteSummaryTemplateItem {
  prompt_name?: string;
  prompt?: string;
  icon?: string;
}

interface RemoteSummaryTemplateSectionV2 {
  section_name?: string;
  templates?: RemoteSummaryTemplateItem[];
}

type RemoteSummaryTemplateSectionV1 = Record<string, RemoteSummaryTemplateItem[]>;
type RemoteSummaryInstruction = Record<string, string>;

interface RemoteSummaryTemplatePayload {
  sections?: Array<RemoteSummaryTemplateSectionV1 | RemoteSummaryTemplateSectionV2>;
  instructions?: RemoteSummaryInstruction[];
  fixed_prompt?: string;
}

const FALLBACK_TEMPLATE_SECTION_TITLE = 'AI Template';
// Matches Flutter's SummaryTemplates.buildSummaryPrompt reference contract.
const SUMMARY_REFERENCE_INSTRUCTIONS = [
  '## E. INLINE SOURCE REFERENCES (CRITICAL - ALWAYS APPLY)',
  'Every key claim, decision, action item, or important statement must include an inline reference to its supporting source content.',
  'Source paragraphs are prefixed with [BLOCK:block_id].',
  'Reference format: {ref:block_id} or {ref:block_id1,block_id2}, with comma-separated IDs when multiple sources support the same statement.',
  'References MUST appear at the absolute END of a complete thought, statement, or paragraph, AFTER its final period.',
  'NEVER place a reference in the middle of a paragraph between sentences that form a continuous narrative.',
  'Group sentences about the same topic together and place references ONLY after the FINAL sentence of that entire group.',
  'For example: The interview covered investment and risk. Attendees discussed the outlook. This was an executive interview. {ref:block_id1,block_id2}',
  'Include references for information from Manual Notes, including attendee lists, clarifications, and corrections. Use the supporting notes block IDs.',
  'Use only the exact block IDs supplied in the transcript and notes. Never invent source IDs or numeric citations.',
  'Only cite blocks that directly support the statement. Aim for at least one reference per major point.',
  'Each block ID should only be used ONCE across the entire summary. If several statements share a source, cite it once with the most relevant complete thought.',
  'Do not create a separate Source References or References section. All references must be inline, like footnotes at the end of complete paragraphs or thought units.',
].join('\n');
const SUMMARY_FORMATTING_INSTRUCTIONS = [
  '## Summary presentation',
  'Use sentence case for section headings, for example "Overview", rather than ALL CAPS. Preserve acronyms, proper names, and the requested output language.',
  'Write the Overview as one cohesive paragraph covering the context, participants, purpose, and meeting type when supported by the sources.',
  'Integrate attendees and the detected meeting type naturally into that paragraph instead of separate metadata-style lines or labels.',
  'Use Markdown bold to emphasize meaningful phrases, such as the meeting type or key outcomes, without bolding entire paragraphs.',
  'Use blank lines between headings, paragraphs, and lists. Retain nested bullets for supporting context and details.',
].join('\n');

export const FALLBACK_SUMMARY_REGENERATE_TEMPLATE_CONFIG: SummaryRegenerateTemplateConfig = {
  templateSections: [
    {
      id: 'fallback-ai-template',
      title: FALLBACK_TEMPLATE_SECTION_TITLE,
      options: SUMMARY_TEMPLATE_OPTIONS,
    },
  ],
  templateOptions: SUMMARY_TEMPLATE_OPTIONS,
  detailOptions: SUMMARY_DETAIL_OPTIONS,
  fixedPrompt: '',
};

const TEMPLATE_CONFIG_TTL_MS = 5 * 60 * 1000; // 5 minutes

let remoteTemplateConfigCache: SummaryRegenerateTemplateConfig | null = null;
let remoteTemplateConfigCacheTime = 0;
let remoteTemplateConfigRequest: Promise<SummaryRegenerateTemplateConfig | null> | null = null;

export const clearSummaryRegenerateTemplateConfigCache = () => {
  remoteTemplateConfigCache = null;
  remoteTemplateConfigCacheTime = 0;
  remoteTemplateConfigRequest = null;
};

const languageNameByCode = SUMMARY_LANGUAGE_OPTIONS.reduce<Record<string, string>>((acc, language) => {
  acc[language.code.toLowerCase()] = language.defaultLabel;
  return acc;
}, {});

const normalizeOptionId = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '_');

const createTemplateRequestInstance = (requestInstance?: AxiosInstance | null) => {
  if (requestInstance) return requestInstance;

  const axiosInstance = createInitialInstance();

  axiosInstance.interceptors.request.use(requestInterceptor);
  return axiosInstance;
};

const normalizeRemoteTemplateSections = (
  sections: RemoteSummaryTemplatePayload['sections']
): SummaryTemplateSection[] => {
  if (!Array.isArray(sections)) return [];

  return sections
    .map((section, sectionIndex) => {
      let title = '';
      let templates: RemoteSummaryTemplateItem[] = [];

      if (
        section &&
        typeof section === 'object' &&
        'section_name' in section &&
        Array.isArray((section as RemoteSummaryTemplateSectionV2).templates)
      ) {
        const typedSection = section as RemoteSummaryTemplateSectionV2;

        title = typeof typedSection.section_name === 'string' ? typedSection.section_name.trim() : '';
        templates = typedSection.templates ?? [];
      } else if (section && typeof section === 'object') {
        const [entryKey, entryValue] = Object.entries(section as RemoteSummaryTemplateSectionV1)[0] ?? [];

        title = typeof entryKey === 'string' ? entryKey.trim() : '';
        templates = Array.isArray(entryValue) ? entryValue : [];
      }

      const options = templates
        .map((template) => {
          const defaultLabel = typeof template?.prompt_name === 'string' ? template.prompt_name.trim() : '';
          const prompt = typeof template?.prompt === 'string' ? template.prompt.trim() : '';

          if (!defaultLabel || !prompt) return null;

          return {
            id: normalizeOptionId(defaultLabel),
            defaultLabel,
            prompt,
            icon: typeof template?.icon === 'string' ? template.icon : undefined,
          } as SummaryTemplateOption;
        })
        .filter((option): option is SummaryTemplateOption => Boolean(option));

      if (options.length === 0) return null;

      return {
        id: `remote-section-${sectionIndex}`,
        title: title || `Template ${sectionIndex + 1}`,
        options,
      } as SummaryTemplateSection;
    })
    .filter((section): section is SummaryTemplateSection => Boolean(section));
};

const normalizeRemoteDetailOptions = (
  instructions: RemoteSummaryTemplatePayload['instructions']
): SummaryDetailOption[] => {
  if (!Array.isArray(instructions)) return [];

  return instructions
    .map((instruction) => {
      if (!instruction || typeof instruction !== 'object') return null;
      const [label, prompt] = Object.entries(instruction)[0] ?? [];

      if (typeof label !== 'string' || typeof prompt !== 'string') return null;
      const defaultLabel = label.trim();
      const promptText = prompt.trim();

      if (!defaultLabel || !promptText) return null;

      return {
        id: normalizeOptionId(defaultLabel),
        defaultLabel,
        prompt: promptText,
      } as SummaryDetailOption;
    })
    .filter((option): option is SummaryDetailOption => Boolean(option));
};

const normalizeRemoteTemplateConfig = (
  payload: unknown
): SummaryRegenerateTemplateConfig | null => {
  if (!payload || typeof payload !== 'object') return null;

  const templatePayload = payload as RemoteSummaryTemplatePayload;
  const templateSections = normalizeRemoteTemplateSections(templatePayload.sections);
  const detailOptions = normalizeRemoteDetailOptions(templatePayload.instructions);

  if (templateSections.length === 0 || detailOptions.length === 0) return null;

  const templateOptions = templateSections.flatMap((section) => section.options);
  const fixedPrompt = typeof templatePayload.fixed_prompt === 'string' ? templatePayload.fixed_prompt.trim() : '';

  return {
    templateSections,
    templateOptions,
    detailOptions,
    fixedPrompt,
  };
};

export const fetchSummaryRegenerateTemplateConfig = async (
  requestInstance?: AxiosInstance | null
): Promise<SummaryRegenerateTemplateConfig | null> => {
  const isCacheValid = remoteTemplateConfigCache && (Date.now() - remoteTemplateConfigCacheTime) < TEMPLATE_CONFIG_TTL_MS;

  if (isCacheValid) return remoteTemplateConfigCache;
  if (remoteTemplateConfigRequest) return remoteTemplateConfigRequest;

  remoteTemplateConfigRequest = (async () => {
    try {
      const axiosInstance = createTemplateRequestInstance(requestInstance);
      const response = await axiosInstance.get<APIResponse<unknown> | unknown>('/api/meeting/summary_templates', { timeout: 10_000 });
      const responseData = response.data;
      const payload =
        responseData &&
        typeof responseData === 'object' &&
        'code' in responseData &&
        'data' in responseData
          ? (responseData as APIResponse<unknown>).data
          : responseData;
      const normalized = normalizeRemoteTemplateConfig(payload);

      if (!normalized) return null;

      remoteTemplateConfigCache = normalized;
      remoteTemplateConfigCacheTime = Date.now();
      return normalized;
    } catch {
      return null;
    } finally {
      remoteTemplateConfigRequest = null;
    }
  })();

  return remoteTemplateConfigRequest;
};

export const getSummaryTemplateId = (
  raw: unknown,
  options: SummaryTemplateOption[] = FALLBACK_SUMMARY_REGENERATE_TEMPLATE_CONFIG.templateOptions
) => {
  const fallbackId = options.find((option) => option.id === DEFAULT_SUMMARY_TEMPLATE)?.id || options[0]?.id || DEFAULT_SUMMARY_TEMPLATE;

  if (typeof raw !== 'string' || !raw.trim()) return fallbackId;
  const normalized = raw.trim();
  const normalizedOptionId = normalizeOptionId(normalized);
  const matched = options.find((option) => {
    const optionId = option.id.trim();

    return optionId.toLowerCase() === normalized.toLowerCase() || optionId.toLowerCase() === normalizedOptionId;
  });

  return matched?.id ?? fallbackId;
};

export const getSummaryDetailId = (
  raw: unknown,
  options: SummaryDetailOption[] = FALLBACK_SUMMARY_REGENERATE_TEMPLATE_CONFIG.detailOptions
) => {
  const fallbackId = options.find((option) => option.id === DEFAULT_SUMMARY_DETAIL)?.id || options[0]?.id || DEFAULT_SUMMARY_DETAIL;

  if (typeof raw !== 'string' || !raw.trim()) return fallbackId;
  const normalized = raw.trim();
  const normalizedOptionId = normalizeOptionId(normalized);
  const matched = options.find((option) => {
    const optionId = option.id.trim();

    return optionId.toLowerCase() === normalized.toLowerCase() || optionId.toLowerCase() === normalizedOptionId;
  });

  return matched?.id ?? fallbackId;
};

export const getSummaryLanguageCode = (raw: unknown) => {
  if (typeof raw !== 'string' || !raw.trim()) return DEFAULT_SUMMARY_LANGUAGE;
  const normalized = raw.trim();
  const matched = SUMMARY_LANGUAGE_OPTIONS.find(
    (option) => option.code.toLowerCase() === normalized.toLowerCase()
  );

  return matched?.code ?? DEFAULT_SUMMARY_LANGUAGE;
};

export const buildSummaryRegeneratePrompt = ({
  templateId,
  detailId,
  languageCode,
  templateConfig,
  speakerInfoMap,
}: {
  templateId: string;
  detailId: string;
  languageCode: string;
  templateConfig?: SummaryRegenerateTemplateConfig | null;
  speakerInfoMap?: Record<string, Record<string, unknown>> | null;
}) => {
  const activeTemplateConfig = templateConfig ?? FALLBACK_SUMMARY_REGENERATE_TEMPLATE_CONFIG;
  const templateOptions = activeTemplateConfig.templateOptions.length
    ? activeTemplateConfig.templateOptions
    : FALLBACK_SUMMARY_REGENERATE_TEMPLATE_CONFIG.templateOptions;
  const detailOptions = activeTemplateConfig.detailOptions.length
    ? activeTemplateConfig.detailOptions
    : FALLBACK_SUMMARY_REGENERATE_TEMPLATE_CONFIG.detailOptions;
  const effectiveTemplateId = getSummaryTemplateId(templateId, templateOptions);
  const effectiveDetailId = getSummaryDetailId(detailId, detailOptions);
  const templatePrompt =
    templateOptions.find((option) => option.id === effectiveTemplateId)?.prompt ||
    templateOptions[0]?.prompt ||
    '';
  const detailPrompt =
    detailOptions.find((option) => option.id === effectiveDetailId)?.prompt ||
    detailOptions[0]?.prompt ||
    '';
  const normalizedLanguage = getSummaryLanguageCode(languageCode);
  const languageLabel = languageNameByCode[normalizedLanguage.toLowerCase()] || 'English';
  const hasFixedPrompt = Boolean(activeTemplateConfig.fixedPrompt.trim());

  if (hasFixedPrompt) {
    const participants = Object.values(speakerInfoMap ?? {})
      .map((participant) => {
        const name = typeof participant?.name === 'string' ? participant.name.trim() : '';
        const email = typeof participant?.email === 'string' ? participant.email.trim() : '';

        if (!name || !email) return '';
        return `- ${name} (email: ${email})`;
      })
      .filter((line) => line.length > 0);
    const participantsSection =
      participants.length > 0
        ? ['Meeting Participants:', ...participants].join('\n')
        : '';
    const prompt = [
      activeTemplateConfig.fixedPrompt,
      '',
      `Detail Instruction: ${detailPrompt}`,
      '',
      `Meeting Type Template Prompt: ${templatePrompt}`,
      participantsSection ? `\n${participantsSection}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    return `${prompt.replace(/\$\{LANGUAGE_CODE\}/g, normalizedLanguage.toUpperCase())}\n\n${SUMMARY_REFERENCE_INSTRUCTIONS}\n\n${SUMMARY_FORMATTING_INSTRUCTIONS}`;
  }

  return [
    'You are generating a meeting summary in markdown format.',
    `Output language: ${languageLabel} (${normalizedLanguage}).`,
    `Template style requirement: ${templatePrompt}`,
    `Detail requirement: ${detailPrompt}`,
    'Use markdown headings and bullet lists to keep the summary scannable.',
    'Do not use fenced code blocks in the output.',
    SUMMARY_REFERENCE_INSTRUCTIONS,
    SUMMARY_FORMATTING_INSTRUCTIONS,
    'Suggested section structure:',
    '1. Overview',
    '2. Discussion summary',
    '3. Next steps or future considerations',
    '4. Decisions / Recommendations / Conclusions',
    '5. Action items',
    'For action items, use bullet points and include owner/deadline only if clearly present in source content.',
    'Do not invent facts, attendees, or deadlines.',
  ].join('\n');
};

const parsedBlockToTextNodes = (block: ParsedBlock): Text[] => {
  const { text, formats } = block;

  if (formats.length === 0) {
    return [{ text }];
  }

  const boundaries = new Set<number>([0, text.length]);

  formats.forEach((format) => {
    boundaries.add(format.start);
    boundaries.add(format.end);
  });

  const positions = Array.from(boundaries).sort((a, b) => a - b);
  const nodes: Text[] = [];

  for (let index = 0; index < positions.length - 1; index += 1) {
    const start = positions[index];
    const end = positions[index + 1];
    const segment = text.slice(start, end);

    if (!segment) continue;

    const activeFormats = formats.filter((format) => format.start <= start && format.end >= end);
    const attributes: Record<string, unknown> = {};

    activeFormats.forEach((format) => {
      switch (format.type) {
        case 'bold':
          attributes.bold = true;
          break;
        case 'italic':
          attributes.italic = true;
          break;
        case 'underline':
          attributes.underline = true;
          break;
        case 'strikethrough':
          attributes.strikethrough = true;
          break;
        case 'code':
          attributes.code = true;
          break;
        case 'link':
          attributes.href = format.data?.href;
          break;
        case 'color':
          attributes.font_color = format.data?.color;
          break;
        case 'bgColor':
          attributes.bg_color = format.data?.bgColor;
          break;
      }
    });

    nodes.push({ text: segment, ...attributes } as Text);
  }

  return nodes;
};

const parsedBlockToSlateElement = (block: ParsedBlock, references?: { blockIds: ReadonlySet<string>; counter: Map<string, number> }): Element => {
  const formattedNodes = parsedBlockToTextNodes(block);
  const textNodes = references ? parseSummaryReferences(formattedNodes, references.blockIds, references.counter) : formattedNodes;
  const slateChildren: Element[] = [
    { type: YjsEditorKey.text, children: textNodes } as Element,
    ...block.children.map((child) => parsedBlockToSlateElement(child, references)),
  ];

  return {
    type: block.type,
    data: block.data,
    children: slateChildren,
  } as Element;
};

const buildFallbackParagraph = (): Element => {
  return {
    type: BlockType.Paragraph,
    data: {} as BlockData,
    children: [
      {
        type: YjsEditorKey.text,
        children: [{ text: '' }],
      } as Element,
    ],
  } as Element;
};

export const normalizeGeneratedSummaryMarkdown = (content: string) => {
  const trimmed = content.trim();
  const match = trimmed.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i);

  if (match) return match[1].trim();
  return trimmed;
};

export const replaceBlockChildrenWithMarkdown = ({
  editor,
  blockId,
  markdown,
  referenceBlockIds,
}: {
  editor: YjsEditor;
  blockId: string;
  markdown: string;
  referenceBlockIds?: ReadonlySet<string>;
}) => {
  const parsedBlocks = parseMarkdown(markdown);
  const references = referenceBlockIds ? { blockIds: referenceBlockIds, counter: new Map<string, number>() } : undefined;
  const slateNodes = parsedBlocks.map((block) => parsedBlockToSlateElement(block, references));
  const nodesToInsert = slateNodes.length > 0 ? slateNodes : [buildFallbackParagraph()];

  const parentBlock = getBlock(blockId, editor.sharedRoot);

  if (!parentBlock) return false;

  const childrenArray = getChildrenArray(parentBlock.get(YjsEditorKey.block_children), editor.sharedRoot);

  if (!childrenArray) return false;

  const existingChildIds = childrenArray.toArray();
  const doc = assertDocExists(editor.sharedRoot);

  doc.transact(() => {
    existingChildIds.forEach((childId) => deleteBlock(editor.sharedRoot, childId));
    slateContentInsertToYData(blockId, 0, nodesToInsert, doc);
  });

  return true;
};
