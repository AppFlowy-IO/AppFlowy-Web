import { TestTool } from '../../support/page-utils';
import { PageSelectors, SidebarSelectors } from '../../support/selectors';
import { TestConfig, logTestEnvironment } from '../../support/test-config';
import { setupCommonExceptionHandlers } from '../../support/exception-handlers';

const { baseUrl, gotrueUrl, apiUrl } = TestConfig;

const STUBBED_MESSAGE_ID = 101;
const STUBBED_MESSAGE_CONTENT = 'Stubbed AI answer ready for export';

function setupChatApiStubs() {
    cy.intercept('GET', '**/api/chat/**/message**', {
        statusCode: 200,
        body: {
            code: 0,
            data: {
                messages: [
                    {
                        message_id: STUBBED_MESSAGE_ID,
                        author: {
                            author_type: 3,
                            author_uuid: 'assistant',
                        },
                        content: STUBBED_MESSAGE_CONTENT,
                        created_at: new Date().toISOString(),
                        meta_data: [],
                    },
                ],
                has_more: false,
                total: 1,
            },
            message: 'success',
        },
    }).as('getChatMessages');

    cy.intercept('GET', '**/api/chat/**/settings**', {
        statusCode: 200,
        body: {
            code: 0,
            data: {
                rag_ids: [],
                metadata: {
                    ai_model: 'Auto',
                },
            },
            message: 'success',
        },
    }).as('getChatSettings');

    cy.intercept('PATCH', '**/api/chat/**/settings**', {
        statusCode: 200,
        body: {
            code: 0,
            message: 'success',
        },
    }).as('updateChatSettings');

    cy.intercept('GET', '**/api/ai/**/model/list**', {
        statusCode: 200,
        body: {
            code: 0,
            data: {
                models: [
                    {
                        name: 'Auto',
                        metadata: { is_default: true, desc: 'Automatically select an AI model' },
                    },
                    {
                        name: 'E2E Test Model',
                        provider: 'Test Provider',
                        metadata: { is_default: false, desc: 'Stubbed model for testing' },
                    },
                ],
            },
            message: 'success',
        },
    }).as('getModelList');

    cy.intercept('GET', '**/api/chat/**/**/related_question**', {
        statusCode: 200,
        body: {
            code: 0,
            data: {
                message_id: `${STUBBED_MESSAGE_ID}`,
                items: [],
            },
            message: 'success',
        },
    }).as('getRelatedQuestions');
}

describe('Chat Selection Mode Tests', () => {
    let testEmail: string;

    before(() => {
        logTestEnvironment();
    });

    beforeEach(() => {
        setupCommonExceptionHandlers();
        setupChatApiStubs();
    });

    it('enables message selection mode and toggles message selection', () => {
        cy.loginTestUser().then((email) => {
            testEmail = email;

            TestTool.expandSpace();
            cy.wait(1000);

            PageSelectors.items()
                .first()
                .as('firstSidebarPage');

            cy.get('@firstSidebarPage')
                .trigger('mouseenter', { force: true })
                .trigger('mouseover', { force: true });

            cy.wait(1000);

            cy.get('[data-testid="inline-add-page"]').first().click({ force: true });

            cy.get('[data-testid="add-ai-chat-button"]').should('be.visible').click();

            cy.wait('@getChatSettings');
            cy.wait('@getModelList');
            cy.wait('@getChatMessages');

            cy.contains(STUBBED_MESSAGE_CONTENT).should('be.visible');

            cy.get('[data-testid="page-more-actions"]').first().click({ force: true });

            cy.get('[role="menu"]').should('exist');

            cy.contains('[role="menuitem"]', 'Add messages to page')
                .should('exist')
                .click({ force: true });

            cy.get('.chat-selections-banner', { timeout: 10000 })
                .should('be.visible')
                .and('contain.text', 'Select messages');

            cy.get(`[data-message-id="${STUBBED_MESSAGE_ID}"]`).as('firstMessage');

            cy.get('@firstMessage')
                .find('button.w-4.h-4')
                .first()
                .click();

            cy.get('@firstMessage')
                .find('svg.text-primary')
                .should('exist');

            cy.get('.chat-selections-banner').should('contain.text', '1 selected');

            cy.get('.chat-selections-banner')
                .find('button')
                .last()
                .click({ force: true });

            cy.get('.chat-selections-banner').should('not.exist');
            cy.get('@firstMessage')
                .find('button.w-4.h-4')
                .should('not.exist');
        });
    });
});
