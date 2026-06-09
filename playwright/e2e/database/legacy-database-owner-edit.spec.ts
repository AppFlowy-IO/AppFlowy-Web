import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

import { signInWithPasswordViaUi } from '../../support/auth-flow-helpers';
import { waitForGridReady } from '../../support/database-ui-helpers';
import { getCurrentDatabaseInfo } from '../../support/relation-test-helpers';
import { DatabaseGridSelectors } from '../../support/selectors';
import { setupPageErrorHandling, TestConfig } from '../../support/test-config';

const LEGACY_DB_OWNER_EMAIL = process.env.LEGACY_DB_OWNER_EMAIL || 'legacy_db_user@appflowy.io';
const LEGACY_DB_OWNER_PASSWORD = process.env.LEGACY_DB_OWNER_PASSWORD || 'AppFlowy!@123';
const LEGACY_DB_WORKSPACE_ID = process.env.LEGACY_DB_WORKSPACE_ID;
const LEGACY_DB_VIEW_ID = process.env.LEGACY_DB_VIEW_ID;

const GRID_LAYOUT = 1;

type Workspace = {
  workspace_id: string;
  role?: string;
};

type FolderView = {
  view_id: string;
  name: string;
  layout?: number | string | null;
  extra?: {
    database_id?: string;
    is_database_container?: boolean;
  } | null;
  children?: FolderView[];
};

type ApiResponse<T> = {
  code?: number;
  message?: string;
  data?: T;
};

type LegacyDatabaseView = {
  workspaceId: string;
  viewId: string;
  name: string;
};

test.describe('Legacy database owner permissions', () => {
  test.beforeEach(async ({ page }) => {
    setupPageErrorHandling(page);
    await page.setViewportSize({ width: 1440, height: 960 });
  });

  test('owner can edit a legacy grid database without a database container', async ({ page, request }) => {
    const legacyDatabase = await resolveLegacyGridDatabase(request);

    test.info().annotations.push({
      type: 'legacy database',
      description: `${legacyDatabase.name} (${legacyDatabase.workspaceId}/${legacyDatabase.viewId})`,
    });

    await signInWithPasswordViaUi(page, LEGACY_DB_OWNER_EMAIL, LEGACY_DB_OWNER_PASSWORD);
    await page.goto(`/app/${legacyDatabase.workspaceId}/${legacyDatabase.viewId}`, {
      waitUntil: 'domcontentloaded',
    });

    await waitForGridReady(page);
    await ensureAtLeastOneRow(page);

    const { primaryFieldId } = await getCurrentDatabaseInfo(page);
    const probeText = `legacy-owner-edit-${Date.now()}`;
    const firstPrimaryCell = DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId).first();
    const originalText = await normalizedText(firstPrimaryCell);

    try {
      await replaceCellText(page, firstPrimaryCell, probeText);
      await expect(firstPrimaryCell).toContainText(probeText, { timeout: 15000 });

      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForGridReady(page);
      await expect(DatabaseGridSelectors.grid(page)).toContainText(probeText, { timeout: 30000 });
    } finally {
      await restoreProbeCell(page, primaryFieldId, probeText, originalText);
    }
  });
});

async function resolveLegacyGridDatabase(request: APIRequestContext): Promise<LegacyDatabaseView> {
  if (LEGACY_DB_WORKSPACE_ID && LEGACY_DB_VIEW_ID) {
    return {
      workspaceId: LEGACY_DB_WORKSPACE_ID,
      viewId: LEGACY_DB_VIEW_ID,
      name: 'env override legacy database',
    };
  }

  const token = await getPasswordAuthToken(request);
  const workspaces = await getApi<Workspace[]>(request, token, '/api/workspace?include_member_count=true');
  const ownerWorkspaces = [
    ...workspaces.filter((workspace) => workspace.role === 'Owner'),
    ...workspaces.filter((workspace) => workspace.role !== 'Owner'),
  ];

  for (const workspace of ownerWorkspaces) {
    const workspaceId = workspace.workspace_id;
    const root = await getApi<FolderView>(request, token, `/api/workspace/${workspaceId}/view/${workspaceId}?depth=50`);
    const legacyView = findLegacyGridDatabase(root);

    if (legacyView) {
      return {
        workspaceId,
        viewId: legacyView.view_id,
        name: legacyView.name,
      };
    }
  }

  throw new Error(`No legacy grid database was found for ${LEGACY_DB_OWNER_EMAIL}`);
}

function findLegacyGridDatabase(root: FolderView): FolderView | null {
  const visit = (view: FolderView, underDatabaseContainer: boolean): FolderView | null => {
    const isDatabaseContainer = view.extra?.is_database_container === true;
    const isLegacyGrid = Number(view.layout) === GRID_LAYOUT && !isDatabaseContainer && !underDatabaseContainer;

    if (isLegacyGrid) {
      return view;
    }

    for (const child of view.children ?? []) {
      const match = visit(child, underDatabaseContainer || isDatabaseContainer);

      if (match) {
        return match;
      }
    }

    return null;
  };

  return visit(root, false);
}

async function ensureAtLeastOneRow(page: Page): Promise<void> {
  if ((await DatabaseGridSelectors.dataRows(page).count()) > 0) {
    return;
  }

  await DatabaseGridSelectors.newRowButton(page).click({ force: true });
  await expect(DatabaseGridSelectors.dataRows(page).first()).toBeVisible({ timeout: 15000 });
}

async function replaceCellText(page: Page, cell: Locator, text: string): Promise<void> {
  await cell.scrollIntoViewIfNeeded();
  await cell.evaluate((element) => (element as HTMLElement).click());

  const textarea = page.locator('textarea:visible').first();

  await expect(textarea).toBeVisible({ timeout: 8000 });
  await textarea.clear();

  if (text.length > 0) {
    await textarea.pressSequentially(text, { delay: 20 });
  }

  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
}

async function restoreProbeCell(
  page: Page,
  primaryFieldId: string,
  probeText: string,
  originalText: string
): Promise<void> {
  const probeCell = DatabaseGridSelectors.dataRowCellsForField(page, primaryFieldId)
    .filter({ hasText: probeText })
    .first();

  if ((await probeCell.count()) === 0) {
    return;
  }

  await replaceCellText(page, probeCell, originalText);
}

async function normalizedText(locator: Locator): Promise<string> {
  return ((await locator.textContent()) || '').trim();
}

async function getApi<T>(request: APIRequestContext, token: string, path: string): Promise<T> {
  const response = await request.get(`${TestConfig.apiUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    failOnStatusCode: false,
  });
  const body = (await response.json().catch(() => null)) as ApiResponse<T> | null;

  if (!response.ok() || body?.code !== 0 || body.data === undefined) {
    throw new Error(`API request failed for ${path}: HTTP ${response.status()} ${JSON.stringify(body)}`);
  }

  return body.data;
}

async function getPasswordAuthToken(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${TestConfig.gotrueUrl}/token?grant_type=password`, {
    headers: {
      'Content-Type': 'application/json',
    },
    data: {
      email: LEGACY_DB_OWNER_EMAIL,
      password: LEGACY_DB_OWNER_PASSWORD,
    },
    failOnStatusCode: false,
  });
  const body = (await response.json().catch(() => null)) as { access_token?: string; error?: string } | null;

  if (!response.ok() || !body?.access_token) {
    throw new Error(
      `Failed to sign in ${LEGACY_DB_OWNER_EMAIL} for API token: HTTP ${response.status()} ${JSON.stringify(body)}`
    );
  }

  return body.access_token;
}
