/**
 * Synthetic "Demo" workspace for the Web permission screenshot gallery.
 *
 * Opt-in and isolated: every change goes through the public GoTrue and Cloud HTTP APIs of a
 * loopback stack that exists only for the gallery (see `galleryConfigFromEnv`). It switches the
 * installation's workspace creation policy, so it refuses the usual developer ports. Running it
 * again restores the same state, so captures can be repeated on the same database.
 */

export type GalleryPerson = 'olivia' | 'alex' | 'sam' | 'jordan';
export type GalleryGroup = 'Users' | 'HR' | 'Product' | 'Super_Users';
export type GallerySpace = 'General' | 'HR' | 'Product' | 'Leadership';
export type GalleryPage = 'handbook' | 'onboarding' | 'holidays' | 'roadmap' | 'releaseNotes' | 'boardNotes';

export const GALLERY_PEOPLE: Record<GalleryPerson, { name: string; email: string }> = {
  olivia: { name: 'Olivia Martin', email: 'olivia@demo.test' },
  alex: { name: 'Alex Dupont', email: 'alex@demo.test' },
  sam: { name: 'Sam Leroy', email: 'sam@demo.test' },
  // Signs up after workspace creation is restricted: no workspace, one pending invitation.
  jordan: { name: 'Jordan Petit', email: 'jordan@demo.test' },
};

export const GALLERY_WORKSPACE_NAME = 'Demo';

const GROUP_MEMBERS: Record<GalleryGroup, GalleryPerson[]> = {
  Users: ['olivia', 'alex'],
  HR: ['olivia', 'sam'],
  // Olivia is in Product too: it gives her more access to the Product space than her own row.
  Product: ['olivia', 'alex', 'sam'],
  Super_Users: ['alex'],
};

/** Cloud error code for "invitation created, but its email could not be sent". */
const MAILER_ERROR = 1059;

/** Access levels of the Cloud API. */
const VIEW = 10;
const EDIT = 30;
const FULL = 50;

type Visibility = 'public' | 'custom' | 'private';

interface SpacePermission {
  visibility: Visibility;
  owner_access_level: number;
  member_default_access_level: number | null;
  everyone_else_access_level: number | null;
  invite_policy: 'owners_only' | 'members_and_owners';
  sidebar_edit_policy: 'owners_only' | 'members_and_owners';
  invite_link_enabled: boolean;
  security: { disable_guests: boolean; disable_public_links: boolean; disable_export: boolean };
}

function spacePermission(visibility: Visibility, overrides: Partial<SpacePermission> = {}): SpacePermission {
  return {
    visibility,
    owner_access_level: FULL,
    member_default_access_level: EDIT,
    everyone_else_access_level: null,
    invite_policy: 'owners_only',
    sidebar_edit_policy: 'members_and_owners',
    invite_link_enabled: false,
    security: { disable_guests: false, disable_public_links: false, disable_export: false },
    ...overrides,
  };
}

const CREATED_SPACES: Record<Exclude<GallerySpace, 'General'>, {
  creator: GalleryPerson;
  icon: string;
  color: string;
  permission: SpacePermission;
}> = {
  // Space members can edit by default, everyone else has no access, only space owners add pages.
  HR: {
    creator: 'olivia',
    icon: 'money_shopping/business-user-curriculum',
    color: '0xFFF254BC',
    permission: spacePermission('custom', { sidebar_edit_policy: 'owners_only' }),
  },
  // Created by a selected space creator, who becomes its owner.
  Product: {
    creator: 'alex',
    icon: 'money_shopping/startup',
    color: '0xFF00C8FF',
    permission: spacePermission('custom'),
  },
  Leadership: {
    creator: 'olivia',
    icon: 'interface_essential/keyhole-lock-circle',
    color: '0xFF535CE4',
    permission: spacePermission('private'),
  },
};

