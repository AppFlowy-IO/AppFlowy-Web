import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import {
  CHART_NUMBER_COLOR_VARS,
  CHART_OPACITY_STEPS,
  CHART_OPTION_COLORS,
  CHART_SERIES_PALETTE,
} from '@/application/database-yjs/chart.type';
import {
  DASHBOARD_GEOMETRY,
  DASHBOARD_MOTION,
  DASHBOARD_TYPOGRAPHY,
} from '@/application/database-yjs/dashboard-geometry';

import type { Meta, StoryObj } from '@storybook/react-vite';

/**
 * The dashboard tokens (`src/styles/dashboard-tokens.css`, bound to
 * `dashboard-parity/tokens.json`) in one theme: every `--dash-*` / `--chart-*`
 * color with the value the browser resolves, the shadows, the chart palettes,
 * and one widget box in View and Edit mode drawn from the tokens only. The
 * light / dark pair is the W22 visual check against the Notion references.
 */

const COLOR_VARIABLES = [
  '--dash-accent',
  '--dash-edit-title',
  '--dash-edit-icon',
  '--dash-edit-tint',
  '--dash-edit-ring',
  '--dash-row-control-bg',
  '--dash-card-bg',
  '--dash-card-ring',
  '--dash-title',
  '--dash-tool-icon',
  '--dash-hover-fill',
  '--dash-unsaved-dot',
  '--dash-save-bg',
  '--dash-save-fg',
  '--dash-pill-bg-active',
  '--dash-pill-fg-active',
  '--dash-pill-bg',
  '--dash-pill-fg',
  '--dash-toast-bg',
  '--chart-grid',
  '--chart-tick',
  '--chart-data-label',
  '--chart-outside-label',
  '--chart-hover-band',
  '--chart-empty',
  '--chart-tooltip-bg',
  '--chart-tooltip-border',
  '--chart-number-default',
];

const SHADOW_VARIABLES = [
  '--dash-card-shadow',
  '--chart-tooltip-shadow',
  '--dash-drilldown-shadow',
  '--dash-side-peek-shadow',
];

const { widget, grid } = DASHBOARD_GEOMETRY;
const fast = `${DASHBOARD_MOTION.fastMs}ms ${DASHBOARD_MOTION.easing}`;

function typography(spec: { size: number; lineHeight: number; weight: number }): CSSProperties {
  return { fontSize: spec.size, lineHeight: `${spec.lineHeight}px`, fontWeight: spec.weight };
}

/** Sets the story's theme on `<html>` after the preview decorator applied the saved one, and restores it. */
function ThemeScope({ dark, children }: { dark: boolean; children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute('data-dark-mode');
    const frame = requestAnimationFrame(() => root.setAttribute('data-dark-mode', dark ? 'true' : 'false'));

    return () => {
      cancelAnimationFrame(frame);
      if (previous !== null) root.setAttribute('data-dark-mode', previous);
    };
  }, [dark]);

  return <>{children}</>;
}

/** A computed `rgb()` / `rgba()` / `color(srgb …)` value as `#RRGGBB` or `#RRGGBBAA`. */
function toHex(color: string) {
  const rgb = /rgba?\(([^)]+)\)/.exec(color);
  // color-mix() computes to `color(srgb r g b / a)` with 0–1 channels.
  const srgb = /color\(srgb ([^)]+)\)/.exec(color);
  const parts = (rgb ?? srgb)?.[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);

  if (!parts) return color;
  const scale = srgb ? 255 : 1;
  const [r, g, b, a] = parts;
  const hex = [r, g, b]
    .map((channel) =>
      Math.round(channel * scale)
        .toString(16)
        .padStart(2, '0')
    )
    .join('');
  const alpha =
    a === undefined || a >= 1
      ? ''
      : Math.round(a * 255)
          .toString(16)
          .padStart(2, '0');

  return `#${hex}${alpha}`.toUpperCase();
}

/** The resolved background of an element, re-read whenever the theme attribute changes. */
function useResolvedBackground() {
  const ref = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    const read = () =>
      requestAnimationFrame(() => ref.current && setValue(toHex(getComputedStyle(ref.current).backgroundColor)));
    const observer = new MutationObserver(read);

    read();
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-dark-mode'] });
    return () => observer.disconnect();
  }, []);

  return { ref, value };
}

function ColorSwatch({ variable }: { variable: string }) {
  const { ref, value } = useResolvedBackground();

  return (
    <div className='flex items-center gap-3'>
      <div
        className='h-10 w-10 shrink-0 rounded-300'
        ref={ref}
        style={{ background: `var(${variable})`, boxShadow: 'inset 0 0 0 1px var(--border-primary)' }}
      />
      <div className='min-w-0'>
        <div className='truncate font-mono text-xs text-text-primary'>{variable}</div>
        <div className='font-mono text-xs text-text-secondary'>{value}</div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className='flex flex-col gap-3'>
      <h2 className='text-sm font-semibold text-text-primary'>{title}</h2>
      {children}
    </section>
  );
}

