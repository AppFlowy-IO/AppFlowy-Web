import Dialog from '@mui/material/Dialog';
import { ArrowLeft, ArrowRight, Download, X } from 'lucide-react';
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

import { ReactComponent as MoveDownIcon } from '@/assets/icons/arrow_down.svg';
import { ReactComponent as BackIcon } from '@/assets/icons/arrow_left.svg';
import { ReactComponent as MoveUpIcon } from '@/assets/icons/arrow_up.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as DownloadIcon } from '@/assets/icons/download.svg';
import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';
import { ReactComponent as ErrorIcon } from '@/assets/icons/error.svg';
import { ReactComponent as PresentIcon } from '@/assets/icons/full_screen.svg';
import { ReactComponent as RegenerateIcon } from '@/assets/icons/regenerate.svg';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TextareaAutosize } from '@/components/ui/textarea-autosize';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import FullscreenControl from './FullscreenControl';
import { PresentationAPIError } from './presentation-client';
import PresentationPaywall from './PresentationPaywall';
import PresentationSettingsDropdown from './PresentationSettingsDropdown';
import ServerSlideCanvas, { ServerSlideSceneProvider } from './ServerSlideCanvas';
import { describeSlideSources, numberSlideSources, slideSourceIds } from './slide-sources';
import SlideGenerationSetup from './SlideGenerationSetup';
import {
  GenerationOptions,
  DeckAction,
  LAYOUTS,
  PageSnapshot,
  PresentationStyle,
  SavedDeck,
  Slide,
  SlideAssessment,
  SlidesStage,
  StoryPlan,
} from './types';
import { Action, Notice, SourceLinks } from './ui';
import { usePresentationFullscreen } from './usePresentationFullscreen';

import type { JobStatus } from './server-contract';

export interface SlidesWorkflowProps {
  snapshot: PageSnapshot;
  sourceSnapshot?: PageSnapshot;
  options: GenerationOptions;
  onOptions: (options: GenerationOptions) => void;
  onCancel?: () => void;
  styles: PresentationStyle[];
  style: PresentationStyle;
  onStyle: (style: PresentationStyle) => void;
  plan?: StoryPlan;
  activeDeck?: SavedDeck;
  /** Accepts an updater so edits apply to the latest plan through stable callbacks. */
  onPlan: Dispatch<SetStateAction<StoryPlan>>;
  stage: SlidesStage;
  onStage: (stage: SlidesStage) => void;
  onGenerate: (slide?: Slide) => void;
  onSource: (id: string) => void;
  onApplyOutline: () => Promise<void>;
  hasOutlineChanges: boolean;
  outlineError?: { code: string; message: string; upgradeRequired: boolean };
  onDiscardOutline: () => void;
  onStyles: () => void;
  canGenerate: boolean;
  canAssess?: boolean;
  promptBundleVersion?: string;
  assessmentCache?: Map<string, SlideAssessment>;
  canEdit: boolean;
  canRegenerate?: boolean;
  remainingSlides?: number | null;
  maxSlides?: number;
  maxTemplateBytes?: number;
  onUpgrade: () => void;
  lab?: boolean;
  sourceChanged: boolean;
  hasNarrative: boolean;
  origin: string;
  sourceRevision?: string;
  exportReady?: boolean;
  onDownload?: (
    requestId: string,
    signal: AbortSignal,
    onJob?: (job: JobStatus) => void
  ) => Promise<{ blob: Blob; fileName: string }>;
  initialAction?: DeckAction;
  scope?: { workspaceId: string; pageId: string; userId?: string };
  busy?: boolean;
  reuse?: { available: boolean; checking: boolean; error?: string; onOpen: () => void; onRetry: () => void };
}

const LAYOUT_OPTIONS = LAYOUTS.map((layout) => ({
  value: layout,
  label: layout === 'kpi' ? 'KPI' : layout.charAt(0).toUpperCase() + layout.slice(1),
}));

interface StoryCardProps {
  slide: Slide;
  index: number;
  count: number;
  fieldsId: string;
  busy?: boolean;
  onUpdate: (id: string, patch: Partial<Slide>) => void;
  onMove: (id: string, offset: number) => void;
  onRemove: (id: string) => void;
}

