const colors = require('./tailwind/colors.cjs');
const boxShadow = require('./tailwind/box-shadow.cjs');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    './.storybook/**/*.{js,ts,jsx,tsx}',
  ],
  important: '#body',
  darkMode: 'class',
  theme: {
    extend: {
      colors,
      boxShadow,
      borderRadius: {
        100: '4px',
        200: '6px',
        300: '8px',
        400: '12px',
        500: '16px',
        600: '20px',
      },
      padding: {
        100: '4px',
        200: '6px',
        300: '8px',
        400: '12px',
        500: '16px',
        600: '20px',
        xs: '4px',
        sm: '6px',
        md: '12px',
        lg: '16px',
        xl: '20px',
      },
      keyframes: {
        blink: {
          '0%, 50%': { opacity: '1' },
          '51%, 100%': { opacity: '0' },
        },
      },
      animation: {
        blink: 'blink 1s infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
