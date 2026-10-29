import Dialog from '@mui/material/Dialog';
import { ArrowLeft, FileText, Play, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { aiMapUnavailableReason } from './ai-map-availability';
import { documentOutline } from './document-outline';
import DocumentContentProvider from './DocumentContentProvider';
import { DocumentOutlineContext } from './DocumentOutline';
import DocumentPresenter, { BlockContent } from './DocumentPresenter';
import { resolveMapReferences } from './mindmap-references';
import MindMapViewer from './MindMapViewer';
import {
  createGenerationRunner,
  editMap,
  exportDeck,
  loadPresentation,
  loadSavedDeck,
  loadStructuralMap,
  loadSourceSnapshot,
  uiOptions,
  themeToStyle,
  saveSession,
  serverOptions,
  styleReference,
  PresentationAPIError,
} from './presentation-client';
import { MindMapLoading } from './PresentationLoading';
import PresentationPaywall from './PresentationPaywall';
import { APPFLOWY_SLIDE_THEMES } from './slide-themes';
import SlidesWorkflow, { type SlidesWorkflowProps } from './SlidesWorkflow';
import { flattenBlocks, splitDocument } from './source';
import { hasStoryPlanChanges, prepareStoryPlan } from './story-plan';
import StyleSettings from './StyleSettings';
import { Action, Notice } from './ui';
import { regenerationReference } from './workflow-state';

import type {
  Artifact,
  JobStatus,
  MindMapStyle,
  PresentationScope,
  PresentationSession,
  PresentationStatus,
  StoredSession,
  VersionedId,
} from './server-contract';
import type {
  DeckAction,
  GenerationOptions,
  MindMap,
  Mode,
  PageSnapshot,
  PresentationStyle,
  SavedDeck,
  Slide,
  SlidesStage,
  StoryPlan,
} from './types';
import './presentation.css';

interface Props {
  workspaceId: string;
  userId: string;
  snapshot: PageSnapshot;
  initialMode?: Mode;
  presentMindMap?: boolean;
  onClose?: () => void;
  onSource?: (id: string) => void;
  canWrite?: boolean;
  onUpgrade?: () => void;
  canManageStyles?: boolean;
  initialDeck?: SavedDeck;
  initialAction?: DeckAction;
  onSetupChange?: (open: boolean) => void;
}

type StructuralMapState =
  | { key: string; state: 'loading' }
  | { key: string; state: 'ready'; artifact: Artifact<MindMap> }
  | { key: string; state: 'error'; message: string };

const DEFAULT_OPTIONS: GenerationOptions = {
  designMode: 'auto',
  preconfigure: false,
  tone: 'auto',
  contentDensity: 'auto',
  instructionsEnabled: false,
  layoutPreference: 'auto',
  templateReuse: 'auto',
  audience: '',
  slideCount: 8,
  slideCountMode: 'auto',
  instructions: '',
  includeProperties: true,
  allowWebSearch: false,
};

/** Key order is not part of a session payload's identity. */
function sessionIdentity(payload: PresentationSession): string {
  return JSON.stringify(payload, (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, value[key]])
        )
      : value
  );
}

