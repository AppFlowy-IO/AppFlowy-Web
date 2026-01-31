import { testLog } from './test-helpers';
/**
 * Main export file for Cypress E2E test utilities
 * This file aggregates and re-exports all utility functions used in tests
 * 
 * Usage Statistics (as of cleanup):
 * - Total functions exported: 19 (down from 73)
 * - Functions removed: 54 (74% reduction)
 * - Test coverage: All exported functions are actively used in tests
 */

// Import selectors for use in utility functions
import { PageSelectors } from './selectors';

// Flow utilities - High-level test orchestration
import {
    waitForPageLoad,
    waitForSidebarReady,
    createPageAndAddContent,
    openPageFromSidebar,
    expandSpace,
    expandSpaceByName
} from './page/flows';

// Page management utilities
import {
    getPageByName,
    getPageTitleInput,
    savePageTitle
} from './page/pages';

// Share and publish utilities
import {
    publishCurrentPage,
    readPublishUrlFromPanel,
    verifyPublishedContentMatches,
    unpublishCurrentPageAndVerify,
    unpublishFromSettingsAndVerify
} from './page/share-publish';

// Workspace utilities
import {
    openWorkspaceDropdown,
    getWorkspaceItems,
    getWorkspaceMemberCounts
} from './page/workspace';

// Modal utilities
import {
    openSharePopover
} from './page/modal';

// Page action utilities
import {
    openViewActionsPopoverForPage,
    deletePageByName
} from './page/page-actions';

// Re-export all functions
export {
    waitForPageLoad,
    waitForSidebarReady,
    createPageAndAddContent,
    openPageFromSidebar,
    expandSpace,
    expandSpaceByName,
    getPageByName,
    getPageTitleInput,
    savePageTitle,
    publishCurrentPage,
    readPublishUrlFromPanel,
    verifyPublishedContentMatches,
    unpublishCurrentPageAndVerify,
    unpublishFromSettingsAndVerify,
    openWorkspaceDropdown,
    getWorkspaceItems,
    getWorkspaceMemberCounts,
    openSharePopover,
    openViewActionsPopoverForPage,
    deletePageByName
};

/**
 * TestTool class - Main interface for test utilities
 * Provides static methods for all test operations
 */
export class TestTool {
    // Flow operations  
    static waitForPageLoad(waitTime?: number) {
        return waitForPageLoad(waitTime);
    }
    static waitForSidebarReady(timeout?: number) {
        return waitForSidebarReady(timeout);
    }
    static createPageAndAddContent(pageName: string, content: string[]) {
        return createPageAndAddContent(pageName, content);
    }
    static openPageFromSidebar(pageName: string) {
        return openPageFromSidebar(pageName);
    }
    static expandSpace(spaceIndex?: number) {
        return expandSpace(spaceIndex);
    }
    static expandSpaceByName(spaceName: string) {
        return expandSpaceByName(spaceName);
    }

    // Page management
    static getPageByName(pageName: string) {
        return getPageByName(pageName);
    }
    static getPageTitleInput() {
        return getPageTitleInput();
    }
    static savePageTitle() {
        return savePageTitle();
    }
    
    // Share and publish
    static publishCurrentPage() {
        return publishCurrentPage();
    }
    static readPublishUrlFromPanel() {
        return readPublishUrlFromPanel();
    }
    static verifyPublishedContentMatches(expectedContent: string[]) {
        return verifyPublishedContentMatches(expectedContent);
    }
    static unpublishCurrentPageAndVerify(publishUrl: string) {
        return unpublishCurrentPageAndVerify(publishUrl);
    }
    static unpublishFromSettingsAndVerify(publishUrl: string, pageName?: string, pageContent?: string) {
        return unpublishFromSettingsAndVerify(publishUrl, pageName, pageContent);
    }
    
    // Workspace operations
    static openWorkspaceDropdown() {
        return openWorkspaceDropdown();
    }
    static getWorkspaceItems() {
        return getWorkspaceItems();
    }
    static getWorkspaceMemberCounts() {
        return getWorkspaceMemberCounts();
    }
    
    // Modal operations
    static openSharePopover() {
        return openSharePopover();
    }
    
    // Page actions
    static openViewActionsPopoverForPage(pageName: string) {
        return openViewActionsPopoverForPage(pageName);
    }
    static deletePageByName(pageName: string) {
        return deletePageByName(pageName);
    }
    
    // Additional custom methods used in tests
    
    /**
     * Verifies that a page exists in the sidebar
     * Used in create-delete-page.cy.ts
     */
    static verifyPageExists(pageName: string) {
        testLog.info( `Verifying page exists: ${pageName}`);
        PageSelectors.nameContaining(pageName)
            .should('exist')
            .should('be.visible');
    }
    
    /**
     * Verifies that a page does not exist in the sidebar
     * Used in create-delete-page.cy.ts
     */
    static verifyPageNotExists(pageName: string) {
        testLog.info( `Verifying page does not exist: ${pageName}`);
        PageSelectors.nameContaining(pageName)
            .should('not.exist');
    }
}

// Export all individual functions for convenience
export default TestTool;
