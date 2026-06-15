import { Button, CircularProgress, OutlinedInput, Tooltip, Typography } from '@mui/material';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as ArrowRight } from '@/assets/icons/alt_arrow_right.svg';
import { Popover } from '@/components/_shared/popover';
import AddCreator from '@/components/as-template/creator/AddCreator';
import CreatorAvatar from '@/components/as-template/creator/CreatorAvatar';
import CreatorItem from '@/components/as-template/creator/CreatorItem';
import { useLoadCreators } from '@/components/as-template/hooks';
import { accountLinkIcon } from '@/components/as-template/icons';

const ITEM_HEIGHT = 48;
const ITEM_PADDING_TOP = 8;
const MenuProps = {
  disableAutoFocus: true,
  disableRestoreFocus: true,
  disableEnforceFocus: true,
  PaperProps: {
    className: 'p-2 appflowy-scroller',
  },
};

function Creator({ value, onChange }: { value?: string; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  const [searchText, setSearchText] = useState('');
  const { creators, loading, loadCreators } = useLoadCreators({
    searchText,
  });

  useEffect(() => {
    void loadCreators();
  }, [loadCreators]);

  useEffect(() => {
    if (!value && creators[0]) {
      onChange(creators[0].id);
    }
  }, [creators, value, onChange]);

  const handleSelect = useCallback(
    (id: string) => {
      onChange(id);
      setOpen(false);
    },
    [onChange]
  );

  const selectedCreator = useMemo(() => creators.find((creator) => creator.id === value), [creators, value]);

  return (
    <div className={'flex flex-col gap-4'}>
      <Typography variant={'h6'} className={'text-text-secondary'}>
        {t('template.creator.label')}
      </Typography>
      <div className={'flex flex-col gap-4'}>
        <Button
          variant={'outlined'}
          color={'inherit'}
          ref={ref}
          className={'flex items-center justify-between gap-2'}
          onClick={() => {
            setOpen(true);
          }}
        >
          <CreatorAvatar size={40} src={selectedCreator?.avatar_url || ''} name={selectedCreator?.name || ''} />
          <div className={'flex-1 text-left'}>{selectedCreator?.name}</div>
          <ArrowRight className={'h-5 w-5 rotate-90 text-text-secondary'} />
        </Button>

        <div className={'flex flex-wrap gap-2'}>
          {selectedCreator?.account_links?.map((link) => {
            return (
              <Tooltip title={link.url} key={link.link_type} placement={'top'} arrow>
                <a
                  href={link.url}
                  key={link.link_type}
                  target={'_blank'}
                  className={
                    'flex h-10 w-10 items-center justify-between rounded-full border border-line-border p-3 hover:border-content-blue-400 hover:text-text-action'
                  }
                  rel='noreferrer'
                >
                  {accountLinkIcon(link.link_type)}
                </a>
              </Tooltip>
            );
          })}
        </div>
        <Popover {...MenuProps} open={open} anchorEl={ref.current} onClose={() => setOpen(false)}>
          <div
            className={'flex flex-col gap-2'}
            style={{
              minWidth: ref.current?.clientWidth,
              maxHeight: ITEM_HEIGHT * 10 + ITEM_PADDING_TOP,
            }}
          >
            <OutlinedInput
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              endAdornment={loading ? <CircularProgress size={'small'} /> : null}
              size={'small'}
              className={'flex-1 bg-background-primary'}
              placeholder={t('template.creator.typeToSearch')}
            />
            <AddCreator searchText={searchText} onCreated={loadCreators} />
            {creators.map((creator) => {
              return (
                <CreatorItem
                  key={creator.id}
                  creator={creator}
                  onClick={() => handleSelect(creator.id)}
                  reloadCreators={loadCreators}
                  selected={selectedCreator?.id === creator.id}
                />
              );
            })}
          </div>
        </Popover>
      </div>
    </div>
  );
}

export default Creator;
