import { Plugin } from 'vite';

/**
 * Vite plugin to strip data-testid and data-parity-id attributes from production builds
 * This reduces bundle size and removes test-specific attributes from production code
 * (`data-parity-id` marks dashboard chrome for the visual parity probe)
 */
export function stripTestIdPlugin(): Plugin {
  return {
    name: 'strip-test-id',
    apply: 'build', // Only apply during build, not dev
    transform(code: string, id: string) {
      // Skip node_modules to avoid transforming external libraries
      if (id.includes('node_modules')) {
        return null;
      }

      // Only process .tsx and .jsx files from our source
      if (!id.match(/src.*\.(tsx|jsx)$/)) {
        return null;
      }

      // Only strip in production builds
      if (process.env.NODE_ENV !== 'production') {
        return null;
      }

      let transformedCode = code;
      let hasChanges = false;

      try {
        // Pattern 1: Simple string attributes: data-testid="value" or data-testid='value'
        // (and data-parity-id="value"). This is the safest pattern to remove
        const simpleStringPattern = /\s+data-(?:testid|parity-id)\s*=\s*["'][^"']*["']/g;
        const matches = transformedCode.match(simpleStringPattern);


        if (matches && matches.length > 0) {
          console.log(`Stripping ${matches.length} data-testid / data-parity-id attributes from ${id}`);
          transformedCode = transformedCode.replace(simpleStringPattern, '');
          hasChanges = true;
        }

        // Pattern 2: Simple expressions without nested braces: data-testid={variable}
        const simpleExpressionPattern = /\s+data-(?:testid|parity-id)\s*=\s*\{[^{}]+\}/g;
        const exprMatches = transformedCode.match(simpleExpressionPattern);


        if (exprMatches && exprMatches.length > 0) {
          console.log(`Stripping ${exprMatches.length} data-testid / data-parity-id expressions from ${id}`);
          transformedCode = transformedCode.replace(simpleExpressionPattern, '');
          hasChanges = true;
        }

        // Pattern 3: Template literals: data-testid={`value-${id}`}
        const templatePattern = /\s+data-(?:testid|parity-id)\s*=\s*\{`[^`]*`\}/g;


        if (templatePattern.test(transformedCode)) {
          transformedCode = transformedCode.replace(templatePattern, '');
          hasChanges = true;
        }

        if (hasChanges) {
          // Quick validation: check for obvious syntax errors
          // Count opening and closing braces to ensure we didn't break anything
          const openBraces = (transformedCode.match(/\{/g) || []).length;
          const closeBraces = (transformedCode.match(/\}/g) || []).length;
          
          if (openBraces !== closeBraces) {
            console.warn(`Warning: Brace mismatch after transformation in ${id}. Skipping transformation.`);
            return null;
          }

          return {
            code: transformedCode,
            map: null,
          };
        }
      } catch (error) {
        console.error(`Error processing ${id}:`, error);
        // Return null to skip transformation on error
        return null;
      }

      return null;
    },
  };
}