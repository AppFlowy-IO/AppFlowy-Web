// ============================================
// Summary Templates Types
// ============================================

// Raw API response types (matches backend JSON structure)
export interface SummaryTemplateResultRaw {
  sections: Record<string, SummaryTemplate[]>[];
  instructions: Record<string, string>[];
  fixed_prompt: string;
}

// Transformed types for easier use in UI
export interface SummaryTemplateResult {
  sections: SummaryTemplateSection[];
  instructions: SummaryInstruction[];
  fixed_prompt: string;
}

export interface SummaryTemplateSection {
  section_name: string;
  templates: SummaryTemplate[];
}

export interface SummaryTemplate {
  prompt_name: string;
  prompt: string;
  icon?: string;
}

export interface SummaryInstruction {
  key: string; // 'Brief' | 'Balanced' | 'Detailed'
  value: string;
}

// Transform raw API response to UI-friendly format
export function transformSummaryTemplateResult(raw: SummaryTemplateResultRaw): SummaryTemplateResult {
  const sections: SummaryTemplateSection[] = raw.sections.map(sectionObj => {
    const [sectionName, templates] = Object.entries(sectionObj)[0];

    return {
      section_name: sectionName,
      templates: templates,
    };
  });

  const instructions: SummaryInstruction[] = raw.instructions.map(instructionObj => {
    const [key, value] = Object.entries(instructionObj)[0];

    return { key, value };
  });

  return {
    sections,
    instructions,
    fixed_prompt: raw.fixed_prompt,
  };
}

/**
 * Build the summary prompt from template, instruction, and fixed prompt.
 * Matches Flutter's SummaryTemplates.buildSummaryPrompt() implementation.
 *
 * @param fixedPrompt - The fixed prompt template with ${LANGUAGE_CODE} placeholder
 * @param instructionPrompt - The detail level instruction (Brief/Balanced/Detailed)
 * @param templatePrompt - The meeting type template prompt
 * @param languageCode - The language code to replace in fixed_prompt (e.g., 'en', 'zh-CN')
 * @returns The complete prompt string
 */
export function buildSummaryPrompt({
  fixedPrompt,
  instructionPrompt,
  templatePrompt,
  languageCode,
}: {
  fixedPrompt: string;
  instructionPrompt: string;
  templatePrompt: string;
  languageCode: string;
}): string {
  const prompt = `${fixedPrompt}

Detail Instruction: ${instructionPrompt}

Meeting Type Template Prompt: ${templatePrompt}`;

  // Flutter uppercases the language code: languageCode.toUpperCase()
  return prompt.replace(/\$\{LANGUAGE_CODE\}/g, languageCode.toUpperCase());
}

// ============================================
// Summary Generation Types
// ============================================

// Must match backend CompletionType enum values
export enum CompletionType {
  ImproveWriting = 1,
  SpellingAndGrammar = 2,
  MakeShorter = 3,
  MakeLonger = 4,
  ContinueWriting = 5,
  Explain = 6,
  AskAI = 7,
  CustomPrompt = 8,
}

export interface ResponseFormat {
  output_content: OutputContent;
  output_layout: OutputLayout;
}

export enum OutputContent {
  TEXT = 0,
  JSON = 1,
  TABLE = 2,
}

export enum OutputLayout {
  Paragraph = 0,
  BulletedList = 1,
  NumberedList = 2,
}

export interface CustomPrompt {
  system: string;
}

export interface CompletionMetadata {
  object_id: string;
  workspace_id: string;
  rag_ids?: string[];
  custom_prompt?: CustomPrompt;
  prompt_id?: string;
}

export interface GenerateSummaryPayload {
  text: string;
  completion_type: CompletionType;
  format: ResponseFormat;
  metadata: CompletionMetadata;
}

export interface StreamResponse {
  cancel: () => void;
  streamPromise: Promise<void>;
}

// ============================================
// Transcription Types
// ============================================

export type TranscriptionModel =
  | 'whisper-1'
  | 'gpt-4o-transcribe'
  | 'gpt-4o-mini-transcribe'
  | 'gpt-4o-transcribe-diarize';

export type TranscriptionResponseFormat =
  | 'json'
  | 'text'
  | 'verbose_json'
  | 'diarized_json';

export interface TranscriptionOptions {
  model?: TranscriptionModel;
  language?: string;
  prompt?: string;
  temperature?: number;
  response_format?: TranscriptionResponseFormat;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
  segments?: TranscriptionSegment[];
}

export interface TranscriptionSegment {
  id: string;
  seek?: number;
  start: number;
  end: number;
  text: string;
  speaker?: string;
  tokens?: number[];
  temperature?: number;
  avg_logprob?: number;
  compression_ratio?: number;
  no_speech_prob?: number;
}

// ============================================
// API Response Types
// ============================================

export interface APIResponse<T> {
  code: number;
  data?: T;
  message: string;
}

// ============================================
// Stream Types (matching existing chat implementation)
// ============================================

export enum StreamType {
  META_DATA = '0',
  TEXT = '1',
  IMAGE = '2',
  KEEP_ALIVE_KEY = '3',
  COMMENT = '4',
}
