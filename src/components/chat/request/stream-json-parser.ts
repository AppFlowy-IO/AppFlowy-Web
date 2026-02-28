export interface ExtractedJsonObject {
  jsonStr: string;
  nextIndex: number;
}

export const extractNextJsonObject = (buffer: string): ExtractedJsonObject | null => {
  const startIndex = buffer.indexOf('{');

  if (startIndex === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < buffer.length; index += 1) {
    const char = buffer[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;

      if (depth === 0) {
        return {
          jsonStr: buffer.slice(startIndex, index + 1),
          nextIndex: index + 1,
        };
      }
    }
  }

  return null;
};
