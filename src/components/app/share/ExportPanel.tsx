import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { BillingService } from '@/application/services/domains';
import { getViewPdfBlob, withUntitledFallback } from '@/application/services/js-services/http/export-api';
import { SubscriptionInterval, SubscriptionPlan } from '@/application/types';
import { ReactComponent as PDFIcon } from '@/assets/icons/pdf.svg';
import { useAppOverlayContext } from '@/components/app/app-overlay/AppOverlayContext';
import { useAppView, useCurrentWorkspaceId, useGetSubscriptions } from '@/components/app/app.hooks';
import { useIsOfficialHosted } from '@/components/app/hooks/useServerInfo';
import { useWorkspaceSubscriptionPlan } from '@/components/app/hooks/useWorkspaceSubscriptionPlan';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { downloadBlob } from '@/utils/download';

/**
 * What the Export tab exports when it differs from the shared view. A full-page
 * database row shares through its database but must export its own row
 * document.
 */
export interface ExportTarget {
  /** Undefined while the target is still resolving; export stays disabled. */
  viewId?: string;
  /** Runs before the export request, e.g. so a row document has its title. */
  prepare?: () => Promise<void>;
}

function ExportPanel({ viewId, exportTarget }: { viewId: string; exportTarget?: ExportTarget }) {
  const { t } = useTranslation();
  const view = useAppView(viewId);
  const exportViewId = exportTarget ? exportTarget.viewId : view?.view_id;
  const prepareExport = exportTarget?.prepare;
  const workspaceId = useCurrentWorkspaceId();
  const getSubscriptions = useGetSubscriptions();
  const { isPro, isLoading, hasError } = useWorkspaceSubscriptionPlan({ getSubscriptions, workspaceId });
  const isHosted = useIsOfficialHosted();
  const { showBlockingLoader, hideBlockingLoader } = useAppOverlayContext();
  const [linkedPagesOverride, setLinkedPagesOverride] = useState<boolean | null>(null);
  const includeLinkedPages = linkedPagesOverride ?? isPro;
  const [exporting, setExporting] = useState<boolean>(false);
  const exportingRef = useRef<boolean>(false);

  const handleExportPdf = useCallback(async () => {
    if (!workspaceId || !exportViewId || exportingRef.current) return;

    exportingRef.current = true;
    setExporting(true);
    showBlockingLoader(`${t('shareAction.exportPdfExporting')}...`);
    try {
      await prepareExport?.();
      const { blob, filename } = await getViewPdfBlob(workspaceId, exportViewId, {
        includeNested: isPro ? includeLinkedPages : false,
        // Mirror desktop: embedded databases are a Pro feature
        // (share_bloc.dart:447 shouldIncludeEmbeddedDatabases = isProPlan).
        // Self-host users have isPro=true via useSubscriptionPlan.
        includeDatabase: isPro,
      });

      downloadBlob(blob, withUntitledFallback(filename, t('menuAppHeader.defaultNewPageName')));
      toast.success(t('shareAction.exportPdfSuccess'));
    } catch (e) {
      const message = (e as { message?: string })?.message ?? t('shareAction.exportPdfError');

      toast.error(message);
    } finally {
      exportingRef.current = false;
      setExporting(false);
      hideBlockingLoader();
    }
  }, [
    workspaceId,
    exportViewId,
    prepareExport,
    isPro,
    includeLinkedPages,
    t,
    showBlockingLoader,
    hideBlockingLoader,
  ]);

  // Free users on AppFlowy Cloud get redirected to the Pro upgrade flow when they
  // try to enable "Include linked pages". Self-hosted users have isPro=true (set
  // by useSubscriptionPlan) so the toggle works normally without a billing check.
  const handleLinkedPagesChange = useCallback(
    async (checked: boolean) => {
      if (checked && !isPro) {
        if (!isHosted || isLoading || hasError || !workspaceId) return;
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
    [isPro, isHosted, isLoading, hasError, workspaceId, t],
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
          disabled={exporting || !workspaceId || !exportViewId}
          loading={exporting}
        >
          {exporting ? t('shareAction.exportPdfExporting') : t('shareAction.exportPdf')}
        </Button>
      </div>

      <div className='flex items-center justify-between gap-4'>
        <div className='flex flex-col'>
          <span className='text-sm text-text-primary'>{t('shareAction.exportPdfIncludeLinkedPages')}</span>
          {isHosted && !isPro && !isLoading && !hasError && (
            <span className='text-xs text-text-tertiary'>{t('shareAction.exportPdfIncludeLinkedPagesPro')}</span>
          )}
        </div>
        <Switch
          data-testid='export-include-linked-pages-switch'
          checked={includeLinkedPages}
          onCheckedChange={handleLinkedPagesChange}
          disabled={exporting || isLoading || hasError}
        />
      </div>
    </div>
  );
}

export default ExportPanel;