const PAGES: Record<GalleryPage, { space: GallerySpace; author: GalleryPerson; name: string; text: string }> = {
  handbook: {
    space: 'General',
    author: 'olivia',
    name: 'Team handbook',
    text: 'How we work together: meetings, tools and who to ask.',
  },
  onboarding: {
    space: 'HR',
    author: 'olivia',
    name: 'Onboarding checklist',
    text: 'Welcome aboard! Laptop, accounts and a first coffee with your buddy.',
  },
  holidays: {
    space: 'HR',
    author: 'olivia',
    name: 'Holiday policy',
    text: 'Book time off two weeks ahead and add it to the team calendar.',
  },
  roadmap: {
    space: 'Product',
    author: 'alex',
    name: 'Roadmap 2027',
    text: 'Three themes for next year: faster sync, offline mode and better search.',
  },
  releaseNotes: {
    space: 'Product',
    author: 'alex',
    name: 'Release notes',
    text: 'Version 4.2 adds space permissions and access to all spaces for groups.',
  },
  boardNotes: {
    space: 'Leadership',
    author: 'olivia',
    name: 'Board meeting notes',
    text: 'Budget review and hiring plan for the first quarter.',
  },
};

export interface GalleryConfig {
  cloud: string;
  gotrue: string;
  web: string;
  adminEmail: string;
  adminPassword: string;
  /** Password of the synthetic people; they exist only on the gallery stack. */
  password: string;
}

/** Ports of the usual local developer stack: the gallery must never run there. */
const DEVELOPER_PORTS = new Set(['8000', '8001', '8002', '8100', '9999', '3000', '5432', '6379', '9000']);

