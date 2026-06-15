import { Button, Divider, IconButton } from '@mui/material';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { ReactComponent as TrashIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as SupportIcon } from '@/assets/icons/help.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/settings_more.svg';
import { ReactComponent as TemplateIcon } from '@/assets/icons/template.svg';
import { Popover } from '@/components/_shared/popover';

function MobileMore({ onClose }: { onClose: () => void }) {
  const [openMore, setOpenMore] = React.useState(false);
  const ref = React.useRef<HTMLButtonElement | null>(null);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const actions = useMemo(() => {
    return [
      {
        label: t('template.label'),
        icon: <TemplateIcon />,
        onClick: () => {
          window.open('https://appflowy.com/templates', '_blank');
        },
      },
      {
        label: t('trash.text'),
        icon: <TrashIcon />,
        onClick: () => {
          navigate('/app/trash');
        },
      },
      {
        label: t('questionBubble.help'),
        onClick: () => {
          window.open('https://discord.gg/9Q2xaN37tV', '_blank');
        },
        icon: <SupportIcon />,
      },
    ];
  }, [navigate, t]);

  return (
    <>
      <IconButton ref={ref} onClick={() => setOpenMore(true)} size={'large'} className={'p-2'}>
        <MoreIcon className={'h-5 w-5 text-text-primary'} />
      </IconButton>
      <Popover
        open={openMore}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        anchorEl={ref.current}
        onClose={() => setOpenMore(false)}
      >
        <div className={'flex w-[200px] flex-col justify-start gap-3 py-3'}>
          {actions.map((action, index) => (
            <div key={index}>
              <div className='mx-3'>
                <Button
                  startIcon={action.icon}
                  onClick={() => {
                    action.onClick();
                    setOpenMore(false);
                    onClose();
                  }}
                  variant={'text'}
                  className={'flex w-full justify-start py-1 text-base font-normal'}
                  color={'inherit'}
                >
                  {action.label}
                </Button>
              </div>

              {index !== actions.length - 1 && <Divider className={'mt-2 w-full opacity-50'} />}
            </div>
          ))}
        </div>
      </Popover>
    </>
  );
}

export default MobileMore;
