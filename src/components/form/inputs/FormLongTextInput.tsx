import { TextareaAutosize } from '@/components/ui/textarea-autosize';

export function FormLongTextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <TextareaAutosize
      className='w-full py-2'
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      minRows={5}
    />
  );
}
