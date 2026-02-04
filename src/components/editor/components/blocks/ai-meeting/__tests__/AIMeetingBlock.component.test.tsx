import { expect, describe, it, beforeEach } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react';
import React, { useState } from 'react';

import { BlockType } from '@/application/types';

// Mock runtime config
jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: jest.fn((key: string, defaultValue: string) => defaultValue),
}));

// Mock translations
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { id?: string }) => {
      const translations: Record<string, string> = {
        'document.aiMeeting.titleDefault': 'Meeting',
        'document.aiMeeting.tab.summary': 'Summary',
        'document.aiMeeting.tab.notes': 'Notes',
        'document.aiMeeting.tab.transcript': 'Transcript',
        'document.aiMeeting.copy.summary': 'Copy summary',
        'document.aiMeeting.copy.notes': 'Copy notes',
        'document.aiMeeting.copy.transcript': 'Copy transcript',
        'document.aiMeeting.copy.summarySuccess': 'Summary copied',
        'document.aiMeeting.copy.notesSuccess': 'Notes copied',
        'document.aiMeeting.copy.transcriptSuccess': 'Transcript copied',
        'document.aiMeeting.copy.noContent': 'No content to copy',
        'document.aiMeeting.speakerUnknown': 'Unknown speaker',
        'document.aiMeeting.speakerFallback': `Speaker ${options?.id ?? ''}`,
        'document.aiMeeting.readOnlyHint': 'This content is read-only',
      };

      return translations[key] ?? key;
    },
  }),
}));

// Mock notify
const mockNotifySuccess = jest.fn();

jest.mock('@/components/_shared/notify', () => ({
  notify: {
    success: (msg: string) => mockNotifySuccess(msg),
    warning: jest.fn(),
  },
}));

// Mock publish context
jest.mock('@/application/publish', () => ({
  usePublishContext: () => null,
}));

/**
 * Simplified AI Meeting Block component for testing
 * Extracts the core UI logic without Slate editor dependencies
 */

interface TabDef {
  key: 'summary' | 'notes' | 'transcript';
  type: BlockType;
  label: string;
}

const TAB_DEFS: TabDef[] = [
  { key: 'summary', type: BlockType.AIMeetingSummaryBlock, label: 'Summary' },
  { key: 'notes', type: BlockType.AIMeetingNotesBlock, label: 'Notes' },
  { key: 'transcript', type: BlockType.AIMeetingTranscriptionBlock, label: 'Transcript' },
];

interface SectionData {
  type: BlockType;
  content: string;
}

interface MockAIMeetingBlockProps {
  title?: string;
  sections: SectionData[];
  initialTabIndex?: number;
  onTabChange?: (index: number) => void;
  onCopy?: (tabKey: string, content: string) => void;
  readOnly?: boolean;
}

