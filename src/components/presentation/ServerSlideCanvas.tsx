import {
  createContext,
  CSSProperties,
  memo,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';

import { getArtifactAsset, getArtifactScene } from './presentation-client';

import type { PresentationScope } from './server-contract';
import type { DeckScene, SceneElement } from './server-scene';
import type { SavedDeck } from './types';

type SceneState = {
  key: string;
  scene?: DeckScene;
  images: ReturnType<typeof createSceneImages>;
  error?: string;
};
const SceneContext = createContext<SceneState | undefined>(undefined);
const assetKey = (id: string, revision: string) => `${id}:${revision}`;
const rgb = (color: string) => (/^#?[0-9a-f]{6}$/i.test(color) ? `#${color.replace(/^#/, '')}` : 'transparent');
const supported = (scene: DeckScene) => scene.schemaVersion === 1 && scene.width === 1280 && scene.height === 720;

/** Each asset revision notifies only its mounted image copies, leaving scene geometry stable. */
function createSceneImages() {
  const values = new Map<string, string | null>();
  const listeners = new Map<string, Set<() => void>>();
  const notify = (id: string) => listeners.get(id)?.forEach((listener) => listener());

  return {
    read: (id: string) => values.get(id),
    subscribe(id: string, listener: () => void) {
      const subscribers = listeners.get(id) ?? new Set<() => void>();

      subscribers.add(listener);
      listeners.set(id, subscribers);
      return () => {
        subscribers.delete(listener);
        if (!subscribers.size) listeners.delete(id);
      };
    },
    publish(id: string, url: string | null) {
      if (values.get(id) === url) return;
      values.set(id, url);
      notify(id);
    },
    clear() {
      const ids = [...values.keys()];

      values.forEach((url) => url && URL.revokeObjectURL(url));
      values.clear();
      ids.forEach(notify);
    },
  };
}

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
  // A deck read with its scene (loadSavedDeck, runGeneration) only needs its images.
  const known =
    deck.scene?.workspaceId === scope.workspaceId && deck.scene.id === deck.id && deck.scene.version === deck.version
      ? deck.scene.value
      : undefined;
  const images = useMemo(createSceneImages, [key]);
  const [state, setState] = useState<SceneState>(() => ({
    key,
    scene: known && supported(known) ? known : undefined,
    images,
  }));

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        if (!deck.version) throw new Error('The saved presentation has no server version. Reopen it to continue.');
        const version = deck.version;
        const scene = known ?? (await getArtifactScene(scope, deck.id, version, controller.signal));

        if (controller.signal.aborted) return;
        if (!supported(scene)) throw new Error('This presentation scene requires a newer web client.');
        const assets = new Map<string, Extract<SceneElement, { kind: 'image' }>>();

        scene.slides.forEach((slide) =>
          slide.elements.forEach((element) => {
            if (element.kind === 'image') assets.set(assetKey(element.asset_id, element.revision), element);
          })
        );
        // Scene context changes only when the scene changes; images publish to their own subscribers.
        setState((current) =>
          current.key === key && current.scene === scene && current.images === images && !current.error
            ? current
            : { key, scene, images }
        );
        const pending = [...assets.entries()];
        let next = 0;
        const worker = async () => {
          while (!controller.signal.aborted && next < pending.length) {
            const [id, element] = pending[next++];

            try {
              const blob = await getArtifactAsset(
                scope,
                deck.id,
                version,
                element.asset_id,
                element.revision,
                controller.signal
              );

              if (controller.signal.aborted) return;
              if (!['image/png', 'image/jpeg'].includes(blob.type)) throw new Error('Unsupported presentation image.');
              images.publish(id, URL.createObjectURL(blob));
            } catch {
              if (controller.signal.aborted) return;
              // One unavailable image must not hide the rest of the deck.
              images.publish(id, null);
            }
          }
        };

        await Promise.all(Array.from({ length: Math.min(4, pending.length) }, worker));
      } catch (error) {
        if (!controller.signal.aborted) {
          setState({
            key,
            images,
            error: error instanceof Error ? error.message : 'Unable to load this presentation.',
          });
          controller.abort();
        }

        images.clear();
      }
    }

    void load();
    return () => {
      controller.abort();
      images.clear();
    };
    // pageId is not an authority for artifact reads; the server rechecks its saved source ACLs.
    // The known scene belongs to this key's artifact version, which never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, scope.workspaceId, deck.id, deck.version, images]);

  // A stable value lets memoized thumbnails skip renders that change nothing in the scene.
  const value = useMemo<SceneState>(
    () =>
      state.key === key && state.images === images
        ? state
        : { key, scene: known && supported(known) ? known : undefined, images },
    [state, key, known, images]
  );

  return <SceneContext.Provider value={value}>{children}</SceneContext.Provider>;
}

