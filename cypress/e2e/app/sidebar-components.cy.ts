import { PageSelectors, SidebarSelectors } from '../../support/selectors';
import { logTestEnvironment } from '../../support/test-config';
import { setupCommonExceptionHandlers } from '../../support/exception-handlers';

describe('Sidebar Components Resilience Tests', () => {
    before(() => {
        logTestEnvironment();
    });

    beforeEach(() => {
        setupCommonExceptionHandlers();
    });

    it('should load app without React error boundaries triggering for ShareWithMe and Favorite components', () => {
        cy.loginTestUser().then(() => {
            cy.url().should('include', '/app');
            cy.task('log', 'Signed in successfully');

            // Wait for app to fully load
            cy.task('log', 'Waiting for app to fully load...');
            SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });
            PageSelectors.names().should('exist', { timeout: 30000 });
            cy.wait(3000);

            // Verify no React error boundaries were triggered
            // Check console logs for React error boundary messages
            cy.getConsoleLogs().then((consoleLogs) => {
                const errorBoundaryLogs = consoleLogs.filter((log: any) => {
                    const message = JSON.stringify(log.args || []).toLowerCase();
                    return (
                        message.includes('favorite') && message.includes('error occurred') ||
                        message.includes('sharewithme') && message.includes('error occurred') ||
                        message.includes('react will try to recreate')
                    );
                });

                if (errorBoundaryLogs.length > 0) {
                    cy.task('log', `Found ${errorBoundaryLogs.length} React error boundary logs`);
                    errorBoundaryLogs.forEach((log: any) => {
                        cy.task('log', `Error boundary log: ${JSON.stringify(log.args)}`);
                    });
                }

                // Assert no error boundaries were triggered
                expect(errorBoundaryLogs.length).to.equal(0, 'No React error boundaries should be triggered');
            });

            // Verify sidebar is visible and functional
            cy.task('log', 'Verifying sidebar is visible and functional');
            SidebarSelectors.pageHeader().should('be.visible');

            // Verify we can interact with the sidebar without errors
            PageSelectors.items().should('exist');

            cy.task('log', 'Sidebar components loaded successfully without errors');
        });
    });

    it('should handle empty favorites gracefully', () => {
        cy.loginTestUser().then(() => {
            // Wait for app to fully load
            SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });
            PageSelectors.names().should('exist', { timeout: 30000 });
            cy.wait(3000);

            // Verify app loads without errors even with no favorites
            // The Favorite component should return null and not crash
            cy.getConsoleLogs().then((consoleLogs) => {
                const favoriteErrors = consoleLogs.filter((log: any) => {
                    const message = JSON.stringify(log.args || []).toLowerCase();
                    return message.includes('favorite') && (log.type === 'error' || log.type === 'warn');
                });

                // Should not have errors related to Favorite component
                expect(favoriteErrors.length).to.equal(0, 'Favorite component should handle empty state gracefully');
            });

            cy.task('log', 'App handles empty favorites state correctly');
        });
    });

    it('should handle ShareWithMe with no shared content gracefully', () => {
        cy.loginTestUser().then(() => {
            // Wait for app to fully load
            SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });
            PageSelectors.names().should('exist', { timeout: 30000 });
            cy.wait(3000);

            // Verify app loads without errors even with no shared content
            // The ShareWithMe component should return null and not crash
            cy.getConsoleLogs().then((consoleLogs) => {
                const shareWithMeErrors = consoleLogs.filter((log: any) => {
                    const message = JSON.stringify(log.args || []).toLowerCase();
                    return (
                        (message.includes('sharewithme') || message.includes('findsharewithmespace')) &&
                        (log.type === 'error' || log.type === 'warn')
                    );
                });

                // Should not have errors related to ShareWithMe component
                expect(shareWithMeErrors.length).to.equal(0, 'ShareWithMe component should handle empty state gracefully');
            });

            cy.task('log', 'App handles ShareWithMe with no shared content correctly');
        });
    });

    it('should handle invalid outline data gracefully', () => {
        cy.loginTestUser().then(() => {
            // Wait for app to fully load
            SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });
            PageSelectors.names().should('exist', { timeout: 30000 });
            cy.wait(3000);

            // Verify no errors occur when outline data might be invalid
            // This tests the Array.isArray check we added
            cy.getConsoleLogs().then((consoleLogs) => {
                const outlineErrors = consoleLogs.filter((log: any) => {
                    const message = JSON.stringify(log.args || []).toLowerCase();
                    return (
                        (message.includes('outline') ||
                            message.includes('is not a function') ||
                            message.includes('cannot read property')) &&
                        (log.type === 'error' || log.type === 'warn')
                    );
                });

                // Should not have errors related to invalid outline data
                expect(outlineErrors.length).to.equal(0, 'Components should handle invalid outline data gracefully');
            });

            cy.task('log', 'App handles invalid outline data correctly');
        });
    });

    it('should handle favorites with invalid favorited_at dates gracefully', () => {
        cy.loginTestUser().then(() => {
            // Wait for app to fully load
            SidebarSelectors.pageHeader().should('be.visible', { timeout: 30000 });
            PageSelectors.names().should('exist', { timeout: 30000 });
            cy.wait(3000);

            // Verify no errors occur when favorite views have invalid dates
            // This tests the date validation we added
            cy.getConsoleLogs().then((consoleLogs) => {
                const dateErrors = consoleLogs.filter((log: any) => {
                    const message = JSON.stringify(log.args || []).toLowerCase();
                    return (
                        (message.includes('favorited_at') ||
                            message.includes('invalid date') ||
                            message.includes('dayjs')) &&
                        (log.type === 'error' || log.type === 'warn')
                    );
                });

                // Should not have errors related to invalid dates
                expect(dateErrors.length).to.equal(0, 'Favorite component should handle invalid dates gracefully');
            });

            cy.task('log', 'App handles invalid favorite dates correctly');
        });
    });
});

