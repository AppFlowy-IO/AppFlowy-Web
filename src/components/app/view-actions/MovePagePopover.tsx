import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';

import { CrossWorkspaceCopyTerminalError } from '@/application/services/domains/page';
import { View, ViewLayout, Workspace } from '@/application/types';
import { ReactComponent as ArrowDownIcon } from '@/assets/icons/alt_arrow_down.svg';
import { ReactComponent as SelectedIcon } from '@/assets/icons/tick.svg';
import OutlineIcon from '@/components/_shared/outline/OutlineIcon';
import { filterOutByCondition } from '@/components/_shared/outline/utils';
import { useAppOverlayContext } from '@/components/app/app-overlay/AppOverlayContext';
import {
  useAppOperations,
  useAppOutline,
  useAppView,
  useCurrentWorkspaceId,
  useUserWorkspaceInfo,
} from '@/components/app/app.hooks';
import SpaceItem from '@/components/app/outline/SpaceItem';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SearchInput } from '@/components/ui/search-input';
import { Separator } from '@/components/ui/separator';

const CROSS_WORKSPACE_COPY_ACTION_PREFIX = 'appflowy:cross-workspace-copy:v2:';
const inMemoryCopyActionKeys = new Map<string, string>();

function crossWorkspaceCopyActionStorageKey(
  sourceWorkspaceId: string,
  sourceViewId: string,
  destinationWorkspaceId: string
) {
  return `${CROSS_WORKSPACE_COPY_ACTION_PREFIX}${sourceWorkspaceId}:${sourceViewId}:${destinationWorkspaceId}`;
}

function getOrCreateCrossWorkspaceCopyActionKey(storageKey: string) {
  try {
    const storedKey = window.sessionStorage.getItem(storageKey);

    if (storedKey) {
      inMemoryCopyActionKeys.set(storageKey, storedKey);
      return storedKey;
    }
  } catch {
    // The in-memory fallback still preserves retries across component unmounts.
  }

  const existingKey = inMemoryCopyActionKeys.get(storageKey);

  if (existingKey) return existingKey;

  const idempotencyKey = uuidv4();

  inMemoryCopyActionKeys.set(storageKey, idempotencyKey);
  try {
    window.sessionStorage.setItem(storageKey, idempotencyKey);
  } catch {
    // Some privacy modes disable sessionStorage; keep the tab-scoped fallback.
  }

  return idempotencyKey;
}

function clearCrossWorkspaceCopyActionKey(storageKey: string) {
  inMemoryCopyActionKeys.delete(storageKey);
  try {
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // The fallback was cleared even when browser storage is unavailable.
  }
}

