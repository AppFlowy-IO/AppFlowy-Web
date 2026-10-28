import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { signInAndWaitForApp } from '../../support/auth-flow-helpers';
import { EditorSelectors, HeaderSelectors } from '../../support/selectors';
import { generateRandomEmail, TestConfig } from '../../support/test-config';

test.describe.configure({ retries: 0 });

test('page width synchronizes between independent sessions and survives reload', async ({ browser, request, baseURL }, testInfo) => {
  test.setTimeout(180000);
  const viewport = { width: 1600, height: 1000 };
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  const milestones: { step: string; elapsedMs: number }[] = [];
  const start = Date.now();

  async function presentationPause() {
    // Presentation-only pause, after assertions, for an opt-in review recording.
    if (process.env.RECORD_WIDTH_SYNC === 'true') {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }

  async function checkpoint(step: string) {
    milestones.push({ step, elapsedMs: Date.now() - start });
    await presentationPause();
  }

  async function expectWidth(page: Page, width: number | 'full') {
    const editor = page.getByTestId('editor-content');
    const title = page.locator('[data-view-meta-preview] h1');

    await expect(editor).toBeVisible();
    await expect(page.getByTestId('page-title-input')).toHaveText('Shared document width');
    if (width === 'full') {
      await expect.poll(async () => (await editor.boundingBox())!.width).toBeGreaterThan(1200);
    } else {
      await expect(editor).toHaveCSS('width', `${width}px`);
    }
    const editorBounds = (await editor.boundingBox())!;
    const titleBounds = (await title.boundingBox())!;

    expect(titleBounds.width).toBeCloseTo(editorBounds.width, 0);
    expect(titleBounds.x).toBeCloseTo(editorBounds.x, 0);
  }

  async function setWidth(page: Page, width: 'full' | 'default' | number) {
    await HeaderSelectors.moreActionsButton(page).click();
    await page.getByTestId('document-width-action').hover();
    await expect(page.getByTestId('document-width-menu')).toBeVisible();
    await presentationPause();
    const saved = page.waitForResponse((response) =>
      response.request().method() === 'PATCH' && /\/page-view\/[^/]+$/.test(new URL(response.url()).pathname));

    if (typeof width === 'number') {
      await page.getByTestId('document-width-input').fill(String(width));
      await expect(page.getByTestId('document-width-input')).toHaveValue(String(width));
      await presentationPause();
      await page.getByTestId('document-width-apply').click();
    } else {
      await page.getByTestId(`document-width-${width}`).click();
    }
    const response = await saved;
    const result = await response.json();

    expect(response.ok()).toBe(true);
    expect(result.code, result.message || 'Width update must succeed').toBe(0);
    await expect(page.getByTestId('document-width-menu')).toBeHidden();
  }

  try {
    // Separate storage and BroadcastChannels require these updates to go through
    // the real Cloud API and WebSocket, rather than a same-browser cache update.
    for (const label of ['sender', 'receiver']) {
      const context = await browser.newContext({
        baseURL,
        viewport,
        recordVideo: { dir: testInfo.outputPath(label), size: viewport },
      });

      contexts.push(context);
    }
    pages.push(...await Promise.all(contexts.map((context) => context.newPage())));
    for (const page of pages) {
      page.on('pageerror', (error) => console.error('Width sync page error:', error.stack));
      page.on('console', (message) => {
        if (message.type() === 'error') console.error('Width sync browser error:', message.text());
      });
    }
    const [sender, receiver] = pages;
    const email = generateRandomEmail();

    await signInAndWaitForApp(sender, request, email, 0);
    const workspaceId = new URL(sender.url()).pathname.split('/')[2];
    const token = await sender.evaluate(() => localStorage.getItem('af_auth_token'));

    expect(token).toBeTruthy();
    const headers = { Authorization: `Bearer ${token}` };
    const workspaceUrl = `${TestConfig.apiUrl}/api/workspace/${workspaceId}`;
    const outlineResponse = await request.get(`${workspaceUrl}/view/${workspaceId}?depth=1`, { headers });
    const outline = await outlineResponse.json();

    expect(outline.code).toBe(0);
    const parent = outline.data.children.find((view: { is_space: boolean; is_private: boolean }) =>
      view.is_space && !view.is_private);

    expect(parent).toBeTruthy();
    const viewId = randomUUID();
    const created = await request.post(`${workspaceUrl}/v2/page-view/document/default`, {
      headers,
      data: {
        schema_version: 'v1', request_id: randomUUID(), view_id: viewId,
        parent_view_id: parent.view_id, position: { kind: 'start' }, name: 'Shared document width',
      },
    });

    expect((await created.json()).code).toBe(0);
    const documentUrl = new URL(`/app/${workspaceId}/${viewId}`, sender.url()).href;

    await sender.goto(documentUrl);
    const content = 'A shared page keeps the same reading width in every session. Choose Full width, set a custom width, and reopen the page to check that the saved layout follows the document. '.repeat(4);

    await EditorSelectors.firstEditor(sender).click();
    await sender.keyboard.insertText(content);
    await expect(EditorSelectors.firstEditor(sender)).toContainText(content);
    await signInAndWaitForApp(receiver, request, email, 0);
    await receiver.goto(documentUrl);
    await expect(sender.getByTestId('page-title-input')).toHaveText('Shared document width');
    await expect(receiver.getByTestId('page-title-input')).toHaveText('Shared document width');
    await expect(EditorSelectors.firstEditor(receiver)).toContainText(content);
    await expectWidth(sender, 952);
    await expectWidth(receiver, 952);
    await checkpoint('Both sessions open the same document at the default 952px width');

    await test.step('Full width from the sender updates the receiver without reloading', async () => {
      await setWidth(sender, 'full');
      await expectWidth(sender, 'full');
      await expectWidth(receiver, 'full');
      await checkpoint('Sender chooses Full; both sessions expand');
    });

    await test.step('A custom width from the receiver updates the sender without reloading', async () => {
      await setWidth(receiver, 1200);
      await expectWidth(receiver, 1200);
      await expectWidth(sender, 1200);
      const response = await request.get(`${TestConfig.apiUrl}/api/workspace/${workspaceId}/view/${viewId}?depth=0`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.ok()).toBe(true);
      const body = await response.json();

      expect(body.code).toBe(0);
      expect(body.data.view_id).toBe(viewId);
      expect(body.data.extra.document_width).toEqual({ mode: 'fixed', max_width: 1200 });
      await checkpoint('Receiver chooses 1200px; both sessions and server metadata agree');
    });

    await test.step('The saved width survives reloading both independent sessions', async () => {
      await Promise.all(pages.map((page) => page.reload()));
      await expectWidth(sender, 1200);
      await expectWidth(receiver, 1200);
      await checkpoint('Both sessions reload and retain 1200px');
    });

    await test.step('Reset returns both sessions to their default and removes the saved override', async () => {
      await setWidth(sender, 'default');
      await expectWidth(sender, 952);
      await expectWidth(receiver, 952);
      const response = await request.get(`${TestConfig.apiUrl}/api/workspace/${workspaceId}/view/${viewId}?depth=0`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.ok()).toBe(true);
      const body = await response.json();

      expect(body.code).toBe(0);
      expect(body.data.view_id).toBe(viewId);
      expect(body.data.extra?.document_width).toBeUndefined();
      await checkpoint('Reset synchronizes; both sessions return to 952px');
    });
  } finally {
    // Closing the contexts flushes the complete recordings, including failures.
    await Promise.all(contexts.map((context) => context.close()));
    for (const [index, page] of pages.entries()) {
      const video = page.video();

      if (video) await testInfo.attach(`width-sync-session-${index + 1}`, { path: await video.path(), contentType: 'video/webm' });
    }
    const milestoneFile = testInfo.outputPath('width-sync-milestones.json');

    await writeFile(milestoneFile, JSON.stringify({ start, milestones }, null, 2));
    await testInfo.attach('width-sync-milestones', { path: milestoneFile, contentType: 'application/json' });
  }
});
