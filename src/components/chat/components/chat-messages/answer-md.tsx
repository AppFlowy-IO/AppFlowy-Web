import { AppFlowyEditor, Editor, useEditor } from '@appflowyinc/editor';
import { useEffect, useMemo } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

import { Alert, AlertDescription } from '@/components/chat/components/ui/alert';
import { useEditorContext } from '@/components/chat/provider/editor-provider';

import { resolveCitationMarkdown } from './citation-markdown';
import type { ResolvedMessageSource } from './message-sources';

const EMPTY_RESOLVED_SOURCES: ResolvedMessageSource[] = [];

function RegisterMessageEditor({ editor, id }: { editor: AppFlowyEditor; id: number }) {
  const { setEditor: setMessageEditor } = useEditorContext();

  useEffect(() => {
    setMessageEditor(id, editor);
  }, [editor, id, setMessageEditor]);

  return null;
}

export function AnswerMd({
  mdContent,
  id,
  sources = EMPTY_RESOLVED_SOURCES,
}: {
  mdContent: string;
  id?: number;
  sources?: ResolvedMessageSource[];
}) {
  const editor = useEditor();
  const renderedContent = useMemo(() => resolveCitationMarkdown(mdContent, sources), [mdContent, sources]);

  useEffect(() => {
    if (!renderedContent) return;

    try {
      editor.applyMarkdown(renderedContent);
    } catch (error) {
      console.error('Failed to apply markdown', error);
    }
  }, [editor, renderedContent]);

  return (
    <>
      {id !== undefined && <RegisterMessageEditor editor={editor} id={id} />}
      <ErrorBoundary
        fallback={
          <Alert variant={'destructive'}>
            <AlertDescription>Failed to render content</AlertDescription>
          </Alert>
        }
      >
        <Editor readOnly />
      </ErrorBoundary>
    </>
  );
}