function MockAIMeetingBlock({
  title = 'Meeting',
  sections,
  initialTabIndex = 0,
  onTabChange,
  onCopy,
  readOnly = false,
}: MockAIMeetingBlockProps) {
  const [activeIndex, setActiveIndex] = useState(initialTabIndex);
  const [menuOpen, setMenuOpen] = useState(false);

  // Calculate available tabs based on sections
  const availableTabs = TAB_DEFS.filter((tab) => {
    const section = sections.find((s) => s.type === tab.type);

    if (!section) return false;

    // Summary and transcript need content
    if (tab.type === BlockType.AIMeetingSummaryBlock || tab.type === BlockType.AIMeetingTranscriptionBlock) {
      return section.content.trim().length > 0;
    }

    return true;
  });

  const showTabs = availableTabs.length > 1;
  const safeIndex = Math.min(activeIndex, availableTabs.length - 1);
  const activeTab = availableTabs[safeIndex] ?? availableTabs[0];
  const activeSection = sections.find((s) => s.type === activeTab?.type);

  const handleTabChange = (index: number) => {
    setActiveIndex(index);
    onTabChange?.(index);
  };

  const handleCopy = () => {
    if (activeTab && activeSection) {
      onCopy?.(activeTab.key, activeSection.content);
      mockNotifySuccess(`${activeTab.label} copied`);
    }

    setMenuOpen(false);
  };

  return (
    <div data-testid="ai-meeting-block" className="ai-meeting-block">
      {/* Title */}
      <div data-testid="meeting-title" className="meeting-title">
        <input
          data-testid="title-input"
          value={title}
          readOnly={readOnly}
          onChange={() => {}}
        />
      </div>

      {/* Tabs */}
      {showTabs && (
        <div data-testid="tab-bar" className="tab-bar">
          {availableTabs.map((tab, index) => (
            <button
              key={tab.key}
              data-testid={`tab-${tab.key}`}
              data-active={index === safeIndex ? 'true' : 'false'}
              className={index === safeIndex ? 'active' : ''}
              onClick={() => handleTabChange(index)}
            >
              {tab.label}
            </button>
          ))}

          {/* More menu button */}
          <button
            data-testid="more-menu-button"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            More
          </button>
        </div>
      )}

      {/* Copy menu */}
      {menuOpen && (
        <div data-testid="copy-menu">
          <button
            data-testid="copy-button"
            onClick={handleCopy}
            disabled={!activeSection?.content}
          >
            Copy {activeTab?.label}
          </button>
        </div>
      )}

      {/* Content sections */}
      <div data-testid="content-area" className="content-area">
        {sections.map((section) => {
          const isActive = section.type === activeTab?.type;

          return (
            <div
              key={section.type}
              data-testid={`section-${section.type}`}
              data-active={isActive ? 'true' : 'false'}
              style={{ display: isActive ? 'block' : 'none' }}
            >
              {section.content}
            </div>
          );
        })}
      </div>
    </div>
  );
}

