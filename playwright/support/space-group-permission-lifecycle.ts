import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

import { BrowserContext, expect, Page, Request, Route, TestInfo } from '@playwright/test';

type PageName = 'primary' | 'direct' | 'second';
type Access = 'view' | 'edit' | 'denied';
type Actor = { uuid: string; email: string; password: string; token?: string };
type Grant = { role: string; access_level: number; access_level_override: number | null };
type Capability = { can_read: boolean; can_write: boolean };
type Revision = { epoch: string; counter: string };
type Fixture = {
  run_id: string;
  workspace: string;
  owned: { space: string; groups: Record<'primary' | 'second', string>; pages: Record<PageName, string> };
  subject_uid: string;
  builder_uuid: string;
  subject_uuid: string;
  titles: Record<PageName, string>;
  processes: Record<string, { pid: number; start_ticks: string; binary_sha256?: string }>;
  server_journal_sha256: string;
  server_result_sha256: string;
  protected: unknown;
  protected_rows: Record<string, Record<string, unknown>[]>;
  protected_rows_sha256: string;
  guard_source_sha256: string;
  requalification_sha256?: string;
  owned_document_content: unknown;
  owned_rows: unknown;
};
type ObserverWindow = Window & {
  Cypress?: unknown;
  __APP_CONFIG__?: Record<string, string>;
  __APPFLOWY_EVENT_EMITTER__?: { on: (event: string, listener: (payload: unknown) => void) => void };
  __permissionLifecycle?: { marker: string; revisions: Revision[]; hints: number;
    staleBodyAppeared?: boolean; staleObservationActive?: boolean };
  __permissionLifecycleStaleObserver?: MutationObserver;
};
type HeldResponse = {
  page: Page;
  request?: Request;
  captured: boolean;
  fulfilled: boolean;
  finished: boolean;
  cancelled: boolean;
  responseHash?: string;
  gate: Promise<void>;
  release: () => void;
};

function requireThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Bind the actual development checkout without reading credentials or generated output. */
async function webSourceManifest() {
  const paths = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--',
    'src', 'public', 'index.html', 'package.json', 'pnpm-lock.yaml', 'vite.config.ts',
    'tsconfig.json', 'tsconfig.web.json', 'tsconfig.node.json', 'tailwind.config.cjs', 'postcss.config.cjs',
  ]).toString().split('\0').filter(Boolean);
  const files: Record<string, string | null> = {};

  for (const path of [...new Set(paths)].sort()) {
    try { files[path] = createHash('sha256').update(await readFile(path)).digest('hex'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      files[path] = null;
    }
  }

  return { sha256: createHash('sha256').update(JSON.stringify(files)).digest('hex'), files };
}

/** Keep exact i64 identities; JSON numbers would silently target a different member. */
export function parseExactUid<T>(text: string): T {
  return JSON.parse(text.replace(/"uid"\s*:\s*(\d{16,})/g, '"uid":"$1"')) as T;
}

export function permitsBrowserWrite(url: URL, method: string, body: string | null, scope: {
  cloud: string; auth: string; workspace: string; pages: string[];
}): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;
  if (url.origin === scope.auth && method === 'POST' && url.pathname === '/token'
    && url.searchParams.get('grant_type') === 'refresh_token') return true;
  if (url.origin !== scope.cloud || method !== 'POST'
    || url.pathname !== `/api/workspace/${scope.workspace}/add-recent-pages`) return false;

  try {
    const ids: unknown = JSON.parse(body ?? '{}').recent_view_ids;

    return Array.isArray(ids) && ids.length === 1 && scope.pages.includes(ids[0]);
  } catch { return false; }
}

export function permitsAppSocket(url: URL, cloud: string, workspace: string, subject: { uuid: string; token?: string }): boolean {
  if (url.origin !== cloud.replace(/^http/, 'ws') || url.pathname !== `/ws/v2/${workspace}/`
    || url.username || url.password || url.hash || url.searchParams.getAll('token').length !== 1
    || url.searchParams.get('token') !== subject.token) return false;

  try {
    const claims = JSON.parse(Buffer.from((subject.token ?? '').split('.')[1], 'base64url').toString());

    return claims.sub === subject.uuid && Number.isFinite(claims.exp) && claims.exp * 1000 > Date.now();
  } catch { return false; }
}

function localOrigin(value: string): string {
  const url = new URL(value);

  requireThat(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'Explicit local origin required');
  return url.origin;
}

