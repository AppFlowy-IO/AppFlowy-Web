import type { Preview } from '@storybook/react-vite';
import React, { useEffect } from 'react';
import { I18nextProvider } from 'react-i18next';
import { BrowserRouter } from 'react-router-dom';

import { AFConfigContext } from '@/components/main/app.hooks';
import '@/i18n/config';
import { i18nInstance } from '@/i18n/config';
// Import styles - order matters: global.css imports tailwind.css
import '@/styles/global.css';
import '@/styles/app.scss';

// Set dark mode attribute early, before React renders
if (typeof window !== 'undefined') {
    const isDark = localStorage.getItem('dark-mode') === 'true' ||
        window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-dark-mode', isDark ? 'true' : 'false');
}

// Mock AFConfigContext value for Storybook
const mockAFConfigValue = {
    isAuthenticated: true, // Set to true to prevent redirects in Storybook
    currentUser: {
        email: 'storybook@example.com',
        name: 'Storybook User',
        uid: 'storybook-uid',
        avatar: null,
        uuid: 'storybook-uuid',
        latestWorkspaceId: 'storybook-workspace-id',
    },
    updateCurrentUser: async () => {
        // Mock implementation
    },
    openLoginModal: () => {
        // Mock implementation
        console.log('Login modal would open here');
    },
};

const preview: Preview = {
    parameters: {
        controls: {
            matchers: {
                color: /(background|color)$/i,
                date: /Date$/i,
            },
        },
        layout: 'fullscreen',
    },
    decorators: [
        (Story) => {
            // Ensure dark mode is set on mount and watch for changes
            useEffect(() => {
                const updateDarkMode = () => {
                    const isDark = localStorage.getItem('dark-mode') === 'true' ||
                        window.matchMedia('(prefers-color-scheme: dark)').matches;
                    document.documentElement.setAttribute('data-dark-mode', isDark ? 'true' : 'false');
                };

                updateDarkMode();

                // Listen for system theme changes
                const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
                mediaQuery.addEventListener('change', updateDarkMode);

                return () => {
                    mediaQuery.removeEventListener('change', updateDarkMode);
                };
            }, []);

            return (
                <BrowserRouter>
                    <AFConfigContext.Provider value={mockAFConfigValue}>
                        <I18nextProvider i18n={i18nInstance}>
                            <div id="body" className="bg-background-primary text-text-primary" style={{ height: '100vh', width: '100%' }}>
                                <Story />
                            </div>
                        </I18nextProvider>
                    </AFConfigContext.Provider>
                </BrowserRouter>
            );
        },
    ],
};

export default preview;

