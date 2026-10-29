import { useEffect, useState } from 'react';

import {
  activatePromptBundle,
  getActivePrompts,
  getPromptBundle,
  getPromptHistory,
  getPromptVersion,
  savePromptBundle,
  savePromptVersion,
  testPromptBundle,
} from './admin-client';
import { serverOptions } from './presentation-client';
import { PresentationAPIError } from './server-client';
import { Action, Notice } from './ui';

import type { ActivePrompts, PromptBundle, PromptReference, PromptTest, PromptVersion } from './admin-client';

/** Separate maintainer surface; never imported by ordinary generation or presentation UI. */
export default function PromptAdministration({ workspaceId }: { workspaceId: string }) {
  const [active, setActive] = useState<ActivePrompts>();
  const [bundle, setBundle] = useState<PromptBundle>();
  const [component, setComponent] = useState('');
  const [text, setText] = useState('');
  const [history, setHistory] = useState<PromptVersion[]>([]);
  const [references, setReferences] = useState<Record<string, PromptReference>>({});
  const [selectedTexts, setSelectedTexts] = useState<Record<string, string>>({});
  const [bundleId, setBundleId] = useState('');
  const [pageId, setPageId] = useState('');
  const [task, setTask] = useState<PromptTest['task']>('assess');
  const [execute, setExecute] = useState(false);
  const [story, setStory] = useState('');
  const [artifactId, setArtifactId] = useState('');
  const [artifactVersion, setArtifactVersion] = useState(1);
  const [sourceRevision, setSourceRevision] = useState('');
  const [result, setResult] = useState('');
  const [notice, setNotice] = useState('');
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);

  function selectBundle(value: PromptBundle) {
    setBundle(value);
    setBundleId(value.version);
    setReferences(
      Object.fromEntries(Object.entries(value.components).map(([key, item]) => [key, { key, version: item.version }]))
    );
    setSelectedTexts(Object.fromEntries(Object.entries(value.components).map(([key, item]) => [key, item.text])));
    const key = Object.keys(value.components)[0] ?? '';

    setComponent(key);
    setText(value.components[key]?.text ?? '');
  }

  useEffect(() => {
    const controller = new AbortController();

    setActive(undefined);
    setDenied(false);
    void getActivePrompts(controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setActive(value);
        selectBundle(value.bundle);
      })
      .catch((error: Error) => {
        if (controller.signal.aborted) return;
        setDenied(true);
        setNotice(
          error instanceof PresentationAPIError && error.status === 403
            ? 'Presentation prompt maintenance requires a server administrator account.'
            : error.message
        );
      });
    return () => controller.abort();
  }, [workspaceId]);

  // Load a component's saved versions once access is confirmed. They do not depend on the active
  // revision, so refreshing that revision keeps the list instead of fetching it again.
  const loaded = !!active;

  useEffect(() => {
    if (!loaded || !component) return;
    const controller = new AbortController();

    setHistory([]);
    void getPromptHistory(component, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setHistory(value);
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setNotice(error.message);
      });
    return () => controller.abort();
  }, [loaded, component]);

  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setNotice('');
    try {
      await action();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Prompt maintenance failed.');
    } finally {
      setBusy(false);
    }
  }

  if (!active) return <Notice>{denied ? notice : 'Checking server administrator access…'}</Notice>;
  return (
    <section className='ps-root ps-page' aria-label='Presentation prompt maintenance'>
      <h1>Presentation prompt maintenance</h1>
      <p>
        Immutable components and bundles. Saving a version does not change the active bundle. Activation and rollback
        require its current revision.
      </p>
      <Action
        disabled={busy}
        onClick={() =>
          void perform(async () => {
            const latest = await getActivePrompts();

            setActive(latest);
            setNotice('Active revision refreshed. Your selected bundle and component edits are unchanged.');
          })
        }
      >
        Refresh active revision
      </Action>
      <p>
        Active bundle: <code>{active.active?.bundleId ?? active.bundle.version}</code> · revision{' '}
        {active.active?.revision ?? 0}
      </p>
      {notice && <Notice>{notice}</Notice>}
      <label className='ps-field'>
        Component
        <select
          value={component}
          disabled={busy}
          onChange={(event) => {
            const key = event.target.value;

            setComponent(key);
            setText(selectedTexts[key] ?? '');
          }}
        >
          {Object.keys(bundle?.components ?? {}).map((key) => (
            <option key={key}>{key}</option>
          ))}
        </select>
      </label>
      <label className='ps-field'>
        Exact component text
        <textarea rows={16} value={text} onChange={(event) => setText(event.target.value)} disabled={busy} />
      </label>
      <Action
        disabled={busy || !text.trim()}
        onClick={() =>
          void perform(async () => {
            const saved = await savePromptVersion(component, text);

            setReferences((current) => ({ ...current, [component]: { key: component, version: saved.version } }));
            setSelectedTexts((current) => ({ ...current, [component]: saved.text }));
            setHistory((current) => [saved, ...current]);
            setNotice('Immutable component saved. Save a bundle to pin this version.');
          })
        }
      >
        Save new component version
      </Action>
      <details>
        <summary>Component history</summary>
        {history.map((version) => (
          <p key={version.version}>
            <Action
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  const saved = await getPromptVersion(component, version.version);

                  setText(saved.text);
                  setReferences((current) => ({ ...current, [component]: { key: component, version: saved.version } }));
                  setSelectedTexts((current) => ({ ...current, [component]: saved.text }));
                })
              }
            >
              {version.createdAt} · {version.version}
            </Action>
          </p>
        ))}
      </details>
      <Action
        disabled={busy}
        onClick={() =>
          void perform(async () => {
            const saved = await savePromptBundle(references);

            selectBundle(await getPromptBundle(saved.id));
            setNotice('Immutable bundle saved; it is not active.');
          })
        }
      >
        Save new bundle
      </Action>
      <label className='ps-field'>
        Bundle ID
        <input value={bundleId} onChange={(event) => setBundleId(event.target.value)} />
      </label>
      <Action
        disabled={busy || !bundleId}
        onClick={() => void perform(async () => selectBundle(await getPromptBundle(bundleId)))}
      >
        Read bundle
      </Action>
      <Action
        disabled={busy || !bundleId}
        onClick={() =>
          void perform(async () => {
            await activatePromptBundle(bundleId, active.active?.revision ?? 0);
            const latest = await getActivePrompts();

            setActive(latest);
            selectBundle(latest.bundle);
            setNotice('Active bundle updated. Existing jobs retain their pinned bundle.');
          })
        }
      >
        Activate selected bundle / rollback
      </Action>
      <h2>Authorized source test</h2>
      <p>
        Execution uses the real configured model. Results stay in this maintenance screen and are not imported as user
        artifacts.
      </p>
      <label className='ps-field'>
        Source page ID
        <input value={pageId} onChange={(event) => setPageId(event.target.value)} />
      </label>
      <label className='ps-field'>
        Task
        <select value={task} onChange={(event) => setTask(event.target.value as PromptTest['task'])}>
          {(['assess', 'mindmap', 'slides', 'regenerate_story_plan'] as const).map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
      <label>
        <input type='checkbox' checked={execute} onChange={(event) => setExecute(event.target.checked)} /> Execute model
        (slides and regeneration require execution)
      </label>
      {task === 'regenerate_story_plan' && (
        <>
          <label className='ps-field'>
            Artifact ID
            <input value={artifactId} onChange={(event) => setArtifactId(event.target.value)} />
          </label>
          <label className='ps-field'>
            Expected artifact version
            <input
              type='number'
              min={1}
              value={artifactVersion}
              onChange={(event) => setArtifactVersion(Number(event.target.value))}
            />
          </label>
          <label className='ps-field'>
            Captured source revision
            <input value={sourceRevision} onChange={(event) => setSourceRevision(event.target.value)} />
          </label>
          <label className='ps-field'>
            Edited story plan JSON
            <textarea value={story} onChange={(event) => setStory(event.target.value)} />
          </label>
        </>
      )}
      <Action
        disabled={busy || !pageId || !bundleId || (!execute && (task === 'slides' || task === 'regenerate_story_plan'))}
        onClick={() =>
          void perform(async () => {
            const value = await testPromptBundle({
              workspaceId,
              bundleId,
              task,
              execute,
              source: {
                sources: [{ pageId }],
                options: serverOptions({
                  audience: '',
                  slideCount: 8,
                  slideCountMode: 'auto',
                  instructions: '',
                  includeProperties: true,
                  allowWebSearch: false,
                }),
              },
              ...(task === 'regenerate_story_plan' && {
                artifact: { id: artifactId, version: artifactVersion },
                storyPlan: JSON.parse(story),
                sourceRevision,
              }),
            });

            setResult(JSON.stringify(value, null, 2));
          })
        }
      >
        {execute ? 'Execute authorized test' : 'Compile authorized test'}
      </Action>
      {result && <pre className='ps-code'>{result}</pre>}
    </section>
  );
}
