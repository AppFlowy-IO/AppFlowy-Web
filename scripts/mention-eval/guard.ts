/**
 * The ranking switches the @-mention replay guards (MEN-X-07): a switch may default on only while
 * the configuration its default ships passes its gates (`metrics.ts`). `run-eval.mjs` and
 * `mention-eval-fixtures.test.ts` refuse a switch that defaults on while its configuration fails.
 * Desktop's `mention_eval_parity_test.dart` applies the same rule to `FeatureFlag.mentionPickMemory`,
 * and will to Desktop's v2 switch once it exists.
 *
 * - `MENTION_TYPEAHEAD_V2_DEFAULT` ships `typeahead_v2`: the picker's v2 with pick memory off, as
 *   pick memory defaults.
 * - `MENTION_PICK_MEMORY_DEFAULT` ships `pick_memory`: the ranking with pick memory, with v2 on or
 *   off (with v2 off it re-tiers the server's answers, which the local-lane replay does not model).
 *
 * With both on by default the picker ranks as `pick_memory`, and both must pass: a user who turns
 * pick memory off gets `typeahead_v2`.
 */
import { MENTION_PICK_MEMORY_DEFAULT } from '@/components/editor/components/panels/mention-panel/mentionPickMemory';
import { MENTION_TYPEAHEAD_V2_DEFAULT } from '@/components/editor/components/panels/mention-panel/mentionTypeaheadFlag';

import { MENTION_EVAL_CONFIGURATIONS, MentionEvalConfiguration } from './metrics';

/** Whether each configuration's switch defaults on. */
export type MentionEvalSwitchDefaults = Readonly<Record<MentionEvalConfiguration, boolean>>;

/** The Web switch whose default ships each configuration. */
export const MENTION_EVAL_SWITCHES: Readonly<Record<MentionEvalConfiguration, string>> = {
  typeahead_v2: 'MENTION_TYPEAHEAD_V2_DEFAULT',
  pick_memory: 'MENTION_PICK_MEMORY_DEFAULT',
};

/** Web's defaults, read from the switches themselves. */
export const MENTION_EVAL_WEB_DEFAULTS: MentionEvalSwitchDefaults = {
  typeahead_v2: MENTION_TYPEAHEAD_V2_DEFAULT,
  pick_memory: MENTION_PICK_MEMORY_DEFAULT,
};

/** A verdict as `verdict.json` holds it, or as `mentionEvalVerdict` returns it. */
export interface MentionEvalGuardedVerdict {
  readonly configurations?: Readonly<Partial<Record<string, { readonly passed?: unknown }>>>;
}

/**
 * The configurations whose switch defaults on while their verdict does not pass, in
 * {@link MENTION_EVAL_CONFIGURATIONS} order; empty when every default is allowed. A configuration
 * the verdict lacks does not pass.
 */
export function mentionEvalBlockedDefaults(
  verdict: MentionEvalGuardedVerdict,
  defaults: MentionEvalSwitchDefaults = MENTION_EVAL_WEB_DEFAULTS
): MentionEvalConfiguration[] {
  return MENTION_EVAL_CONFIGURATIONS.filter((name) => defaults[name] && verdict.configurations?.[name]?.passed !== true);
}
