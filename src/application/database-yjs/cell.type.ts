import { FieldId, RowId } from '@/application/types';
import { DateFormat, TimeFormat } from '@/application/database-yjs/index';
import { FieldType } from '@/application/database-yjs/database.type';
import React from 'react';
import * as Y from 'yjs';

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

export interface NumberCell extends Cell {
  fieldType: FieldType.Number;
  data: string;
}

export interface CheckboxCell extends Cell {
  fieldType: FieldType.Checkbox;
  data: boolean;
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
  Image = 'Image',
  Video = 'Video',
  Link = 'Link',
  Other = 'Other',
}

export enum FileMediaUploadType {
  CloudMedia = 'CloudMedia',
  NetworkMedia = 'NetworkMedia',
}

export interface FileMediaCellDataItem {
  file_type: FileMediaType;
  id: string;
  name: string;
  upload_type: FileMediaUploadType;
  url: string;
}

export type FileMediaCellData = FileMediaCellDataItem[]

export interface FileMediaCell extends Cell {
  fieldType: FieldType.FileMedia;
  data: FileMediaCellData;
}

export interface DateTimeCellData {
  date?: string;
  time?: string;
  timestamp?: number;
  includeTime?: boolean;
  endDate?: string;
  endTime?: string;
  endTimestamp?: number;
  isRange?: boolean;
}

export interface ChecklistCell extends Cell {
  fieldType: FieldType.Checklist;
  data: string;
}

export interface RelationCell extends Cell {
  fieldType: FieldType.Relation;
  data: Y.Array<unknown>;
}

export type RelationCellData = RowId[];

export interface CellProps<T extends Cell> {
  cell?: T;
  rowId: string;
  fieldId: FieldId;
  style?: React.CSSProperties;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
}
