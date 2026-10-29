import { Upload, X, Check, ArrowLeft } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { ReactComponent as AIIcon } from '@/assets/icons/ai.svg';
import { ReactComponent as InfoIcon } from '@/assets/icons/info.svg';
import { ReactComponent as PageIcon } from '@/assets/icons/page.svg';
import { ReactComponent as PaletteIcon } from '@/assets/icons/palette.svg';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tooltip as AppTooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { assessPresentation, importPresentationTemplate, reviewPresentationTemplate } from './presentation-client';
import { slideCountLimitMessage } from './presentation-policy';
import PresentationSettingsDropdown from './PresentationSettingsDropdown';
import { effectiveSlideOptions } from './slide-guidance';
import { SLIDE_COUNT_PRESETS } from './slide-limits';
import SlideCountDropdown from './SlideCountDropdown';
import SlideThemePicker from './SlideThemePicker';
import { SLIDE_TONES, SLIDE_DENSITIES } from './types';
import { Action, Notice } from './ui';

import type { SlidesWorkflowProps } from './SlidesWorkflow';
import type { SlideAssessment, PresentationStyle } from './types';

const slideCounts: readonly number[] = SLIDE_COUNT_PRESETS;

export default function SlideGenerationSetup({
  props,
  scope,
  busy = false,
}: {
  props: SlidesWorkflowProps;
  scope?: { workspaceId: string; pageId: string };
  busy?: boolean;
}) {
  const { snapshot, options, onOptions, style, onStyle, onGenerate, canGenerate, plan, onStage } = props;
  const [assessment, setAssessment] = useState<SlideAssessment>();
  const [assessmentAttempt, setAssessmentAttempt] = useState(0);
  const [assessing, setAssessing] = useState(false);
  const [notice, setNotice] = useState('');
  const [importing, setImporting] = useState(false);
  const [draft, setDraft] = useState<PresentationStyle>();
  const templateRequest = useRef<AbortController>();
  const controlsId = useId();
  const autoCount = options.slideCountMode === 'auto';
  const { remainingSlides, maxSlides } = props;
  const recommendedCount = Math.min(
    assessment?.recommendedSlideCount ?? options.slideCount,
    maxSlides ?? Infinity,
    remainingSlides ?? Infinity
  );
  const limitMessage = slideCountLimitMessage(autoCount ? recommendedCount : options.slideCount, props);
  const showCustomCount = !autoCount &&
    (options.slideCountSelection === 'custom' || (!options.slideCountSelection && !slideCounts.includes(options.slideCount)));
  const designMode = options.designMode ?? (style.templateName ? 'template' : 'theme');
  const presetOptions = effectiveSlideOptions(options);

  useEffect(() => {
    setDraft(undefined);
    setImporting(false);
    return () => {
      templateRequest.current?.abort();
      templateRequest.current = undefined;
    };
  }, [scope?.workspaceId, scope?.pageId, snapshot.revision, designMode]);

  function cancelTemplateRequest() {
    templateRequest.current?.abort();
    templateRequest.current = undefined;
    setImporting(false);
  }

  async function runTemplateRequest(work: (signal: AbortSignal) => Promise<void>) {
    if (templateRequest.current) return;
    const controller = new AbortController();

    templateRequest.current = controller;
    setImporting(true);
    setNotice('');
    try {
      await work(controller.signal);
    } catch (error) {
      if (!controller.signal.aborted)
        setNotice(error instanceof Error ? error.message : 'Unable to load the template.');
    } finally {
      if (templateRequest.current === controller) {
        templateRequest.current = undefined;
        setImporting(false);
      }
    }
  }

  useEffect(() => {
    setAssessment(undefined);
    if (!scope || !canGenerate) return;
    const controller = new AbortController();

    setAssessing(true);
    // Debounce source/options changes; aborted requests must never replace a newer assessment.
    const timer = window.setTimeout(() => {
      void assessPresentation({ scope, source: snapshot, options, style }, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) {
            setAssessment(result.assessment);
            setNotice('');
          }
        })
        .catch((error: Error) => {
          if (!controller.signal.aborted) setNotice(error.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setAssessing(false);
        });
    }, 400);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // Counts, palette and panel expansion do not alter source assessment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    snapshot.revision,
    style.id,
    style.serverVersion,
    scope?.workspaceId,
    scope?.pageId,
    options.includeProperties,
    options.allowWebSearch,
    options.purpose,
    assessmentAttempt,
    canGenerate,
  ]);
  const hasSource =
    !!snapshot.serverSource || !!snapshot.blocks.length || (options.includeProperties && !!snapshot.properties.length);
  const question = assessment?.condition === 'ambiguous' && !options.purpose?.trim() && !options.reviewOutline;
  const change = (patch: Partial<typeof options>) => onOptions({ ...options, ...patch });
  const changePreset = (patch: Partial<Pick<typeof options, 'audience' | 'tone' | 'contentDensity'>>) =>
    change({
      audience: presetOptions.audience,
      tone: presetOptions.tone ?? 'auto',
      contentDensity: presetOptions.contentDensity ?? 'auto',
      preconfigure: true,
      ...patch,
    });

  useEffect(() => {
    if (assessment && options.documentCondition !== assessment.condition)
      onOptions({ ...options, documentCondition: assessment?.condition });
  }, [assessment, options, onOptions]);
  useEffect(() => {
    if (designMode !== 'auto') return;
    const suggested = props.styles.find((theme) => theme.id === assessment?.recommendedThemeId);

    if (suggested && style.id !== suggested.id) onStyle(suggested);
  }, [assessment?.recommendedThemeId, designMode, style.id, onStyle, props.styles]);
  useEffect(() => {
    if (assessment && autoCount && options.slideCount !== recommendedCount)
      onOptions({ ...options, slideCount: recommendedCount });
  }, [assessment, autoCount, recommendedCount, options, onOptions]);
  const chooseDesign = (mode: 'auto' | 'theme' | 'template') => {
    cancelTemplateRequest();
    setDraft(undefined);
    change({ designMode: mode, ...(mode === 'auto' && { layoutPreference: 'auto' }) });
    if (mode !== 'template' && style.templateName) props.styles[0] && onStyle(props.styles[0]);
  };

  const generate = () => onGenerate();
  const review = draft ?? (style.templateName ? style : undefined);
  const updateReview = (patch: Partial<PresentationStyle>) => {
    if (!review?.serverStyle) return;
    const next = { ...review, ...patch };

    setDraft({
      ...next,
      serverStyle: {
        ...review.serverStyle,
        theme: {
          ...review.serverStyle.theme,
          color: next.color,
          background: next.background,
          textColor: next.textColor ?? review.serverStyle.theme.textColor,
          font: next.font,
          bodyFont: next.bodyFont ?? next.font,
        },
      },
    });
  };

  return (
    <section className='ps-ppt-setup' aria-label='Create presentation settings'>
      <header className='ps-ppt-heading'>
        <div>
          <span className='ps-ppt-heading-icon'>
            <AIIcon />
          </span>
          <h1>Create presentation</h1>
        </div>
        {plan && (
          <Action onClick={() => onStage('preview')}>
            <ArrowLeft size={14} />
            Back to presentation
          </Action>
        )}
      </header>
      <div className='ps-ppt-setup-body'>
        <div className='ps-ppt-section-heading ps-ppt-source-heading'>
          <h2>Select sources</h2>
          <AppTooltip>
            <TooltipTrigger asChild>
              <Button variant='ghost' size='icon-sm' aria-label='About select sources' className='text-icon-secondary'>
                <InfoIcon className='h-5 w-5' aria-hidden='true' />
              </Button>
            </TooltipTrigger>
            <TooltipContent side='top' sideOffset={6} className='z-[1500] max-w-[320px] break-normal'>
              AI will generate slides based on your selected sources
            </TooltipContent>
          </AppTooltip>
        </div>
        <div className='ps-ppt-source-card' aria-label='Selected source'>
          <PageIcon className='h-5 w-5' />
          <strong>{snapshot.title}</strong>
          <span>Current page</span>
        </div>
        <div className='ps-ppt-web-search-setting'>
          <label htmlFor={`${controlsId}-web-search`}>Allow web search</label>
          <Switch
            id={`${controlsId}-web-search`}
            aria-label='Allow web search'
            checked={options.allowWebSearch}
            onCheckedChange={(checked) => change({ allowWebSearch: checked })}
          />
        </div>
        {props.hasNarrative && (
          <Notice>
            Mind-map branches are included as the proposed narrative, with the original document as evidence.
          </Notice>
        )}
        <div className='ps-ppt-section-heading'>
          <h2>Customize your design</h2>
        </div>
        <div className='ps-ppt-design-choices' role='group' aria-label='Customize your design'>
          {(
            [
              { id: 'template', label: 'Import template', Icon: Upload },
              { id: 'auto', label: 'Let AI choose', Icon: AIIcon },
              { id: 'theme', label: 'AppFlowy themes', Icon: PaletteIcon },
            ] as const
          ).map(({ id, label, Icon }) => (
            <Button
              key={id}
              variant='outline'
              className='min-w-0 whitespace-normal py-3 aria-pressed:border-border-theme-thick aria-pressed:bg-fill-theme-select aria-pressed:text-text-action'
              aria-pressed={designMode === id}
              onClick={() => chooseDesign(id)}
            >
              {designMode === id && <Icon className='ps-ppt-design-icon' />}
              {label}
            </Button>
          ))}
        </div>
        {designMode === 'theme' && (
          <div className='ps-ppt-design-panel'>
            <SlideThemePicker
              style={style}
              themes={props.styles.filter((item) => !item.serverStyle)}
              onSelect={(next) => {
                onStyle(next);
                setDraft(undefined);
              }}
            />
            {props.styles.some((s) => s.company) && (
              <PresentationSettingsDropdown
                label='Workspace theme'
                labelClassName='text-sm font-medium leading-5 text-text-primary'
                value={style.company ? style.id : ''}
                options={[
                  { value: '', label: 'AppFlowy preset' },
                  ...props.styles
                    .filter((s) => s.company)
                    .map((s) => ({
                      value: s.id,
                      label: `${s.name}${s.isDefault ? ' · Company default' : ''}`,
                    })),
                ]}
                onValueChange={(value) => {
                  const chosen = props.styles.find((s) => s.id === value);

                  if (chosen ?? props.styles[0]) onStyle(chosen ?? props.styles[0]);
                }}
              />
            )}
          </div>
        )}
        {designMode === 'template' && (
          <div className='ps-ppt-import'>
            {!review && (
              <label className={`ps-ppt-upload ${importing ? 'ps-disabled' : ''}`}>
                <Upload size={23} />
                <strong>
                  {importing ? 'Reading your presentation…' : 'Upload a PowerPoint or Google Slides export'}
                </strong>
                <span>.pptx or .potx · up to 50 MB</span>
                <input
                  aria-label='Import presentation template'
                  type='file'
                  accept='.pptx,.potx'
                  disabled={importing || !scope || !canGenerate}
                  onChange={(e) => {
                    const file = e.target.files?.[0];

                    e.target.value = '';
                    if (!file || !scope) return;
                    void runTemplateRequest(async (signal) => {
                      const candidate = await importPresentationTemplate(scope, file, signal);

                      if (!signal.aborted) setDraft(candidate);
                    });
                  }}
                />
              </label>
            )}
            {!review && (
              <p className='ps-muted'>
                In Google Slides, choose File → Download → Microsoft PowerPoint (.pptx), then upload it here.
              </p>
            )}
            {review && (
              <div className='ps-ppt-template-review'>
                <div className='ps-inline ps-between'>
                  <strong>{review.templateName}</strong>
                  <Action
                    aria-label='Remove template'
                    onClick={() => {
                      cancelTemplateRequest();
                      setDraft(undefined);
                      props.styles[0] && onStyle(props.styles[0]);
                    }}
                  >
                    <X size={15} />
                  </Action>
                </div>
                <p className='ps-muted'>
                  {review.serverStyle?.templateSlides.length ?? 0} supported layouts · Review the colors and fonts.
                </p>
                <div className='ps-ppt-detected-colors'>
                  {review.palette?.map((color, i) => (
                    <span key={`${color}-${i}`} style={{ background: color }} title={color} />
                  ))}
                </div>
                <div className='ps-ppt-theme-fields'>
                  {(['color', 'background', 'textColor'] as const).map((key, i) => (
                    <label key={key}>
                      {['Accent', 'Background', 'Text'][i]}
                      <input
                        aria-label={`Template ${['accent', 'background', 'text'][i]} color`}
                        type='color'
                        value={review[key] ?? '#20242B'}
                        onChange={(e) => updateReview({ [key]: e.target.value })}
                      />
                    </label>
                  ))}
                </div>
                <div className='ps-two-columns'>
                  <label className='ps-field'>
                    Heading font
                    <input
                      aria-label='Template heading font'
                      value={review.font}
                      onChange={(e) =>
                        updateReview({
                          font: e.target.value,
                          templateSlides: review.templateSlides?.map((s) => ({
                            ...s,
                            elements: s.elements.map((el) =>
                              el.type === 'text' && el.role === 'title' ? { ...el, font: e.target.value } : el
                            ),
                          })),
                        })
                      }
                    />
                  </label>
                  <label className='ps-field'>
                    Body font
                    <input
                      aria-label='Template body font'
                      value={review.bodyFont ?? review.font}
                      onChange={(e) =>
                        updateReview({
                          bodyFont: e.target.value,
                          templateSlides: review.templateSlides?.map((s) => ({
                            ...s,
                            elements: s.elements.map((el) =>
                              el.type === 'text' && el.role !== 'title' ? { ...el, font: e.target.value } : el
                            ),
                          })),
                        })
                      }
                    />
                  </label>
                </div>
                <label className='ps-check'>
                  <input
                    type='checkbox'
                    checked={options.templateReuse !== 'style-only'}
                    onChange={(e) => change({ templateReuse: e.target.checked ? 'auto' : 'style-only' })}
                  />
                  Reuse its sequence and sections when the topics are similar
                </label>
                {review.templateSlides?.length ? (
                  <details>
                    <summary>Detected slide sequence</summary>
                    <ol>
                      {review.templateSlides.map((s) => (
                        <li key={s.id}>{s.title}</li>
                      ))}
                    </ol>
                  </details>
                ) : null}
                {!!review.compatibilityWarnings?.length && (
                  <details>
                    <summary>Import notes</summary>
                    {review.compatibilityWarnings.map((w) => (
                      <p key={w}>{w}</p>
                    ))}
                  </details>
                )}
                {draft && (
                  <Action
                    primary
                    disabled={importing}
                    onClick={() => {
                      if (!scope) return;
                      void runTemplateRequest(async (signal) => {
                        const selected = await reviewPresentationTemplate(scope, draft, signal);

                        if (signal.aborted) return;
                        onStyle(selected);
                        setDraft(undefined);
                        setNotice('');
                      });
                    }}
                  >
                    Use this template
                  </Action>
                )}
                {!draft && (
                  <p className='ps-muted'>
                    <Check size={12} /> Template selected. {assessment?.templateReason}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
        <div className='ps-field ps-ppt-slide-count'>
          <div className='ps-ppt-section-heading'>
            <h2 id={`${controlsId}-slide-count`}>Number of slides</h2>
          </div>
          <div className='ps-ppt-count-options' role='group' aria-labelledby={`${controlsId}-slide-count`}>
            <Button
              variant='outline'
              className='aria-pressed:border-border-theme-thick aria-pressed:bg-fill-theme-select aria-pressed:text-text-action'
              aria-pressed={autoCount}
              onClick={() => {
                change({ slideCountMode: 'auto', slideCountSelection: undefined, slideCount: recommendedCount });
              }}
            >
              Auto
            </Button>
            {slideCounts.map((count) => (
              <button
                key={count}
                type='button'
                aria-pressed={!autoCount && !showCustomCount && options.slideCount === count}
                onClick={() => {
                  change({ slideCount: count, slideCountMode: 'fixed', slideCountSelection: 'preset' });
                }}
              >
                {count}
              </button>
            ))}
            <SlideCountDropdown
              value={showCustomCount ? options.slideCount : undefined}
              maxCount={maxSlides}
              disabled={maxSlides === undefined}
              onValueChange={(slideCount) => {
                change({ slideCount, slideCountMode: 'fixed', slideCountSelection: 'custom' });
              }}
            />
          </div>
          {remainingSlides !== undefined && remainingSlides !== null && (
            <p className='text-sm text-text-secondary'>
              {remainingSlides} slides available for this request. Generating and regenerating use this allowance.
            </p>
          )}
          {limitMessage && <Notice>{limitMessage}</Notice>}
        </div>
        {assessment?.condition === 'ambiguous' && (
          <label className='ps-field ps-ppt-question'>
            {assessment?.question}
            <input
              aria-label='Presentation purpose'
              placeholder='e.g. Help the team decide which project to prioritize'
              value={options.purpose ?? ''}
              onChange={(e) => change({ purpose: e.target.value, documentCondition: assessment?.condition })}
            />
          </label>
        )}
        <section className='ps-ppt-instructions-section' aria-labelledby={`${controlsId}-instructions-heading`}>
          <div className='ps-ppt-section-heading'>
            <h2 id={`${controlsId}-instructions-heading`}>Additional instructions</h2>
            <span>(optional)</span>
            <AppTooltip>
              <TooltipTrigger asChild>
                <Button
                  variant='ghost'
                  size='icon-sm'
                  aria-label='About additional instructions'
                  className='text-icon-secondary'
                >
                  <InfoIcon className='h-5 w-5' aria-hidden='true' />
                </Button>
              </TooltipTrigger>
              <TooltipContent side='top' sideOffset={6} className='z-[1500] max-w-[320px] break-normal'>
                Tell the AI about audience, tone or what to emphasize.
              </TooltipContent>
            </AppTooltip>
          </div>
          <textarea
            className='ps-ppt-instructions'
            aria-label='Additional instructions'
            rows={3}
            maxLength={6000}
            placeholder='e.g. Keep it exec-friendly. Lead with metrics and call out risks.'
            value={options.instructionsEnabled === false ? '' : options.instructions}
            onChange={(e) => change({ instructions: e.target.value, instructionsEnabled: true })}
          />
          <details className='ps-ppt-advanced'>
            <summary>More settings</summary>
            <div className='ps-ppt-presets' role='group' aria-label='Predefined settings'>
              <PresentationSettingsDropdown
                label='Audience'
                labelClassName='text-sm font-medium leading-5 text-text-primary'
                value={presetOptions.audience}
                options={['Auto', 'Executives', 'Team', 'Clients', 'General'].map((value) => ({
                  value,
                  label: value === 'Auto' ? 'Let AI choose' : value,
                }))}
                onValueChange={(audience) => changePreset({ audience })}
              />
              <PresentationSettingsDropdown
                label='Tone'
                labelClassName='text-sm font-medium leading-5 text-text-primary'
                value={presetOptions.tone ?? 'auto'}
                options={SLIDE_TONES.map((value) => ({
                  value,
                  label: value === 'auto' ? 'Let AI choose' : value.charAt(0).toUpperCase() + value.slice(1),
                }))}
                onValueChange={(tone) => changePreset({ tone: tone as typeof options.tone })}
              />
              <PresentationSettingsDropdown
                label='Content density'
                labelClassName='text-sm font-medium leading-5 text-text-primary'
                value={presetOptions.contentDensity ?? 'auto'}
                options={SLIDE_DENSITIES.map((value) => ({
                  value,
                  label: value === 'auto' ? 'Let AI choose' : value.charAt(0).toUpperCase() + value.slice(1),
                }))}
                onValueChange={(contentDensity) =>
                  changePreset({ contentDensity: contentDensity as typeof options.contentDensity })
                }
              />
            </div>
          </details>
        </section>
        <section className='ps-ppt-outline-setting' aria-labelledby={`${controlsId}-outline-title`}>
          <div>
            <h2 id={`${controlsId}-outline-title`}>
              <label htmlFor={`${controlsId}-outline`}>Review generated story plan</label>
            </h2>
            <p id={`${controlsId}-outline-description`}>
              Generate and save the presentation, then review its story. Accepting it makes no additional AI call;
              editing it requires regeneration.
            </p>
          </div>
          <Switch
            id={`${controlsId}-outline`}
            aria-labelledby={`${controlsId}-outline-title`}
            aria-describedby={`${controlsId}-outline-description`}
            checked={!!options.reviewOutline}
            onCheckedChange={(checked) => change({ reviewOutline: checked })}
          />
        </section>
        {snapshot.kind === 'row' && (
          <label className='ps-check'>
            <input
              type='checkbox'
              checked={options.includeProperties}
              onChange={(e) => change({ includeProperties: e.target.checked })}
            />
            Include database properties
          </label>
        )}
        {notice && (
          <Notice>
            {notice}{' '}
            {!assessing && (
              <Action onClick={() => setAssessmentAttempt((attempt) => attempt + 1)}>Retry analysis</Action>
            )}
          </Notice>
        )}
        {!hasSource && <Notice>Add some document content before generating.</Notice>}
      </div>
      <footer className='ps-ppt-setup-footer'>
        {(busy || assessing) && (
          <p className='ps-ppt-setup-progress' role='status'>
            <span
              aria-hidden='true'
              className='h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-border-primary border-t-fill-theme-thick motion-reduce:animate-none'
            />
            {busy ? 'Generating your presentation…' : 'Analyzing your sources…'}
          </p>
        )}
        {props.onCancel && (
          <Button variant='outline' size='lg' onClick={props.onCancel}>
            Cancel
          </Button>
        )}
        <Button
          size='lg'
          disabled={
            !hasSource ||
            !canGenerate ||
            !assessment ||
            !!limitMessage ||
            busy ||
            assessing ||
            importing ||
            !!draft ||
            (designMode === 'template' && !style.templateName) ||
            question
          }
          onClick={generate}
        >
          <AIIcon className='h-4 w-4' />
          {busy
            ? 'Generating…'
            : options.reviewOutline
            ? 'Review outline'
            : plan
            ? 'Regenerate presentation'
            : 'Generate presentation'}
        </Button>
      </footer>
    </section>
  );
}
