import { styled, Switch as MUISwitch, SwitchProps } from '@mui/material';

export const Switch = styled((props: SwitchProps) => (
  <MUISwitch
    focusVisibleClassName=".Mui-focusVisible"
    disableRipple
    {...props}
  />
))(({ theme, size }) => ({
  width: size === 'small' ? 30 : 56,
  height: size === 'small' ? 18 : 32,
  padding: 0,
  '& .MuiSwitch-switchBase': {
    padding: 0,
    margin: 2,
    transitionDuration: '300ms',
    '&.Mui-checked': {
      transform: size === 'small' ? 'translateX(12px)' : 'translateX(16px)',
      color: '#fff',
      '& + .MuiSwitch-track': {
        backgroundColor: 'var(--fill-default)',
        opacity: 1,
        border: 0,
        ...theme.applyStyles('dark', {
          backgroundColor: 'var(--fill-default)',
        }),
      },
      '&.Mui-disabled + .MuiSwitch-track': {
        opacity: 0.5,
      },
    },
    '&.Mui-focusVisible .MuiSwitch-thumb': {
      color: 'var(--fill-default)',
      border: '6px solid #fff',
    },
    '&.Mui-disabled .MuiSwitch-thumb': {
      color: theme.palette.grey[100],
      ...theme.applyStyles('dark', {
        color: theme.palette.grey[600],
      }),
    },
    '&.Mui-disabled + .MuiSwitch-track': {
      opacity: 0.7,
      ...theme.applyStyles('dark', {
        opacity: 0.3,
      }),
    },
  },
  '& .MuiSwitch-thumb': {
    boxSizing: 'border-box',
    width: size === 'small' ? 14 : 20,
    height: size === 'small' ? 14 : 20,
  },
  '& .MuiSwitch-track': {
    borderRadius: size === 'small' ? 9 : 16,
    backgroundColor: '#E9E9EA',
    opacity: 1,
    transition: theme.transitions.create(['background-color'], {
      duration: 500,
    }),
    ...theme.applyStyles('dark', {
      backgroundColor: '#39393D',
    }),
  },
}));