/** With stable callbacks, a keystroke renders only the edited card, not every card in the story. */
const StoryCard = memo(function StoryCard({
  slide,
  index,
  count,
  fieldsId,
  busy,
  onUpdate,
  onMove,
  onRemove,
}: StoryCardProps) {
  return (
    <article className='ps-story-card'>
      <div className='ps-story-number'>{String(index + 1).padStart(2, '0')}</div>
      <div className='ps-story-content'>
        <div className='ps-story-field-row'>
          <div className='ps-story-field'>
            <Label htmlFor={`${fieldsId}-${slide.id}-title`} className='text-sm font-medium leading-5 text-text-primary'>
              Slide title
            </Label>
            <Input
              id={`${fieldsId}-${slide.id}-title`}
              placeholder='Enter a slide title'
              className='w-full'
              aria-label={`Slide ${index + 1} title`}
              disabled={busy}
              maxLength={160}
              value={slide.title}
              onChange={(e) => onUpdate(slide.id, { title: e.target.value })}
            />
          </div>
          <PresentationSettingsDropdown
            className='ps-story-field'
            labelClassName='text-sm font-medium leading-5 text-text-primary'
            label='Layout'
            ariaLabel={`Slide ${index + 1} layout`}
            disabled={busy}
            value={slide.layout}
            options={LAYOUT_OPTIONS}
            onValueChange={(layout) => onUpdate(slide.id, { layout: layout as Slide['layout'] })}
          />
        </div>
        <div className='ps-story-field'>
          <Label htmlFor={`${fieldsId}-${slide.id}-message`} className='text-sm font-medium leading-5 text-text-primary'>
            Key takeaway
          </Label>
          <TextareaAutosize
            id={`${fieldsId}-${slide.id}-message`}
            placeholder='Add a key takeaway'
            aria-label={`Slide ${index + 1} key takeaway`}
            className='w-full py-2 text-text-primary'
            disabled={busy}
            minRows={2}
            maxLength={400}
            value={slide.message}
            onChange={(e) => onUpdate(slide.id, { message: e.target.value })}
          />
        </div>
        <div className='ps-story-field'>
          <Label htmlFor={`${fieldsId}-${slide.id}-points`} className='text-sm font-medium leading-5 text-text-primary'>
            Supporting points
          </Label>
          <TextareaAutosize
            id={`${fieldsId}-${slide.id}-points`}
            placeholder='Add supporting points'
            aria-label={`Slide ${index + 1} supporting points`}
            className='w-full py-2 text-text-primary'
            disabled={busy}
            minRows={2}
            value={slide.points.join('\n')}
            onChange={(e) =>
              onUpdate(slide.id, {
                points: e.target.value
                  .split('\n')
                  .slice(0, 3)
                  .map((point) => point.slice(0, 180)),
              })
            }
          />
        </div>
      </div>
      <div className='ps-story-actions'>
        {[
          {
            label: `Move slide ${index + 1} up`,
            Icon: MoveUpIcon,
            disabled: !index,
            onClick: () => onMove(slide.id, -1),
          },
          {
            label: `Move slide ${index + 1} down`,
            Icon: MoveDownIcon,
            disabled: index === count - 1,
            onClick: () => onMove(slide.id, 1),
          },
          {
            label: `Remove slide ${index + 1}`,
            Icon: DeleteIcon,
            disabled: count === 1,
            danger: true,
            onClick: () => onRemove(slide.id),
          },
        ].map(({ label, Icon, disabled, danger, onClick }) => (
          <Tooltip key={label}>
            <TooltipTrigger asChild>
              <span className='inline-flex'>
                <Button
                  variant='ghost'
                  size='icon-lg'
                  aria-label={label}
                  disabled={busy || disabled}
                  danger={danger}
                  onClick={onClick}
                >
                  <Icon className='h-5 w-5' aria-hidden='true' />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side='left' className='z-[1500] bg-fill-toolbar text-icon-on-toolbar'>
              {label}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </article>
  );
});

export default function SlidesWorkflow(props: SlidesWorkflowProps) {
  const {
    snapshot,
    sourceSnapshot = snapshot,
    style,
    plan,
    onPlan,
    stage,
    onStage,
    onSource,
    onApplyOutline,
    onDiscardOutline,
    lab = false,
    sourceChanged,
    origin,
    sourceRevision,
    exportReady = false,
    onDownload,
    initialAction,
  } = props;
  const [index, setIndex] = useState(0);
  const [presenting, setPresenting] = useState(initialAction === 'present');
  const [downloadOpen, setDownloadOpen] = useState(initialAction === 'download');
  const [notice, setNotice] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [downloadUpgrade, setDownloadUpgrade] = useState(false);
  const retryId = useRef<string>();
  const downloadController = useRef<AbortController>();
  const previewRef = useRef<HTMLDivElement>(null);
  const fieldsId = useId();
  const outlineErrorId = `${fieldsId}-regeneration-error`;
  const sourceDetails = useMemo(
    () => (sourceChanged ? new Map() : describeSlideSources(sourceSnapshot)),
    [sourceChanged, sourceSnapshot]
  );
  const sourceReferences = useMemo(() => numberSlideSources(plan, sourceDetails), [plan, sourceDetails]);

  useEffect(() => () => downloadController.current?.abort(), []);
  useEffect(() => {
    downloadController.current?.abort();
    retryId.current = undefined;
    setDownloading(false);
    setDownloadError('');
    setDownloadUpgrade(false);
  }, [props.activeDeck?.id, props.activeDeck?.version]);
  const selectedIndex = Math.min(index, Math.max(0, (plan?.slides.length ?? 1) - 1));
  const slide = plan?.slides[selectedIndex];
  const slideCount = plan?.slides.length ?? 0;

  useEffect(() => {
    if (stage !== 'preview' || presenting || downloadOpen || !slideCount) return;
    // The Generate button unmounts when preview opens; move its focus into the preview.
    previewRef.current?.focus({ preventScroll: true });
    const navigate = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        !['ArrowLeft', 'ArrowRight'].includes(event.key)
      )
        return;
      const target = event.target instanceof Element ? event.target : null;
      const preview = previewRef.current;

      if (!target || !preview) return;
      const dialog = preview.closest('[role="dialog"]');

      // Do not navigate behind a separate dialog or while interacting elsewhere in the lab.
      if (dialog ? target.closest('[role="dialog"]') !== dialog : !preview.contains(target) && target !== document.body)
        return;
      if (
        target.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="slider"], [role="menu"], [role="listbox"], [role="tablist"]'
        )
      )
        return;
      event.preventDefault();
      const offset = event.key === 'ArrowRight' ? 1 : -1;

      setIndex((current) => Math.max(0, Math.min(slideCount - 1, Math.min(current, slideCount - 1) + offset)));
    };

    window.addEventListener('keydown', navigate);
    return () => window.removeEventListener('keydown', navigate);
  }, [stage, presenting, downloadOpen, slideCount]);

  // Stable story-card callbacks: each applies to the latest plan rather than the one this render read.
  const updateSlide = useCallback(
    (id: string, patch: Partial<Slide>) =>
      onPlan((current) => ({
        ...current,
        slides: current.slides.map((s) =>
          s.id === id
            ? {
                ...s,
                ...patch,
                ...((patch.message !== undefined || patch.points !== undefined) && { templateContent: undefined }),
              }
            : s
        ),
      })),
    [onPlan]
  );
  const moveSlide = useCallback(
    (id: string, offset: number) =>
      onPlan((current) => {
        const slides = [...current.slides];
        const from = slides.findIndex((s) => s.id === id);
        const to = from + offset;

        if (to < 0 || to >= slides.length) return current;
        [slides[from], slides[to]] = [slides[to], slides[from]];
        return { ...current, slides };
      }),
    [onPlan]
  );
  const removeSlide = useCallback(
    (id: string) => onPlan((current) => ({ ...current, slides: current.slides.filter((s) => s.id !== id) })),
    [onPlan]
  );

  function closeDownload() {
    downloadController.current?.abort();
    setDownloadOpen(false);
  }

  async function download() {
    if (!onDownload || downloading) return;
    const controller = new AbortController();

    downloadController.current = controller;
    const requestId = retryId.current ?? crypto.randomUUID();

    retryId.current = requestId;
    setDownloading(true);
    setDownloadError('');
    setDownloadUpgrade(false);
    try {
      const result = await onDownload(requestId, controller.signal, (job) => {
        if (job.state === 'failed' || job.state === 'canceled') retryId.current = undefined;
      });

      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement('a');

      link.href = url;
      link.download = result.fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      retryId.current = undefined;
      setDownloadOpen(false);
      setNotice('PowerPoint downloaded. You can continue viewing and presenting this deck.');
    } catch (e) {
      if (!controller.signal.aborted) {
        setDownloadError((e as Error).message);
        setDownloadUpgrade(e instanceof PresentationAPIError && e.status === 402);
      }
    } finally {
      if (downloadController.current === controller) setDownloading(false);
    }
  }

  const content = (
    <div className='ps-slides-workflow'>
      {stage === 'setup' ? (
        <SlideGenerationSetup props={props} scope={props.scope} busy={props.busy} />
      ) : (stage === 'story' || stage === 'outline') && plan ? (
        <div className='ps-page ps-story-page'>
          <div className='ps-page-heading'>
            <h1>Edit story plan</h1>
          </div>
          {sourceChanged && (
            <Notice>Source changed since generation. Your saved plan remains unchanged. Regenerate when ready.</Notice>
          )}
          <div className='ps-story-field ps-story-title-field'>
            <Label htmlFor={`${fieldsId}-title`} className='text-sm font-medium leading-5 text-text-primary'>
              Presentation title
            </Label>
            <Input
              id={`${fieldsId}-title`}
              placeholder='Enter a presentation title'
              className='w-full'
              disabled={props.busy}
              value={plan.title}
              onChange={(e) => onPlan({ ...plan, title: e.target.value })}
            />
          </div>
          <div className='ps-story-list'>
            {plan.slides.map((s, i) => (
              <StoryCard
                key={s.id}
                slide={s}
                index={i}
                count={plan.slides.length}
                fieldsId={fieldsId}
                busy={props.busy}
                onUpdate={updateSlide}
                onMove={moveSlide}
                onRemove={removeSlide}
              />
            ))}
          </div>
          <div className='ps-create-footer ps-outline-footer' role='group' aria-label='Outline actions'>
            {props.outlineError && (
              <div className='ps-outline-error' role='alert' id={outlineErrorId}>
                <div className='flex items-center gap-2 text-sm font-medium text-text-primary'>
                  <ErrorIcon className='h-5 w-5 shrink-0 text-text-error' aria-hidden='true' />
                  {props.outlineError.code === 'SOURCE_REVISION_CONFLICT'
                    ? 'Document changed'
                    : 'Couldn’t regenerate slides'}
                </div>
                <p className='ps-outline-error-message'>{props.outlineError.message}</p>
                <div className='mt-2 text-xs leading-4 text-text-secondary'>
                  Error code: <code className='break-words'>{props.outlineError.code}</code>
                </div>
                {props.outlineError.upgradeRequired && (
                  <Button variant='link' className='mt-2 px-0' onClick={props.onUpgrade}>
                    Upgrade to Pro
                  </Button>
                )}
              </div>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className='inline-flex'>
                  <Button
                    variant='ghost'
                    size='icon-lg'
                    className='h-9 w-9 text-icon-on-toolbar hover:bg-transparent hover:text-text-action disabled:bg-transparent disabled:text-line-on-toolbar'
                    aria-label='Back without saving'
                    disabled={props.busy}
                    onClick={onDiscardOutline}
                  >
                    <BackIcon className='h-5 w-5' aria-hidden='true' />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side='top' sideOffset={12} className='z-[1500] bg-fill-toolbar text-icon-on-toolbar'>
                Back without saving
              </TooltipContent>
            </Tooltip>
            <span className='ps-outline-toolbar-divider' aria-hidden='true' />
            <Tooltip>
              <TooltipTrigger asChild>
                <span className='inline-flex'>
                  <Button
                    variant='ghost'
                    size='icon-lg'
                    className='h-9 w-9 text-icon-on-toolbar hover:bg-transparent hover:text-text-action disabled:bg-transparent disabled:text-line-on-toolbar'
                    aria-label={
                      props.busy
                        ? 'Regenerating…'
                        : stage === 'outline'
                        ? 'Generate presentation'
                        : 'Save and regenerate'
                    }
                    disabled={!props.canEdit || props.busy || (stage === 'story' && !props.hasOutlineChanges)}
                    aria-describedby={props.outlineError ? outlineErrorId : undefined}
                    onClick={() => void onApplyOutline()}
                  >
                    <RegenerateIcon className='h-5 w-5' aria-hidden='true' />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side='top' sideOffset={12} className='z-[1500] bg-fill-toolbar text-icon-on-toolbar'>
                {props.busy ? 'Regenerating…' : stage === 'outline' ? 'Generate presentation' : 'Save and regenerate'}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      ) : plan && slide ? (
        <div className='ps-deck-preview' ref={previewRef} tabIndex={-1}>
          <header className='ps-preview-heading'>
            <div className='ps-preview-title'>
              <h2 title={plan.title}>{plan.title}</h2>
              <p>
                {style.name} · {plan.slides.length} slides · {origin}
              </p>
            </div>
            <div className='ps-preview-actions' role='group' aria-label='Presentation preview actions'>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant='ghost'
                    size='icon-lg'
                    aria-label='Edit story plan'
                    disabled={!props.canEdit}
                    onClick={() => onStage('story')}
                  >
                    <EditIcon className='h-5 w-5' aria-hidden='true' />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className='z-[1500]'>Edit story plan</TooltipContent>
              </Tooltip>
              <Button
                variant='outline'
                disabled={!(props.canRegenerate ?? props.canEdit)}
                onClick={() => onStage('setup')}
              >
                <RegenerateIcon className='h-4 w-4' aria-hidden='true' />
                Regenerate
              </Button>
              <Button
                variant='outline'
                disabled={!exportReady}
                onClick={() => {
                  setDownloadOpen(true);
                  setNotice('');
                }}
              >
                <DownloadIcon className='h-4 w-4' aria-hidden='true' />
                Export PPTX
              </Button>
              <Button onClick={() => setPresenting(true)}>
                <PresentIcon className='h-4 w-4' aria-hidden='true' />
                Present
              </Button>
            </div>
          </header>
          {sourceChanged && (
            <Notice>
              The page has changed since this presentation was saved. Regenerate to use its current content.
            </Notice>
          )}
          <div className='ps-preview-layout'>
            <nav className='ps-thumbnails' aria-label='Slides'>
              {plan.slides.map((s, i) => (
                <button
                  key={s.id}
                  aria-label={`Preview slide ${i + 1}: ${s.title}`}
                  aria-current={selectedIndex === i ? 'true' : undefined}
                  className={selectedIndex === i ? 'ps-thumb-selected' : ''}
                  onClick={() => setIndex(i)}
                >
                  <span>{i + 1}</span>
                  <ServerSlideCanvas index={i} miniature />
                </button>
              ))}
            </nav>
            <div className='ps-preview-main'>
              <ServerSlideCanvas index={selectedIndex} />
              <div className='ps-inline ps-between ps-preview-controls'>
                <Button
                  variant='ghost'
                  size='icon'
                  disabled={!selectedIndex}
                  aria-label='Previous slide'
                  aria-keyshortcuts='ArrowLeft'
                  onClick={() => setIndex(selectedIndex - 1)}
                >
                  <ArrowLeft size={16} />
                </Button>
                <span>
                  {selectedIndex + 1} / {plan.slides.length}
                </span>
                <Button
                  variant='ghost'
                  size='icon'
                  disabled={selectedIndex === plan.slides.length - 1}
                  aria-label='Next slide'
                  aria-keyshortcuts='ArrowRight'
                  onClick={() => setIndex(selectedIndex + 1)}
                >
                  <ArrowRight size={16} />
                </Button>
              </div>
              <details className='ps-details'>
                <summary>Sources & speaker notes</summary>
                <SourceLinks ids={slideSourceIds(slide)} references={sourceReferences} onSource={onSource} />
                <p className='ps-notes'>{slide.notes || 'No speaker notes.'}</p>
                {slide.warnings.map((warning) => (
                  <Notice key={warning}>{warning}</Notice>
                ))}
              </details>
              <p className='ps-muted'>
                Source version {sourceRevision || snapshot.revision} ·{' '}
                {exportReady
                  ? 'Preview and editable PowerPoint use the same slide layouts.'
                  : 'Reload the saved presentation to enable export.'}
              </p>
            </div>
          </div>
        </div>
      ) : null}
      {notice && !downloadOpen && <Notice>{notice}</Notice>}
      {presenting && plan && (
        <DeckPresenter plan={plan} initialIndex={selectedIndex} onClose={() => setPresenting(false)} />
      )}
      <Dialog open={downloadOpen} onClose={closeDownload} maxWidth='sm' fullWidth>
        <div className='ps-root ps-download-dialog'>
          <div className='ps-icon-tile'>
            <Download size={25} />
          </div>
          <h2>{!lab && !exportReady ? 'PowerPoint download unavailable' : 'Your presentation, ready to go.'}</h2>
          <p>
            {!lab && !exportReady
              ? 'You can view this saved presentation. Download requires editor access and a current server artifact.'
              : 'Download an editable PowerPoint with your selected presentation style.'}
          </p>
          {!exportReady && (
            <Notice>Reload the saved presentation and check your workspace access before downloading.</Notice>
          )}
          {style.compatibilityWarnings?.map((w) => (
            <Notice key={w}>{w}</Notice>
          ))}
          {downloadError &&
            (downloadUpgrade ? (
              <PresentationPaywall message={downloadError} onUpgrade={props.onUpgrade} />
            ) : (
              <Notice>{downloadError} Retry resumes the same download request.</Notice>
            ))}
          <div className='ps-inline'>
            <Action onClick={closeDownload}>{downloading ? 'Cancel download' : 'Back to preview'}</Action>
            <Action
              primary
              disabled={!exportReady || downloading}
              onClick={() => {
                void download();
              }}
            >
              {downloading ? 'Preparing PowerPoint…' : downloadError ? 'Retry download' : 'Download PowerPoint (.pptx)'}
            </Action>
          </div>
        </div>
      </Dialog>
    </div>
  );

  return props.activeDeck && props.scope ? (
    <ServerSlideSceneProvider deck={props.activeDeck} scope={props.scope}>
      {content}
    </ServerSlideSceneProvider>
  ) : (
    content
  );
}

function DeckPresenter({ plan, initialIndex, onClose }: { plan: StoryPlan; initialIndex: number; onClose: () => void }) {
  const [index, setIndex] = useState(initialIndex);
  const ref = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const attach = useCallback((node: HTMLDivElement | null) => {
    ref.current = node;
    setMounted(!!node);
  }, []);
  const fullscreen = usePresentationFullscreen(ref);
  const entered = useRef(false);
  const enterFullscreen = fullscreen.toggle;

  useEffect(() => {
    if (mounted) void enterFullscreen();
  }, [mounted, enterFullscreen]);
  useEffect(() => {
    if (fullscreen.active) entered.current = true;
    else if (entered.current) onClose();
  }, [fullscreen.active, onClose]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (['ArrowRight', 'PageDown', ' '].includes(e.key)) {
        e.preventDefault();
        setIndex((i) => Math.min(plan.slides.length - 1, i + 1));
      }

      if (['ArrowLeft', 'PageUp'].includes(e.key)) {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      }
    };

    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [plan.slides.length]);
  return (
    <Dialog
      open
      fullScreen
      onClose={(_event, reason) => {
        if (reason === 'escapeKeyDown' && fullscreen.isActive()) void fullscreen.toggle();
        else onClose();
      }}
    >
      <div className='ps-root ps-presenter' ref={attach}>
        <header>
          <span>{plan.title}</span>
          <Action aria-label='Exit presentation' onClick={onClose}>
            <X size={18} />
          </Action>
        </header>
        <main className='ps-deck-fullscreen'>
          <ServerSlideCanvas index={index} />
        </main>
        <footer>
          <span>← → to navigate · Esc to exit</span>
          <div className='ps-inline'>
            <Action aria-label='Previous slide' disabled={!index} onClick={() => setIndex(index - 1)}>
              <ArrowLeft size={17} />
            </Action>
            <span>
              {index + 1} / {plan.slides.length}
            </span>
            <Action
              aria-label='Next slide'
              disabled={index === plan.slides.length - 1}
              onClick={() => setIndex(index + 1)}
            >
              <ArrowRight size={17} />
            </Action>
          </div>
          <FullscreenControl fullscreen={fullscreen} />
        </footer>
      </div>
    </Dialog>
  );
}
