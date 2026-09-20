import { FieldId, RowCoverType } from '@/application/types';

import type { RollupFilterMetadata } from './fields/rollup/rollup.type';

export enum FieldVisibility {
  AlwaysShown = 0,
  HideWhenEmpty = 1,
  AlwaysHidden = 2,
}

export enum FieldType {
  RichText = 0,
  Number = 1,
  DateTime = 2,
  SingleSelect = 3,
  MultiSelect = 4,
  Checkbox = 5,
  URL = 6,
  Checklist = 7,
  LastEditedTime = 8,
  CreatedTime = 9,
  Relation = 10,
  Summary = 11,
  Translate = 12,
  Time = 13,
  Media = 14,
  Person = 15,
  Rollup = 16,
  CreatedBy = 17,
  LastEditedBy = 18,
  Formula = 19,
}

export const ATTRIBUTION_FIELD_TYPES = [FieldType.CreatedBy, FieldType.LastEditedBy] as const;

export function isAttributionFieldType(fieldType: FieldType | undefined): boolean {
  return (
    fieldType !== undefined && ATTRIBUTION_FIELD_TYPES.includes(fieldType as (typeof ATTRIBUTION_FIELD_TYPES)[number])
  );
}

export const AI_FIELD_TYPES = [FieldType.Summary, FieldType.Translate] as const;

export function isAIFieldType(fieldType: FieldType | undefined): boolean {
  return fieldType !== undefined && AI_FIELD_TYPES.includes(fieldType as (typeof AI_FIELD_TYPES)[number]);
}

export enum CalculationType {
  Average = 0,
  Max = 1,
  Median = 2,
  Min = 3,
  Sum = 4,
  Count = 5,
  CountEmpty = 6,
  CountNonEmpty = 7,
  DateEarliest = 8,
  DateLatest = 9,
  DateRange = 10,
  NumberRange = 11,
  NumberMode = 12,
  CountChecked = 13,
  CountUnchecked = 14,
  PercentEmpty = 15,
  PercentNotEmpty = 16,
  CountUnique = 17,
  CountValue = 18,
  PercentChecked = 19,
  PercentUnchecked = 20,
}

export enum RollupDisplayMode {
  Calculated = 0,
  OriginalList = 1,
  UniqueList = 2,
}

export enum SortCondition {
  Ascending = 0,
  Descending = 1,
}

export enum FilterType {
  And = 0,
  Or = 1,
  Data = 2,
}

export interface Filter {
  fieldId: FieldId;
  filterType: FilterType;
  condition: number;
  id: string;
  content: string;
  /** Per-row operator: null for the first row ("Where"), And/Or for subsequent rows */
  operator?: FilterType.And | FilterType.Or | null;
  /** The actual field column type (RichText, Number, etc.) */
  fieldType?: FieldType;
  /** Persisted Rollup filter variant used by Desktop to distinguish Number from Text filters. */
  rollupTargetFieldType?: FieldType;
  rollupMetadata?: RollupFilterMetadata;
}

export enum CalendarLayout {
  MonthLayout = 0,
  WeekLayout = 1,
  DayLayout = 2,
}

/// Timeline scale presets, finest to coarsest, stored under `layout_ty` like
/// `CalendarLayout`. Wire values match `TimelineLayout` in
/// `libs/collab/src/database/views/layout_settings.rs`.
export enum TimelineLayout {
  Hours = 0,
  Day = 1,
  Week = 2,
  BiWeek = 3,
  Month = 4,
  Quarter = 5,
  Year = 6,
}

/** Notion's "Shift dependents" options, stored as `dependency_shift_ty`. */
export enum TimelineDependencyShift {
  /** Move a dependent only as far as needed to start after the bar it depends on. */
  OverlapOnly = 0,
  /** Move dependents by the same distance, preserving the gap between items. */
  MaintainGap = 1,
  /** Never move dependents automatically. */
  Never = 2,
}

/** Which side of the relation the bound dependency field lists, stored as `dependency_direction`. */
export enum TimelineDependencyDirection {
  /** The field's cells list the rows this row depends on ("Blocked by"). */
  BlockedBy = 0,
  /** The field's cells list the rows that depend on this row ("Blocking"). */
  Blocking = 1,
}

/** Classic scheduling link types, stored per link as `ty` in `dependency_links`. */
export enum TimelineDependencyType {
  /** The successor starts once the predecessor finishes (default). */
  FinishToStart = 0,
  StartToStart = 1,
  FinishToFinish = 2,
  StartToFinish = 3,
}

export interface TimelineDependencyLink {
  type: TimelineDependencyType;
  /** Whole days the successor is held after the constraint is met; negative = lead. */
  lag: number;
}

/** Key of `dependency_links` for the link from `predecessorId` to `successorId`. */
export function timelineLinkKey(predecessorId: string, successorId: string) {
  return `${predecessorId}:${successorId}`;
}

export interface TimelineLayoutSetting {
  /// DateTime field plotted on the timeline.
  fieldId: string;
  layout: TimelineLayout;
  /// Whether the property table is docked to the left of the canvas.
  showTable: boolean;
  firstDayOfWeek: number;
  /** User preference, read like the calendar does so hour labels match. */
  use24Hour: boolean;
  /// Optional second date field supplying each bar's end ("separate start and end dates").
  endFieldId: string;
  /// Relation field (pointing at this database) whose linked rows are the row's dependencies.
  dependencyFieldId: string;
  /// Whether `dependencyFieldId` lists predecessors ("Blocked by") or successors ("Blocking").
  dependencyDirection: TimelineDependencyDirection;
  /// Per-link type and lag, keyed by `timelineLinkKey`; a missing entry is finish-to-start, no lag.
  dependencyLinks: Record<string, TimelineDependencyLink>;
  /// How dependents move when the bar they depend on is dragged.
  dependencyShift: TimelineDependencyShift;
  /// Shifted dependents never land on a Saturday or Sunday.
  avoidWeekends: boolean;
  /// Number field holding 0–100 progress drawn as a fill inside the bar.
  progressFieldId: string;
  /// Properties shown as columns of the docked table, in order (separate from bar chips).
  tableFieldIds: string[];
}

export interface CalendarLayoutSetting {
  fieldId: string;
  firstDayOfWeek: number;
  showWeekNumbers: boolean;
  showWeekends: boolean;
  layout: CalendarLayout;
  numberOfDays: number;
  use24Hour: boolean;
}

export enum RowMetaKey {
  DocumentId = 'document_id',
  IconId = 'icon_id',
  CoverId = 'cover_id',
  IsDocumentEmpty = 'is_document_empty',
}

export interface RowMeta {
  documentId: string;
  cover: {
    data: string;
    cover_type: RowCoverType;
    offset?: number;
  } | null;
  icon: string;
  isEmptyDocument: boolean;
}

export enum AITranslateLanguage {
  Traditional_Chinese,
  English,
  French,
  German,
  Hindi,
  Spanish,
  Portuguese,
  Standard_Arabic,
  Simplified_Chinese,
}

export enum RowCommentKey {
  Id = 'id',
  ParentCommentId = 'parent_comment_id',
  Content = 'content',
  AuthorId = 'author_id',
  CreatedAt = 'created_at',
  UpdatedAt = 'updated_at',
  IsResolved = 'is_resolved',
  ResolvedBy = 'resolved_by',
  ResolvedAt = 'resolved_at',
  Reactions = 'reactions',
  Attachments = 'attachments',
}

export enum DateGroupCondition {
  Relative = 0,
  Day = 1,
  Week = 2,
  Month = 3,
  Year = 4,
}
