import { BlockType, ImageBlockData } from '@/application/types';
import { OutputContent, OutputContentMetadata, OutputLayout, ResponseFormat } from '@/components/chat/types/request';
import { parseMarkdown } from '@/components/editor/parsers/markdown-parser';

/**
 * Size presets accepted by the AI service for GPT image models. The service
 * normalizes legacy DALL-E sizes to the same three values, so these are safe
 * for every OpenAI-compatible image backend.
 */
export const IMAGE_SIZE_PRESETS = {
  auto: undefined,
  square: '1024x1024',
  landscape: '1536x1024',
  portrait: '1024x1536',
} as const;

export type ImageSizePreset = keyof typeof IMAGE_SIZE_PRESETS;

export const IMAGE_QUALITY_PRESETS = {
  auto: undefined,
  standard: 'standard',
  hd: 'hd',
} as const;

export type ImageQualityPreset = keyof typeof IMAGE_QUALITY_PRESETS;

export interface ImageOptions {
  size: ImageSizePreset;
  quality: ImageQualityPreset;
  customImagePrompt: string;
}

export const DEFAULT_IMAGE_OPTIONS: ImageOptions = {
  size: 'auto',
  quality: 'auto',
  customImagePrompt: '',
};

export function isImageContent(content: OutputContent | undefined): boolean {
  return content === OutputContent.IMAGE || content === OutputContent.RichTextImage;
}

export function buildOutputContentMetadata(options: ImageOptions): OutputContentMetadata | undefined {
  const metadata: OutputContentMetadata = {};
  const size = IMAGE_SIZE_PRESETS[options.size];
  const quality = IMAGE_QUALITY_PRESETS[options.quality];
  const prompt = options.customImagePrompt.trim();

  if (size) metadata.size = size;
  if (quality) metadata.quality = quality;
  if (prompt) metadata.custom_image_prompt = prompt;

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

/**
 * Builds the format sent with a question. In Auto mode the layout is `Flex`
 * so the model chooses its own structure; a chosen layout is only sent when
 * the user opened the format bar.
 */
export function buildResponseFormat({
  formatMode,
  layout,
  content,
  imageOptions,
}: {
  formatMode: boolean;
  layout: OutputLayout;
  content: OutputContent;
  imageOptions: ImageOptions;
}): ResponseFormat {
  const format: ResponseFormat = {
    output_layout: formatMode ? layout : OutputLayout.Flex,
    output_content: content,
  };

  if (isImageContent(content)) {
    const metadata = buildOutputContentMetadata(imageOptions);

    if (metadata) format.output_content_metadata = metadata;
  }

  return format;
}

function parseAnswerContent(content: string) {
  try {
    return parseMarkdown(content, { inlineParentheses: true });
  } catch {
    // Unparseable content has no recoverable format; the caller falls back.
    return [];
  }
}

/** True when the URL points at this workspace's chat file storage (generated pictures and uploads). */
export function isChatFileUrl(url: string): boolean {
  return /\/api\/file_storage\/[^/]+\/v1\/blob\//.test(url);
}

/**
 * Recovers the format an answer was produced with from its stored content, using
 * the parser that renders it. Only the content type can be inferred (the layout
 * is not visible in markdown), which is what "Try again" needs: an image answer
 * must regenerate as an image.
 */
export function inferResponseFormatFromContent(content: string): ResponseFormat | undefined {
  const blocks = parseAnswerContent(content);
  const hasChatImage = blocks.some(
    (block) => block.type === BlockType.ImageBlock && isChatFileUrl((block.data as ImageBlockData).url ?? '')
  );

  if (!hasChatImage) return undefined;

  const hasText = blocks.some((block) => block.type !== BlockType.ImageBlock);

  return {
    output_layout: OutputLayout.Flex,
    output_content: hasText ? OutputContent.RichTextImage : OutputContent.IMAGE,
  };
}
