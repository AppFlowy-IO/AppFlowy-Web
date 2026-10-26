import { PopoverOrigin, Popper, Tooltip } from '@mui/material';
import { Check, Download } from 'lucide-react';
import { KeyboardEvent, PointerEvent, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Node } from 'slate';
import { useReadOnly, useSlateSelector, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { BlockData, BlockType } from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { Popover } from '@/components/_shared/popover';
import { useAIEnabled } from '@/components/app/app.hooks';
import { CodeAIAction, usePopoverContext } from '@/components/editor/components/block-popover/BlockPopoverContext';
import { DEFAULT_CALLOUT_DATA } from '@/components/editor/components/blocks/callout/callout.utils';
import { CodeNode } from '@/components/editor/editor.type';
import { useEditorContext } from '@/components/editor/EditorContext';
import { ThemeModeContext } from '@/components/main/useAppThemeMode';
import { copyTextToClipboard } from '@/utils/copy';

import * as Icons from './CodeIcons';
import { normalizeCodeLanguage } from './constants';
import { canFormatCode, formatCode } from './format-code';
import { CodeLanguageMenu } from './SelectLanguage';
import { turnCodeIntoPage } from './turn-code-into-page';

export type CodeMenuView = 'main' | 'ai' | 'language' | 'display';
type Submenu = Exclude<CodeMenuView, 'main'> | 'turn' | 'download';

const defaultAnchorOrigin: PopoverOrigin = { vertical: 'bottom', horizontal: 'right' };
const defaultTransformOrigin: PopoverOrigin = { vertical: 'top', horizontal: 'left' };

function moveMenuFocus(event: KeyboardEvent) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || event.target instanceof HTMLInputElement) return;
  const menu = (event.target as HTMLElement).closest('[role="menu"]');
  const items = Array.from(menu?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? []);

  if (!items.length) return;
  event.preventDefault();
  event.stopPropagation();
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
      ? items.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;

  items[next].focus();
}

