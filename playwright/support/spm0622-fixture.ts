/**
 * Stable accounts owned by the server's `space_permission_matrix_seed.rs` fixture.
 *
 * Feature wording keeps the shorter default/open/closed aliases, but every suite
 * must resolve them through this map so obsolete fixture identities cannot drift
 * independently between tests.
 */
export const SPM0622_PASSWORD = 'AppFlowy!@123';

export const SPM0622_ACCOUNTS = {
  'owner 1': 'spm0622-owner1@appflowy.local',
  'owner 2': 'spm0622-owner2@appflowy.local',
  'member default': 'spm0622-member-general@appflowy.local',
  'member open': 'spm0622-member-shared@appflowy.local',
  'member closed': 'spm0622-member-restricted@appflowy.local',
  'member private': 'spm0622-member-private@appflowy.local',
  'guest closed': 'spm0622-guest-restricted@appflowy.local',
  'guest private': 'spm0622-guest-private@appflowy.local',
  'guest none': 'spm0622-guest-none@appflowy.local',
} as const;

export type Spm0622AccountAlias = keyof typeof SPM0622_ACCOUNTS;
