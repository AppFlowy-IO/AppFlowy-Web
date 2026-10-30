/** Presentation UI projections. The original evidence and immutable plan are retained verbatim. */
import { PresentationAPIError } from './server-client';
import { SLIDE_COUNT_PRESETS } from './slide-limits';

import type {
  Artifact, GenerationRequest, Json, PresentationScope, PresentationStatus, ReviewedStyle, ServerGenerationOptions,
  ServerSlidePlan, ServerSourceBlock, SourceEnvelope, SourceSelection, SourceValue, Theme, VersionedId,
} from './server-contract';
import type { DeckScene } from './server-scene';
import type { GenerationOptions, MindMap, PageSnapshot, PresentationStyle, SavedDeck, SourceBlock, SourceProperty, StoryPlan } from './types';

export interface PresentationEntitlement {
  isPro: boolean; canGenerate: boolean; canGenerateMap: boolean;
  aiResponsesUsed: number | null; aiResponsesRemaining: number | null; aiAccountingReady: boolean;
  maxSlides: number; generatedSlides: number; remainingSlides: number;
}
export function entitlementForStatus(status: PresentationStatus): PresentationEntitlement {
  const ai = status.aiResponses;
  const ready = ai.metered === false || ai.accountingReady === true;
  const aiAvailable = ready && (ai.metered === false || ai.limit === null || (ai.remaining !== null && ai.remaining !== undefined && ai.remaining > 0));

  return {
    isPro: status.plan === 'paid',
    canGenerate: status.remainingSlides > 0, canGenerateMap: aiAvailable,
    aiResponsesUsed: ai.committed ?? null, aiResponsesRemaining: ai.remaining ?? null, aiAccountingReady: ready,
    maxSlides: status.maxSlides, generatedSlides: status.usage.freeSlides, remainingSlides: status.remainingSlides,
  };
}

export function serverOptions(options?: Partial<GenerationOptions>, style?: PresentationStyle): ServerGenerationOptions {
  const fixed = options?.slideCountMode === 'fixed';
  const count = options?.slideCount;
  const template = Boolean(style?.serverStyle && style.serverStyle.templateSlides.length > 0);

  return {
    allowWebSearch: options?.allowWebSearch ?? false,
    design: options?.designMode ?? (template ? 'template' : style ? 'theme' : 'auto'),
    themeId: style?.serverStyle?.theme.id ?? style?.id ?? null,
    // Older local options did not retain which count control was selected. New selections and
    // restored server sessions always provide the explicit intent, including Custom 4/6/8/12.
    slideCountMode: fixed ? options?.slideCountSelection ?? (SLIDE_COUNT_PRESETS.some((preset) => preset === count) ? 'preset' : 'custom') : 'auto',
    slideCount: fixed ? count : null,
    instructions: options?.instructionsEnabled === false ? '' : options?.instructions ?? '',
    audience: options?.preconfigure === false ? null : options?.audience || null, tone: options?.preconfigure === false ? 'auto' : options?.tone ?? 'auto', contentDensity: options?.preconfigure === false ? 'auto' : options?.contentDensity ?? 'auto',
    reviewOutline: options?.reviewOutline ?? false, includeProperties: options?.includeProperties ?? false,
    templateReuse: options?.templateReuse ?? 'auto',
    layoutPreference: options?.layoutPreference === 'auto' ? null : options?.layoutPreference ?? null,
    purpose: options?.purpose || null, preconfigure: options?.preconfigure, instructionsEnabled: options?.instructionsEnabled,
  };
}

export function uiOptions(options: ServerGenerationOptions): GenerationOptions {
  return {
    allowWebSearch: options.allowWebSearch, designMode: options.design, slideCountMode: options.slideCountMode === 'auto' ? 'auto' : 'fixed',
    slideCountSelection: options.slideCountMode === 'auto' ? undefined : options.slideCountMode,
    slideCount: options.slideCount ?? 6, instructions: options.instructions, audience: options.audience ?? '',
    tone: options.tone, contentDensity: options.contentDensity, reviewOutline: options.reviewOutline,
    includeProperties: options.includeProperties, templateReuse: options.templateReuse,
    layoutPreference: options.layoutPreference === 'title' || options.layoutPreference === 'kpi' || options.layoutPreference === 'closing'
      ? 'auto' : options.layoutPreference ?? 'auto',
    purpose: options.purpose ?? undefined, preconfigure: options.preconfigure, instructionsEnabled: options.instructionsEnabled,
  };
}