function SceneImage({
  element,
  box,
  images,
}: {
  element: Extract<SceneElement, { kind: 'image' }>;
  box: CSSProperties;
  images: SceneState['images'];
}) {
  const id = assetKey(element.asset_id, element.revision);
  const subscribe = useCallback((listener: () => void) => images.subscribe(id, listener), [images, id]);
  const read = useCallback(() => images.read(id), [images, id]);
  const src = useSyncExternalStore(subscribe, read, () => undefined);

  // Keep the frame in place while this image loads or when it cannot be shown.
  return src ? (
    <img alt={element.attribution} src={src} style={{ ...box, objectFit: 'contain' }} />
  ) : (
    <div
      role='img'
      aria-label={src === null ? 'Image unavailable' : element.attribution}
      aria-busy={src === undefined}
      style={{
        ...box,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0000000a',
        color: '#6b7e98',
        fontSize: '1.25cqw',
      }}
    >
      {src === null && 'Image unavailable'}
    </div>
  );
}

function NativeChart({ element }: { element: Extract<SceneElement, { kind: 'chart' }> }) {
  const min = Math.min(0, ...element.items.map((item) => item.value));
  const max = Math.max(0, ...element.items.map((item) => item.value));
  const span = max - min || 1;
  // Use scene pixels so text scales uniformly with the slide, including narrower exhibit columns.
  const { width, height } = element.bounds;
  const plotHeight = height * 0.74;
  const baseline = (plotHeight * max) / span;
  const column = width / Math.max(1, element.items.length);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role='img'
      aria-label={`${element.unit}: ${element.items.map((item) => `${item.label} ${item.value}`).join(', ')}`}
      style={{ width: '100%', height: '100%', fontFamily: element.font }}
    >
      <line x1={0} x2={width} y1={baseline} y2={baseline} stroke={rgb(element.color)} strokeWidth={1} />
      {element.items.map((item, index) => {
        const y = (plotHeight * (max - item.value)) / span;

        return (
          <g key={index}>
            <rect
              x={index * column + column * 0.15}
              y={Math.min(y, baseline)}
              width={column * 0.7}
              height={Math.max(1, Math.abs(y - baseline))}
              fill={rgb(element.accent)}
            />
            <foreignObject x={index * column + 4} y={plotHeight + 8} width={column - 8} height={height - plotHeight - 8}>
              <div
                style={{
                  fontSize: 16,
                  lineHeight: 1.2,
                  textAlign: 'center',
                  overflowWrap: 'anywhere',
                  color: rgb(element.color),
                }}
              >
                <div>{item.label}</div>
                <div style={{ marginTop: 4 }}>
                  {item.value} {element.unit}
                </div>
              </div>
            </foreignObject>
          </g>
        );
      })}
    </svg>
  );
}

/** Renders server geometry; local draft layout helpers are never used for saved previews. */
function ServerSlideCanvas({ index = 0, miniature = false }: { index?: number; miniature?: boolean }) {
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
          return <SceneImage key={element.id} element={element} box={box} images={state.images} />;

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

// Thumbnails pass only primitive props, so a selected-slide change does not re-render them.
export default memo(ServerSlideCanvas);
