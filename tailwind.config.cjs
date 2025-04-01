const colors = require('./tailwind/colors.cjs');
const boxShadow = require('./tailwind/box-shadow.cjs');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    './node_modules/react-tailwindcss-datepicker/dist/index.esm.js',
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
      },
    },
  },
  plugins: [],
};
