import type { MermaidConfig } from 'mermaid';

export function getMermaidTheme(isDark: boolean): Pick<MermaidConfig, 'theme' | 'themeVariables'> {
  const background = isDark ? '#1e1e1e' : '#fff';

  return {
    theme: 'base',
    themeVariables: {
      background,
      primaryTextColor: '#00bcf0',
      nodeBkg: background,
      nodeTextColor: '#00bcf0',
      nodeBorder: '#00bcf0',
      lineColor: '#00bcf0',
      arrowheadColor: '#00bcf0',
      fontFamily:
        'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, "Apple Color Emoji", Arial, sans-serif, "Segoe UI Emoji", "Segoe UI Symbol"',
      fontSize: '14px',
      mainBkg: background,
      borderColor: '#00bcf0',
      border2: '#00bcf0',
      curve: 'linear',
    },
  };
}
