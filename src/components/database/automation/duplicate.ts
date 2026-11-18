import {
  DatabaseRule,
  isCustomSchedule,
  ruleApi,
  RuleDefinition,
  RuleSchedule,
  ScheduleState,
} from '@/application/services/js-services/http/automation-api';

import { canEditRule, Capabilities } from './model';

type Copy = { source: string; id: string; definition: RuleDefinition; calendar?: RuleSchedule };

function calendarDefinition(state: ScheduleState, caps: Capabilities): RuleSchedule {
  const {
    revision: _revision,
    next_due_at: _nextDueAt,
    row_id,
    frequency,
    starts_on,
    ends_on,
    local_time,
    timezone,
    interval,
    weekdays,
    ...unknown
  } = state;

  if (
    Object.keys(unknown).length ||
    !['daily', 'weekly', 'monthly', ...(caps.customRecurrence ? ['yearly'] : [])].includes(frequency) ||
    (!caps.customRecurrence && isCustomSchedule(state))
  )
    throw Error('Unsupported schedule');
  return {
    row_id,
    frequency,
    starts_on,
    ends_on,
    local_time,
    timezone,
    ...(caps.customRecurrence && { interval: interval ?? 1, weekdays: weekdays ?? [] }),
  };
}

/** Read the definition and its separately revisioned calendar before creating the disabled copy. */
export async function prepareCopy(
  workspace: string,
  database: string,
  source: string,
  id: string,
  nameFor: (name: string) => string,
  caps: Capabilities,
  row?: string
): Promise<Copy> {
  const rule = row
    ? await ruleApi.get(workspace, database, source, undefined, row)
    : await ruleApi.get(workspace, database, source);

  if (!canEditRule(rule, caps)) throw Error('Unsupported rule');
  let calendar: RuleSchedule | undefined;

  if (rule.trigger.type === 'scheduled') {
    try {
      const state = row
        ? await ruleApi.getSchedule(workspace, database, source, undefined, row)
        : await ruleApi.getSchedule(workspace, database, source);

      if (state.revision !== rule.revision) throw Error('Source rule changed');
      if (row && state.row_id !== row) throw Error('Source row changed');
      calendar = calendarDefinition(state, caps);
    } catch (e) {
      if (typeof e !== 'object' || !e || !('code' in e) || e.code !== -2) throw e;
    }
  }

  return {
    id,
    source,
    calendar,
    definition: {
      name: [...nameFor(rule.name)].slice(0, 200).join(''),
      enabled: false,
      timezone: rule.timezone,
      trigger: rule.trigger,
      actions: rule.actions,
      conditions: rule.conditions,
    },
  };
}

/** Retain Copy across ambiguous failures. Create replays by caller UUID, calendar writes use its original revision. */
export async function saveCopy(
  workspace: string,
  database: string,
  copy: Copy,
  caps: Capabilities,
  row?: string
): Promise<void> {
  const scope: [] | [string] = row ? [row] : [];
  const target: DatabaseRule = await ruleApi.create(workspace, database, copy.id, copy.definition, ...scope);

  if (!copy.calendar) return;
  let current: ScheduleState | undefined;

  try {
    current = row
      ? await ruleApi.getSchedule(workspace, database, target.id, undefined, row)
      : await ruleApi.getSchedule(workspace, database, target.id);
  } catch (e) {
    if (typeof e !== 'object' || !e || !('code' in e) || e.code !== -2) throw e;
  }

  if (current) {
    if (JSON.stringify(calendarDefinition(current, caps)) !== JSON.stringify(copy.calendar))
      throw Error('Copy calendar changed');
    return;
  }

  await ruleApi.putSchedule(workspace, database, target.id, target.revision, copy.calendar, ...scope);
}
