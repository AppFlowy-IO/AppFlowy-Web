import { TFunction } from 'i18next';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Hoisted out of the component body so they don't allocate per render —
// MUI Dialog can short-circuit prop comparison when these stay stable.
const MODAL_CLASSES = { container: 'items-start max-md:mt-auto max-md:items-center mt-[10%] ' };
const MODAL_PAPER_PROPS = {
  className: 'w-[560px] max-w-[90vw]',
  // Cast lets us pin a data-testid on the underlying Paper for E2E selectors.
  ...({ 'data-testid': 'relation-creation-dialog' } as Record<string, unknown>),
};

import { useDatabaseContext } from '@/application/database-yjs';
import { RelationLimit } from '@/application/database-yjs/fields/relation/relation.type';
import { View } from '@/application/types';
import { NormalModal } from '@/components/_shared/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

import { RelationView } from './RelationView';

export type RelationCreationResult = {
  fieldName: string;
  relatedDatabaseId: string;
  isTwoWay: boolean;
  sourceLimit: RelationLimit;
  reciprocalFieldName?: string;
};

function relationLimitLabel(t: TFunction, limit: RelationLimit) {
  return limit === RelationLimit.OneOnly
    ? t('grid.relation.limitOnePage', { defaultValue: 'One page' })
    : t('grid.relation.limitNoLimit', { defaultValue: 'No limit' });
}

function relationTypeLabel(t: TFunction, sourceLimit: RelationLimit) {
  return sourceLimit === RelationLimit.OneOnly
    ? t('grid.relation.manyToOne', { defaultValue: 'Many to one' })
    : t('grid.relation.manyToMany', { defaultValue: 'Many to many' });
}

