/**
 * Thin re-export file for backward compatibility during migration.
 * All actual implementations have been moved to domain-specific files.
 * This file will be deleted once all APIService.xxx references are removed.
 */

// Core infrastructure
export {
  getAxiosInstance,
  initAPIService,
  getAxios,
} from './core';
export type { APIResponse, APIError } from './core';

// Auth
export {
  signInWithUrl,
  verifyToken,
  getServerInfo,
  getAuthProviders,
} from './auth-api';
export type { ServerInfo } from './auth-api';

// GoTrue re-exports (preserved from original)
export * from './gotrue';

// User
export {
  getCurrentUser,
  updateUserProfile,
  getWorkspaceMemberProfile,
  updateWorkspaceMemberProfile,
  getUserWorkspaceInfo,
} from './user-api';

// Workspace
export {
  openWorkspace,
  updateWorkspace,
  createWorkspace,
  getWorkspaces,
  getWorkspaceFolder,
  deleteWorkspace,
  leaveWorkspace,
  inviteMembers,
  getMembers,
  joinWorkspaceByInvitationCode,
  getWorkspaceInfoByInvitationCode,
  getGuestInvitation,
  acceptGuestInvitation,
  getGuestToMemberConversionInfo,
  approveTurnGuestToMember,
  getMentionableUsers,
  updatePageMention,
  addRecentPages,
  updatePublishNamespace,
} from './workspace-api';

// View
export {
  getAppOutline,
  getView,
  getViews,
  getAppFavorites,
  getAppRecent,
  getAppTrash,
  createOrphanedView,
  checkIfCollabExists,
} from './view-api';

// Page
export {
  addAppPage,
  updatePage,
  updatePageIcon,
  updatePageName,
  duplicatePage,
  deleteTrash,
  moveToTrash,
  restorePage,
  movePageTo,
  createSpace,
  updateSpace,
  createDatabaseView,
} from './page-api';

// Collab
export {
  updateCollab,
  collabFullSyncBatch,
  getCollab,
  getPageCollab,
  databaseBlobDiff,
  getCollabVersions,
  previewCollabVersion,
  createCollabVersion,
  deleteCollabVersion,
  revertCollabVersion,
} from './collab-api';

// Publish
export {
  publishView,
  unpublishView,
  getPublishViewMeta,
  getPublishViewBlob,
  getPublishView,
  updatePublishConfig,
  getPublishInfoWithViewId,
  getPublishNamespace,
  getPublishHomepage,
  updatePublishHomepage,
  removePublishHomepage,
  getPublishOutline,
  getPublishViewComments,
  getReactions,
  createGlobalCommentOnPublishView,
  deleteGlobalCommentOnPublishView,
  addReaction,
  removeReaction,
  duplicatePublishView,
} from './publish-api';
export type { DuplicatePublishViewPayload, DuplicatePublishViewResponse } from './publish-api';

// Template
export {
  createTemplate,
  updateTemplate,
  getTemplates,
  getTemplateById,
  deleteTemplate,
  getTemplateCategories,
  addTemplateCategory,
  updateTemplateCategory,
  deleteTemplateCategory,
  getTemplateCreators,
  createTemplateCreator,
  updateTemplateCreator,
  deleteTemplateCreator,
  uploadTemplateAvatar,
} from './template-api';

// Billing
export {
  getSubscriptionLink,
  getSubscriptions,
  getActiveSubscription,
  getWorkspaceSubscriptions,
  cancelSubscription,
} from './billing-api';

// Import
export {
  createImportTask,
  uploadImportFile,
  createDatabaseCsvImportTask,
  uploadDatabaseCsvImportFile,
  getDatabaseCsvImportStatus,
  cancelDatabaseCsvImportTask,
} from './import-api';

// File
export {
  uploadFile,
  uploadFileMultipart,
  MULTIPART_THRESHOLD,
} from './file-api';
export type { MultipartUploadProgress } from './file-api';

// Access
export {
  getInvitation,
  acceptInvitation,
  getRequestAccessInfo,
  approveRequestAccess,
  sendRequestAccess,
  getShareDetail,
  sharePageTo,
  revokeAccess,
  turnIntoMember,
  getShareWithMe,
} from './access-api';

// Misc
export {
  searchWorkspace,
  getChatMessages,
  generateAISummaryForRow,
  generateAITranslateForRow,
  getQuickNoteList,
  createQuickNote,
  updateQuickNote,
  deleteQuickNote,
} from './misc-api';

// Workspace types re-exports
export type { WorkspaceFolder, PageMentionUpdate } from './workspace-api';
