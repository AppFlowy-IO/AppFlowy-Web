import { AxiosInstance } from 'axios';

import { GlobalComment, Reaction } from '@/application/comment.type';
import { ViewMeta } from '@/application/db/tables/view_metas';
import {
  Template,
  TemplateCategory,
  TemplateCategoryFormValues,
  TemplateCreator,
  TemplateCreatorFormValues,
  TemplateSummary,
  UploadTemplatePayload,
} from '@/application/template.type';
import {
  AccessLevel,
  AuthProvider,
  CreateDatabaseViewPayload,
  CreateDatabaseViewResponse,
  CreatePagePayload,
  CreatePageResponse,
  CreateSpacePayload,
  CreateWorkspacePayload,
  DatabaseRelations,
  DuplicatePublishView,
  FolderView,
  GenerateAISummaryRowPayload,
  GenerateAITranslateRowPayload,
  GetRequestAccessInfoResponse,
  GuestConversionCodeInfo,
  GuestInvitation,
  Invitation,
  IPeopleWithAccessType,
  MentionablePerson,
  PublishViewPayload,
  QuickNote,
  QuickNoteEditorData,
  Subscription,
  SubscriptionInterval,
  SubscriptionPlan,
  Subscriptions,
  UpdatePagePayload,
  UpdatePublishConfigPayload,
  UpdateSpacePayload,
  UpdateWorkspacePayload,
  UploadPublishNamespacePayload,
  User,
  UserWorkspaceInfo,
  View,
  ViewIconType,
  Workspace,
  WorkspaceMember,
  YDoc,
} from '@/application/types';
import { RepeatedChatMessage } from '@/components/chat';

export type AFService = PublishService &
  AppService &
  WorkspaceService &
  TemplateService &
  QuickNoteService &
  AIChatService & {
    getClientId: () => number;
    getDeviceId: () => string;
    getAxiosInstance: () => AxiosInstance | null;
  };

export interface AFServiceConfig {
  cloudConfig: AFCloudConfig;
}

export interface AFCloudConfig {
  baseURL: string;
  gotrueURL: string;
  wsURL: string;
}

export interface WorkspaceService {
  openWorkspace: (workspaceId: string) => Promise<void>;
  createWorkspace: (payload: CreateWorkspacePayload) => Promise<string>;
  updateWorkspace: (workspaceId: string, payload: UpdateWorkspacePayload) => Promise<void>;
  leaveWorkspace: (workspaceId: string) => Promise<void>;
  deleteWorkspace: (workspaceId: string) => Promise<void>;
  getWorkspaceMembers: (workspaceId: string) => Promise<WorkspaceMember[]>;
  inviteMembers: (workspaceId: string, emails: string[]) => Promise<void>;
  searchWorkspace: (workspaceId: string, searchTerm: string) => Promise<string[]>;
  getGuestInvitation: (workspaceId: string, code: string) => Promise<GuestInvitation>;
  acceptGuestInvitation: (workspaceId: string, code: string) => Promise<void>;
  getGuestToMemberConversionInfo: (workspaceId: string, code: string) => Promise<GuestConversionCodeInfo>;
  approveTurnGuestToMember: (workspaceId: string, code: string) => Promise<void>;
  getMentionableUsers: (workspaceId: string) => Promise<MentionablePerson[]>;
  addRecentPages: (workspaceId: string, viewIds: string[]) => Promise<void>;
  getShareDetail: (workspaceId: string, viewId: string, ancestorViewIds: string[]) => Promise<{
    view_id: string;
    shared_with: IPeopleWithAccessType[];
  }>;
  sharePageTo: (workspaceId: string, viewId: string, emails: string[], accessLevel?: AccessLevel) => Promise<void>;
  revokeAccess: (workspaceId: string, viewId: string, emails: string[]) => Promise<void>;
  turnIntoMember: (workspaceId: string, email: string) => Promise<void>;
  getShareWithMe: (workspaceId: string) => Promise<View>;
}

