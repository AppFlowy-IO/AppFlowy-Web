import { OutlinedInput } from '@mui/material';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { CreatePagePayload, SpacePermission, SpaceVisibility } from '@/application/types';
import { NormalModal } from '@/components/_shared/modal';
import { notify } from '@/components/_shared/notify';
import { useAppOperations } from '@/components/app/app.hooks';
import SpaceIconButton from '@/components/app/view-actions/SpaceIconButton';
import SpacePermissionButton from '@/components/app/view-actions/SpacePermissionButton';

const DEFAULT_SPACE_VISIBILITY = SpaceVisibility.Default;

function legacySpacePermission(visibility: SpaceVisibility): SpacePermission {
  return visibility === SpaceVisibility.Private ? SpacePermission.Private : SpacePermission.Public;
}

function CreateSpaceModal({
  open,
  onClose,
  onCreated,
  initialPage,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (spaceId: string, initialPageId?: string) => void;
  initialPage?: CreatePagePayload;
}) {
  const [spaceName, setSpaceName] = React.useState<string>('');
  const [spaceIcon, setSpaceIcon] = React.useState<string>('');
  const [spaceIconColor, setSpaceIconColor] = React.useState<string>('');
  const [spaceVisibility, setSpaceVisibility] = React.useState<SpaceVisibility>(DEFAULT_SPACE_VISIBILITY);
  const [loading, setLoading] = React.useState<boolean>(false);
  const { t } = useTranslation();
  const { createSpace, createSpaceWithInitialPage } = useAppOperations();

  const handleOk = async () => {
    if (!createSpace && !(initialPage && createSpaceWithInitialPage)) return;
    setLoading(true);
    try {
      const spacePayload = {
        name: spaceName,
        space_icon: spaceIcon,
        space_icon_color: spaceIconColor,
        // The server's existing compatibility endpoint maps Public to its
        // canonical Default visibility without applying the structured API's
        // single-default creation guard. Desktop uses this same path.
        space_permission: legacySpacePermission(spaceVisibility),
      };

      if (initialPage) {
        if (!createSpaceWithInitialPage) return;
        const result = await createSpaceWithInitialPage({
          ...spacePayload,
          initial_page: initialPage,
        });

        onClose();
        onCreated && onCreated(result.space.view_id, result.page.view_id);
        return;
      }

      if (!createSpace) return;
      const spaceId = await createSpace(spacePayload);

      onClose();

      onCreated && onCreated(spaceId);
      // eslint-disable-next-line
    } catch (e: any) {
      notify.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const [container, setContainer] = React.useState<HTMLDivElement | null>(null);

  return (
    <NormalModal
      keepMounted={false}
      okText={t('button.save')}
      cancelText={t('button.cancel')}
      open={open}
      onClose={onClose}
      title={t('space.createNewSpace')}
      classes={{ container: 'items-start max-md:mt-auto max-md:items-center mt-[10%] ' }}
      okLoading={loading}
      onOk={handleOk}
      PaperProps={{
        className: 'w-[600px] max-w-[70vw]',
        ...({ 'data-testid': 'create-space-modal' } as Record<string, unknown>),
      }}
    >
      <div
        ref={(el) => {
          setContainer(el);
        }}
        className={'flex flex-col gap-4'}
      >
        <div className={'flex flex-col items-center justify-center gap-3'}>
          <div className={'text-center font-normal text-text-secondary'}>{t('space.createSpaceDescription')}</div>
          {container && (
            <SpaceIconButton
              container={container}
              spaceIcon={spaceIcon}
              spaceIconColor={spaceIconColor}
              spaceName={spaceName}
              size={60}
              onSelectSpaceIcon={setSpaceIcon}
              onSelectSpaceIconColor={setSpaceIconColor}
            />
          )}
        </div>
        <div className={'flex flex-col gap-2'}>
          <div className={'text-text-secondary'}>{t('space.spaceName')}</div>
          <OutlinedInput
            data-testid='space-name-input'
            value={spaceName}
            fullWidth={true}
            onChange={(e) => setSpaceName(e.target.value)}
            size={'small'}
            placeholder={t('space.spaceNamePlaceholder')}
          />
        </div>
        <div className={'flex flex-col gap-2'}>
          <div className={'text-text-secondary'}>{t('space.permission')}</div>
          <SpacePermissionButton onSelected={setSpaceVisibility} value={spaceVisibility} />
        </div>
      </div>
    </NormalModal>
  );
}

export default CreateSpaceModal;
