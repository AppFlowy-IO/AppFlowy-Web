/**
 * Color math behind the donut palette (desktop's `ChartColorUtils`): snapping
 * an option color onto the palette and deriving a readable label tone. HSL
 * conversions follow Flutter's `HSLColor`, including its rounding, so the
 * derived colors match desktop's to the hex digit.
 */

interface Hsl {
  /** Degrees, 0 ≤ hue < 360. */
  hue: number;
  saturation: number;
  lightness: number;
}

/** Below this saturation a color has no hue worth matching on. */
const MIN_SATURATION_FOR_HUE_MATCH = 0.15;
/** WCAG AA floor for text. */
const MIN_TEXT_CONTRAST = 4.5;
/** Lightness step desktop's `deepTone` walks by. */
const TONE_STEP = 0.04;

/**
 * The chart surfaces labels are read against. Dark mode uses the lighter of
 * the two dark backgrounds a chart can sit on (`--surface-primary` over
 * `--background-primary`), so a tone that clears it clears both.
 */
export const LIGHT_CHART_SURFACE = '#FFFFFF';
export const DARK_CHART_SURFACE = '#272930';

function channels(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1, 7), 16);

  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function toHex(red: number, green: number, blue: number) {
  // Flutter's `Color.fromARGB` keeps the low byte of each rounded channel.
  const byte = (channel: number) => Math.round(channel * 0xff) & 0xff;
  const value = (byte(red) << 16) | (byte(green) << 8) | byte(blue);

  return `#${value.toString(16).padStart(6, '0').toUpperCase()}`;
}

/** Flutter's `HSLColor.fromColor`. */
export function hexToHsl(hex: string): Hsl {
  const [red, green, blue] = channels(hex).map((channel) => channel / 0xff);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;

  if (max === 0) hue = 0;
  // Dart's `%` never returns a negative remainder for a positive divisor.
  else if (max === red) hue = 60 * (((((green - blue) / delta) % 6) + 6) % 6);
  else if (max === green) hue = 60 * ((blue - red) / delta + 2);
  else hue = 60 * ((red - green) / delta + 4);
  if (Number.isNaN(hue)) hue = 0;

  const lightness = (max + min) / 2;
  const rawSaturation = delta / (1 - Math.abs(2 * lightness - 1));
  // Flutter's `clampDouble` maps the NaN of pure black to the upper bound.
  const saturation = lightness === 1 ? 0 : Number.isNaN(rawSaturation) ? 1 : Math.min(1, Math.max(0, rawSaturation));

  return { hue, saturation, lightness };
}

/** Flutter's `HSLColor.toColor`. */
export function hslToHex({ hue, saturation, lightness }: Hsl): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = lightness - chroma / 2;
  let rgb: [number, number, number];

  if (hue < 60) rgb = [chroma, secondary, 0];
  else if (hue < 120) rgb = [secondary, chroma, 0];
  else if (hue < 180) rgb = [0, chroma, secondary];
  else if (hue < 240) rgb = [0, secondary, chroma];
  else if (hue < 300) rgb = [secondary, 0, chroma];
  else rgb = [chroma, 0, secondary];

  return toHex(rgb[0] + match, rgb[1] + match, rgb[2] + match);
}

function relativeLuminance(hex: string) {
  const [red, green, blue] = channels(hex).map((channel) => {
    const value = channel / 0xff;

    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  });

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG contrast ratio between two opaque colors. */
export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);

  return (lighter + 0.05) / (darker + 0.05);
}

/** Shortest distance between two hues in degrees, wrapping at 360. */
function hueGap(a: number, b: number) {
  const gap = Math.abs(a - b) % 360;

  return gap > 180 ? 360 - gap : gap;
}

/**
 * The `palette` entry closest to `color` (desktop's `nearestInPalette`).
 * Chromatic colors match by hue, which keeps a tag color's hue across the
 * ramp's even lightness where RGB distance would not. A near-grey matches by
 * lightness, but only among the palette's own greys: desktop compares it to
 * every entry, which sends a dark grey to the ramp's darkest color, lime.
 */
export function nearestInPalette(color: string, palette: readonly string[]): string {
  const source = hexToHsl(color);
  const isGrey = source.saturation < MIN_SATURATION_FOR_HUE_MATCH;
  const greys = isGrey ? palette.filter((entry) => hexToHsl(entry).saturation < MIN_SATURATION_FOR_HUE_MATCH) : [];
  const candidates = greys.length > 0 ? greys : palette;
  let nearest = candidates[0];
  let nearestDistance = Infinity;

  for (const candidate of candidates) {
    const hsl = hexToHsl(candidate);
    const distance = isGrey ? Math.abs(hsl.lightness - source.lightness) : hueGap(source.hue, hsl.hue);

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = candidate;
    }
  }

  return nearest;
}

/**
 * Walks `color`'s lightness in `direction` until it reads on `surface`, or
 * until it runs out of room. Hue and saturation stay put.
 */
function walkTone(color: string, surface: string, direction: -1 | 1) {
  const hsl = hexToHsl(color);
  let candidate = color;
  let { lightness } = hsl;

  while (contrastRatio(candidate, surface) < MIN_TEXT_CONTRAST && (direction < 0 ? lightness > 0.1 : lightness < 0.9)) {
    lightness += direction * TONE_STEP;
    candidate = hslToHex({ ...hsl, lightness });
  }

  return candidate;
}

/**
 * A palette fill deepened until it reads as text on the white chart surface
 * (desktop's `deepTone`): the pastels themselves disappear against it.
 */
export function deepTone(color: string): string {
  return walkTone(color, LIGHT_CHART_SURFACE, -1);
}

/**
 * The label tone of a fill on the current theme. Desktop only derives the
 * light-surface tone; on a dark surface that deep tone would sink into the
 * background, so the fill is lifted instead (the pastels already clear it).
 */
export function readableTone(color: string, isDark: boolean): string {
  return isDark ? walkTone(color, DARK_CHART_SURFACE, 1) : deepTone(color);
}
