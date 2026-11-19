import { BlockType, CodeBlockData, ImageBlockData } from '@/application/types';
import { GeneratedImage } from '@/components/chat/components/chat-messages/generated-image';
import { isChatFileUrl } from '@/components/chat/lib/image-format';
import { StaticBlocks } from '@/components/editor/components/static/static-blocks';
import type { ParsedBlock } from '@/components/editor/parsers/types';

import { AnswerCodeBlock } from './answer-code-block';


import './answer-markdown.scss';

export interface AnswerMarkdownProps {
  blocks: ParsedBlock[];
  /** While the answer streams, diagrams stay as code so partial sources do not flash errors. */
  streaming?: boolean;
  /** Offered on generated images; omit when the answer cannot be regenerated. */
  onRegenerateImage?: () => void;
}

const CLASS_NAMES = { math: 'chat-math', table: 'chat-table', taskList: 'chat-task-list' };

/**
 * A chat answer rendered with the document editor's static blocks. Code gets
 * the chat code block (language, copy, Mermaid) and pictures the generated
 * image component; everything else is the shared rendering.
 */
export function AnswerMarkdown({ blocks, streaming, onRegenerateImage }: AnswerMarkdownProps) {
  const renderBlock = (block: ParsedBlock) => {
    switch (block.type) {
      case BlockType.CodeBlock:
        return <AnswerCodeBlock text={block.text} data={block.data as CodeBlockData} streaming={streaming} />;

      case BlockType.ImageBlock: {
        const url = (block.data as ImageBlockData).url;

        if (!url) return null;

        return <GeneratedImage url={url} onRegenerate={isChatFileUrl(url) ? onRegenerateImage : undefined} />;
      }

      default:
        return undefined;
    }
  };

  return (
    <div className='chat-markdown' data-testid='chat-markdown'>
      <StaticBlocks blocks={blocks} classNames={CLASS_NAMES} renderBlock={renderBlock} />
    </div>
  );
}
