import { Tooltip } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Node } from 'slate';
import { useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { notify } from '@/components/_shared/notify';
import { useAIEnabled } from '@/components/app/app.hooks';
import { CodeNode } from '@/components/editor/editor.type';
import { copyTextToClipboard } from '@/utils/copy';

import { AIIcon, CopyIcon, DisplayIcon, MoreIcon } from './CodeIcons';
import { CodeMenuView } from './CodeMenu';

export default function CodeToolbar({
  node,
  readOnly,
  onOpen,
}: {
  node: CodeNode;
  readOnly: boolean;
  onOpen: (view: CodeMenuView, anchor: HTMLElement) => void;
}) {
  const { t } = useTranslation();
  const editor = useSlateStatic() as YjsEditor;
  const aiEnabled = useAIEnabled();
  const hasContent = !!Node.string(node).trim();

  return (
    <div contentEditable={false} className='code-toolbar' data-testid='code-toolbar'>
      {!readOnly && aiEnabled && (
        <Tooltip title={t('document.plugins.codeBlock.askAI', { defaultValue: 'Ask AI' })} disableInteractive>
          <button
            type='button'
            aria-label={t('document.plugins.codeBlock.askAI', { defaultValue: 'Ask AI' })}
            onClick={(event) => onOpen('ai', event.currentTarget)}
          >
            <AIIcon />
          </button>
        </Tooltip>
      )}
      {!readOnly && node.data.language === 'mermaid' && (
        <Tooltip title={t('document.plugins.codeBlock.display', { defaultValue: 'Display' })} disableInteractive>
          <button
            type='button'
            aria-label={t('document.plugins.codeBlock.display', { defaultValue: 'Display' })}
            onClick={(event) => onOpen('display', event.currentTarget)}
          >
            <DisplayIcon />
          </button>
        </Tooltip>
      )}
      {hasContent && (
        <Tooltip title={t('document.plugins.codeBlock.copyCode', { defaultValue: 'Copy code' })} disableInteractive>
          <button
            type='button'
            aria-label={t('document.plugins.codeBlock.copyCode', { defaultValue: 'Copy code' })}
            onClick={() => {
              const entry = findSlateEntryByBlockId(editor, node.blockId);

              if (entry)
                void copyTextToClipboard(Node.string(entry[0]))
                  .then(() => notify.success(t('publish.copy.codeBlock')))
                  .catch((error: Error) => notify.error(error.message));
            }}
          >
            <CopyIcon />
          </button>
        </Tooltip>
      )}
      {!readOnly && (
        <Tooltip title={t('button.more', { defaultValue: 'More options' })} disableInteractive>
          <button
            type='button'
            data-testid='code-block-options'
            aria-label={t('button.more', { defaultValue: 'More options' })}
            onClick={(event) => onOpen('main', event.currentTarget)}
          >
            <MoreIcon />
          </button>
        </Tooltip>
      )}
    </div>
  );
}
