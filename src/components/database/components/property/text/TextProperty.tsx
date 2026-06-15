import { TextField } from '@mui/material';

import { CellProps, TextCell } from '@/application/database-yjs/cell.type';

export function TextProperty({ cell }: CellProps<TextCell>) {
  return (
    <TextField
      value={cell?.data}
      inputProps={{
        readOnly: true,
      }}
      fullWidth
      size={'small'}
      sx={{
        '& .MuiInputBase-root': {
          fontSize: '0.875rem',
          borderRadius: '8px',
        },

        '& .MuiInputBase-input': {
          padding: '4px 8px',
          fontWeight: 500,
        },
      }}
    />
  );
}

export default TextProperty;