function loopbackOrigin(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required for the permission gallery`);
  const url = new URL(value);

  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error(`${name} must be a plain loopback http origin`);
  }

  if (!url.port || DEVELOPER_PORTS.has(url.port) || /^331\d\d$/.test(url.port)) {
    throw new Error(`${name} points at a developer stack port; use an isolated gallery stack`);
  }

  return url.origin;
}

/** Undefined unless the gallery was explicitly requested with APPFLOWY_PERMISSION_GALLERY=1. */
export function galleryConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GalleryConfig | undefined {
  if (env.APPFLOWY_PERMISSION_GALLERY !== '1') return undefined;
  return {
    cloud: loopbackOrigin('APPFLOWY_GALLERY_CLOUD', env.APPFLOWY_GALLERY_CLOUD),
    gotrue: loopbackOrigin('APPFLOWY_GALLERY_GOTRUE', env.APPFLOWY_GALLERY_GOTRUE),
    web: loopbackOrigin('BASE_URL', env.BASE_URL),
    adminEmail: env.APPFLOWY_GALLERY_ADMIN_EMAIL ?? 'admin@example.com',
    adminPassword: env.APPFLOWY_GALLERY_ADMIN_PASSWORD ?? 'password',
    password: env.APPFLOWY_GALLERY_PASSWORD ?? 'Demo-gallery-2026',
  };
}

/** The GoTrue password-grant response, stored by the Web app under localStorage `token`. */
export interface GalleryAuth {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string; email?: string };
  [key: string]: unknown;
}

export interface GallerySession {
  person: GalleryPerson;
  name: string;
  email: string;
  uuid: string;
  /** Exact i64 user id as a decimal string (JSON numbers would round it). */
  uid: string;
  auth: GalleryAuth;
}

export interface GalleryFixture {
  workspaceId: string;
  people: Record<GalleryPerson, GallerySession>;
  groups: Record<GalleryGroup, string>;
  spaces: Record<GallerySpace, string>;
  pages: Record<GalleryPage, string>;
  pageNames: Record<GalleryPage, string>;
}

/** Keep exact i64 identities such as `uid` and `owner_uid`. */
export function parseExactIds<T>(text: string): T {
  return JSON.parse(text.replace(/"(\w*uid\w*)"\s*:\s*(\d{16,})/g, '"$1":"$2"')) as T;
}

class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

type Body = unknown | { raw: string };

function isRaw(body: Body): body is { raw: string } {
  return typeof body === 'object' && body !== null && 'raw' in body;
}

// Plain fields (no parameter properties) so Node can run this file with type stripping alone.
class GalleryApi {
  private readonly config: GalleryConfig;

  constructor(config: GalleryConfig) {
    this.config = config;
  }

  async send<T>(origin: 'cloud' | 'gotrue', method: string, path: string, token?: string, body?: Body) {
    const base = origin === 'cloud' ? this.config.cloud : this.config.gotrue;

    if (!path.startsWith('/') || path.includes('://')) throw new Error('Gallery API path outside its origin');
    const response = await fetch(base + path, {
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(60_000),
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : isRaw(body) ? body.raw : JSON.stringify(body),
    });
    const text = await response.text();
    let value: unknown;

    try {
      value = text ? parseExactIds(text) : {};
    } catch {
      value = { raw: text.slice(0, 300) };
    }

    return { status: response.status, value: value as T };
  }

  /** A Cloud call that must succeed; returns `data`. */
  async cloud<T>(session: { auth: GalleryAuth } | string, method: string, path: string, body?: Body): Promise<T> {
    const token = typeof session === 'string' ? session : session.auth.access_token;
    const { status, value } = await this.send<{ code?: number; data?: T; message?: string }>(
      'cloud',
      method,
      path,
      token,
      body
    );

    if (status !== 200 || value.code !== 0) {
      throw new ApiError(`${method} ${path.split('?')[0]} failed: ${status} ${value.message ?? ''}`, status, value);
    }

    return value.data as T;
  }

  async passwordGrant(email: string, password: string): Promise<GalleryAuth | undefined> {
    const { status, value } = await this.send<GalleryAuth>('gotrue', 'POST', '/token?grant_type=password', undefined, {
      email,
      password,
    });

    return status === 200 && value.access_token ? value : undefined;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function eventually<T>(read: () => Promise<T | undefined>, what: string, attempts = 30): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await read();

    if (value !== undefined) return value;
    await sleep(500);
  }

  throw new Error(`Timed out waiting for ${what}`);
}

interface FolderView {
  view_id: string;
  name: string;
  children?: FolderView[];
  extra?: { is_space?: boolean } | null;
}

interface SpaceMemberRow {
  uid: string;
  user_uuid?: string;
  role: string;
  access_level_override?: number | null;
  source: string;
}

interface SpaceGroupRow {
  group_id: string;
  role: string;
  access_level_override?: number | null;
}

/**
 * Build (or restore) the Demo workspace and return its identities. The operator account switches
 * the installation to "Selected users" workspace creation; only Olivia is selected.
 */
export async function seedPermissionGallery(config: GalleryConfig): Promise<GalleryFixture> {
  const api = new GalleryApi(config);
  const admin = await api.passwordGrant(config.adminEmail, config.adminPassword);

  if (!admin) throw new Error('The gallery operator (GoTrue admin) could not sign in');

  const ensurePerson = async (person: GalleryPerson): Promise<GallerySession> => {
    const { name, email } = GALLERY_PEOPLE[person];
    let auth = await api.passwordGrant(email, config.password);

    if (!auth) {
      const created = await api.send<{ id?: string; msg?: string }>('gotrue', 'POST', '/admin/users', admin.access_token, {
        email,
        password: config.password,
        email_confirm: true,
        user_metadata: { name },
      });

      if (created.status !== 200 && created.status !== 201) {
        throw new Error(`Creating ${email} failed: ${created.status} ${created.value.msg ?? ''}`);
      }

      auth = await api.passwordGrant(email, config.password);
    }

    if (!auth) throw new Error(`${email} could not sign in`);
    // First sign-in through Cloud creates the account (and a home workspace while creation is open).
    await api.cloud(auth.access_token, 'GET', `/api/user/verify/${auth.access_token}`);
    const profile = await api.cloud<{ uid_string?: string; uid: string; uuid: string; name: string }>(
      auth.access_token,
      'GET',
      '/api/user/profile'
    );

    if (profile.name !== name) await api.cloud(auth.access_token, 'POST', '/api/user/update', { name });
    return { person, name, email, uuid: profile.uuid, uid: String(profile.uid_string ?? profile.uid), auth };
  };

  // Olivia signs up while workspace creation is open, so she gets the home workspace that becomes Demo.
  const olivia = await ensurePerson('olivia');
  const workspaces = await api.cloud<{ workspace_id: string; workspace_name: string; owner_uid: string }[]>(
    olivia,
    'GET',
    '/api/workspace'
  );
  const home =
    workspaces.find((workspace) => workspace.workspace_name === GALLERY_WORKSPACE_NAME && workspace.owner_uid === olivia.uid) ??
    workspaces.find((workspace) => workspace.owner_uid === olivia.uid);

  if (!home) throw new Error('Olivia has no workspace of her own');
  const workspaceId = home.workspace_id;

  if (home.workspace_name !== GALLERY_WORKSPACE_NAME) {
    await api.cloud(olivia, 'PATCH', '/api/workspace', { workspace_id: workspaceId, workspace_name: GALLERY_WORKSPACE_NAME });
  }

  // Operator: only selected people may create workspaces; Olivia is selected.
  await api.cloud(admin.access_token, 'PUT', '/api/admin/workspace-creation-policy', { mode: 'selected_users' });
  await api.cloud(admin.access_token, 'PUT', `/api/admin/workspace-creators/${olivia.uuid}`);

  const alex = await ensurePerson('alex');
  const sam = await ensurePerson('sam');
  const jordan = await ensurePerson('jordan');
  const people: Record<GalleryPerson, GallerySession> = { olivia, alex, sam, jordan };
  const ws = `/api/workspace/${workspaceId}`;

  // Alex and Sam join as Members (the self-hosted build allows three seats).
  const members = async () =>
    api.cloud<{ email: string; role: string; uid?: string; is_pending_invitation?: boolean }[]>(
      olivia,
      'GET',
      `${ws}/member?include_pending=true`
    );
  const joined = (list: Awaited<ReturnType<typeof members>>, person: GallerySession) =>
    list.some((member) => member.email === person.email && !member.is_pending_invitation);

  const roster = await members();

  for (const person of [alex, sam]) {
    if (!joined(roster, person)) {
      await api.cloud(olivia, 'POST', `${ws}/invite`, [{ email: person.email, role: 'Member', auto_accept: true }]);
    }
  }

  await eventually(async () => {
    const list = await members();

    return joined(list, alex) && joined(list, sam) ? true : undefined;
  }, 'Alex and Sam to join Demo');

  // Jordan has no workspace and one pending invitation to Demo. The three member seats are taken,
  // so the invitation is for a guest (guests do not use seats).
  const pendingForJordan = async () =>
    (await api.cloud<{ workspace_id: string }[]>(jordan, 'GET', '/api/workspace/invite?status=Pending')).some(
      (invitation) => invitation.workspace_id === workspaceId
    );

  if (!(await pendingForJordan())) {
    try {
      await api.cloud(olivia, 'POST', `${ws}/invite`, [{ email: jordan.email, role: 'Guest' }]);
    } catch (error) {
      // The gallery stack has no mail server: Cloud stores the invitation, then reports the email.
      if (!(error instanceof ApiError && (error.body as { code?: number }).code === MAILER_ERROR)) throw error;
    }

    await eventually(async () => ((await pendingForJordan()) ? true : undefined), "Jordan's invitation");
  }

  // Groups and their members.
  const listGroups = async () =>
    (await api.cloud<{ groups: { group_id: string; name: string }[] }>(olivia, 'GET', `${ws}/groups`)).groups;
  let groupRows = await listGroups();
  const groups = {} as Record<GalleryGroup, string>;

  for (const name of Object.keys(GROUP_MEMBERS) as GalleryGroup[]) {
    let row = groupRows.find((group) => group.name === name);

    if (!row) {
      row = await api.cloud<{ group_id: string; name: string }>(olivia, 'POST', `${ws}/groups`, { name });
      groupRows = await listGroups();
    }

    groups[name] = row.group_id;
    const current = await api.cloud<{ members: { uid: string }[] }>(olivia, 'GET', `${ws}/groups/${row.group_id}/members`);

    const wanted = GROUP_MEMBERS[name].map((person) => people[person].uid);

    for (const uid of wanted) {
      if (!current.members.some((member) => String(member.uid) === uid)) {
        await api.cloud(olivia, 'POST', `${ws}/groups/${row.group_id}/members`, { raw: `{"uid":${uid}}` });
      }
    }

    for (const member of current.members) {
      if (!wanted.includes(String(member.uid))) {
        await api.cloud(olivia, 'DELETE', `${ws}/groups/${row.group_id}/members/${member.uid}`);
      }
    }
  }

  // Access to all spaces: only Users, with Can view.
  for (const name of Object.keys(groups) as GalleryGroup[]) {
    const wanted = name === 'Users' ? VIEW : null;
    const current = await api.cloud<{ access_level: number | null }>(olivia, 'GET', `${ws}/groups/${groups[name]}/space-coverage`);

    if (current.access_level !== wanted) {
      await api.cloud(olivia, 'PUT', `${ws}/groups/${groups[name]}/space-coverage`, { access_level: wanted });
    }
  }

  // Space creation: owners plus Alex and the Super_Users group.
  await api.cloud(olivia, 'POST', `${ws}/settings`, {
    space_creation_policy: 'owners_and_selected_members',
    exact_space_creation_policy: 'owners_and_selected_members',
  });
  await api.cloud(olivia, 'PUT', `${ws}/space-creators/users/${alex.uuid}`);
  await api.cloud(olivia, 'PUT', `${ws}/space-creators/groups/${groups.Super_Users}`);

  // Spaces.
  const listSpaces = async () =>
    (await api.cloud<{ spaces: { space_id: string; name: string }[] }>(olivia, 'GET', `${ws}/spaces`)).spaces;
  let spaceRows = await listSpaces();
  const general = spaceRows.find((space) => space.name === 'General');

  if (!general) throw new Error('The template General space is missing');
  const spaces = { General: general.space_id } as Record<GallerySpace, string>;
  // The template's second space is not part of the scenario.
  const shared = spaceRows.find((space) => space.name === 'Shared');

  if (shared) await api.cloud(olivia, 'POST', `${ws}/page-view/${shared.space_id}/move-to-trash`);

  for (const [name, spec] of Object.entries(CREATED_SPACES) as [Exclude<GallerySpace, 'General'>, (typeof CREATED_SPACES)['HR']][]) {
    const creator = people[spec.creator];
    // A Private space is listed only for its members, so look it up as its creator.
    const visible = spec.creator === 'olivia' ? spaceRows : (await api.cloud<{ spaces: { space_id: string; name: string }[] }>(
      creator,
      'GET',
      `${ws}/spaces`
    )).spaces;
    let row = visible.find((space) => space.name === name);

    if (!row) {
      const created = await api.cloud<{ view_id: string }>(creator, 'POST', `${ws}/spaces`, {
        name,
        space_icon: spec.icon,
        space_icon_color: spec.color,
        permission: spec.permission,
      });

      row = { space_id: created.view_id, name };
      spaceRows = await listSpaces();
    } else {
      await api.cloud(creator, 'PATCH', `${ws}/spaces/${row.space_id}/permission`, spec.permission);
    }

    spaces[name] = row.space_id;
  }

  const ensureGroupAssignment = async (space: string, group: string, level: number) => {
    const data = await api.cloud<{ groups: SpaceGroupRow[] }>(olivia, 'GET', `${ws}/spaces/${space}/members`);
    const row = data.groups.find((candidate) => candidate.group_id === group);

    if (!row) {
      await api.cloud(olivia, 'POST', `${ws}/spaces/${space}/group/${group}`, {
        role: 'member',
        access_level: level,
        access_level_override: level,
      });
    } else if (row.access_level_override !== level) {
      await api.cloud(olivia, 'PATCH', `${ws}/spaces/${space}/group/${group}`, { access_level_override: level });
    }
  };

  const ensureDirectMember = async (space: string, person: GallerySession, override: number | null) => {
    const actor = olivia;
    const data = await api.cloud<{ members: SpaceMemberRow[] }>(actor, 'GET', `${ws}/spaces/${space}/members`);
    const row = data.members.find((member) => member.user_uuid === person.uuid && member.source !== 'workspace_default');
    const path = `${ws}/spaces/${space}/members/users/${person.uuid}`;

    if (!row) {
      await api.cloud(actor, 'POST', path, { role: 'member', access_level: override ?? VIEW });
    }

    const after = await api.cloud<{ members: SpaceMemberRow[] }>(actor, 'GET', `${ws}/spaces/${space}/members`);
    const current = after.members.find((member) => member.user_uuid === person.uuid && member.source !== 'workspace_default');

    if (current && current.role === 'member' && current.access_level_override !== override) {
      await api.cloud(actor, 'PATCH', path, { access_level_override: override });
    }
  };

  const ensureOrdinaryMember = async (space: string, person: GallerySession, override: number) => {
    const data = await api.cloud<{ members: SpaceMemberRow[] }>(olivia, 'GET', `${ws}/spaces/${space}/members`);
    const row = data.members.find((member) => member.user_uuid === person.uuid && member.source !== 'workspace_default');

    if (!row) {
      await api.cloud(olivia, 'POST', `${ws}/spaces/${space}/members/users/${person.uuid}`, { role: 'member', access_level: override });
    }

    if (!row || row.role !== 'member' || row.access_level_override !== override) {
      await api.cloud(olivia, 'PATCH', `${ws}/spaces/${space}/members/users/${person.uuid}`, {
        role: 'member',
        access_level_override: override,
      });
    }
  };

  const removeDirectMember = async (space: string, person: GallerySession) => {
    const data = await api.cloud<{ members: SpaceMemberRow[] }>(olivia, 'GET', `${ws}/spaces/${space}/members`);

    if (data.members.some((member) => member.user_uuid === person.uuid && member.role === 'member' && member.source === 'direct')) {
      await api.cloud(olivia, 'DELETE', `${ws}/spaces/${space}/members/users/${person.uuid}`);
    }
  };

  // HR: the HR group can edit, Users can view, Alex keeps the space default. Sam gets HR access only
  // through the HR group, so removing that group's access leaves Sam without access.
  await ensureGroupAssignment(spaces.HR, groups.HR, EDIT);
  await ensureGroupAssignment(spaces.HR, groups.Users, VIEW);
  await ensureDirectMember(spaces.HR, alex, null);
  await removeDirectMember(spaces.HR, sam);
  // Product (owned by Alex): the Product group can edit. Olivia keeps managing it as the workspace
  // owner, but her own row is an ordinary member with Can view, so Manage Space can explain that
  // she can also edit through the Product group.
  await ensureGroupAssignment(spaces.Product, groups.Product, EDIT);
  await ensureOrdinaryMember(spaces.Product, olivia, VIEW);

  // Pages with a line of text, directly under their spaces.
  const pages = {} as Record<GalleryPage, string>;
  const pageNames = {} as Record<GalleryPage, string>;

  for (const [key, spec] of Object.entries(PAGES) as [GalleryPage, (typeof PAGES)['handbook']][]) {
    const author = people[spec.author];
    const folder = await api.cloud<FolderView>(author, 'GET', `${ws}/folder?depth=2`);
    const spaceView = folder.children?.find((view) => view.view_id === spaces[spec.space]);
    let page = spaceView?.children?.find((view) => view.name === spec.name)?.view_id;

    if (!page) {
      const created = await api.cloud<{ view_id: string }>(author, 'POST', `${ws}/page-view`, {
        parent_view_id: spaces[spec.space],
        layout: 0,
        name: spec.name,
        page_data: {
          type: 'page',
          children: [{ type: 'paragraph', data: { delta: [{ insert: spec.text }] } }],
        },
      });

      page = created.view_id;
    }

    pages[key] = page;
    pageNames[key] = spec.name;
  }

  return { workspaceId, people, groups, spaces, pages, pageNames };
}

/** Owner API calls the capture uses to take a group's space access away and give it back. */
export async function setGroupSpaceAccess(
  config: GalleryConfig,
  fixture: GalleryFixture,
  space: GallerySpace,
  group: GalleryGroup,
  level: number | null
) {
  const api = new GalleryApi(config);
  const path = `/api/workspace/${fixture.workspaceId}/spaces/${fixture.spaces[space]}/group/${fixture.groups[group]}`;

  if (level === null) {
    await api.cloud(fixture.people.olivia, 'DELETE', path);
  } else {
    await api.cloud(fixture.people.olivia, 'POST', path, { role: 'member', access_level: level, access_level_override: level });
  }
}

/** Fresh sign-in for a browser session (tokens expire after two hours). */
export async function refreshGallerySession(config: GalleryConfig, session: GallerySession): Promise<GallerySession> {
  const auth = await new GalleryApi(config).passwordGrant(session.email, config.password);

  if (!auth) throw new Error(`${session.email} could not sign in`);
  return { ...session, auth };
}

/** Read a page's capability for a person, to tell when a permission change has reached the server. */
export async function pageCapability(config: GalleryConfig, fixture: GalleryFixture, person: GalleryPerson, page: GalleryPage) {
  const api = new GalleryApi(config);
  const { status, value } = await api.send<{ code: number; data?: { can_read: boolean; can_write: boolean } }>(
    'cloud',
    'GET',
    `/api/workspace/${fixture.workspaceId}/collab/${fixture.pages[page]}/permission?collab_type=0`,
    fixture.people[person].auth.access_token
  );

  return status === 200 && value.code === 0 ? value.data : undefined;
}
