import { readFile, writeFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

import { expect, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { createDocumentPageAndNavigate } from '../support/page-utils';

import { livePresentationEnvironment, livePresentationPassword } from './environment';
import { PresentationNetwork, SOURCE_MARKER, type PresentationObservation } from './network';

import type {
  Artifact,
  JobStatus,
  PresentationStatus,
  ServerSlidePlan,
} from '../../src/components/presentation/server-contract';

const { Given, When, Then, Before, After } = createBdd();

interface State {
  network: PresentationNetwork;
  sourceUrl?: string;
  sourcePageId?: string;
  sourceRevision?: string;
  initialSceneHash?: string;
  initialUsage?: PresentationStatus['usage'];
  initialArtifact?: Artifact<ServerSlidePlan>;
  currentArtifact?: Artifact<ServerSlidePlan>;
  generation?: JobStatus;
  actionStart: number;
  downloadPath?: string;
  exportJob?: JobStatus;
  editedTitle: string;
}
const states = new WeakMap<Page, State>();

function state(page: Page): State {
  const value = states.get(page);

  if (!value) throw new Error('The live presentation scenario was not initialized.');
  return value;
}

Before(async ({ page }) => {
  states.set(page, {
    network: new PresentationNetwork(page),
    actionStart: 0,
    editedTitle: 'A measured launch with clear ownership',
  });
});

After(async ({ page, $testInfo }) => {
  const value = states.get(page);

  if (!value) return;
  try {
    await value.network.finish();
  } finally {
    const evidencePath = $testInfo.outputPath('presentation-gateway-evidence.json');

    await writeFile(
      evidencePath,
      JSON.stringify(
        {
          environment: livePresentationEnvironment(),
          sourceUrl: value.sourceUrl,
          // These are explicitly allowlisted IDs, counts and HTTP result metadata.
          requests: value.network.evidence(),
        },
        null,
        2
      )
    );
    await $testInfo.attach('presentation-gateway-evidence', {
      path: evidencePath,
      contentType: 'application/json',
    });
    states.delete(page);
  }
});

Given('the test user signs in through the UI to the confirmed paid presentation workspace', async ({ page, request }) => {
  const environment = livePresentationEnvironment();
  const health = await request.get(`${environment.gatewayOrigin}/health`, { timeout: 10_000 });

  expect(health.status(), 'The explicitly configured local Gateway must be healthy').toBe(200);

  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('login-email-input').fill(environment.email);
  await page.getByTestId('login-password-button').click();
  const passwordInput = page.getByTestId('password-input');

  await expect(passwordInput).toBeVisible();
  // Replace any driver error carrying typed text; recordings are disabled in the dedicated config.
  try {
    await passwordInput.fill(livePresentationPassword());
  } catch {
    throw new Error('Unable to enter the privately supplied login password.');
  }

  try {
    await page.getByTestId('password-submit-button').click();
  } catch {
    throw new Error('The login UI could not submit the password.');
  }

  // /app appears before workspace bootstrap finishes. Wait for its actual workspace route,
  // selected name and outline before interacting with the replaceable header subtree.
  await expect(page).toHaveURL(/\/app\/[0-9a-f-]{36}(?:\/|$)/i);
  await expect(page.getByTestId('current-workspace-name')).toHaveText(/\S/);
  await expect(page.getByTestId('space-item').first()).toBeVisible();
  const trigger = page.getByTestId('workspace-dropdown-trigger');
  const workspaceMenu = page.getByTestId('workspace-dropdown-content');
  const currentWorkspace = page.getByTestId('current-workspace-name');
  const targetPath = new RegExp(`/app/${environment.workspaceId}(?:/|$)`);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // Initial navigation may unmount the open menu. Re-resolve it and reopen only when closed.
      if (!(await workspaceMenu.isVisible())) await trigger.click({ timeout: 5_000 });
      await expect(workspaceMenu.getByText(environment.email, { exact: true })).toBeVisible({ timeout: 5_000 });
      if ((await currentWorkspace.textContent())?.trim() !== environment.workspaceName || !targetPath.test(page.url())) {
        await workspaceMenu
          .getByTestId('workspace-item')
          .filter({
            has: page.getByTestId('workspace-item-name').getByText(environment.workspaceName, { exact: true }),
          })
          .click({ timeout: 5_000 });
      } else {
        await page.keyboard.press('Escape');
      }

      await expect(currentWorkspace).toHaveText(environment.workspaceName, { timeout: 10_000 });
      await expect(page).toHaveURL(targetPath, { timeout: 10_000 });
      await expect(workspaceMenu).toBeHidden({ timeout: 5_000 });
      await expect(page.getByTestId('space-item').first()).toBeVisible({ timeout: 10_000 });
      return;
    } catch {
      if (attempt === 2)
        throw new Error('Unable to confirm the test user and select the target workspace after workspace bootstrap.');
      await page.keyboard.press('Escape');
    }
  }
});

