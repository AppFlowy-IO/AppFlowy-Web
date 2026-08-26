import { Filter } from '@/application/database-yjs/database.type';

export enum RollupShowAsType {
  Number = 0,
  Bar = 1,
  Ring = 2,
}

export interface RollupVisualizationOption {
  type: RollupShowAsType;
  color: string;
  divisor: number;
  showNumber: boolean;
}

export interface RollupTypeOption {
  relation_field_id: string;
  target_field_id: string;
  calculation_type: number;
  show_as: number;
  condition_value?: string;
  __rollup_show_as_type__?: number;
  __rollup_show_as_color__?: string;
  __rollup_show_as_divisor__?: number;
  __rollup_show_as_show_number__?: boolean;
}

export interface RollupFilter extends Filter {
  condition: number;
}
