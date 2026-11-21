import { createContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { TextPart } from '@/application/services/js-services/http/automation-api';
import { getWorkspaceGroups, searchMentions } from '@/application/services/js-services/http/workspace-api';
import { MentionTargetKind } from '@/application/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { Select, type Item } from './Select';

export const RichActionContext = createContext({ workspace: '', rich: false, related: false });
type MentionPart = Extract<TextPart, { type: 'page' | 'group' | 'person' }>;

export function MentionChoice({
  workspace,
  part,
  change,
}: {
  workspace: string;
  part: MentionPart;
  change: (part: MentionPart) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [choices, setChoices] = useState<Item[]>([]);
  const [error, setError] = useState(false);
  const [attempt, retry] = useState(0);
  const type = part.type;
  const id = part.type === 'page' ? part.view_id : part.type === 'group' ? part.group_id : part.user_id;
  const lookup = type === 'group' ? '' : query.trim();

  useEffect(() => {
    const controller = new AbortController();

    setChoices([]);
    setError(false);
    const timer = setTimeout(
      () => {
        async function load(): Promise<Item[]> {
          if (type === 'group')
            return (await getWorkspaceGroups(workspace)).groups.map((g) => ({ id: g.group_id, name: g.name }));
          const include =
            type === 'person' ? [MentionTargetKind.Person] : [MentionTargetKind.Page, MentionTargetKind.Database];
          const result = await searchMentions(
            workspace,
            { query: lookup, include, limit: 20 },
            { signal: controller.signal }
          );

          const choices = new Map<string, string>();

          for (const section of result.sections) {
            for (const item of section.items) {
              const m = item.mention;

              if (!include.some((kind) => kind === m.type)) continue;
              const id =
                m.type === MentionTargetKind.Person
                  ? m.person_id
                  : m.type === MentionTargetKind.Page
                  ? m.page_id
                  : m.type === MentionTargetKind.Database
                  ? m.database_view_id
                  : undefined;

              if (id) choices.set(id, item.title);
            }
          }

          return Array.from(choices, ([id, name]) => ({ id, name }));
        }

        void load()
          .then((items) => {
            if (!controller.signal.aborted) setChoices(items);
          })
          .catch(() => {
            if (!controller.signal.aborted) setError(true);
          });
      },
      lookup ? 200 : 0
    );

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [workspace, type, lookup, attempt]);
  const items =
    type === 'group'
      ? choices.filter((c) => c.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
      : choices;
  const options =
    id && !items.some((x) => x.id === id)
      ? [{ id, name: choices.find((x) => x.id === id)?.name || id }, ...items]
      : items;

  return (
    <>
      <Input aria-label={t('databaseAutomation.findMention')} value={query} onChange={(e) => setQuery(e.target.value)} />
      <Select
        label={t('databaseAutomation.value')}
        options={options}
        value={id}
        change={([value]) => {
          if (type === 'page') change({ type, view_id: value });
          else if (type === 'group') change({ type, group_id: value });
          else change({ type, user_id: value });
        }}
      />
      {error && (
        <Button type='button' variant='ghost' onClick={() => retry((n) => n + 1)}>
          {t('databaseAutomation.retry')}
        </Button>
      )}
    </>
  );
}
