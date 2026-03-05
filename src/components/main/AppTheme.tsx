import { createTheme, ThemeProvider } from '@mui/material/styles';
import React, { useMemo } from 'react';
import { I18nextProvider } from 'react-i18next';

import { ThemeModeContext, useAppThemeMode } from '@/components/main/useAppThemeMode';
import { i18nInstance } from '@/i18n/config';

function AppTheme({ children }: { children: React.ReactNode }) {
  const { isDark, setIsDark } = useAppThemeMode();

  const theme = useMemo(
    () =>
      createTheme({
        typography: {
          fontFamily: ['inherit'].join(','),
          fontSize: 14,
          button: {
            textTransform: 'none',
          },
        },
        components: {
          MuiOutlinedInput: {
            styleOverrides: {
              root: {
                borderColor: 'var(--border-primary)',
              },
              notchedOutline: {
                borderColor: 'var(--border-primary)',
              },
            },
          },
          MuiMenuItem: {
            defaultProps: {
              sx: {
                '&.Mui-selected.Mui-focusVisible': {
                  backgroundColor: 'var(--fill-content-hover)',
                },
                '&.Mui-focusVisible': {
                  backgroundColor: 'unset',
                },
              },
            },
          },
          MuiIconButton: {
            styleOverrides: {
              root: {
                '&:hover, &:focus': {
                  backgroundColor: 'var(--fill-content-hover)',
                },
                borderRadius: '4px',
                padding: '2px',
                '&.MuiIconButton-colorInherit': {
                  color: 'var(--icon-primary)',
                },
                '&.MuiIconButton-colorPrimary': {
                  color: 'var(--text-action)',
                },
              },
              colorSecondary: {
                color: 'var(--billing-primary)',
                '&:hover': {
                  color: 'var(--billing-primary-hover)',
                },
              },
              sizeSmall: {
                '& > *:first-of-type': { fontSize: 20 },
              },
            },
          },

          MuiButton: {
            styleOverrides: {
              text: {
                borderRadius: '8px',
                '&:hover': {
                  backgroundColor: 'var(--fill-content-hover)',
                },
              },
              contained: {
                color: 'var(--text-on-fill)',
                boxShadow: 'none',
                '&.MuiButton-containedPrimary': {
                  '&:hover': {
                    backgroundColor: 'var(--fill-theme-thick-hover)',
                  },
                },

                borderRadius: '8px',
                '&.Mui-disabled': {
                  backgroundColor: 'var(--fill-theme-thick)',
                  opacity: 0.3,
                  color: 'var(--text-on-fill)',
                },
                '&.MuiButton-containedInherit': {
                  color: 'var(--text-primary)',
                  backgroundColor: isDark ? 'rgba(0, 0, 0, 0.4)' : 'rgba(255, 255, 255, 0.4)',
                  '&:hover': {
                    backgroundColor: 'var(--surface-primary)',
                    boxShadow: 'none',
                  },
                },
                '&.MuiButton-containedSecondary': {
                  backgroundColor: 'var(--billing-primary)',
                  color: 'white',
                  '&:hover': {
                    backgroundColor: 'var(--billing-primary-hover)',
                  },
                },
              },
              outlined: {
                '&.MuiButton-outlinedInherit': {
                  borderColor: 'var(--border-primary)',
                },
                borderRadius: '8px',
                '&.MuiButton-outlinedSecondary': {
                  color: 'var(--billing-primary)',
                  borderColor: 'var(--billing-primary)',
                  '&:hover': {
                    color: 'var(--billing-primary-hover)',
                    borderColor: 'var(--billing-primary-hover)',
                  },
                },
              },
              sizeSmall: {
                '& .MuiButton-startIcon > *:first-of-type': { fontSize: 20 },
                '& .MuiButton-endIcon > *:first-of-type': { fontSize: 20 },
              },
            },
          },

          MuiButtonBase: {
            styleOverrides: {
              root: {
                '&:not(.MuiButton-contained)': {
                  '&:hover': {
                    backgroundColor: 'var(--fill-content-hover)',
                  },
                  '&:active': {
                    backgroundColor: 'var(--fill-content-hover)',
                  },
                },
                '&.MuiMenuItem-root': {
                  borderRadius: '8px',
                },

                borderRadius: '4px',
                padding: '2px',
                boxShadow: 'none !important',
              },
            },
          },
          MuiPaper: {
            styleOverrides: {
              root: {
                backgroundImage: 'none',
                boxShadow: 'var(--custom-shadow-sm)',
                borderRadius: '10px',
                backgroundColor: 'var(--background-primary)',
              },
            },
          },
          MuiDrawer: {
            styleOverrides: {
              root: {
                zIndex: 50,
              },
              paper: {
                borderRadius: 0,
              },

              paperAnchorBottom: {
                borderTopRightRadius: 16,
                borderTopLeftRadius: 16,
                borderBottomLeftRadius: 0,
                borderBottomRightRadius: 0,
              },
            },
          },
          MuiDialog: {
            styleOverrides: {
              root: {
                zIndex: 50,
              },
              paper: {
                borderRadius: '12px',
                backgroundColor: 'var(--background-primary)',
              },
            },
            defaultProps: {
              sx: {
                '& .MuiBackdrop-root': {
                  backgroundColor: 'var(--surface-overlay)',
                },
              },
            },
          },

          MuiTooltip: {
            styleOverrides: {
              arrow: {
                color: 'var(--fill-toolbar)',
              },
              tooltip: {
                backgroundColor: 'var(--fill-toolbar)',
                color: 'white',
                fontSize: '0.85rem',
                borderRadius: '8px',
                fontWeight: 400,
              },
            },
          },
          MuiPopover: {
            styleOverrides: {
              root: {
                zIndex: 50,
              },
            },
          },
          MuiInputBase: {
            defaultProps: {
              sx: {
                '&.Mui-disabled, .Mui-disabled': {
                  color: 'var(--text-secondary)',
                  WebkitTextFillColor: 'var(--text-secondary) !important',
                },
                borderRadius: '8px',
              },
            },
            styleOverrides: {
              input: {
                backgroundColor: 'transparent !important',
              },
            },
          },
          MuiDivider: {
            styleOverrides: {
              root: {
                borderColor: 'var(--border-primary)',
              },
            },
          },
        },
        palette: {
          mode: isDark ? 'dark' : 'light',
          primary: {
            main: '#00BCF0',
            dark: '#00BCF0',
          },
          secondary: {
            main: '#8427e0',
            dark: '#601DAA',
          },
          error: {
            main: '#FB006D',
            dark: '#D32772',
          },
          warning: {
            main: '#FFC107',
            dark: '#E9B320',
          },
          info: {
            main: '#00BCF0',
            dark: '#2E9DBB',
          },
          success: {
            main: '#66CF80',
            dark: '#3BA856',
          },
          text: {
            primary: isDark ? '#E2E9F2' : '#333333',
            secondary: isDark ? '#7B8A9D' : '#828282',
            disabled: isDark ? '#363D49' : '#F2F2F2',
          },
          divider: isDark ? '#59647A' : '#BDBDBD',
          background: {
            default: isDark ? '#1A202C' : '#FFFFFF',
            paper: isDark ? '#1A202C' : '#FFFFFF',
          },
        },
      }),
    [isDark]
  );
  const themeModeValue = useMemo(
    () => ({
      isDark,
      setDark: setIsDark,
    }),
    [isDark, setIsDark]
  );

  return (
    <I18nextProvider i18n={i18nInstance}>
      <ThemeModeContext.Provider value={themeModeValue}>
        <ThemeProvider theme={theme}>{children}</ThemeProvider>
      </ThemeModeContext.Provider>
    </I18nextProvider>
  );
}

export default AppTheme;
