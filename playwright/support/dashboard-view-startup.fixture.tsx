import { type RefObject, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import {
  DashboardLoadSchedulerProvider,
  useWidgetLoadStart,
} from '@/components/database/dashboard/DashboardLoadScheduler';
import { type WidgetLoadReport } from '@/components/database/dashboard/load-scheduler';
import { WidgetPlaceholder } from '@/components/database/dashboard/WidgetPlaceholder';
import '@/styles/global.css';

const language = i18next.createInstance();

await language.use(initReactI18next).init({
  lng: 'en', fallbackLng: 'en',
  resources: { en: { translation: { dashboard: { widget: { loading: 'Loading…' } } } } },
});

const stalledSource = new URLSearchParams(location.search).has('stalled-source');
const ids = Array.from({ length: 100 }, (_, index) => `w${index + 1}`);
const mounts = new Map<string, number>();
const work = { active: new Set<string>(), maximum: 0, events: [] as { id: string; event: string; at: number }[] };

declare global {
  interface Window {
    __DASHBOARD_STARTUP_WORK__: typeof work;
  }
}

window.__DASHBOARD_STARTUP_WORK__ = work;

/** A delayed view body makes admission/abort observable on real browser requests. */
function ViewBody({ id, report }: { id: string; report: (value: WidgetLoadReport) => void }) {
  const [row, setRow] = useState<string>();
  const [search, setSearch] = useState('');
  const completeWork = useRef<() => void>();
  const [mount] = useState(() => {
    const count = (mounts.get(id) ?? 0) + 1;

    mounts.set(id, count);
    return count;
  });

  useEffect(() => {
    const controller = new AbortController();
    const key = `${id}:${mount}`;
    let finished = false;
    const finish = (event: 'aborted' | 'complete') => {
      if (finished) return;
      finished = true;
      work.active.delete(key);
      work.events.push({ id: key, event, at: performance.now() });
    };

    work.active.add(key);
    work.maximum = Math.max(work.maximum, work.active.size);
    work.events.push({ id: key, event: 'start', at: performance.now() });
    completeWork.current = () => finish('complete');

    if (!stalledSource) report('opened');
    const pending = fetch(`/qa-view-startup/${id}`, { signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json()) as { name: string };

        if (!controller.signal.aborted) setRow(data.name);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) throw error;
      });

    return () => {
      controller.abort();
      // Acknowledge actual promise cleanup, rather than CDP's later transport event.
      void pending.then(() => {
        finish('aborted');
        report('suspended');
      });
    };
  }, [id, mount, report]);

  useEffect(() => {
    if (row === undefined) return;
    completeWork.current?.();
    report('first-data');
    report('complete');
  }, [report, row]);

  return (
    <div data-testid={`body-${id}`} data-mount={mount}>
      {row === undefined ? <span>Preparing {id}</span> : <span data-testid={`row-${id}`}>{row}</span>}
      <label>Search {id}<input value={search} onChange={(event) => setSearch(event.target.value)} /></label>
    </div>
  );
}

function WidgetContent({ id, boxRef }: { id: string; boxRef: RefObject<HTMLElement> }) {
  const { started, report } = useWidgetLoadStart({
    widgetId: id,
    sourceId: stalledSource ? id : 'host',
    boxRef,
    resume: false,
  });

  return started ? <ViewBody id={id} report={report} /> : (
    <div data-testid={`queued-${id}`}><WidgetPlaceholder reason='loading' /></div>
  );
}

function Widget({ id, titles }: { id: string; titles: boolean }) {
  const boxRef = useRef<HTMLElement>(null);

  return (
    <section className='group/widget' data-testid={`frame-${id}`} data-widget-id={id} ref={boxRef}
      style={{ height: 180, border: '1px solid #aaa', boxSizing: 'border-box', overflow: 'hidden' }}>
      {titles && <h2 style={{ margin: 4 }}>{id}</h2>}
      <WidgetContent id={id} boxRef={boxRef} />
    </section>
  );
}

function Dashboard({ titles }: { titles: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <DashboardLoadSchedulerProvider hostSourceId='host' order={ids} scrollRef={scrollRef}>
      <div data-testid='startup-viewport' ref={scrollRef} style={{ height: 300, overflow: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {ids.map((id) => <Widget key={id} id={id} titles={titles} />)}
        </div>
      </div>
    </DashboardLoadSchedulerProvider>
  );
}

function Fixture() {
  const [open, setOpen] = useState(true);
  const [titles, setTitles] = useState(true);

  return (
    <main>
      <button onClick={() => setOpen((value) => !value)}>{open ? 'Leave Dashboard' : 'Reopen Dashboard'}</button>
      <button onClick={() => setTitles((value) => !value)}>Toggle titles</button>
      {open ? <Dashboard titles={titles} /> : <p>Other page</p>}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<I18nextProvider i18n={language}><Fixture /></I18nextProvider>);
