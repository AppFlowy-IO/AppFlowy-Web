const fs = require('fs');
const path = require('path');

// Ensure target directory exists
function ensureDirectoryExists (dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`Created directory: ${dirPath}`);
  }
}

// Read JSON file
function readJsonFile (filePath) {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error);
    process.exit(1);
  }
}

// Resolve reference values
function resolveReferences (tokens, primitiveTokens) {
  const resolvedTokens = JSON.parse(JSON.stringify(tokens));

  function resolveValue (value, visitedRefs = new Set()) {
    if (typeof value !== 'string' || !value.startsWith('{') || !value.endsWith('}')) {
      return value;
    }

    const reference = value.slice(1, -1);
    if (visitedRefs.has(reference)) {
      console.warn(`Circular reference detected: ${reference}`);
      return value;
    }

    visitedRefs.add(reference);

    // Split reference path
    const parts = reference.split('.');
    let current;

    // First look in primitive tokens
    if (primitiveTokens) {
      current = primitiveTokens;
      for (const part of parts) {
        if (current && current[part]) {
          current = current[part];
        } else {
          current = null;
          break;
        }
      }
    }

    // If not found in primitives, look in current tokens
    if (!current) {
      current = resolvedTokens;
      for (const part of parts) {
        if (current && current[part]) {
          current = current[part];
        } else {
          console.warn(`Reference not found: ${reference}`);
          return value;
        }
      }
    }

    if (current && current.$value) {
      return resolveValue(current.$value, visitedRefs);
    }

    return current;
  }

  function processObject (obj) {
    for (const key in obj) {
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        processObject(obj[key]);
      } else if (key === '$value') {
        obj.$value = resolveValue(obj.$value);
      }
    }
  }

  processObject(resolvedTokens);
  return resolvedTokens;
}

// Convert to CSS variables
function convertToCssVariables (tokens, prefix = '', isDarkTheme = false, sourceFile) {
  let variableNames = []; // Store all generated variable names

  // Create CSS file header with warning comments
  let css = `/**
 * Design system ${isDarkTheme ? 'dark' : 'light'} theme variables
 * AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
 * 
 * Generated from: ${sourceFile}
 * Generated time: ${new Date().toISOString()}
 * 
 * To modify these values, edit the source JSON files and run the token conversion script:
 * node scripts/system-token/convert-tokens.cjs
 */

`;

  // Select root selector based on theme
  const rootSelector = isDarkTheme ? ':root[data-dark-mode=true]' : ':root';

  function processTokens (obj, path = '') {
    for (const key in obj) {
      const newPath = path ? `${path}-${key}` : key;

      // If object but not a value object (i.e., doesn't have $value)
      if (typeof obj[key] === 'object' && obj[key] !== null && !obj[key].$value) {
        processTokens(obj[key], newPath);
      }
      // If it's a value object (has $value)
      else if (typeof obj[key] === 'object' && obj[key] !== null && obj[key].$value) {
        const token = obj[key];
        const variableName = `--${prefix}${newPath.toLowerCase().replace(/_/g, '-')}`;

        let value = token.$value;

        // Add to variable names list
        variableNames.push(variableName.substring(2)); // Remove leading --

        // Format value based on type
        if (token.$type === 'dimension') {
          // Keep dimension values as is, they already include units like px
          css += `  ${variableName}: ${value};\n`;
        } else if (token.$type === 'color') {
          css += `  ${variableName}: ${value};\n`;
        } else {
          css += `  ${variableName}: ${value};\n`;
        }
      }
    }
  }

  css += `${rootSelector} {\n`;
  processTokens(tokens);
  css += '}\n';

  return { css, variableNames };
}

// Generate Tailwind color config from CSS variable names
function createTailwindColorsFromVariables (variableNames) {
  const colors = {};

  // Group by prefix
  variableNames.forEach(varName => {
    const parts = varName.split('-');
    const mainCategory = parts[0];

    // Handle main category
    if (!colors[mainCategory]) {
      colors[mainCategory] = {};
    }

    // Generate key without main category
    const subKey = parts.slice(1).join('-');

    // Use 'DEFAULT' if empty
    const finalKey = subKey || 'DEFAULT';

    // Set CSS variable reference
    colors[mainCategory][finalKey] = `var(--${varName})`;
  });

  // Fix special categories to match Tailwind conventions
  delete colors['spacing'];
  delete colors['border-radius'];
  delete colors['shadow'];

  // Generate CommonJS module code
  const tailwindCode = `/**
 * TailwindCSS color configuration
 * AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
 * 
 * This file is auto-generated by convert-tokens.cjs script
 * Generation time: ${new Date().toISOString()}
 * 
 * To modify these colors, edit the source JSON files and run the token conversion script:
 * node scripts/system-token/convert-tokens.cjs
 * 
 * These colors reference CSS variables, ensure the corresponding CSS files are loaded
 */

module.exports = ${JSON.stringify(colors, null, 2)};
`;

  return tailwindCode;
}

// Main function
function convertDesignTokens (primitiveFilePath, semanticFilePath, outputFilePath, isDarkTheme = false) {
  // Read files
  const primitiveTokens = readJsonFile(primitiveFilePath);
  const semanticTokens = readJsonFile(semanticFilePath);

  // Resolve references
  const resolvedTokens = resolveReferences(semanticTokens, primitiveTokens);

  // Convert to CSS with source file information
  const { css, variableNames } = convertToCssVariables(
    resolvedTokens,
    '',
    isDarkTheme,
    path.basename(semanticFilePath),
  );

  // Ensure output directory exists
  const outputDir = path.dirname(outputFilePath);
  ensureDirectoryExists(outputDir);

  // Write file
  fs.writeFileSync(outputFilePath, css, 'utf8');
  console.log(`CSS variables written to ${outputFilePath}`);

  return { variableNames };
}

// Define project root directory
const projectRoot = path.resolve(__dirname, '../..'); // Go up two levels from scripts/system-token to project root

// Define input and output paths
const inputDir = path.join(__dirname); // Current script directory
const cssOutputDir = path.join(projectRoot, 'src/styles/variables');
const tailwindOutputDir = path.join(projectRoot, 'tailwind');

// Ensure output directories exist
ensureDirectoryExists(cssOutputDir);
ensureDirectoryExists(tailwindOutputDir);

// Execute conversion
console.log('Converting design tokens to CSS variables...');

// Collect all variable names
let allVariableNames = [];

// Convert light theme (default theme)
const lightResult = convertDesignTokens(
  path.join(inputDir, 'primitive.json'),
  path.join(inputDir, 'semantic.light.json'),
  path.join(cssOutputDir, 'semantic.light.css'),
  false, // Light theme
);
allVariableNames = allVariableNames.concat(lightResult.variableNames);

// Convert dark theme (using data-dark-mode attribute)
const darkResult = convertDesignTokens(
  path.join(inputDir, 'primitive.json'),
  path.join(inputDir, 'semantic.dark.json'),
  path.join(cssOutputDir, 'semantic.dark.css'),
  true, // Dark theme
);
// Dark theme variables are the same as light theme, no need to merge

// Generate Tailwind color configuration
console.log('Generating Tailwind color configuration with CSS variable references...');
const tailwindColors = createTailwindColorsFromVariables(allVariableNames);
fs.writeFileSync(path.join(tailwindOutputDir, 'new-colors.cjs'), tailwindColors);
console.log(`Tailwind colors written to ${path.join(tailwindOutputDir, 'new-colors.cjs')}`);

console.log('Conversion completed successfully!');