import { serverErrorCodes } from '@/application/errors/shared-error-codes';

export const databasePrefix = 'af_database';

export const HEADER_HEIGHT = 48;

/**
 * Server error codes from AppFlowy Cloud ErrorCode enum.
 * See: libs/app-error/src/lib.rs in AppFlowy-Cloud
 *
 * Only codes that the web frontend needs to handle are listed here.
 * The `code` field in API responses uses these values.
 */
export const ERROR_CODE = {
  // General
  RECORD_NOT_FOUND: serverErrorCodes.RecordNotFound,
  RECORD_ALREADY_EXISTS: serverErrorCodes.RecordAlreadyExists,
  RECORD_DELETED: serverErrorCodes.RecordDeleted,
  RETRY_LATER: serverErrorCodes.RetryLater,
  INVALID_REQUEST: serverErrorCodes.InvalidRequest,

  // Auth & permissions
  NOT_LOGGED_IN: serverErrorCodes.NotLoggedIn,
  NOT_HAS_PERMISSION: serverErrorCodes.NotEnoughPermissions,
  USER_UNAUTHORIZED: serverErrorCodes.UserUnAuthorized,

  // Storage & limits
  STORAGE_SPACE_NOT_ENOUGH: serverErrorCodes.StorageSpaceNotEnough,
  PAYLOAD_TOO_LARGE: serverErrorCodes.PayloadTooLarge,
  FILE_STORAGE_LIMIT_EXCEEDED: serverErrorCodes.FileStorageLimitExceeded,
  SINGLE_UPLOAD_LIMIT_EXCEEDED: serverErrorCodes.SingleUploadLimitExceeded,
  WORKSPACE_LIMIT_EXCEEDED: serverErrorCodes.WorkspaceLimitExceeded,
  WORKSPACE_MEMBER_LIMIT_EXCEEDED: serverErrorCodes.WorkspaceMemberLimitExceeded,
  INVALID_SUBSCRIPTION_PLAN: serverErrorCodes.InvalidSubscriptionPlan,
  CUSTOM_NAMESPACE_DISABLED: serverErrorCodes.CustomNamespaceDisabled,

  // AI
  AI_SERVICE_UNAVAILABLE: serverErrorCodes.AIServiceUnavailable,
  AI_RESPONSE_LIMIT_EXCEEDED: serverErrorCodes.AIResponseLimitExceeded,
  AI_IMAGE_RESPONSE_LIMIT_EXCEEDED: serverErrorCodes.AIImageResponseLimitExceeded,
  AI_MEETING_TRANSCRIPTION_LIMIT_EXCEEDED: serverErrorCodes.AIMeetingTranscriptionLimitExceeded,

  // Invitations & sharing
  NOT_INVITEE_OF_INVITATION: serverErrorCodes.NotInviteeOfWorkspaceInvitation,
  INVALID_LINK: serverErrorCodes.InvalidInvitationCode,
  INVALID_GUEST: serverErrorCodes.InvalidGuest,
  FREE_PLAN_GUEST_LIMIT_EXCEEDED: serverErrorCodes.FreePlanGuestLimitExceeded,
  PAID_PLAN_GUEST_LIMIT_EXCEEDED: serverErrorCodes.PaidPlanGuestLimitExceeded,
  TOO_MANY_EXPORT_TASK: serverErrorCodes.TooManyExportTask,

  // Access requests
  ACCESS_REQUEST_ALREADY_APPROVED: serverErrorCodes.AccessRequestAlreadyApproved,
  ACCESS_REQUEST_ALREADY_DENIED: serverErrorCodes.AccessRequestAlreadyDenied,

  // Service
  MAILER_ERROR: serverErrorCodes.MailerError,
  SERVICE_TEMPORARY_UNAVAILABLE: serverErrorCodes.ServiceTemporaryUnavailable,
  REQUEST_TIMEOUT: serverErrorCodes.RequestTimeout,
  FEATURE_NOT_AVAILABLE: serverErrorCodes.FeatureNotAvailable,
  TOO_MANY_REQUESTS: serverErrorCodes.TooManyRequests,

  // Workspace
  WORKSPACE_NOT_FOUND: serverErrorCodes.WorkspaceNotFound,
  INVALID_FOLDER_VIEW: serverErrorCodes.InvalidFolderView,
} as const;

export const APP_EVENTS = {
  // App lifecycle events
  OUTLINE_LOADED: 'outline-loaded',
  OUTLINE_EXPAND_PATH: 'outline-expand-path',            // Reveal an already hydrated sidebar path
  TRASH_UPDATED: 'trash-updated',                     // Fresh workspace trash payload accepted by app state
  RECONNECT_WEBSOCKET: 'reconnect-websocket',
  WEBSOCKET_STATUS: 'websocket-status',
  
  // Workspace notification events
  USER_PROFILE_CHANGED: 'user-profile-changed',           // User name/email updated
  PERMISSION_CHANGED: 'permission-changed',               // Object access permissions changed  
  SECTION_CHANGED: 'section-changed',                     // Workspace sections updated (recent views, etc.)
  SHARE_VIEWS_CHANGED: 'share-views-changed',             // View sharing settings changed
  VIEW_ACCESS_REVOKED: 'view-access-revoked',             // Current user lost access to a view; local cache evicted
  VIEW_ACCESS_RESTORED: 'view-access-restored',           // Current user regained access to a view; permission gate reset
  MENTIONABLE_PERSON_LIST_CHANGED: 'mentionable-person-list-changed', // Team member changes
  SERVER_LIMIT_CHANGED: 'server-limit-changed',           // Billing/feature limits updated
  WORKSPACE_MEMBER_PROFILE_CHANGED: 'workspace-member-profile-changed', // Workspace member profile updated
  FOLDER_OUTLINE_CHANGED: 'folder-outline-changed',       // Workspace folder outline diff (sidebar refresh)
  FOLDER_VIEW_CHANGED: 'folder-view-changed',             // Granular folder view change (sidebar update)
  VIEW_META_CHANGED: 'view-meta-changed',                 // Parsed view metadata update for loaded views outside the outline
  INBOX_NOTIFICATION: 'inbox-notification',               // Inbox notification push for notification center refresh
  INLINE_COMMENT_CHANGED: 'inline-comment-changed',       // Document inline comment created, resolved, or deleted
  COLLAB_DOC_RESET: 'collab-doc-reset',                   // Collab version reset replaced active Y.Doc instance
  DATABASE_RESTORED: 'database-restored',                 // Restored aggregate and navigation are ready to reload

  // Editor events
  FIND_AND_REPLACE: 'find-and-replace',                   // Open the in-document find & replace panel for a view
};