export function RelationCreationDialog({
  open,
  initialFieldName,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  initialFieldName: string;
  onOpenChange: (open: boolean) => void;
  onCreate: (result: RelationCreationResult) => void;
}) {
  const { t } = useTranslation();
  const { databasePageId, loadDatabaseRelations, loadViewMeta } = useDatabaseContext();
  const [fieldName, setFieldName] = useState(initialFieldName);
  const [reciprocalFieldName, setReciprocalFieldName] = useState('');
  const [selectedDatabaseId, setSelectedDatabaseId] = useState('');
  const [sourceLimit, setSourceLimit] = useState(RelationLimit.NoLimit);
  const [isTwoWay, setIsTwoWay] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  // Each candidate carries both view metadata (for display) and the database_id
  // that needs to be persisted on the relation property.
  const [candidates, setCandidates] = useState<Array<{ databaseId: string; view: View }>>([]);

  // RelationCreationDialog itself stays mounted under PropertyMenu — only the
  // MUI Dialog subtree unmounts via `keepMounted={false}`. The useState above
  // therefore survives close, so reset every field when reopening so the user
  // doesn't see (or accidentally submit) the previous selection.
  useEffect(() => {
    if (!open) return;

    setFieldName(initialFieldName);
    setReciprocalFieldName('');
    setSelectedDatabaseId('');
    setSourceLimit(RelationLimit.NoLimit);
    setIsTwoWay(false);
    setQuery('');
  }, [initialFieldName, open]);

  // Capture the latest load-fns in refs so the effect can re-fetch without
  // re-running every time the parent context recreates them. Without this,
  // `loadDatabaseRelations({ refresh: true })` flips workspaceDatabases
  // state, which propagates back through context and changes the dep ids,
  // which restarts the effect, which re-flickers `loading` between true and
  // false — Playwright's locator catches the candidate button mid-detach.
  const loadDatabaseRelationsRef = useRef(loadDatabaseRelations);
  const loadViewMetaRef = useRef(loadViewMeta);

  useEffect(() => {
    loadDatabaseRelationsRef.current = loadDatabaseRelations;
  }, [loadDatabaseRelations]);

  useEffect(() => {
    loadViewMetaRef.current = loadViewMeta;
  }, [loadViewMeta]);

  useEffect(() => {
    if (!open) return;
    const loadDatabaseRelationsFn = loadDatabaseRelationsRef.current;
    const loadViewMetaFn = loadViewMetaRef.current;

    if (!loadDatabaseRelationsFn || !loadViewMetaFn) return;

    let cancelled = false;

    void (async () => {
      setLoading(true);
      try {
        // Mirror the desktop flow (RelationDatabaseListCubit):
        //   1. Ask the workspace for every registered database via
        //      DatabaseEventGetDatabases (here: `loadDatabaseRelations`).
        //   2. For each `(databaseId, viewId)`, fetch the view metadata so we
        //      get the database name. Desktop calls ViewBackendService.getView
        //      per id; we call `loadViewMeta` per id.
        //   3. Drop entries whose view fetch failed.
        // Force a refresh so a database created earlier in this session shows
        // up — the workspace cache is otherwise only invalidated on workspace
        // switch.
        const databaseRelations = (await loadDatabaseRelationsFn({ refresh: true })) ?? {};
        const entries = Object.entries(databaseRelations);

        const fetched = await Promise.all(
          entries.map(async ([databaseId, viewId]) => {
            if (!viewId) return null;

            try {
              const view = await loadViewMetaFn(viewId);

              return view ? { databaseId, view } : null;
            } catch {
              return null;
            }
          })
        );

        if (cancelled) return;

        const seen = new Set<string>();
        const resolved: Array<{ databaseId: string; view: View }> = [];

        for (const entry of fetched) {
          if (!entry || seen.has(entry.databaseId)) continue;
          seen.add(entry.databaseId);
          resolved.push(entry);
        }

        setCandidates(resolved);
      } catch {
        if (!cancelled) {
          setCandidates([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  const filteredCandidates = useMemo(() => {
    if (!query.trim()) return candidates;
    const lowered = query.trim().toLowerCase();

    return candidates.filter(({ view }) => (view.name || '').toLowerCase().includes(lowered));
  }, [candidates, query]);

  const selectedCandidate = useMemo(
    () => candidates.find((entry) => entry.databaseId === selectedDatabaseId),
    [candidates, selectedDatabaseId]
  );

  const currentCandidate = useMemo(
    () => candidates.find((entry) => entry.view.view_id === databasePageId),
    [candidates, databasePageId]
  );

  const relatedDatabaseName = selectedCandidate?.view.name || t('grid.relation.relatedDatabasePlaceholder');
  const sourceDatabaseName =
    currentCandidate?.view.name || t('grid.relation.thisDatabase', { defaultValue: 'This database' });

  // Memoize the disabled flag so MUI's Button can bail out when only
  // unrelated state (search query, two-way toggle, …) changes.
  const okButtonProps = useMemo(() => ({ disabled: !selectedDatabaseId }), [selectedDatabaseId]);

  return (
    <NormalModal
      keepMounted={false}
      open={open}
      onClose={() => onOpenChange(false)}
      title={t('grid.relation.newRelation', { defaultValue: 'New relation' })}
      classes={MODAL_CLASSES}
      PaperProps={MODAL_PAPER_PROPS}
      okText={t('grid.relation.addRelation', { defaultValue: 'Add relation' })}
      okButtonProps={okButtonProps}
      onOk={() => {
        // NormalModal triggers onOk on Enter regardless of the disabled state
        // of the OK button, so guard against submitting without a chosen
        // database (which would create a relation with an empty database_id).
        if (!selectedDatabaseId) return;
        onCreate({
          fieldName: fieldName.trim() || initialFieldName,
          relatedDatabaseId: selectedDatabaseId,
          isTwoWay,
          sourceLimit,
          reciprocalFieldName: isTwoWay ? reciprocalFieldName.trim() || sourceDatabaseName : undefined,
        });
      }}
    >
      <div className='grid gap-4'>
        <div className='text-sm text-text-secondary'>
          {t('tooltip.relationField', {
            defaultValue: 'Relate to another database. Useful for linking items across databases',
          })}
        </div>

        <label className='grid gap-1.5 text-sm'>
          <span className='text-text-secondary'>{t('grid.field.fieldName', { defaultValue: 'Property name' })}</span>
          <Input value={fieldName} onChange={(event) => setFieldName(event.target.value)} />
        </label>

        <div className='grid gap-2'>
          <div className='text-sm text-text-secondary'>{t('grid.relation.relatedTo', { defaultValue: 'Related to' })}</div>
          <SearchInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('grid.relation.search', { defaultValue: 'Search' })}
          />
          <div className='appflowy-scroller flex max-h-[160px] flex-col overflow-y-auto rounded-300 border border-border-primary p-1'>
            {loading ? (
              <div className='px-2 py-3 text-sm text-text-tertiary'>{t('loading')}</div>
            ) : filteredCandidates.length === 0 ? (
              <div className='px-2 py-3 text-sm text-text-tertiary'>
                {t('grid.relation.emptySearchResult')}
              </div>
            ) : (
              filteredCandidates.map(({ databaseId, view }) => {
                const selected = databaseId === selectedDatabaseId;

                return (
                  <button
                    key={databaseId}
                    type='button'
                    data-testid={`relation-candidate-${databaseId}`}
                    className={cn(
                      'flex items-center rounded-300 px-2 py-1.5 text-left text-sm hover:bg-fill-content-hover',
                      selected && 'bg-fill-theme-select'
                    )}
                    onClick={() => setSelectedDatabaseId(databaseId)}
                  >
                    <RelationView view={view} />
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className='grid gap-2'>
          <div className='text-sm text-text-secondary'>{t('grid.relation.limit', { defaultValue: 'Limit' })}</div>
          <div className='grid grid-cols-2 gap-2'>
            {[RelationLimit.NoLimit, RelationLimit.OneOnly].map((limit) => (
              <Button
                key={limit}
                type='button'
                variant={sourceLimit === limit ? 'default' : 'outline'}
                onClick={() => setSourceLimit(limit)}
              >
                {relationLimitLabel(t, limit)}
              </Button>
            ))}
          </div>
        </div>

        <div className='flex items-center justify-between gap-3 rounded-300 border border-border-primary px-3 py-2'>
          <div className='text-sm'>{t('grid.relation.twoWayRelation', { defaultValue: 'Two-way relation' })}</div>
          <Switch
            checked={isTwoWay}
            disabled={!selectedDatabaseId}
            onCheckedChange={(checked) => {
              setIsTwoWay(checked);
              if (checked && !reciprocalFieldName.trim()) {
                setReciprocalFieldName(sourceDatabaseName);
              }
            }}
          />
        </div>

        {isTwoWay ? (
          <label className='grid gap-1.5 text-sm'>
            <span className='text-text-secondary'>
              {t('grid.relation.propertyNameInRelatedDatabase', {
                defaultValue: 'Property name in related database',
              })}
            </span>
            <Input
              value={reciprocalFieldName}
              onChange={(event) => setReciprocalFieldName(event.target.value)}
              placeholder={sourceDatabaseName}
            />
          </label>
        ) : null}

        <div className='rounded-300 border border-border-primary bg-fill-content px-3 py-2 text-sm'>
          <div className='flex items-center gap-2'>
            <span className='min-w-0 flex-1 truncate'>{sourceDatabaseName}</span>
            <span className='text-text-tertiary'>{isTwoWay ? '<->' : '->'}</span>
            <span className='min-w-0 flex-1 truncate'>{relatedDatabaseName}</span>
          </div>
          <div className='mt-1 text-xs text-text-tertiary'>
            {isTwoWay
              ? t('grid.relation.twoWayRelationSummary', {
                  defaultValue: '{{relationType}}. Source: {{sourceLimit}}, target: {{targetLimit}}.',
                  relationType: relationTypeLabel(t, sourceLimit),
                  sourceLimit: relationLimitLabel(t, sourceLimit),
                  targetLimit: relationLimitLabel(t, RelationLimit.NoLimit),
                })
              : t('grid.relation.oneWayRelationSummary', {
                  defaultValue: 'One-way relation. Source limit: {{limit}}.',
                  limit: relationLimitLabel(t, sourceLimit),
                })}
          </div>
        </div>
      </div>
    </NormalModal>
  );
}

export default RelationCreationDialog;
