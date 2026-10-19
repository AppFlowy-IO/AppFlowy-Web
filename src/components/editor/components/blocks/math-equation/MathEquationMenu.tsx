import { Popper } from '@mui/material';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Transforms } from 'slate';
import { useReadOnly, useSlateSelector, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { BlockType } from '@/application/types';
import { ReactComponent as ArrowIcon } from '@/assets/icons/math-equation/arrow-right.svg';
import { ReactComponent as AskIcon } from '@/assets/icons/math-equation/ask.svg';
import { ReactComponent as CheckIcon } from '@/assets/icons/math-equation/check.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/math-equation/delete.svg';
import { ReactComponent as DuplicateIcon } from '@/assets/icons/math-equation/duplicate.svg';
import { ReactComponent as ExplainIcon } from '@/assets/icons/math-equation/explain.svg';
import { ReactComponent as LinkIcon } from '@/assets/icons/math-equation/link.svg';
import { ReactComponent as AIIcon } from '@/assets/icons/math-equation/menu-ai.svg';
import { ReactComponent as TurnIcon } from '@/assets/icons/math-equation/turn-into.svg';
import { notify } from '@/components/_shared/notify';
import { Popover } from '@/components/_shared/popover';
import { useAIEnabled } from '@/components/app/app.hooks';
import {
  MathEquationAIAction,
  usePopoverContext,
} from '@/components/editor/components/block-popover/BlockPopoverContext';
import { MathEquationNode } from '@/components/editor/editor.type';
import { useEditorContext } from '@/components/editor/EditorContext';
import { createSubpage } from '@/components/editor/subpage/create-subpage';
import { Button } from '@/components/ui/button';
import { copyTextToClipboard } from '@/utils/copy';

export function MathEquationMenu({
  node,
  anchorEl,
  onClose,
}: {
  node: MathEquationNode;
  anchorEl: HTMLElement;
  onClose: () => void;
}) {
  const editor = useSlateStatic() as YjsEditor;
  const context = useEditorContext();
  const readOnly = useReadOnly();
  const aiEnabled = useAIEnabled();
  const { openMathEquationAI } = usePopoverContext();
  const { t } = useTranslation();
  const [submenu, setSubmenu] = useState<{ type: 'ai' | 'turn'; anchor: HTMLElement }>();
  const submenuAnchor = useMemo(() => submenu && ({
    contextElement: submenu.anchor,
    getBoundingClientRect: () => {
      const row = submenu.anchor.getBoundingClientRect();
      const menu = submenu.anchor.closest('[role="menu"]')?.getBoundingClientRect() ?? row;

      return new DOMRect(menu.x, row.y, menu.width, row.height);
    },
  }), [submenu]);
  const empty = useSlateSelector((value) => {
    const entry = findSlateEntryByBlockId(value as YjsEditor, node.blockId);

    return !entry || !(entry[0] as MathEquationNode).data.formula?.trim();
  });
  const rowClass = 'h-8 w-full justify-start rounded-md px-2 py-1.5 text-sm [&_svg]:shrink-0 disabled:[&_svg]:opacity-40';
  const liveEntry = () => findSlateEntryByBlockId(editor, node.blockId);
  const run = (action: () => void | Promise<void>) => {
    const entry = liveEntry();

    if (readOnly || editor.readOnly || !entry || editor.isElementReadOnly(entry[0])) {
      onClose();
      return;
    }

    onClose();
    Promise.resolve()
      .then(() => {
        editor.flushLocalChanges();
        return action();
      })
      .catch((error) => notify.error(error.message));
  };

  const ask = (action: MathEquationAIAction) => {
    const current = liveEntry();

    if (action !== 'generate' && !(current?.[0] as MathEquationNode | undefined)?.data.formula?.trim()) return;
    run(() => openMathEquationAI?.({ blockId: node.blockId, action }));
  };

  const turn = (type: BlockType, data = {}) =>
    run(() => {
      const current = liveEntry();

      if (!current) return;
      const formula = (current[0] as MathEquationNode).data.formula || '';
      const id = CustomEditor.turnToBlock(editor, node.blockId, type, data);
      const next = id && findSlateEntryByBlockId(editor, id);

      if (next) {
        editor.select(next[1].concat(0));
        Transforms.insertText(editor, formula);
      }
    });

  if (readOnly) return null;
  return (
    <Popover
      open
      PaperProps={{ className: '!w-60 !rounded-xl !border-0 !bg-surface-layer-04 !shadow-menu ring-1 ring-border-primary' }}
      anchorEl={anchorEl}
      onClose={onClose}
      onKeyDownCapture={(event) => {
        if (event.key === 'Escape' && submenu) {
          event.stopPropagation();
          submenu.anchor.focus();
          setSubmenu(undefined);
        }
      }}
      disableRestoreFocus
      disableEnforceFocus
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
    >
      <div
        role='menu'
        aria-label={t('document.plugins.mathEquation.name')}
        data-testid='math-equation-menu'
        className='w-full p-2'
      >
        <div className='px-2 py-1.5 text-xs font-medium leading-[18px] tracking-[0.1px] text-text-tertiary'>{t('document.plugins.mathEquation.name')}</div>
        <Button
          role='menuitem'
          variant='ghost'
          danger
          className={`${rowClass} focus-visible:bg-fill-content-hover focus-visible:text-text-error [&_path]:stroke-current`}
          onClick={() =>
            run(() => {
              CustomEditor.deleteBlock(editor, node.blockId);
            })
          }
        >
          <DeleteIcon width={20} height={20} />
          {t('button.delete')}
        </Button>
        <Button
          role='menuitem'
          variant='ghost'
          className={rowClass}
          onClick={() =>
            run(() => {
              CustomEditor.duplicateBlock(editor, node.blockId, node.blockId);
            })
          }
        >
          <DuplicateIcon width={20} height={20} />
          {t('button.duplicate')}
        </Button>
        <Button
          role='menuitem'
          variant='ghost'
          className={rowClass}
          onClick={() =>
            run(async () => {
              const url = new URL(window.location.href);

              url.searchParams.set('blockId', node.blockId);
              await copyTextToClipboard(url.toString());
              notify.success(t('shareAction.copyLinkToBlockSuccess'));
            })
          }
        >
          <LinkIcon width={20} height={20} />
          {t('document.plugins.optionAction.copyLinkToBlock')}
        </Button>
        <Button
          role='menuitem'
          aria-haspopup='menu'
          aria-expanded={submenu?.type === 'turn'}
          variant='ghost'
          className={`${rowClass} ${submenu?.type === 'turn' ? 'bg-fill-content-hover' : ''}`}
          onClick={(event) => setSubmenu({ type: 'turn', anchor: event.currentTarget })}
        >
          <TurnIcon width={20} height={20} />
          {t('document.plugins.optionAction.turnInto')}
          <ArrowIcon width={20} height={20} className='ml-auto h-5 w-5' />
        </Button>
        {aiEnabled && (
          <>
            <div className='-mx-2 my-2 border-t border-border-primary' />
            <Button
              role='menuitem'
              aria-haspopup='menu'
              aria-expanded={submenu?.type === 'ai'}
              variant='ghost'
              className={`${rowClass} ${submenu?.type === 'ai' ? 'bg-fill-content-hover' : ''}`}
              onClick={(event) => setSubmenu({ type: 'ai', anchor: event.currentTarget })}
            >
              <span className='relative h-5 w-5 shrink-0' data-testid='math-equation-menu-ai-icon' aria-hidden>
                <AIIcon
                  width={15.0013}
                  height={16}
                  className='absolute left-[3px] top-0.5 [&_path[fill]]:fill-current [&_path[stroke]]:stroke-current'
                />
              </span>
              {t('document.plugins.mathEquation.askAI')}
              <ArrowIcon width={20} height={20} className='ml-auto h-5 w-5' />
            </Button>
          </>
        )}
      </div>
      <Popper
        open={!!submenu}
        anchorEl={submenuAnchor}
        placement='right-start'
        modifiers={[
          { name: 'offset', options: { offset: [0, 4] } },
          { name: 'flip', options: { fallbackPlacements: ['left-start'], padding: 16 } },
          { name: 'preventOverflow', options: { padding: 16 } },
        ]}
        sx={{ zIndex: (theme) => theme.zIndex.modal + 1 }}
        className='w-60 rounded-xl bg-surface-layer-04 shadow-menu ring-1 ring-border-primary'
      >
        <div role='menu' data-testid='math-equation-submenu' className='w-full p-2'>
          {submenu?.type === 'ai' ? (
            <>
              <Button role='menuitem' variant='ghost' className={rowClass} onClick={() => ask('generate')}>
                <AskIcon width={20} height={20} />
                {t('document.plugins.mathEquation.askAI')}
              </Button>
              <Button
                role='menuitem'
                variant='ghost'
                className={rowClass}
                disabled={empty}
                title={empty ? t('document.plugins.mathEquation.theEquationIsEmpty') : undefined}
                onClick={() => ask('explain')}
              >
                <ExplainIcon width={20} height={20} />
                {t('document.plugins.mathEquation.explain')}
              </Button>
              <Button
                role='menuitem'
                variant='ghost'
                className={rowClass}
                disabled={empty}
                title={empty ? t('document.plugins.mathEquation.theEquationIsEmpty') : undefined}
                onClick={() => ask('check')}
              >
                <CheckIcon width={20} height={20} />
                {t('document.plugins.mathEquation.check')}
              </Button>
            </>
          ) : submenu?.type === 'turn' ? (
            <>
              {(
                [
                  [BlockType.Paragraph, 'document.slashMenu.name.text', {}],
                  [BlockType.HeadingBlock, 'document.slashMenu.name.heading1', { level: 1 }],
                  [BlockType.HeadingBlock, 'document.slashMenu.name.heading2', { level: 2 }],
                  [BlockType.HeadingBlock, 'document.slashMenu.name.heading3', { level: 3 }],
                  [BlockType.BulletedListBlock, 'document.slashMenu.name.bulletedList', {}],
                  [BlockType.NumberedListBlock, 'document.slashMenu.name.numberedList', {}],
                  [BlockType.TodoListBlock, 'document.slashMenu.name.todoList', { checked: false }],
                  [BlockType.ToggleListBlock, 'document.slashMenu.name.toggleList', { collapsed: false }],
                  [BlockType.QuoteBlock, 'document.slashMenu.name.quote', {}],
                  [BlockType.CalloutBlock, 'document.slashMenu.name.callout', {}],
                  [BlockType.CodeBlock, 'document.slashMenu.name.code', {}],
                ] as const
              ).map(([type, label, data], i) => (
                <Button
                  key={i}
                  role='menuitem'
                  variant='ghost'
                  className={rowClass}
                  onClick={() => turn(type as BlockType, data as object)}
                >
                  {t(label)}
                </Button>
              ))}
              {context.addPage && (
                <Button
                  role='menuitem'
                  variant='ghost'
                  className={rowClass}
                  onClick={() =>
                    run(async () => {
                      const entry = liveEntry();

                      if (!entry) return;
                      editor.select(editor.start(entry[1]));
                      await createSubpage(editor, context);
                    })
                  }
                >
                  {t('editor.page')}
                </Button>
              )}
            </>
          ) : null}
        </div>
      </Popper>
    </Popover>
  );
}
