/** Decimal strings preserve the server's signed 64-bit revision without JS rounding. */
export interface WorkspacePermissionRevision {
  epoch: string;
  counter: string;
}

export type WorkspaceSpaceCreationPolicy = 'members_and_owners' | 'owners_only' | 'owners_and_selected_members';

export interface WorkspaceSpaceCreationCapabilities {
  workspace_id: string;
  policy: WorkspaceSpaceCreationPolicy;
  revision: WorkspacePermissionRevision;
  selected_creators_supported: boolean;
  group_selection_supported: boolean;
  can_create_space: boolean;
  can_manage_space_creators: boolean;
  can_grant_creator_groups: boolean;
}

export type SpaceCreatorKind = 'user' | 'group';
export interface SpaceCreatorPrincipal {
  type: SpaceCreatorKind;
  id: string;
}

export interface SpaceCreatorSelection {
  principal: SpaceCreatorPrincipal;
  name: string | null;
  granted_by: string | null;
  granted_at: string;
  revoked_at: string | null;
  eligible: boolean;
}

export interface SpaceCreatorSelections {
  selections: SpaceCreatorSelection[];
  next_cursor: string | null;
}

export interface SpaceCreatorMutationResult {
  changed: boolean;
  revision: WorkspacePermissionRevision;
}

/** A hint to reload current authority; this event never grants access by itself. */
export interface WorkspacePermissionsChanged {
  workspaceId: string;
  revision: WorkspacePermissionRevision;
}

export function isWorkspaceSpaceCreationPolicy(value: unknown): value is WorkspaceSpaceCreationPolicy {
  return value === 'members_and_owners' || value === 'owners_only' || value === 'owners_and_selected_members';
}

function isRevisionPart(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n;
}

export function isWorkspacePermissionRevision(value: unknown): value is WorkspacePermissionRevision {
  if (!value || typeof value !== 'object') return false;
  const revision = value as Partial<WorkspacePermissionRevision>;

  return isRevisionPart(revision.epoch) && isRevisionPart(revision.counter);
}

/** Both inputs must have passed wire validation. Epoch changes fence restored/reseeded state. */
export function compareWorkspacePermissionRevisions(
  left: WorkspacePermissionRevision,
  right: WorkspacePermissionRevision
): number {
  const epoch = BigInt(left.epoch) - BigInt(right.epoch);
  const difference = epoch === 0n ? BigInt(left.counter) - BigInt(right.counter) : epoch;

  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

export function isWorkspaceSpaceCreationCapabilities(
  value: unknown,
  workspaceId: string
): value is WorkspaceSpaceCreationCapabilities {
  if (!value || typeof value !== 'object') return false;
  const capability = value as Partial<WorkspaceSpaceCreationCapabilities>;

  return (
    capability.workspace_id === workspaceId &&
    isWorkspaceSpaceCreationPolicy(capability.policy) &&
    isWorkspacePermissionRevision(capability.revision) &&
    typeof capability.selected_creators_supported === 'boolean' &&
    typeof capability.group_selection_supported === 'boolean' &&
    typeof capability.can_create_space === 'boolean' &&
    typeof capability.can_manage_space_creators === 'boolean' &&
    typeof capability.can_grant_creator_groups === 'boolean'
  );
}
