import { OutlinedInput } from '@mui/material';
import React from 'react';
import { useTranslation } from 'react-i18next';

import {
  AccessLevel,
  SpaceInvitePolicy,
  SpacePermissionSettings,
  SpaceSidebarEditPolicy,
  SpaceVisibility,
} from '@/application/types';
import { NormalModal } from '@/components/_shared/modal';
import { notify } from '@/components/_shared/notify';
import { useAppOperations } from '@/components/app/app.hooks';
import SpaceIconButton from '@/components/app/view-actions/SpaceIconButton';
import SpacePermissionButton from '@/components/app/view-actions/SpacePermissionButton';

function createSpacePermissionSettings(visibility: SpaceVisibility): SpacePermissionSettings {
  const everyoneElseAccessLevel =
    visibility === SpaceVisibility.Closed || visibility === SpaceVisibility.Private ? null : AccessLevel.ReadOnly;

  return {
    visibility,
    owner_access_level: AccessLevel.FullAccess,
    member_default_access_level: AccessLevel.ReadAndWrite,
    everyone_else_access_level: everyoneElseAccessLevel,
    invite_policy: SpaceInvitePolicy.OwnersOnly,
    sidebar_edit_policy: SpaceSidebarEditPolicy.OwnersOnly,
    invite_link_enabled: false,
    security: {
      disable_guests: false,
      disable_public_links: false,
      disable_export: false,
    },
  };
}

function CreateSpaceModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (spaceId: string) => void;
}) {
  const [spaceName, setSpaceName] = React.useState<string>('');
  const [spaceIcon, setSpaceIcon] = React.useState<string>('');
  const [spaceIconColor, setSpaceIconColor] = React.useState<string>('');
  const [spaceVisibility, setSpaceVisibility] = React.useState<SpaceVisibility>(SpaceVisibility.Open);
  const [loading, setLoading] = React.useState<boolean>(false);
  const { t } = useTranslation();
  const { createSpace } = useAppOperations();
  const handleOk = async () => {
    if (!createSpace) return;
    setLoading(true);
    try {
      const spaceId = await createSpace({
        name: spaceName,
        space_icon: spaceIcon,
        space_icon_color: spaceIconColor,
        permission: createSpacePermissionSettings(spaceVisibility),
      });

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
