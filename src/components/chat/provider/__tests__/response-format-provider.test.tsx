import { act, renderHook } from '@testing-library/react';
import { ReactNode } from 'react';

import { ResponseFormatProvider, useResponseFormatContext } from '@/components/chat/provider/response-format-provider';
import { ChatInputMode, OutputContent, OutputLayout } from '@/components/chat/types';

jest.mock('@/components/chat/chat/context', () => ({
  useChatContext: () => ({ chatId: 'chat-1' }),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <ResponseFormatProvider>{children}</ResponseFormatProvider>;
}

describe('ResponseFormatProvider', () => {
  it('starts in Auto mode and lets the model choose the layout', () => {
    const { result } = renderHook(() => useResponseFormatContext(), { wrapper });

    expect(result.current.responseMode).toBe(ChatInputMode.Auto);
    expect(result.current.buildRequestFormat()).toEqual({
      output_layout: OutputLayout.Flex,
      output_content: OutputContent.TEXT,
    });
  });

  it('builds an image request from the image options and clears it after sending', () => {
    const { result } = renderHook(() => useResponseFormatContext(), { wrapper });

    act(() => {
      result.current.setOutputContent(OutputContent.RichTextImage);
      result.current.setImageOptions({ size: 'portrait', customImagePrompt: 'A lighthouse at dusk' });
    });

    expect(result.current.buildRequestFormat()).toEqual({
      output_layout: OutputLayout.Flex,
      output_content: OutputContent.RichTextImage,
      output_content_metadata: { size: '1024x1536', custom_image_prompt: 'A lighthouse at dusk' },
    });

    act(() => {
      result.current.resetImageIntent();
    });

    expect(result.current.responseFormat.output_content).toBe(OutputContent.TEXT);
    expect(result.current.imageOptions.customImagePrompt).toBe('');
    // Size and quality are preferences and survive the reset.
    expect(result.current.imageOptions.size).toBe('portrait');
  });

  it('only sends a layout when the format bar is in use', () => {
    const { result } = renderHook(() => useResponseFormatContext(), { wrapper });

    act(() => {
      result.current.setResponseMode(ChatInputMode.FormatResponse);
      result.current.setResponseFormat({ output_layout: OutputLayout.SimpleTable, output_content: OutputContent.TEXT });
    });

    expect(result.current.buildRequestFormat().output_layout).toBe(OutputLayout.SimpleTable);
  });

  it('remembers the format used for a message', () => {
    const { result } = renderHook(() => useResponseFormatContext(), { wrapper });
    const format = { output_layout: OutputLayout.Flex, output_content: OutputContent.IMAGE };

    act(() => {
      result.current.setResponseFormatWithId(12, format);
    });

    expect(result.current.getMessageResponseFormat(12)).toEqual(format);
    expect(result.current.getMessageResponseFormat(13)).toBeUndefined();
  });

  it('resolves an answer format from memory, then content, then the automatic text format', () => {
    const { result } = renderHook(() => useResponseFormatContext(), { wrapper });
    const remembered = { output_layout: OutputLayout.Flex, output_content: OutputContent.IMAGE };
    const generated = '![Generated Image](https://cloud/api/file_storage/ws/v1/blob/chat/a.png)';

    act(() => {
      result.current.setResponseFormatWithId(12, remembered);
    });

    expect(result.current.resolveAnswerFormat(12, 'Plain text')).toEqual(remembered);
    expect(result.current.resolveAnswerFormat(13, `A meadow.\n\n${generated}`)).toEqual({
      output_layout: OutputLayout.Flex,
      output_content: OutputContent.RichTextImage,
    });
    expect(result.current.resolveAnswerFormat(14, 'Plain text')).toEqual({
      output_layout: OutputLayout.Flex,
      output_content: OutputContent.TEXT,
    });
    expect(result.current.resolveAnswerFormat(15)).toEqual({
      output_layout: OutputLayout.Flex,
      output_content: OutputContent.TEXT,
    });
  });
});
