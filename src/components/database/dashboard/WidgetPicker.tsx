import { lazy, Suspense } from 'react';

import { getWorkspaceDatabaseCatalog } from '@/application/services/domains/view';
import { UIVariant } from '@/application/types';
import { Dialog } from '@/components/ui/dialog';

import { WidgetPickerRequest } from './DashboardUiContext';
import { CreateWidgetViewRequest } from './hooks/useCreateWidgetView';

// The picker (its option builders, the catalog hook, the dialog body) only
// mounts while an editor has it open: viewers and published dashboards never
// load it.
const loadWidgetPickerContent = () => import('./WidgetPickerContent');
const WidgetPickerContent = lazy(loadWidgetPickerContent);

/**
 * Fetch the picker's code, and the workspace catalog it lists, ahead of a
 * click (on hover / focus of an add button). The picker then reads the
 * catalog snapshot or joins the request in flight instead of starting its own;
 * a published dashboard's picker never loads the catalog.
 */
export function preloadWidgetPicker(workspaceId: string | undefined, variant: UIVariant | undefined) {
  void loadWidgetPickerContent();
  // A failure is left to the picker, which retries and shows it.
  if (workspaceId && variant !== UIVariant.Publish) void getWorkspaceDatabaseCatalog(workspaceId).catch(() => undefined);
}

interface WidgetPickerProps {
  request: WidgetPickerRequest | null;
  onClose: () => void;
  onPick: (viewId: string, databaseId: string) => void;
  /**
   * Create a view and place it for the open request. The caller adds the
   * widget and closes the picker itself, so the view is never left without
   * its widget; resolves `null` when nothing was created.
   */
  createView: (request: CreateWidgetViewRequest) => Promise<string | null>;
  canCreateInOtherDatabases: boolean;
}

/**
 * Chooses the view a widget shows: an existing view of any database, or a new
 * view created on the spot. Also used by "Change view" (replace mode). While a
 * new view is being created the picker cannot be dismissed and offers no other
 * choice.
 */
export function WidgetPicker({ request, onClose, onPick, createView, canCreateInOtherDatabases }: WidgetPickerProps) {
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open={request !== null}
    >
      {request ? (
        <Suspense fallback={null}>
          <WidgetPickerContent
            canCreateInOtherDatabases={canCreateInOtherDatabases}
            createView={createView}
            onPick={onPick}
            request={request}
          />
        </Suspense>
      ) : null}
    </Dialog>
  );
}

export default WidgetPicker;
