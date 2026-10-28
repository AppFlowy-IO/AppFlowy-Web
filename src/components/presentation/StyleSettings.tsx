import { Check, Palette, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { deleteArtifact, importPresentationTemplate, reviewPresentationStyle } from './presentation-client';
import SlideCanvas from './SlideCanvas';
import { LAYOUTS, type PresentationStyle } from './types';
import { Action, Notice } from './ui';

import type { PresentationScope, Theme } from './server-contract';

const MAX_TEMPLATE_BYTES = 50 * 1024 * 1024;

/** Reviews server-owned templates; this screen never creates a local company-style authority. */
export default function StyleSettings({
  styles,
  onChange,
  editable = true,
  scope,
}: {
  styles: PresentationStyle[];
  onChange: (styles: PresentationStyle[]) => void | Promise<void>;
  editable?: boolean;
  scope: Pick<PresentationScope, 'workspaceId'>;
}) {
  const [draft, setDraft] = useState<PresentationStyle>();
  const [status, setStatus] = useState('');
  const [layout, setLayout] = useState<(typeof LAYOUTS)[number]>('title');
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController>();

  useEffect(() => {
    setDraft(undefined);
    setStatus('');
    setBusy(false);
    return () => {
      request.current?.abort();
      request.current = undefined;
    };
  }, [scope.workspaceId]);

  const updateTheme = (patch: Partial<Theme>) =>
    setDraft((current) =>
      current?.serverStyle
        ? {
            ...current,
            ...patch,
            serverStyle: { ...current.serverStyle, theme: { ...current.serverStyle.theme, ...patch } },
          }
        : current
    );

  async function run(work: (signal: AbortSignal) => Promise<void>) {
    if (!editable || request.current || !scope.workspaceId) return;
    const controller = new AbortController();

    request.current = controller;
    setBusy(true);
    setStatus('');
    try {
      await work(controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : 'Unable to update the style.');
    } finally {
      if (request.current === controller) {
        request.current = undefined;
        setBusy(false);
      }
    }
  }

  const save = () =>
    run(async (signal) => {
      if (!draft?.serverStyle || !draft.serverVersion) return;
      if (!draft.name.trim() || !/^#[\da-f]{6}$/i.test(draft.color) || !/^#[\da-f]{6}$/i.test(draft.background)) {
        setStatus('Enter a style name and valid six-digit colors.');
        return;
      }

      const candidate = {
        ...draft,
        name: draft.name.trim(),
        serverStyle: { ...draft.serverStyle, theme: { ...draft.serverStyle.theme, name: draft.name.trim() } },
      };
      const saved = await reviewPresentationStyle(scope, candidate, signal);

      if (signal.aborted) return;
      await onChange([...styles.filter((style) => style.id !== saved.id), saved]);
      if (signal.aborted) return;
      setDraft(undefined);
      setStatus('Company style saved.');
    });

  return (
    <div className='ps-page'>
      <div className='ps-page-heading'>
        <div>
          <span className='ps-eyebrow'>AI SETTINGS / PRESENTATION STYLES</span>
          <h1>Presentation styles</h1>
          <p>Import a PowerPoint template, review its appearance, and save it for your workspace.</p>
        </div>
        <Palette size={30} strokeWidth={1.4} />
      </div>
      <div className='ps-inline ps-between'>
        <h2>Company styles</h2>
        <label className={`ps-button ${!editable || busy ? 'ps-disabled' : ''}`}>
          <Upload size={15} /> Import template
          <input
            type='file'
            aria-label='Import template'
            hidden
            accept='.pptx,.potx'
            disabled={!editable || busy}
            onChange={(event) => {
              const file = event.target.files?.[0];

              event.target.value = '';
              if (!file) return;
              if (file.size > MAX_TEMPLATE_BYTES) {
                setStatus('Use a PowerPoint template up to 50 MB.');
                return;
              }

              void run(async (signal) => {
                const candidate = await importPresentationTemplate(scope, file, signal);

                if (signal.aborted) return;
                await onChange([...styles.filter((style) => style.id !== candidate.id), candidate]);
                if (signal.aborted) return;
                setDraft(candidate);
                setStatus('Template uploaded. Review its appearance before saving.');
              });
            }}
          />
        </label>
      </div>
      {!styles.length && !draft && (
        <div className='ps-empty-style'>
          <Palette size={26} />
          <h3>No company styles yet</h3>
          <p>Import a PowerPoint template to get started.</p>
        </div>
      )}
      {styles.map((style) => (
        <div className='ps-saved-style' key={style.id}>
          <span className='ps-style-dot' style={{ background: style.color }} />
          <strong>{style.name}</strong>
          {style.requiresReview && <span className='ps-tag'>Review required</span>}
          <div className='ps-inline'>
            <Action
              disabled={!editable || busy || !style.serverStyle}
              onClick={() => {
                setDraft(structuredClone(style));
                setStatus('');
              }}
            >
              Edit
            </Action>
            <Action
              disabled={!editable || busy || !style.serverVersion}
              onClick={() =>
                void run(async (signal) => {
                  if (!style.serverVersion) return;
                  await deleteArtifact(scope, style.id, style.serverVersion, signal);
                  if (signal.aborted) return;
                  await onChange(styles.filter((item) => item.id !== style.id));
                  if (signal.aborted) return;
                  if (draft?.id === style.id) setDraft(undefined);
                  setStatus('Company style removed.');
                })
              }
            >
              Remove
            </Action>
          </div>
        </div>
      ))}
      {draft?.serverStyle && (
        <div className='ps-style-editor'>
          <section className='ps-panel'>
            <h2>Review company style</h2>
            <fieldset disabled={!editable || busy}>
              <label className='ps-field'>
                Style name
                <input
                  value={draft.name}
                  maxLength={80}
                  onChange={(event) => updateTheme({ name: event.target.value })}
                />
              </label>
              <div className='ps-two-columns'>
                <label className='ps-field'>
                  Brand color
                  <input
                    type='color'
                    value={draft.color}
                    onChange={(event) => updateTheme({ color: event.target.value })}
                  />
                </label>
                <label className='ps-field'>
                  Background color
                  <input
                    type='color'
                    value={draft.background}
                    onChange={(event) => updateTheme({ background: event.target.value })}
                  />
                </label>
              </div>
              <label className='ps-field'>
                Typeface
                <select value={draft.font} onChange={(event) => updateTheme({ font: event.target.value })}>
                  {[...new Set([draft.font, 'Arial', 'Georgia', 'Verdana', 'Trebuchet MS'])].map((font) => (
                    <option key={font}>{font}</option>
                  ))}
                </select>
              </label>
              <label className='ps-field'>
                Body typeface
                <select
                  value={draft.serverStyle.theme.bodyFont}
                  onChange={(event) => updateTheme({ bodyFont: event.target.value })}
                >
                  {[...new Set([draft.serverStyle.theme.bodyFont, 'Arial', 'Georgia', 'Verdana', 'Trebuchet MS'])].map(
                    (font) => (
                      <option key={font}>{font}</option>
                    )
                  )}
                </select>
              </label>
              <label className='ps-field'>
                Mandatory footer
                <input value={draft.serverStyle.theme.footer} readOnly />
              </label>
              <label className='ps-field'>
                Writing guidelines
                <textarea
                  rows={3}
                  value={draft.guidelines}
                  onChange={(event) => updateTheme({ guidelines: event.target.value })}
                />
              </label>
            </fieldset>
            {draft.compatibilityWarnings?.map((warning) => (
              <Notice key={warning}>{warning}</Notice>
            ))}
            <p className='ps-muted'>The imported layout, assets, and mandatory footer are preserved.</p>
            <div className='ps-inline'>
              <Action primary disabled={!editable || busy} onClick={() => void save()}>
                <Check size={15} />
                Save style
              </Action>
              <Action disabled={busy} onClick={() => setDraft(undefined)}>
                Cancel
              </Action>
            </div>
          </section>
          <div>
            <label className='ps-field'>
              Sample layout
              <select value={layout} onChange={(event) => setLayout(event.target.value as typeof layout)}>
                {LAYOUTS.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <SlideCanvas
              slide={{
                id: 'sample',
                title: 'A shared vision. A clear direction.',
                message: 'Bring your team’s best thinking to the room.',
                points:
                  layout === 'title'
                    ? []
                    : ['Make progress visible', 'Create space for decisions', 'Leave with clear next steps'],
                layout,
                sourceIds: [],
                notes: '',
                warnings: [],
              }}
              style={draft}
            />
            <p className='ps-muted'>Appearance sample. Existing decks retain their saved style.</p>
          </div>
        </div>
      )}
      {status && <Notice>{status}</Notice>}
    </div>
  );
}

export function StyleSwatch({ style }: { style: PresentationStyle }) {
  return (
    <div className='ps-style-swatch' style={{ background: style.background, color: style.color }}>
      <span className='ps-swatch-title'>
        Ideas into
        <br />
        impact.
      </span>
      <span className='ps-swatch-line' />
      <span className='ps-swatch-bars'>
        <i />
        <i />
        <i />
      </span>
      <span className='ps-swatch-footer'>{style.footer}</span>
    </div>
  );
}
