import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ruleApi } from '@/application/services/js-services/http/automation-api';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { getErrorMessage } from '@/utils/errors';

export function WorkspaceWebhookSetting({ workspace }: { workspace: string }) {
  const { t } = useTranslation();
  const [disabled, setDisabled] = useState<boolean>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    setError('');
    void ruleApi.workspaceWebhookPolicy(workspace, controller.signal).then(
      (settings) => {
        if (!controller.signal.aborted) setDisabled(settings.disable_automation_webhooks);
      },
      (reason: unknown) => {
        if (!controller.signal.aborted) setError(getErrorMessage(reason) || t('databaseAutomation.webhookPolicyError'));
      }
    );

    return () => controller.abort();
  }, [workspace, attempt, t]);

  async function toggle(allowed: boolean) {
    setSaving(true);
    setError('');

    try {
      const settings = await ruleApi.setWorkspaceWebhookPolicy(workspace, !allowed);

      setDisabled(settings.disable_automation_webhooks);
    } catch (reason) {
      setError(getErrorMessage(reason) || t('databaseAutomation.webhookPolicyError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className='border-b border-border-primary py-4'>
      <div className='flex items-center justify-between gap-4'>
        <div>
          <label className='text-base font-semibold text-text-primary' htmlFor='allow-workspace-webhooks'>
            {t('databaseAutomation.allowWorkspaceWebhooks')}
          </label>
          <p className='text-sm text-text-secondary' id='workspace-webhook-policy-description'>
            {t('databaseAutomation.workspaceWebhookPolicyDescription')}
          </p>
        </div>
        <Switch
          aria-busy={saving || (disabled === undefined && !error)}
          aria-describedby='workspace-webhook-policy-description'
          checked={disabled === false}
          disabled={disabled === undefined || saving}
          id='allow-workspace-webhooks'
          onCheckedChange={(allowed) => void toggle(allowed)}
        />
      </div>
      {error && <p className='mt-2 text-sm text-text-error' role='alert'>{error}</p>}
      {error && disabled === undefined && (
        <Button size='sm' variant='outline' onClick={() => setAttempt((value) => value + 1)}>
          {t('databaseAutomation.retryWebhookPolicy')}
        </Button>
      )}
    </section>
  );
}
