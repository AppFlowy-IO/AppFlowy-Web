import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as UploadIcon } from '@/assets/icons/upload.svg';
import { EmojiPicker } from '@/components/_shared/emoji-picker';
import { TAB_KEY, TabOption, UploadImage, UploadPopover } from '@/components/_shared/image-upload';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';

/** Desktop caps avatar uploads at 2 MB. */
export const AVATAR_MAX_SIZE_BYTES = 2 * 1024 * 1024;

/**
 * Declared at module scope so its identity is stable. Defining this inline inside
 * `tabOptions` would make it a new component type on every render, which remounts
 * the picker (and wipes its search box) whenever the panel re-renders.
 * `onDone` is supplied by UploadPopover from the tab's own `onDone`.
 */
function EmojiTab({ onDone }: { onDone?: (value: string) => void }) {
  return <EmojiPicker onEmojiSelect={(emoji: string) => onDone?.(emoji)} />;
}

/** `avatar_url` holds either an http(s)/blob URL or a bare emoji character. */
export function isInlineAvatar(avatar: string): boolean {
  return (
    avatar.length > 0 &&
    !avatar.startsWith('http://') &&
    !avatar.startsWith('https://') &&
    !avatar.startsWith('/') &&
    !avatar.startsWith('data:') &&
    !avatar.startsWith('blob:')
  );
}

export function ProfileAvatar({
  avatar,
  name,
  onChange,
  uploadAction,
}: {
  avatar: string;
  name: string;
  onChange: (avatar: string) => void;
  uploadAction: (file: File) => Promise<string>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const inline = isInlineAvatar(avatar);

  const handleDone = useCallback(
    (value: string) => {
      if (!value) return;
      onChange(value);
      setOpen(false);
    },
    [onChange]
  );

  // Desktop caps avatars at 2 MB; enforce the same before spending an upload.
  // UploadImage surfaces a thrown message as an error toast.
  const uploadAvatar = useCallback(
    async (file: File) => {
      if (file.size > AVATAR_MAX_SIZE_BYTES) {
        throw new Error(t('settings.profilePage.avatarSizeLimit', { size: AVATAR_MAX_SIZE_BYTES / (1024 * 1024) }));
      }

      return uploadAction(file);
    },
    [t, uploadAction]
  );

  const tabOptions: TabOption[] = useMemo(
    () => [
      {
        key: TAB_KEY.UPLOAD,
        label: t('button.upload'),
        Component: UploadImage,
        uploadAction: uploadAvatar,
        onDone: handleDone,
      },
      {
        key: TAB_KEY.EMOJI,
        label: t('document.plugins.emoji'),
        Component: EmojiTab,
        onDone: handleDone,
      },
    ],
    [handleDone, t, uploadAvatar]
  );

  return (
    <UploadPopover
      open={open}
      onOpenChange={setOpen}
      tabOptions={tabOptions}
      extra={
        avatar ? (
          <Button
            variant='ghost'
            size='sm'
            className='ml-auto shrink-0'
            data-testid='profile-remove-avatar-button'
            onClick={() => {
              onChange('');
              setOpen(false);
            }}
          >
            {t('button.remove')}
          </Button>
        ) : undefined
      }
    >
      <button
        type='button'
        data-testid='profile-avatar-button'
        aria-label={t('settings.profilePage.editAvatar')}
        className='group relative h-20 w-20 shrink-0 rounded-full'
      >
        <Avatar size='xl' className='h-20 w-20'>
          <AvatarImage src={inline ? '' : avatar} alt={name} />
          <AvatarFallback name={name}>
            {inline ? <span className='text-2xl'>{avatar}</span> : (name || '?').charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <span className='absolute inset-0 hidden items-center justify-center rounded-full bg-surface-overlay text-icon-on-fill group-hover:flex'>
          <UploadIcon className='h-5 w-5' />
        </span>
      </button>
    </UploadPopover>
  );
}

export default ProfileAvatar;
