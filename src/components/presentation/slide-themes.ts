import type { PresentationStyle } from './types';

// AppFlowy blue and the light palette swatches shown in the supplied color picker.
export const APPFLOWY_THEME_COLORS = [
  { name: 'Blue', soft: '#AFDFFC', bold: '#4AAFF5' },
  { name: 'Indigo', soft: '#DCDCF7', bold: '#5651D9' },
  { name: 'Purple', soft: '#EDD7F7', bold: '#9850BE' },
  { name: 'Rose', soft: '#F7D7E5', bold: '#B24876' },
  { name: 'Peach', soft: '#FADFD2', bold: '#C67547' },
  { name: 'Amber', soft: '#FAE9C3', bold: '#D7A433' },
  { name: 'Lime', soft: '#F0F2B3', bold: '#AAB334' },
  { name: 'Green', soft: '#DEF0C5', bold: '#82A63F' },
  { name: 'Mint', soft: '#CEF0E1', bold: '#45996C' },
  { name: 'Ocean', soft: '#D3E6F5', bold: '#3177CC' },
];
export const APPFLOWY_SLIDE_THEMES: PresentationStyle[] = ['soft', 'bold'].flatMap((tone) =>
  APPFLOWY_THEME_COLORS.map((c) => ({
    id: `appflowy-${tone}-${c.name.toLowerCase()}`,
    name: `${c.name} ${tone}`,
    description: `AppFlowy ${c.name.toLowerCase()} palette`,
    color: c.bold,
    background: tone === 'soft' ? c.soft : '#FFFFFF',
    textColor: '#20242B',
    font: 'Arial',
    bodyFont: 'Arial',
    footer: '',
    palette: [c.bold, c.soft, '#20242B', '#FFFFFF'],
    guidelines:
      'Use the selected AppFlowy palette, readable contrast and clear spacing. Keep content grounded in the document.',
  }))
);