export function styleReference(style?: PresentationStyle): VersionedId | undefined {
  if (style?.requiresReview || style?.reviewed === false) throw new PresentationAPIError('Review and save this template before using it.', 'TEMPLATE_REVIEW_REQUIRED', 400);
  return style?.serverStyle?.reference;
}

export function themeToStyle(theme: Theme): PresentationStyle {
  return { ...theme, id: theme.id, company: false, reviewed: true, requiresReview: false };
}

export function reviewedStyleToStyle(style: ReviewedStyle, requiresReview = false, warnings: string[] = []): PresentationStyle {
  return {
    ...themeToStyle(style.theme), id: style.reference.id, version: String(style.reference.version), serverVersion: style.reference.version,
    serverStyle: style, reviewed: !requiresReview, requiresReview, compatibilityWarnings: warnings,
    templateName: style.theme.name,
    // Server geometry is rendered through the scene endpoint, never as caller-supplied SVG/image URLs.
  };
}

export function sourceSelections(source: PageSnapshot): SourceSelection[] {
  if (!source.serverSource) throw new PresentationAPIError('Reload the authorized source before generating.', 'SOURCE_NOT_RESOLVED', 409);
  return source.serverSource.sources.map(({ pageId, revision }) => ({ pageId, expectedRevision: revision }));
}

function mapBlock(block: ServerSourceBlock): SourceBlock {
  const semantic = block.semantic && typeof block.semantic === 'object' && !Array.isArray(block.semantic) ? block.semantic : {};

  return {
    id: block.sourceIds[0] ?? block.id, pageId: block.pageId, type: block.kind, text: block.text,
    children: block.children.map(mapBlock),
    language: typeof semantic.language === 'string' ? semantic.language : undefined,
    formula: typeof semantic.formula === 'string' ? semantic.formula : undefined,
  };
}

export function cellText(value: SourceValue): string {
  switch (value.type) {
    case 'unknown': return 'Unknown';
    case 'text': return value.text;
    case 'number': return `${value.value}${value.unit ? ` ${value.unit}` : ''}`;
    case 'boolean': return String(value.value);
    case 'date': return [value.start, value.end].filter(Boolean).join(' – ');
    case 'labels': return value.values.join(', ');
    case 'structured': return structuredText(value.kind, value.value);
  }
}

/** Select evidence carries option ids for filters; people read only the option names. */
function structuredText(kind: string, value: Json): string {
  if (kind === 'select' && Array.isArray(value)) {
    return value
      .flatMap((option) => (option && typeof option === 'object' && !Array.isArray(option) && typeof option.name === 'string' ? [option.name] : []))
      .join(', ');
  }

  return JSON.stringify(value);
}

export function sourceToSnapshot(source: SourceEnvelope, pageId?: string): PageSnapshot {
  const blocks = source.blocks.filter((block) => block.kind !== 'row_properties').map(mapBlock);
  const properties: SourceProperty[] = [];

  // Native row properties are typed semantic evidence, not visible document text.
  for (const block of source.blocks) {
    if (block.kind !== 'row_properties' || !Array.isArray(block.semantic)) continue;
    for (const item of block.semantic) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.sourceId !== 'string' || typeof item.name !== 'string') continue;
      const value = item.value as SourceValue | undefined;

      if (!value || typeof value !== 'object' || !('type' in value)) continue;
      properties.push({ id: item.sourceId, name: item.name, type: value.type,
        value: value.type === 'unknown' ? null : value.type === 'number' || value.type === 'boolean' ? value.value : cellText(value) });
    }
  }

  for (const view of source.databaseViews) {
    for (const row of view.rows) {
      for (const [field, cell] of Object.entries(row.cells)) {
        blocks.push({ id: cell.sourceId, type: 'paragraph', pageId: source.references[cell.sourceId]?.location.kind !== 'web'
          ? (source.references[cell.sourceId]?.location as { pageId?: string })?.pageId : undefined,
        text: `${view.name} · ${field}: ${cellText(cell.value)}`, children: [] });
      }
    }
  }

  for (const asset of source.assets) {
    for (const extraction of asset.extractions) {
      for (const id of extraction.sourceIds) blocks.push({ id, type: 'paragraph', pageId: asset.pageId, text: extraction.text, children: [] });
    }
  }

  return {
    pageId: pageId ?? source.sources[0]?.pageId ?? '', title: source.title,
    kind: source.sources[0]?.kind === 'row' ? 'row' : 'document', revision: source.revision,
    blocks, properties, warnings: source.coverage.flatMap((entry) => entry.warning ? [entry.warning] : []), serverSource: source,
  };
}

