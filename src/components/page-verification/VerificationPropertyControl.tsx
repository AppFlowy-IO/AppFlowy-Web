import { ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDatabaseVerification } from '@/application/page-verification/database';
import { ReactComponent as VerifyIcon } from '@/assets/icons/verify.svg';
import UpgradePlan from '@/components/billing/UpgradePlan';
import PropertyMenu from '@/components/database/components/property/PropertyMenu';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/** Setup and retry only. Native fields use the same property editor as other types. */
export function VerificationPropertyControl({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  const { state, nativeField, fieldId, create, readOnly } = useDatabaseVerification();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const canEdit = !!state?.can_edit && !readOnly;
  const label = t('grid.field.verificationFieldName', { defaultValue: 'Verification' });

  if (!state) return null;
  if (fieldId)
    return (
      <PropertyMenu fieldId={fieldId} open={open} onOpenChange={setOpen}>
        {children ?? (
          <Button variant='ghost' onClick={() => setOpen(true)}>
            <VerifyIcon className='h-5 w-5' />
            {label}
          </Button>
        )}
      </PropertyMenu>
    );

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {children ?? (
            <Button variant='ghost' className='w-full justify-start'>
              <VerifyIcon className='h-5 w-5' />
              {label}
            </Button>
          )}
        </PopoverTrigger>
        <PopoverContent className='w-80 space-y-3 p-3'>
          <h3 className='font-semibold'>{label}</h3>
          {!canEdit ? (
            <p className='text-sm'>
              {t('grid.verification.editPermissionRequired', {
                defaultValue: 'You need permission to edit this database’s properties.',
              })}
            </p>
          ) : !state.eligible ? (
            <>
              <p>
                {t('grid.verification.upgradeDescription', {
                  defaultValue: 'Upgrade to Pro to verify pages and help your team identify up-to-date information.',
                })}
              </p>
              <Button onClick={() => setUpgradeOpen(true)}>
                {t('grid.verification.upgrade', { defaultValue: 'Upgrade to Pro' })}
              </Button>
            </>
          ) : (
            <>
              <p className='text-sm text-text-secondary'>
                {t('grid.verification.addPropertyDescription', {
                  defaultValue: 'Add one Verification property across this database’s views. Rows start Unverified.',
                })}
              </p>
              <Button
                disabled={pending}
                onClick={() => {
                  setPending(true);
                  setError('');
                  void create()
                    .then(() => setOpen(false))
                    .catch((cause: unknown) => {
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : t('grid.verification.updateFailed', { defaultValue: 'Could not update Verification.' })
                      );
                    })
                    .finally(() => setPending(false));
                }}
              >
                {nativeField
                  ? t('button.retry', { defaultValue: 'Retry' })
                  : t('grid.verification.addProperty', { defaultValue: 'Add Verification' })}
              </Button>
            </>
          )}
          {error && (
            <p role='alert' className='text-sm text-text-error'>
              {error}
            </p>
          )}
        </PopoverContent>
      </Popover>
      {upgradeOpen && <UpgradePlan open onClose={() => setUpgradeOpen(false)} onOpen={() => setUpgradeOpen(true)} />}
    </>
  );
}
