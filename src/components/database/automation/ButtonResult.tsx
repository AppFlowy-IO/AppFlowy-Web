import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { readButtonResultTarget, type ButtonResultTarget } from '@/application/automation/button';
import { useDatabaseContextOptional } from '@/application/database-yjs';
import { ruleApi } from '@/application/services/js-services/http/automation-api';
import { YjsDatabaseKey, YjsEditorKey, type YDatabase } from '@/application/types';
import { Button } from '@/components/ui/button';

type Props = {
  workspace: string;
  database: string;
  row: string;
  field: string;
  requestId: string;
  onNavigated?: () => void;
};

export function ButtonResult({ workspace, database, row, field, requestId, onNavigated }: Props) {
  const { t } = useTranslation();
  const context = useDatabaseContextOptional();
  const navigation = useRef(context);

  navigation.current = context;
  const [check, setCheck] = useState(0);
  const [state, setState] = useState<'waiting' | 'retry' | 'finished' | 'failed' | 'unavailable'>('waiting');
  const [link, setLink] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;

    async function open(target: ButtonResultTarget) {
      if (target.type === 'url') {
        // A completion arriving after a worker round trip has no browser user activation.
        setLink(target.url);
        return;
      }

      const nav = navigation.current;

      if (!nav || nav.workspaceId !== workspace || !nav.loadViewMeta) throw Error('Navigation unavailable');
      const view = await nav.loadViewMeta(target.view_id, undefined, { metadataOnly: true, authoritative: true });

      if (signal.aborted) return;
      if (!view || view.view_id !== target.view_id || navigation.current?.workspaceId !== workspace)
        throw Error('Page unavailable');
      if (target.type === 'page' && nav.navigateToView) await nav.navigateToView(target.view_id);
      else if (target.type === 'row' && nav.navigateToRow) {
        // Legacy folder metadata can omit database_id. Resolve it from the
        // exact destination view before passing a row into the standard peek.
        let databaseId = view.extra?.database_id;

        if (!databaseId) {
          const doc = await nav.loadView?.(target.view_id);

          if (signal.aborted) return;
          const db = doc?.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase | undefined;

          databaseId = db?.get(YjsDatabaseKey.id);
        }

        if (databaseId !== target.database_id || navigation.current?.workspaceId !== workspace)
          throw Error('Database unavailable');
        await nav.navigateToRow(target.row_id, target.view_id);
      } else throw Error('Row unavailable');
      if (!signal.aborted) onNavigated?.();
    }

    async function poll() {
      try {
        const result = await ruleApi.buttonResult(workspace, database, row, field, requestId, signal);

        if (signal.aborted) return;
        if (result.status === 'succeeded') {
          const target = readButtonResultTarget(result.target);

          if (!target) {
            setState('unavailable');
            return;
          }

          try {
            await open(target);
            if (!signal.aborted) setState('finished');
          } catch {
            if (!signal.aborted) setState('unavailable');
          }
          return;
        }

        if (result.status !== 'queued' && result.status !== 'running') {
          setState(['failed', 'skipped', 'cancelled'].includes(result.status) ? 'failed' : 'unavailable');
          return;
        }

        attempts++;
        if (attempts === 6) setState('retry');
        else timer = setTimeout(() => void poll(), Math.min(8000, 1000 * 2 ** (attempts - 1)));
      } catch {
        if (!signal.aborted) setState('retry');
      }
    }

    setState('waiting');
    setLink(undefined);
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [workspace, database, row, field, requestId, check, onNavigated]);
  const messages = {
    waiting: 'buttonQueued',
    retry: 'checkRun',
    finished: 'runSucceeded',
    failed: 'runStopped',
    unavailable: 'targetUnavailable',
  } as const;
  const message = messages[state];

  return (
    <div className='flex flex-col gap-2'>
      <p role='status'>{t(`databaseAutomation.${message}`)}</p>
      {link && (
        <a href={link} target='_blank' rel='noopener noreferrer' className='underline'>
          {t('databaseAutomation.openLink')}
        </a>
      )}
      {state === 'retry' && <Button onClick={() => setCheck((n) => n + 1)}>{t('databaseAutomation.checkAgain')}</Button>}
    </div>
  );
}
