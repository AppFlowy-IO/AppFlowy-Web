export interface User {
  uuid: string;
  name: string;
  email: string;
  avatar: string;
}

export type GetChatMessagesPayload = Partial<{
  limit: number;
  offset: number;
  after: number;
  before: number;
}>;

export interface RepeatedChatMessage {
  messages: ChatMessage[];
  has_more: boolean;
  total: number;
}

export enum AuthorType {
  Unknown = 0,
  // Human message sent by user
  Human = 1,
  System = 2,
  AI = 3,
  // Placeholder message for assistant's streaming response
  Assistant = 1001,
}

export interface ChatMessage {
  message_id: number;
  author: {
    author_type: AuthorType;
    author_uuid: string;
  };
  content: string;
  created_at?: string;
  reply_message_id?: number;
  meta_data?: ChatMessageMetadata[];
}

export interface Suggestions {
  message_id: string;
  items: SuggestionItem[];
}

export interface SuggestionItem {
  content: string;
}

export enum OutputLayout {
  Paragraph = 0,
  BulletList = 1,
  NumberedList = 2,
  SimpleTable = 3,
  Flex = 4,
}

export enum OutputContent {
  TEXT = 0,
  IMAGE = 1,
  RichTextImage = 2,
}

export interface ResponseFormat {
  output_layout: OutputLayout;
  output_content: OutputContent;

  // It's unclear what this is supposed to be
  // eslint-disable-next-line
  output_content_metadata?: any;
}

export enum MessageType {
  System = 0,
  User = 1,
}

export interface ChatMessageMetadata {
  // The id for the metadata. It can be a file_id, view_id
  id: string;
  // The name for the metadata. For example, @xxx, @xx.txt
  name: string;
  source: string;
}

export interface SendQuestionPayload {
  content: string;
  message_type: MessageType;
  prompt_id?: string;
  model_name?: string;
}

export enum ChatInputMode {
  Auto,
  FormatResponse,
}

export interface ChatSettings {
  // from view id
  rag_ids: string[];
}

export enum SpacePermission {
  Public = 0,
  Private = 1,
}

export enum CoverType {
  NormalColor = 'color',
  GradientColor = 'gradient',
  BuildInImage = 'built_in',
  CustomImage = 'custom',
  LocalImage = 'local',
  UpsplashImage = 'unsplash',
  None = 'none',
}

export interface ViewExtra {
  is_space: boolean;
  space_created_at?: number;
  space_icon?: string;
  space_icon_color?: string;
  space_permission?: number;
  is_pinned?: boolean;
  cover?: {
    type: CoverType;
    value: string;
  };

  // Database container support (aligned with Desktop/Flutter)
  is_database_container?: boolean;
  database_id?: string;
}

export interface ViewIcon {
  ty: ViewIconType;
  value: string;
}

export enum ViewIconType {
  Emoji = 0,
  Icon = 2,
}

export enum ViewLayout {
  Document = 0,
  Grid = 1,
  Board = 2,
  Calendar = 3,
  AIChat = 4,
}

export interface View {
  view_id: string;
  name: string;
  icon: ViewIcon | null;
  layout: ViewLayout;
  extra: ViewExtra | null;
  children: View[];
  is_private: boolean;
}

export enum StreamType {
  META_DATA = '0',
  TEXT = '1',
  IMAGE = '2',
  KEEP_ALIVE_KEY = '3',
  COMMENT = '4',
}