function WorkspaceSelector({
  selectedWorkspace,
  workspaces,
  onSelect,
}: {
  selectedWorkspace: Workspace;
  workspaces: Workspace[];
  onSelect: (workspace: Workspace) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className='relative flex h-8 min-w-0 items-center gap-2 rounded-300 border border-border-primary px-2 focus-within:border-border-theme-thick focus-within:ring-[0.5px] focus-within:ring-border-theme-thick hover:border-border-primary-hover'>
      <Avatar shape='square' size='xs'>
        <AvatarFallback name={selectedWorkspace.name}>
          {selectedWorkspace.icon ? <span className='text-sm'>{selectedWorkspace.icon}</span> : selectedWorkspace.name}
        </AvatarFallback>
      </Avatar>
      <span className='min-w-0 flex-1 truncate text-sm'>{selectedWorkspace.name}</span>
      <ArrowDownIcon className='h-4 w-4 shrink-0 text-icon-secondary' />
      <select
        data-testid='move-page-workspace-selector'
        aria-label={t('disclosureAction.moveToWorkspaceSelect')}
        className='absolute inset-0 cursor-pointer opacity-0'
        value={selectedWorkspace.id}
        onChange={(event) => {
          const workspace = workspaces.find((candidate) => candidate.id === event.target.value);

          if (workspace) onSelect(workspace);
        }}
      >
        {workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id} data-testid={`move-to-workspace-option-${workspace.id}`}>
            {workspace.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function CrossWorkspaceCopyConfirmation({ workspace }: { workspace: Workspace }) {
  const { t } = useTranslation();

  return (
    <div
      data-testid='cross-workspace-copy-confirmation'
      className='flex min-h-[180px] flex-col justify-center gap-2 rounded-300 bg-fill-content px-4 py-5 text-sm'
    >
      <p className='font-medium text-text-primary'>
        {t('disclosureAction.copyToWorkspacePrivate', { workspace: workspace.name })}
      </p>
      <p className='text-text-secondary'>{t('disclosureAction.copyToWorkspaceSourceRetained')}</p>
      <p className='text-text-secondary'>{t('disclosureAction.copyToWorkspaceDependencies')}</p>
    </div>
  );
}

/**
 * Same-workspace destinations preserve page identity and use the ordinary
 * move endpoint. Selecting another workspace deliberately changes the action
 * into a source-retaining copy placed in that workspace's Private section.
 */
function MovePagePopover({
  viewId,
  onMoved,
  children,
  popoverContentProps,
  open: openProp,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof Popover> & {
  viewId: string;
  onMoved?: () => void;
  children: React.ReactNode;
  popoverContentProps?: React.ComponentProps<typeof PopoverContent>;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const currentWorkspaceId = useCurrentWorkspaceId();
  const userWorkspaceInfo = useUserWorkspaceInfo();
  const outline = useAppOutline();
  const view = useAppView(viewId);
  const { copyPageToWorkspace, movePage } = useAppOperations();
  const { showBlockingLoader, hideBlockingLoader } = useAppOverlayContext();

  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const [search, setSearch] = useState('');
  const [expandViewIds, setExpandViewIds] = useState<string[]>([]);
  const [selectedViewId, setSelectedViewId] = useState<string | null>(null);
  const workspaces = userWorkspaceInfo?.workspaces ?? [];
  const currentWorkspace =
    workspaces.find((workspace) => workspace.id === currentWorkspaceId) ?? userWorkspaceInfo?.selectedWorkspace;
  const [targetWorkspaceId, setTargetWorkspaceId] = useState(currentWorkspaceId);
  const targetWorkspace = workspaces.find((workspace) => workspace.id === targetWorkspaceId) ?? currentWorkspace;
  const isCrossWorkspace = Boolean(targetWorkspace && targetWorkspace.id !== currentWorkspaceId);
  const showWorkspaceSelector = workspaces.length > 1 && view?.layout !== ViewLayout.AIChat;

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setInternalOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange]
  );

  useEffect(() => {
    if (open) return;
    setSearch('');
    setExpandViewIds([]);
    setSelectedViewId(null);
    setTargetWorkspaceId(currentWorkspaceId);
  }, [currentWorkspaceId, open]);

  const views = useMemo(() => {
    if (!outline) return [];
    const query = search.toLowerCase();

    return filterOutByCondition(outline, (candidate) => ({
      remove:
        candidate.view_id === viewId ||
        candidate.layout !== ViewLayout.Document ||
        Boolean(query && !candidate.name.toLowerCase().includes(query)),
    }));
  }, [outline, search, viewId]);

  const toggleExpandView = useCallback((id: string, isExpanded: boolean) => {
    setExpandViewIds((previous) =>
      isExpanded ? [...new Set([...previous, id])] : previous.filter((candidate) => candidate !== id)
    );
  }, []);

  const handleMoveInWorkspace = useCallback(async () => {
    if (!selectedViewId) return;

    try {
      await movePage?.(viewId, selectedViewId);
      onMoved?.();
      setSelectedViewId(null);
    } catch (error) {
      toast.error((error as { message?: string }).message || t('disclosureAction.moveFailed'));
    }
  }, [movePage, onMoved, selectedViewId, t, viewId]);

  const handleCopyToWorkspace = useCallback(async () => {
    if (!copyPageToWorkspace || !currentWorkspaceId || !targetWorkspace || targetWorkspace.id === currentWorkspaceId) {
      return;
    }

    const destination = targetWorkspace;
    const actionStorageKey = crossWorkspaceCopyActionStorageKey(currentWorkspaceId, viewId, destination.id);
    const idempotencyKey = getOrCreateCrossWorkspaceCopyActionKey(actionStorageKey);

    showBlockingLoader(t('disclosureAction.copyingToWorkspace', { workspace: destination.name }));

    try {
      const result = await copyPageToWorkspace(viewId, {
        dest_workspace_id: destination.id,
        idempotency_key: idempotencyKey,
      });

      clearCrossWorkspaceCopyActionKey(actionStorageKey);
      const warningCount = (result.warnings ?? []).reduce((total, warning) => total + warning.count, 0);

      if (warningCount > 0) {
        toast.warning(
          t('disclosureAction.copyToWorkspaceWarning', {
            count: warningCount,
            workspace: destination.name,
          })
        );
      } else {
        toast.success(t('disclosureAction.copyToWorkspaceSuccess', { workspace: destination.name }));
      }

      handleOpenChange(false);
      onMoved?.();
      navigate(`/app/${result.dest_workspace_id}/${result.duplicated_view_id}`);
    } catch (error) {
      if (error instanceof CrossWorkspaceCopyTerminalError) {
        clearCrossWorkspaceCopyActionKey(actionStorageKey);
      }

      toast.error((error as { message?: string }).message || t('disclosureAction.copyToWorkspaceFailed'));
    } finally {
      hideBlockingLoader();
    }
  }, [
    copyPageToWorkspace,
    currentWorkspaceId,
    handleOpenChange,
    hideBlockingLoader,
    navigate,
    onMoved,
    showBlockingLoader,
    t,
    targetWorkspace,
    viewId,
  ]);

  const renderExtra = useCallback(
    ({ view: candidate }: { view: View }) =>
      candidate.view_id === selectedViewId ? <SelectedIcon className='mx-2 text-text-action' /> : null,
    [selectedViewId]
  );

  return (
    <Popover modal open={open} onOpenChange={handleOpenChange} {...props}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
        }}
        {...popoverContentProps}
      >
        <div className='folder-views flex w-[320px] flex-col gap-2 p-2'>
          {showWorkspaceSelector && currentWorkspaceId && currentWorkspace && targetWorkspace && (
            <WorkspaceSelector
              selectedWorkspace={targetWorkspace}
              workspaces={workspaces}
              onSelect={(workspace) => {
                setTargetWorkspaceId(workspace.id);
                setSelectedViewId(null);
                setSearch('');
              }}
            />
          )}

          {isCrossWorkspace && targetWorkspace ? (
            <CrossWorkspaceCopyConfirmation workspace={targetWorkspace} />
          ) : (
            <>
              <SearchInput
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                autoFocus
                placeholder={t('disclosureAction.movePageTo')}
              />
              <div className='appflowy-custom-scroller max-h-[360px] min-h-[180px] overflow-y-auto overflow-x-hidden'>
                {views.map((candidate) => {
                  const isExpanded = expandViewIds.includes(candidate.view_id);

                  return (
                    <div key={candidate.view_id} className='flex items-start gap-1'>
                      <div className='flex h-[30px] items-center'>
                        <OutlineIcon
                          isExpanded={isExpanded}
                          setIsExpanded={(status) => toggleExpandView(candidate.view_id, status)}
                          level={0}
                        />
                      </div>
                      <SpaceItem
                        view={candidate}
                        width={268}
                        expandIds={expandViewIds}
                        toggleExpand={toggleExpandView}
                        onClickView={(candidateId) => {
                          toggleExpandView(candidateId, !expandViewIds.includes(candidateId));
                          setSelectedViewId(candidateId);
                        }}
                        onClickSpace={setSelectedViewId}
                        renderExtra={renderExtra}
                      />
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <Separator className='mb-1' />
          <div className='flex items-center justify-end'>
            <Button
              data-testid='move-page-confirm'
              disabled={isCrossWorkspace ? !copyPageToWorkspace : !selectedViewId}
              onClick={() => void (isCrossWorkspace ? handleCopyToWorkspace() : handleMoveInWorkspace())}
            >
              {isCrossWorkspace ? t('button.duplicate') : t('disclosureAction.move')}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default MovePagePopover;
