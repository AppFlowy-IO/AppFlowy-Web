import { useTranslation } from 'react-i18next';

import { AccessLevel, SpaceMemberAccessOverride } from '@/application/types';

export function SpaceMemberAccessControl({
  value,
  effectiveAccess,
  defaultAccess,
  disabled,
  principalName,
  onChange,
}: {
  value: SpaceMemberAccessOverride | undefined;
  effectiveAccess: AccessLevel | null | undefined;
  defaultAccess: AccessLevel | null;
  disabled: boolean;
  principalName: string;
  onChange: (value: SpaceMemberAccessOverride) => void;
}) {
  const { t } = useTranslation();
  const accessLabel = (access: AccessLevel | null | undefined) =>
    access === undefined
      ? t('space.memberOverride.unknown')
      : access === null
      ? t('space.permissionManager.noAccess')
      : access === AccessLevel.ReadOnly
      ? t('shareAction.canView')
      : access === AccessLevel.ReadAndComment
      ? t('shareAction.canViewAndComment')
      : access === AccessLevel.ReadAndWrite
      ? t('shareAction.canEdit')
      : t('shareAction.fullAccess');

  return (
    <div className='flex flex-col gap-1 py-1 text-xs text-text-secondary' data-testid='space-member-access-control'>
      <label className='flex items-center justify-end gap-2'>
        <span>{t('space.memberOverride.label')}</span>
        <select
          aria-label={t('space.memberOverride.accessFor', { name: principalName })}
          className='max-w-[160px] rounded border border-border-primary bg-fill-content p-1 text-text-primary'
          disabled={disabled || value === undefined}
          value={value === undefined ? 'unknown' : value === null ? 'inherit' : String(value)}
          onChange={(event) => {
            const next = event.target.value;

            if (next === 'inherit') onChange(null);
            else if (next === '10' || next === '20' || next === '30')
              onChange(Number(next) as SpaceMemberAccessOverride);
          }}
        >
          {value === undefined && <option value='unknown'>{t('space.memberOverride.unknown')}</option>}
          <option value='inherit'>{t('space.memberOverride.inherit')}</option>
          <option value='10'>{t('shareAction.canView')}</option>
          <option value='20'>{t('shareAction.canViewAndComment')}</option>
          <option value='30'>{t('shareAction.canEdit')}</option>
        </select>
      </label>
      <p>{t('space.memberOverride.defaultAccess', { level: accessLabel(defaultAccess) })}</p>
      <p>{t('space.memberOverride.assignmentAccess', { level: accessLabel(effectiveAccess) })}</p>
    </div>
  );
}