export function CodeMenu({
  node,
  anchorEl,
  onClose,
  view = 'main',
  anchorOrigin = defaultAnchorOrigin,
  transformOrigin = defaultTransformOrigin,
}: {
  node: CodeNode;
  anchorEl: HTMLElement;
  onClose: () => void;
  view?: CodeMenuView;
  anchorOrigin?: PopoverOrigin;
  transformOrigin?: PopoverOrigin;
}) {
  const editor = useSlateStatic() as YjsEditor;
  const context = useEditorContext();
  const readOnly = useReadOnly();
  const aiEnabled = useAIEnabled();
  const { openCodeBlockAction } = usePopoverContext();
  const { t } = useTranslation();
  const current = useSlateSelector(
    (value) => findSlateEntryByBlockId(value as YjsEditor, node.blockId)?.[0] as CodeNode | undefined
  );
  const isDark = !!useContext(ThemeModeContext)?.isDark;
  const [submenu, setSubmenu] = useState<{ type: Submenu; anchor: HTMLElement; keyboard?: boolean }>();
  const submenuElement = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  const cancelSubmenuClose = useCallback(() => {
    clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
  }, []);

  useEffect(() => cancelSubmenuClose, [cancelSubmenuClose]);

  const scheduleSubmenuClose = (event: PointerEvent) => {
    if (!submenu || submenu.keyboard || event.pointerType === 'touch') return;
    cancelSubmenuClose();
    // Allow the pointer to cross the gap to the portal, including when it flips left.
    closeTimer.current = setTimeout(() => {
      if (submenuElement.current?.contains(document.activeElement)) submenu.anchor.focus();
      setSubmenu((current) => (current === submenu ? undefined : current));
      closeTimer.current = undefined;
    }, 150);
  };

  // Popper mounts its portal after the parent commit. Focus when the menu actually mounts.
  const focusSubmenu = useCallback(
    (element: HTMLDivElement | null) => {
      submenuElement.current = element;
      if (submenu?.keyboard) element?.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled), input')?.focus();
    },
    [submenu]
  );
  const submenuAnchor = useMemo(
    () =>
      submenu && {
        contextElement: submenu.anchor,
        getBoundingClientRect: () => {
          const row = submenu.anchor.getBoundingClientRect();
          const menu = submenu.anchor.closest('[role="menu"]')?.getBoundingClientRect() ?? row;

          return new DOMRect(menu.x, row.y, menu.width, row.height);
        },
      },
    [submenu]
  );
  const empty = !current || !Node.string(current).trim();
  const data = current?.data ?? node.data;
  const label = (key: string, fallback: string) => t(`document.plugins.codeBlock.${key}`, { defaultValue: fallback });
  const live = () => findSlateEntryByBlockId(editor, node.blockId);
  const run = (action: () => void | Promise<void>, close = true) => {
    const entry = live();

    if (readOnly || editor.readOnly || !entry || editor.isElementReadOnly(entry[0])) {
      onClose();
      return;
    }

    editor.flushLocalChanges();
    if (close) onClose();
    Promise.resolve()
      .then(action)
      .catch((error: Error) => notify.error(error.message));
  };

  const setData = (value: Partial<CodeNode['data']>, close = true) =>
    run(() => {
      CustomEditor.setBlockData(editor, node.blockId, value);
    }, close);
  const ask = (action: CodeAIAction) => {
    if (action !== 'generate' && !Node.string(live()?.[0] ?? node).trim()) return;
    run(() => openCodeBlockAction?.(node.blockId, action));
  };

  const row = (
    title: string,
    icon: ReactNode,
    action: () => void,
    props: { disabled?: boolean; danger?: boolean; checked?: boolean } = {}
  ) => (
    <button
      type='button'
      role={props.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={props.checked}
      disabled={props.disabled}
      className={`code-menu-row ${props.danger ? 'code-menu-delete' : ''}`}
      onClick={action}
    >
      {icon}
      <span className='flex-1 text-left'>{title}</span>
      {props.checked !== undefined && (
        <span aria-hidden className={`code-menu-switch ${props.checked ? 'is-on' : ''}`}>
          <span />
        </span>
      )}
    </button>
  );
  const branch = (title: string, icon: ReactNode, type: Submenu) => (
    <button
      type='button'
      role='menuitem'
      aria-haspopup='menu'
      aria-expanded={submenu?.type === type}
      className={`code-menu-row ${submenu?.type === type ? 'is-active' : ''}`}
      onPointerEnter={() => {
        if (submenu?.type === type) cancelSubmenuClose();
      }}
      onPointerLeave={(event) => {
        if (submenu?.type === type) scheduleSubmenuClose(event);
      }}
      onClick={(event) => {
        cancelSubmenuClose();
        setSubmenu({ type, anchor: event.currentTarget, keyboard: event.detail === 0 });
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          event.stopPropagation();
          cancelSubmenuClose();
          setSubmenu({ type, anchor: event.currentTarget, keyboard: true });
        }
      }}
    >
      {icon}
      <span className='flex-1 text-left'>{title}</span>
      <Icons.ArrowIcon className='text-icon-tertiary' />
    </button>
  );
  const content = (type: CodeMenuView | Submenu) => {
    if (type === 'language')
      return (
        <CodeLanguageMenu
          language={data.language}
          onSelect={(language) => setData({ language: language === 'auto' ? '' : language })}
        />
      );
    if (type === 'ai')
      return (
        <>
          {row(label('askAI', 'Ask AI'), <Icons.AskIcon />, () => ask('generate'))}
          {row(label('explainCode', 'Explain code'), <Icons.ExplainIcon />, () => ask('explain'), { disabled: empty })}
          {row(label('checkCode', 'Check code'), <Icons.CheckIcon />, () => ask('check'), { disabled: empty })}
          {row(
            label('addInlineCodeComments', 'Add inline code comments'),
            <Icons.CommentsIcon />,
            () => ask('comments'),
            { disabled: empty }
          )}
        </>
      );
    if (type === 'display') {
      const compact = view === 'display';
      const modes = compact ? (['split', 'preview', 'code'] as const) : (['code', 'preview', 'split'] as const);

      return modes.map((mode) => {
        const title = label(mode, mode[0].toUpperCase() + mode.slice(1));
        const selected = (data.mermaid_display_mode ?? 'split') === mode;
        const button = (
          <button
            key={mode}
            type='button'
            role='menuitemradio'
            aria-label={title}
            aria-checked={selected}
            className='code-menu-row'
            onClick={() => setData({ mermaid_display_mode: mode === 'split' ? null : mode })}
          >
            {mode === 'code' ? <Icons.CodeIcon /> : mode === 'preview' ? <Icons.PreviewIcon /> : <Icons.SplitIcon />}
            {!compact && <span className='flex-1 text-left'>{title}</span>}
            {!compact && selected && <Check size={20} />}
          </button>
        );

        return compact ? (
          <Tooltip key={mode} title={title} placement='bottom' disableInteractive>
            {button}
          </Tooltip>
        ) : (
          button
        );
      });
    }

    if (type === 'download')
      return (
        <>
          {(['svg', 'png'] as const).map((format) => (
            <button
              key={format}
              type='button'
              role='menuitem'
              className='code-menu-row'
              disabled={empty}
              onClick={() =>
                run(async () => {
                  const source = live()?.[0];

                  if (!source) return;
                  const [{ renderMermaid }, { downloadDiagram }] = await Promise.all([
                    import('./mermaid-renderer'),
                    import('./download-diagram'),
                  ]);
                  const svg = await renderMermaid(Node.string(source), isDark, () => true);

                  if (svg) await downloadDiagram(svg, format);
                })
              }
            >
              <Download size={20} />
              <span>{format.toUpperCase()}</span>
            </button>
          ))}
        </>
      );
    if (type === 'turn')
      return (
        <>
          {(
            [
              [BlockType.Paragraph, 'editor.text', {}],
              [BlockType.HeadingBlock, 'document.slashMenu.name.heading1', { level: 1 }],
              [BlockType.HeadingBlock, 'document.slashMenu.name.heading2', { level: 2 }],
              [BlockType.HeadingBlock, 'document.slashMenu.name.heading3', { level: 3 }],
              [BlockType.BulletedListBlock, 'editor.bulletedListShortForm', {}],
              [BlockType.NumberedListBlock, 'editor.numberedListShortForm', {}],
              [BlockType.TodoListBlock, 'editor.checkbox', { checked: false }],
              [BlockType.ToggleListBlock, 'document.slashMenu.name.toggleList', { collapsed: false }],
              [BlockType.QuoteBlock, 'document.slashMenu.name.quote', {}],
              [BlockType.CalloutBlock, 'document.slashMenu.name.callout', DEFAULT_CALLOUT_DATA],
            ] as const
          ).map(([type, title, data]) => (
            <button
              key={title}
              role='menuitem'
              className='code-menu-row'
              onClick={() =>
                run(() => {
                  CustomEditor.turnToBlock(editor, node.blockId, type, data as BlockData);
                })
              }
            >
              {t(title)}
            </button>
          ))}
          {context.addPage &&
            row(t('editor.page', { defaultValue: 'Page' }), null, () =>
              run(() => turnCodeIntoPage(editor, context, node.blockId))
            )}
        </>
      );
    return (
      <>
        <div className='code-menu-title'>{label('name', 'Code block')}</div>
        {row(
          t('button.delete'),
          <Icons.DeleteIcon />,
          () =>
            run(() => {
              CustomEditor.deleteBlock(editor, node.blockId);
            }),
          { danger: true }
        )}
        {row(t('button.duplicate'), <Icons.DuplicateIcon />, () =>
          run(() => {
            CustomEditor.duplicateBlock(editor, node.blockId, node.blockId);
          })
        )}
        {row(t('document.plugins.optionAction.copyLinkToBlock'), <Icons.LinkIcon />, () =>
          run(async () => {
            const url = new URL(window.location.href);

            url.searchParams.set('blockId', node.blockId);
            await copyTextToClipboard(url.toString());
            notify.success(t('shareAction.copyLinkToBlockSuccess'));
          })
        )}
        {branch(t('document.plugins.optionAction.turnInto'), <Icons.TurnIcon />, 'turn')}
        <div className='code-menu-divider' />
        {branch(label('language', 'Language'), <Icons.LanguageIcon />, 'language')}
        {normalizeCodeLanguage(data.language) === 'mermaid' && (
          <>
            {branch(label('display', 'Display'), <Icons.DisplayIcon />, 'display')}
            {branch(label('download', 'Download'), <Download size={20} />, 'download')}
            {row(
              label('expandDiagram', 'Expand diagram'),
              <Icons.ExpandIcon />,
              () => run(() => openCodeBlockAction?.(node.blockId, 'expand')),
              { disabled: empty }
            )}
          </>
        )}
        {row(
          label('pinLanguage', 'Pin language'),
          <Icons.PinIcon />,
          () => setData({ pin_language: !data.pin_language }, false),
          { checked: !!data.pin_language }
        )}
        {row(label('wrapCode', 'Wrap code'), <Icons.WrapIcon />, () => setData({ wrap_code: !data.wrap_code }, false), {
          checked: !!data.wrap_code,
        })}
        {row(
          label('formatCode', 'Format code'),
          <Icons.FormatIcon />,
          () =>
            run(async () => {
              const source = live()?.[0] as CodeNode | undefined;

              if (source) await formatCode(editor, source);
            }),
          { disabled: empty || !canFormatCode(data.language) }
        )}
        {row(
          label('copyCode', 'Copy code'),
          <Icons.CopyIcon />,
          () =>
            run(async () => {
              const entry = live();

              if (entry) await copyTextToClipboard(Node.string(entry[0]));
              notify.success(t('publish.copy.codeBlock'));
            }),
          { disabled: empty }
        )}
        {row(label('addCaption', 'Add caption'), <Icons.CaptionIcon />, () =>
          run(() => openCodeBlockAction?.(node.blockId, 'caption'))
        )}
        {aiEnabled && (
          <>
            <div className='code-menu-divider' />
            {branch(label('askAI', 'Ask AI'), <Icons.AIIcon />, 'ai')}
          </>
        )}
      </>
    );
  };

  if (readOnly || !current) return null;
  return (
    <Popover
      open
      anchorEl={anchorEl}
      onClose={onClose}
      disableRestoreFocus
      disableEnforceFocus
      anchorOrigin={anchorOrigin}
      transformOrigin={transformOrigin}
      PaperProps={{ className: `code-menu-paper ${view === 'display' ? 'code-display-paper' : ''}` }}
      onKeyDownCapture={(event) => {
        if ((event.key === 'Escape' || event.key === 'ArrowLeft') && submenu) {
          event.preventDefault();
          event.stopPropagation();
          cancelSubmenuClose();
          submenu.anchor.focus();
          setSubmenu(undefined);
        }
      }}
    >
      <div
        role='menu'
        aria-label={label('name', 'Code block')}
        data-testid='code-block-menu'
        className={`code-menu ${
          view === 'language' ? 'code-menu-search' : view === 'display' ? 'code-menu-display' : ''
        }`}
        onKeyDown={moveMenuFocus}
      >
        {content(view)}
      </div>
      <Popper
        open={!!submenu}
        anchorEl={submenuAnchor}
        placement='right-start'
        modifiers={[
          { name: 'offset', options: { offset: [0, 4] } },
          { name: 'flip', options: { fallbackPlacements: ['left-start'], padding: 12 } },
          { name: 'preventOverflow', options: { padding: 12, altAxis: true } },
        ]}
        sx={{ zIndex: (theme) => theme.zIndex.modal + 1 }}
        className='code-menu-paper'
        onPointerEnter={cancelSubmenuClose}
        onPointerLeave={scheduleSubmenuClose}
      >
        <div
          ref={focusSubmenu}
          role='menu'
          data-testid='code-block-submenu'
          className={`code-menu ${submenu?.type === 'language' ? 'code-menu-search' : ''}`}
          onKeyDown={moveMenuFocus}
        >
          {submenu && content(submenu.type)}
        </div>
      </Popper>
    </Popover>
  );
}
