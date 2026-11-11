import { FieldType } from '@/application/database-yjs/database.type';
import { ReactComponent as TextIcon } from '@/assets/icons/text.svg';
import { FieldTypeIcon } from '@/components/database/components/field/FieldTypeIcon';

/** Form text questions use the design's T icon; database columns retain their own glyph. */
export function FormFieldTypeIcon({ type, className }: { type: FieldType; className?: string }) {
  return type === FieldType.RichText ? (
    <TextIcon className={className} />
  ) : (
    <FieldTypeIcon type={type} className={className} />
  );
}
