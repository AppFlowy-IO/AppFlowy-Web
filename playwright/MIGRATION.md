# Cypress to Playwright Migration Guide

This document tracks the step-by-step migration of all Cypress E2E tests to Playwright.

---

## Table of Contents

1. [Migration Overview](#migration-overview)
2. [API Mapping: Cypress to Playwright](#api-mapping-cypress-to-playwright)
3. [Support Infrastructure](#support-infrastructure)
4. [Fixtures](#fixtures)
5. [Test Files by Category](#test-files-by-category)
6. [Migration Status Tracker](#migration-status-tracker)

---

## Migration Overview

| Metric | Count |
|--------|-------|
| Total E2E test files | 120 |
| Component test files | 2 |
| Support/utility files | 35 |
| Fixture files | 20 |
| Test categories | 15 |

### Source & Target Directories

| Component | Cypress Path | Playwright Path |
|-----------|-------------|-----------------|
| E2E Tests | `cypress/e2e/` | `playwright/e2e/` |
| Support | `cypress/support/` | `playwright/support/` |
| Fixtures | `cypress/fixtures/` | `playwright/fixtures/` |
| Components | `cypress/components/` | `playwright/components/` |
| Config | `cypress.config.ts` | `playwright.config.ts` |

---

## API Mapping: Cypress to Playwright

### Core Commands

| Cypress | Playwright | Notes |
|---------|-----------|-------|
| `cy.visit(url)` | `await page.goto(url)` | |
| `cy.get(selector)` | `page.locator(selector)` | Playwright locators are lazy |
| `cy.contains(text)` | `page.getByText(text)` or `page.locator(':has-text("text")')` | |
| `cy.find(selector)` | `locator.locator(selector)` | Chained locators |
| `cy.first()` | `locator.first()` | |
| `cy.last()` | `locator.last()` | |
| `cy.eq(n)` | `locator.nth(n)` | |
| `cy.closest(sel)` | `locator.locator('sel >> nth=0')` or custom | No direct equivalent |
| `cy.parent()` | `locator.locator('..')` | XPath parent |
| `cy.children()` | `locator.locator('> *')` | Direct children |
| `cy.within(() => {})` | Use scoped locator | `parent.locator(child)` |

### Assertions

| Cypress | Playwright | Notes |
|---------|-----------|-------|
| `.should('be.visible')` | `await expect(locator).toBeVisible()` | |
| `.should('not.exist')` | `await expect(locator).toHaveCount(0)` | |
| `.should('have.length', n)` | `await expect(locator).toHaveCount(n)` | |
| `.should('contain', text)` | `await expect(locator).toContainText(text)` | |
| `.should('have.text', text)` | `await expect(locator).toHaveText(text)` | |
| `.should('have.value', val)` | `await expect(locator).toHaveValue(val)` | |
| `.should('have.attr', k, v)` | `await expect(locator).toHaveAttribute(k, v)` | |
| `.should('have.class', cls)` | `await expect(locator).toHaveClass(/cls/)` | |
| `.should('include', text)` | `await expect(locator).toContainText(text)` | |
| `cy.url().should('include', x)` | `await expect(page).toHaveURL(/x/)` | |

### Actions

| Cypress | Playwright | Notes |
|---------|-----------|-------|
| `.click()` | `await locator.click()` | |
| `.click({ force: true })` | `await locator.click({ force: true })` | |
| `.dblclick()` | `await locator.dblclick()` | |
| `.type(text)` | `await locator.fill(text)` or `await locator.pressSequentially(text)` | `fill` replaces, `pressSequentially` types char by char |
| `.clear()` | `await locator.clear()` | |
| `.clear().type(text)` | `await locator.fill(text)` | `fill` clears first |
| `.check()` | `await locator.check()` | |
| `.uncheck()` | `await locator.uncheck()` | |
| `.select(val)` | `await locator.selectOption(val)` | |
| `.trigger('mouseenter')` | `await locator.hover()` | |
| `.trigger('mouseover')` | `await locator.hover()` | |
| `.scrollIntoView()` | `await locator.scrollIntoViewIfNeeded()` | |
| `.focus()` | `await locator.focus()` | |
| `.blur()` | `await locator.blur()` | |

### Keyboard

| Cypress | Playwright | Notes |
|---------|-----------|-------|
| `.type('{enter}')` | `await page.keyboard.press('Enter')` | |
| `.type('{backspace}')` | `await page.keyboard.press('Backspace')` | |
| `.type('{selectall}')` | `await page.keyboard.press('Control+A')` | Or `Meta+A` on Mac |
| `.type('{cmd}a')` | `await page.keyboard.press('Meta+a')` | |
| `.type('{ctrl}a')` | `await page.keyboard.press('Control+a')` | |
| `.type('{shift}{enter}')` | `await page.keyboard.press('Shift+Enter')` | |
| `.type('/', { delay: 100 })` | `await locator.pressSequentially('/', { delay: 100 })` | |

### Network / API

| Cypress | Playwright | Notes |
|---------|-----------|-------|
| `cy.intercept(method, url, response)` | `await page.route(url, route => route.fulfill(response))` | |
| `cy.intercept(url).as('alias')` | `const promise = page.waitForResponse(url)` | |
| `cy.wait('@alias')` | `await promise` | |
| `cy.request({ method, url, body })` | `await request.fetch(url, { method, data: body })` | Use `APIRequestContext` |

### Waits

| Cypress | Playwright | Notes |
|---------|-----------|-------|
| `cy.wait(ms)` | `await page.waitForTimeout(ms)` | Avoid in Playwright; prefer auto-waiting |
| `cy.wait('@alias')` | `await page.waitForResponse(url)` | |
| `.should('be.visible')` | Auto-waiting built into actions | Playwright auto-waits |

### Local Storage / Cookies

| Cypress | Playwright | Notes |
|---------|-----------|-------|
| `cy.window()` | `await page.evaluate(...)` | |
| `win.localStorage.setItem(k, v)` | `await page.evaluate(() => localStorage.setItem(k, v))` | |
| `win.localStorage.getItem(k)` | `await page.evaluate(() => localStorage.getItem(k))` | |

### File Upload

| Cypress | Playwright | Notes |
|---------|-----------|-------|
| `.attachFile('file.png')` | `await locator.setInputFiles('path/to/file.png')` | |
| `cy.fixture('file.json')` | `JSON.parse(fs.readFileSync('path'))` or `require` | |

### Clipboard

| Cypress | Playwright | Notes |
|---------|-----------|-------|
| `cy.window().then(w => w.navigator.clipboard)` | `await page.evaluate(() => navigator.clipboard.readText())` | Need `clipboard-read` permission in context |

### Drag & Drop (via `@4tw/cypress-drag-drop`)

| Cypress | Playwright | Notes |
|---------|-----------|-------|
| `.drag(target)` | `await source.dragTo(target)` | Built-in in Playwright |

### Real Events (via `cypress-real-events`)

| Cypress | Playwright | Notes |
|---------|-----------|-------|
| `.realClick()` | `await locator.click()` | Playwright clicks are real by default |
| `.realHover()` | `await locator.hover()` | |
| `.realType(text)` | `await locator.pressSequentially(text)` | |

---

## Support Infrastructure

### Files to Migrate

Each Cypress support file needs to be converted to a Playwright equivalent.

| # | Cypress File | Playwright Target | Priority | Status |
|---|-------------|-------------------|----------|--------|
| 1 | `support/e2e.ts` | `support/global-setup.ts` + `support/fixtures.ts` | P0 | Pending |
| 2 | `support/commands.ts` | `support/commands.ts` (helper functions) | P0 | Pending |
| 3 | `support/test-config.ts` | `support/test-config.ts` | P0 | Pending |
| 4 | `support/auth-utils.ts` | `support/auth-utils.ts` | P0 | Pending |
| 5 | `support/selectors.ts` | `support/selectors.ts` | P0 | Pending |
| 6 | `support/api-utils.ts` | `support/api-utils.ts` | P0 | Pending |
| 7 | `support/api-mocks.ts` | `support/api-mocks.ts` | P1 | Pending |
| 8 | `support/page-utils.ts` | `support/page-utils.ts` | P0 | Pending |
| 9 | `support/db-utils.ts` | `support/db-utils.ts` | P1 | Pending |
| 10 | `support/auth-flow-helpers.ts` | `support/auth-flow-helpers.ts` | P1 | Pending |
| 11 | `support/avatar-selectors.ts` | `support/avatar-selectors.ts` | P2 | Pending |
| 12 | `support/exception-handlers.ts` | Built into Playwright config | P1 | Pending |
| 13 | `support/console-logger.ts` | `support/console-logger.ts` | P2 | Pending |
| 14 | `support/test-helpers.ts` | `support/test-helpers.ts` | P1 | Pending |
| 15 | `support/document.ts` | `support/document.ts` | P1 | Pending |
| 16 | `support/i18n-constants.ts` | `support/i18n-constants.ts` (copy as-is) | P2 | Pending |
| 17 | `support/paste-utils.ts` | `support/paste-utils.ts` | P2 | Pending |
| 18 | `support/chat-mocks.ts` | `support/chat-mocks.ts` | P2 | Pending |
| 19 | `support/calendar-test-helpers.ts` | `support/calendar-test-helpers.ts` | P2 | Pending |
| 20 | `support/field-type-helpers.ts` | `support/field-type-helpers.ts` | P2 | Pending |
| 21 | `support/field-type-test-helpers.ts` | `support/field-type-test-helpers.ts` | P2 | Pending |
| 22 | `support/sort-test-helpers.ts` | `support/sort-test-helpers.ts` | P2 | Pending |
| 23 | `support/filter-test-helpers.ts` | `support/filter-test-helpers.ts` | P2 | Pending |
| 24 | `support/row-detail-helpers.ts` | `support/row-detail-helpers.ts` | P2 | Pending |
| 25 | `support/comment-test-helpers.ts` | `support/comment-test-helpers.ts` | P2 | Pending |
| 26 | `support/database-ui-helpers.ts` | `support/database-ui-helpers.ts` | P2 | Pending |
| 27 | `support/iframe-test-helpers.ts` | `support/iframe-test-helpers.ts` | P2 | Pending |
| 28 | `support/page/flows.ts` | `support/page/flows.ts` | P1 | Pending |
| 29 | `support/page/modal.ts` | `support/page/modal.ts` | P1 | Pending |
| 30 | `support/page/page-actions.ts` | `support/page/page-actions.ts` | P1 | Pending |
| 31 | `support/page/pages.ts` | `support/page/pages.ts` | P1 | Pending |
| 32 | `support/page/share-publish.ts` | `support/page/share-publish.ts` | P1 | Pending |
| 33 | `support/page/workspace.ts` | `support/page/workspace.ts` | P1 | Pending |

### Key Architecture Differences

| Concept | Cypress | Playwright |
|---------|---------|-----------|
| Custom commands | `Cypress.Commands.add()` | Helper functions / Page Object classes / custom fixtures |
| Global hooks | `beforeEach`/`afterEach` in `e2e.ts` | `test.beforeEach`/`test.afterEach` in fixture or config |
| Intercepts | `cy.intercept()` in `beforeEach` | `page.route()` in `beforeEach` or fixture |
| Exception handling | `Cypress.on('uncaught:exception')` | `page.on('pageerror')` in config |
| Type declarations | `cypress.d.ts` / `index.d.ts` | Standard TypeScript |
| Environment vars | `Cypress.env()` | `process.env` or `playwright.config.ts` `use.env` |
| Base URL | `Cypress.config('baseUrl')` | `playwright.config.ts` `use.baseURL` |
| Retries | `retries: { runMode: 2 }` | `retries: 2` in config |

### Selectors Migration Strategy

The `selectors.ts` file contains Cypress-specific selector objects that return `cy.get()` chains. In Playwright, these become:

**Option A: Locator factory functions**
```typescript
// Cypress (current)
export const PageSelectors = {
  items: () => cy.get('[data-testid="page-item"]'),
};

// Playwright (migrated)
export const PageSelectors = {
  items: (page: Page) => page.locator('[data-testid="page-item"]'),
};
```

**Option B: Page Object Model (recommended for Playwright)**
```typescript
export class PagePage {
  constructor(private page: Page) {}
  get items() { return this.page.getByTestId('page-item'); }
  get names() { return this.page.getByTestId('page-name'); }
  pageByViewId(viewId: string) { return this.page.getByTestId(`page-${viewId}`).first(); }
}
```

---

## Fixtures

| # | Fixture File | Action |
|---|-------------|--------|
| 1 | `fixtures/simple_doc.json` | Copy as-is |
| 2 | `fixtures/full_doc.json` | Copy as-is |
| 3 | `fixtures/editor/blocks/paragraph.json` | Copy as-is |
| 4 | `fixtures/database/*.json` (4 files) | Copy as-is |
| 5 | `fixtures/database/rows/*.json` (4 files) | Copy as-is |
| 6 | `fixtures/database/csv/*.csv` (8 files) | Copy as-is |
| 7 | `fixtures/appflowy.png` | Copy as-is |
| 8 | `fixtures/test-icon.png` | Copy as-is |

---

## Test Files by Category

### 1. Account Tests (10 files)

| # | Cypress Test File | Playwright Target | Status |
|---|------------------|-------------------|--------|
| 1 | `account/update-user-profile.cy.ts` | `account/update-user-profile.spec.ts` | Pending |
| 2 | `account/avatar/avatar-api.cy.ts` | `account/avatar/avatar-api.spec.ts` | Pending |
| 3 | `account/avatar/avatar-awareness-dedupe.cy.ts` | `account/avatar/avatar-awareness-dedupe.spec.ts` | Pending |
| 4 | `account/avatar/avatar-database.cy.ts` | `account/avatar/avatar-database.spec.ts` | Pending |
| 5 | `account/avatar/avatar-header.cy.ts` | `account/avatar/avatar-header.spec.ts` | Pending |
| 6 | `account/avatar/avatar-notifications.cy.ts` | `account/avatar/avatar-notifications.spec.ts` | Pending |
| 7 | `account/avatar/avatar-persistence.cy.ts` | `account/avatar/avatar-persistence.spec.ts` | Pending |
| 8 | `account/avatar/avatar-priority.cy.ts` | `account/avatar/avatar-priority.spec.ts` | Pending |
| 9 | `account/avatar/avatar-types.cy.ts` | `account/avatar/avatar-types.spec.ts` | Pending |

### 2. App Tests (10 files)

| # | Cypress Test File | Playwright Target | Status |
|---|------------------|-------------------|--------|
| 1 | `app/context-split-navigation.cy.ts` | `app/context-split-navigation.spec.ts` | Pending |
| 2 | `app/more-actions-menu.cy.ts` | `app/more-actions-menu.spec.ts` | Pending |
| 3 | `app/outline-lazy-loading.cy.ts` | `app/outline-lazy-loading.spec.ts` | Pending |
| 4 | `app/page-icon-upload.cy.ts` | `app/page-icon-upload.spec.ts` | Pending |
| 5 | `app/sidebar-components.cy.ts` | `app/sidebar-components.spec.ts` | Pending |
| 6 | `app/sidebar-context-stability.cy.ts` | `app/sidebar-context-stability.spec.ts` | Pending |
| 7 | `app/upgrade-plan.cy.ts` | `app/upgrade-plan.spec.ts` | Pending |
| 8 | `app/view-modal.cy.ts` | `app/view-modal.spec.ts` | Pending |
| 9 | `app/workspace-data-loading.cy.ts` | `app/workspace-data-loading.spec.ts` | Pending |
| 10 | `app/websocket-reconnect.cy.ts` | `app/websocket-reconnect.spec.ts` | Pending |

### 3. Auth Tests (5 files)

| # | Cypress Test File | Playwright Target | Status |
|---|------------------|-------------------|--------|
| 1 | `auth/login-logout.cy.ts` | `auth/login-logout.spec.ts` | Pending |
| 2 | `auth/oauth-login.cy.ts` | `auth/oauth-login.spec.ts` | Pending |
| 3 | `auth/otp-login.cy.ts` | `auth/otp-login.spec.ts` | Pending |
| 4 | `auth/password-login.cy.ts` | `auth/password-login.spec.ts` | Pending |
| 5 | `auth/password-signup.cy.ts` | `auth/password-signup.spec.ts` | Pending |

### 4. Calendar Tests (3 files)

| # | Cypress Test File | Playwright Target | Status |
|---|------------------|-------------------|--------|
| 1 | `calendar/calendar-basic.cy.ts` | `calendar/calendar-basic.spec.ts` | Pending |
| 2 | `calendar/calendar-navigation.cy.ts` | `calendar/calendar-navigation.spec.ts` | Pending |
| 3 | `calendar/calendar-reschedule.cy.ts` | `calendar/calendar-reschedule.spec.ts` | Pending |

### 5. Chat Tests (5 files)

| # | Cypress Test File | Playwright Target | Status |
|---|------------------|-------------------|--------|
| 1 | `chat/chat-input.cy.ts` | `chat/chat-input.spec.ts` | Pending |
| 2 | `chat/chat-provider-stability.cy.ts` | `chat/chat-provider-stability.spec.ts` | Pending |
| 3 | `chat/create-ai-chat.cy.ts` | `chat/create-ai-chat.spec.ts` | Pending |
| 4 | `chat/model-selection-persistence.cy.ts` | `chat/model-selection-persistence.spec.ts` | Pending |
| 5 | `chat/selection-mode.cy.ts` | `chat/selection-mode.spec.ts` | Pending |

### 6. Database Tests (28 files)

| # | Cypress Test File | Playwright Target | Status |
|---|------------------|-------------------|--------|
| 1 | `database/ai-field-generate.cy.ts` | `database/ai-field-generate.spec.ts` | Pending |
| 2 | `database/board-edit-operations.cy.ts` | `database/board-edit-operations.spec.ts` | Pending |
| 3 | `database/board-scroll-stability.cy.ts` | `database/board-scroll-stability.spec.ts` | Pending |
| 4 | `database/calendar-edit-operations.cy.ts` | `database/calendar-edit-operations.spec.ts` | Pending |
| 5 | `database/database-container-open.cy.ts` | `database/database-container-open.spec.ts` | Pending |
| 6 | `database/database-duplicate-cloud.cy.ts` | `database/database-duplicate-cloud.spec.ts` | Pending |
| 7 | `database/database-file-upload.cy.ts` | `database/database-file-upload.spec.ts` | Pending |
| 8 | `database/database-view-consistency.cy.ts` | `database/database-view-consistency.spec.ts` | Pending |
| 9 | `database/database-view-delete.cy.ts` | `database/database-view-delete.spec.ts` | Pending |
| 10 | `database/database-view-tabs.cy.ts` | `database/database-view-tabs.spec.ts` | Pending |
| 11 | `database/field-type-checkbox.cy.ts` | `database/field-type-checkbox.spec.ts` | Pending |
| 12 | `database/field-type-checklist.cy.ts` | `database/field-type-checklist.spec.ts` | Pending |
| 13 | `database/field-type-datetime.cy.ts` | `database/field-type-datetime.spec.ts` | Pending |
| 14 | `database/field-type-select.cy.ts` | `database/field-type-select.spec.ts` | Pending |
| 15 | `database/field-type-time.cy.ts` | `database/field-type-time.spec.ts` | Pending |
| 16 | `database/grid-edit-operations.cy.ts` | `database/grid-edit-operations.spec.ts` | Pending |
| 17 | `database/grid-scroll-stability.cy.ts` | `database/grid-scroll-stability.spec.ts` | Pending |
| 18 | `database/person-cell-publish.cy.ts` | `database/person-cell-publish.spec.ts` | Pending |
| 19 | `database/person-cell.cy.ts` | `database/person-cell.spec.ts` | Pending |
| 20 | `database/relation-cell.cy.ts` | `database/relation-cell.spec.ts` | Pending |
| 21 | `database/rollup-cell.cy.ts` | `database/rollup-cell.spec.ts` | Pending |
| 22 | `database/row-comment.cy.ts` | `database/row-comment.spec.ts` | Pending |
| 23 | `database/row-detail.cy.ts` | `database/row-detail.spec.ts` | Pending |
| 24 | `database/row-document.cy.ts` | `database/row-document.spec.ts` | Pending |
| 25 | `database/row-operations.cy.ts` | `database/row-operations.spec.ts` | Pending |
| 26 | `database/single-select-column.cy.ts` | `database/single-select-column.spec.ts` | Pending |
| 27 | `database/sort-regression.cy.ts` | `database/sort-regression.spec.ts` | Pending |
| 28 | `database/sort.cy.ts` | `database/sort.spec.ts` | Pending |

### 7. Database2 Tests - Filters (6 files)

| # | Cypress Test File | Playwright Target | Status |
|---|------------------|-------------------|--------|
| 1 | `database2/filter-advanced.cy.ts` | `database2/filter-advanced.spec.ts` | Pending |
| 2 | `database2/filter-checkbox.cy.ts` | `database2/filter-checkbox.spec.ts` | Pending |
| 3 | `database2/filter-date.cy.ts` | `database2/filter-date.spec.ts` | Pending |
| 4 | `database2/filter-number.cy.ts` | `database2/filter-number.spec.ts` | Pending |
| 5 | `database2/filter-select.cy.ts` | `database2/filter-select.spec.ts` | Pending |
| 6 | `database2/filter-text.cy.ts` | `database2/filter-text.spec.ts` | Pending |

### 8. Database3 Tests (1 file)

| # | Cypress Test File | Playwright Target | Status |
|---|------------------|-------------------|--------|
| 1 | `database3/field-type-switch.cy.ts` | `database3/field-type-switch.spec.ts` | Pending |

### 9. Editor Tests (16 files)

| # | Cypress Test File | Playwright Target | Status |
|---|------------------|-------------------|--------|
| 1 | `editor/advanced/editor_advanced.cy.ts` | `editor/advanced/editor-advanced.spec.ts` | Pending |
| 2 | `editor/basic/panel_selection.cy.ts` | `editor/basic/panel-selection.spec.ts` | Pending |
| 3 | `editor/basic/text_editing.cy.ts` | `editor/basic/text-editing.spec.ts` | Pending |
| 4 | `editor/blocks/merge.cy.ts` | `editor/blocks/merge.spec.ts` | Pending |
| 5 | `editor/blocks/unsupported_block.cy.ts` | `editor/blocks/unsupported-block.spec.ts` | Pending |
| 6 | `editor/collaboration/tab_sync.cy.ts` | `editor/collaboration/tab-sync.spec.ts` | Pending |
| 7 | `editor/commands/editor_commands.cy.ts` | `editor/commands/editor-commands.spec.ts` | Pending |
| 8 | `editor/context/editor-panel-stability.cy.ts` | `editor/context/editor-panel-stability.spec.ts` | Pending |
| 9 | `editor/cursor/editor_interaction.cy.ts` | `editor/cursor/editor-interaction.spec.ts` | Pending |
| 10 | `editor/drag_drop_blocks.cy.ts` | `editor/drag-drop-blocks.spec.ts` | Pending |
| 11 | `editor/formatting/markdown-shortcuts.cy.ts` | `editor/formatting/markdown-shortcuts.spec.ts` | Pending |
| 12 | `editor/formatting/slash-menu-formatting.cy.ts` | `editor/formatting/slash-menu-formatting.spec.ts` | Pending |
| 13 | `editor/formatting/text_styling.cy.ts` | `editor/formatting/text-styling.spec.ts` | Pending |
| 14 | `editor/lists/editor_lists.cy.ts` | `editor/lists/editor-lists.spec.ts` | Pending |
| 15 | `editor/toolbar/editor_toolbar.cy.ts` | `editor/toolbar/editor-toolbar.spec.ts` | Pending |
| 16 | `editor/version-history.cy.ts` | `editor/version-history.spec.ts` | Pending |

### 10. Embedded Tests (13 files)

| # | Cypress Test File | Playwright Target | Status |
|---|------------------|-------------------|--------|
| 1 | `embeded/database/database-bottom-scroll-simple.cy.ts` | `embeded/database/database-bottom-scroll-simple.spec.ts` | Pending |
| 2 | `embeded/database/database-bottom-scroll.cy.ts` | `embeded/database/database-bottom-scroll.spec.ts` | Pending |
| 3 | `embeded/database/database-conditions.cy.ts` | `embeded/database/database-conditions.spec.ts` | Pending |
| 4 | `embeded/database/database-container-embedded-create-delete.cy.ts` | `embeded/database/database-container-embedded-create-delete.spec.ts` | Pending |
| 5 | `embeded/database/database-container-link-existing.cy.ts` | `embeded/database/database-container-link-existing.spec.ts` | Pending |
| 6 | `embeded/database/embedded-database.cy.ts` | `embeded/database/embedded-database.spec.ts` | Pending |
| 7 | `embeded/database/embedded-view-isolation.cy.ts` | `embeded/database/embedded-view-isolation.spec.ts` | Pending |
| 8 | `embeded/database/legacy-database-slash-menu.cy.ts` | `embeded/database/legacy-database-slash-menu.spec.ts` | Pending |
| 9 | `embeded/database/linked-database-plus-button.cy.ts` | `embeded/database/linked-database-plus-button.spec.ts` | Pending |
| 10 | `embeded/database/linked-database-slash-menu.cy.ts` | `embeded/database/linked-database-slash-menu.spec.ts` | Pending |
| 11 | `embeded/image/copy_image.cy.ts` | `embeded/image/copy-image.spec.ts` | Pending |
| 12 | `embeded/image/download_image.cy.ts` | `embeded/image/download-image.spec.ts` | Pending |
| 13 | `embeded/image/image_toolbar_hover.cy.ts` | `embeded/image/image-toolbar-hover.spec.ts` | Pending |

### 11. Folder Tests (2 files)

| # | Cypress Test File | Playwright Target | Status |
|---|------------------|-------------------|--------|
| 1 | `folder/folder-permission.cy.ts` | `folder/folder-permission.spec.ts` | Pending |
| 2 | `folder/sidebar-add-page-no-collapse.cy.ts` | `folder/sidebar-add-page-no-collapse.spec.ts` | Pending |

### 12. Page Tests (20 files)

| # | Cypress Test File | Playwright Target | Status |
|---|------------------|-------------------|--------|
| 1 | `page/breadcrumb-navigation.cy.ts` | `page/breadcrumb-navigation.spec.ts` | Pending |
| 2 | `page/create-delete-page.cy.ts` | `page/create-delete-page.spec.ts` | Pending |
| 3 | `page/cross-tab-sync.cy.ts` | `page/cross-tab-sync.spec.ts` | Pending |
| 4 | `page/delete-page-verify-trash.cy.ts` | `page/delete-page-verify-trash.spec.ts` | Pending |
| 5 | `page/document-sidebar-refresh.cy.ts` | `page/document-sidebar-refresh.spec.ts` | Pending |
| 6 | `page/duplicate-page.cy.ts` | `page/duplicate-page.spec.ts` | Pending |
| 7 | `page/edit-page.cy.ts` | `page/edit-page.spec.ts` | Pending |
| 8 | `page/more-page-action.cy.ts` | `page/more-page-action.spec.ts` | Pending |
| 9 | `page/move-page-restrictions.cy.ts` | `page/move-page-restrictions.spec.ts` | Pending |
| 10 | `page/publish-manage.cy.ts` | `page/publish-manage.spec.ts` | Pending |
| 11 | `page/publish-page.cy.ts` | `page/publish-page.spec.ts` | Pending |
| 12 | `page/share-page.cy.ts` | `page/share-page.spec.ts` | Pending |
| 13 | `page/template-duplication.cy.ts` | `page/template-duplication.spec.ts` | Pending |
| 14 | `page/paste/paste-code.cy.ts` | `page/paste/paste-code.spec.ts` | Pending |
| 15 | `page/paste/paste-complex.cy.ts` | `page/paste/paste-complex.spec.ts` | Pending |
| 16 | `page/paste/paste-formatting.cy.ts` | `page/paste/paste-formatting.spec.ts` | Pending |
| 17 | `page/paste/paste-headings.cy.ts` | `page/paste/paste-headings.spec.ts` | Pending |
| 18 | `page/paste/paste-lists.cy.ts` | `page/paste/paste-lists.spec.ts` | Pending |
| 19 | `page/paste/paste-plain-text.cy.ts` | `page/paste/paste-plain-text.spec.ts` | Pending |
| 20 | `page/paste/paste-tables.cy.ts` | `page/paste/paste-tables.spec.ts` | Pending |

### 13. Space Tests (1 file)

| # | Cypress Test File | Playwright Target | Status |
|---|------------------|-------------------|--------|
| 1 | `space/create-space.cy.ts` | `space/create-space.spec.ts` | Pending |

### 14. User Tests (1 file)

| # | Cypress Test File | Playwright Target | Status |
|---|------------------|-------------------|--------|
| 1 | `user/user.cy.ts` | `user/user.spec.ts` | Pending |

### 15. Component Tests (2 files)

| # | Cypress Test File | Playwright Target | Status |
|---|------------------|-------------------|--------|
| 1 | `components/dummy.cy.tsx` | `components/dummy.spec.ts` | Pending |
| 2 | `components/MathEquation.cy.tsx` | `components/MathEquation.spec.ts` | Pending |

---

## Migration Status Tracker

### Summary

| Category | Total | Migrated | In Progress | Pending |
|----------|-------|----------|-------------|---------|
| Support Infrastructure | 33 | 0 | 0 | 33 |
| Fixtures | 20 | 0 | 0 | 20 |
| Account Tests | 9 | 0 | 0 | 9 |
| App Tests | 10 | 0 | 0 | 10 |
| Auth Tests | 5 | 0 | 0 | 5 |
| Calendar Tests | 3 | 0 | 0 | 3 |
| Chat Tests | 5 | 0 | 0 | 5 |
| Database Tests | 28 | 0 | 0 | 28 |
| Database2 Tests | 6 | 0 | 0 | 6 |
| Database3 Tests | 1 | 0 | 0 | 1 |
| Editor Tests | 16 | 0 | 0 | 16 |
| Embedded Tests | 13 | 0 | 0 | 13 |
| Folder Tests | 2 | 0 | 0 | 2 |
| Page Tests | 20 | 0 | 0 | 20 |
| Space Tests | 1 | 0 | 0 | 1 |
| User Tests | 1 | 0 | 0 | 1 |
| Component Tests | 2 | 0 | 0 | 2 |
| **TOTAL** | **175** | **0** | **0** | **175** |

### Recommended Migration Order

**Phase 1: Foundation (P0)**
1. Playwright config (`playwright.config.ts`)
2. Core support files: `test-config.ts`, `auth-utils.ts`, `selectors.ts`, `commands.ts`
3. Global setup: `e2e.ts` equivalent
4. `page-utils.ts`, `api-utils.ts`
5. Copy all fixtures

**Phase 2: Auth & Basic Flows (P0)**
6. Auth tests (5 files) - validates the auth infrastructure works
7. Page tests (20 files) - core CRUD operations
8. User tests (1 file)

**Phase 3: Core Features (P1)**
9. App tests (10 files)
10. Folder tests (2 files)
11. Space tests (1 file)
12. Editor tests (16 files)

**Phase 4: Database (P1)**
13. Database tests (28 files)
14. Database2 filter tests (6 files)
15. Database3 tests (1 file)
16. Embedded database tests (13 files)

**Phase 5: Specialized (P2)**
17. Calendar tests (3 files)
18. Chat tests (5 files)
19. Account/Avatar tests (9 files)
20. Component tests (2 files)

---

## Cypress Plugin Equivalents in Playwright

| Cypress Plugin | Playwright Equivalent |
|---------------|----------------------|
| `cypress-file-upload` | Built-in: `locator.setInputFiles()` |
| `cypress-real-events` | Built-in: all Playwright events are real |
| `@4tw/cypress-drag-drop` | Built-in: `locator.dragTo()` |
| `cypress-plugin-api` | Built-in: `APIRequestContext` |
| `cypress-image-snapshot` | Built-in: `expect(page).toHaveScreenshot()` |
| `@cypress/code-coverage` | Use `istanbul` / `nyc` separately or Playwright coverage API |

---

## Configuration Mapping

### cypress.config.ts -> playwright.config.ts

```typescript
// Key mappings:
// chromeWebSecurity: false     -> bypassCSP: true (in use options)
// baseUrl                      -> use.baseURL
// viewportWidth/Height         -> use.viewport: { width, height }
// video: false                 -> use.video: 'off'
// defaultCommandTimeout        -> use.actionTimeout / expect.timeout
// requestTimeout               -> use.navigationTimeout (partially)
// retries: { runMode: 2 }      -> retries: 2
// supportFile                  -> No equivalent; use fixtures/global setup
// specPattern                  -> testDir + testMatch
```

---

## Environment Variables

| Variable | Used In | Notes |
|----------|---------|-------|
| `APPFLOWY_BASE_URL` | API calls | Default: `http://localhost` |
| `APPFLOWY_GOTRUE_BASE_URL` | Auth | Default: `http://localhost/gotrue` |
| `APPFLOWY_WS_BASE_URL` | WebSocket | Default: `ws://localhost/ws/v2` |
| `APPFLOWY_ENABLE_RELATION_ROLLUP_EDIT` | Feature flag | Default: `false` |
| `GOTRUE_ADMIN_EMAIL` | Auth admin | Default: `admin@example.com` |
| `GOTRUE_ADMIN_PASSWORD` | Auth admin | Default: `password` |
| `CYPRESS_BASE_URL` -> `BASE_URL` | Web app URL | Default: `http://localhost:3000` |
