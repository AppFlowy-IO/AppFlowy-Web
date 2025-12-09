# Storybook Guide for AppFlowy Web

This guide covers how to write Storybook stories for AppFlowy Web components, including common patterns, solutions to frequent issues, and best practices.

## Table of Contents

1. [Setup and Configuration](#setup-and-configuration)
2. [Writing Stories](#writing-stories)
3. [Shared Utilities](#shared-utilities)
4. [Common Patterns](#common-patterns)
5. [Mocking and Context Providers](#mocking-and-context-providers)
6. [Hostname Mocking for Different Scenarios](#hostname-mocking-for-different-scenarios)
7. [CSS and Styling](#css-and-styling)
8. [Common Issues and Solutions](#common-issues-and-solutions)
9. [Examples](#examples)

## Setup and Configuration

### Prerequisites

- Node.js v20.6.0 or higher (required for Storybook)
- All dependencies installed via `pnpm install`

### Running Storybook

```bash
pnpm run storybook
```

This starts Storybook on `http://localhost:6006` (or next available port).

### Building Storybook

```bash
pnpm run build-storybook
```

## Writing Stories

### Basic Story Structure

A Storybook story file should follow this structure:

```typescript
import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import YourComponent from './YourComponent';

const meta = {
  title: 'Category/ComponentName',
  component: YourComponent,
  parameters: {
    layout: 'padded', // or 'centered', 'fullscreen'
  },
  tags: ['autodocs'],
} satisfies Meta<typeof YourComponent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    // Component props
  },
};
```

### Story Categories

Organize stories by feature area:
- `Share/` - Sharing and collaboration features
- `Billing/` - Subscription and billing components
- `Publish/` - Publishing and site management
- `Editor/` - Editor components and features
- `Error Pages/` - Error and not found pages

## Shared Utilities

**IMPORTANT:** To avoid code duplication, always use the shared utilities located in `.storybook/` instead of creating your own mocks, decorators, or argTypes.

### Available Utilities

#### 1. Shared Mocks (`.storybook/mocks.ts`)

Pre-configured mock context values to use in your stories:

```typescript
import { mockAFConfigValue, mockAFConfigValueMinimal, mockAppContextValue } from '../../../.storybook/mocks';

// mockAFConfigValue - Full mock with service.getSubscriptionLink
// mockAFConfigValueMinimal - Minimal mock without service (use when service not needed)
// mockAppContextValue - Mock for AppContext with workspace info
```

**When to use each:**
- `mockAFConfigValue`: Components that need `service.getSubscriptionLink` (e.g., billing components)
- `mockAFConfigValueMinimal`: Components that only need auth, no service functionality
- `mockAppContextValue`: Components that need workspace information

#### 2. Shared Decorators (`.storybook/decorators.tsx`)

Pre-built decorator functions to wrap your components:

```typescript
import {
  withContexts,           // AFConfig + AppContext
  withContextsMinimal,    // AFConfig (minimal) + AppContext
  withAFConfig,           // Just AFConfig
  withAFConfigMinimal,    // Just AFConfig (minimal)
  withAppContext,         // Just AppContext
  withHostnameMocking,    // Hostname mocking only
  withHostnameAndContexts,// Hostname + both contexts
  withContainer,          // Padded container with max-width
  withPadding,            // Simple padding wrapper
} from '../../../.storybook/decorators';
```

**Common decorator patterns:**

```typescript
// For components needing both contexts
decorators: [withContextsMinimal]

// For hostname-aware components with contexts
decorators: [
  withHostnameAndContexts({ maxWidth: '600px', minimalAFConfig: true })
]

// For components needing hostname only (no contexts)
decorators: [
  withHostnameMocking(),
  withContainer({ maxWidth: '600px' })
]
```

#### 3. Shared ArgTypes (`.storybook/argTypes.ts`)

Pre-configured argTypes for common controls:

```typescript
import {
  hostnameArgType,                    // hostname control
  subscriptionPlanArgType,            // activeSubscriptionPlan control
  activePlanArgType,                  // activePlan control (alias)
  isOwnerArgType,                     // isOwner boolean control
  openArgType,                        // open boolean control (modals)
  hostnameAndSubscriptionArgTypes,    // Combined hostname + subscription
  ownershipArgTypes,                  // Combined owner + subscription
} from '../../../.storybook/argTypes';

// Usage
argTypes: {
  ...hostnameArgType,
  ...subscriptionPlanArgType,
}
// or
argTypes: hostnameAndSubscriptionArgTypes,
```

### Import Path Patterns

The import path depends on your file's depth from the `.storybook/` directory:

```typescript
// From src/components/error/*.stories.tsx (3 levels deep)
import { withContextsMinimal } from '../../../.storybook/decorators';

// From src/components/app/share/*.stories.tsx (4 levels deep)
import { withHostnameAndContexts } from '../../../../.storybook/decorators';

// From src/components/editor/components/toolbar/selection-toolbar/actions/*.stories.tsx (8 levels deep)
import { hostnameAndSubscriptionArgTypes } from '../../../../../../../.storybook/argTypes';
```

**Tip:** Count the number of `../` by counting how many directories you need to go up to reach `src/`, then add one more to reach the project root where `.storybook/` is located.

## Common Patterns

### 1. Component with Context Dependencies

**Use shared decorators instead of creating your own!**

If your component uses React Context (like `AppContext`, `AFConfigContext`), use the pre-built decorators:

```typescript
import type { Meta, StoryObj } from '@storybook/react-vite';
import { withContextsMinimal } from '../../../.storybook/decorators';
import YourComponent from './YourComponent';

const meta = {
  title: 'Category/YourComponent',
  component: YourComponent,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  decorators: [withContextsMinimal],
} satisfies Meta<typeof YourComponent>;

export default meta;
type Story = StoryObj<typeof meta>;
```

**Choose the right decorator:**
- `withContextsMinimal` - Most common, for components needing auth and workspace context
- `withContexts` - When component needs `service.getSubscriptionLink`
- `withAFConfigMinimal` or `withAppContext` - When only one context is needed

### 2. Router-Dependent Components

**IMPORTANT**: Do NOT add `BrowserRouter` in your story decorators. The `.storybook/preview.tsx` already provides a global `BrowserRouter` for all stories. Adding another will cause a "Cannot render Router inside another Router" error.

```typescript
// ✅ CORRECT - No BrowserRouter needed
const meta = {
  decorators: [
    (Story) => (
      <div style={{ padding: '20px' }}>
        <Story />
      </div>
    ),
  ],
};

// ❌ WRONG - Don't add BrowserRouter
const meta = {
  decorators: [
    (Story) => (
      <BrowserRouter>  // ❌ This will cause an error!
        <Story />
      </BrowserRouter>
    ),
  ],
};
```

## Mocking and Context Providers

### Required Contexts

Many AppFlowy components require these contexts:

1. **AFConfigContext** - Authentication and service configuration
2. **AppContext** - Workspace and app state
3. **I18nextProvider** - Already provided globally in preview.tsx
4. **BrowserRouter** - Already provided globally in preview.tsx

### Using Shared Mock Contexts

**DO NOT create new mock contexts!** Use the pre-configured ones from `.storybook/mocks.ts`:

```typescript
import {
  mockAFConfigValue,        // Full mock with service
  mockAFConfigValueMinimal, // Minimal mock without service
  mockAppContextValue       // App context with workspace info
} from '../../../.storybook/mocks';
```

These mocks are already configured with all required properties and sensible defaults. If you need custom behavior, you can extend them:

```typescript
import { mockAppContextValue } from '../../../.storybook/mocks';

// Custom mock extending the base
const customMock = {
  ...mockAppContextValue,
  currentWorkspaceId: 'custom-workspace-id',
};
```

**When to use each mock:**
- `mockAFConfigValueMinimal` - Most components (no service needed)
- `mockAFConfigValue` - Billing/subscription components that need `service.getSubscriptionLink`
- `mockAppContextValue` - Components needing workspace/user information

## Hostname Mocking for Different Scenarios

Many components behave differently based on whether they're running on official AppFlowy hosts (`beta.appflowy.cloud`, `test.appflowy.cloud`) or self-hosted instances.

### How It Works

The `isAppFlowyHosted()` function in `src/utils/subscription.ts` checks `window.location.hostname`. For Storybook, we mock this using a global variable.

### Using Shared Hostname Decorators

**Use the pre-built decorators instead of writing your own!**

#### Option 1: Hostname with Contexts (Most Common)

For components that need both hostname mocking and context providers:

```typescript
import type { Meta, StoryObj } from '@storybook/react-vite';
import { SubscriptionPlan } from '@/application/types';
import { hostnameAndSubscriptionArgTypes } from '../../../.storybook/argTypes';
import { withHostnameAndContexts } from '../../../.storybook/decorators';
import YourComponent from './YourComponent';

const meta = {
  title: 'Category/YourComponent',
  component: YourComponent,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  decorators: [
    withHostnameAndContexts({ maxWidth: '600px', minimalAFConfig: true }),
  ],
  argTypes: hostnameAndSubscriptionArgTypes,
} satisfies Meta<typeof YourComponent>;
```

#### Option 2: Hostname Only (No Contexts)

For components that check hostname but don't need context providers:

```typescript
import { hostnameArgType } from '../../../.storybook/argTypes';
import { withHostnameMocking, withContainer } from '../../../.storybook/decorators';

const meta = {
  title: 'Category/YourComponent',
  component: YourComponent,
  decorators: [
    withHostnameMocking(),
    withContainer({ maxWidth: '600px' }),
  ],
  argTypes: hostnameArgType,
} satisfies Meta<typeof YourComponent>;
```

### Story Examples for Different Hosts

```typescript
export const OfficialHost: Story = {
  args: {
    hostname: 'beta.appflowy.cloud',
    // ... other props
  },
  parameters: {
    docs: {
      description: {
        story: 'Behavior on official AppFlowy host (beta.appflowy.cloud)',
      },
    },
  },
};

export const SelfHosted: Story = {
  args: {
    hostname: 'self-hosted.example.com',
    // ... other props
  },
  parameters: {
    docs: {
      description: {
        story: 'Behavior on self-hosted instance - Pro features enabled by default',
      },
    },
  },
};

export const TestHost: Story = {
  args: {
    hostname: 'test.appflowy.cloud',
    // ... other props
  },
};
```

### Custom Decorator (Advanced)

If you need custom behavior (like modal state management), you can still use the shared `mockHostname` function and argTypes:

```typescript
import { useEffect, useState } from 'react';
import { mockHostname } from '../../../.storybook/decorators';
import { hostnameArgType } from '../../../.storybook/argTypes';

const meta = {
  decorators: [
    (Story, context) => {
      const hostname = context.args.hostname || 'beta.appflowy.cloud';
      mockHostname(hostname);

      useEffect(() => {
        mockHostname(hostname);
        return () => delete (window as any).__STORYBOOK_MOCK_HOSTNAME__;
      }, [hostname]);

      // Your custom logic here...
      return <Story />;
    },
  ],
  argTypes: hostnameArgType,
};
```

## CSS and Styling

### CSS Import Order

The `.storybook/preview.tsx` imports styles in the correct order:

```typescript
import '@/styles/global.css';  // Imports tailwind.css
import '@/styles/app.scss';     // Additional app styles
```

**Do not** import CSS files in individual story files. All styles are loaded globally.

### Tailwind Configuration

Tailwind is configured to use `#body` as the important selector. The preview decorator wraps all stories in a `div` with `id="body"`, so Tailwind classes will work correctly.

### Dark Mode

Dark mode is automatically handled in the preview decorator. The `data-dark-mode` attribute is set on `document.documentElement` based on:
1. `localStorage.getItem('dark-mode')`
2. System preference (`prefers-color-scheme: dark`)

## Common Issues and Solutions

### Issue 1: "Cannot render Router inside another Router"

**Problem**: You added `BrowserRouter` in your story decorator.

**Solution**: Remove `BrowserRouter` from your story. It's already provided globally in `.storybook/preview.tsx`.

```typescript
// ❌ Wrong
<BrowserRouter>
  <Story />
</BrowserRouter>

// ✅ Correct
<Story />
```

### Issue 2: "useUserWorkspaceInfo must be used within an AppProvider"

**Problem**: Component uses `useUserWorkspaceInfo()` or other AppContext hooks but no `AppContext.Provider` is provided.

**Solution**: Wrap your story in `AppContext.Provider` with mock values:

```typescript
import { AppContext } from '@/components/app/app.hooks';

const mockAppContextValue = {
  userWorkspaceInfo: {
    selectedWorkspace: {
      id: 'storybook-workspace-id',
      owner: { uid: 'storybook-uid' },
    },
    workspaces: [],
  },
  // ... other required properties
};

const meta = {
  decorators: [
    (Story) => (
      <AppContext.Provider value={mockAppContextValue}>
        <Story />
      </AppContext.Provider>
    ),
  ],
};
```

### Issue 3: "Cannot redefine property: hostname"

**Problem**: Trying to mock `window.location.hostname` directly using `Object.defineProperty`.

**Solution**: Use the global variable approach instead:

```typescript
// ❌ Wrong - window.location.hostname is not configurable
Object.defineProperty(window.location, 'hostname', {
  value: hostname,
});

// ✅ Correct - Use global variable
window.__STORYBOOK_MOCK_HOSTNAME__ = hostname;
```

### Issue 4: Styles Not Loading

**Problem**: CSS/Tailwind styles not appearing in Storybook.

**Solutions**:
1. Ensure Storybook is restarted after configuration changes
2. Check that CSS files are imported in `.storybook/preview.tsx`
3. Verify `postcss.config.cjs` exists and includes Tailwind
4. Check browser console for CSS loading errors
5. Ensure the `#body` element exists (it's added in preview.tsx)

### Issue 5: Hostname Mocking Not Working

**Problem**: `isOfficialHost()` returns wrong value in stories.

**Solutions**:
1. Set `mockHostname()` synchronously before render, not just in `useEffect`
2. Ensure `window.__STORYBOOK_MOCK_HOSTNAME__` is set before component mounts
3. Check that the cleanup function deletes the variable properly

## Examples

### Example 1: Component with Hostname and Context (Recommended Pattern)

Most subscription/billing/sharing components follow this pattern:

```typescript
import type { Meta, StoryObj } from '@storybook/react-vite';
import { SubscriptionPlan } from '@/application/types';
import { hostnameAndSubscriptionArgTypes } from '../../../../.storybook/argTypes';
import { withHostnameAndContexts } from '../../../../.storybook/decorators';
import { UpgradeBanner } from './UpgradeBanner';

const meta = {
  title: 'Share/UpgradeBanner',
  component: UpgradeBanner,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  decorators: [
    withHostnameAndContexts({ maxWidth: '600px', minimalAFConfig: true }),
  ],
  argTypes: hostnameAndSubscriptionArgTypes,
} satisfies Meta<typeof UpgradeBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OfficialHostFreePlan: Story = {
  args: {
    activeSubscriptionPlan: SubscriptionPlan.Free,
    hostname: 'beta.appflowy.cloud',
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows upgrade banner on official host when user has Free plan',
      },
    },
  },
};

export const SelfHostedFreePlan: Story = {
  args: {
    activeSubscriptionPlan: SubscriptionPlan.Free,
    hostname: 'self-hosted.example.com',
  },
  parameters: {
    docs: {
      description: {
        story: 'No banner on self-hosted - Pro features enabled by default',
      },
    },
  },
};
```

### Example 2: Error Page Component (Context Only, No Hostname)

```typescript
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ErrorType } from '@/application/utils/error-utils';
import { withContextsMinimal } from '../../../.storybook/decorators';
import RecordNotFound from './RecordNotFound';

const meta = {
  title: 'Error Pages/RecordNotFound',
  component: RecordNotFound,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
  decorators: [withContextsMinimal],
} satisfies Meta<typeof RecordNotFound>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PageNotFound: Story = {
  args: {
    error: {
      type: ErrorType.PageNotFound,
      message: 'Page or resource not found',
      statusCode: 404,
    },
  },
};
```

### Example 3: Simple Component (No Context, No Hostname)

```typescript
import type { Meta, StoryObj } from '@storybook/react-vite';
import SimpleComponent from './SimpleComponent';

const meta = {
  title: 'Category/SimpleComponent',
  component: SimpleComponent,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof SimpleComponent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    text: 'Hello Storybook',
  },
};
```

### Example 4: Custom Decorator with Shared Utilities

When you need custom behavior (like managing modal state), use shared mocks and argTypes:

```typescript
import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useEffect, useState } from 'react';
import { AppContext } from '@/components/app/app.hooks';
import { AFConfigContext } from '@/components/main/app.hooks';
import { hostnameArgType, openArgType } from '../../../.storybook/argTypes';
import { mockHostname } from '../../../.storybook/decorators';
import { mockAFConfigValue, mockAppContextValue } from '../../../.storybook/mocks';
import UpgradePlan from './UpgradePlan';

const meta = {
  title: 'Billing/UpgradePlan',
  component: UpgradePlan,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  decorators: [
    (Story, context) => {
      const hostname = context.args.hostname || 'beta.appflowy.cloud';
      const [open, setOpen] = useState(context.args.open ?? false);

      mockHostname(hostname);

      useEffect(() => {
        mockHostname(hostname);
        return () => delete (window as any).__STORYBOOK_MOCK_HOSTNAME__;
      }, [hostname]);

      return (
        <AFConfigContext.Provider value={mockAFConfigValue}>
          <AppContext.Provider value={mockAppContextValue}>
            <div style={{ padding: '20px', maxWidth: '800px' }}>
              <button onClick={() => setOpen(true)}>Open Modal</button>
              <Story args={{ ...context.args, open, onClose: () => setOpen(false) }} />
            </div>
          </AppContext.Provider>
        </AFConfigContext.Provider>
      );
    },
  ],
  argTypes: {
    ...openArgType,
    ...hostnameArgType,
  },
} satisfies Meta<typeof UpgradePlan>;
```

## Best Practices

1. **ALWAYS use shared utilities**: Never create your own mocks, decorators, or argTypes when shared ones exist in `.storybook/`
2. **Use the right decorator for your needs**:
   - `withContextsMinimal` - Most common (auth + workspace context, no service)
   - `withHostnameAndContexts()` - For hostname-aware subscription components
   - `withHostnameMocking()` - For hostname-only components (no contexts)
3. **Don't duplicate Router**: Never add `BrowserRouter` in stories (already in preview.tsx)
4. **Import shared utilities with correct relative paths**: Count `../` levels from your file to project root
5. **Use descriptive story names**: Make it clear what scenario the story demonstrates
6. **Add documentation**: Use `parameters.docs.description.story` to explain the story
7. **Test different scenarios**: Create stories for official hosts, self-hosted, different plans, etc.
8. **Use TypeScript**: Leverage `satisfies Meta<typeof Component>` for type safety
9. **Follow existing patterns**: Look at existing `.stories.tsx` files for reference
10. **Keep stories focused**: Each story should demonstrate one specific scenario or state

## Quick Reference

### Decision Tree: Which Utilities Do I Need?

```
Does my component check hostname (isOfficialHost)?
├─ YES: Does it need context providers?
│   ├─ YES: Use withHostnameAndContexts()
│   └─ NO: Use withHostnameMocking() + withContainer()
└─ NO: Does it need context providers?
    ├─ YES: Does it need service.getSubscriptionLink?
    │   ├─ YES: Use withContexts
    │   └─ NO: Use withContextsMinimal
    └─ NO: No decorators needed (or just layout decorators)
```

### Quick Import Cheatsheet

```typescript
// Decorators
import {
  withContextsMinimal,        // ← Most common
  withHostnameAndContexts,    // ← For hostname-aware components
  withHostnameMocking,        // ← Hostname only
  withContainer,              // ← Layout helper
} from '../../../.storybook/decorators';

// ArgTypes
import {
  hostnameAndSubscriptionArgTypes,  // ← Most common combo
  hostnameArgType,
  subscriptionPlanArgType,
} from '../../../.storybook/argTypes';

// Mocks (only if you need custom decorator)
import {
  mockAFConfigValueMinimal,   // ← Most common
  mockAppContextValue,
} from '../../../.storybook/mocks';
```

### Common Patterns at a Glance

| Component Type | Decorators | ArgTypes | Example |
|---|---|---|---|
| Error pages | `withContextsMinimal` | None | RecordNotFound |
| Subscription UI | `withHostnameAndContexts({ ... })` | `hostnameAndSubscriptionArgTypes` | UpgradeBanner |
| Billing modals | Custom (using shared mocks) | `hostnameArgType + openArgType` | UpgradePlan |
| Settings pages | `withHostnameMocking() + withContainer()` | `hostnameArgType + activePlanArgType` | HomePageSetting |
| Simple components | None | None | SimpleButton |

## Additional Resources

- [Storybook Documentation](https://storybook.js.org/docs)
- [Storybook React-Vite Framework](https://storybook.js.org/docs/react/get-started/install)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- **Shared Utilities**: `.storybook/mocks.ts`, `.storybook/decorators.tsx`, `.storybook/argTypes.ts`
- **Example Stories**: All files in `src/**/*.stories.tsx`

## Troubleshooting

If you encounter issues not covered here:

1. Check the browser console for errors
2. **Verify you're using shared utilities** from `.storybook/` instead of creating your own
3. Verify all required contexts are provided (use appropriate decorator)
4. Check import paths - count `../` levels correctly
5. Ensure CSS files are imported in preview.tsx
6. Restart Storybook after configuration changes
7. Check that Node.js version is v20.6.0 or higher
8. Clear Storybook cache: `rm -rf node_modules/.cache/storybook`

For more help, refer to existing story files in the codebase for examples.