/** UI state references immutable server artifacts; generated content is never reimported to save it. */
export default function PresentationStudio({
  workspaceId,
  userId,
  snapshot: incoming,
  initialMode = 'slides',
  presentMindMap = false,
  onClose,
  onSource,
  canWrite = false,
  onUpgrade,
  canManageStyles = false,
  initialDeck,
  initialAction = 'preview',
  onSetupChange,
}: Props) {
  const [sourceState, setSourceState] = useState({ input: incoming, snapshot: incoming });
  // A new source prop must hide the previous source's map in this render, before effect cleanup.
  const snapshot = sourceState.input === incoming ? sourceState.snapshot : incoming;
  const setSnapshot = useCallback(
    (next: PageSnapshot) => setSourceState({ input: incoming, snapshot: next }),
    [incoming]
  );
  const scope = useMemo<PresentationScope>(
    () => ({ workspaceId, pageId: snapshot.pageId }),
    [workspaceId, snapshot.pageId]
  );
  const [runGeneration] = useState(createGenerationRunner);
  const [status, setStatus] = useState<PresentationStatus>();
  const [mode, setMode] = useState<Mode>(
    initialMode === 'document' ? 'source' : initialMode
  );
  const [documentOpen, setDocumentOpen] = useState(initialMode === 'document');
  const [mapPresentationOpen, setMapPresentationOpen] = useState(presentMindMap);
  const [options, setOptions] = useState<GenerationOptions>(DEFAULT_OPTIONS);
  const [style, setStyle] = useState<PresentationStyle>(APPFLOWY_SLIDE_THEMES[0]);
  const [companyStyles, setCompanyStyles] = useState<PresentationStyle[]>([]);
  const [activeDeck, setActiveDeck] = useState<SavedDeck>();
  const [mapArtifact, setMapArtifact] = useState<Artifact<MindMap>>();
  const [loadedIdentity, setLoadedIdentity] = useState<string>();
  const [structuralState, setStructuralState] = useState<StructuralMapState>();
  const [structuralAttempt, setStructuralAttempt] = useState(0);
  const session = useRef<StoredSession | null>();
  // Identity of the payload last loaded or saved, so an unchanged selection is not written again.
  const savedSession = useRef<string>();
  const scopeEpoch = useRef(0);
  const sessionQueue = useRef<Promise<void>>(Promise.resolve());
  const [showAIMap, setShowAIMap] = useState(presentMindMap);
  const [narrativeSelection, setNarrativeSelection] = useState<{
    reference: VersionedId;
    sourceRevision: string;
  }>();
  const narrative =
    narrativeSelection?.sourceRevision === snapshot.revision ? narrativeSelection.reference : undefined;
  const [outlineDraft, setOutlineDraft] = useState<{ plan: StoryPlan; baseline: StoryPlan }>();
  const [stage, setStage] = useState<SlidesStage>(initialDeck && initialAction !== 'regenerate' ? 'preview' : 'setup');
  const [notice, setNotice] = useState('');
  const [upgradeRequired, setUpgradeRequired] = useState(false);
  const [outlineError, setOutlineError] = useState<SlidesWorkflowProps['outlineError']>();
  const [busy, setBusy] = useState(false);
  // Polling reports a new job object each time; only its state is shown, so an unchanged state does not render.
  const [jobState, setJobState] = useState<JobStatus['state']>();
  const generation = useRef<AbortController>();
  const [sourceNode, setSourceNode] = useState<string>();
  const [unlinkedSource, setUnlinkedSource] = useState<string>();
  const identity = `${workspaceId}:${userId}:${snapshot.pageId}`;
  const structuralKey = JSON.stringify([identity, snapshot.revision, options.includeProperties]);
  const mapContext = useRef({ key: structuralKey, canWrite });

  // An already accepted edit may finish after navigation; it must not select a previous source.
  mapContext.current = { key: structuralKey, canWrite };
  const structuralResult = structuralState?.key === structuralKey ? structuralState : undefined;
  const structuralArtifact =
    canWrite && snapshot.serverSource && structuralResult?.state === 'ready' ? structuralResult.artifact : undefined;
  const savedMapArtifact = loadedIdentity === identity ? mapArtifact : undefined;
  const currentArtifact = showAIMap ? savedMapArtifact : structuralArtifact;
  const currentMap = currentArtifact?.content;
  const mapReferences = useMemo(
    () => (currentMap ? resolveMapReferences(currentMap, snapshot) : new Map<string, string>()),
    [currentMap, snapshot]
  );
  const sourceHeadings = useMemo(() => documentOutline(splitDocument(snapshot)).headings, [snapshot]);
  const sourceMatches =
    !!activeDeck?.version && !!snapshot.serverSource && activeDeck.sourceRevision === snapshot.revision;
  // Plans are compared by serializing them, so do it when the draft changes rather than on every render.
  const outlineChanged = useMemo(
    () => !!outlineDraft && hasStoryPlanChanges(outlineDraft.plan, outlineDraft.baseline),
    [outlineDraft]
  );
  const canGenerate = !!status && canWrite && !busy && status.remainingSlides > 0;
  const canUseAI = !!status && canWrite && !busy;
  const mapUnavailable = status ? aiMapUnavailableReason(status, canWrite) : undefined;
  const canGenerateMap = canUseAI && !mapUnavailable;
  const compactSetup = mode === 'slides' && stage === 'setup';
  const plan = activeDeck?.plan;
  const upgrade = onUpgrade ?? (() => setNotice('Open workspace billing to compare plans.'));

  // Before paint, so the dialog never shows a frame of the full-size preview inside the setup popover.
  useLayoutEffect(() => {
    onSetupChange?.(compactSetup);
  }, [compactSetup, onSetupChange]);
  useEffect(() => {
    const controller = new AbortController();

    const epoch = ++scopeEpoch.current;

    setStatus(undefined);
    setActiveDeck(undefined);
    setMapArtifact(undefined);
    setLoadedIdentity(undefined);
    setCompanyStyles([]);
    setStyle(APPFLOWY_SLIDE_THEMES[0]);
    setOptions(DEFAULT_OPTIONS);
    setOutlineDraft(undefined);
    setNarrativeSelection(undefined);
    session.current = undefined;
    savedSession.current = undefined;
    sessionQueue.current = Promise.resolve();
    // The opened deck needs only its own artifact and scene, so read it beside the studio's data, not after it.
    void Promise.all([
      loadPresentation(scope, controller.signal),
      initialDeck ? loadSavedDeck(scope, initialDeck.id, initialDeck.version, controller.signal) : undefined,
    ])
      .then(([loaded, selected]) => {
        if (controller.signal.aborted || scopeEpoch.current !== epoch) return;
        session.current = loaded.session;
        savedSession.current = loaded.session ? sessionIdentity(loaded.session.payload) : undefined;
        if (selected) {
          setActiveDeck(selected);
          setStyle(selected.style);
          if (selected.options) setOptions(selected.options);
        }

        if (!initialDeck && loaded.session) {
          setOptions(uiOptions(loaded.session.payload.options));
          const selected = loaded.styles.find((item) => item.id === loaded.session?.payload.style?.id);

          if (selected) setStyle(selected);
        }

        if (!initialDeck && !loaded.session?.payload.style && loaded.status.themes[0]) {
          // A built-in theme has no style reference; the saved options carry its identity.
          const themeId = loaded.session?.payload.options.themeId;

          setStyle(themeToStyle(loaded.status.themes.find((theme) => theme.id === themeId) ?? loaded.status.themes[0]));
        }

        setStatus(loaded.status);
        setCompanyStyles(loaded.styles);
        setMapArtifact(loaded.mapArtifact);

        // With no saved AI map, present the page structure map instead.
        if (!loaded.mapArtifact) setShowAIMap(false);

        if (!initialDeck && loaded.mapArtifact?.sourceRevision)
          setNarrativeSelection({
            reference: { id: loaded.mapArtifact.id, version: loaded.mapArtifact.version },
            sourceRevision: loaded.mapArtifact.sourceRevision,
          });
        setLoadedIdentity(identity);
        setNotice(loaded.warnings?.join(' ') ?? '');
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setNotice(error.message);
      });
    return () => {
      controller.abort();
      generation.current?.abort();
    };
  }, [scope, userId, initialDeck, identity]);

  // The saved AI map view never shows the page structure, so it does not request one.
  const structuralVisible = (mapPresentationOpen || mode === 'mindmap') && !showAIMap;
  const structuralReady = structuralResult?.state === 'ready';
  const hasServerSource = !!snapshot.serverSource;

  useEffect(() => {
    if (!canWrite || !hasServerSource) {
      setStructuralState(undefined);
      return;
    }

    // A ready map for this source stays while hidden and is shown again without another request.
    if (!structuralVisible || structuralReady) return;
    const controller = new AbortController();

    setStructuralState({ key: structuralKey, state: 'loading' });
    void loadStructuralMap(scope, snapshot, { includeProperties: options.includeProperties }, controller.signal)
      .then((artifact) => {
        if (!controller.signal.aborted) setStructuralState({ key: structuralKey, state: 'ready', artifact });
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted)
          setStructuralState({ key: structuralKey, state: 'error', message: error.message });
      });
    return () => controller.abort();
    // structuralKey covers the scope, source revision and options read here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structuralKey, structuralAttempt, structuralVisible, structuralReady, canWrite, hasServerSource]);

  function persistSelection(
    artifact: VersionedId | null,
    selectedNarrative = narrative ?? null,
    mapStyle = currentArtifact?.mapStyle ?? { structure: 'right-facing' as const, branchLine: 'rounded' as const },
    selection: { style: PresentationStyle; options?: GenerationOptions } = { style, options }
  ) {
    const epoch = scopeEpoch.current;

    // Serialize this tab's optimistic session revisions; other tabs receive the server's conflict.
    sessionQueue.current = sessionQueue.current
      .then(async () => {
        if (session.current === undefined || scopeEpoch.current !== epoch) return;
        const payload = {
          artifact,
          narrative: selectedNarrative,
          style: styleReference(selection.style) ?? null,
          options: serverOptions(selection.options ?? options, selection.style),
          mapStyle,
        };
        const serialized = sessionIdentity(payload);

        // Loading or reselecting the saved state must not bump the revision-checked session.
        if (serialized === savedSession.current) return;
        const saved = await saveSession(scope, session.current?.revision ?? 0, payload);

        if (scopeEpoch.current === epoch) {
          session.current = saved;
          savedSession.current = serialized;
        }
      })
      .catch((error) => {
        if (scopeEpoch.current === epoch) report(error);
      });
  }

  useEffect(() => {
    if (!status || session.current === undefined) return;
    const timer = window.setTimeout(() => {
      persistSelection(activeDeck?.version ? { id: activeDeck.id, version: activeDeck.version } : null);
    }, 600);

    return () => window.clearTimeout(timer);
    // Only user preference changes schedule a write; artifact selection persists immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, style, status?.promptBundleVersion]);

  // Stable, and applied to the latest draft, so story cards that did not change skip rendering.
  const updatePlan = useCallback<SlidesWorkflowProps['onPlan']>(
    (next) => {
      if (!busy)
        setOutlineDraft(
          (current) => current && { ...current, plan: typeof next === 'function' ? next(current.plan) : next }
        );
    },
    [busy]
  );

  function report(error: unknown) {
    setNotice(error instanceof Error ? error.message : 'Presentation request failed.');
    setUpgradeRequired(error instanceof PresentationAPIError && error.status === 402);
  }

  function source(id: string) {
    if (onSource) onSource(id);
    else {
      setMapPresentationOpen(false);
      setSourceNode(id);
    }
  }

  function openDeck(deck: SavedDeck, review = false) {
    const source = snapshot.serverSource && snapshot.revision === deck.sourceRevision ? snapshot : undefined;

    setActiveDeck({ ...deck, source });
    // This render still holds the previous style and options, so save the deck's own.
    if (deck.version) persistSelection({ id: deck.id, version: deck.version }, undefined, undefined, deck);
    setStyle(deck.style);
    if (deck.options) setOptions(deck.options);
    setOutlineDraft(review ? { plan: structuredClone(deck.plan), baseline: structuredClone(deck.plan) } : undefined);
    setOutlineError(undefined);
    setStage(review ? 'outline' : 'preview');
    setMode('slides');
  }

  async function generate(task: 'slides' | 'mindmap', slide?: Slide, editedPlan?: StoryPlan) {
    if (busy || !status) return;
    if (task === 'slides' && activeDeck && !sourceMatches) {
      report(
        new PresentationAPIError(
          'Select the original, unchanged source before regenerating this saved presentation.',
          'SOURCE_REVISION_CONFLICT',
          409
        )
      );
      return;
    }

    const controller = new AbortController();

    generation.current = controller;
    setBusy(true);
    setJobState(undefined);
    setNotice('');
    setUpgradeRequired(false);
    setOutlineError(undefined);
    try {
      const sourceSnapshot = {
        ...(await loadSourceSnapshot(workspaceId, snapshot.pageId, options, controller.signal, style)),
        kind: snapshot.kind,
      };

      if (controller.signal.aborted) return;
      setSnapshot(sourceSnapshot);
      if (task === 'slides' && activeDeck && activeDeck.sourceRevision !== sourceSnapshot.revision)
        throw new PresentationAPIError(
          'The source changed. Start a new presentation from the updated page.',
          'SOURCE_REVISION_CONFLICT',
          409
        );
      const currentNarrative =
        narrativeSelection?.sourceRevision === sourceSnapshot.revision ? narrativeSelection.reference : undefined;
      const result = await runGeneration(
        {
          scope,
          task,
          source: sourceSnapshot,
          options,
          style,
          ...(task === 'slides' && activeDeck && { artifact: regenerationReference(activeDeck, sourceSnapshot) }),
          ...(currentNarrative && { narrative: currentNarrative }),
          ...(slide && { targetSlideIds: [slide.id] }),
          ...(editedPlan && { storyPlan: editedPlan, storyPlanSourceRevision: activeDeck!.sourceRevision }),
        },
        controller.signal,
        (next) => setJobState(next.state)
      );

      if (controller.signal.aborted) return;
      setStatus(result.status);
      if (result.deck) {
        openDeck(result.deck, !editedPlan && !slide && !!options.reviewOutline);
      } else if (result.map) {
        setMapArtifact(result.artifact as Artifact<MindMap>);
        setShowAIMap(true);
        setMode('mindmap');
        persistSelection(
          { id: result.artifact.id, version: result.artifact.version },
          { id: result.artifact.id, version: result.artifact.version }
        );
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        if (editedPlan)
          setOutlineError({
            message: error instanceof Error ? error.message : 'Regeneration failed.',
            code: error instanceof PresentationAPIError ? error.code : 'REGENERATION_FAILED',
            upgradeRequired: error instanceof PresentationAPIError && error.status === 402,
          });
        else report(error);
      }
    } finally {
      if (generation.current === controller) setBusy(false);
    }
  }

  async function applyOutline() {
    if (!outlineDraft || busy) return;
    if (!outlineChanged) {
      // Initial outline acceptance opens the already persisted artifact without another AI request.
      setOutlineDraft(undefined);
      setStage('preview');
      return;
    }

    await generate('slides', undefined, prepareStoryPlan(outlineDraft.plan, outlineDraft.baseline));
  }

  async function saveMap(map: MindMap, mapStyle = currentArtifact?.mapStyle) {
    if (!currentArtifact) throw new Error('Save a source-linked mind map before editing.');
    const key = structuralKey;
    const updated = await editMap(scope, {
      id: currentArtifact.id,
      expectedVersion: currentArtifact.version,
      map,
      style: mapStyle,
    });

    if (mapContext.current.key !== key || !mapContext.current.canWrite) {
      throw new Error('The source or your access changed. Reopen the map before editing.');
    }

    if (showAIMap) {
      setMapArtifact(updated);
    } else setStructuralState({ key: structuralKey, state: 'ready', artifact: updated });
    persistSelection(
      { id: updated.id, version: updated.version },
      { id: updated.id, version: updated.version },
      updated.mapStyle
    );
  }

  const structures = {
    'right-facing': 'right',
    'left-facing': 'left',
    'two-sided': 'balanced',
    'top-down': 'down',
  } as const;
  const wireStructures = {
    right: 'right-facing',
    left: 'left-facing',
    balanced: 'two-sided',
    down: 'top-down',
  } as const;

  // Only the local source dialog shows this; the app navigates through onSource and never opens it.
  const selectedSource = useMemo(
    () =>
      !sourceNode
        ? undefined
        : sourceNode === snapshot.pageId
        ? snapshot.title
        : flattenBlocks(snapshot.blocks).find((block) => block.id === sourceNode)?.text ??
          snapshot.properties.find((property) => property.id === sourceNode)?.value,
    [sourceNode, snapshot]
  );
  const closeMapPresentation = () => {
    setMapPresentationOpen(false);
    if (presentMindMap) onClose?.();
  };

  // Loading the saved map and then the page structure reads as one step while presenting.
  const mapLoading = showAIMap
    ? loadedIdentity !== identity
    : canWrite && !!snapshot.serverSource && structuralResult?.state !== 'error' && structuralResult?.state !== 'ready';
  const mapViewer = currentMap?.nodes.length ? (
    <MindMapViewer
      // Another map starts with its own view state; edits keep the artifact ID, so they keep it.
      key={currentArtifact?.id}
      map={currentMap}
      origin={showAIMap ? (savedMapArtifact?.origin === 'ai' ? 'ai' : 'imported') : undefined}
      onUpgrade={upgrade}
      canGenerate={canGenerateMap}
      onGenerate={() => {
        void generate('mindmap');
      }}
      onMapChange={currentArtifact && canWrite ? saveMap : undefined}
      mapStyle={
        currentArtifact
          ? {
              structure: structures[currentArtifact.mapStyle.structure],
              branchLine: currentArtifact.mapStyle.branchLine,
            }
          : undefined
      }
      onStyleChange={
        currentArtifact && canWrite
          ? async (next) => {
              const wire: MindMapStyle = { structure: wireStructures[next.structure], branchLine: next.branchLine };

              await saveMap(currentMap, wire);
            }
          : undefined
      }
      onSlides={() => {
        if (!currentArtifact?.sourceRevision) {
          setNotice('Generate a mind map from the current source to use it as a presentation narrative.');
          return;
        }

        setNarrativeSelection({
          reference: { id: currentArtifact.id, version: currentArtifact.version },
          sourceRevision: currentArtifact.sourceRevision,
        });
        persistSelection(null, { id: currentArtifact.id, version: currentArtifact.version });
        setActiveDeck(undefined);
        setStage('setup');
        setMode('slides');
      }}
      onSource={(id) => {
        if (showAIMap && savedMapArtifact?.sourceRevision !== snapshot.revision) {
          setUnlinkedSource(id);
          return;
        }

        const blockId = mapReferences.get(id);

        if (blockId) source(blockId);
        else setUnlinkedSource(id);
      }}
      onClosePresentation={mapPresentationOpen ? closeMapPresentation : undefined}
    />
  ) : mapPresentationOpen && mapLoading ? (
    <MindMapLoading onClose={closeMapPresentation} />
  ) : (
    <section
      className={mapPresentationOpen ? 'ps-map-presentation-status' : 'ps-page'}
      aria-label='Mind map availability'
    >
      {showAIMap ? (
        <p role='status'>
          {loadedIdentity !== identity
            ? 'Loading saved mind map…'
            : currentMap
            ? 'The saved mind map has no nodes to display.'
            : 'No saved mind map is selected.'}
        </p>
      ) : !canWrite ? (
        <p role='status'>
          Editor access is required to create a map from page structure. You can view an authorized saved mind map.
        </p>
      ) : !snapshot.serverSource ? (
        <p role='status'>Reload the source before creating a map from page structure.</p>
      ) : structuralResult?.state === 'error' ? (
        <>
          <p role='alert'>Could not load the page structure map. {structuralResult.message}</p>
          <Action onClick={() => setStructuralAttempt((attempt) => attempt + 1)}>Retry page structure</Action>
        </>
      ) : structuralResult?.state === 'ready' ? (
        <p role='status'>The source has no content to show as a mind map.</p>
      ) : (
        <p role='status'>Loading page structure…</p>
      )}
      {canGenerateMap && <Action onClick={() => void generate('mindmap')}>Generate AI mind map</Action>}
      {mapPresentationOpen && <Action onClick={closeMapPresentation}>Back to page</Action>}
    </section>
  );

  return (
    <div
      className={`ps-root ps-studio ${compactSetup ? 'ps-compact-setup' : ''} ${
        mode === 'slides' && !compactSetup ? 'ps-slides-window' : ''
      } ${mode === 'slides' && stage === 'preview' ? 'ps-slide-preview-window' : ''} ${
        mapPresentationOpen ? 'ps-map-presenting' : ''
      }`}
    >
      <div className='ps-main'>
        {mode !== 'slides' && !mapPresentationOpen && (
          <header className='ps-topbar ps-app-toolbar'>
            <Action onClick={onClose} aria-label='Back to page'>
              <ArrowLeft size={16} />
              <span>{snapshot.title}</span>
            </Action>
            <nav className='ps-segmented' aria-label='Page presentation tools'>
              {(
                [
                  ['slides', 'AI Slides'],
                  ['mindmap', 'Mind map'],
                  ['source', 'Source'],
                ] as const
              ).map(([id, label]) => (
                <button key={id} aria-pressed={mode === id} onClick={() => setMode(id)}>
                  {label}
                </button>
              ))}
            </nav>
            <Action onClick={() => setDocumentOpen(true)}>
              <Play size={15} />
              Present document
            </Action>
          </header>
        )}
        <main className='ps-content'>
          {notice &&
            (upgradeRequired ? <PresentationPaywall message={notice} onUpgrade={upgrade} /> : <Notice>{notice}</Notice>)}
          {busy && !compactSetup && (
            <Notice>
              {jobState ? `Presentation ${jobState}…` : 'Preparing your presentation…'}{' '}
              <Action
                onClick={() => {
                  generation.current?.abort();
                }}
              >
                Cancel
              </Action>
            </Notice>
          )}
          {mode === 'slides' && (
            <>
              {activeDeck && !sourceMatches && (
                <Notice>
                  This saved presentation uses a different source revision. Preview and download remain available. Select
                  its original source to edit or regenerate, or{' '}
                  <Action
                    onClick={() => {
                      void loadSourceSnapshot(workspaceId, snapshot.pageId, options, undefined, style)
                        .then((value) => {
                          setSnapshot({ ...value, kind: snapshot.kind });
                          if (value.revision !== activeDeck.sourceRevision)
                            setNotice('The selected source does not match this saved presentation.');
                        })
                        .catch(report);
                    }}
                  >
                    check the selected source
                  </Action>
                  , or{' '}
                  <Action
                    onClick={() => {
                      setActiveDeck(undefined);
                      setStage('setup');
                    }}
                  >
                    start a new presentation
                  </Action>
                  .
                </Notice>
              )}
              <SlidesWorkflow
                scope={scope}
                snapshot={snapshot}
                sourceSnapshot={sourceMatches ? snapshot : activeDeck?.source ?? snapshot}
                activeDeck={activeDeck}
                busy={busy}
                options={options}
                onOptions={setOptions}
                onCancel={busy ? () => generation.current?.abort() : onClose}
                styles={[...companyStyles, ...(status?.themes.map(themeToStyle) ?? [])]}
                style={style}
                onStyle={setStyle}
                plan={outlineDraft?.plan ?? plan}
                onPlan={updatePlan}
                stage={stage}
                onStage={(next) => {
                  setOutlineError(undefined);
                  if (next === 'story' && plan && sourceMatches)
                    setOutlineDraft({ plan: structuredClone(plan), baseline: structuredClone(plan) });
                  else setOutlineDraft(undefined);
                  setStage(next);
                }}
                onGenerate={(slide) => {
                  void generate('slides', slide);
                }}
                onSource={(id) => {
                  if (sourceMatches) source(id);
                  else setUnlinkedSource(id);
                }}
                hasOutlineChanges={outlineChanged}
                outlineError={outlineError}
                onApplyOutline={applyOutline}
                onDiscardOutline={() => {
                  setOutlineDraft(undefined);
                  setOutlineError(undefined);
                  setStage(plan ? 'preview' : 'setup');
                }}
                exportReady={!!activeDeck?.version && !!status && canWrite}
                initialAction={initialAction}
                onDownload={async (requestId, signal, onJob) => {
                  if (!canWrite || !activeDeck?.version)
                    throw new Error('Editor access to a saved presentation is required for downloading.');
                  const result = await exportDeck(
                    scope,
                    { id: activeDeck.id, version: activeDeck.version },
                    requestId,
                    signal,
                    onJob
                  );

                  setStatus(result.status);
                  return result;
                }}
                onStyles={() => setMode('styles')}
                canGenerate={canGenerate}
                canEdit={canWrite && !busy && sourceMatches}
                maxSlides={status?.maxSlides}
                remainingSlides={status?.remainingSlides}
                onUpgrade={onUpgrade ?? (() => setNotice('Open workspace billing to compare plans.'))}
                sourceChanged={!!activeDeck && !sourceMatches}
                hasNarrative={!!narrative}
                origin={activeDeck ? 'Saved presentation' : 'Current page'}
                sourceRevision={activeDeck?.sourceRevision}
              />
            </>
          )}
          {mode === 'mindmap' && !mapPresentationOpen && (
            <>
              <div className='ps-map-mode-bar'>
                <div className='ps-segmented'>
                  <button aria-pressed={!showAIMap} onClick={() => setShowAIMap(false)}>
                    From page structure
                  </button>
                  <button aria-pressed={showAIMap} disabled={!savedMapArtifact} onClick={() => setShowAIMap(true)}>
                    Saved mind map
                  </button>
                </div>
              </div>
              {showAIMap && savedMapArtifact && savedMapArtifact.sourceRevision !== snapshot.revision && (
                <Notice>
                  This saved map uses another source revision. Its references will not navigate to this page.
                </Notice>
              )}
              {!canGenerateMap && (
                <Notice>
                  {!status
                    ? 'Loading AI access…'
                    : `${mapUnavailable ?? 'AI generation is unavailable.'} You can still view saved maps that you have access to.`}
                </Notice>
              )}
              {mapViewer}
            </>
          )}
          {mode === 'styles' && (
            <StyleSettings
              styles={companyStyles}
              onChange={async (styles) => setCompanyStyles(styles)}
              scope={scope}
              editable={canManageStyles}
            />
          )}
          {mode === 'source' && (
            <div className='ps-page'>
              <div className='ps-page-heading'>
                <div>
                  <FileText size={18} />
                  <h1>{snapshot.title}</h1>
                  <p>A read-only source. Your original page is unchanged.</p>
                </div>
                <Action onClick={() => setDocumentOpen(true)}>
                  <Play size={15} />
                  Present document
                </Action>
              </div>
              <DocumentContentProvider>
                <DocumentOutlineContext.Provider value={{ headings: sourceHeadings, onNavigate: source }}>
                  <div className='ps-source-document'>
                    {snapshot.properties.length > 0 && (
                      <dl className='ps-properties'>
                        {snapshot.properties.map((property) => (
                          <div key={property.id}>
                            <dt>{property.name}</dt>
                            <dd>{String(property.value ?? 'Not provided')}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    {snapshot.blocks.map((block) => (
                      <section key={block.id}>
                        <BlockContent block={block} onSource={source} />
                      </section>
                    ))}
                  </div>
                </DocumentOutlineContext.Provider>
              </DocumentContentProvider>
            </div>
          )}
          {mapPresentationOpen && mapViewer}
        </main>
      </div>
      {documentOpen && (
        <DocumentPresenter
          snapshot={snapshot}
          onClose={() => setDocumentOpen(false)}
          onSource={(id) => {
            setDocumentOpen(false);
            source(id);
          }}
        />
      )}
      <Dialog open={!!sourceNode} onClose={() => setSourceNode(undefined)} maxWidth='sm' fullWidth>
        <div className='ps-root ps-source-dialog'>
          <h2>{snapshot.title}</h2>
          <code>{sourceNode}</code>
          <p>{String(selectedSource ?? 'Source content is unavailable.')}</p>
          <Action onClick={() => setSourceNode(undefined)}>Back to preview</Action>
        </div>
      </Dialog>
      <Dialog open={!!unlinkedSource} onClose={() => setUnlinkedSource(undefined)} maxWidth='sm' fullWidth>
        <div className='ps-root ps-source-dialog'>
          <h2>Source reference</h2>
          <p>{unlinkedSource}</p>
          <p>Select the original source page and revision to follow this reference.</p>
          <Action onClick={() => setUnlinkedSource(undefined)}>
            <X size={14} />
            Close
          </Action>
        </div>
      </Dialog>
    </div>
  );
}
