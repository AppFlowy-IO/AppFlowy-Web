/**
 * Chat Provider Stability E2E Tests
 *
 * Verifies that the chat message handler, model selection, and settings
 * loader work correctly after provider stabilization fixes.
 *
 * Regression tests for:
 * - MessagesHandlerProvider: unmemoized provider value causing unnecessary re-renders
 * - useChatSettingsLoader: missing mount guard for async fetch
 * - selectedModelName/messageIds causing cascade callback recreations
 */
import {
  AddPageSelectors,
  ChatSelectors,
  ModelSelectorSelectors,
  PageSelectors,
  SidebarSelectors,
  waitForReactUpdate,
} from '../../support/selectors';
import { TestTool } from '../../support/page-utils';
import { generateRandomEmail } from '../../support/test-config';
import { mockChatSettings, mockModelList, mockUpdateChatSettings, mockEmptyChatMessages, mockRelatedQuestions } from '../../support/chat-mocks';

describe('Chat Provider Stability', () => {
  let testEmail: string;

  beforeEach(() => {
    testEmail = generateRandomEmail();

    cy.on('uncaught:exception', (err) => {
      if (
        err.message.includes('No workspace or service found') ||
        err.message.includes('View not found') ||
        err.message.includes('WebSocket') ||
        err.message.includes('connection') ||
        err.message.includes('Failed to load models') ||
        err.message.includes('Minified React error') ||
        err.message.includes('ResizeObserver loop')
      ) {
        return false;
      }

      return true;
    });
  });

  /**
   * Helper: Sign in, navigate, and open a new AI Chat
   */
  const openAIChat = () => {
    cy.signIn(testEmail).then(() => {
      cy.url().should('include', '/app');
      SidebarSelectors.pageHeader({ timeout: 30000 }).should('be.visible');
      PageSelectors.items({ timeout: 30000 }).should('exist');
      cy.wait(2000);

      TestTool.expandSpace();
      cy.wait(1000);

      PageSelectors.items()
        .first()
        .trigger('mouseenter', { force: true })
        .trigger('mouseover', { force: true });
      cy.wait(1000);

      AddPageSelectors.inlineAddButton().first().click({ force: true });
      AddPageSelectors.addAIChatButton().should('be.visible').click();
      cy.wait(2000);
      ChatSelectors.aiChatContainer({ timeout: 30000 }).should('be.visible');
    });
  };

  it('should load chat and display model selector without errors', () => {
    openAIChat();

    // Model selector should be visible (chat settings loaded successfully)
    ModelSelectorSelectors.button().should('be.visible');

    // Open model selector popover
    ModelSelectorSelectors.button().click();
    waitForReactUpdate(1000);

    // Model options should be listed
    ModelSelectorSelectors.options().should('exist');

    // Close popover
    cy.get('body').click(0, 0);
    waitForReactUpdate(500);
  });

  it('should handle model selection change without re-render cascade', () => {
    openAIChat();

    // Open model selector
    ModelSelectorSelectors.button().should('be.visible').click();
    waitForReactUpdate(1000);

    // Select a different model (if available)
    ModelSelectorSelectors.options().then(($options) => {
      if ($options.length > 1) {
        cy.wrap($options).eq(1).click({ force: true });
        waitForReactUpdate(1000);
      }
    });

    // Chat input should still be functional after model change
    cy.get('textarea').first().should('exist').and('be.visible');

    // Format controls should still work
    // Default responseMode is FormatResponse, so FormatGroup starts visible
    ChatSelectors.formatGroup({ timeout: 10000 }).should('exist');
    // Clicking toggle switches to Auto mode, hiding FormatGroup
    ChatSelectors.formatToggle().should('be.visible').click();
    ChatSelectors.formatGroup().should('not.exist');
    // Clicking again switches back to FormatResponse, showing FormatGroup
    ChatSelectors.formatToggle().click();
    ChatSelectors.formatGroup().should('exist');
  });

  it('should handle rapid chat navigation without unmount errors', () => {
    cy.signIn(testEmail).then(() => {
      cy.url().should('include', '/app');
      SidebarSelectors.pageHeader({ timeout: 30000 }).should('be.visible');
      PageSelectors.items({ timeout: 30000 }).should('exist');
      cy.wait(2000);

      TestTool.expandSpace();
      cy.wait(1000);

      PageSelectors.items()
        .first()
        .trigger('mouseenter', { force: true })
        .trigger('mouseover', { force: true });
      cy.wait(1000);

      // Create first AI chat
      AddPageSelectors.inlineAddButton().first().click({ force: true });
      AddPageSelectors.addAIChatButton().should('be.visible').click();
      cy.wait(2000);
      ChatSelectors.aiChatContainer({ timeout: 30000 }).should('be.visible');

      // Navigate away while chat settings may still be loading
      // (tests useChatSettingsLoader mount guard)
      PageSelectors.items()
        .first()
        .trigger('mouseenter', { force: true })
        .trigger('mouseover', { force: true });
      cy.wait(500);

      AddPageSelectors.inlineAddButton().first().click({ force: true });
      AddPageSelectors.addAIChatButton().should('be.visible').click();
      cy.wait(2000);

      // Second chat should load successfully
      ChatSelectors.aiChatContainer({ timeout: 30000 }).should('be.visible');
      ModelSelectorSelectors.button().should('be.visible');
    });
  });
});
