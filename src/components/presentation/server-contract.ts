/** Wire DTOs mirrored from Cloud's presentation contracts. No client identity or usage authority. */
import type { Layout, MindMap, SlideAssessment, StoryPlan } from './types';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface PresentationScope { workspaceId: string; pageId: string; }
export interface VersionedId { id: string; version: number; }
export interface SourceSelection { pageId: string; expectedRevision?: string | null; }
export interface CoverageItem {
  sourceId: string | null;
  status: 'included' | 'summarized' | 'permission_denied' | 'unsupported' | 'extraction_failed';
  total: number | null; matched: number | null; included: number | null;
  selection: string | null; warning: string | null;
}
export type SourceLocation =
  | { kind: 'document'; pageId: string; revision: string; blockId: string | null; propertyId: string | null }
  | { kind: 'database_cell'; pageId: string; databaseId: string; rowId: string; fieldId: string; revision: string }
  | { kind: 'media'; pageId: string; assetId: string; revision: string; region: number[] | null; timeRangeMs: number[] | null }
  | { kind: 'code'; pageId: string; blockId: string; revision: string; startLine: number; endLine: number }
  | { kind: 'attachment'; pageId: string; assetId: string; revision: string; page: number; region: number[] | null }
  | { kind: 'web'; url: string; retrievedAt: string; quote: string };
export interface SourceReference {
  location: SourceLocation;
  evidenceKind: 'original' | 'ocr' | 'transcript' | 'visual_description' | 'web_research';
  numeric: { value: number; unit: string } | null;
}
export interface ServerSourceBlock {
  id: string; pageId: string; kind: string; text: string; sourceIds: string[];
  children: ServerSourceBlock[]; semantic: Json;
}
export type SourceValue =
  | { type: 'unknown' }
  | { type: 'text'; text: string; annotations: Json }
  | { type: 'number'; value: number; unit: string }
  | { type: 'boolean'; value: boolean }
  | { type: 'date'; start: string; end: string | null; timezone: string | null }
  | { type: 'labels'; values: string[] }
  | { type: 'structured'; kind: string; value: Json };
export interface SourceEnvelope {
  schemaVersion: number; revision: string; title: string;
  sources: Array<{ pageId: string; title: string; kind: string; revision: string; original: Json }>;
  blocks: ServerSourceBlock[];
  databaseViews: Array<{
    databaseId: string; viewId: string; name: string;
    viewType: 'grid' | 'board' | 'calendar' | 'gallery' | 'list' | 'timeline' | 'feed';
    selectedTab: string | null; schema: Json; filters: Json; sorts: Json; groups: Json;
    rows: Array<{ rowId: string; revision: string; cells: Record<string, { value: SourceValue; sourceId: string }> }>;
    coverage: CoverageItem;
  }>;
  assets: Array<{
    assetId: string; pageId: string; blockId: string | null; revision: string; mediaType: string;
    caption: string; dimensions: [number, number] | null; durationMs: number | null; decorative: boolean;
    extractions: Array<{ adapter: string; text: string; sourceIds: string[]; warnings: string[] }>;
    contentPartId: string | null; coverage: CoverageItem;
  }>;
  references: Record<string, SourceReference>;
  dependencyRevisions: Array<{ kind: string; id: string; revision: string }>;
  coverage: CoverageItem[];
}
export interface ServerGenerationOptions {
  allowWebSearch: boolean; design: 'auto' | 'theme' | 'template'; themeId?: string | null;
  slideCountMode: 'auto' | 'preset' | 'custom'; slideCount?: number | null;
  instructions: string; audience?: string | null;
  tone: 'auto' | 'professional' | 'conversational' | 'persuasive' | 'educational';
  contentDensity: 'auto' | 'minimal' | 'balanced' | 'detailed'; reviewOutline: boolean;
  includeProperties: boolean; templateReuse: 'auto' | 'style-only'; layoutPreference?: Layout | null;
  purpose?: string | null; preconfigure?: boolean; instructionsEnabled?: boolean;
}
export interface SlideAsset {
  assetId: string; revision: string; sourceId: string; attribution: string;
  kind: 'image' | 'video_poster' | 'video_frame';
  placement: { x: number; y: number; width: number; height: number }; timeMs: number | null;
}
export interface ServerSlidePlan extends StoryPlan { schemaVersion: 1 | 2; }
export interface Theme {
  id: string; name: string; description: string; color: string; background: string; textColor: string;
  font: string; bodyFont: string; footer: string; palette: string[]; guidelines: string;
}
export interface ReviewedStyle {
  reference: VersionedId; theme: Theme;
  templateSlides: Array<{ id: string; title: string; text: string; textSlots: Record<string, string>; elements: Json }>;
}
export interface PresentationStatus {
  schemaVersion: number; promptBundleVersion: string; plan: 'free' | 'paid';
  usage: { freeSlides: number; reservedSlides: number; freeExports: number; reservedExports: number };
  remainingSlides: number; themes: Theme[]; slideSchemas: number[]; maxSlides: number;
  aiResponses: { metered?: boolean; policy?: string; period?: string; accountingReady?: boolean;
    committed?: number | null; reserved?: number | null; limit?: number | null; remaining?: number | null;
    reason?: string; retryable?: boolean };
}
export interface AssessmentInput { sources: SourceSelection[]; options: ServerGenerationOptions; style?: VersionedId | null; }
export interface AssessmentResponse {
  assessment: SlideAssessment; sourceRevision: string; promptBundleVersion: string; coverage: CoverageItem[];
}
export interface GenerationRequest extends AssessmentInput {
  requestId: string; task: 'slides' | 'mindmap'; artifact?: VersionedId | null; narrative?: VersionedId | null;
  storyPlan?: ServerSlidePlan | null; storyPlanSourceRevision?: string | null; targetSlideIds?: string[] | null;
}
export interface JobStatus {
  id: string; state: 'queued' | 'running' | 'validating' | 'succeeded' | 'failed' | 'canceled';
  kind: 'slides' | 'mindmap' | 'export'; sourceRevision: string; artifactId: string | null;
  resultVersion: number | null; committedUnits: number; errorReason: string | null;
}
export interface MindMapStyle { structure: 'right-facing' | 'left-facing' | 'two-sided' | 'top-down'; branchLine: 'rounded' | 'curved'; }
export interface Artifact<T = ServerSlidePlan | MindMap | ReviewedStyle> {
  id: string; workspaceId: string; version: number; content: T; resultHash: string; sourceRevision: string | null;
  options?: ServerGenerationOptions | null;
  assessment?: SlideAssessment | null;
  generationJobId: string | null; origin: string | null; createdAt: string; mapStyle: MindMapStyle;
  promptBundleVersion: string | null; compiledPromptChecksum: string | null; providerModel: Json;
}
export interface ArtifactSummary {
  id: string; kind: 'deck' | 'map' | 'style'; version: number; createdAt: string;
  origin: string | null; sourceRevision: string | null;
}
export interface ArtifactPage { items: ArtifactSummary[]; nextCursor: string | null; }
export interface PresentationSession {
  artifact: VersionedId | null; narrative: VersionedId | null; style: VersionedId | null;
  options: ServerGenerationOptions; mapStyle: MindMapStyle;
}
export interface StoredSession { workspaceId: string; actorId: string; revision: number; payload: PresentationSession; updatedAt: string; }
export interface TemplateCandidate { style: ReviewedStyle; warnings: string[]; requiresReview: boolean; }
export interface ImportMapRequest extends Omit<AssessmentInput, 'style'> { id: string; map: MindMap; sourceMapping: Record<string, string>; style?: MindMapStyle; }
