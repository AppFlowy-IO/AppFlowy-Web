import { EventInput } from '@fullcalendar/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useCalendarLayoutSetting, useDatabaseContext, usePrimaryFieldId } from '@/application/database-yjs';
import { useNewRowDispatch } from '@/application/database-yjs/dispatch/row';
import { YDatabase, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { CalendarDraftSelection, CalendarEventDraft } from './CalendarEventDraft';

export interface CalendarDraft {
  id: string;
  context: CalendarEventDraft['context'];
  saving: boolean;
}

export function useCalendarDraft(events: EventInput[], emptyEvents: EventInput[]) {
  const context = useDatabaseContext();
  const setting = useCalendarLayoutSetting();
  const primary = usePrimaryFieldId();
  const createRow = useNewRowDispatch();
  const active = useRef<CalendarEventDraft | null>(null);
  const [model, setModel] = useState<CalendarEventDraft | null>(null);
  const [revision, setRevision] = useState(0);
  const mounted = useRef(true);

  const remove = useCallback((target: CalendarEventDraft) => {
    if (active.current !== target) return;
    active.current = null;
    if (mounted.current) setModel(null);
    // Wait for the editor to release its row observers before destroying them.
    setTimeout(() => target.dispose(), 0);
  }, []);

  const finishDraft = useCallback(
    async (force = false) => {
      const target = active.current;

      if (!target) return null;
      if (context.readOnly || context.canWrite === false) {
        remove(target);
        return null;
      }

      const promise = target.commit(
        (draft) =>
          createRow({
            draft,
            tailing: true,
            suppressAutoOpen: true,
            templateId: target.templateId,
            skipDefaultTemplate: !target.templateId,
          }),
        force
      );

      if (mounted.current) setRevision((value) => value + 1);
      try {
        const id = await promise;

        if (!id) remove(target);
        return id;
      } finally {
        if (mounted.current) setRevision((value) => value + 1);
        else remove(target);
      }
    },
    [context.readOnly, context.canWrite, createRow, remove]
  );

  const startDraft = useCallback(
    (selection: CalendarDraftSelection) => {
      if (context.readOnly || context.canWrite === false || !setting?.fieldId) return null;
      // A modal editor owns the active draft. Repeated FullCalendar select
      // callbacks must not create another one before that editor is dismissed.
      if (active.current) return active.current.id;
      const next = new CalendarEventDraft(context, setting.fieldId, selection);

      active.current = next;
      setModel(next);
      return next.id;
    },
    [context, setting?.fieldId]
  );

  const discardDraft = useCallback(() => {
    const target = active.current;

    if (target && !target.saving && !target.savedId) remove(target);
  }, [remove]);

  useEffect(() => {
    if (!model) return;
    const changed = () => setRevision((value) => value + 1);

    model.rowDoc.on('update', changed);
    model.databaseDoc.on('update', changed);
    return () => {
      model.rowDoc.off('update', changed);
      model.databaseDoc.off('update', changed);
    };
  }, [model]);

  useEffect(() => {
    if (!model) return;
    const database = context.databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
    const filters = database.get(YjsDatabaseKey.views).get(context.activeViewId)?.get(YjsDatabaseKey.filters);
    const isListed = [...events, ...emptyEvents].some((event) => event.id === model.savedId);

    // A saved row may be unscheduled or hidden by the view's filters. Such a
    // row must not keep a placeholder alive while waiting for a dated event.
    if (model.savedId && (isListed || (filters?.length ?? 0) > 0)) remove(model);
    else if (
      !model.saving &&
      (context.readOnly || context.canWrite === false || model.context.activeViewId !== context.activeViewId)
    )
      remove(model);
  }, [
    context.activeViewId,
    context.databaseDoc,
    context.readOnly,
    context.canWrite,
    events,
    emptyEvents,
    model,
    remove,
    revision,
  ]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const target = active.current;

      if (target && !target.saving) remove(target);
    };
  }, [remove]);

  const saving = !!model && (model.saving || !!model.savedId);
  const title = model && primary ? model.cells.get(primary)?.get(YjsDatabaseKey.data) : '';
  const draft = useMemo<CalendarDraft | null>(
    () =>
      model
        ? {
            id: model.id,
            context: { ...model.context, readOnly: saving },
            saving,
          }
        : null,
    [model, saving]
  );

  const event = useMemo<EventInput | null>(() => {
    if (!model) return null;
    const { start, end, allDay } = model.selection;

    return {
      id: model.id,
      title: typeof title === 'string' ? title : '',
      start,
      end,
      allDay,
      editable: false,
      classNames: ['fc-event-open'],
      extendedProps: {
        rowId: model.id,
        isDraft: true,
        isActiveRow: true,
        isRange: !!end,
        start,
        end,
        includeTime: !allDay,
      },
    };
  }, [model, title]);

  return { draft, event, startDraft, finishDraft, discardDraft };
}
