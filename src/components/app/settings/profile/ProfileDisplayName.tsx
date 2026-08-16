import { useTranslation } from 'react-i18next';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Server-enforced limit (MAX_PROFILE_NAME_LENGTH). */
export const DISPLAY_NAME_MAX_LENGTH = 72;

export function ProfileDisplayName({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  const atLimit = value.trim().length >= DISPLAY_NAME_MAX_LENGTH;

  return (
    <div className='flex flex-1 flex-col items-start gap-1'>
      <Label htmlFor='profile-display-name' className='text-sm font-medium text-text-primary'>
        {t('settings.profilePage.displayName')}
      </Label>
      <div className='flex w-full items-center gap-2'>
        <Input
          id='profile-display-name'
          className='w-[300px] max-w-full'
          value={value}
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          onChange={(e) => onChange(e.target.value)}
          data-testid='profile-display-name-input'
        />
        {atLimit && (
          <span className='shrink-0 text-sm text-text-tertiary' data-testid='profile-display-name-limit'>
            {`${DISPLAY_NAME_MAX_LENGTH} / ${DISPLAY_NAME_MAX_LENGTH}`}
          </span>
        )}
      </div>
    </div>
  );
}

export default ProfileDisplayName;
