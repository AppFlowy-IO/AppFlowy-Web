import { useDatabaseFields, useDatabaseFieldsVersion, useFormLayoutSnapshot } from '@/application/database-yjs';

import { FormPreviewButton } from './FormPreviewButton';
import { FormShareButton } from './FormShareButton';

/** Header and body share the view-scoped sharing service. */
export default function FormActions() {
  const snapshot = useFormLayoutSnapshot();
  const fields = useDatabaseFields();
  const fieldsVersion = useDatabaseFieldsVersion();

  return (
    <div data-testid='form-actions' className='flex items-center gap-1'>
      <FormPreviewButton snapshot={snapshot} fieldsMap={fields} fieldsVersion={fieldsVersion} />
      <FormShareButton />
    </div>
  );
}
