import Dialog from '@mui/material/Dialog';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import {
  type CSSProperties,
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { MentionType } from '@/application/types';
import { ReactComponent as BulletIcon } from '@/assets/icons/bulleted_1.svg';
import { ReactComponent as CircleBulletIcon } from '@/assets/icons/bulleted_2.svg';
import { ReactComponent as SquareBulletIcon } from '@/assets/icons/bulleted_3.svg';
import { ReactComponent as CheckboxChecked } from '@/assets/icons/check_filled.svg';
import { ReactComponent as ToggleIcon } from '@/assets/icons/toggle_list.svg';
import { ReactComponent as CheckboxUnchecked } from '@/assets/icons/uncheck.svg';
import { MathEquationContent } from '@/components/editor/components/blocks/math-equation/MathEquationContent';
import ViewCoverContent from '@/components/view-meta/ViewCoverContent';
import { renderColor } from '@/utils/color';
import { resolveViewCover } from '@/utils/cover';

import { presentedChildren, presentationSections, meetingMeasureKey } from './document-content';
import { documentOutline } from './document-outline';
import { documentUnitKey, paginateDocument } from './document-pagination';
import DocumentCallout from './DocumentCallout';
import DocumentContentProvider from './DocumentContentProvider';
import DocumentImage from './DocumentImage';
import DocumentMeeting, { MeetingSlide } from './DocumentMeeting';
import DocumentOutline, { DocumentOutlineContext } from './DocumentOutline';
import DocumentTable from './DocumentTable';
import FullscreenControl from './FullscreenControl';
import { flattenBlocks, type DocumentSlide } from './source';
import SourceText from './SourceText';
import {
  isSimpleTable,
  TABLE_DENSITIES,
  tableMeasureKey,
  tableRowKey,
  type TableDensity,
  type TablePage,
} from './table-pagination';
import { PageSnapshot, SourceBlock } from './types';
import { Action } from './ui';
import { usePresentationFullscreen } from './usePresentationFullscreen';
import './presentation.css';

const DocumentDatabase = lazy(() => import('./DocumentDatabase'));
const DocumentCode = lazy(() => import('./DocumentCode'));
// The measuring copy is hidden and inert, so none of its blocks can open a source.
const inertSource = () => undefined;
const COMFORTABLE: readonly TableDensity[] = TABLE_DENSITIES.slice(0, 1);

interface BlockContentProps {
  block: SourceBlock;
  onSource: (id: string) => void;
  expandedToggles?: ReadonlySet<string>;
  onToggle?: (id: string, open: boolean) => void;
  tableDensity?: TableDensity;
  tableLayout?: TablePage;
  tableMaxHeight?: number;
  preserveFormatting?: boolean;
  measuring?: boolean;
}

export function BlockContent(props: BlockContentProps) {
  if (props.block.database) {
    if (props.measuring) return null;
    return (
      <div className='ps-document-database' style={{ height: Math.max(120, props.tableMaxHeight ?? 440) }}>
        <Suspense fallback={<div role='status'>Loading database view…</div>}>
          <DocumentDatabase block={props.block} onSource={props.onSource} height={Math.max(120, props.tableMaxHeight ?? 440)} />
        </Suspense>
      </div>
    );
  }

  const style = props.block.style;
  const content = <BlockBody {...props} />;

  if (props.preserveFormatting === false || !style || ['callout', 'outline'].includes(props.block.type)) return content;
  const align = style.align?.toLowerCase();
  const formatting: CSSProperties = {
    backgroundColor: style.backgroundColor ? renderColor(style.backgroundColor) : undefined,
    color: style.color ? renderColor(style.color) : undefined,
    textAlign: align === 'left' || align === 'center' || align === 'right' ? align : undefined,
  };

  return <div style={formatting}>{content}</div>;
}

function BlockBody({
  block,
  onSource,
  expandedToggles,
  onToggle,
  tableDensity,
  tableLayout,
  tableMaxHeight,
  preserveFormatting = true,
  measuring,
}: BlockContentProps) {
  const children = presentedChildren(block).map((child) => (
    <BlockContent
      key={child.id}
      block={child}
      onSource={onSource}
      expandedToggles={expandedToggles}
      onToggle={onToggle}
      preserveFormatting={preserveFormatting}
      measuring={measuring}
    />
  ));
  const text = block.text;
  const content = preserveFormatting ? <SourceText block={block} /> : text;

  switch (block.type) {
    case 'ai_meeting':
      return <DocumentMeeting block={block}>{children}</DocumentMeeting>;
    case 'ai_meeting_summary':
      return (
        <div className='ai-meeting-section ai-meeting-section-summary'>
          {text && <p>{content}</p>}
          {children}
        </div>
      );
    case 'heading':
      return (
        <section>
          <h2 data-presentation-heading={block.id} className={`ps-doc-heading ps-doc-h${block.level ?? 2}`}>
            {content}
          </h2>
          {children}
        </section>
      );
    case 'paragraph':
      return (
        <div>
          <p>{content}</p>
          {children}
        </div>
      );
    case 'divider':
      return <hr />;
    case 'bulleted_list':
    case 'numbered_list':
      return (
        <div className='ps-doc-list'>
          <span className='ps-doc-marker'>
            {block.type === 'bulleted_list' ? (
              block.listMarker === 'circle' ? (
                <CircleBulletIcon />
              ) : block.listMarker === 'square' ? (
                <SquareBulletIcon />
              ) : (
                <BulletIcon />
              )
            ) : (
              block.listMarker ?? '1.'
            )}
          </span>
          <div>
            {content}
            {children}
          </div>
        </div>
      );
    case 'todo_list':
      return (
        <div className={`ps-doc-list${block.checked ? ' ps-doc-checked' : ''}`}>
          <span className='ps-doc-marker' aria-label={block.checked ? 'Completed' : 'Incomplete'}>
            {block.checked ? <CheckboxChecked /> : <CheckboxUnchecked className='text-border-primary' />}
          </span>
          <div>
            <span className='ps-todo-text'>{content}</span>
            {children}
          </div>
        </div>
      );
    case 'toggle_list':
      return (
        <details
          className='ps-native-toggle'
          open={expandedToggles?.has(block.id)}
          onToggle={(event) => onToggle?.(block.id, event.currentTarget.open)}
        >
          <summary data-presentation-heading={block.level ? block.id : undefined}>
            <span className='ps-doc-marker'>
              <ToggleIcon />
            </span>
            <span>{content}</span>
          </summary>
          {children}
        </details>
      );
    case 'quote':
      return (
        <blockquote className='ps-native-quote'>
          {content}
          {children}
        </blockquote>
      );
    case 'callout':
      return <DocumentCallout block={block}>{children}</DocumentCallout>;
    case 'outline':
      return <DocumentOutline block={block} />;
    case 'sub_page':
    case 'linked_page':
      return block.pageId ? (
        <div className='subpage relative my-1 w-full overflow-hidden rounded-[8px] p-1 hover:bg-fill-content-hover'>
          <SourceText
            block={{
              ...block,
              richText: [{ text: '$', mention: { type: MentionType.childPage, page_id: block.pageId } }],
            }}
          />
          {children}
        </div>
      ) : (
        <>{children}</>
      );
    case 'code':
      return (
        <div>
          <Suspense fallback={<pre>{text}</pre>}>
            <DocumentCode block={block} />
          </Suspense>
          {children}
        </div>
      );
    case 'math_equation':
      return (
        <div className='math-equation-block ps-document-equation relative w-full'>
          <div
            className={`math-equation-surface relative min-h-[44px] rounded-lg ${
              !(block.formula ?? text).trim() ? 'is-empty' : ''
            }`}
          >
            <div className={`min-h-[44px] rounded-lg pl-3 pr-11 ${!(block.formula ?? text).trim() ? 'py-2' : ''}`}>
              <MathEquationContent formula={block.formula ?? text} />
            </div>
          </div>
          {children}
        </div>
      );
    case 'image':
      return (
        <figure>
          <DocumentImage block={block} onSource={onSource} />
          <figcaption>{text}</figcaption>
          {children}
        </figure>
      );
    case 'simple_table':
    case 'table':
      if (isSimpleTable(block))
        return (
          <DocumentTable
            block={block}
            density={tableDensity}
            layout={tableLayout}
            maxHeight={tableMaxHeight}
            renderContent={(cell) => (
              <>
                <SourceText block={cell} />
                {cell.children.map((child) => (
                  <BlockContent
                    key={child.id}
                    block={child}
                    onSource={onSource}
                    expandedToggles={expandedToggles}
                    onToggle={onToggle}
                    preserveFormatting
                    measuring={measuring}
                  />
                ))}
              </>
            )}
          />
        );
      return (
        <div className='ps-doc-table' role='table' aria-label='Source table'>
          {children}
        </div>
      );
    case 'simple_table_row':
      return (
        <div className='ps-doc-table-row' role='row'>
          {children}
        </div>
      );
    case 'simple_table_cell':
    case 'table/cell':
      return (
        <div className='ps-doc-cell' role='cell'>
          {content}
          {children}
        </div>
      );
    case 'simple_columns':
    case 'simple_column':
      return (
        <div>
          {content}
          {children}
        </div>
      );
    default:
      return (
        <div className='ps-doc-fallback'>
          <strong>{block.type.replaceAll('_', ' ')}</strong>
          {text && <p>{content}</p>}
          <button onClick={() => onSource(block.id)}>Open source ↗</button>
          {children}
        </div>
      );
  }
}

function DocumentTitle({ snapshot, measuring = false }: { snapshot: PageSnapshot; measuring?: boolean }) {
  const cover = resolveViewCover(snapshot.cover);

  return (
    <div className={cover ? 'ps-doc-title-with-cover' : undefined}>
      {cover && (
        <div className='ps-doc-cover' aria-hidden='true'>
          {/* The fixed cover frame is enough to measure; do not fetch another image in the hidden ruler. */}
          {!measuring && <ViewCoverContent {...cover} coverOffset={snapshot.cover?.offset} />}
        </div>
      )}
      <span className='ps-eyebrow'>APPFLOWY DOCUMENT</span>
      <h1>{snapshot.title}</h1>
      {snapshot.properties.length > 0 && (
        <dl className='ps-properties'>
          {snapshot.properties.map((p) => (
            <div key={p.id}>
              <dt>{p.name}</dt>
              <dd>{p.value === null ? 'Not provided' : String(p.value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** Each unit follows only toggles in its own subtree, not every toggle on the page. */
const DocumentRulerUnit = memo(function DocumentRulerUnit({
  block,
  unitKey,
  expandedIds,
  condensed,
}: {
  block: SourceBlock;
  unitKey: string;
  expandedIds: string;
  condensed: boolean;
}) {
  const expandedToggles = useMemo(() => new Set<string>(JSON.parse(expandedIds) as string[]), [expandedIds]);

  return (
    <div className='ps-doc-block' data-document-unit={unitKey}>
      {isSimpleTable(block) ? (
        (condensed ? TABLE_DENSITIES : COMFORTABLE).map((density) => (
          <div key={density} data-table-density={density}>
            <BlockContent
              block={block}
              onSource={inertSource}
              expandedToggles={expandedToggles}
              tableDensity={density}
              measuring
            />
          </div>
        ))
      ) : (
        <BlockContent block={block} onSource={inertSource} expandedToggles={expandedToggles} measuring />
      )}
    </div>
  );
});

/** The hidden copy measured for pagination. Slide changes and host renders leave it untouched. */
const DocumentRuler = memo(function DocumentRuler({
  snapshot,
  sections,
  expandedToggles,
  condensedTables,
}: {
  snapshot: PageSnapshot;
  sections: DocumentSlide[];
  expandedToggles: ReadonlySet<string>;
  condensedTables: ReadonlySet<string>;
}) {
  return (
    <>
      {sections.map((section, sectionIndex) =>
        section.titleSlide ? (
          <div className='ps-doc-block' data-document-unit='title' key='title'>
            <DocumentTitle snapshot={snapshot} measuring />
          </div>
        ) : (
          <MeetingSlide key={sectionIndex} meeting={section.meeting} measureKey={meetingMeasureKey(sectionIndex)}>
            {section.blocks.map((block, blockIndex) => {
              const key = documentUnitKey(sectionIndex, blockIndex);

              return (
                <DocumentRulerUnit
                  key={key}
                  unitKey={key}
                  block={block}
                  condensed={condensedTables.has(key)}
                  expandedIds={JSON.stringify(
                    flattenBlocks([block])
                      .filter((item) => item.type === 'toggle_list' && expandedToggles.has(item.id))
                      .map((item) => item.id)
                  )}
                />
              );
            })}
          </MeetingSlide>
        )
      )}
    </>
  );
});

export default function DocumentPresenter({
  snapshot,
  onClose,
  onSource,
}: {
  snapshot: PageSnapshot;
  onClose: () => void;
  onSource: (id: string) => void;
}) {
  const sections = useMemo(() => presentationSections(snapshot), [snapshot]);
  const outline = useMemo(() => documentOutline(sections), [sections]);
  const [pendingHeading, setPendingHeading] = useState<string>();
  const [position, setPosition] = useState({ key: 'title', part: 0 });
  const [expandedToggles, setExpandedToggles] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        flattenBlocks(snapshot.blocks)
          .filter((block) => block.type === 'toggle_list' && block.collapsed === false)
          .map((block) => block.id)
      )
  );
  const [measurement, setMeasurement] = useState({ height: 1, width: 0, heights: {} as Record<string, number> });
  const [condensedTables, setCondensedTables] = useState<ReadonlySet<string>>(() => new Set());
  // Hosts pass a fresh source handler on every render; slide content keeps one stable callback.
  const latestSource = useRef(onSource);

  latestSource.current = onSource;
  const source = useCallback((id: string) => latestSource.current(id), []);
  const host = useRef<HTMLDivElement>(null);
  const fullscreen = usePresentationFullscreen(host);
  const [viewport, setViewport] = useState<HTMLElement | null>(null);
  const [measure, setMeasure] = useState<HTMLDivElement | null>(null);
  const slides = useMemo(
    () => paginateDocument(sections, measurement.heights, measurement.height),
    [sections, measurement]
  );
  const candidates = slides.flatMap((page, index) => (page.sourceKeys.includes(position.key) ? [index] : []));
  const index = candidates[Math.min(position.part, candidates.length - 1)] ?? 0;
  const slide = slides[index];

  useLayoutEffect(() => {
    const area = viewport;
    const ruler = measure;

    if (!area || !ruler) return;
    let frame = 0;
    const read = () => {
      // Dialog portals can mount before they have a visible layout.
      if (!area.clientWidth || !area.clientHeight) return;
      // Identical width, typography, and block wrappers in the ruler and visible slide.
      ruler.style.width = `${area.clientWidth}px`;
      const style = getComputedStyle(area);
      const height = Math.max(
        1,
        area.clientHeight - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0)
      );
      const heights: Record<string, number> = {};

      ruler.querySelectorAll<HTMLElement>('[data-document-unit]').forEach((unit) => {
        const key = unit.dataset.documentUnit!;

        heights[key] = unit.getBoundingClientRect().height;
        // Each density uses the same full-table column proportions as its visible fragments.
        unit.querySelectorAll<HTMLElement>('[data-table-density]').forEach((variant) => {
          const density = variant.dataset.tableDensity as TableDensity;

          heights[tableMeasureKey(key, density)] = variant.getBoundingClientRect().height;
          variant.querySelectorAll('.ps-table-grid > thead > tr, .ps-table-grid > tbody > tr').forEach((row, index) => {
            heights[tableRowKey(key, density, index)] = row.getBoundingClientRect().height;
          });
        });
      });
      ruler.querySelectorAll<HTMLElement>('[data-meeting-measure]').forEach((frame) => {
        const bodyHeight = Array.from(frame.querySelectorAll<HTMLElement>('[data-document-unit]')).reduce(
          (sum, unit) => sum + unit.getBoundingClientRect().height,
          0
        );

        heights[frame.dataset.meetingMeasure!] = frame.getBoundingClientRect().height - bodyHeight;
      });

      const condensed = new Set<string>();

      paginateDocument(sections, heights, height, condensed);
      setCondensedTables((previous) =>
        previous.size === condensed.size && [...condensed].every((key) => previous.has(key)) ? previous : condensed
      );
      // Only condensed tables render compact and dense copies. Keep the current slides until those copies
      // are measured, so no slide is paginated from a partial table measurement.
      if (![...condensed].every((key) => TABLE_DENSITIES.every((density) => tableMeasureKey(key, density) in heights)))
        return;

      setMeasurement((previous) => {
        const next = { height, width: area.clientWidth, heights };

        return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
      });
    };

    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(read);
    });

    observer.observe(area);
    ruler.querySelectorAll('[data-document-unit], [data-meeting-measure]').forEach((unit) => observer.observe(unit));
    read();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [sections, viewport, measure]);

  useLayoutEffect(() => {
    if (viewport) viewport.scrollTop = slide.scrollTop;
  }, [slide.key, slide.scrollTop, measurement, viewport]);

  const goTo = useCallback(
    (nextIndex: number) => {
      const next = slides[Math.max(0, Math.min(slides.length - 1, nextIndex))];

      setPosition({ key: next.sourceKeys[0], part: next.part });
      viewport?.focus({ preventScroll: true });
    },
    [slides, viewport]
  );

  const jumpToHeading = useCallback(
    (id: string) => {
      const target = outline.targets.get(id);

      if (!target) return;
      // Reveal only this presentation's copy of collapsed ancestors.
      setExpandedToggles((previous) => {
        if (target.toggles.every((toggle) => previous.has(toggle))) return previous;
        return new Set([...previous, ...target.toggles]);
      });
      setPendingHeading(id);
    },
    [outline]
  );
  const outlineContext = useMemo(
    () => ({ headings: outline.headings, onNavigate: jumpToHeading }),
    [outline.headings, jumpToHeading]
  );

  useLayoutEffect(() => {
    if (!pendingHeading || !measure) return;
    const target = outline.targets.get(pendingHeading);
    const heading = Array.from(measure.querySelectorAll<HTMLElement>('[data-presentation-heading]')).find(
      (element) => element.dataset.presentationHeading === pendingHeading
    );
    const unit = heading?.closest<HTMLElement>('[data-document-unit]');

    if (!target || !heading || !unit) return;
    // A newly opened toggle must be measured before choosing its continuation slide.
    if (Math.abs(unit.getBoundingClientRect().height - (measurement.heights[target.key] ?? 0)) > 1) return;
    const candidates = slides
      .map((page, index) => ({ page, index }))
      .filter(
        ({ page }) =>
          page.sourceKeys.includes(target.key) || flattenBlocks(page.blocks).some((block) => block.id === pendingHeading)
      );
    const first = candidates[0];

    if (!first) return;
    const firstUnit =
      Array.from(measure.querySelectorAll<HTMLElement>('[data-document-unit]')).find(
        (element) => element.dataset.documentUnit === first.page.sourceKeys[0]
      ) ?? unit;
    const top = heading.getBoundingClientRect().top - firstUnit.getBoundingClientRect().top;
    const bottom = top + heading.getBoundingClientRect().height;
    const match =
      (first.page.table ? first : undefined) ??
      candidates.find(
        ({ page }) => top >= page.scrollTop && bottom <= page.scrollTop + measurement.height - (page.frameHeight ?? 0)
      ) ??
      [...candidates].reverse().find(({ page }) => page.scrollTop <= top) ??
      first;

    goTo(match.index);
    setPendingHeading(undefined);
  }, [pendingHeading, outline, measure, measurement, slides, goTo]);

  function toggle(id: string, open: boolean) {
    setExpandedToggles((previous) => {
      if (previous.has(id) === open) return previous;
      const next = new Set(previous);

      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') {
        if (
          e.defaultPrevented ||
          (e.target instanceof HTMLElement &&
            e.target.closest('input, textarea, [contenteditable="true"], [role="tablist"]'))
        )
          return;
        e.preventDefault();
        goTo(index + 1);
      }

      if (e.key === 'ArrowLeft') {
        if (
          e.defaultPrevented ||
          (e.target instanceof HTMLElement &&
            e.target.closest('input, textarea, [contenteditable="true"], [role="tablist"]'))
        )
          return;
        e.preventDefault();
        goTo(index - 1);
      }
    }

    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [goTo, index]);
  return (
    <DocumentContentProvider onNavigate={onClose}>
      <DocumentOutlineContext.Provider value={outlineContext}>
        <Dialog
          open
          fullScreen
          onClose={(_event, reason) => {
            if (reason === 'escapeKeyDown' && fullscreen.isActive()) void fullscreen.toggle();
            else onClose();
          }}
          PaperProps={{ className: 'ps-presentation-dialog' }}
        >
          <div className='ps-presenter ps-root' ref={host}>
            <header>
              <span>
                Present document <span className='ps-muted'>· Original content</span>
              </span>
              <Action aria-label='Exit presentation' onClick={onClose}>
                <X size={18} />
              </Action>
            </header>
            <main
              // Embedded databases measure against the page's scroll container. Without it, a grid that
              // fits the slide finds no scrolling ancestor and never draws its rows.
              className={`ps-doc-slide appflowy-scroll-container${slide.table ? ' ps-doc-table-slide' : ''}`}
              ref={setViewport}
              tabIndex={0}
              aria-label={`Slide ${index + 1} of ${slides.length}`}
            >
              {slide.titleSlide ? (
                <div className='ps-doc-block'>
                  <DocumentTitle snapshot={snapshot} />
                </div>
              ) : (
                <MeetingSlide meeting={slide.meeting}>
                  {slide.blocks.map((block) => (
                    <div className='ps-doc-block' key={slide.table && isSimpleTable(block) ? slide.key : block.id}>
                      <BlockContent
                        block={block}
                        onSource={source}
                        expandedToggles={expandedToggles}
                        onToggle={toggle}
                        tableLayout={slide.table}
                        tableMaxHeight={measurement.height - (slide.prefixHeight ?? 0) - (slide.frameHeight ?? 0)}
                      />
                    </div>
                  ))}
                </MeetingSlide>
              )}
            </main>
            <div className='ps-doc-slide ps-doc-measure' ref={setMeasure} aria-hidden='true' {...{ inert: '' }}>
              <DocumentRuler
                snapshot={snapshot}
                sections={sections}
                expandedToggles={expandedToggles}
                condensedTables={condensedTables}
              />
            </div>
            <footer>
              <span className='ps-muted'>← → to navigate · Esc to exit</span>
              <div className='ps-inline'>
                <Action aria-label='Previous slide' disabled={!index} onClick={() => goTo(index - 1)}>
                  <ArrowLeft size={18} />
                </Action>
                <span aria-live='polite'>
                  {index + 1} / {slides.length}
                  {slide.partCount > 1 && (
                    <small className='ps-doc-continuation'>
                      Continued · {slide.part + 1} / {slide.partCount}
                    </small>
                  )}
                </span>
                <Action aria-label='Next slide' disabled={index === slides.length - 1} onClick={() => goTo(index + 1)}>
                  <ArrowRight size={18} />
                </Action>
              </div>
              <FullscreenControl fullscreen={fullscreen} />
            </footer>
          </div>
        </Dialog>
      </DocumentOutlineContext.Provider>
    </DocumentContentProvider>
  );
}
