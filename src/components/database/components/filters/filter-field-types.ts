import { FieldType } from '@/application/database-yjs';

// Desktop parity (`FieldType.canCreateFilter`): Time fields cannot be filtered.
// Summary / Translate / Media are already excluded by PropertiesMenu defaults.
export const FILTER_EXCLUDED_FIELD_TYPES = [FieldType.Time];
