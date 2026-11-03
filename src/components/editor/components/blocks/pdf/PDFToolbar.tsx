import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AlignType } from '@/application/types';
import downloadIcon from '@/assets/icons/pdf/figma/0bc684d0269b836101426eef41f32ea0193a6f5f.svg';
import alignIcon from '@/assets/icons/pdf/figma/56f7d616049b4ac1d73c8a68067af2faa73e5370.svg';
import fullscreenIcon from '@/assets/icons/pdf/figma/97d10d60e8fb151f43a81ccea6e0b0dfe46c8dfd.svg';
import moreIcon from '@/assets/icons/pdf/figma/a9755e22d54fdd8c44fa473fabd02510ab4c9cb5.svg';
import aiIcon from '@/assets/icons/pdf/figma/f91c6816f6043c5bddf5558dd6a31ba4ca2fadf8.svg';
import { Popover } from '@/components/_shared/popover';
import { Button } from '@/components/ui/button';

import { PDFAIMenuItems, PDFAIMode, PDFAlignmentItems, pdfMenuPaper } from './PDFMenuItems';

export function PDFToolbar({
  ready,
  readOnly,
  aiEnabled,
  busy,
  menuOpen,
  onFullscreen,
  onDownload,
  onMore,
  onAlign,
  onAI,
}: {
  ready: boolean;
  readOnly: boolean;
  aiEnabled: boolean;
  busy: boolean;
  menuOpen: boolean;
  onFullscreen: () => void;
  onDownload: () => void;
  onMore: (anchor: HTMLElement) => void;
  onAlign: (align: AlignType) => void;
  onAI: (mode: PDFAIMode) => void;
}) {
  const { t } = useTranslation();
  const [submenu, setSubmenu] = useState<{ type: 'ai' | 'align'; anchor: HTMLElement }>();
  const controls = [
    {
      icon: aiIcon,
      label: t('document.plugins.pdf.askAI'),
      visible: !readOnly && aiEnabled,
      expanded: true,
      disabled: !ready || busy,
      action: (anchor: HTMLElement) => setSubmenu({ type: 'ai', anchor }),
    },
    {
      icon: fullscreenIcon,
      label: t('document.plugins.pdf.fullScreen'),
      visible: true,
      disabled: !ready,
      action: onFullscreen,
    },
    { icon: downloadIcon, label: t('button.download'), visible: true, expanded: true, action: onDownload },
    {
      icon: alignIcon,
      label: t('document.plugins.optionAction.align'),
      visible: !readOnly,
      expanded: true,
      action: (anchor: HTMLElement) => setSubmenu({ type: 'align', anchor }),
    },
    { icon: moreIcon, label: t('button.more'), visible: !readOnly, action: onMore },
  ];

  return (
    <>
      <div
        className={`pdf-toolbar absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md bg-black/60 p-1 text-white shadow-[0_2px_16px_#0000001f] backdrop-blur-[4px] group-focus-within/pdf:opacity-100 group-hover/pdf:opacity-100 ${
          menuOpen || submenu ? 'opacity-100' : 'opacity-0'
        }`}
        aria-label={t('document.plugins.pdf.controls')}
      >
        {controls
          .filter((control) => control.visible)
          .map(({ icon, label, action, disabled, expanded }) => (
            <Button
              key={label}
              variant='ghost'
              size='icon'
              className={`h-7 w-7 rounded p-1 text-white hover:bg-white/[0.16] hover:text-white disabled:bg-transparent ${
                expanded ? 'pdf-toolbar-expanded' : ''
              }`}
              aria-label={label}
              title={label}
              disabled={disabled}
              onClick={(event) => action(event.currentTarget)}
            >
              <span className='flex h-5 w-5 items-center justify-center'>
                <img src={icon} alt='' />
              </span>
            </Button>
          ))}
      </div>
      <Popover
        open={!!submenu}
        anchorEl={submenu?.anchor}
        onClose={() => setSubmenu(undefined)}
        PaperProps={pdfMenuPaper}
      >
        <div className='w-[240px] p-2'>
          {submenu?.type === 'ai' ? (
            <PDFAIMenuItems
              onAction={(mode) => {
                setSubmenu(undefined);
                onAI(mode);
              }}
            />
          ) : (
            <PDFAlignmentItems
              onAlign={(align) => {
                setSubmenu(undefined);
                onAlign(align);
              }}
            />
          )}
        </div>
      </Popover>
    </>
  );
}