export interface AppService {
  getPageDoc: (workspaceId: string, viewId: string, errorCallback?: (error: { code: number }) => void) => Promise<YDoc>;
  createRowDoc: (rowKey: string) => Promise<YDoc>;
  deleteRowDoc: (rowKey: string) => void;
  getAppDatabaseViewRelations: (workspaceId: string, databaseStorageId: string) => Promise<DatabaseRelations>;
  getAppOutline: (workspaceId: string) => Promise<View[]>;
  getAppView: (workspaceId: string, viewId: string) => Promise<View>;
  getAppFavorites: (workspaceId: string) => Promise<View[]>;
  getAppRecent: (workspaceId: string) => Promise<View[]>;
  getAppTrash: (workspaceId: string) => Promise<View[]>;
  loginAuth: (url: string) => Promise<void>;
  signInMagicLink: (params: { email: string; redirectTo: string }) => Promise<void>;
  signInOTP: (params: {
    email: string;
    code: string;
    redirectTo: string;
    type?: 'magiclink' | 'recovery';
  }) => Promise<void>;
  signInWithPassword: (params: { email: string; password: string; redirectTo: string }) => Promise<void>;
  forgotPassword: (params: { email: string }) => Promise<void>;
  changePassword: (params: { password: string }) => Promise<void>;
  signInGoogle: (params: { redirectTo: string }) => Promise<void>;
  signInGithub: (params: { redirectTo: string }) => Promise<void>;
  signInDiscord: (params: { redirectTo: string }) => Promise<void>;
  signInApple: (params: { redirectTo: string }) => Promise<void>;
  getAuthProviders: () => Promise<AuthProvider[]>;
  getWorkspaces: () => Promise<Workspace[]>;
  getWorkspaceFolder: (workspaceId: string) => Promise<FolderView>;
  getCurrentUser: () => Promise<User>;
  getWorkspaceMemberProfile: (workspaceId: string) => Promise<MentionablePerson>;
  updateUserProfile: (metadata: Record<string, unknown>) => Promise<void>;
  updateWorkspaceMemberProfile: (workspaceId: string, profile: WorkspaceMemberProfileUpdate) => Promise<void>;
  getUserWorkspaceInfo: () => Promise<UserWorkspaceInfo>;
  uploadTemplateAvatar: (file: File) => Promise<string>;
  getInvitation: (invitationId: string) => Promise<Invitation>;
  acceptInvitation: (invitationId: string) => Promise<void>;
  getRequestAccessInfo: (requestId: string) => Promise<GetRequestAccessInfoResponse>;
  approveRequestAccess: (requestId: string) => Promise<void>;
  sendRequestAccess: (workspaceId: string, viewId: string) => Promise<void>;
  getSubscriptionLink: (workspaceId: string, plan: SubscriptionPlan, interval: SubscriptionInterval) => Promise<string>;
  getSubscriptions: () => Promise<Subscriptions>;
  cancelSubscription: (workspaceId: string, plan: SubscriptionPlan, reason?: string) => Promise<void>;
  getActiveSubscription: (workspaceId: string) => Promise<SubscriptionPlan[]>;
  getWorkspaceSubscriptions: (workspaceId: string) => Promise<Subscription[]>;
  importFile: (file: File, onProgress: (progress: number) => void) => Promise<void>;
  createSpace: (workspaceId: string, payload: CreateSpacePayload) => Promise<string>;
  updateSpace: (workspaceId: string, payload: UpdateSpacePayload) => Promise<void>;
  addAppPage: (workspaceId: string, parentViewId: string, payload: CreatePagePayload) => Promise<CreatePageResponse>;
  createDatabaseView: (workspaceId: string, viewId: string, payload: CreateDatabaseViewPayload) => Promise<CreateDatabaseViewResponse>;
  updateAppPage: (workspaceId: string, viewId: string, data: UpdatePagePayload) => Promise<void>;
  updateAppPageIcon: (workspaceId: string, viewId: string, icon: { ty: ViewIconType; value: string }) => Promise<void>;
  updateAppPageName: (workspaceId: string, viewId: string, name: string) => Promise<void>;
  deleteTrash: (workspaceId: string, viewId?: string) => Promise<void>;
  moveToTrash: (workspaceId: string, viewId: string) => Promise<void>;
  restoreFromTrash: (workspaceId: string, viewId?: string) => Promise<void>;
  movePage: (workspaceId: string, viewId: string, parentId: string, prevViewId?: string) => Promise<void>;
  uploadFile: (
    workspaceId: string,
    viewId: string,
    file: File,
    onProgress?: (progress: number) => void
  ) => Promise<string>;
  duplicateAppPage: (workspaceId: string, viewId: string) => Promise<void>;
  joinWorkspaceByInvitationCode: (code: string) => Promise<string>;
  getWorkspaceInfoByInvitationCode: (code: string) => Promise<{
    workspace_id: string;
    workspace_name: string;
    workspace_icon_url: string;
    owner_name: string;
    owner_avatar: string;
    is_member: boolean;
    member_count: number;
  }>;
  generateAISummaryForRow: (workspaceId: string, payload: GenerateAISummaryRowPayload) => Promise<string>;
  generateAITranslateForRow: (workspaceId: string, payload: GenerateAITranslateRowPayload) => Promise<string>;
  createOrphanedView: (workspaceId: string, payload: { document_id: string }) => Promise<void>;
  checkIfCollabExists: (workspaceId: string, objectId: string) => Promise<boolean>;
}

