import { SidebarSelectors, WorkspaceSelectors } from '../../support/selectors';
import { generateRandomEmail } from '../../support/test-config';
import enTranslations from '../../../src/@types/translations/en.json';

const UPGRADE_MENU_LABEL = enTranslations.subscribe?.changePlan ?? 'Upgrade to Pro Plan';

describe('Workspace Upgrade Entry', () => {
    let testEmail: string;

    beforeEach(() => {
        testEmail = generateRandomEmail();

        cy.on('uncaught:exception', (err: Error) => {
            if (
                err.message.includes('No workspace or service found') ||
                err.message.includes('View not found') ||
                err.message.includes('WebSocket') ||
                err.message.includes('connection') ||
                err.message.includes('Failed to load models') ||
                err.message.includes('Minified React error') ||
                err.message.includes('ResizeObserver loop') ||
                err.message.includes('Non-Error promise rejection')
            ) {
                return false;
            }
            return true;
        });
    });

    it('shows Upgrade to Pro Plan for workspace owners', function () {
        cy.signIn(testEmail).then(() => {
            cy.url().should('include', '/app');

            SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });

            WorkspaceSelectors.dropdownTrigger().should('be.visible', { timeout: 30000 }).click();

            WorkspaceSelectors.dropdownContent()
                .should('be.visible', { timeout: 10000 })
                .within(() => {
                    // Prove the workspace menu actually opened by checking additional menu items
                    cy.contains('Create workspace').should('be.visible');
                    cy.contains(UPGRADE_MENU_LABEL).should('be.visible');
                });

            cy.screenshot('workspace-upgrade-menu');
        });
    });
});
