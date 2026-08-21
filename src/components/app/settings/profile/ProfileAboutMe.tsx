import { useTranslation } from 'react-i18next';

import { ReactComponent as InfoIcon } from '@/assets/icons/info.svg';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** Server-enforced limit (MAX_PROFILE_DESCRIPTION_LENGTH). */
export const ABOUT_ME_MAX_LENGTH = 190;

export function ProfileAboutMe({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  const atLimit = value.length >= ABOUT_ME_MAX_LENGTH;

  return (
    <div className='flex flex-col items-start'>
      <div className='flex items-center gap-1'>
        <label htmlFor='profile-about-me' className='text-sm font-medium text-text-primary'>
          {t('settings.profilePage.aboutMe')}
        </label>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              role='button'
              aria-label={t('settings.profilePage.aboutMeMarkdownHint')}
              className='flex text-icon-tertiary'
              data-testid='profile-about-me-hint'
            >
              <InfoIcon className='h-5 w-5' />
            </span>
          </TooltipTrigger>
          <TooltipContent side='top'>{t('settings.profilePage.aboutMeMarkdownHint')}</TooltipContent>
        </Tooltip>
      </div>

      <textarea
        id='profile-about-me'
        data-testid='profile-about-me-input'
        value={value}
        maxLength={ABOUT_ME_MAX_LENGTH}
        placeholder={t('settings.profilePage.aboutMeHint')}
        onChange={(e) => onChange(e.target.value)}
        className='appflowy-scroller mt-1 h-[92px] w-[400px] max-w-full resize-none rounded-300 border border-border-primary bg-transparent px-2 py-[6px] text-sm text-text-primary outline-none placeholder:text-text-tertiary focus:border-border-theme-thick'
      />

      {atLimit && (
        <span className='mt-1 text-sm text-text-tertiary' data-testid='profile-about-me-limit'>
          {t('settings.profilePage.limitCharactersReached', { limit: ABOUT_ME_MAX_LENGTH })}
        </span>
      )}
    </div>
  );
}

export default ProfileAboutMe;
