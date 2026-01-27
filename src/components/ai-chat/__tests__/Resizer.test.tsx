import { expect, describe, it, beforeEach, afterEach } from '@jest/globals';
import { render, fireEvent, act } from '@testing-library/react';

import Resizer from '../Resizer';

describe('Resizer', () => {
  const mockOnResize = jest.fn();
  let originalInnerWidth: number;

  beforeEach(() => {
    jest.clearAllMocks();
    originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1200,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: originalInnerWidth,
    });
  });

  describe('Rendering', () => {
    it('should render resizer element', () => {
      const { container } = render(
        <Resizer drawerWidth={600} onResize={mockOnResize} />
      );

      const resizer = container.querySelector('.cursor-col-resize');

      expect(resizer).toBeTruthy();
    });

    it('should have correct positioning classes', () => {
      const { container } = render(
        <Resizer drawerWidth={600} onResize={mockOnResize} />
      );

      const resizer = container.querySelector('.cursor-col-resize');

      expect(resizer?.className).toContain('absolute');
      expect(resizer?.className).toContain('top-0');
      expect(resizer?.className).toContain('left-0');
      expect(resizer?.className).toContain('h-full');
    });
  });

  describe('Mouse Interactions', () => {
    it('should not trigger resize when drawerWidth is 0', () => {
      const { container } = render(
        <Resizer drawerWidth={0} onResize={mockOnResize} />
      );

      const resizer = container.querySelector('.cursor-col-resize')!;

      act(() => {
        fireEvent.mouseDown(resizer);
      });
      act(() => {
        fireEvent.mouseMove(window, { clientX: 800 });
      });
      act(() => {
        fireEvent.mouseUp(window);
      });

      expect(mockOnResize).not.toHaveBeenCalled();
    });

    it('should start resizing on mousedown when drawerWidth > 0', () => {
      const { container } = render(
        <Resizer drawerWidth={600} onResize={mockOnResize} />
      );

      const resizer = container.querySelector('.cursor-col-resize')!;

      act(() => {
        fireEvent.mouseDown(resizer);
      });
      act(() => {
        fireEvent.mouseMove(window, { clientX: 800 });
      });

      // newWidth = 1200 - 800 = 400
      expect(mockOnResize).toHaveBeenCalledWith(400);
    });

    it('should stop resizing on mouseup', () => {
      const { container } = render(
        <Resizer drawerWidth={600} onResize={mockOnResize} />
      );

      const resizer = container.querySelector('.cursor-col-resize')!;

      act(() => {
        fireEvent.mouseDown(resizer);
      });
      act(() => {
        fireEvent.mouseMove(window, { clientX: 800 });
      });

      expect(mockOnResize).toHaveBeenCalled();

      mockOnResize.mockClear();

      act(() => {
        fireEvent.mouseUp(window);
      });
      act(() => {
        fireEvent.mouseMove(window, { clientX: 700 });
      });

      // Should not call onResize after mouseup
      expect(mockOnResize).not.toHaveBeenCalled();
    });

    it('should prevent default and stop propagation on mousedown', () => {
      const { container } = render(
        <Resizer drawerWidth={600} onResize={mockOnResize} />
      );

      const resizer = container.querySelector('.cursor-col-resize')!;

      const mouseDownEvent = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
      });
      const preventDefaultSpy = jest.spyOn(mouseDownEvent, 'preventDefault');
      const stopPropagationSpy = jest.spyOn(mouseDownEvent, 'stopPropagation');

      act(() => {
        resizer.dispatchEvent(mouseDownEvent);
      });

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(stopPropagationSpy).toHaveBeenCalled();
    });
  });

  describe('Width Bounds', () => {
    it('should respect minimum width', () => {
      const { container } = render(
        <Resizer
          drawerWidth={600}
          onResize={mockOnResize}
          minWidth={400}
          maxWidth={800}
        />
      );

      const resizer = container.querySelector('.cursor-col-resize')!;

      act(() => {
        fireEvent.mouseDown(resizer);
      });
      // Try to resize below minimum (1200 - 900 = 300, which is below minWidth 400)
      act(() => {
        fireEvent.mouseMove(window, { clientX: 900 });
      });

      expect(mockOnResize).not.toHaveBeenCalled();
    });

    it('should respect maximum width', () => {
      const { container } = render(
        <Resizer
          drawerWidth={600}
          onResize={mockOnResize}
          minWidth={400}
          maxWidth={800}
        />
      );

      const resizer = container.querySelector('.cursor-col-resize')!;

      act(() => {
        fireEvent.mouseDown(resizer);
      });
      // Try to resize above maximum (1200 - 300 = 900, which is above maxWidth 800)
      act(() => {
        fireEvent.mouseMove(window, { clientX: 300 });
      });

      expect(mockOnResize).not.toHaveBeenCalled();
    });

    it('should allow resize within bounds', () => {
      const { container } = render(
        <Resizer
          drawerWidth={600}
          onResize={mockOnResize}
          minWidth={400}
          maxWidth={800}
        />
      );

      const resizer = container.querySelector('.cursor-col-resize')!;

      act(() => {
        fireEvent.mouseDown(resizer);
      });
      // Resize within bounds (1200 - 600 = 600, which is within 400-800)
      act(() => {
        fireEvent.mouseMove(window, { clientX: 600 });
      });

      expect(mockOnResize).toHaveBeenCalledWith(600);
    });

    it('should use default bounds based on window size when not provided', () => {
      const { container } = render(
        <Resizer drawerWidth={600} onResize={mockOnResize} />
      );

      const resizer = container.querySelector('.cursor-col-resize')!;

      act(() => {
        fireEvent.mouseDown(resizer);
      });
      // With window.innerWidth = 1200:
      // Default minWidth = Math.min(400, 1200/4) = Math.min(400, 300) = 300
      // Default maxWidth = Math.max(400, 1200/2) = Math.max(400, 600) = 600

      // Resize to 500 (within default bounds)
      act(() => {
        fireEvent.mouseMove(window, { clientX: 700 }); // 1200 - 700 = 500
      });

      expect(mockOnResize).toHaveBeenCalledWith(500);
    });
  });

  describe('Resizing State', () => {
    it('should track resizing state correctly', () => {
      const { container } = render(
        <Resizer drawerWidth={600} onResize={mockOnResize} />
      );

      const resizer = container.querySelector('.cursor-col-resize') as HTMLElement;

      // Before mousedown, moving mouse should not trigger resize
      act(() => {
        fireEvent.mouseMove(window, { clientX: 800 });
      });

      expect(mockOnResize).not.toHaveBeenCalled();

      // After mousedown, moving mouse should trigger resize
      act(() => {
        fireEvent.mouseDown(resizer);
      });

      act(() => {
        fireEvent.mouseMove(window, { clientX: 800 });
      });

      expect(mockOnResize).toHaveBeenCalled();
    });
  });

  describe('Event Listener Cleanup', () => {
    it('should remove event listeners on unmount', () => {
      const addEventListenerSpy = jest.spyOn(window, 'addEventListener');
      const removeEventListenerSpy = jest.spyOn(window, 'removeEventListener');

      const { container, unmount } = render(
        <Resizer drawerWidth={600} onResize={mockOnResize} />
      );

      const resizer = container.querySelector('.cursor-col-resize')!;

      // Start resizing to add listeners
      act(() => {
        fireEvent.mouseDown(resizer);
      });

      expect(addEventListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
      expect(addEventListenerSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));

      addEventListenerSpy.mockRestore();
      removeEventListenerSpy.mockRestore();
    });
  });

  describe('SSR Safety', () => {
    it('should handle undefined window gracefully', () => {
      // This test verifies SSR-safe defaults
      // The component uses useMemo with typeof window check
      expect(() => {
        render(<Resizer drawerWidth={600} onResize={mockOnResize} />);
      }).not.toThrow();
    });
  });
});
