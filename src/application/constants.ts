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
  RECORD_NOT_FOUND: -2,
  RECORD_ALREADY_EXISTS: -3,
  RECORD_DELETED: -4,

  // Auth & permissions
  NOT_LOGGED_IN: 1011,
  NOT_HAS_PERMISSION: 1012,
  USER_UNAUTHORIZED: 1024,

  // Storage & limits
  STORAGE_SPACE_NOT_ENOUGH: 1015,
  PAYLOAD_TOO_LARGE: 1016,
  FILE_STORAGE_LIMIT_EXCEEDED: 1028,
  SINGLE_UPLOAD_LIMIT_EXCEEDED: 1037,
  WORKSPACE_LIMIT_EXCEEDED: 1026,
  WORKSPACE_MEMBER_LIMIT_EXCEEDED: 1027,

  // AI
  AI_SERVICE_UNAVAILABLE: 1032,
  AI_RESPONSE_LIMIT_EXCEEDED: 1033,
  AI_IMAGE_RESPONSE_LIMIT_EXCEEDED: 1058,

  // Invitations & sharing
  NOT_INVITEE_OF_INVITATION: 1041,
  INVALID_LINK: 1068,
  INVALID_GUEST: 1069,
  FREE_PLAN_GUEST_LIMIT_EXCEEDED: 1070,
  PAID_PLAN_GUEST_LIMIT_EXCEEDED: 1071,
  ALREADY_JOINED: 1073,

  // Access requests
  ACCESS_REQUEST_ALREADY_APPROVED: 1122,
  ACCESS_REQUEST_ALREADY_DENIED: 1123,

  // Service
  SERVICE_TEMPORARY_UNAVAILABLE: 1054,
  REQUEST_TIMEOUT: 1065,
  FEATURE_NOT_AVAILABLE: 1067,
  TOO_MANY_REQUESTS: 1079,

  // Workspace
  WORKSPACE_NOT_FOUND: 1130,
  INVALID_FOLDER_VIEW: 1040,
} as const;

export const APP_EVENTS = {
  // App lifecycle events
  OUTLINE_LOADED: 'outline-loaded',
  RECONNECT_WEBSOCKET: 'reconnect-websocket',
  WEBSOCKET_STATUS: 'websocket-status',
  
  // Workspace notification events
  USER_PROFILE_CHANGED: 'user-profile-changed',           // User name/email updated
  PERMISSION_CHANGED: 'permission-changed',               // Object access permissions changed  
  SECTION_CHANGED: 'section-changed',                     // Workspace sections updated (recent views, etc.)
  SHARE_VIEWS_CHANGED: 'share-views-changed',             // View sharing settings changed
  MENTIONABLE_PERSON_LIST_CHANGED: 'mentionable-person-list-changed', // Team member changes
  SERVER_LIMIT_CHANGED: 'server-limit-changed',           // Billing/feature limits updated
  WORKSPACE_MEMBER_PROFILE_CHANGED: 'workspace-member-profile-changed', // Workspace member profile updated
  FOLDER_OUTLINE_CHANGED: 'folder-outline-changed',       // Workspace folder outline diff (sidebar refresh)
  FOLDER_VIEW_CHANGED: 'folder-view-changed',             // Granular folder view change (sidebar update)
  COLLAB_DOC_RESET: 'collab-doc-reset',                   // Collab version reset replaced active Y.Doc instance
};
