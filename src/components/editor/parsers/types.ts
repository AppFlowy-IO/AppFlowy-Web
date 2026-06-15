import { BlockData, BlockType } from '@/application/types';

/**
 * Represents inline formatting information for text spans
 */
export interface InlineFormat {
  /** Start offset in the text */
  start: number;
  /** End offset in the text */
  end: number;
  /** Format type */
  type: 'bold' | 'italic' | 'underline' | 'strikethrough' | 'code' | 'link' | 'color' | 'bgColor';
  /** Additional data for specific formats */
  data?: {
    /** For links: the URL */
    href?: string;
    /** For colors: hex color value */
    color?: string;
    /** For background colors: hex color value */
    bgColor?: string;
  };
}

/**
 * Represents a parsed block from HTML or Markdown
 */
export interface ParsedBlock {
  /** Block type */
  type: BlockType;
  /** Block-specific data */
  data: BlockData;
  /** Plain text content */
  text: string;
  /** Inline formatting spans */
  formats: InlineFormat[];
  /** Nested child blocks */
  children: ParsedBlock[];
}

/**
 * Context information about where content is being pasted
 */
export interface PasteContext {
  /** Whether the current block is empty */
  isEmptyBlock: boolean;
  /** Current block type */
  blockType: BlockType;
  /** Whether content can be merged inline */
  canMerge: boolean;
  /** Cursor position relative to block */
  cursorPosition: 'start' | 'middle' | 'end';
  /** Current block ID */
  blockId: string;
}

/**
 * Options for parsing HTML content
 */
export interface HTMLParseOptions {
  /** Whether to preserve colors from styles */
  preserveColors?: boolean;
  /** Whether to preserve font families */
  preserveFonts?: boolean;
  /** Maximum nesting depth for blocks */
  maxDepth?: number;
}

/**
 * Options for parsing Markdown content
 */
export interface MarkdownParseOptions {
  /** Whether to use GitHub Flavored Markdown */
  gfm?: boolean;
  /** Whether to parse tables */
  tables?: boolean;
  /** Whether to parse strikethrough */
  strikethrough?: boolean;
  /** Whether to parse task lists */
  taskLists?: boolean;
}

/**
 * Result of paste operation
 */
export interface PasteResult {
  /** Whether paste was successful */
  success: boolean;
  /** Number of blocks inserted */
  blocksInserted: number;
  /** Error message if paste failed */
  error?: string;
}