Given('the test user creates a task-owned presentation source document in the editor', async ({ page }) => {
  const space = page.getByTestId('space-item').first();

  await expect(space).toBeVisible();
  await space.hover();
  await expect(space.getByTestId('inline-add-page')).toBeVisible();
  const viewId = await createDocumentPageAndNavigate(page);
  const title = `Presentation live BDD ${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const titleInput = page.getByTestId('page-title-input').filter({ visible: true }).first();

  await titleInput.fill(title);
  await titleInput.press('Tab');
  const editor = page.locator(`#editor-${viewId}`);
  const paragraphs = [
    'Launch decision: approve a staged rollout of a collaborative project workspace. This document gives the leadership team thirteen concrete topics for a decision presentation.',
    '1. Purpose. Help a distributed product team coordinate decisions, responsibilities and milestones in one shared workspace.',
    '2. Audience. Product leads, designers and engineers need a clear account of the launch scope and the evidence behind it.',
    '3. Current problem. Project notes live in separate documents, so owners repeat status updates and decisions are difficult to find.',
    '4. Target workflow. Teams capture a proposal, discuss alternatives, assign an owner, record a decision and track the next review.',
    '5. Pilot scope. Start with two project teams. Include planning notes, a task database and a weekly decision review.',
    '6. Success measures. Track completed reviews, unresolved ownership questions and time spent collecting weekly updates. Establish a baseline before comparing outcomes.',
    '7. Source quality. Each claim must link to its source document or database row. Do not invent measurements that have not been collected.',
    '8. Ownership. A product lead owns the pilot decision. Engineering owns reliability. Design owns onboarding clarity. Team leads own feedback.',
    '9. Rollout sequence. Prepare the workspace, onboard pilot members, observe two weekly reviews, address issues and then decide whether to expand.',
    '10. Risks. Missing permissions can hide context. Outdated notes can mislead reviewers. Unclear ownership can delay follow-up.',
    '11. Mitigations. Check member access before the pilot, keep source links beside decisions and assign a named owner to each open action.',
    '12. Review process. Hold a weekly review using the same agenda. Record what changed, what remains uncertain and which evidence is needed next.',
    `13. Decision requested. Approve the bounded pilot and its owners. ${SOURCE_MARKER}`,
  ];

  await editor.click();
  try {
    for (const [index, paragraph] of paragraphs.entries()) {
      if (index) await page.keyboard.press('Enter');
      await page.keyboard.insertText(paragraph);
    }
  } catch {
    throw new Error('Unable to type the task-owned source document.');
  }

  await expect.poll(async () => (await editor.textContent())?.includes(SOURCE_MARKER)).toBe(true);
  state(page).sourceUrl = page.url();
  state(page).sourcePageId = viewId;
  // Reload exercises reopening; the following /sources assertion separately proves Cloud persistence.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect
    .poll(async () => (await page.locator(`#editor-${viewId}`).textContent())?.includes(SOURCE_MARKER))
    .toBe(true);
});

When('the test user generates a custom {int} slide presentation through the UI', async ({ page }, count: number) => {
  const value = state(page);

  await page.getByTestId('present-button').click();
  await page.getByRole('menuitem', { name: 'Generate AI ppt', exact: true }).click();
  const status = await value.network.status();
  const source = await value.network.source(value.sourcePageId!);

  expect(status.plan).toBe('paid');
  expect(source.containsMarker, 'Cloud must resolve the content created through the editor').toBe(true);
  expect(source.blockCount).toBeGreaterThan(0);
  expect(source.revision.length).toBeGreaterThan(0);
  value.sourceRevision = source.revision;
  value.initialUsage = { ...status.usage };
  await page.getByRole('button', { name: 'Custom', exact: true }).click();
  await page.getByRole('menuitemradio', { name: String(count), exact: true }).click();
  const review = page.getByRole('switch', { name: 'Review generated story plan', exact: true });

  if (await review.isChecked()) await review.uncheck();
  const purpose = page.getByRole('textbox', { name: 'Presentation purpose', exact: true });

  const generate = page.getByRole('button', { name: 'Generate presentation', exact: true });
  let assessmentFailure: PresentationObservation | undefined;

  await expect
    .poll(
      async () => {
        if ((await purpose.isVisible()) && !(await purpose.inputValue())) {
          await purpose.fill('Approve a bounded pilot and assign accountable launch owners.');
        }

        assessmentFailure = value.network.records.find(
          (r) => r.path.endsWith('/slides/assess') && (r.status >= 400 || (r.code !== undefined && r.code !== 0))
        );
        return !!assessmentFailure || (await generate.isEnabled());
      },
      { timeout: 180_000, message: 'Waiting for real source assessment to enable generation' }
    )
    .toBe(true);
  if (assessmentFailure) {
    throw new Error(
      `Source assessment failed: HTTP ${assessmentFailure.status}, code ${assessmentFailure.code ?? 'unknown'}, reason ${
        assessmentFailure.reason ?? 'unspecified'
      }.`
    );
  }

  value.actionStart = value.network.records.length;
  await generate.click();
  value.generation = await value.network.job('slides', value.actionStart);
});

