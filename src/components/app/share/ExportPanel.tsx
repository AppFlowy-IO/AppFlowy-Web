import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { BillingService } from '@/application/services/domains';
import { getViewPdfBlob } from '@/application/services/js-services/http/export-api';
import { SubscriptionInterval, SubscriptionPlan } from '@/application/types';
import { ReactComponent as PDFIcon } from '@/assets/icons/pdf.svg';
import { useAppOverlayContext } from '@/components/app/app-overlay/AppOverlayContext';
import { useAppView, useCurrentWorkspaceId, useGetSubscriptions } from '@/components/app/app.hooks';
import { useSubscriptionPlan } from '@/components/app/hooks/useSubscriptionPlan';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { downloadBlob } from '@/utils/download';

function ExportPanel({ viewId }: { viewId: string }) {
  const { t } = useTranslation();
  const view = useAppView(viewId);
  const viewIdResolved = view?.view_id;
  const workspaceId = useCurrentWorkspaceId();
  const getSubscriptions = useGetSubscriptions();
  const { isPro } = useSubscriptionPlan(getSubscriptions);
  const { showBlockingLoader, hideBlockingLoader } = useAppOverlayContext();
  const [linkedPagesOverride, setLinkedPagesOverride] = useState<boolean | null>(null);
  const includeLinkedPages = linkedPagesOverride ?? isPro;
  const [exporting, setExporting] = useState<boolean>(false);
  const exportingRef = useRef<boolean>(false);

  const handleExportPdf = useCallback(async () => {
    if (!workspaceId || !viewIdResolved || exportingRef.current) return;

    exportingRef.current = true;
    setExporting(true);
    showBlockingLoader(`${t('shareAction.exportPdfExporting')}...`);
    try {
      const { blob, filename } = await getViewPdfBlob(workspaceId, viewIdResolved, {
        includeNested: isPro ? includeLinkedPages : false,
        // Mirror desktop: embedded databases are a Pro feature
        // (share_bloc.dart:447 shouldIncludeEmbeddedDatabases = isProPlan).
        // Self-host users have isPro=true via useSubscriptionPlan.
        includeDatabase: isPro,
      });

      downloadBlob(blob, filename);
      toast.success(t('shareAction.exportPdfSuccess'));
    } catch (e) {
      const message = (e as { message?: string })?.message ?? t('shareAction.exportPdfError');

      toast.error(message);
    } finally {
      exportingRef.current = false;
      setExporting(false);
      hideBlockingLoader();
    }
  }, [workspaceId, viewIdResolved, isPro, includeLinkedPages, t, showBlockingLoader, hideBlockingLoader]);

  // Free users on AppFlowy Cloud get redirected to the Pro upgrade flow when they
  // try to enable "Include linked pages". Self-hosted users have isPro=true (set
  // by useSubscriptionPlan) so the toggle works normally without a billing check.
  const handleLinkedPagesChange = useCallback(
    async (checked: boolean) => {
      if (checked && !isPro) {
        if (!workspaceId) return;
        try {
          const link = await BillingService.getSubscriptionLink(
            workspaceId,
            SubscriptionPlan.Pro,
            SubscriptionInterval.Month,
          );

          window.open(link, '_blank');
          // eslint-disable-next-line
        } catch (e: any) {
          toast.error(e?.message ?? t('shareAction.exportPdfError'));
        }

        return;
      }

      setLinkedPagesOverride(checked);
    },
    [isPro, workspaceId, t],
  );

  return (
    <div className='flex flex-col items-stretch gap-3 px-4 py-4' data-testid='export-panel'>
      <div className='flex items-center justify-between gap-4'>
        <div className='flex items-center gap-2'>
          <PDFIcon className='h-5 w-5' />
          <div className='flex flex-col'>
            <span className='text-sm text-text-primary'>{t('shareAction.exportPdf')}</span>
            <span className='text-xs text-text-tertiary'>{t('shareAction.exportPdfDescription')}</span>
          </div>
        </div>
        <Button
          size='sm'
          data-testid='export-pdf-button'
          onClick={handleExportPdf}
          disabled={exporting || !workspaceId || !view}
          loading={exporting}
        >
          {exporting ? t('shareAction.exportPdfExporting') : t('shareAction.exportPdf')}
        </Button>
      </div>

      <div className='flex items-center justify-between gap-4'>
        <div className='flex flex-col'>
          <span className='text-sm text-text-primary'>{t('shareAction.exportPdfIncludeLinkedPages')}</span>
          {!isPro && (
            <span className='text-xs text-text-tertiary'>{t('shareAction.exportPdfIncludeLinkedPagesPro')}</span>
          )}
        </div>
        <Switch
          data-testid='export-include-linked-pages-switch'
          checked={includeLinkedPages}
          onCheckedChange={handleLinkedPagesChange}
          disabled={exporting}
        />
      </div>
    </div>
  );
}

export default ExportPanel;
