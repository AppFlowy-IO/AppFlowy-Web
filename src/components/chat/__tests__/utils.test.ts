import { expect, describe, it, beforeEach, afterEach } from '@jest/globals';

// Import functions to test
import { stringToColor, renderColor, convertToPageData, parsePromptData, ColorEnum, colorMap } from '../lib/utils';
import { AiPromptCategory } from '../types/prompt';

describe('Chat Utility Functions', () => {
  describe('stringToColor', () => {
    it('should return a hex color for any string', () => {
      const color = stringToColor('test');
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it('should return consistent colors for the same string', () => {
      const color1 = stringToColor('hello');
      const color2 = stringToColor('hello');
      expect(color1).toBe(color2);
    });

    it('should return different colors for different strings', () => {
      const color1 = stringToColor('hello');
      const color2 = stringToColor('world');
      expect(color1).not.toBe(color2);
    });

    it('should handle empty string', () => {
      const color = stringToColor('');
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it('should handle special characters', () => {
      const color = stringToColor('test@#$%^&*()');
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it('should handle unicode characters', () => {
      const color = stringToColor('こんにちは');
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it('should use color array when provided', () => {
      const colorArray = ['#FF0000', '#00FF00', '#0000FF'];
      const color = stringToColor('test', colorArray);
      expect(colorArray).toContain(color);
    });

    it('should return from color array based on first character', () => {
      const colorArray = ['#111111', '#222222', '#333333'];
      // Same first character should return same color from array
      const color1 = stringToColor('abc', colorArray);
      const color2 = stringToColor('axy', colorArray);
      expect(color1).toBe(color2);
    });

    it('should handle single character strings with color array', () => {
      const colorArray = ['#FF0000'];
      const color = stringToColor('x', colorArray);
      expect(color).toBe('#FF0000');
    });
  });

  describe('renderColor', () => {
    it('should return CSS variable for ColorEnum values', () => {
      expect(renderColor(ColorEnum.Purple)).toBe('var(--tint-purple)');
      expect(renderColor(ColorEnum.Pink)).toBe('var(--tint-pink)');
      expect(renderColor(ColorEnum.LightPink)).toBe('var(--tint-red)');
      expect(renderColor(ColorEnum.Orange)).toBe('var(--tint-orange)');
      expect(renderColor(ColorEnum.Yellow)).toBe('var(--tint-yellow)');
      expect(renderColor(ColorEnum.Lime)).toBe('var(--tint-lime)');
      expect(renderColor(ColorEnum.Green)).toBe('var(--tint-green)');
      expect(renderColor(ColorEnum.Aqua)).toBe('var(--tint-aqua)');
      expect(renderColor(ColorEnum.Blue)).toBe('var(--tint-blue)');
    });

    it('should convert hex color without alpha', () => {
      const result = renderColor('#FF5500');
      expect(result).toBe('#FF5500');
    });

    it('should convert 0x format without alpha', () => {
      const result = renderColor('0xFF5500');
      expect(result).toBe('#FF5500');
    });

    it('should convert ARGB to RGBA for 8-digit hex', () => {
      // ARGB: FF (alpha=255) FF (red) 55 (green) 00 (blue)
      const result = renderColor('0xFFFF5500');
      // Should be rgba(255, 85, 0, 1)
      expect(result).toMatch(/^rgba\(/);
    });

    it('should handle semi-transparent ARGB colors', () => {
      // ARGB: 80 (alpha=128) FF (red) 00 (green) 00 (blue)
      const result = renderColor('0x80FF0000');
      expect(result).toContain('rgba');
      // Alpha should be approximately 0.5 (128/255)
    });

    it('should handle fully transparent colors', () => {
      const result = renderColor('0x00FF0000');
      expect(result).toContain('rgba');
      expect(result).toContain(', 0)');
    });
  });

  describe('ColorEnum', () => {
    it('should have all expected color values', () => {
      expect(ColorEnum.Purple).toBe('appflowy_them_color_tint1');
      expect(ColorEnum.Pink).toBe('appflowy_them_color_tint2');
      expect(ColorEnum.LightPink).toBe('appflowy_them_color_tint3');
      expect(ColorEnum.Orange).toBe('appflowy_them_color_tint4');
      expect(ColorEnum.Yellow).toBe('appflowy_them_color_tint5');
      expect(ColorEnum.Lime).toBe('appflowy_them_color_tint6');
      expect(ColorEnum.Green).toBe('appflowy_them_color_tint7');
      expect(ColorEnum.Aqua).toBe('appflowy_them_color_tint8');
      expect(ColorEnum.Blue).toBe('appflowy_them_color_tint9');
    });
  });

  describe('colorMap', () => {
    it('should map all ColorEnum values to CSS variables', () => {
      expect(colorMap[ColorEnum.Purple]).toBe('var(--tint-purple)');
      expect(colorMap[ColorEnum.Pink]).toBe('var(--tint-pink)');
    });
  });

  describe('convertToPageData', () => {
    it('should convert simple editor data', () => {
      const editorData = [
        {
          type: 'paragraph',
          data: {},
          delta: [{ insert: 'Hello' }],
          children: [],
        },
      ];

      const result = convertToPageData(editorData as any);

      expect(result[0].type).toBe('paragraph');
      expect(result[0].data.delta).toEqual([{ insert: 'Hello' }]);
    });

    it('should preserve existing data properties', () => {
      const editorData = [
        {
          type: 'paragraph',
          data: { align: 'center', level: 1 },
          delta: [{ insert: 'Hello' }],
          children: [],
        },
      ];

      const result = convertToPageData(editorData as any);

      expect(result[0].data.align).toBe('center');
      expect(result[0].data.level).toBe(1);
      expect(result[0].data.delta).toEqual([{ insert: 'Hello' }]);
    });

    it('should handle nested children', () => {
      const editorData = [
        {
          type: 'bulleted_list',
          data: {},
          delta: [{ insert: 'Item 1' }],
          children: [
            {
              type: 'bulleted_list',
              data: {},
              delta: [{ insert: 'Sub item' }],
              children: [],
            },
          ],
        },
      ];

      const result = convertToPageData(editorData as any);

      expect(result[0].type).toBe('bulleted_list');
      expect(result[0].children).toHaveLength(1);
      expect(result[0].children[0].type).toBe('bulleted_list');
      expect(result[0].children[0].data.delta).toEqual([{ insert: 'Sub item' }]);
    });

    it('should handle empty array', () => {
      const result = convertToPageData([]);
      expect(result).toEqual([]);
    });

    it('should handle deeply nested structures', () => {
      const editorData = [
        {
          type: 'paragraph',
          data: {},
          delta: [],
          children: [
            {
              type: 'paragraph',
              data: {},
              delta: [],
              children: [
                {
                  type: 'paragraph',
                  data: {},
                  delta: [{ insert: 'Deep' }],
                  children: [],
                },
              ],
            },
          ],
        },
      ];

      const result = convertToPageData(editorData as any);

      expect(result[0].children[0].children[0].data.delta).toEqual([{ insert: 'Deep' }]);
    });
  });

  describe('parsePromptData', () => {
    it('should parse simple prompt data', () => {
      const rawData = [
        {
          id: '1',
          name: 'Test Prompt',
          category: 'development',
          content: 'Test content',
        },
      ];

      const result = parsePromptData(rawData);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
      expect(result[0].name).toBe('Test Prompt');
      expect(result[0].category).toContain(AiPromptCategory.Development);
      expect(result[0].content).toBe('Test content');
    });

    it('should handle missing category', () => {
      const rawData = [
        {
          id: '1',
          name: 'Test',
          content: 'Content',
        },
      ];

      const result = parsePromptData(rawData as any);

      expect(result[0].category).toContain(AiPromptCategory.Others);
    });

    it('should handle empty category string', () => {
      const rawData = [
        {
          id: '1',
          name: 'Test',
          category: '',
          content: 'Content',
        },
      ];

      const result = parsePromptData(rawData);

      expect(result[0].category).toContain(AiPromptCategory.Others);
    });

    it('should handle multiple categories', () => {
      const rawData = [
        {
          id: '1',
          name: 'Test',
          category: 'development,writing',
          content: 'Content',
        },
      ];

      const result = parsePromptData(rawData);

      expect(result[0].category).toContain(AiPromptCategory.Development);
      expect(result[0].category).toContain(AiPromptCategory.Writing);
    });

    it('should default optional fields', () => {
      const rawData = [
        {
          id: '1',
          name: 'Test',
          content: 'Content',
        },
      ];

      const result = parsePromptData(rawData as any);

      expect(result[0].example).toBe('');
      expect(result[0].isFeatured).toBe(false);
      expect(result[0].isCustom).toBe(false);
    });

    it('should preserve provided optional fields', () => {
      const rawData = [
        {
          id: '1',
          name: 'Test',
          content: 'Content',
          example: 'Example text',
          isFeatured: true,
          isCustom: true,
        },
      ];

      const result = parsePromptData(rawData as any);

      expect(result[0].example).toBe('Example text');
      expect(result[0].isFeatured).toBe(true);
      expect(result[0].isCustom).toBe(true);
    });

    it('should handle translations for category matching', () => {
      const rawData = [
        {
          id: '1',
          name: 'Test',
          category: 'Desarrollo',
          content: 'Content',
        },
      ];

      const translations = new Map<AiPromptCategory, string>();
      translations.set(AiPromptCategory.Development, 'Desarrollo');

      const result = parsePromptData(rawData, translations);

      expect(result[0].category).toContain(AiPromptCategory.Development);
    });

    it('should fall back to Others for unknown categories', () => {
      const rawData = [
        {
          id: '1',
          name: 'Test',
          category: 'UnknownCategory',
          content: 'Content',
        },
      ];

      const result = parsePromptData(rawData);

      expect(result[0].category).toContain(AiPromptCategory.Others);
    });

    it('should handle whitespace in categories', () => {
      const rawData = [
        {
          id: '1',
          name: 'Test',
          category: '  development  ',
          content: 'Content',
        },
      ];

      const result = parsePromptData(rawData);

      expect(result[0].category).toContain(AiPromptCategory.Development);
    });

    it('should handle empty array', () => {
      const result = parsePromptData([]);
      expect(result).toEqual([]);
    });

    it('should handle multiple prompts', () => {
      const rawData = [
        { id: '1', name: 'Prompt 1', content: 'Content 1' },
        { id: '2', name: 'Prompt 2', content: 'Content 2' },
        { id: '3', name: 'Prompt 3', content: 'Content 3' },
      ];

      const result = parsePromptData(rawData as any);

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('1');
      expect(result[1].id).toBe('2');
      expect(result[2].id).toBe('3');
    });
  });
});
