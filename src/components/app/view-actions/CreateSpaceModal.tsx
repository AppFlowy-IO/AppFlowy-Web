import { X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { v4 as uuidv4 } from 'uuid';

import type { KeyboardEvent } from 'react';

import { ERROR_CODE } from '@/application/constants';
import { PageService, WorkspaceService } from '@/application/services/domains';
import {
  AccessLevel,
  CreatePagePayload,
  Role,
  SpaceMemberRole,
  SpacePermissionSettings,
  SpaceVisibility,
  WorkspaceMember,
} from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { useAppOperations, useCurrentWorkspaceId, useUserWorkspaceInfo } from '@/components/app/app.hooks';
import {
  getWorkspaceMemberUid,
  useAddableWorkspaceMembers,
  WorkspaceMemberInlineSearch,
  workspaceMemberDisplayName,
} from '@/components/app/share/WorkspaceMemberInlineSearch';
import SpaceSettingsPanel, { SpaceSettingsTab } from '@/components/app/view-actions/SpaceSettingsPanel';
import {
  defaultEveryoneElseAccessLevel,
  defaultSpacePermissionSettings,
  SELECTABLE_SPACE_VISIBILITIES,
} from '@/components/app/view-actions/spaceVisibilityOptions';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { getErrorMessage } from '@/utils/errors';

const DEFAULT_SPACE_VISIBILITY = SpaceVisibility.Public;
const DRAFT_EXCLUDED_ROLES = [Role.Owner];

type CommittedSpace = {
  spaceId: string;
  initialPageId?: string;
};

type QueuedMember = {
  uid: string;
  accessLevel: AccessLevel;
};

function isMissingOrDeletedResource(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as {
    code?: unknown;
    httpStatus?: unknown;
    response?: { status?: unknown; data?: { code?: unknown } };
  };
  const code = candidate.code ?? candidate.response?.data?.code;
  const httpStatus = candidate.httpStatus ?? candidate.response?.status;

  return (
    code === ERROR_CODE.RECORD_NOT_FOUND ||
    code === ERROR_CODE.RECORD_DELETED ||
    httpStatus === 404 ||
    httpStatus === 410
  );
}

function mayHaveCommittedCreate(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return true;
  const candidate = error as {
    code?: unknown;
    clientGeneratedCleanupSucceeded?: unknown;
    httpStatus?: unknown;
    response?: { status?: unknown; data?: { code?: unknown } };
  };

  if (candidate.clientGeneratedCleanupSucceeded === true) return false;
  if (candidate.clientGeneratedCleanupSucceeded === false) return true;
  const code = candidate.code ?? candidate.response?.data?.code;
  const explicitHttpStatus = candidate.httpStatus ?? candidate.response?.status;
  const httpStatus =
    typeof explicitHttpStatus === 'number'
      ? explicitHttpStatus
      : typeof code === 'number' && code >= 100 && code <= 599
      ? code
      : undefined;

  // `-1` is the HTTP layer's network/malformed-response sentinel. Timeouts,
  // conflicts for a client-owned ID, and server failures can likewise arrive
  // after the server committed the mutation. Ordinary 4xx/application errors
  // are authoritative rejections and must leave the draft editable.
  return (
    (code === undefined && httpStatus === undefined) ||
    code === -1 ||
    httpStatus === 408 ||
    httpStatus === 409 ||
    (httpStatus !== undefined && httpStatus >= 500 && httpStatus <= 599)
  );
}

function clientGeneratedCleanupWasConfirmed(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { clientGeneratedCleanupSucceeded?: unknown }).clientGeneratedCleanupSucceeded === true
  );
}

