export const databasePrefix = 'af_database';

export const HEADER_HEIGHT = 48;

export const ERROR_CODE = {
  INVALID_LINK: 1068,
  ALREADY_JOINED: 1073,
  NOT_INVITEE_OF_INVITATION: 1041,
  NOT_HAS_PERMISSION: 1012,
  USER_UNAUTHORIZED: 1024,
  NOT_HAS_PERMISSION_TO_CREATE_PAGE: 1071,
  NOT_HAS_PERMISSION_TO_INVITE_GUEST: 1070
};

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
};
