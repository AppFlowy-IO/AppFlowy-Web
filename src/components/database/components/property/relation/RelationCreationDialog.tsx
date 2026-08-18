import { TFunction } from 'i18next';
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Hoisted out of the component body so they don't allocate per render —
// MUI Dialog can short-circuit prop comparison when these stay stable.
const MODAL_CLASSES = { container: 'items-start max-md:mt-auto max-md:items-center mt-[10%] ' };
// Desktop pins the dialog at 420px (`showRelationCreationDialog` → SizedBox(width: 420)).
const MODAL_PAPER_PROPS = {
  className: 'w-[420px] max-w-[90vw]',
  // Cast lets us pin a data-testid on the underlying Paper for E2E selectors.
  ...({ 'data-testid': 'relation-creation-dialog' } as Record<string, unknown>),
};

import { useDatabaseContext } from '@/application/database-yjs';
import { useUpdatePropertyIconDispatch } from '@/application/database-yjs/dispatch';
import { RelationLimit } from '@/application/database-yjs/fields/relation/relation.type';
import { getMultiple as getViews } from '@/application/services/domains/view';
import { LoadViewMeta, View } from '@/application/types';
import { isDatabaseContainer } from '@/application/view-utils';
import { ReactComponent as ArrowDownIcon } from '@/assets/icons/alt_arrow_down.svg';
import { ReactComponent as CountIcon } from '@/assets/icons/count.svg';
import { ReactComponent as DatabaseIcon } from '@/assets/icons/database.svg';
import { ReactComponent as TickIcon } from '@/assets/icons/tick.svg';
import { ReactComponent as TwoWayRelationIcon } from '@/assets/icons/two_way_relation.svg';
import { NormalModal } from '@/components/_shared/modal';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import FieldCustomIcon from '@/components/database/components/field/FieldCustomIcon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

import CustomIconPopover from 'src/components/_shared/cutsom-icon/CustomIconPopover';

import { RelationView } from './RelationView';

export type RelationCreationResult = {
  fieldName: string;
  relatedDatabaseId: string;
  isTwoWay: boolean;
  sourceLimit: RelationLimit;
  reciprocalFieldName?: string;
};

type RelationCandidate = {
  databaseId: string;
  databaseViewId: string;
  displayView: View;
};

function indexViews(views: View[]): Map<string, View> {
  const indexedViews = new Map<string, View>();
  const pending = [...views];
  let index = 0;

  while (index < pending.length) {
    const view = pending[index];

    index += 1;

    if (!view || indexedViews.has(view.view_id)) continue;
    indexedViews.set(view.view_id, view);
    pending.push(...view.children);
  }

  return indexedViews;
}

async function loadViewsById(
  workspaceId: string,
  viewIds: string[],
  loadViewMeta: LoadViewMeta
): Promise<Map<string, View>> {
  const uniqueViewIds = Array.from(new Set(viewIds.filter(Boolean)));

  if (uniqueViewIds.length === 0) return new Map();

  try {
    // The API chunks large lists internally, replacing one request per view
    // with one batch per 50 IDs.
    return indexViews(await getViews(workspaceId, uniqueViewIds, 0));
  } catch {
    // Keep compatibility with servers that do not expose the batch endpoint.
    const views = await Promise.all(
      uniqueViewIds.map(async (viewId) => {
        try {
          return await loadViewMeta(viewId);
        } catch {
          return null;
        }
      })
    );

    return indexViews(views.filter((view): view is View => Boolean(view)));
  }
}

function relationLimitLabel(t: TFunction, limit: RelationLimit) {
  return limit === RelationLimit.OneOnly ? t('grid.relation.limitOnePage') : t('grid.relation.limitNoLimit');
}

/**
 * Section heading above each control.
 *
 * Desktop renders these with `AFTextMenuItem(padding: zero)`, whose default
 * title style is `body.standard` — 14px/400 in `textColorScheme.primary`, NOT
 * a muted caption. The control sits `spacing.xs` (4px) below it.
 */
function SectionLabel({ children }: { children: ReactNode }) {
  return <div className='mb-1 text-sm text-text-primary'>{children}</div>;
}

/**
 * Port of `AFDropDownMenu` in its non-input (button) mode: a bordered trigger
 * that opens a shadowed popover list beneath it. Deliberately has no search
 * box — `updateFilteredItems` short-circuits to the full list when
 * `isInput` is false, which is how both dropdowns in this dialog are built.
 *
 * Implemented as a local disclosure rather than a portalled Radix menu because
 * the dialog is a MUI `Dialog` that runs its own focus trap.
 */
