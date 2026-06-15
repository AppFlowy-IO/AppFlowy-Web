import { Editor, useEditor } from '@appflowyinc/editor';
import { useEffect } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

import { Alert, AlertDescription } from '@/components/chat/components/ui/alert';
import { useEditorContext } from '@/components/chat/provider/editor-provider';

export function AnswerMd({ mdContent, id }: { mdContent: string; id: number }) {
  const editor = useEditor();
  const { setEditor: setMessageEditor } = useEditorContext();

  useEffect(() => {
    setMessageEditor(id, editor);
  }, [editor, id, setMessageEditor]);

  useEffect(() => {
    if (!mdContent) return;

    try {
      editor.applyMarkdown(mdContent);
    } catch (error) {
      console.error('Failed to apply markdown', error);
    }
  }, [editor, mdContent]);

  return (
    <ErrorBoundary
      fallback={
        <Alert variant={'destructive'}>
          <AlertDescription>Failed to render content</AlertDescription>
        </Alert>
      }
    >
      <Editor readOnly />
    </ErrorBoundary>
  );
}
