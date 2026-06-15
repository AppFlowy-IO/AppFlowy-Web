import { expect, describe, it, beforeEach, afterEach } from '@jest/globals';
import { render, screen } from '@testing-library/react';

import { ElementFallbackRender } from '../ElementFallbackRender';

// Mock i18next with configurable isInitialized
const mockT = jest.fn((key: string) => {
  const translations: Record<string, string> = {
    'error.generalError': 'An error occurred',
  };

  return translations[key] || key;
});

jest.mock('i18next', () => ({
  get isInitialized() {
    return mockIsInitialized;
  },
  t: (key: string) => mockT(key),
}));

// Variable to control isInitialized state in tests
let mockIsInitialized = true;

describe('ElementFallbackRender', () => {
  const mockError = new Error('Test error message');
  const mockResetErrorBoundary = jest.fn();

  const defaultProps = {
    error: mockError,
    resetErrorBoundary: mockResetErrorBoundary,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsInitialized = true;
  });

  describe('when i18n is initialized', () => {
    beforeEach(() => {
      mockIsInitialized = true;
    });

    it('should render the translated error label', () => {
      render(<ElementFallbackRender {...defaultProps} />);

      expect(mockT).toHaveBeenCalledWith('error.generalError');
      expect(screen.getByText('An error occurred:')).toBeTruthy();
    });

    it('should render the error message', () => {
      render(<ElementFallbackRender {...defaultProps} />);

      expect(screen.getByText('Test error message')).toBeTruthy();
    });

    it('should render description when provided', () => {
      render(<ElementFallbackRender {...defaultProps} description="Additional context" />);

      expect(screen.getByText('Additional context')).toBeTruthy();
    });

    it('should not render description when not provided', () => {
      render(<ElementFallbackRender {...defaultProps} />);

      // Only error message should be in a pre tag, not description
      const preElements = screen.getAllByRole('generic').filter((el) => el.tagName === 'PRE');

      expect(preElements.length).toBe(1);
    });
  });

  describe('when i18n is NOT initialized', () => {
    beforeEach(() => {
      mockIsInitialized = false;
    });

    afterEach(() => {
      mockIsInitialized = true;
    });

    it('should render fallback error label without crashing', () => {
      render(<ElementFallbackRender {...defaultProps} />);

      expect(screen.getByText('Something went wrong:')).toBeTruthy();
    });

    it('should NOT call i18n.t when not initialized', () => {
      render(<ElementFallbackRender {...defaultProps} />);

      expect(mockT).not.toHaveBeenCalled();
    });

    it('should still render error message', () => {
      render(<ElementFallbackRender {...defaultProps} />);

      expect(screen.getByText('Test error message')).toBeTruthy();
    });

    it('should still render description when provided', () => {
      render(<ElementFallbackRender {...defaultProps} description="Error details" />);

      expect(screen.getByText('Error details')).toBeTruthy();
    });
  });

  describe('Alert component', () => {
    it('should render with error severity', () => {
      const { container } = render(<ElementFallbackRender {...defaultProps} />);

      const alert = container.querySelector('.MuiAlert-standardError');

      expect(alert).toBeTruthy();
    });

    it('should have contentEditable set to false', () => {
      const { container } = render(<ElementFallbackRender {...defaultProps} />);

      const alert = container.querySelector('[contenteditable="false"]');

      expect(alert).toBeTruthy();
    });
  });

  describe('edge cases', () => {
    it('should handle error with empty message', () => {
      const emptyError = new Error('');

      render(<ElementFallbackRender error={emptyError} resetErrorBoundary={mockResetErrorBoundary} />);

      // Should not crash, alert should still render
      expect(screen.getByRole('alert')).toBeTruthy();
    });

    it('should handle error with special characters in message', () => {
      const specialError = new Error('<script>alert("xss")</script>');

      render(<ElementFallbackRender error={specialError} resetErrorBoundary={mockResetErrorBoundary} />);

      // Message should be rendered as text, not HTML
      expect(screen.getByText('<script>alert("xss")</script>')).toBeTruthy();
    });

    it('should handle very long error messages', () => {
      const longMessage = 'A'.repeat(1000);
      const longError = new Error(longMessage);

      render(<ElementFallbackRender error={longError} resetErrorBoundary={mockResetErrorBoundary} />);

      expect(screen.getByText(longMessage)).toBeTruthy();
    });
  });
});
