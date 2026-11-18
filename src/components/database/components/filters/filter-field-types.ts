import { FieldType } from '@/application/database-yjs';

// Neither Time nor Button has a filter editor in Desktop.
// Summary / Translate / Media are already excluded by PropertiesMenu defaults.
export const FILTER_EXCLUDED_FIELD_TYPES = [FieldType.Time, FieldType.Button];