Then(
  'the real Gateway returns a saved {int} slide deck from a successful Cloud job',
  async ({ page }, count: number) => {
    const value = state(page);
    const job = value.generation!;
    const submit = value.network.records.slice(value.actionStart).find((r) => r.request);

    expect(submit?.request?.count).toBe(count);
    expect(submit?.request?.countMode).toBe('custom');
    expect(submit?.request?.artifact ?? null).toBeNull();
    expect(job.artifactId).toBeTruthy();
    expect(job.resultVersion).toBeGreaterThan(0);
    expect(job.committedUnits).toBe(count);
    const artifact = await value.network.artifact(job.artifactId!, job.resultVersion!);

    expect(artifact.workspaceId).toBe(livePresentationEnvironment().workspaceId);
    expect(artifact.content.slides.length).toBe(count);
    expect(artifact.generationJobId).toBe(job.id);
    expect(artifact.sourceRevision).toBe(value.sourceRevision);
    const scene = await value.network.scene(artifact.id, artifact.version, value.actionStart);

    expect(scene.slideCount).toBe(count);
    value.initialSceneHash = scene.hash;
    await expect(page.getByRole('navigation', { name: 'Slides', exact: true }).getByRole('button')).toHaveCount(count);
    value.initialArtifact = artifact;
    value.currentArtifact = artifact;
  }
);

When('the test user reloads the page and opens that saved presentation from Share', async ({ page }) => {
  const value = state(page);

  value.actionStart = value.network.records.length;
  await page.getByRole('button', { name: 'Close presentation preview', exact: true }).click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('share-button').first().click();
  await page.getByRole('tab', { name: 'AI Slides', exact: true }).click();
  const catalog = page.getByRole('region', { name: 'Workspace presentations', exact: true });
  // Independent runs may produce identical titles; open the exact artifact created by this run.
  const row = catalog.locator(`[data-artifact-id="${value.initialArtifact!.id}"]`);

  try {
    await row.getByRole('button', { name: 'Preview', exact: true }).click();
  } catch {
    throw new Error('Unable to open the task-owned saved presentation from the Share catalog.');
  }

  await expect(page.getByRole('button', { name: 'Edit story plan', exact: true })).toBeVisible();
});

Then('the same saved artifact and version are displayed without another generation', async ({ page }) => {
  const value = state(page);
  const original = value.initialArtifact!;
  const loaded = await value.network.artifact(original.id, original.version, value.actionStart);

  expect(loaded.resultHash).toBe(original.resultHash);
  expect(value.network.records.slice(value.actionStart).filter((r) => r.request)).toHaveLength(0);
  const scene = await value.network.scene(original.id, original.version, value.actionStart);

  expect(scene.hash).toBe(value.initialSceneHash);
  await expect(page.getByRole('navigation', { name: 'Slides', exact: true }).getByRole('button')).toHaveCount(13);
});

When('the test user edits the first story title and saves and regenerates the presentation', async ({ page }) => {
  const value = state(page);

  await page.getByRole('button', { name: 'Edit story plan', exact: true }).click();
  await page.getByRole('textbox', { name: 'Slide 1 title', exact: true }).fill(value.editedTitle);
  value.actionStart = value.network.records.length;
  await page.getByRole('button', { name: 'Save and regenerate', exact: true }).click();
  value.generation = await value.network.job('slides', value.actionStart);
});

Then('the same artifact has a newer version containing the edited story title', async ({ page }) => {
  const value = state(page);
  const original = value.initialArtifact!;

  expect(value.generation!.artifactId).toBe(original.id);
  expect(value.generation!.resultVersion).toBe(original.version + 1);
  const artifact = await value.network.artifact(original.id, original.version + 1, value.actionStart);

  expect(artifact.content.slides.length).toBe(13);
  expect(artifact.content.slides[0].title === value.editedTitle, 'The saved story must retain the edited title').toBe(
    true
  );
  expect(artifact.resultHash === original.resultHash).toBe(false);
  const submit = value.network.records.slice(value.actionStart).find((record) => record.request);

  expect(submit?.request?.artifact).toEqual({ id: original.id, version: original.version });
  const scene = await value.network.scene(original.id, original.version + 1, value.actionStart);

  expect(scene.slideCount).toBe(13);
  expect(scene.hash === value.initialSceneHash).toBe(false);
  expect(
    scene.firstSlideTexts.includes(value.editedTitle),
    'The regenerated native scene must contain the edited title'
  ).toBe(true);
  await expect(page.getByRole('button', { name: `Preview slide 1: ${value.editedTitle}`, exact: true })).toBeVisible();
  await expect
    .poll(
      async () => {
        const text = await page.locator('.ps-preview-main .ps-scene:not(.ps-miniature)').first().textContent();

        return text?.includes(value.editedTitle);
      },
      { message: 'The rendered server scene must display the regenerated title' }
    )
    .toBe(true);
  value.currentArtifact = artifact;
});

