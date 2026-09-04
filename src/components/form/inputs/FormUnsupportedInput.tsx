import { PublicQuestion } from '@/application/types/form';

/**
 * Placeholder for Phase-2 question kinds (files / person / relation). The
 * server can emit them today; we render a neutral disabled stub so the
 * form remains usable for the other questions on the page. Marking the
 * input as disabled also keeps it out of keyboard tab focus.
 */
export function FormUnsupportedInput({
  kind,
}: {
  kind: PublicQuestion['kind'];
}) {
  return (
    <div className='rounded-md border border-dashed border-line-divider bg-fill-content px-3 py-2 text-sm text-text-caption'>
      {label(kind)} questions aren’t supported on the web yet.
    </div>
  );
}

function label(kind: PublicQuestion['kind']): string {
  switch (kind) {
    case 'files':
      return 'File upload';
    case 'person':
      return 'Person picker';
    case 'relation':
      return 'Relation';
    default:
      return 'This';
  }
}