async function discardClientOwnedDraftSpace(workspaceId: string, spaceId: string): Promise<void> {
  let inactiveConfirmed = false;

  try {
    await PageService.moveToTrash(workspaceId, spaceId);
    inactiveConfirmed = true;
  } catch (error) {
    if (isMissingOrDeletedResource(error)) {
      inactiveConfirmed = true;
    } else {
      // A lost move response may still have committed. A successful permanent
      // delete can reconcile that outcome; otherwise preserve the stable ID.
      try {
        await PageService.deleteTrash(workspaceId, spaceId);
        return;
      } catch {
        throw error;
      }
    }
  }

  try {
    await PageService.deleteTrash(workspaceId, spaceId);
  } catch (error) {
    // A confirmed move already removed the space from the active outline.
    // Permanent deletion is best-effort and must not reopen or hand off the
    // trashed ID.
    if (!inactiveConfirmed && !isMissingOrDeletedResource(error)) throw error;
  }
}

function permissionSettingsForCreation(settings: SpacePermissionSettings): SpacePermissionSettings {
  return {
    ...settings,
    everyone_else_access_level:
      settings.visibility === SpaceVisibility.Custom ? settings.everyone_else_access_level ?? null : null,
  };
}

function CreateSpaceModal({
  open,
  onClose,
  onCreated,
  initialPage,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (spaceId: string, initialPageId?: string) => void;
  initialPage?: CreatePagePayload;
}) {
  const { t } = useTranslation();
  const { createSpace, createSpaceWithInitialPage } = useAppOperations();
  const workspaceId = useCurrentWorkspaceId();
  const userWorkspaceInfo = useUserWorkspaceInfo();
  const currentUser = useCurrentUserOptional();
  const [tab, setTab] = useState<SpaceSettingsTab>('general');
  const [spaceName, setSpaceName] = useState('');
  const [spaceIcon, setSpaceIcon] = useState('');
  const [spaceIconColor, setSpaceIconColor] = useState('');
  const [permissionSettings, setPermissionSettings] = useState<SpacePermissionSettings>(() =>
    defaultSpacePermissionSettings(DEFAULT_SPACE_VISIBILITY)
  );
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
  const [loadedWorkspaceMemberDirectoryId, setLoadedWorkspaceMemberDirectoryId] = useState<string | null>(null);
  const [loadingWorkspaceMembers, setLoadingWorkspaceMembers] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<WorkspaceMember[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [committedSpace, setCommittedSpace] = useState<CommittedSpace | null>(null);
  const [hasAmbiguousCreation, setHasAmbiguousCreation] = useState(false);
  const creatingRef = useRef(false);
  const draftSpaceIdRef = useRef(uuidv4());
  const draftInitialPageIdRef = useRef(uuidv4());
  const committedSpaceRef = useRef<CommittedSpace | null>(null);
  const queuedMembersRef = useRef<QueuedMember[]>([]);
  const appliedMemberUidsRef = useRef(new Set<string>());

  const currentWorkspace = useMemo(() => {
    const workspaces = userWorkspaceInfo?.workspaces ?? [];

    return workspaces.find((workspace) => workspace.id === workspaceId) ?? userWorkspaceInfo?.selectedWorkspace;
  }, [userWorkspaceInfo, workspaceId]);
  const workspaceName = currentWorkspace?.name?.trim() || '';
  const privateOwner = useMemo(
    () => ({
      name: currentUser?.name,
      email: currentUser?.email,
      avatar: currentUser?.avatar,
      workspaceRole: currentWorkspace?.role,
    }),
    [currentUser?.avatar, currentUser?.email, currentUser?.name, currentWorkspace?.role]
  );

  useEffect(() => {
    if (
      !open ||
      permissionSettings.visibility !== SpaceVisibility.Custom ||
      !workspaceId ||
      loadedWorkspaceMemberDirectoryId === workspaceId
    ) {
      return;
    }

    let cancelled = false;

    setWorkspaceMembers([]);
    setLoadingWorkspaceMembers(true);
    void WorkspaceService.getMembers(workspaceId)
      .then((members) => {
        if (cancelled) return;
        setWorkspaceMembers(members);
        setLoadedWorkspaceMemberDirectoryId(workspaceId);
      })
      .catch((error) => {
        if (!cancelled) notify.error(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setLoadingWorkspaceMembers(false);
      });

    return () => {
      cancelled = true;
    };
  }, [loadedWorkspaceMemberDirectoryId, open, permissionSettings.visibility, workspaceId]);

  const selectedMemberUids = useMemo(() => {
    const uids = new Set(selectedMembers.map(getWorkspaceMemberUid).filter((uid): uid is string => Boolean(uid)));
    const currentUserId = userWorkspaceInfo?.userId;

    if (currentUserId !== undefined && currentUserId !== null) uids.add(String(currentUserId));
    return uids;
  }, [selectedMembers, userWorkspaceInfo?.userId]);

  const selectedMemberEmails = useMemo(
    () => new Set(selectedMembers.map((member) => member.email.trim().toLowerCase())),
    [selectedMembers]
  );

  const addableWorkspaceMembers = useAddableWorkspaceMembers({
    workspaceMembers,
    search: memberSearch,
    excludedUids: selectedMemberUids,
    excludedEmails: selectedMemberEmails,
    excludedRoles: DRAFT_EXCLUDED_ROLES,
    excludePending: true,
  });

  const applyQueuedMembers = useCallback(
    async (spaceId: string) => {
      if (!workspaceId || queuedMembersRef.current.length === 0) return;
      const pending = queuedMembersRef.current.filter(({ uid }) => !appliedMemberUidsRef.current.has(uid));
      const results = await Promise.allSettled(
        pending.map(async ({ uid, accessLevel }) => {
          await WorkspaceService.addSpaceMember(workspaceId, spaceId, {
            uid,
            role: SpaceMemberRole.Member,
            access_level: accessLevel,
          });
          appliedMemberUidsRef.current.add(uid);
        })
      );
      const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');

      if (failure) throw failure.reason;
    },
    [workspaceId]
  );

  const resetDraft = useCallback(() => {
    setTab('general');
    setSpaceName('');
    setSpaceIcon('');
    setSpaceIconColor('');
    setPermissionSettings(defaultSpacePermissionSettings(DEFAULT_SPACE_VISIBILITY));
    setSelectedMembers([]);
    setMemberSearch('');
    setCommittedSpace(null);
    setHasAmbiguousCreation(false);
    committedSpaceRef.current = null;
    queuedMembersRef.current = [];
    appliedMemberUidsRef.current.clear();
    draftSpaceIdRef.current = uuidv4();
    draftInitialPageIdRef.current = uuidv4();
  }, []);

  const finishCreation = useCallback(() => {
    const committed = committedSpaceRef.current;

    if (!committed) return;
    const { spaceId, initialPageId } = committed;

    resetDraft();
    onClose();
    onCreated?.(spaceId, initialPageId);
  }, [onClose, onCreated, resetDraft]);

  const finishCommittedClose = useCallback(async () => {
    const committed = committedSpaceRef.current;

    if (!committed || creatingRef.current) return;
    const hasPendingRoster = queuedMembersRef.current.some(({ uid }) => !appliedMemberUidsRef.current.has(uid));

    if (!hasPendingRoster) {
      finishCreation();
      return;
    }

    let completed = false;

    creatingRef.current = true;
    setLoading(true);
    try {
      await applyQueuedMembers(committed.spaceId);
      completed = true;
    } catch (error) {
      notify.error(getErrorMessage(error));
    } finally {
      creatingRef.current = false;
      setLoading(false);
    }

    if (completed) finishCreation();
  }, [applyQueuedMembers, finishCreation]);

  const resolveAmbiguousClose = useCallback(async () => {
    if (!workspaceId || creatingRef.current) return;
    const clientOwnedSpaceId = draftSpaceIdRef.current;
    let resolution: 'committed' | 'discarded' | null = null;

    creatingRef.current = true;
    setLoading(true);
    try {
      if (initialPage) {
        if (!createSpaceWithInitialPage) throw new Error('Create space service is unavailable');
        const result = await createSpaceWithInitialPage({
          name: spaceName.trim(),
          space_icon: spaceIcon,
          space_icon_color: spaceIconColor,
          view_id: clientOwnedSpaceId,
          client_generated_view_id: true,
          permission: permissionSettingsForCreation(permissionSettings),
          initial_page: {
            ...initialPage,
            view_id: initialPage.view_id ?? draftInitialPageIdRef.current,
          },
        });
        const committed = { spaceId: result.space.view_id, initialPageId: result.page.view_id };

        committedSpaceRef.current = committed;
        setCommittedSpace(committed);
        await applyQueuedMembers(committed.spaceId);
        resolution = 'committed';
      } else {
        let spaceExists = false;

        try {
          await WorkspaceService.getSpacePermission(workspaceId, clientOwnedSpaceId);
          spaceExists = true;
        } catch {
          await discardClientOwnedDraftSpace(workspaceId, clientOwnedSpaceId);
          resolution = 'discarded';
        }

        if (spaceExists) {
          const committed = { spaceId: clientOwnedSpaceId };

          committedSpaceRef.current = committed;
          setCommittedSpace(committed);
          await applyQueuedMembers(clientOwnedSpaceId);
          resolution = 'committed';
        }
      }
    } catch (error) {
      if (
        initialPage &&
        typeof error === 'object' &&
        error !== null &&
        (error as { clientGeneratedCleanupSucceeded?: unknown }).clientGeneratedCleanupSucceeded === true
      ) {
        resolution = 'discarded';
      } else {
        // Keep the exact client-owned ID and frozen payload in this mounted
        // draft. A later Retry or Close can safely reconcile the same request;
        // silently resetting here could orphan a committed space.
        notify.error(getErrorMessage(error));
      }
    } finally {
      creatingRef.current = false;
      setLoading(false);
    }

    if (resolution === 'committed') {
      finishCreation();
    } else if (resolution === 'discarded') {
      resetDraft();
      onClose();
    }
  }, [
    applyQueuedMembers,
    createSpaceWithInitialPage,
    finishCreation,
    initialPage,
    onClose,
    permissionSettings,
    resetDraft,
    spaceIcon,
    spaceIconColor,
    spaceName,
    workspaceId,
  ]);

  const handleClose = useCallback(() => {
    if (creatingRef.current) return;
    if (committedSpaceRef.current) {
      // Do not hand off a partially applied roster. Close retries only the
      // pending member requests against the already committed stable ID.
      void finishCommittedClose();
      return;
    }

    if (hasAmbiguousCreation) {
      void resolveAmbiguousClose();
      return;
    }

    resetDraft();
    onClose();
  }, [finishCommittedClose, hasAmbiguousCreation, onClose, resetDraft, resolveAmbiguousClose]);

  const handleSpaceIconChange = useCallback((icon: string, color: string) => {
    setSpaceIcon(icon);
    setSpaceIconColor(color);
  }, []);

  const handleVisibilitySelect = useCallback((visibility: SpaceVisibility) => {
    if (committedSpaceRef.current) return;
    setTab('general');
    setPermissionSettings((current) => {
      const defaults = defaultSpacePermissionSettings(visibility);

      return {
        ...current,
        visibility,
        member_default_access_level: current.member_default_access_level ?? defaults.member_default_access_level,
        everyone_else_access_level:
          visibility === SpaceVisibility.Custom
            ? current.visibility === SpaceVisibility.Custom
              ? current.everyone_else_access_level ?? null
              : defaultEveryoneElseAccessLevel(visibility)
            : null,
      };
    });
  }, []);

  const handleMembersAccessChange = useCallback((value: AccessLevel | null) => {
    if (committedSpaceRef.current) return;
    setPermissionSettings((current) => ({
      ...current,
      member_default_access_level: value,
    }));
  }, []);

  const handleEveryoneElseAccessChange = useCallback((value: AccessLevel | null) => {
    if (committedSpaceRef.current) return;
    setPermissionSettings((current) => ({
      ...current,
      everyone_else_access_level: value,
    }));
  }, []);

  const handleAddDraftMember = useCallback((member: WorkspaceMember) => {
    const uid = getWorkspaceMemberUid(member);

    if (!uid || committedSpaceRef.current) return;
    setSelectedMembers((current) =>
      current.some((selected) => getWorkspaceMemberUid(selected) === uid) ? current : [...current, member]
    );
    setMemberSearch('');
  }, []);

  const handleRemoveDraftMember = useCallback((uid: string) => {
    if (committedSpaceRef.current) return;
    setSelectedMembers((current) => current.filter((member) => getWorkspaceMemberUid(member) !== uid));
  }, []);

  const handleMemberSearchKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    // NormalModal treats Enter from a plain input as its primary action. A
    // member query must never create the space before the highlighted person
    // is explicitly added to the local draft.
    if (event.key === 'Enter') event.stopPropagation();
  }, []);

  const handleCreate = useCallback(async () => {
    if (creatingRef.current) return;
    const trimmedName = spaceName.trim();

    if (!trimmedName) {
      notify.error(t('space.spaceNameCannotBeEmpty'));
      return;
    }

    if (!committedSpaceRef.current && !createSpace && !(initialPage && createSpaceWithInitialPage)) return;

    creatingRef.current = true;
    setLoading(true);
    try {
      let committed = committedSpaceRef.current;

      if (!committed) {
        const visibility = permissionSettings.visibility;
        const spacePayload = {
          name: trimmedName,
          space_icon: spaceIcon,
          space_icon_color: spaceIconColor,
          view_id: draftSpaceIdRef.current,
          client_generated_view_id: true,
          permission: permissionSettingsForCreation(permissionSettings),
        };
        const memberAccessLevel = permissionSettings.member_default_access_level ?? AccessLevel.ReadOnly;

        queuedMembersRef.current =
          visibility === SpaceVisibility.Custom
            ? selectedMembers.flatMap((member) => {
                const uid = getWorkspaceMemberUid(member);

                return uid ? [{ uid, accessLevel: memberAccessLevel }] : [];
              })
            : [];
        appliedMemberUidsRef.current.clear();

        if (initialPage) {
          if (!createSpaceWithInitialPage) return;
          const result = await createSpaceWithInitialPage({
            ...spacePayload,
            initial_page: {
              ...initialPage,
              view_id: initialPage.view_id ?? draftInitialPageIdRef.current,
            },
          });

          committed = { spaceId: result.space.view_id, initialPageId: result.page.view_id };
        } else {
          if (!createSpace) return;
          committed = { spaceId: await createSpace(spacePayload) };
        }

        // Record the committed identity before any queued member POST. A retry
        // after a partial failure can only target this space and cannot create
        // a duplicate.
        committedSpaceRef.current = committed;
        setCommittedSpace(committed);
        setHasAmbiguousCreation(false);
      }

      await applyQueuedMembers(committed.spaceId);
      finishCreation();
    } catch (error) {
      if (!committedSpaceRef.current) {
        if (!mayHaveCommittedCreate(error)) {
          const cleanupConfirmed = clientGeneratedCleanupWasConfirmed(error);

          // A definitive rejection only proves that this attempt did not
          // commit. If an earlier attempt is still ambiguous, keep the frozen
          // ID and roster until that earlier request is reconciled. Confirmed
          // cleanup is the stronger signal that makes the whole sequence safe
          // to reset and edit again.
          if (!hasAmbiguousCreation || cleanupConfirmed) {
            setHasAmbiguousCreation(false);
            queuedMembersRef.current = [];
            appliedMemberUidsRef.current.clear();
          }

          if (cleanupConfirmed) {
            // The previous IDs now refer to trash/tombstones. Preserve the
            // user's draft fields but rotate both resource identities before
            // the next editable Create attempt.
            draftSpaceIdRef.current = uuidv4();
            draftInitialPageIdRef.current = uuidv4();
          }
        } else {
          setHasAmbiguousCreation(true);
        }
      }

      notify.error(getErrorMessage(error));
    } finally {
      creatingRef.current = false;
      setLoading(false);
    }
  }, [
    applyQueuedMembers,
    createSpace,
    createSpaceWithInitialPage,
    finishCreation,
    hasAmbiguousCreation,
    initialPage,
    permissionSettings,
    selectedMembers,
    spaceIcon,
    spaceIconColor,
    spaceName,
    t,
  ]);

  const memberControlsDisabled = loading || Boolean(committedSpace) || hasAmbiguousCreation;

  return (
    <SpaceSettingsPanel
      open={open}
      onClose={handleClose}
      title={t('space.createSpace')}
      modalTestId='create-space-modal'
      activeTab={tab}
      onTabChange={setTab}
      membersTabVisible
      membersTabDisabled={false}
      membersContent={
        <div className='appflowy-scroller max-h-[64vh] overflow-y-auto py-2 pr-1'>
          {permissionSettings.visibility !== SpaceVisibility.Custom ? (
            <div className='rounded-400 bg-fill-content-hover px-4 py-3 text-sm text-text-secondary'>
              {t('space.customPermissionDescription')}
            </div>
          ) : (
            <div className='flex flex-col gap-4'>
              <WorkspaceMemberInlineSearch
                search={memberSearch}
                onSearchChange={setMemberSearch}
                addableMembers={addableWorkspaceMembers}
                searchPlaceholder={t('space.permissionManager.searchWorkspaceMembers')}
                addButtonLabel={t('space.permissionManager.addMembers')}
                addResultLabel={t('space.permissionManager.notInSpace')}
                addActionLabel={t('space.permissionManager.add')}
                ownerBadgeLabel={t('space.permissionManager.workspaceOwner')}
                unavailableTitle={t('space.permissionManager.workspaceMemberUidUnavailable')}
                unavailableHint={t('space.permissionManager.workspaceMemberUidUnavailableHint')}
                inputDisabled={memberControlsDisabled || loadingWorkspaceMembers}
                addButtonDisabled={memberControlsDisabled || loadingWorkspaceMembers}
                onInputKeyDown={handleMemberSearchKeyDown}
                onAddMember={handleAddDraftMember}
              />
              {loadingWorkspaceMembers && <Progress />}
              {selectedMembers.length > 0 && (
                <div className='flex flex-col' data-testid='create-space-draft-members'>
                  {selectedMembers.map((member) => {
                    const uid = getWorkspaceMemberUid(member);

                    if (!uid) return null;
                    const displayName = workspaceMemberDisplayName(member);

                    return (
                      <div
                        key={uid}
                        className='flex items-center gap-3 border-b border-border-primary py-3'
                        data-testid={`create-space-draft-member-${uid}`}
                      >
                        <Avatar size='md'>
                          <AvatarImage src={member.avatar_url} alt={member.name} />
                          <AvatarFallback name={displayName}>{displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className='min-w-0 flex-1'>
                          <div className='truncate font-medium text-text-primary'>{displayName}</div>
                          <div className='truncate text-sm text-text-secondary'>{member.email}</div>
                        </div>
                        <Button
                          type='button'
                          variant='ghost'
                          size='sm'
                          disabled={memberControlsDisabled}
                          aria-label={`${t('space.permissionManager.remove')} ${displayName}`}
                          onClick={() => handleRemoveDraftMember(uid)}
                        >
                          <X aria-hidden='true' className='h-4 w-4' />
                          {t('space.permissionManager.remove')}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      }
      spaceName={spaceName}
      spaceIcon={spaceIcon}
      spaceIconColor={spaceIconColor}
      metadataDisabled={memberControlsDisabled}
      onSpaceNameChange={setSpaceName}
      onSpaceIconChange={handleSpaceIconChange}
      permissionSettings={permissionSettings}
      visibilityOptions={SELECTABLE_SPACE_VISIBILITIES}
      permissionSettingsDisabled={memberControlsDisabled}
      workspaceName={workspaceName}
      privateOwner={privateOwner}
      onVisibilitySelect={handleVisibilitySelect}
      onMembersAccessChange={handleMembersAccessChange}
      onEveryoneElseAccessChange={handleEveryoneElseAccessChange}
      showActions
      primaryActionText={committedSpace || hasAmbiguousCreation ? t('button.retry') : t('button.create')}
      primaryActionLoading={loading}
      primaryActionDisabled={loading || !spaceName.trim()}
      onPrimaryAction={() => void handleCreate()}
    />
  );
}

export default CreateSpaceModal;
