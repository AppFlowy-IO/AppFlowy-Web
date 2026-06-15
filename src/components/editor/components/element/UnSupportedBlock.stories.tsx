import { withContainer } from '../../../../../.storybook/decorators';

import { UnSupportedBlock } from './UnSupportedBlock';

import type { Meta, StoryObj } from '@storybook/react-vite';

/**
 * The UnSupportedBlock component is displayed when the editor encounters a block type
 * that is not yet supported. This provides a user-friendly message instead of breaking
 * the editor or showing nothing.
 *
 * The component shows:
 * - A warning icon
 * - The unsupported block type name
 * - In development mode: a collapsible debug section with the full block JSON
 */
const meta = {
  title: 'Editor/UnSupportedBlock',
  component: UnSupportedBlock,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  decorators: [withContainer({ padding: '20px', maxWidth: '800px' })],
  argTypes: {
    node: {
      description: 'The block node with an unsupported type',
      control: 'object',
    },
  },
} satisfies Meta<typeof UnSupportedBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default unsupported block with a generic unknown type
 */
export const Default: Story = {
  args: {
    node: {
      type: 'unknown_block_type',
      blockId: 'block-123',
      children: [],
    },
  },
};

/**
 * An unsupported block with a future feature type name
 */
export const FutureFeature: Story = {
  args: {
    node: {
      type: 'ai_generated_content',
      blockId: 'block-456',
      children: [],
      data: {
        prompt: 'Generate a summary',
        model: 'gpt-4',
      },
    },
  },
};

/**
 * An unsupported block representing a deprecated feature
 */
export const DeprecatedFeature: Story = {
  args: {
    node: {
      type: 'legacy_embed_block',
      blockId: 'block-789',
      children: [],
      data: {
        embedUrl: 'https://example.com/embed',
        width: 640,
        height: 480,
      },
    },
  },
};

/**
 * An unsupported block with a complex nested data structure
 */
export const ComplexData: Story = {
  args: {
    node: {
      type: 'custom_plugin_block',
      blockId: 'block-complex',
      children: [],
      data: {
        pluginId: 'my-custom-plugin',
        version: '2.0.0',
        config: {
          enabled: true,
          options: ['option1', 'option2'],
          nested: {
            level1: {
              level2: {
                value: 'deep nested data',
              },
            },
          },
        },
      },
    },
  },
};

/**
 * An unsupported block with minimal data
 */
export const MinimalData: Story = {
  args: {
    node: {
      type: 'simple_unsupported',
      blockId: 'block-minimal',
      children: [],
    },
  },
};

/**
 * An unsupported block with a very long type name
 */
export const LongTypeName: Story = {
  args: {
    node: {
      type: 'this_is_a_very_long_block_type_name_that_might_overflow_the_container',
      blockId: 'block-long',
      children: [],
    },
  },
};

/**
 * An unsupported block representing a third-party integration
 */
export const ThirdPartyIntegration: Story = {
  args: {
    node: {
      type: 'notion_import_block',
      blockId: 'block-notion',
      children: [],
      data: {
        source: 'notion',
        originalId: 'abc123',
        importedAt: '2024-01-15T10:30:00Z',
      },
    },
  },
};
