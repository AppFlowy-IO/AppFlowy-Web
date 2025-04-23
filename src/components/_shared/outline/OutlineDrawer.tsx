import { ReactComponent as AppFlowyLogo } from '@/assets/icons/appflowy.svg';
import { ReactComponent as DoubleArrowLeft } from '@/assets/icons/double_arrow_left.svg';
import Resizer from '@/components/_shared/outline/Resizer';
import { useNavigate } from 'react-router-dom';
import AppFlowyPower from '../appflowy-power/AppFlowyPower';
import { createHotKeyLabel, HOT_KEY_NAME } from '@/utils/hotkeys';
import { Drawer, IconButton, Tooltip } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { UIVariant } from '@/application/types';
import { useState } from 'react';
import { AFScroller } from '@/components/_shared/scroller';

export function OutlineDrawer ({
  onScroll,
  header,
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
          borderColor: 'var(--line-divider)',
          boxShadow: 'none',
          zIndex: 50,
        },
      }}
      variant="persistent"
      anchor="left"
      open={open}
      tabIndex={0}
      autoFocus
      PaperProps={{
        sx: {
          borderRadius: 0,
          background: variant === 'publish' ? 'var(--bg-body)' : 'var(--bg-base)',
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
            backgroundColor: variant === UIVariant.App ? 'var(--bg-base)' : undefined,
          }}
          className={'sticky top-0 z-10 flex h-[48px] min-h-[48px] transform-gpu items-center justify-between'}
        >
          {header ? (
            header
          ) : (
            <div
              className={'flex cursor-pointer items-center gap-1 p-4 text-text-title'}
              onClick={() => {
                navigate('/app');
              }}
            >
              <AppFlowyLogo className={'w-[88px]'} />
            </div>
          )}

          {hovered && (
            <Tooltip
              title={
                <div className={'flex flex-col'}>
                  <span>{t('sideBar.closeSidebar')}</span>
                  <span className={'text-xs text-text-caption'}>{createHotKeyLabel(HOT_KEY_NAME.TOGGLE_SIDEBAR)}</span>
                </div>
              }
            >
              <IconButton
                onClick={onClose}
                className={'m-4'}
                size={'small'}
              >
                <DoubleArrowLeft className={'text-text-caption'} />
              </IconButton>
            </Tooltip>
          )}
        </div>
        <div className={'flex h-fit flex-1 flex-col'}>{children}</div>
        {variant === 'publish' && <AppFlowyPower width={width} />}
      </AFScroller>
      <Resizer
        drawerWidth={width}
        onResize={onResizeWidth}
      />
    </Drawer>
  );
}

export default OutlineDrawer;
