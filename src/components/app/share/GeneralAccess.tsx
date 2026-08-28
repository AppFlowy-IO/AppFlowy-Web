import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { AccessLevel } from '@/application/types';
import { ReactComponent as LockIcon } from '@/assets/icons/lock.svg';
import { useUserWorkspaceInfo } from '@/components/app/app.hooks';
import { ShareSectionType } from '@/components/app/share/shareSectionType';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

function accessLevelLabel(accessLevel: AccessLevel, t: TFunction) {
  switch (accessLevel) {
    case AccessLevel.FullAccess:
      return t('shareAction.fullAccess');
    case AccessLevel.ReadAndWrite:
      return t('shareAction.canEdit');
    case AccessLevel.ReadAndComment:
      return t('shareAction.canViewAndComment');
    case AccessLevel.ReadOnly:
      return t('shareAction.canView');
  }
}

export function GeneralAccess({
  sectionType,
  accessLevel,
}: {
  sectionType: ShareSectionType;
  accessLevel?: AccessLevel | null;
}) {
  const { t } = useTranslation();
  const userWorkspaceInfo = useUserWorkspaceInfo();

  const selectedWorkspace = userWorkspaceInfo?.selectedWorkspace;
  // Structured-space policy is authoritative when available. Legacy servers do not return it,
  // so retain the old section-based fallback until their route can be upgraded.
  const resolvedAccessLevel =
    accessLevel === undefined ? (sectionType === ShareSectionType.Public ? AccessLevel.FullAccess : null) : accessLevel;
  const isRestricted = resolvedAccessLevel === null;

  if (!selectedWorkspace) {
    return null;
  }

  return (
    <div className='flex w-full flex-col px-2 pt-2'>
      <div className='px-2 py-1.5'>
        <Label>{t('shareAction.generalAccess')}</Label>
      </div>
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>
          <div className='flex w-full items-center rounded-300 px-2 py-1.5 hover:bg-fill-content-hover'>
            <div className='flex w-full flex-row items-center justify-between gap-2'>
              {isRestricted ? (
                <Avatar shape={'square'}>
                  <AvatarFallback
                    style={{
                      backgroundColor: 'var(--surface-container-layer-01)',
                      color: 'var(--icon-secondary)',
                    }}
                    className='rounded-300 border border-border-primary'
                  >
                    <LockIcon className='h-6 w-6' />
                  </AvatarFallback>
                </Avatar>
              ) : (
                <Avatar shape={'square'}>
                  <AvatarImage src={selectedWorkspace.icon} alt={''} />
                  <AvatarFallback className='rounded-300 border border-border-primary' name={selectedWorkspace.name}>
                    {selectedWorkspace.icon ? (
                      <span className='text-lg'>{selectedWorkspace.icon}</span>
                    ) : (
                      selectedWorkspace.name
                    )}
                  </AvatarFallback>
                </Avatar>
              )}

              <div className='flex w-full flex-1 flex-col gap-0.5 overflow-hidden'>
                {isRestricted ? (
                  <>
                    <div className='truncate text-sm text-text-primary'>{t('shareAction.restricted')}</div>
                    <div className='text-xs text-text-secondary'>{t('shareAction.restrictedDescription')}</div>
                  </>
                ) : (
                  <>
                    <div className='truncate text-sm text-text-primary'>
                      {t('shareAction.anyoneAt')}
                      {selectedWorkspace.name}
                    </div>
                    <div className='text-xs text-text-secondary'>
                      {t('shareAction.anyoneInThisGroupWithTheLinkCanAccess')}
                    </div>
                  </>
                )}
              </div>

              {!isRestricted && (
                <div className='mr-2 px-3 py-1.5 text-sm text-text-secondary'>
                  {accessLevelLabel(resolvedAccessLevel, t)}
                </div>
              )}
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side={'bottom'} align='center'>
          {selectedWorkspace.name}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
