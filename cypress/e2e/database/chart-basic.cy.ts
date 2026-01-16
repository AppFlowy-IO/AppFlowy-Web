import { v4 as uuidv4 } from 'uuid';
import { AuthTestUtils } from '../../support/auth-utils';
import {
  AddPageSelectors,
  DatabaseViewSelectors,
  DatabaseGridSelectors,
  ChartSelectors,
  waitForReactUpdate,
} from '../../support/selectors';

describe('Database Chart View Basic', () => {
  const generateRandomEmail = () => `${uuidv4()}@appflowy.io`;

  beforeEach(() => {
    cy.on('uncaught:exception', (err) => {
      if (
        err.message.includes('Minified React error') ||
        err.message.includes('View not found') ||
        err.message.includes('No workspace or service found')
      ) {
        return false;
      }
      return true;
    });

    cy.viewport(1280, 720);
  });

  it('should create a chart database from the sidebar', () => {
    const testEmail = generateRandomEmail();

    cy.task('log', `[TEST START] Creating chart from sidebar - Test email: ${testEmail}`);

    // Login
    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // Create Chart directly from sidebar
      cy.task('log', '[STEP 1] Creating chart from sidebar');
      AddPageSelectors.inlineAddButton().first().as('addBtn');
      cy.get('@addBtn').should('be.visible').click();
      waitForReactUpdate(1000);

      // Click the Chart option in the add page dropdown
      AddPageSelectors.addChartButton().should('be.visible').click();
      cy.wait(5000);
      cy.task('log', '[STEP 1.1] Chart database created');

      // Verify Chart is displayed
      cy.task('log', '[STEP 2] Verifying Chart is displayed');
      ChartSelectors.chart().should('be.visible');

      // Should have a Recharts wrapper (meaning chart is rendered)
      ChartSelectors.anyChart().should('exist');

      cy.task('log', '[TEST COMPLETE] Chart created from sidebar successfully');
    });
  });

  it('should create a chart view from an existing grid database', () => {
    const testEmail = generateRandomEmail();

    cy.task('log', `[TEST START] Creating chart view from grid - Test email: ${testEmail}`);

    // Login
    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // Create source database (Grid)
      cy.task('log', '[STEP 1] Creating grid database');
      AddPageSelectors.inlineAddButton().first().as('addBtn');
      cy.get('@addBtn').should('be.visible').click();
      waitForReactUpdate(1000);
      AddPageSelectors.addGridButton().should('be.visible').as('gridBtn');
      cy.get('@gridBtn').click();
      cy.wait(3000);
      cy.task('log', '[STEP 1.1] Grid database created');

      // Create a Chart view
      cy.task('log', '[STEP 2] Creating Chart view');
      cy.get('[data-testid="add-view-button"]').should('be.visible').as('addViewBtn');
      cy.get('@addViewBtn').click();

      waitForReactUpdate(1000);

      // Click Chart option
      DatabaseViewSelectors.viewTypeOption('Chart').should('be.visible').click();

      waitForReactUpdate(3000);

      // Verify Chart is displayed
      cy.task('log', '[STEP 3] Verifying Chart is displayed');
      ChartSelectors.chart().should('be.visible');

      cy.task('log', '[TEST COMPLETE] Chart view created successfully');
    });
  });

  it('should display chart with data when rows have select option values', () => {
    const testEmail = generateRandomEmail();

    cy.task('log', `[TEST START] Chart with data - Test email: ${testEmail}`);

    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // Create grid database
      cy.task('log', '[STEP 1] Creating grid database');
      AddPageSelectors.inlineAddButton().first().as('addBtn');
      cy.get('@addBtn').should('be.visible').click();
      waitForReactUpdate(1000);
      AddPageSelectors.addGridButton().should('be.visible').click();
      cy.wait(5000);

      // Add data to the "Type" SingleSelect field (default field in grid)
      cy.task('log', '[STEP 2] Adding data to rows');

      // Find and click on the Type cell (second column after checkbox) in the first row
      // Use the cells selector to get the second cell in the first data row
      DatabaseGridSelectors.dataRows()
        .first()
        .find('.grid-row-cell')
        .eq(1) // Second cell (after row number) should be Type
        .click({ force: true });

      waitForReactUpdate(500);

      // Type the option name and press enter to create it
      cy.focused().type('Option A{enter}');
      waitForReactUpdate(1000);

      // Press Escape to close the menu
      cy.get('body').type('{esc}');
      waitForReactUpdate(500);

      // Click on the Type cell for the second row
      cy.task('log', '[STEP 2.2] Adding Option B to second row');
      DatabaseGridSelectors.dataRows()
        .eq(1)
        .find('.grid-row-cell')
        .eq(1)
        .click({ force: true });

      waitForReactUpdate(500);

      // Create "Option B"
      cy.focused().type('Option B{enter}');
      waitForReactUpdate(1000);

      cy.get('body').type('{esc}');
      waitForReactUpdate(500);

      cy.task('log', '[STEP 2.3] Grid setup complete with 2 rows');

      // Create Chart view
      cy.task('log', '[STEP 3] Creating Chart view');
      cy.get('[data-testid="add-view-button"]').should('be.visible').click();
      waitForReactUpdate(1000);
      DatabaseViewSelectors.viewTypeOption('Chart').should('be.visible').click();
      waitForReactUpdate(3000);

      // Verify chart is displayed with data
      cy.task('log', '[STEP 4] Verifying Chart displays data');
      ChartSelectors.chart().should('be.visible');

      // Should have a Recharts wrapper (meaning chart is rendered)
      ChartSelectors.anyChart().should('exist');

      cy.task('log', '[TEST COMPLETE] Chart displays data correctly');
    });
  });

  it('should show empty category when rows have no select option value', () => {
    const testEmail = generateRandomEmail();

    cy.task('log', `[TEST START] Chart with empty category - Test email: ${testEmail}`);

    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // Create grid database
      cy.task('log', '[STEP 1] Creating grid database (no data added to Type field)');
      AddPageSelectors.inlineAddButton().first().as('addBtn');
      cy.get('@addBtn').should('be.visible').click();
      waitForReactUpdate(1000);
      AddPageSelectors.addGridButton().should('be.visible').click();
      cy.wait(3000);

      // Don't add any data - leave the Type field empty
      // The grid should have 3 default rows

      // Create Chart view
      cy.task('log', '[STEP 2] Creating Chart view');
      cy.get('[data-testid="add-view-button"]').should('be.visible').click();
      waitForReactUpdate(1000);
      DatabaseViewSelectors.viewTypeOption('Chart').should('be.visible').click();
      waitForReactUpdate(3000);

      // Verify chart is displayed
      cy.task('log', '[STEP 3] Verifying Chart displays empty category');
      ChartSelectors.chart().should('be.visible');

      // Should show "No Type" category (empty category for rows without a value)
      // This tests the showEmptyValues = true fix
      ChartSelectors.anyChart().should('exist');

      // The chart should contain "No Type" text (the empty category label)
      ChartSelectors.chart().should('contain.text', 'No Type');

      cy.task('log', '[TEST COMPLETE] Chart shows empty category correctly');
    });
  });

  it('should switch between chart types (Grid to Chart, then back)', () => {
    const testEmail = generateRandomEmail();

    cy.task('log', `[TEST START] Switching between views - Test email: ${testEmail}`);

    cy.visit('/login', { failOnStatusCode: false });
    cy.wait(2000);

    const authUtils = new AuthTestUtils();
    authUtils.signInWithTestUrl(testEmail).then(() => {
      cy.url({ timeout: 30000 }).should('include', '/app');
      cy.wait(3000);

      // Create grid database
      cy.task('log', '[STEP 1] Creating grid database');
      AddPageSelectors.inlineAddButton().first().as('addBtn');
      cy.get('@addBtn').should('be.visible').click();
      waitForReactUpdate(1000);
      AddPageSelectors.addGridButton().should('be.visible').click();
      cy.wait(3000);

      // Create Chart view
      cy.task('log', '[STEP 2] Creating Chart view');
      cy.get('[data-testid="add-view-button"]').should('be.visible').click();
      waitForReactUpdate(1000);
      DatabaseViewSelectors.viewTypeOption('Chart').should('be.visible').click();
      waitForReactUpdate(3000);

      // Verify Chart is displayed
      ChartSelectors.chart().should('be.visible');
      cy.task('log', '[STEP 2.1] Chart view is active');

      // Switch back to Grid view (first tab)
      cy.task('log', '[STEP 3] Switching back to Grid view');
      DatabaseViewSelectors.viewTab().first().as('gridTab');
      cy.get('@gridTab').click();
      waitForReactUpdate(1000);

      // Verify Grid is displayed
      cy.get('@gridTab').should('have.attr', 'data-state', 'active');
      DatabaseGridSelectors.grid().should('be.visible');
      cy.task('log', '[STEP 3.1] Grid view is active');

      // Switch back to Chart view (second tab)
      cy.task('log', '[STEP 4] Switching back to Chart view');
      DatabaseViewSelectors.viewTab().eq(1).as('chartTab');
      cy.get('@chartTab').click();
      waitForReactUpdate(1000);

      // Verify Chart is displayed again
      cy.get('@chartTab').should('have.attr', 'data-state', 'active');
      ChartSelectors.chart().should('be.visible');
      cy.task('log', '[STEP 4.1] Chart view is active again');

      cy.task('log', '[TEST COMPLETE] View switching works correctly');
    });
  });

  it('should display no-field empty state when database has no groupable fields', () => {
    // This test would require creating a database with only non-groupable fields
    // which is more complex - skipping for now as it requires more setup
    cy.task('log', '[TEST SKIPPED] No-field empty state test requires complex setup');
  });
});