/** Copy only supported contract fields, including schema-v2 assets; never send UI/prototype metadata. */
export function toServerPlan(plan: StoryPlan): ServerSlidePlan {
  return { schemaVersion: plan.schemaVersion ?? (plan.slides.some((slide) => slide.assets?.length) ? 2 : 1), title: plan.title,
    slides: plan.slides.map((slide) => ({ id: slide.id, title: slide.title, message: slide.message, points: slide.points,
      layout: slide.layout, sourceIds: slide.sourceIds, notes: slide.notes, warnings: slide.warnings,
      ...(slide.table ? { table: slide.table } : {}), ...(slide.chart ? { chart: slide.chart } : {}),
      ...(slide.templateSlideId ? { templateSlideId: slide.templateSlideId } : {}),
      ...(slide.templateContent ? { templateContent: slide.templateContent } : {}),
      ...(slide.assets?.length ? { assets: slide.assets } : {}),
    })) };
}

export interface GenerateInput {
  scope: PresentationScope; requestId?: string; task: 'slides' | 'mindmap'; source: PageSnapshot;
  options: GenerationOptions; style?: PresentationStyle; artifact?: VersionedId; narrative?: VersionedId;
  storyPlan?: StoryPlan; storyPlanSourceRevision?: string; targetSlideIds?: string[];
}
export function generationRequest(input: GenerateInput, requestId: string): GenerationRequest {
  return { requestId, task: input.task, sources: sourceSelections(input.source), options: serverOptions(input.options, input.style),
    style: styleReference(input.style), artifact: input.artifact, narrative: input.narrative,
    storyPlan: input.storyPlan ? toServerPlan(input.storyPlan) : undefined,
    storyPlanSourceRevision: input.storyPlanSourceRevision, targetSlideIds: input.targetSlideIds };
}

export function artifactToDeck(artifact: Artifact<ServerSlidePlan>, scene: DeckScene, source?: PageSnapshot, options?: GenerationOptions): SavedDeck {
  return { id: artifact.id, version: artifact.version, serverPlan: artifact.content, plan: artifact.content,
    style: { ...themeToStyle(scene.theme), ...(scene.style.id !== '00000000-0000-0000-0000-000000000000' ? { id: scene.style.id, templateName: scene.theme.name, serverStyle: { reference: scene.style, theme: scene.theme, templateSlides: [] }, serverVersion: scene.style.version } : {}) },
    sourceRevision: artifact.sourceRevision ?? '', createdAt: artifact.createdAt,
    source: source?.revision === artifact.sourceRevision ? source : undefined,
    options: options ?? (artifact.options ? uiOptions(artifact.options) : undefined),
    assessment: artifact.assessment && artifact.promptBundleVersion
      ? { value: artifact.assessment, promptBundleVersion: artifact.promptBundleVersion } : undefined,
    // Previews render this scene; the server rebuilds it on every read.
    scene: { workspaceId: artifact.workspaceId, id: artifact.id, version: artifact.version, value: scene } };
}

export function isMapArtifact(artifact: Artifact): artifact is Artifact<MindMap> { return 'nodes' in artifact.content; }
