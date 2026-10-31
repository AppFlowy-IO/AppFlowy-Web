import type { Theme } from './server-contract';

/** The server scene is the geometry used by the native PowerPoint renderer (1280 × 720). */
export interface SceneBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ElementBase {
  id: string;
  bounds: SceneBounds;
}

export type SceneElement = ElementBase &
  (
    | { kind: 'text'; text: string; font: string; size: number; bold: boolean; color: string }
    | { kind: 'shape'; geometry: 'rectangle' | 'rounded_rectangle' | 'ellipse'; fill: string; line: string }
    | { kind: 'table'; columns: string[]; rows: string[][]; font: string; color: string; accent: string }
    | {
        kind: 'chart';
        unit: string;
        items: { label: string; value: number; sourceId: string }[];
        font: string;
        color: string;
        accent: string;
      }
    | { kind: 'image'; asset_id: string; revision: string; attribution: string }
  );

export interface SceneSlide {
  id: string;
  layout: string;
  background: string;
  elements: SceneElement[];
  notes: string;
  sourceIds: string[];
  warnings: string[];
}

export interface DeckScene {
  schemaVersion: number;
  width: number;
  height: number;
  title: string;
  style: { id: string; version: number };
  theme: Theme;
  slides: SceneSlide[];
  warnings: string[];
}
