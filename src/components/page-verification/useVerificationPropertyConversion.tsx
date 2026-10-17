import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';

import { FieldType, useFieldSelector } from '@/application/database-yjs';
import { useSwitchPropertyType } from '@/application/database-yjs/dispatch';
import { useDatabaseVerification } from '@/application/page-verification/database';
import { assertFieldMutation, getVerificationPropertyId } from '@/application/page-verification/native';
import { YjsDatabaseKey } from '@/application/types';
import UpgradePlan from '@/components/billing/UpgradePlan';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function useVerificationPropertyConversion(fieldId: string, onConverted: () => void) {
  const { t } = useTranslation();
  const { state, store, nativeField, readOnly, assertEditable } = useDatabaseVerification();
  const { field } = useFieldSelector(fieldId);
  const switchType = useSwitchPropertyType();
  const sourceType = Number(field?.get(YjsDatabaseKey.type)) as FieldType;
  const sourcePropertyId = getVerificationPropertyId(field);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const confirmation = useRef<((confirmed: boolean) => void) | undefined>();

  useEffect(() => () => confirmation.current?.(false), []);
  const confirmConversion = (confirmed: boolean) => {
    setConfirmOpen(false);
    confirmation.current?.(confirmed);
    confirmation.current = undefined;
  };

  const canChange = !!store && !!state?.can_edit && !readOnly && !!field && !field.get(YjsDatabaseKey.is_primary);

  const convert = async (targetType: FieldType = FieldType.Verification): Promise<boolean> => {
    if (!canChange || pending) return false;
    if (targetType === FieldType.Verification && nativeField && nativeField !== field) return false;
    if (targetType === FieldType.Verification && !state?.eligible) {
      setUpgradeOpen(true);
      return false;
    }

    setPending(true);
    setError('');
    try {
      assertEditable();
      if (sourceType === FieldType.Verification && targetType !== FieldType.Verification) {
        const confirmed = await new Promise<boolean>((resolve) => {
          confirmation.current = resolve;
          setConfirmOpen(true);
        });

        if (!confirmed) return false;
        assertEditable();
        assertFieldMutation(field, {
          expectedFieldType: sourceType,
          assertEditable,
          expectedVerificationPropertyId: sourcePropertyId,
        });
        // Revoke only the generation captured by this editor. The native CAS
        // below rejects a concurrent rebind even after Cloud revocation succeeds.
        if (sourcePropertyId) await store.remove(sourcePropertyId);
        assertEditable();
        await switchType(fieldId, targetType, {
          expectedFieldType: sourceType,
          assertEditable,
          expectedVerificationPropertyId: sourcePropertyId,
        });
      } else if (targetType === FieldType.Verification) {
        const property = await store.create();

        assertEditable();
        await switchType(fieldId, targetType, {
          expectedFieldType: sourceType,
          assertEditable,
          expectedVerificationPropertyId: sourceType === FieldType.Verification ? sourcePropertyId : undefined,
          verificationPropertyId: property.id,
        });
      } else {
        await switchType(fieldId, targetType, { expectedFieldType: sourceType, assertEditable });
      }

      onConverted();
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : t('grid.verification.conversionError'));
      return false;
    } finally {
      setPending(false);
    }
  };

  const feedback = (
    <>
      <Dialog open={confirmOpen} onOpenChange={(open) => !open && confirmConversion(false)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('grid.verification.conversionTitle')}</DialogTitle></DialogHeader>
          <DialogDescription>{t('grid.verification.conversionDescription')}</DialogDescription>
          <DialogFooter>
            <Button variant='outline' onClick={() => confirmConversion(false)}>{t('button.cancel')}</Button>
            <Button onClick={() => confirmConversion(true)}>{t('grid.verification.conversionConfirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!error} onOpenChange={(open) => !open && setError('')}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('grid.verification.conversionErrorTitle')}</DialogTitle>
          </DialogHeader>
          <DialogDescription role='alert'>{error}</DialogDescription>
          <DialogFooter>
            <Button onClick={() => setError('')}>{t('button.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {upgradeOpen && <UpgradePlan open onClose={() => setUpgradeOpen(false)} onOpen={() => setUpgradeOpen(true)} />}
    </>
  );

  return { convert, pending, feedback };
}
