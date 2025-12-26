import { Filter } from '@/application/database-yjs';

export interface RollupTypeOption {
  relation_field_id: string;
  target_field_id: string;
  calculation_type: number;
  show_as: number;
  condition_value?: string;
}

export interface RollupFilter extends Filter {
  condition: number;
}
