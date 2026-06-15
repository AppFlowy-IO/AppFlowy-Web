import { Drawer, IconButton, Tooltip } from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { UIVariant } from '@/application/types';
import { ReactComponent as AppFlowyLogo } from '@/assets/icons/appflowy.svg';
import { ReactComponent as DoubleArrowLeft } from '@/assets/icons/double_arrow_left.svg';
import Resizer from '@/components/_shared/outline/Resizer';
import { AFScroller } from '@/components/_shared/scroller';
import { createHotKeyLabel, HOT_KEY_NAME } from '@/utils/hotkeys';

import AppFlowyPower from '../appflowy-power/AppFlowyPower';

export function OutlineDrawer({
  onScroll,
  header,
  rightActions,
  variant,
  open,
  width,
  onClose,
  children,
  onResizeWidth,
}: {
  open: boolean;
  width: number;
  onClose: () => void;
  children: React.ReactNode;
  onResizeWidth: (width: number) => void;
  header?: React.ReactNode;
  rightActions?: React.ReactNode;
  variant?: UIVariant;
  onScroll?: (scrollTop: number) => void;
}) {
  const { t } = useTranslation();

  const [hovered, setHovered] = useState<boolean>(false);
  const navigate = useNavigate();

  return (
    <Drawer
      sx={{
        width,
        flexShrink: 0,
        boxShadow: 'var(--shadow)',
        '& .MuiDrawer-paper': {
          width,
          boxSizing: 'border-box',
          borderColor: 'var(--border-primary)',
          boxShadow: 'none',
          zIndex: 50,
        },
      }}
      variant='persistent'
      anchor='left'
      open={open}
      tabIndex={0}
      autoFocus
      PaperProps={{
        sx: {
          borderRadius: 0,
          background: variant === 'publish' ? 'var(--bg-body)' : 'var(--surface-container-layer-00)',
        },
      }}
    >
      <AFScroller
        overflowXHidden
        onScroll={(e) => {
          onScroll?.((e.target as HTMLDivElement).scrollTop);
        }}
        className={'relative flex h-full min-h-full w-full flex-col'}
      >
        <div
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            backdropFilter: variant === UIVariant.Publish ? 'blur(4px)' : undefined,
            backgroundColor: variant === UIVariant.App ? 'var(--surface-container-layer-00)' : undefined,
          }}
          className={
            'sticky top-0 z-10 flex h-[48px] min-h-[48px] w-full transform-gpu items-center justify-between overflow-hidden'
          }
        >
          {header ? (
            header
          ) : (
            <div
              className={'mx-1 flex h-full w-[141px] cursor-pointer items-center gap-1 p-2 text-text-primary'}
              onClick={() => {
                navigate('/app');
              }}
            >
              <AppFlowyLogo className='h-full w-full' />
            </div>
          )}
          <div className={'flex shrink-0 items-center pr-3'}>
            {rightActions}
            <div
              className={'overflow-hidden transition-all duration-200 ease-in-out'}
              style={{
                width: hovered ? 32 : 0,
                opacity: hovered ? 1 : 0,
              }}
            >
              <Tooltip
                title={
                  <div className={'flex flex-col'}>
                    <span>{t('sideBar.closeSidebar')}</span>
                    <span className={'text-xs text-text-secondary'}>{createHotKeyLabel(HOT_KEY_NAME.TOGGLE_SIDEBAR)}</span>
                  </div>
                }
              >
                <IconButton
                  onClick={onClose}
                  size={'small'}
                >
                  <DoubleArrowLeft className={'text-text-secondary'} />
                </IconButton>
              </Tooltip>
            </div>
          </div>
        </div>
        <div className={'flex h-fit flex-1 flex-col'}>{children}</div>
        {variant === 'publish' && <AppFlowyPower width={width} />}
      </AFScroller>
      <Resizer drawerWidth={width} onResize={onResizeWidth} />
    </Drawer>
  );
}

export default OutlineDrawer;