function ToolButton({ editing }: { editing: boolean }) {
  const size = widget.toolButton.size;
  const icon = widget.toolButton.icon;

  return (
    <span
      className='flex items-center justify-center hover:bg-dash-hover-fill'
      style={{ width: size, height: size, borderRadius: widget.toolButton.radius }}
    >
      <svg aria-hidden='true' height={icon} viewBox='0 0 16 16' width={icon}>
        <path
          d='M2.5 4h11M4.5 8h7M6.5 12h3'
          fill='none'
          stroke={editing ? 'var(--dash-edit-icon)' : 'var(--dash-tool-icon)'}
          strokeLinecap='round'
          strokeWidth='1.5'
        />
      </svg>
    </span>
  );
}

/** One widget box: header (title pill and tools) above the card, with the Edit-mode tint and ring. */
function WidgetBoxMock({ editing, title }: { editing: boolean; title: string }) {
  const cardHeight = 180;

  return (
    <div
      className={editing ? 'bg-dash-edit-tint' : undefined}
      data-testid='dashboard-tokens-widget-box'
      style={{
        borderRadius: widget.boxRadius,
        padding: `${widget.boxPaddingTop}px ${widget.boxPaddingInline}px ${widget.boxPaddingBottom}px`,
        transition: `background-color ${fast}`,
      }}
    >
      <div
        className='flex items-center justify-between'
        style={{
          height: widget.headerHeight,
          padding: `${widget.headerPaddingBlock}px ${widget.headerPaddingInline}px`,
        }}
      >
        <span
          className='hover:bg-dash-hover-fill'
          style={{
            ...typography(DASHBOARD_TYPOGRAPHY.widgetTitle),
            color: editing ? 'var(--dash-edit-title)' : 'var(--dash-title)',
            padding: `${widget.titlePill.paddingBlock}px ${widget.titlePill.paddingInline}px`,
            borderRadius: widget.titlePill.radius,
          }}
        >
          {title}
        </span>
        <span className='flex items-center' style={{ gap: widget.titlePill.gap }}>
          <ToolButton editing={editing} />
          <ToolButton editing={editing} />
        </span>
      </div>
      <div
        className='dash-card flex items-end justify-center gap-4'
        data-editing={editing ? 'true' : 'false'}
        style={{ height: cardHeight, padding: 16 }}
      >
        {CHART_SERIES_PALETTE.slice(0, 5).map((color, index) => (
          <span
            key={color}
            style={{ width: 16, height: 40 + index * 22, background: color, borderRadius: '2px 2px 0 0' }}
          />
        ))}
      </div>
    </div>
  );
}

function DashboardTokensSheet() {
  return (
    <div className='flex flex-col gap-8 bg-dash-card-bg p-8' style={{ minHeight: '100%' }}>
      <Section title='Widget box: View and Edit mode'>
        <div className='grid grid-cols-2' style={{ columnGap: grid.columnGap, maxWidth: 840 }}>
          <WidgetBoxMock editing={false} title='Projects by status' />
          <WidgetBoxMock editing title='Projects by status' />
        </div>
      </Section>

      <Section title='Colors'>
        <div className='grid grid-cols-4 gap-4'>
          {COLOR_VARIABLES.map((variable) => (
            <ColorSwatch key={variable} variable={variable} />
          ))}
        </div>
      </Section>

      <Section title='Shadows'>
        <div className='flex flex-wrap gap-8'>
          {SHADOW_VARIABLES.map((variable) => (
            <div className='flex flex-col items-center gap-2' key={variable}>
              <div
                className='h-16 w-28 bg-dash-card-bg'
                style={{
                  borderRadius: widget.cardRadius,
                  boxShadow: `var(${variable}), 0 0 0 1px var(--dash-card-ring)`,
                }}
              />
              <span className='font-mono text-xs text-text-secondary'>{variable}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title='Series palette and opacity steps'>
        <div className='flex flex-col gap-1'>
          {CHART_SERIES_PALETTE.map((color) => (
            <div className='flex items-center gap-1' key={color}>
              {CHART_OPACITY_STEPS.map((opacity) => (
                <span className='h-6 w-10 rounded-100' key={opacity} style={{ background: color, opacity }} />
              ))}
              <span className='ml-2 font-mono text-xs text-text-secondary'>{color}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title='Select option colors'>
        <div className='flex flex-wrap gap-2'>
          {Object.entries(CHART_OPTION_COLORS).map(([name, color]) => (
            <span className='flex items-center gap-1 text-xs text-text-secondary' key={name}>
              <span className='h-4 w-4 rounded-100' style={{ background: color }} />
              {name}
            </span>
          ))}
        </div>
      </Section>

      <Section title='Number card colors'>
        <div className='flex flex-wrap gap-6'>
          {Object.entries(CHART_NUMBER_COLOR_VARS).map(([name, color]) => (
            <span key={name} style={{ ...typography(DASHBOARD_TYPOGRAPHY.numberCaption), color }}>
              {name} 1,234
            </span>
          ))}
        </div>
      </Section>
    </div>
  );
}

function DashboardTokens({ dark }: { dark: boolean }) {
  return (
    <ThemeScope dark={dark}>
      <DashboardTokensSheet />
    </ThemeScope>
  );
}

const meta = {
  title: 'Foundations/Dashboard tokens',
  component: DashboardTokens,
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof DashboardTokens>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Light: Story = {
  args: { dark: false },
};

export const Dark: Story = {
  args: { dark: true },
};