export interface WorkspaceMemberProfileUpdate {
  name: string;
  avatar_url?: string;
  cover_image_url?: string;
  custom_image_url?: string;
  description?: string;
}

export interface QuickNoteService {
  getQuickNoteList: (
    workspaceId: string,
    params: {
      offset?: number;
      limit?: number;
      searchTerm?: string;
    }
  ) => Promise<{
    data: QuickNote[];
    has_more: boolean;
  }>;
  createQuickNote: (workspaceId: string, data: QuickNoteEditorData[]) => Promise<QuickNote>;
  updateQuickNote: (workspaceId: string, id: string, data: QuickNoteEditorData[]) => Promise<void>;
  deleteQuickNote: (workspaceId: string, id: string) => Promise<void>;
}

export interface TemplateService {
  getTemplateCategories: () => Promise<TemplateCategory[]>;
  addTemplateCategory: (category: TemplateCategoryFormValues) => Promise<void>;
  deleteTemplateCategory: (categoryId: string) => Promise<void>;
  getTemplateCreators: () => Promise<TemplateCreator[]>;
  createTemplateCreator: (creator: TemplateCreatorFormValues) => Promise<void>;
  deleteTemplateCreator: (creatorId: string) => Promise<void>;
  getTemplateById: (id: string) => Promise<Template>;
  getTemplates: (params: { categoryId?: string; nameContains?: string }) => Promise<TemplateSummary[]>;
  deleteTemplate: (id: string) => Promise<void>;
  createTemplate: (template: UploadTemplatePayload) => Promise<void>;
  updateTemplate: (id: string, template: UploadTemplatePayload) => Promise<void>;
  updateTemplateCategory: (categoryId: string, category: TemplateCategoryFormValues) => Promise<void>;
  updateTemplateCreator: (creatorId: string, creator: TemplateCreatorFormValues) => Promise<void>;
}

export interface PublishService {
  publishView: (workspaceId: string, viewId: string, payload?: PublishViewPayload) => Promise<void>;
  unpublishView: (workspaceId: string, viewId: string) => Promise<void>;
  updatePublishNamespace: (workspaceId: string, payload: UploadPublishNamespacePayload) => Promise<void>;
  getPublishViewMeta: (namespace: string, publishName: string) => Promise<ViewMeta>;
  getPublishView: (namespace: string, publishName: string) => Promise<YDoc>;
  getPublishRowDocument: (viewId: string) => Promise<YDoc>;
  getPublishInfo: (viewId: string) => Promise<{
    namespace: string;
    publishName: string;
    publisherEmail: string;
    publishedAt: string;
    commentEnabled: boolean;
    duplicateEnabled: boolean;
  }>;
  updatePublishConfig: (workspaceId: string, payload: UpdatePublishConfigPayload) => Promise<void>;
  getPublishNamespace: (namespace: string) => Promise<string>;
  getPublishHomepage: (workspaceId: string) => Promise<{ view_id: string }>;
  updatePublishHomepage: (workspaceId: string, viewId: string) => Promise<void>;
  removePublishHomepage: (workspaceId: string) => Promise<void>;

  getPublishOutline(namespace: string): Promise<View[]>;

  getPublishViewGlobalComments: (viewId: string) => Promise<GlobalComment[]>;
  createCommentOnPublishView: (viewId: string, content: string, replyCommentId?: string) => Promise<void>;
  deleteCommentOnPublishView: (viewId: string, commentId: string) => Promise<void>;
  getPublishViewReactions: (viewId: string, commentId?: string) => Promise<Record<string, Reaction[]>>;
  addPublishViewReaction: (viewId: string, commentId: string, reactionType: string) => Promise<void>;
  removePublishViewReaction: (viewId: string, commentId: string, reactionType: string) => Promise<void>;
  duplicatePublishView: (params: DuplicatePublishView) => Promise<string>;
}

export interface AIChatService {
  getChatMessages: (workspaceId: string, chatId: string, limit?: number | undefined) => Promise<RepeatedChatMessage>;
}
