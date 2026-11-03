import { useEffect, useMemo } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

import { Alert, AlertDescription } from '@/components/chat/components/ui/alert';
import { useEditorContext } from '@/components/chat/provider/editor-provider';
import type { ParsedBlock } from '@/components/editor/parsers/types';

import { resolveCitationMarkdown } from './citation-markdown';
import { answerBlocksToEditorData, parseAnswerBlocks } from './markdown/answer-blocks';
import { AnswerMarkdown } from './markdown/answer-markdown';

import type { ResolvedMessageSource } from './message-sources';

const EMPTY_RESOLVED_SOURCES: ResolvedMessageSource[] = [];

/** Copy and "Add to page" read the answer through the message editor registry. */
function RegisterMessageData({ blocks, id }: { blocks: ParsedBlock[]; id: number }) {
  const { setEditor } = useEditorContext();

  useEffect(() => {
    setEditor(id, { getData: () => answerBlocksToEditorData(blocks) });
  }, [blocks, id, setEditor]);

  return null;
}

export function AnswerMd({
  mdContent,
  id,
  sources = EMPTY_RESOLVED_SOURCES,
  onRegenerateImage,
  streaming,
}: {
  mdContent: string;
  id?: number;
  sources?: ResolvedMessageSource[];
  /** Offered on generated images; omit when the answer cannot be regenerated. */
  onRegenerateImage?: () => void;
  /** True while the answer is still arriving. */
  streaming?: boolean;
}) {
  const renderedContent = useMemo(() => resolveCitationMarkdown(mdContent, sources), [mdContent, sources]);
  const blocks = useMemo(() => parseAnswerBlocks(renderedContent), [renderedContent]);

  return (
    <div className='flex w-full min-w-0 flex-col gap-2'>
      {id !== undefined ? <RegisterMessageData blocks={blocks} id={id} /> : null}
      <ErrorBoundary
        fallback={
          <Alert variant={'destructive'}>
            <AlertDescription>Failed to render content</AlertDescription>
          </Alert>
        }
      >
        <AnswerMarkdown blocks={blocks} streaming={streaming} onRegenerateImage={onRegenerateImage} />
      </ErrorBoundary>
    </div>
  );
}
