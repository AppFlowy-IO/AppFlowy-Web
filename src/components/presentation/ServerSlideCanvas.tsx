import { createContext, CSSProperties, ReactNode, useContext, useEffect, useState } from 'react';

import { getArtifactAsset, getArtifactScene } from './presentation-client';

import type { PresentationScope } from './server-contract';
import type { DeckScene, SceneElement } from './server-scene';
import type { SavedDeck } from './types';

type SceneState = {
  key: string;
  scene?: DeckScene;
  images: Map<string, string>;
  error?: string;
};
const SceneContext = createContext<SceneState | undefined>(undefined);
const assetKey = (id: string, revision: string) => `${id}:${revision}`;
const rgb = (color: string) => (/^#?[0-9a-f]{6}$/i.test(color) ? `#${color.replace(/^#/, '')}` : 'transparent');

/** Fetch one authorized scene and one copy of each private image for all thumbnails and slides. */
export function ServerSlideSceneProvider({
  deck,
  scope,
  children,
}: {
  deck: SavedDeck;
  scope: PresentationScope;
  children: ReactNode;
}) {
  const key = `${scope.workspaceId}:${deck.id}:${deck.version}`;
  const [state, setState] = useState<SceneState>({ key: '', images: new Map() });

  useEffect(() => {
    const controller = new AbortController();
    const images = new Map<string, string>();
    const revoke = () => images.forEach((url) => URL.revokeObjectURL(url));

    async function load() {
      try {
        if (!deck.version) throw new Error('The saved presentation has no server version. Reopen it to continue.');
        const scene = await getArtifactScene(scope, deck.id, deck.version, controller.signal);

        if (controller.signal.aborted) return;
        if (scene.schemaVersion !== 1 || scene.width !== 1280 || scene.height !== 720)
          throw new Error('This presentation scene requires a newer web client.');
        const assets = new Map<string, Extract<SceneElement, { kind: 'image' }>>();

        scene.slides.forEach((slide) =>
          slide.elements.forEach((element) => {
            if (element.kind === 'image') assets.set(assetKey(element.asset_id, element.revision), element);
          })
        );
        const pending = [...assets.values()];
        let next = 0;
        const worker = async () => {
          while (!controller.signal.aborted && next < pending.length) {
            const element = pending[next++];
            const blob = await getArtifactAsset(
              scope,
              deck.id,
              deck.version!,
              element.asset_id,
              element.revision,
              controller.signal
            );

            if (controller.signal.aborted) return;
            if (!['image/png', 'image/jpeg'].includes(blob.type)) throw new Error('Unsupported presentation image.');
            images.set(assetKey(element.asset_id, element.revision), URL.createObjectURL(blob));
          }
        };

        await Promise.all(Array.from({ length: Math.min(4, pending.length) }, worker));
        if (!controller.signal.aborted) setState({ key, scene, images });
      } catch (error) {
        if (!controller.signal.aborted) {
          setState({
            key,
            images: new Map(),
            error: error instanceof Error ? error.message : 'Unable to load this presentation.',
          });
          controller.abort();
        }

        revoke();
      }
    }

    void load();
    return () => {
      controller.abort();
      revoke();
    };
    // pageId is not an authority for artifact reads; the server rechecks its saved source ACLs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, scope.workspaceId, deck.id, deck.version]);

  return (
    <SceneContext.Provider value={state.key === key ? state : { key, images: new Map() }}>
      {children}
    </SceneContext.Provider>
  );
}

function NativeChart({ element }: { element: Extract<SceneElement, { kind: 'chart' }> }) {
  const min = Math.min(0, ...element.items.map((item) => item.value));
  const max = Math.max(0, ...element.items.map((item) => item.value));
  const span = max - min || 1;
  const baseline = (80 * max) / span;
  const column = 100 / Math.max(1, element.items.length);

  return (
    <svg
      viewBox='0 0 100 100'
      preserveAspectRatio='none'
      role='img'
      aria-label={`${element.unit}: ${element.items.map((item) => `${item.label} ${item.value}`).join(', ')}`}
      style={{ width: '100%', height: '100%', overflow: 'visible' }}
    >
      <line x1={0} x2={100} y1={baseline} y2={baseline} stroke={rgb(element.color)} strokeWidth={0.3} />
      {element.items.map((item, index) => {
        const y = (80 * (max - item.value)) / span;

        return (
          <g key={index}>
            <rect
              x={index * column + column * 0.15}
              y={Math.min(y, baseline)}
              width={column * 0.7}
              height={Math.max(0.2, Math.abs(y - baseline))}
              fill={rgb(element.accent)}
            />
            <text x={(index + 0.5) * column} y={90} textAnchor='middle' fontSize={3} fill={rgb(element.color)}>
              {item.label}
            </text>
            <text x={(index + 0.5) * column} y={97} textAnchor='middle' fontSize={3} fill={rgb(element.color)}>
              {item.value} {element.unit}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Renders server geometry; local draft layout helpers are never used for saved previews. */
export default function ServerSlideCanvas({ index = 0, miniature = false }: { index?: number; miniature?: boolean }) {
  const state = useContext(SceneContext);
  const scene = state?.scene;
  const slide = scene?.slides[index];

  if (state?.error)
    return (
      <div role='alert' className='ps-notice'>
        {state.error}
      </div>
    );
  if (!state || !scene || !slide)
    return (
      <div role='status' className='ps-slide'>
        Loading saved slide…
      </div>
    );
  return (
    <div
      className={`ps-slide ps-scene ${miniature ? 'ps-miniature' : ''}`}
      style={{ background: rgb(slide.background), fontFamily: scene.theme.font }}
    >
      {slide.elements.map((element) => {
        const box: CSSProperties = {
          position: 'absolute',
          left: `${(element.bounds.x / scene.width) * 100}%`,
          top: `${(element.bounds.y / scene.height) * 100}%`,
          width: `${(element.bounds.width / scene.width) * 100}%`,
          height: `${(element.bounds.height / scene.height) * 100}%`,
          margin: 0,
        };

        if (element.kind === 'text')
          return (
            <p
              key={element.id}
              style={{
                ...box,
                color: rgb(element.color),
                fontFamily: element.font,
                fontSize: `${(element.size / scene.width) * 100}cqw`,
                fontWeight: element.bold ? 700 : 400,
                lineHeight: 1.25,
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                letterSpacing: 0,
              }}
            >
              {element.text}
            </p>
          );
        if (element.kind === 'shape')
          return (
            <div
              key={element.id}
              aria-hidden='true'
              style={{
                ...box,
                background: rgb(element.fill),
                border: `1px solid ${rgb(element.line)}`,
                borderRadius:
                  element.geometry === 'ellipse' ? '50%' : element.geometry === 'rounded_rectangle' ? '1cqw' : 0,
              }}
            />
          );
        if (element.kind === 'image')
          return (
            <img
              key={element.id}
              alt={element.attribution}
              src={state.images.get(assetKey(element.asset_id, element.revision))}
              style={{ ...box, objectFit: 'contain' }}
            />
          );
        if (element.kind === 'chart')
          return (
            <div key={element.id} style={{ ...box, fontFamily: element.font }}>
              <NativeChart element={element} />
            </div>
          );
        return (
          <table
            key={element.id}
            style={{
              ...box,
              borderCollapse: 'collapse',
              tableLayout: 'fixed',
              color: rgb(element.color),
              fontFamily: element.font,
              fontSize: '1.25cqw',
            }}
          >
            <thead>
              <tr>
                {element.columns.map((cell, i) => (
                  <th key={i} style={{ border: `1px solid ${rgb(element.accent)}`, padding: '.4cqw' }}>
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {element.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} style={{ border: `1px solid ${rgb(element.accent)}`, padding: '.4cqw' }}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        );
      })}
    </div>
  );
}