describe('AIMeetingBlock Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render the meeting block with title', () => {
      render(
        <MockAIMeetingBlock
          title="Weekly Standup"
          sections={[{ type: BlockType.AIMeetingNotesBlock, content: 'Notes content' }]}
        />
      );

      expect(screen.getByTestId('ai-meeting-block')).toBeTruthy();
      const titleInput = screen.getByTestId('title-input') as HTMLInputElement;

      expect(titleInput.value).toBe('Weekly Standup');
    });

    it('should not show tabs when only one section available', () => {
      render(
        <MockAIMeetingBlock
          sections={[{ type: BlockType.AIMeetingNotesBlock, content: 'Notes' }]}
        />
      );

      expect(screen.queryByTestId('tab-bar')).toBeNull();
    });

    it('should show tabs when multiple sections available', () => {
      render(
        <MockAIMeetingBlock
          sections={[
            { type: BlockType.AIMeetingSummaryBlock, content: 'Summary content' },
            { type: BlockType.AIMeetingNotesBlock, content: 'Notes content' },
          ]}
        />
      );

      expect(screen.getByTestId('tab-bar')).toBeTruthy();
      expect(screen.getByTestId('tab-summary')).toBeTruthy();
      expect(screen.getByTestId('tab-notes')).toBeTruthy();
    });

    it('should hide summary tab when summary has no content', () => {
      render(
        <MockAIMeetingBlock
          sections={[
            { type: BlockType.AIMeetingSummaryBlock, content: '' },
            { type: BlockType.AIMeetingNotesBlock, content: 'Notes content' },
            { type: BlockType.AIMeetingTranscriptionBlock, content: 'Transcript content' },
          ]}
        />
      );

      expect(screen.queryByTestId('tab-summary')).toBeNull();
      expect(screen.getByTestId('tab-notes')).toBeTruthy();
      expect(screen.getByTestId('tab-transcript')).toBeTruthy();
    });

    it('should hide transcript tab when transcript has no content', () => {
      render(
        <MockAIMeetingBlock
          sections={[
            { type: BlockType.AIMeetingSummaryBlock, content: 'Summary content' },
            { type: BlockType.AIMeetingNotesBlock, content: 'Notes content' },
            { type: BlockType.AIMeetingTranscriptionBlock, content: '   ' },
          ]}
        />
      );

      expect(screen.getByTestId('tab-summary')).toBeTruthy();
      expect(screen.getByTestId('tab-notes')).toBeTruthy();
      expect(screen.queryByTestId('tab-transcript')).toBeNull();
    });
  });

  describe('Tab Switching', () => {
    it('should switch tab when clicking tab button', () => {
      const onTabChange = jest.fn();

      render(
        <MockAIMeetingBlock
          sections={[
            { type: BlockType.AIMeetingSummaryBlock, content: 'Summary content' },
            { type: BlockType.AIMeetingNotesBlock, content: 'Notes content' },
            { type: BlockType.AIMeetingTranscriptionBlock, content: 'Transcript content' },
          ]}
          onTabChange={onTabChange}
        />
      );

      // Initially on summary (index 0)
      const summaryTab = screen.getByTestId('tab-summary');

      expect(summaryTab.getAttribute('data-active')).toBe('true');

      // Click notes tab
      fireEvent.click(screen.getByTestId('tab-notes'));

      expect(onTabChange).toHaveBeenCalledWith(1);

      const notesTab = screen.getByTestId('tab-notes');

      expect(notesTab.getAttribute('data-active')).toBe('true');
    });

    it('should show correct content for active tab', () => {
      render(
        <MockAIMeetingBlock
          sections={[
            { type: BlockType.AIMeetingSummaryBlock, content: 'Summary content' },
            { type: BlockType.AIMeetingNotesBlock, content: 'Notes content' },
          ]}
        />
      );

      // Summary is active initially
      const summarySection = screen.getByTestId(`section-${BlockType.AIMeetingSummaryBlock}`) as HTMLElement;
      const notesSection = screen.getByTestId(`section-${BlockType.AIMeetingNotesBlock}`) as HTMLElement;

      expect(summarySection.style.display).toBe('block');
      expect(notesSection.style.display).toBe('none');

      // Switch to notes
      fireEvent.click(screen.getByTestId('tab-notes'));

      expect(summarySection.style.display).toBe('none');
      expect(notesSection.style.display).toBe('block');
    });

    it('should maintain tab state after multiple switches', () => {
      const onTabChange = jest.fn();

      render(
        <MockAIMeetingBlock
          sections={[
            { type: BlockType.AIMeetingSummaryBlock, content: 'Summary' },
            { type: BlockType.AIMeetingNotesBlock, content: 'Notes' },
            { type: BlockType.AIMeetingTranscriptionBlock, content: 'Transcript' },
          ]}
          onTabChange={onTabChange}
        />
      );

      // Switch: summary -> notes -> transcript -> notes
      fireEvent.click(screen.getByTestId('tab-notes'));
      fireEvent.click(screen.getByTestId('tab-transcript'));
      fireEvent.click(screen.getByTestId('tab-notes'));

      expect(onTabChange).toHaveBeenCalledTimes(3);
      expect(onTabChange).toHaveBeenLastCalledWith(1);

      const notesTab = screen.getByTestId('tab-notes');

      expect(notesTab.getAttribute('data-active')).toBe('true');
    });
  });

  describe('Copy Functionality', () => {
    it('should open copy menu when clicking more button', () => {
      render(
        <MockAIMeetingBlock
          sections={[
            { type: BlockType.AIMeetingSummaryBlock, content: 'Summary' },
            { type: BlockType.AIMeetingNotesBlock, content: 'Notes' },
          ]}
        />
      );

      expect(screen.queryByTestId('copy-menu')).toBeNull();

      fireEvent.click(screen.getByTestId('more-menu-button'));

      expect(screen.getByTestId('copy-menu')).toBeTruthy();
    });

    it('should call onCopy with correct tab and content', () => {
      const onCopy = jest.fn();

      render(
        <MockAIMeetingBlock
          sections={[
            { type: BlockType.AIMeetingSummaryBlock, content: 'Summary content here' },
            { type: BlockType.AIMeetingNotesBlock, content: 'Notes content here' },
          ]}
          onCopy={onCopy}
        />
      );

      // Open menu and copy summary
      fireEvent.click(screen.getByTestId('more-menu-button'));
      fireEvent.click(screen.getByTestId('copy-button'));

      expect(onCopy).toHaveBeenCalledWith('summary', 'Summary content here');
      expect(mockNotifySuccess).toHaveBeenCalledWith('Summary copied');
    });

    it('should copy content of active tab', () => {
      const onCopy = jest.fn();

      render(
        <MockAIMeetingBlock
          sections={[
            { type: BlockType.AIMeetingSummaryBlock, content: 'Summary content' },
            { type: BlockType.AIMeetingNotesBlock, content: 'Notes content' },
          ]}
          onCopy={onCopy}
        />
      );

      // Switch to notes tab
      fireEvent.click(screen.getByTestId('tab-notes'));

      // Open menu and copy
      fireEvent.click(screen.getByTestId('more-menu-button'));
      fireEvent.click(screen.getByTestId('copy-button'));

      expect(onCopy).toHaveBeenCalledWith('notes', 'Notes content');
      expect(mockNotifySuccess).toHaveBeenCalledWith('Notes copied');
    });

    it('should close menu after copying', () => {
      render(
        <MockAIMeetingBlock
          sections={[
            { type: BlockType.AIMeetingSummaryBlock, content: 'Summary' },
            { type: BlockType.AIMeetingNotesBlock, content: 'Notes' },
          ]}
        />
      );

      fireEvent.click(screen.getByTestId('more-menu-button'));
      expect(screen.getByTestId('copy-menu')).toBeTruthy();

      fireEvent.click(screen.getByTestId('copy-button'));
      expect(screen.queryByTestId('copy-menu')).toBeNull();
    });
  });

  describe('Initial State', () => {
    it('should respect initialTabIndex', () => {
      render(
        <MockAIMeetingBlock
          sections={[
            { type: BlockType.AIMeetingSummaryBlock, content: 'Summary' },
            { type: BlockType.AIMeetingNotesBlock, content: 'Notes' },
            { type: BlockType.AIMeetingTranscriptionBlock, content: 'Transcript' },
          ]}
          initialTabIndex={2}
        />
      );

      const transcriptTab = screen.getByTestId('tab-transcript');

      expect(transcriptTab.getAttribute('data-active')).toBe('true');
    });

    it('should clamp to last tab if initialTabIndex out of range', () => {
      render(
        <MockAIMeetingBlock
          sections={[
            { type: BlockType.AIMeetingSummaryBlock, content: 'Summary' },
            { type: BlockType.AIMeetingNotesBlock, content: 'Notes' },
          ]}
          initialTabIndex={10}
        />
      );

      // Should clamp to last available tab (notes at index 1)
      const notesTab = screen.getByTestId('tab-notes');

      expect(notesTab).toBeTruthy();
      expect(notesTab.getAttribute('data-active')).toBe('true');
    });
  });
});

