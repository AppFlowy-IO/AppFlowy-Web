import type { CalloutBlockData, Mention, ViewCover } from '@/application/types';

import type { ReviewedStyle, ServerSlidePlan, SlideAsset, SourceEnvelope } from './server-contract';

/** Frontend contract for the presentation experiment. Backend enforcement is deliberately separate. */
export interface SourceBlock {
  id: string;
  type: string;
  text: string;
  level?: number;
  checked?: boolean;
  url?: string;
  pageId?: string;
  callout?: CalloutBlockData;
  listMarker?: string;
  collapsed?: boolean;
  headingText?: string;
  outline?: { depth?: number; color?: string };
  meeting?: { title?: string };
  formula?: string;
  language?: string;
  database?: { viewIds: string[]; databaseId?: string; parentId?: string };
  table?: {
    headerRow?: boolean;
    headerColumn?: boolean;
    columnWidths?: number[];
    columnColors?: Record<string, string>;
    rowColors?: Record<string, string>;
    columnAligns?: Record<string, string>;
    rowAligns?: Record<string, string>;
  };
  style?: { backgroundColor?: string; color?: string; align?: string };
  richText?: Array<{
    text: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    code?: boolean;
    font_color?: string;
    bg_color?: string;
    af_text_color?: string;
    af_background_color?: string;
    href?: string;
    font_family?: string;
    mention?: Omit<Mention, 'type'> & { type: string };
    formula?: string;
  }>;
  children: SourceBlock[];
}
export interface SourceProperty {
  id: string;
  name: string;
  type: string;
  value: string | number | boolean | null;
}
export interface PageSnapshot {
  /** Authorized immutable server evidence. Never submitted as generation input. */
  serverSource?: SourceEnvelope;
  pageId: string;
  title: string;
  cover?: ViewCover;
  kind: 'document' | 'row';
  revision: string;
  blocks: SourceBlock[];
  properties: SourceProperty[];
  warnings: string[];
}
export const LAYOUTS = ['title', 'summary', 'columns', 'timeline', 'gallery', 'kpi', 'comparison', 'closing'] as const;
export type Layout = (typeof LAYOUTS)[number];
export interface Slide {
  assets?: SlideAsset[];
  id: string;
  title: string;
  message: string;
  points: string[];
  layout: Layout;
  sourceIds: string[];
  notes: string;
  warnings: string[];
  templateSlideId?: string;
  templateContent?: Record<string, string>;
  table?: { columns: string[]; rows: string[][]; sourceIds: string[] };
  chart?: { unit: string; items: { label: string; value: number; sourceId: string }[] };
}
export interface StoryPlan {
  schemaVersion?: 1 | 2;
  title: string;
  slides: Slide[];
}
export interface MapNode {
  id: string;
  parentId: string | null;
  label: string;
  summary: string;
  sourceIds: string[];
}
export interface MindMap {
  /** Omitted only on maps saved before the versioned response contract. */
  schemaVersion?: 1;
  nodes: MapNode[];
  warnings: string[];
}
/** Provenance is set by the application, never trusted from model-generated JSON. */
export type MapOrigin = 'ai' | 'imported' | 'fixture';
/** An explicitly attached file whose source IDs are not verified document block IDs. */
export interface MindMapImport {
  fileName: string;
  importedAt: string;
  referenceKind: 'external';
  /** Original article passages keyed by its reference IDs, separate from the AI tree. */
  sourceQuotes?: Record<string, string>;
}
export interface PresentationStyle {
  serverStyle?: ReviewedStyle;
  serverVersion?: number;
  requiresReview?: boolean;
  reviewed?: boolean;
  id: string;
  name: string;
  description: string;
  color: string;
  background: string;
  font: string;
  footer: string;
  guidelines: string;
  company?: boolean;
  isDefault?: boolean;
  version?: string;
  fontFallback?: string;
  logo?: string;
  templateName?: string;
  layoutMapping?: Partial<Record<Layout, string>>;
  compatibilityWarnings?: string[];
  palette?: string[];
  bodyFont?: string;
  textColor?: string;
  templateSlides?: TemplateSlide[];
  logoCandidates?: string[];
}
export interface TemplateElement {
  id: string;
  type: 'text' | 'shape' | 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  role?: 'title' | 'body' | 'decoration';
  size?: number;
  color?: string;
  font?: string;
  bold?: boolean;
  shape?: 'rect' | 'ellipse' | 'roundRect' | 'line' | 'chevron';
  data?: string;
}
export interface TemplateSlide {
  id: string;
  title: string;
  background: string;
  elements: TemplateElement[];
}
export const SLIDE_PREFERENCES = ['auto', 'columns', 'timeline', 'gallery', 'comparison', 'summary'] as const;
export type SlidePreference = (typeof SLIDE_PREFERENCES)[number];
export type DocumentCondition = 'concise' | 'long' | 'notes' | 'ambiguous';
export interface SlideAssessment {
  condition: DocumentCondition;
  rationale: string;
  recommendations: Array<{ layout: Exclude<SlidePreference, 'auto'>; reason: string }>;
  question?: string;
  similarTemplate: boolean;
  recommendedThemeId?: string;
  recommendedSlideCount?: number;
  templateReason?: string;
}
export const SLIDE_TONES = ['auto', 'professional', 'conversational', 'persuasive', 'educational'] as const;
export const SLIDE_DENSITIES = ['auto', 'minimal', 'balanced', 'detailed'] as const;
export interface GenerationOptions {
  designMode?: 'auto' | 'theme' | 'template';
  preconfigure?: boolean;
  tone?: (typeof SLIDE_TONES)[number];
  contentDensity?: (typeof SLIDE_DENSITIES)[number];
  instructionsEnabled?: boolean;
  audience: string;
  slideCount: number;
  slideCountMode?: 'auto' | 'fixed';
  /** Preserves the selected control even when a custom value equals a preset. */
  slideCountSelection?: 'preset' | 'custom';
  instructions: string;
  includeProperties: boolean;
  allowWebSearch: boolean;
  layoutPreference?: SlidePreference;
  purpose?: string;
  reviewOutline?: boolean;
  templateReuse?: 'auto' | 'style-only';
}
export type Mode = 'slides' | 'mindmap' | 'document' | 'styles' | 'source';
export type SlidesStage = 'setup' | 'preview' | 'story' | 'outline';
export type DeckAction = 'preview' | 'present' | 'download' | 'regenerate';
export type Scenario = 'free' | 'consumed' | 'pro' | 'viewer' | 'ai-limit';
export interface SavedDeck {
  version?: number;
  serverPlan?: ServerSlidePlan;
  id: string;
  plan: StoryPlan;
  style: PresentationStyle;
  sourceRevision: string;
  createdAt: string;
  source?: PageSnapshot;
  updatedAt?: string;
  options?: GenerationOptions;
  /** The scene read with this artifact version, so previews reuse it instead of reading it again. */
  scene?: { workspaceId: string; id: string; version: number; value: import('./server-scene').DeckScene };
}