async function privateJson(path: string): Promise<unknown> {
  requireThat(((await stat(path)).mode & 0o077) === 0, 'Private fixture file permissions required');
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

async function atomicJson(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx', 0o600);

  try { await file.writeFile(JSON.stringify(value, null, 2)); await file.sync(); }
  finally { await file.close(); }

  await rename(temporary, path);
}

/** Owns only two mutations: primary group grant and the subject's primary membership. */
export class SpaceGroupPermissionLifecycle {
  readonly pages = new Map<string, { page: Page; name: PageName; marker: string; url: string }>();
  private fixture!: Fixture;
  private runtime!: Record<string, string>;
  private builder!: Actor;
  private builderAuth: unknown;
  private subject!: Actor;
  private originalGrant!: Grant;
  private originalMembership = false;
  private cloud = '';
  private auth = '';
  private web = '';
  private root: string;
  private journalPath: string;
  private resultPath: string;
  private lockPath: string;
  private lock?: Awaited<ReturnType<typeof open>>;
  private armed = false;
  private hold?: HeldResponse;
  private sockets = new Set<WebSocket>();
  private state: { run: string; checks: unknown[]; mutations: unknown[]; requests: unknown[]; failures: string[]; [key: string]: unknown };

  constructor(private context: BrowserContext, private info: TestInfo) {
    this.root = resolve(process.env.APPFLOWY_GROUP_PERMISSION_RUNTIME_DIR ?? '.');
    this.lockPath = resolve(this.root, 'web-group-permission-lifecycle.lock');
    const run = randomUUID();

    this.journalPath = resolve(this.root, `web-group-permission-${run}-private.json`);
    this.resultPath = resolve(this.root, `web-group-permission-${run}-result.json`);
    this.state = { run, checks: [], mutations: [], requests: [], failures: [], status: 'preflight' };
  }

  private guardSnapshot(action: 'preflight' | 'snapshot'): Fixture {
    const cloudProof = process.env.APPFLOWY_GROUP_PERMISSION_CLOUD_PROOF;
    const workerProof = process.env.APPFLOWY_GROUP_PERMISSION_WORKER_PROOF;

    requireThat(cloudProof && workerProof, 'Explicit current Cloud and Worker qualification proofs required');
    try {
      return JSON.parse(execFileSync(process.env.APPFLOWY_TEST_PYTHON ?? 'python3', [
        resolve('playwright/support/space-group-permission-guard.py'),
      ], { input: JSON.stringify({ action, runtime_dir: this.root,
        server_repo: resolve(process.env.APPFLOWY_GROUP_PERMISSION_SERVER_REPO ?? '../AppFlowy-Cloud-Premium2'),
        cloud_proof: cloudProof, worker_proof: workerProof,
        requalification: process.env.APPFLOWY_GROUP_PERMISSION_REQUALIFICATION,
        requalification_sha256: process.env.APPFLOWY_GROUP_PERMISSION_REQUALIFICATION_SHA256 }), timeout: 120000,
        stdio: ['pipe', 'pipe', 'pipe'] }).toString()) as Fixture;
    } catch { throw new Error('Read-only server fixture qualification rejected; private evidence retained'); }
  }

  private persist() { return atomicJson(this.journalPath, this.state); }

  private async guard() {
    for (const record of Object.values(this.fixture.processes)) {
      const process = await readFile(`/proc/${record.pid}/stat`, 'utf8');

      requireThat(process.slice(process.lastIndexOf(') ') + 2).trim().split(/\s+/)[19] === record.start_ticks,
        'Qualified server process changed');
    }
  }

  private grantPath() {
    return `/api/workspace/${this.fixture.workspace}/spaces/${this.fixture.owned.space}/group/${this.fixture.owned.groups.primary}`;
  }

  private membersPath() {
    return `/api/workspace/${this.fixture.workspace}/groups/${this.fixture.owned.groups.primary}/members`;
  }

  private capabilityPath(name: PageName) {
    return `/api/workspace/${this.fixture.workspace}/collab/${this.fixture.owned.pages[name]}/permission?collab_type=0`;
  }

  private async api<T>(path: string, actor = this.builder, method = 'GET', body?: string): Promise<T> {
    await this.guard();
    requireThat(path.startsWith('/api/') && !path.includes('://'), 'API path outside fixture origin');
    const response = await fetch(this.cloud + path, { method, redirect: 'manual', signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${actor.token}`, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }, body });
    const value = parseExactUid<{ code: number; data: T }>(await response.text());

    requireThat(response.status === 200 && value.code === 0, `Owned API failed: ${method} ${path.split('?')[0]}`);
    return value.data;
  }

  private async currentGrant(): Promise<Grant | undefined> {
    const data = await this.api<{ groups: (Grant & { group_id: string })[] }>(this.grantPath().slice(0, this.grantPath().lastIndexOf('/')));

    return data.groups.find(group => group.group_id === this.fixture.owned.groups.primary);
  }

  private async memberPresent(): Promise<boolean> {
    const data = await this.api<{ members: { uid: string | number }[] }>(this.membersPath());

    return data.members.some(member => String(member.uid) === this.fixture.subject_uid);
  }

  async prepare() {
    requireThat(((await stat(this.root)).mode & 0o077) === 0, 'Private runtime directory required');
    this.lock = await open(this.lockPath, 'wx', 0o600);
    this.fixture = this.guardSnapshot('preflight');
    this.runtime = await privateJson(resolve(this.root, 'runtime.json')) as Record<string, string>;
    const actors = await privateJson(resolve(this.root, 'actors.json')) as Record<'member' | 'owner', Actor>;

    this.builder = { ...actors.member };
    this.subject = { ...actors.owner };
    requireThat(this.builder.uuid === this.fixture.builder_uuid && this.subject.uuid === this.fixture.subject_uuid,
      'Actor identity differs from server fixture');
    requireThat(/^\d+$/.test(this.fixture.subject_uid), 'Exact subject UID required');
    this.cloud = localOrigin(this.runtime.APPFLOWY_BASE_URL);
    this.auth = localOrigin(this.runtime.APPFLOWY_GOTRUE_BASE_URL);
    this.web = localOrigin(this.runtime.APPFLOWY_WEB_URL);
    requireThat(process.env.BASE_URL === this.web, 'BASE_URL must match qualified runtime');
    this.state.before = this.fixture;
    this.state.sourceHashes = Object.fromEntries(await Promise.all([
      'playwright.permissions.config.ts', 'playwright/support/space-group-permission-lifecycle.ts',
      'playwright/support/space-group-permission-guard.py', 'playwright/e2e/app/space-group-permission-lifecycle.spec.ts',
    ].map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])));
    this.state.webSource = await webSourceManifest();
    await this.persist();
    let subjectAuth: unknown;

    for (const actor of [this.builder, this.subject]) {
      const response = await fetch(`${this.auth}/token?grant_type=password`, { method: 'POST', redirect: 'manual',
        signal: AbortSignal.timeout(30000), headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: actor.email, password: actor.password }) });
      const result = await response.json() as { user: { id: string }; access_token: string };

      requireThat(response.status === 200 && result.user.id === actor.uuid && result.access_token,
        'Fresh existing-actor authentication failed');
      actor.token = result.access_token;
      if (actor === this.subject) subjectAuth = result;
      else this.builderAuth = result;
    }

    const grant = await this.currentGrant();

    requireThat(grant?.role === 'member' && grant.access_level_override === 10, 'Restored explicit View grant required');
    this.originalGrant = { role: grant.role, access_level: grant.access_level, access_level_override: grant.access_level_override };
    this.originalMembership = await this.memberPresent();
    requireThat(this.originalMembership, 'Restored primary group membership required');
    this.state.original = { grant: this.originalGrant, membership: this.originalMembership };
    this.armed = true;
    await this.persist();
    await this.installTransport();
    await this.configureSession(this.context, subjectAuth);
    this.state.browserTransport = { http: 'transparent local relay', websocket: 'transparent same-workspace relay' };
    this.state.status = 'running';
    await this.persist();
  }

  private async configureSession(context: BrowserContext, auth: unknown) {
    await context.addInitScript(({ auth, cloud, gotrue }) => {
      const target = window as ObserverWindow;

      target.Cypress = { passivePermissionObserver: true };
      target.__APP_CONFIG__ = { APPFLOWY_BASE_URL: cloud, APPFLOWY_GOTRUE_BASE_URL: gotrue,
        APPFLOWY_WS_BASE_URL: cloud.replace(/^http/, 'ws') + '/ws/v2' };
      localStorage.setItem('token', JSON.stringify(auth));
    }, { auth, cloud: this.cloud, gotrue: this.auth });
  }

  private async installTransport(context = this.context, actor = this.subject) {
    await context.route('**/*', route => this.relay(route));
    // Transparent local transport: no generated messages, altered frames, or permission hints.
    await context.routeWebSocket('**', route => {
      const url = new URL(route.url());

      if (!permitsAppSocket(url, this.cloud, this.fixture.workspace, actor)) {
        if (url.pathname.startsWith('/ws/v2/')) this.state.failures.push('Unexpected application WebSocket scope');
        void route.close();
        return;
      }

      const backend = new WebSocket(route.url());
      const pending: (string | Buffer)[] = [];

      this.sockets.add(backend);
      backend.binaryType = 'arraybuffer';
      route.onMessage(data => {
        if (backend.readyState === WebSocket.OPEN) backend.send(data);
        else if (pending.length < 100) pending.push(data);
        else { this.state.failures.push('WebSocket queue exceeded bound'); void route.close(); }
      });
      backend.onopen = () => { for (const message of pending.splice(0)) backend.send(message); };

      backend.onmessage = ({ data }) => route.send(typeof data === 'string' ? data : Buffer.from(data as ArrayBuffer));
      backend.onerror = () => { this.state.failures.push('Local WebSocket relay failed'); };

      backend.onclose = () => route.close();
      route.onClose(() => { this.sockets.delete(backend); backend.close(); });
    });
  }

  private async relay(route: Route) {
    const request = route.request();
    const url = new URL(request.url());
    const preference = url.origin === this.cloud && ((request.method() === 'PUT'
      && url.pathname === `/api/workspace/${this.fixture.workspace}/open`)
      || (request.method() === 'POST' && url.pathname === '/api/user/update'));
    const excluded = ![this.web, this.cloud, this.auth].includes(url.origin) || preference
      || (url.origin === this.cloud && (/\/summary$/.test(url.pathname) || /^\/api\/(ai|chat)\//.test(url.pathname)));

    if (excluded) { await route.abort(); return; }

    if (!permitsBrowserWrite(url, request.method(), request.postData(), { cloud: this.cloud, auth: this.auth,
      workspace: this.fixture.workspace, pages: Object.values(this.fixture.owned.pages) })) {
      this.state.failures.push(`Unexpected browser write: ${request.method()} ${url.pathname}`);
      await route.abort();
      return;
    }

    let held: HeldResponse | undefined;

    try {
      await this.guard();
      const headers = request.headers();

      if (this.hold && !this.hold.request && request.frame().page() === this.hold.page
        && url.origin === this.cloud && url.pathname + url.search === this.capabilityPath('primary')) {
        held = this.hold;
        held.request = request;
        delete headers['if-none-match'];
        delete headers['if-modified-since'];
        headers['cache-control'] = 'no-cache';
      }

      this.state.requests.push({ method: request.method(), path: url.pathname });
      const response = await fetch(url, { method: request.method(), headers, redirect: 'manual',
        signal: AbortSignal.timeout(45000), body: ['GET', 'HEAD'].includes(request.method()) ? undefined : request.postDataBuffer() });
      const body = Buffer.from(await response.arrayBuffer());

      requireThat(response.status < 300 || response.status === 304 || response.status >= 400, 'Browser redirect refused');
      requireThat(body.length < 32 * 1024 * 1024, 'Browser response bound exceeded');
      if (held) {
        const value = parseExactUid<{ code: number; data: Capability }>(body.toString());

        requireThat(response.status === 200 && value.code === 0 && value.data.can_read && value.data.can_write,
          'Held response must be a fresh canonical Edit allowance');
        held.captured = true;
        held.responseHash = createHash('sha256').update(body).digest('hex');
        await held.gate;
      }

      const responseHeaders = Object.fromEntries(response.headers);

      for (const name of ['content-encoding', 'content-length', 'transfer-encoding']) delete responseHeaders[name];
      await route.fulfill({ status: response.status, headers: responseHeaders, body });
      if (held) held.fulfilled = true;
    } catch {
      if (held) held.cancelled = true;
      else if (request.failure()?.errorText !== 'net::ERR_ABORTED') this.state.failures.push(`Browser relay failed: ${url.pathname}`);
      await route.abort().catch(() => undefined);
    }
  }

  async open(name: PageName, label: string = name) {
    const page = await this.context.newPage();
    const url = `${this.web}/app/${this.fixture.workspace}/${this.fixture.owned.pages[name]}`;
    const marker = randomUUID();

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean((window as ObserverWindow).__APPFLOWY_EVENT_EMITTER__));
    await page.evaluate(({ marker, workspace }) => {
      const target = window as ObserverWindow;
      const observed = { marker, revisions: [] as Revision[], hints: 0 };

      target.__permissionLifecycle = observed;
      target.__APPFLOWY_EVENT_EMITTER__?.on('workspace-permissions-changed', payload => {
        const event = payload as { workspaceId: string; revision: Revision };

        if (event.workspaceId === workspace && event.revision) {
          observed.revisions.push({ epoch: String(event.revision.epoch), counter: String(event.revision.counter) });
        }
      });
      target.__APPFLOWY_EVENT_EMITTER__?.on('permission-changed', () => { observed.hints++; });
    }, { marker, workspace: this.fixture.workspace });
    this.pages.set(label, { page, name, marker, url });
    return page;
  }

  async revisionCounts() {
    return Promise.all([...this.pages.values()].map(async ({ page }) =>
      page.evaluate(() => (window as ObserverWindow).__permissionLifecycle?.revisions.length ?? 0)));
  }

  async expectRevisionAfter(previous: number[]) {
    this.state.waitingForRevision = previous;
    await this.persist();
    for (const [index, { page }] of [...this.pages.values()].entries()) {
      await expect.poll(() => page.evaluate(() => (window as ObserverWindow).__permissionLifecycle?.revisions.length ?? 0),
        { message: 'A real decoded workspace revision must reach every open tab' }).toBeGreaterThan(previous[index]);
      const revisions = await page.evaluate(() => (window as ObserverWindow).__permissionLifecycle?.revisions ?? []);
      const newest = revisions[revisions.length - 1];
      const prior = revisions[previous[index] - 1];

      expect(newest.epoch).toMatch(/^\d+$/);
      expect(newest.counter).toMatch(/^\d+$/);
      if (prior) {
        expect(BigInt(newest.epoch) > BigInt(prior.epoch)
          || (newest.epoch === prior.epoch && BigInt(newest.counter) > BigInt(prior.counter)),
        'Observed permission revision must advance').toBe(true);
      }
    }
  }

  private async mutate(method: string, path: string, body?: string) {
    requireThat((path === this.grantPath() && ['POST', 'DELETE'].includes(method))
      || (path === this.membersPath() && method === 'POST' && body === `{"uid":${this.fixture.subject_uid}}`)
      || (path === `${this.membersPath()}/${this.fixture.subject_uid}` && method === 'DELETE'), 'Mutation escaped owned fixture');
    const entry = { method, path, body, status: 'attempted' };

    this.state.mutations.push(entry);
    await this.persist();
    await this.api(path, this.builder, method, body);
    entry.status = 'acknowledged';
    await this.persist();
  }

  async grant(level: 10 | 30 | null) {
    await this.mutate(level === null ? 'DELETE' : 'POST', this.grantPath(), level === null ? undefined
      : JSON.stringify({ role: 'member', access_level: level, access_level_override: level }));
  }

  async membership(present: boolean) {
    await this.mutate(present ? 'POST' : 'DELETE', this.membersPath() + (present ? '' : '/' + this.fixture.subject_uid),
      present ? `{"uid":${this.fixture.subject_uid}}` : undefined);
  }

  async expectAccess(primary: Access, phase: string) {
    for (const [label, { page, name, marker, url }] of this.pages) {
      const access = name === 'primary' ? primary : 'edit';
      const expected = { can_read: access !== 'denied', can_write: access === 'edit' };

      this.state.activeCheck = { phase, label, access };
      await this.persist();

      await expect.poll(async () => {
        const actual = await this.api<Capability>(this.capabilityPath(name), this.subject);

        return { can_read: actual.can_read, can_write: actual.can_write };
      }).toEqual(expected);
      const editor = page.locator('[data-slate-editor="true"]');
      const title = page.getByTestId('page-title-input');

      if (access === 'denied') {
        await expect(page.getByText('No access to this page', { exact: true })).toBeVisible();
        await expect(editor).toHaveCount(0);
        await expect(title).toHaveCount(0);
        // Check the protected text in the content area, not sidebar metadata.
        await expect(page.locator('[data-slate-node="text"]')).toHaveCount(0);
      } else {
        await expect(editor).toHaveCount(1);
        await expect(editor).toBeVisible();
        await expect(editor).toContainText(this.fixture.titles[name]);
        await expect(editor).toHaveAttribute('contenteditable', String(access === 'edit'));
        if (access === 'edit') { await expect(title).toBeVisible(); await expect(title).toBeEnabled(); }
        else await expect(title).toHaveCount(0);
      }

      const outline = await this.expectOutline(page);

      expect(page.url(), `${label} route retained`).toBe(url);
      expect(await page.evaluate(() => (window as ObserverWindow).__permissionLifecycle?.marker), `${label} was not reloaded`).toBe(marker);

      await page.screenshot({ path: this.info.outputPath(`${phase}-${label}.png`) });
      if (phase === 'explicit-edit' && label === 'primary') {
        // Focus alone does not dispatch input/keydown or change document content.
        await title.focus();
        await expect(title).toBeEditable();
        await expect(title).toBeFocused();
        await page.screenshot({ path: this.info.outputPath('explicit-edit-primary-title-focused.png'), caret: 'initial' });
        this.state.checks.push({ phase: 'edit-title-focus', label, editable: true, focused: true, content_input: false });
      }

      const observed = await page.evaluate(() => (window as ObserverWindow).__permissionLifecycle);

      if (phase === 'final-recovered-view' && label === 'primary') {
        expect(observed?.staleObservationActive, 'Stale-response observation ends before legitimate regrant').toBe(false);
        expect(observed?.staleBodyAppeared).toBe(false);
      }

      this.state.checks.push({ phase, label, access, observed, outline });
    }

    expect(this.state.failures, 'Transparent transport must remain qualified').toEqual([]);
    await this.persist();
  }

  private async expectOutline(page: Page) {
    type View = { view_id: string; children?: View[] };
    // The UI combines two canonical trees. Narrow direct/page-group shares can
    // appear in Shared with me after the containing space grant is removed.
    const [root, shared] = await Promise.all([
      this.api<View>(`/api/workspace/${this.fixture.workspace}/view/${this.fixture.workspace}?depth=6`, this.subject),
      this.api<View>(`/api/sharing/workspace/${this.fixture.workspace}/view/${this.fixture.workspace}?depth=50`, this.subject),
    ]);
    const collect = (view: View, ids = new Set<string>()): Set<string> => {
      ids.add(view.view_id);
      for (const child of view.children ?? []) collect(child, ids);
      return ids;
    };

    const rootIds = collect(root);
    const sharedIds = collect(shared);
    const ids = new Set([...rootIds, ...sharedIds]);
    const space = page.getByTestId(`space-${this.fixture.owned.space}`);

    if (ids.has(this.fixture.owned.space)) {
      await expect(space).toBeVisible();
      if (await space.getAttribute('data-expanded') === 'false') await space.click();
    }

    for (const id of Object.values(this.fixture.owned.pages)) {
      const item = page.locator('.folder-views').getByTestId(`page-${id}`);

      if (ids.has(id)) await expect(item).toBeVisible();
      else await expect(item).toHaveCount(0);
    }

    return { root: Object.values(this.fixture.owned.pages).filter(id => rootIds.has(id)),
      shared: Object.values(this.fixture.owned.pages).filter(id => sharedIds.has(id)) };
  }

  holdNextPrimaryAllowance(page: Page) {
    requireThat(!this.hold, 'Only one capability response may be held');
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const held: HeldResponse = { page, captured: false, fulfilled: false, finished: false, cancelled: false, gate, release };

    this.hold = held;
    page.on('requestfinished', request => { if (held.request === request) held.finished = true; });
    page.on('requestfailed', request => { if (held.request === request) held.cancelled = true; });
  }

  async expectHeld() {
    await expect.poll(() => this.hold?.captured, { message: 'Real fresh Edit response captured before delivery' }).toBe(true);
    requireThat(!this.hold?.cancelled, 'Held browser request was cancelled before revoke');
  }

  async releaseStaleAllowance(page: Page) {
    const held = this.hold;

    requireThat(held?.captured, 'No real allowed response is held');
    await page.evaluate(() => {
      const target = window as ObserverWindow;
      const observed = target.__permissionLifecycle;

      if (!observed) throw new Error('Permission observer missing');
      observed.staleBodyAppeared = false;
      observed.staleObservationActive = true;
      const inspect = () => {
        if (document.querySelector('[data-slate-editor="true"], [data-testid="page-title-input"]')) observed.staleBodyAppeared = true;
      };

      inspect();
      target.__permissionLifecycleStaleObserver = new MutationObserver(inspect);
      target.__permissionLifecycleStaleObserver.observe(document.body, { subtree: true, childList: true, attributes: true });
    });
    try {
      held.release();
      await expect.poll(() => ({ fulfilled: held.fulfilled, finished: held.finished, cancelled: held.cancelled }),
        { message: 'Stale allowance must finish delivery; cancellation is not stale-response consumption evidence' })
        .toEqual({ fulfilled: true, finished: true, cancelled: false });
      // Two animation frames allow the completed request's React effects to render.
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await this.expectAccess('denied', 'stale-allow-delivered');
      expect(await page.evaluate(() => (window as ObserverWindow).__permissionLifecycle?.staleBodyAppeared)).toBe(false);
    } finally {
      // The next phase intentionally grants access. Stop this interval's observer
      // on success or failure so later legitimate content is never called stale.
      await page.evaluate(() => {
        const target = window as ObserverWindow;

        target.__permissionLifecycleStaleObserver?.disconnect();
        delete target.__permissionLifecycleStaleObserver;
        if (target.__permissionLifecycle) target.__permissionLifecycle.staleObservationActive = false;
      }).catch(() => undefined);
    }

    this.state.checks.push({ phase: 'stale-allow-response', object: this.fixture.owned.pages.primary,
      response_sha256: held.responseHash, fulfilled: held.fulfilled, request_finished: held.finished, cancelled: held.cancelled });
    await this.persist();
  }

  async captureOwnerAssignment() {
    const browser = this.context.browser();

    requireThat(browser && this.builderAuth, 'Existing owner session required for configuration screenshot');
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    try {
      await this.installTransport(context, this.builder);
      await this.configureSession(context, this.builderAuth);
      await page.goto(`${this.web}/app/${this.fixture.workspace}/${this.fixture.owned.pages.primary}`, { waitUntil: 'domcontentloaded' });
      const space = page.getByTestId('space-item').filter({ has: page.getByTestId(`space-${this.fixture.owned.space}`) });

      await expect(space).toBeVisible();
      await space.hover();
      await space.getByTestId('inline-more-actions').click({ force: true });
      await page.getByTestId('space-action-manage').click();
      const modal = page.getByTestId('manage-space-modal');

      await expect(modal).toBeVisible();
      await modal.getByRole('tab', { name: 'Members', exact: true }).click();
      const group = modal.getByTestId(`space-group-row-${this.fixture.owned.groups.primary}`);

      await expect(group).toBeVisible();
      await expect(group.getByTestId('space-member-access-control').getByRole('combobox')).toHaveValue('10');
      await expect(group.getByRole('button', { name: 'Space member', exact: true })).toBeVisible();
      await page.screenshot({ path: this.info.outputPath('owner-group-view-assignment.png') });
      this.state.checks.push({ phase: 'owner-assignment-read-only', group: this.fixture.owned.groups.primary, role: 'member', override: 10 });
      await this.persist();
      await page.keyboard.press('Escape');
      await expect(modal).not.toBeVisible();
      await this.captureWorkspaceSettings(page);
    } catch (error) {
      await page.screenshot({ path: this.info.outputPath('owner-assignment-failure.png') }).catch(() => undefined);
      throw error;
    } finally {
      await context.close();
    }
  }

  private async captureWorkspaceSettings(page: Page) {
    const path = `/api/workspace/${this.fixture.workspace}`;
    const capability = await this.api<{ policy: string; selected_creators_supported: boolean;
      group_selection_supported: boolean; can_grant_creator_groups: boolean }>(`${path}/space-creation-capabilities`);
    const directory = await this.api<{ groups: { group_id: string; name: string;
      space_coverage_access_level: 10 | 30 | null }[] }>(`${path}/groups`);
    const group = directory.groups.find(item => item.group_id === this.fixture.owned.groups.primary);

    requireThat(group, 'Run-owned group must remain in the canonical directory');
    await page.getByTestId('workspace-dropdown-trigger').click();
    await page.getByTestId('settings-button').click();
    await page.getByTestId('settings-menu-permissions').click();
    const panel = page.getByTestId('workspace-permissions-panel');

    await expect(panel).toBeVisible();
    await expect(panel.locator(`input[name="space-creation-policy"][value="${capability.policy}"]`)).toBeChecked();
    if (capability.selected_creators_supported) await expect(panel.getByLabel('Select Members', { exact: true })).toBeEnabled();
    if (capability.group_selection_supported) {
      await expect(panel.getByRole('region', { name: 'Groups', exact: true })).toBeVisible();
      if (capability.can_grant_creator_groups) await expect(panel.getByLabel('Select Groups', { exact: true })).toBeEnabled();
    }

    await panel.screenshot({ path: this.info.outputPath('owner-space-creator-settings.png') });
    if (capability.group_selection_supported) {
      const groupSelections = panel.getByRole('region', { name: 'Groups', exact: true });

      await groupSelections.scrollIntoViewIfNeeded();
      await groupSelections.screenshot({ path: this.info.outputPath('owner-space-creator-group-settings.png') });
    }

    // Filtering changes local presentation only. Never select a level or Save:
    // this image records the existing configuration, not a coverage mutation.
    await panel.getByRole('textbox', { name: 'Search group access', exact: true }).fill(group.name);
    const row = panel.getByTestId(`group-space-access-${group.group_id}`);
    const coverage = row.locator('..');

    await expect(row.locator('select')).toHaveValue(group.space_coverage_access_level === null
      ? 'off' : String(group.space_coverage_access_level));
    await expect(row.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await expect(coverage).toContainText('current and future Public and Custom spaces');
    await expect(coverage).toContainText('Private spaces are excluded, and page restrictions still apply.');
    await coverage.screenshot({ path: this.info.outputPath('owner-group-coverage-settings.png') });
    this.state.checks.push({ phase: 'owner-workspace-settings-read-only', creator_policy: capability.policy,
      selected_creators_supported: capability.selected_creators_supported,
      group_selection_supported: capability.group_selection_supported, group: group.group_id,
      coverage_access_level: group.space_coverage_access_level });
    await this.persist();
  }

  async captureFailure(error: unknown) {
    this.state.primaryFailure = error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack } : { name: 'UnknownFailure' };
    const pages: unknown[] = [];

    for (const [label, { page }] of this.pages) {
      if (page.isClosed()) continue;
      try {
        const facts = await page.evaluate(() => ({
          url: window.location.href,
          observer: (window as ObserverWindow).__permissionLifecycle,
          editors: [...document.querySelectorAll('[data-slate-editor="true"]')].map(element => ({
            editable: element.getAttribute('contenteditable'), text: element.textContent,
          })),
          titles: document.querySelectorAll('[data-testid="page-title-input"]').length,
          denied: document.body.textContent?.includes('No access to this page'),
        }));

        pages.push({ label, ...facts });
        await page.screenshot({ path: this.info.outputPath(`failure-${label}.png`) });
      } catch { pages.push({ label, capture: 'unavailable' }); }
    }

    this.state.failurePages = pages;
    if (this.lock) await this.persist();
  }

  async finish(passed: boolean) {
    if (!this.lock) return;
    this.hold?.release();
    for (const { page } of this.pages.values()) await page.close().catch(() => undefined);
    for (const socket of this.sockets) socket.close();
    const failures: string[] = [];

    if (this.armed) {
      const repairs = [
        async () => {
          await this.mutate('POST', this.grantPath(), JSON.stringify(this.originalGrant));
          const restored = await this.currentGrant();

          expect(restored && { role: restored.role, access_level: restored.access_level,
            access_level_override: restored.access_level_override }).toEqual(this.originalGrant);
        },
        async () => {
          if (await this.memberPresent() !== this.originalMembership) await this.membership(this.originalMembership);
          expect(await this.memberPresent()).toBe(this.originalMembership);
        },
        async () => {
          const after = this.guardSnapshot('snapshot');

          this.state.after = after;
          expect(after.processes).toEqual(this.fixture.processes);
          expect(after.protected_rows_sha256,
            'All original rows remain exact except the three proven Search observation timestamps and their row updated_at')
            .toBe(this.fixture.protected_rows_sha256);
          expect(after.guard_source_sha256).toBe(this.fixture.guard_source_sha256);
          expect(after.requalification_sha256).toBe(this.fixture.requalification_sha256);
          const content = (snapshot: Fixture) => {
            const protectedContent = snapshot.protected as { content_count: number; content_sha256: string };

            return { count: protectedContent.content_count, sha256: protectedContent.content_sha256 };
          };

          expect(content(after), 'Original collab source bytes preserved').toEqual(content(this.fixture));
          this.state.telemetryObservation = {
            key: 'search_admission_health', columns: ['updated_at', 'value.last_checked_at', 'value.last_healthy_at', 'value.next_check_at'],
            source: 'libs/database/src/search_health.rs: claim_search_health_probe / finish_search_health_probe',
            before_sha256: createHash('sha256').update(JSON.stringify(this.fixture.protected_rows.af_system_config.find(row => row.key === 'search_admission_health'))).digest('hex'),
            after_sha256: createHash('sha256').update(JSON.stringify(after.protected_rows.af_system_config.find(row => row.key === 'search_admission_health'))).digest('hex'),
          };
          expect(after.owned_document_content, 'Owned document source bytes preserved').toEqual(this.fixture.owned_document_content);
          expect(after.server_journal_sha256).toBe(this.fixture.server_journal_sha256);
          expect(after.server_result_sha256).toBe(this.fixture.server_result_sha256);
          expect(await webSourceManifest(), 'Qualified Web source remains unchanged').toEqual(this.state.webSource);
        },
      ];

      for (const [index, repair] of repairs.entries()) {
        try { await repair(); } catch (error) {
          failures.push(['primary-grant', 'primary-membership', 'preservation'][index]);
          this.state.restorationError = error instanceof Error ? { name: error.name, message: error.message } : { name: 'UnknownFailure' };
        }
      }
    }

    this.state.restoration = { status: failures.length ? 'failed' : this.armed ? 'passed' : 'not-armed', failures };
    this.state.status = passed && !failures.length && !this.state.failures.length ? 'passed' : 'failed';
    await this.persist();
    await atomicJson(this.resultPath, { status: this.state.status, run: this.state.run, fixture_run: this.fixture?.run_id,
      checks: this.state.checks, telemetryObservation: this.state.telemetryObservation, restoration: this.state.restoration, failures: this.state.failures,
      limitations: ['Documents only; no database/grid/row claim', 'UI control state, not a CRDT edit acceptance test',
        'Local transparent HTTP/WebSocket relay; server messages are never fabricated', 'Fresh API sign-in; not login UI qualification'] });
    if (this.lock) { await this.lock.close(); await unlink(this.lockPath); }

    expect(failures, 'All restoration/preservation checks must pass; inspect private journal on failure').toEqual([]);
  }
}