When('the test user exports the saved presentation and downloads PowerPoint', async ({ page }) => {
  const value = state(page);

  await page.getByRole('button', { name: 'Export PPTX', exact: true }).click();
  value.actionStart = value.network.records.length;
  const downloadPromise = page.waitForEvent('download', { timeout: 360_000 });

  await page.getByRole('button', { name: 'Download PowerPoint (.pptx)', exact: true }).click();
  const [download, job] = await Promise.all([downloadPromise, value.network.job('export', value.actionStart)]);

  value.exportJob = job;

  expect((await download.failure()) === null, 'The authenticated PowerPoint download must finish').toBe(true);
  expect(/\.pptx$/i.test(download.suggestedFilename())).toBe(true);
  value.downloadPath = (await download.path())!;
});

Then('the downloaded file contains {int} editable PowerPoint slides', async ({ page }, count: number) => {
  const value = state(page);
  const bytes = await readFile(value.downloadPath!);

  expect(bytes.byteLength).toBeGreaterThan(1000);
  expect(bytes.byteLength).toBeLessThan(64 * 1024 * 1024);
  const files = zipEntries(bytes);

  expect(files.has('[Content_Types].xml')).toBe(true);
  expect(files.has('ppt/presentation.xml')).toBe(true);
  const slides = [...files.entries()].filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/.test(name));

  expect(slides.length).toBe(count);
  expect(
    slides.every(([, xml]) => xml.includes('<p:sp>') && /<a:t(?:\s[^>]*)?>/.test(xml)),
    'Every exported slide must contain native editable text shapes'
  ).toBe(true);
  expect(
    files.get('ppt/slides/slide1.xml')?.includes(value.editedTitle),
    'The exported first slide must contain the regenerated title'
  ).toBe(true);
  expect(value.exportJob!.artifactId).toBe(value.currentArtifact!.id);
  // Export jobs publish a file, not a new artifact version; their resultVersion is null.
  const exportRequest = value.network.records.slice(value.actionStart).find((r) => r.exportArtifact);

  expect(exportRequest?.exportArtifact).toEqual({
    id: value.currentArtifact!.id,
    version: value.currentArtifact!.version,
  });
  const delivery = value.network.records
    .slice(value.actionStart)
    .find((r) => /\/exports\/[^/]+\/download$/.test(r.path));

  expect(delivery?.status).toBe(200);
});

Then('the paid workflow leaves the workspace Free slide and export allowances unchanged', async ({ page }) => {
  const value = state(page);
  const status = await value.network.status(value.actionStart);

  expect(status.plan).toBe('paid');
  expect(status.usage.freeSlides).toBe(value.initialUsage!.freeSlides);
  expect(status.usage.freeExports).toBe(value.initialUsage!.freeExports);
  expect(status.usage.reservedSlides).toBe(value.initialUsage!.reservedSlides);
  expect(status.usage.reservedExports).toBe(value.initialUsage!.reservedExports);
  expect(value.network.records.filter((r) => r.request)).toHaveLength(2);
  expect(value.network.records.some((r) => r.path.endsWith('/slides/assess') && r.code === 0)).toBe(true);
});

/** Read bounded ZIP central-directory entries, including compressed native editable slide XML. */
function zipEntries(bytes: Buffer): Map<string, string> {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));

  expect(end).toBeGreaterThanOrEqual(0);
  const count = bytes.readUInt16LE(end + 10);
  let cursor = bytes.readUInt32LE(end + 16);
  const entries = new Map<string, string>();

  expect(count).toBeLessThan(10_000);
  for (let index = 0; index < count; index++) {
    expect(bytes.readUInt32LE(cursor)).toBe(0x02014b50);
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const offset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');

    if (/^ppt\/slides\/slide\d+\.xml$/.test(name)) {
      expect(bytes.readUInt32LE(offset)).toBe(0x04034b50);
      const start = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28);
      const data = bytes.subarray(start, start + compressedSize);

      expect([0, 8]).toContain(method);
      entries.set(
        name,
        (method === 8 ? inflateRawSync(data, { maxOutputLength: 4 * 1024 * 1024 }) : data).toString('utf8')
      );
    } else entries.set(name, '');
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}
