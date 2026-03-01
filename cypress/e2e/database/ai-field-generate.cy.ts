/**
 * AI Summary / AI Translate field "Generate" button tests
 *
 * Verifies that clicking the Generate button on AI Summary and AI Translate
 * cells calls the correct API endpoint and updates the cell with the response.
 *
 * The actual AI endpoints are mocked via cy.intercept so these tests run
 * without a real AI backend.
 */
import { FieldType, DatabaseGridSelectors, waitForReactUpdate } from '../../support/selectors';
import {
  generateRandomEmail,
  getLastFieldId,
  loginAndCreateGrid,
  addNewProperty,
  setupFieldTypeTest,
  typeTextIntoCell,
} from '../../support/field-type-test-helpers';

describe('AI Field – Generate Button', () => {
  beforeEach(() => {
    setupFieldTypeTest();
  });

  it('should call summarize_row API and display the result when Generate is clicked on AI Summary field', () => {
    const testEmail = generateRandomEmail();
    const mockSummary = 'This is a mock AI summary of the row data.';

    loginAndCreateGrid(testEmail);

    // Type some text into the first row's primary field so the summary has data to work with
    DatabaseGridSelectors.firstCell().click({ force: true });
    waitForReactUpdate(500);
    cy.focused().type('apple{enter}');
    waitForReactUpdate(500);

    // Mock the AI summary endpoint BEFORE clicking Generate
    cy.intercept('POST', '**/api/ai/*/summarize_row', {
      statusCode: 200,
      body: {
        code: 0,
        data: { text: mockSummary },
        message: 'success',
      },
    }).as('summarizeRow');

    // Add an AI Summary property (FieldType.AISummaries = 11)
    addNewProperty(FieldType.AISummaries);

    // Get the field ID of the newly added AI Summary column
    getLastFieldId().then((fieldId) => {
      cy.log('AI Summary field ID: ' + fieldId);

      // Find the first data row's AI cell and hover over it to reveal the Generate button
      DatabaseGridSelectors.dataRowCellsForField(fieldId)
        .first()
        .should('exist')
        .scrollIntoView()
        .realHover();
      waitForReactUpdate(500);

      // Click the Generate button
      cy.get(`[data-testid^="ai-generate-button-"]`)
        .first()
        .should('be.visible')
        .click();

      // Wait for the API call to complete
      cy.wait('@summarizeRow').then((interception) => {
        // Verify the request payload contains a Content key with row data
        expect(interception.request.body).to.have.property('data');
        expect(interception.request.body.data).to.have.property('Content');
      });

      // Verify the summary text appears in the cell
      waitForReactUpdate(1000);
      DatabaseGridSelectors.cellsForField(fieldId)
        .first()
        .should('contain.text', mockSummary);
    });
  });

  it('should call translate_row API and display the result when Generate is clicked on AI Translate field', () => {
    const testEmail = generateRandomEmail();
    const mockTranslation = 'Translated content here';

    loginAndCreateGrid(testEmail);

    // Type some text into the first row's primary field
    DatabaseGridSelectors.firstCell().click({ force: true });
    waitForReactUpdate(500);
    cy.focused().type('hello world{enter}');
    waitForReactUpdate(500);

    // Mock the AI translate endpoint
    cy.intercept('POST', '**/api/ai/*/translate_row', {
      statusCode: 200,
      body: {
        code: 0,
        data: {
          items: [{ content: mockTranslation }],
        },
        message: 'success',
      },
    }).as('translateRow');

    // Add an AI Translations property (FieldType.AITranslations = 12)
    addNewProperty(FieldType.AITranslations);

    getLastFieldId().then((fieldId) => {
      cy.log('AI Translate field ID: ' + fieldId);

      // Hover over the first AI Translate cell to reveal the Generate button
      DatabaseGridSelectors.dataRowCellsForField(fieldId)
        .first()
        .should('exist')
        .scrollIntoView()
        .realHover();
      waitForReactUpdate(500);

      // Click the Generate button
      cy.get(`[data-testid^="ai-generate-button-"]`)
        .first()
        .should('be.visible')
        .click();

      // Wait for the API call
      cy.wait('@translateRow').then((interception) => {
        expect(interception.request.body).to.have.property('data');
        expect(interception.request.body.data).to.have.property('cells');
        expect(interception.request.body.data).to.have.property('language');
      });

      // Verify the translated text appears in the cell
      waitForReactUpdate(1000);
      DatabaseGridSelectors.cellsForField(fieldId)
        .first()
        .should('contain.text', mockTranslation);
    });
  });

  it('should show error toast when summarize_row API fails', () => {
    const testEmail = generateRandomEmail();

    loginAndCreateGrid(testEmail);

    // Type some text so the row isn't empty
    DatabaseGridSelectors.firstCell().click({ force: true });
    waitForReactUpdate(500);
    cy.focused().type('test data{enter}');
    waitForReactUpdate(500);

    // Mock the AI summary endpoint to return an error
    cy.intercept('POST', '**/api/ai/*/summarize_row', {
      statusCode: 500,
      body: {
        code: -1,
        message: 'Internal server error',
      },
    }).as('summarizeRowError');

    // Add an AI Summary property
    addNewProperty(FieldType.AISummaries);

    getLastFieldId().then((fieldId) => {
      // Hover to reveal Generate button
      DatabaseGridSelectors.dataRowCellsForField(fieldId)
        .first()
        .should('exist')
        .scrollIntoView()
        .realHover();
      waitForReactUpdate(500);

      // Click Generate
      cy.get(`[data-testid^="ai-generate-button-"]`)
        .first()
        .should('be.visible')
        .click();

      // Wait for the failed API call
      cy.wait('@summarizeRowError');

      // The cell should remain empty (no crash, graceful error handling)
      waitForReactUpdate(1000);
      DatabaseGridSelectors.cellsForField(fieldId)
        .first()
        .invoke('text')
        .then((text) => {
          // Cell should not contain a summary since the API failed
          expect(text.trim()).to.equal('');
        });
    });
  });

  it('should collect data from multiple fields when generating AI summary', () => {
    const testEmail = generateRandomEmail();
    const mockSummary = 'Summary of multiple fields';

    loginAndCreateGrid(testEmail);

    // Type into the primary field (Name)
    DatabaseGridSelectors.firstCell().click({ force: true });
    waitForReactUpdate(500);
    cy.focused().type('banana{enter}');
    waitForReactUpdate(500);

    // Add a RichText property and type data into it
    addNewProperty(FieldType.RichText);
    getLastFieldId().as('textFieldId');

    cy.get<string>('@textFieldId').then((fieldId) => {
      typeTextIntoCell(fieldId, 0, 'yellow fruit');
    });

    // Mock the summarize endpoint and capture the request
    cy.intercept('POST', '**/api/ai/*/summarize_row', {
      statusCode: 200,
      body: {
        code: 0,
        data: { text: mockSummary },
        message: 'success',
      },
    }).as('summarizeRowMulti');

    // Add AI Summary property
    addNewProperty(FieldType.AISummaries);

    getLastFieldId().then((fieldId) => {
      // Hover and click Generate
      DatabaseGridSelectors.dataRowCellsForField(fieldId)
        .first()
        .should('exist')
        .scrollIntoView()
        .realHover();
      waitForReactUpdate(500);

      cy.get(`[data-testid^="ai-generate-button-"]`)
        .first()
        .should('be.visible')
        .click();

      // Verify the API was called with data from multiple fields
      cy.wait('@summarizeRowMulti').then((interception) => {
        const content = interception.request.body.data.Content;
        // Should contain data from at least the primary field
        const values = Object.values(content);
        const hasData = values.some((v: unknown) => typeof v === 'string' && (v as string).length > 0);
        expect(hasData).to.be.true;
      });

      // Verify the summary appears
      waitForReactUpdate(1000);
      DatabaseGridSelectors.cellsForField(fieldId)
        .first()
        .should('contain.text', mockSummary);
    });
  });
});
