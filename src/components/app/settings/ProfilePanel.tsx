import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import BannerImages from '@/components/app/settings/profile/BannerImages';
import ProfileAboutMe from '@/components/app/settings/profile/ProfileAboutMe';
import ProfileAvatar from '@/components/app/settings/profile/ProfileAvatar';
import ProfileDisplayName from '@/components/app/settings/profile/ProfileDisplayName';
import ProfilePreview from '@/components/app/settings/profile/ProfilePreview';
import { Banner } from '@/components/app/settings/profile/banner';
import { useProfileSetting } from '@/components/app/settings/profile/useProfileSetting';
import { useAppConfig } from '@/components/main/app.hooks';
import { Progress } from '@/components/ui/progress';

export function ProfilePanel() {
  const { t } = useTranslation();
  const { currentUser } = useAppConfig();
  const { draft, loading, email, roleLabelKey, update, uploadAction } = useProfileSetting();

  // Stable identities: these feed memoised tab option lists further down, and a new
  // closure each render would churn them (and re-render the picker) on every keystroke.
  const handleAvatarChange = useCallback((avatar: string) => update({ avatar }, true), [update]);
  const handleNameChange = useCallback((name: string) => update({ name }), [update]);
  const handleAboutMeChange = useCallback((aboutMe: string) => update({ aboutMe }), [update]);
  const handleBannerSelect = useCallback((banner: Banner) => update({ banner }, true), [update]);
  const handleUploadCustom = useCallback(
    (url: string) => {
      const banner: Banner = { kind: 'network', url };

      update({ banner, customBanner: banner }, true);
    },
    [update]
  );

  if (!currentUser) return null;

  return (
    <div className='flex h-full min-h-0 flex-1 flex-col overflow-hidden'>
      <div className='flex items-center justify-between gap-2 border-b border-border-primary px-8 py-5'>
        <h2 className='text-xl font-semibold text-text-primary'>{t('settings.profilePage.title')}</h2>
        <ProfilePreview
          name={draft.name}
          email={email}
          avatar={draft.avatar}
          aboutMe={draft.aboutMe}
          banner={draft.banner}
          role={roleLabelKey ? t(roleLabelKey) : undefined}
        />
      </div>

      <div className='appflowy-scroller flex-1 overflow-y-auto px-8 py-5'>
        {loading ? (
          <div className='flex h-full items-center justify-center'>
            <Progress variant='primary' />
          </div>
        ) : (
          <div className='flex flex-col gap-5'>
            <div className='flex items-center gap-5'>
              <ProfileAvatar
                avatar={draft.avatar}
                name={draft.name}
                uploadAction={uploadAction}
                onChange={handleAvatarChange}
              />
              <ProfileDisplayName value={draft.name} onChange={handleNameChange} />
            </div>

            <ProfileAboutMe value={draft.aboutMe} onChange={handleAboutMeChange} />

            <BannerImages
              selected={draft.banner}
              customBanner={draft.customBanner}
              uploadAction={uploadAction}
              onSelect={handleBannerSelect}
              onUploadCustom={handleUploadCustom}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default ProfilePanel;
