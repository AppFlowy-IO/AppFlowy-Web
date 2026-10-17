import { PropertyMutationConfirm } from '@/components/database/components/property/PropertyMutationConfirm';

export function ClearCellsConfirm({ open, onClose, fieldId }: { open: boolean; onClose: () => void; fieldId: string }) {
  return open ? <PropertyMutationConfirm fieldId={fieldId} kind='clear' onClose={onClose} /> : null;
}

export default ClearCellsConfirm;
