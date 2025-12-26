import React from 'react';
import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs/database.type';
import { DateFormat, FieldId, RowId, TimeFormat } from '@/application/types';

export interface Cell {
  createdAt: number;
  lastModified: number;
  fieldType: FieldType;
  data: unknown;
}

export interface TextCell extends Cell {
  fieldType: FieldType.RichText;
  data: string;
}

export interface AICell extends Cell {
  fieldType: FieldType.AISummaries | FieldType.AITranslations;
  data: string;
}

export interface NumberCell extends Cell {
  fieldType: FieldType.Number;
  data: string;
}

export interface CheckboxCell extends Cell {
  fieldType: FieldType.Checkbox;
  data: string; // 'Yes' | 'No' | '1' | '0' | 'true' | 'false'
}

export interface UrlCell extends Cell {
  fieldType: FieldType.URL;
  data: string;
}

export type SelectionId = string;

export interface SelectOptionCell extends Cell {
  fieldType: FieldType.SingleSelect | FieldType.MultiSelect;
  data: SelectionId;
}

export interface DataTimeTypeOption {
  timeFormat: TimeFormat;
  dateFormat: DateFormat;
}

export interface DateTimeCell extends Cell {
  fieldType: FieldType.DateTime;
  data: string;
  endTimestamp?: string;
  includeTime?: boolean;
  isRange?: boolean;
  reminderId?: string;
}

export enum FileMediaType {
  Image = 1,
  Video = 5,
  Link = 2,
  Other = 0,
  Audio = 6,
  // Eg. pdf, doc, etc.
  Document = 3,
  // Eg. zip, rar, etc.
  Archive = 4,
  // Eg. txt, csv, etc.
  Text = 7,
}

export enum FileMediaUploadType {
  CloudMedia = 2,
  NetworkMedia = 1,
}

export interface FileMediaCellDataItem {
  file_type: FileMediaType;
  id: string;
  name: string;
  upload_type: FileMediaUploadType;
  url: string;
}

export type FileMediaCellData = FileMediaCellDataItem[];

export interface FileMediaCell extends Cell {
  fieldType: FieldType.FileMedia;
  data: FileMediaCellData;
}

export interface ChecklistCell extends Cell {
  fieldType: FieldType.Checklist;
  data: string;
}

export interface RelationCell extends Cell {
  fieldType: FieldType.Relation;
  data: Y.Array<string>;
}

export type RelationCellData = RowId[];

export interface RollupCell extends Cell {
  fieldType: FieldType.Rollup;
  data: string;
  rawNumeric?: number;
  list?: string[];
}

export interface PersonCell extends Cell {
  fieldType: FieldType.Person;
  data: string;
}

export interface CellProps<T extends Cell> {
  cell?: T;
  rowId: string;
  fieldId: FieldId;
  style?: React.CSSProperties;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
  editing?: boolean;
  setEditing?: (editing: boolean) => void;
  isHovering?: boolean;
  wrap: boolean;
  onCellUpdated?: (cell: Cell) => void;
}
