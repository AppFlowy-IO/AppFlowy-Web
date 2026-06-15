import { Button, Divider, Portal, Tooltip } from '@mui/material';
import Box from '@mui/material/Box';
import { PopoverProps } from '@mui/material/Popover';
import * as React from 'react';
import { useContext } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as BugIcon } from '@/assets/icons/bug.svg';
import { ReactComponent as FeedbackIcon } from '@/assets/icons/feedback.svg';
import { ReactComponent as SupportIcon } from '@/assets/icons/help.svg';
import { ReactComponent as DocumentationIcon } from '@/assets/icons/help_&_documentation.svg';
import { ReactComponent as MoonIcon } from '@/assets/icons/moon.svg';
import { ReactComponent as WhatsNewIcon } from '@/assets/icons/star.svg';
import { ReactComponent as SunIcon } from '@/assets/icons/sun.svg';
import { notify } from '@/components/_shared/notify';
import { Popover } from '@/components/_shared/popover';
import { ThemeModeContext } from '@/components/main/useAppThemeMode';
import { copyTextToClipboard } from '@/utils/copy';

const popoverProps: Partial<PopoverProps> = {
  anchorOrigin: {
    vertical: 'top',
    horizontal: 'right',
  },
  transformOrigin: {
    vertical: 'bottom',
    horizontal: 'right',
  },
};

export default function Help() {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const { t } = useTranslation();
  const { isDark, setDark } = useContext(ThemeModeContext) || {};

  return (
    <Portal>
      <Box className={'fixed bottom-6 right-6'} sx={{ transform: 'translateZ(0px)', flexGrow: 1 }}>
        <Tooltip title={t('questionBubble.help')}>
          <div ref={ref} onClick={() => setOpen(!open)} className={'py-2'}>
            <div
              className={
                'flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-border-primary bg-surface-primary shadow-md hover:bg-surface-primary-hover'
              }
            >
              <SupportIcon className={'h-5 w-5'} />
            </div>
          </div>
        </Tooltip>
        <Popover {...popoverProps} open={open} anchorEl={ref.current} onClose={() => setOpen(false)}>
          <div className={'flex h-fit w-[240px] flex-col gap-1 p-2'}>
            <Button
              color={'inherit'}
              variant={'text'}
              className={'justify-start'}
              startIcon={isDark ? <SunIcon /> : <MoonIcon />}
              onClick={() => setDark?.(!isDark)}
            >
              {isDark ? t('settings.appearance.themeMode.light') : t('settings.appearance.themeMode.dark')}
            </Button>
            <Button
              component={'a'}
              target='_blank'
              href={'https://www.appflowy.com/what-is-new'}
              className={'justify-start'}
              color={'inherit'}
              startIcon={<WhatsNewIcon />}
              variant={'text'}
            >
              {t('questionBubble.whatsNew')}
            </Button>
            <Button
              component={'a'}
              href={'https://appflowy.com/guide/getting-started-with-appflowy'}
              className={'justify-start'}
              target='_blank'
              color={'inherit'}
              startIcon={<DocumentationIcon />}
              variant={'text'}
            >
              {t('questionBubble.documentation')}
            </Button>
            <Button
              component={'a'}
              href={'https://discord.gg/9Q2xaN37tV'}
              className={'justify-start'}
              target='_blank'
              color={'inherit'}
              startIcon={<SupportIcon />}
              variant={'text'}
            >
              {t('questionBubble.help')}
            </Button>
            <Button
              onClick={() => {
                const info = {
                  platform: 'web',
                  url: window.location.href,
                  userAgent: navigator.userAgent,
                };

                void copyTextToClipboard(JSON.stringify(info, null, 2));
                notify.success(t('questionBubble.debug.success'));
              }}
              className={'justify-start'}
              color={'inherit'}
              startIcon={<BugIcon />}
              variant={'text'}
            >
              {t('questionBubble.debug.name')}
            </Button>
            <Button
              component={'a'}
              target='_blank'
              href={'https://github.com/AppFlowy-IO/AppFlowy-Web/issues/new/choose'}
              className={'justify-start'}
              color={'inherit'}
              startIcon={<FeedbackIcon />}
              variant={'text'}
            >
              {t('questionBubble.feedback')}
            </Button>

            <Divider />
            <Button
              size={'small'}
              target='_blank'
              component={'a'}
              href={'https://forum.appflowy.io/'}
              className={'justify-start text-text-secondary'}
              color={'inherit'}
              variant={'text'}
            >
              Community Forum
            </Button>
            <Button
              size={'small'}
              component={'a'}
              target='_blank'
              href={'https://x.com/appflowy'}
              className={'justify-start text-text-secondary'}
              color={'inherit'}
              variant={'text'}
            >
              Twitter - @appflowy
            </Button>
            <Button
              size={'small'}
              component={'a'}
              target='_blank'
              href={'https://www.reddit.com/r/AppFlowy/'}
              className={'justify-start text-text-secondary'}
              color={'inherit'}
              variant={'text'}
            >
              Reddit - r/appflowy
            </Button>
          </div>
        </Popover>
      </Box>
    </Portal>
  );
}
