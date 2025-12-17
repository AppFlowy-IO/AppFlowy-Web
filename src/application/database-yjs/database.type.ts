import { FieldId, RowCoverType } from '@/application/types';

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
  AISummaries = 11,
  AITranslations = 12,
  FileMedia = 14,
  Person = 15,
  Time = 16, // Added missing FieldType.Time
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
}

export enum CalendarLayout {
  MonthLayout = 0,
  WeekLayout = 1,
  DayLayout = 2,
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
    data: string,
    cover_type: RowCoverType,
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
  Simplified_Chinese
}

export enum DateGroupCondition {
  Relative = 0,
  Day = 1,
  Week = 2,
  Month = 3,
  Year = 4
}