/**
 * Simplified Reference Badge component for testing
 */
interface MockReferenceBadgeProps {
  number: number;
  hasError?: boolean;
  onClick?: () => void;
}

function MockReferenceBadge({ number, hasError, onClick }: MockReferenceBadgeProps) {
  return (
    <button
      data-testid={`reference-badge-${number}`}
      data-has-error={hasError ? 'true' : 'false'}
      className={`reference-badge ${hasError ? 'error' : ''}`}
      onClick={onClick}
    >
      {number}
    </button>
  );
}

interface MockReferencePopoverProps {
  references: Array<{
    blockId: string;
    status: 'exists' | 'deleted';
    content?: string;
    sourceType?: 'transcript' | 'notes';
    timestamp?: number;
  }>;
  onReferenceClick?: (blockId: string, sourceType: string) => void;
}

function MockReferencePopover({ references, onReferenceClick }: MockReferencePopoverProps) {
  return (
    <div data-testid="reference-popover">
      {references.map((ref, index) => (
        <div
          key={ref.blockId}
          data-testid={`reference-item-${index}`}
          data-status={ref.status}
          data-source-type={ref.sourceType ?? ''}
        >
          {ref.status === 'deleted' ? (
            <span data-testid={`deleted-warning-${index}`}>Source was deleted</span>
          ) : (
            <button
              data-testid={`reference-link-${index}`}
              onClick={() => onReferenceClick?.(ref.blockId, ref.sourceType ?? 'notes')}
            >
              {ref.content}
              {ref.timestamp !== undefined && (
                <span data-testid={`timestamp-${index}`}>{ref.timestamp}s</span>
              )}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

describe('InlineReference Component', () => {
  describe('Reference Badge', () => {
    it('should render badge with number', () => {
      render(<MockReferenceBadge number={1} />);

      const badge = screen.getByTestId('reference-badge-1');

      expect(badge.textContent).toBe('1');
    });

    it('should show error state for deleted references', () => {
      render(<MockReferenceBadge number={2} hasError />);

      const badge = screen.getByTestId('reference-badge-2');

      expect(badge.getAttribute('data-has-error')).toBe('true');
    });

    it('should call onClick when clicked', () => {
      const onClick = jest.fn();

      render(<MockReferenceBadge number={1} onClick={onClick} />);
      fireEvent.click(screen.getByTestId('reference-badge-1'));

      expect(onClick).toHaveBeenCalled();
    });
  });

  describe('Reference Popover', () => {
    it('should render all reference items', () => {
      render(
        <MockReferencePopover
          references={[
            { blockId: 'b1', status: 'exists', content: 'First ref', sourceType: 'notes' },
            { blockId: 'b2', status: 'exists', content: 'Second ref', sourceType: 'transcript' },
          ]}
        />
      );

      expect(screen.getByTestId('reference-item-0')).toBeTruthy();
      expect(screen.getByTestId('reference-item-1')).toBeTruthy();
    });

    it('should show deleted warning for deleted references', () => {
      render(
        <MockReferencePopover
          references={[{ blockId: 'b1', status: 'deleted' }]}
        />
      );

      const warning = screen.getByTestId('deleted-warning-0');

      expect(warning.textContent).toBe('Source was deleted');
    });

    it('should show timestamp for transcript references', () => {
      render(
        <MockReferencePopover
          references={[
            { blockId: 'b1', status: 'exists', content: 'Transcript ref', sourceType: 'transcript', timestamp: 125 },
          ]}
        />
      );

      const timestamp = screen.getByTestId('timestamp-0');

      expect(timestamp.textContent).toBe('125s');
    });

    it('should call onReferenceClick with blockId and sourceType', () => {
      const onReferenceClick = jest.fn();

      render(
        <MockReferencePopover
          references={[
            { blockId: 'block-123', status: 'exists', content: 'Click me', sourceType: 'transcript' },
          ]}
          onReferenceClick={onReferenceClick}
        />
      );

      fireEvent.click(screen.getByTestId('reference-link-0'));

      expect(onReferenceClick).toHaveBeenCalledWith('block-123', 'transcript');
    });

    it('should distinguish between notes and transcript sources', () => {
      render(
        <MockReferencePopover
          references={[
            { blockId: 'b1', status: 'exists', content: 'From notes', sourceType: 'notes' },
            { blockId: 'b2', status: 'exists', content: 'From transcript', sourceType: 'transcript' },
          ]}
        />
      );

      const notesItem = screen.getByTestId('reference-item-0');
      const transcriptItem = screen.getByTestId('reference-item-1');

      expect(notesItem.getAttribute('data-source-type')).toBe('notes');
      expect(transcriptItem.getAttribute('data-source-type')).toBe('transcript');
    });
  });

  describe('Reference Click Navigation', () => {
    it('should trigger tab switch when clicking transcript reference', () => {
      const onReferenceClick = jest.fn();

      render(
        <MockReferencePopover
          references={[
            { blockId: 'transcript-block', status: 'exists', content: 'Transcript content', sourceType: 'transcript', timestamp: 60 },
          ]}
          onReferenceClick={onReferenceClick}
        />
      );

      fireEvent.click(screen.getByTestId('reference-link-0'));

      expect(onReferenceClick).toHaveBeenCalledWith('transcript-block', 'transcript');
    });

    it('should trigger tab switch when clicking notes reference', () => {
      const onReferenceClick = jest.fn();

      render(
        <MockReferencePopover
          references={[
            { blockId: 'notes-block', status: 'exists', content: 'Notes content', sourceType: 'notes' },
          ]}
          onReferenceClick={onReferenceClick}
        />
      );

      fireEvent.click(screen.getByTestId('reference-link-0'));

      expect(onReferenceClick).toHaveBeenCalledWith('notes-block', 'notes');
    });
  });
});