function AFDropdown({
  testId,
  leadingIcon,
  title,
  children,
}: {
  testId: string;
  leadingIcon: ReactNode;
  title: ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  return (
    <div ref={containerRef} className='relative'>
      <button
        type='button'
        data-testid={testId}
        aria-haspopup='listbox'
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
        className={cn(
          // `_DropdownMenuButton`: 1px border inset by spacing.m-1 / spacing.s-1,
          // children separated by spacing.xs.
          'flex w-full items-center gap-1 rounded-300 border px-[7px] py-[5px] text-left text-sm',
          'hover:border-border-primary-hover',
          open ? 'border-border-theme-thick' : 'border-border-primary'
        )}
      >
        {leadingIcon}
        <div className='flex min-w-0 flex-1 items-center gap-2'>{title}</div>
        <ArrowDownIcon className='h-5 w-5 shrink-0 text-icon-primary' />
      </button>

      {open ? (
        <div
          role='listbox'
          className={cn(
            // AFPopover: layer-01 surface, radius m, small shadow, offset
            // spacing.xs below the trigger, capped at 300px; the list itself
            // is padded by spacing.m.
            'absolute left-0 right-0 top-[calc(100%+4px)] z-10 max-h-[300px] overflow-y-auto',
            'appflowy-scroller rounded-300 bg-surface-layer-01 p-2 shadow-popover'
          )}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Row inside an {@link AFDropdown} popover, styled after `AFBaseButton` as used
 * by `DatabaseMetaItem` / `LimitOptionItem`: spacing.s × spacing.m padding,
 * radius m, and a hover-only background. Neither desktop builder tints the
 * selected row — `LimitOptionItem` marks it with a trailing tick instead.
 */
function AFDropdownItem({
  testId,
  selected,
  onSelect,
  showTick = false,
  children,
}: {
  testId: string;
  selected: boolean;
  onSelect: () => void;
  showTick?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type='button'
      role='option'
      aria-selected={selected}
      data-testid={testId}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 rounded-300 px-2 py-1.5 text-left text-sm text-text-primary',
        'hover:bg-fill-content-hover'
      )}
    >
      {children}
      {showTick && selected ? <TickIcon className='h-5 w-5 shrink-0 text-icon-info-thick' /> : null}
    </button>
  );
}

export function RelationCreationDialog({
  open,
  fieldId,
  initialFieldName,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  fieldId: string;
  initialFieldName: string;
  onOpenChange: (open: boolean) => void;
  onCreate: (result: RelationCreationResult) => void;
}) {
  const { t } = useTranslation();
  const { databaseDoc, databasePageId, loadDatabaseRelations, loadViewMeta, workspaceId } = useDatabaseContext();
  const updateIcon = useUpdatePropertyIconDispatch(fieldId);
  const [fieldName, setFieldName] = useState(initialFieldName);
  const [reciprocalFieldName, setReciprocalFieldName] = useState('');
  const [selectedDatabaseId, setSelectedDatabaseId] = useState('');
  const [sourceLimit, setSourceLimit] = useState(RelationLimit.NoLimit);
  const [isTwoWay, setIsTwoWay] = useState(false);
  const [loading, setLoading] = useState(false);
  // Keep the registered database view ID for identity, while rendering the
  // database container so users see the database name instead of "Grid".
  const [candidates, setCandidates] = useState<RelationCandidate[]>([]);

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
        //   2. For each `(databaseId, viewId)`, fetch the registered database
        //      view and its container. The workspace map points to the first
        //      internal view (usually named "Grid"), while the container owns
        //      the user-facing database name.
        //   3. Drop entries whose view fetch failed.
        // Force a refresh so a database created earlier in this session shows
        // up — the workspace cache is otherwise only invalidated on workspace
        // switch.
        const databaseRelations = (await loadDatabaseRelationsFn({ refresh: true })) ?? {};
        const entries = Object.entries(databaseRelations).filter((entry): entry is [string, string] => Boolean(entry[1]));
        const databaseViews = await loadViewsById(
          workspaceId,
          entries.map(([, viewId]) => viewId),
          loadViewMetaFn
        );
        const parentViews = await loadViewsById(
          workspaceId,
          Array.from(databaseViews.values())
            .filter((view) => !isDatabaseContainer(view))
            .map((view) => view.parent_view_id)
            .filter((viewId): viewId is string => Boolean(viewId)),
          loadViewMetaFn
        );
        const fetched = entries.map(([databaseId, viewId]) => {
          const databaseView = databaseViews.get(viewId);

          if (!databaseView) return null;

          const parentView = databaseView.parent_view_id
            ? parentViews.get(databaseView.parent_view_id)
            : undefined;
          const displayView = isDatabaseContainer(parentView) ? parentView : databaseView;

          return { databaseId, databaseViewId: databaseView.view_id, displayView };
        });

        if (cancelled) return;

        const seen = new Set<string>();
        const resolved: RelationCandidate[] = [];

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
  }, [open, workspaceId]);

  const selectedCandidate = useMemo(
    () => candidates.find((entry) => entry.databaseId === selectedDatabaseId),
    [candidates, selectedDatabaseId]
  );

  const currentCandidate = useMemo(
    () =>
      candidates.find(
        (entry) =>
          entry.databaseId === databaseDoc.guid ||
          entry.databaseViewId === databasePageId ||
          entry.displayView.view_id === databasePageId
      ),
    [candidates, databaseDoc.guid, databasePageId]
  );

  const isSelfRelation = Boolean(selectedCandidate && selectedCandidate.databaseId === currentCandidate?.databaseId);
  const sourceDatabaseName = currentCandidate?.displayView.name || t('grid.relation.thisDatabase');

  /**
   * Desktop rewrites BOTH name fields whenever a target database is picked
   * (`_RelatedToSection.onSelect`): a cross-database relation is named after
   * the target and its reciprocal after the source, while a self-relation
   * gets the dedicated "Related X" / "Related back to X" copy.
   */
  const handleSelectCandidate = useCallback(
    (candidate: RelationCandidate) => {
      setSelectedDatabaseId(candidate.databaseId);

      const isCurrentDatabase = candidate.databaseId === currentCandidate?.databaseId;
      const databaseName = candidate.displayView.name || t('menuAppHeader.defaultNewPageName');

      if (isCurrentDatabase) {
        setFieldName(t('grid.relation.relatedToProject', { name: databaseName }));
        setReciprocalFieldName(t('grid.relation.relatedBackToProject', { name: databaseName }));
      } else {
        setFieldName(databaseName);
        setReciprocalFieldName(currentCandidate?.displayView.name ?? '');
      }
    },
    [currentCandidate?.displayView.name, currentCandidate?.databaseId, t]
  );

  // Memoize the disabled flag so MUI's Button can bail out when only
  // unrelated state (limit, two-way toggle, …) changes.
  const okButtonProps = useMemo(() => ({ disabled: !selectedDatabaseId }), [selectedDatabaseId]);
  const dialogTitle = useMemo(
    () => (
      // Desktop's heading is `textStyle.heading4.prominent` (16px/700) aligned
      // to the leading edge; NormalModal centres its title by default.
      <span className='block text-left text-base font-bold text-text-primary'>{t('grid.relation.relatedTo')}</span>
    ),
    [t]
  );

  return (
    <NormalModal
      keepMounted={false}
      open={open}
      onClose={() => onOpenChange(false)}
      title={dialogTitle}
      classes={MODAL_CLASSES}
      PaperProps={MODAL_PAPER_PROPS}
      okText={t('button.add')}
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
      {/* Desktop separates each section by `spacing.xl` (16px). */}
      <div className='grid gap-4'>
        <div>
          <SectionLabel>{t('board.propertyName')}</SectionLabel>
          {/*
            `_propertyName`: icon button + spacing.m gap + 32px text field. The
            icon writes through immediately, matching desktop's dialog-scoped
            FieldEditorBloc.
          */}
          <div className='flex items-center gap-2'>
            <CustomIconPopover
              tabs={['icon']}
              defaultActiveTab={'icon'}
              enableColor={false}
              removeIcon={() => updateIcon('')}
              onSelectIcon={(icon) => updateIcon(icon.value)}
            >
              <Button
                variant={'outline'}
                className={'h-8 w-8 shrink-0 p-0'}
                data-testid='relation-field-icon-trigger'
                aria-label={t('board.propertyName')}
              >
                <FieldCustomIcon fieldId={fieldId} className={'h-5 w-5 text-text-secondary'} />
              </Button>
            </CustomIconPopover>
            <div className='relative min-w-0 flex-1'>
              {/*
                Desktop shows the target database's icon inside the name field,
                but suppresses it for a self-relation.
              */}
              {selectedCandidate && !isSelfRelation ? (
                <span className='pointer-events-none absolute left-2 top-1/2 flex -translate-y-1/2 items-center'>
                  <PageIcon
                    className='flex !h-5 !w-5 items-center justify-center text-xl'
                    iconSize={20}
                    view={selectedCandidate.displayView}
                  />
                </span>
              ) : null}
              <Input
                className={cn(selectedCandidate && !isSelfRelation && 'pl-9')}
                data-testid='relation-field-name-input'
                value={fieldName}
                placeholder={t('grid.field.newProperty')}
                onChange={(event) => setFieldName(event.target.value)}
              />
            </div>
          </div>
        </div>

        <div>
          <SectionLabel>{t('grid.relation.relatedTo')}</SectionLabel>
          <AFDropdown
            testId='relation-database-trigger'
            leadingIcon={<DatabaseIcon className='h-5 w-5 shrink-0 text-icon-secondary' />}
            title={
              selectedCandidate ? (
                <>
                  {/* `titleBuilder` drops the icon when the target is this database. */}
                  {isSelfRelation ? null : (
                    <PageIcon
                      className='flex !h-5 !w-5 shrink-0 items-center justify-center text-xl'
                      iconSize={20}
                      view={selectedCandidate.displayView}
                    />
                  )}
                  <span className='min-w-0 flex-1 truncate text-text-primary'>
                    {isSelfRelation
                      ? t('grid.relation.thisDatabase')
                      : selectedCandidate.displayView.name || t('menuAppHeader.defaultNewPageName')}
                  </span>
                </>
              ) : (
                <span className='min-w-0 flex-1 truncate text-text-tertiary'>{t('grid.relation.selectADatabse')}</span>
              )
            }
          >
            {(close) =>
              loading ? (
                <div className='px-2 py-1.5 text-sm text-text-tertiary'>{t('loading')}</div>
              ) : candidates.length === 0 ? (
                <div className='px-2 py-1.5 text-sm text-text-tertiary'>{t('grid.relation.emptySearchResult')}</div>
              ) : (
                // `DatabaseMetaItem` lists every database under its own name —
                // only the trigger relabels the current one as "This database".
                candidates.map((candidate) => (
                  <AFDropdownItem
                    key={candidate.databaseId}
                    testId={`relation-candidate-${candidate.databaseId}`}
                    selected={candidate.databaseId === selectedDatabaseId}
                    onSelect={() => {
                      handleSelectCandidate(candidate);
                      close();
                    }}
                  >
                    <RelationView view={candidate.displayView} />
                  </AFDropdownItem>
                ))
              )
            }
          </AFDropdown>
        </div>

        <div>
          <SectionLabel>{t('grid.relation.limit')}</SectionLabel>
          <AFDropdown
            testId='relation-limit-trigger'
            leadingIcon={<CountIcon className='h-5 w-5 shrink-0 text-icon-secondary' />}
            title={<span className='min-w-0 flex-1 truncate text-text-primary'>{relationLimitLabel(t, sourceLimit)}</span>}
          >
            {(close) =>
              [RelationLimit.NoLimit, RelationLimit.OneOnly].map((limit) => (
                <AFDropdownItem
                  key={limit}
                  testId={`relation-limit-option-${limit}`}
                  selected={sourceLimit === limit}
                  showTick
                  onSelect={() => {
                    setSourceLimit(limit);
                    close();
                  }}
                >
                  <span className='min-w-0 flex-1 truncate'>{relationLimitLabel(t, limit)}</span>
                </AFDropdownItem>
              ))
            }
          </AFDropdown>
        </div>

        {/* `RelationToggle`: bordered card, spacing.xl / spacing.l padding. */}
        <div className='rounded-300 border border-border-primary px-4 py-3'>
          <div className='flex items-center gap-2'>
            <TwoWayRelationIcon
              className={cn('h-5 w-5 shrink-0', selectedDatabaseId ? 'text-icon-primary' : 'text-icon-tertiary')}
            />
            <span className={cn('min-w-0 flex-1 text-sm', selectedDatabaseId ? 'text-text-primary' : 'text-text-tertiary')}>
              {t('grid.relation.twoWayRelation')}
            </span>
            <Switch
              checked={isTwoWay}
              disabled={!selectedDatabaseId}
              data-testid='relation-two-way-switch'
              onCheckedChange={setIsTwoWay}
            />
          </div>

          {isTwoWay && selectedDatabaseId ? (
            <div className='mt-4'>
              {/* Desktop labels the reciprocal differently for a self-relation. */}
              <div className='mb-1 text-xs font-medium text-text-secondary'>
                {isSelfRelation
                  ? t('grid.relation.inverseRelatedPropertyName')
                  : t('grid.relation.propertyNameInRelatedDatabase')}
              </div>
              <Input
                data-testid='relation-reciprocal-name-input'
                value={reciprocalFieldName}
                placeholder={t('grid.field.newProperty')}
                onChange={(event) => setReciprocalFieldName(event.target.value)}
              />
            </div>
          ) : null}
        </div>
      </div>
    </NormalModal>
  );
}

export default RelationCreationDialog;
