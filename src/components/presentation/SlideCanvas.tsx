import { CSSProperties } from 'react';

import { buildSlideScene, SLIDE_HEIGHT, SLIDE_WIDTH } from './slide-scene';
import { PresentationStyle, Slide } from './types';

export default function SlideCanvas({
  slide,
  style,
  index = 0,
  total = 1,
  miniature = false,
}: {
  slide: Slide;
  style: PresentationStyle;
  index?: number;
  total?: number;
  miniature?: boolean;
}) {
  const scene = buildSlideScene(slide, style, index, total);

  return (
    <div
      className={`ps-slide ps-scene ${miniature ? 'ps-miniature' : ''}`}
      style={{ background: scene.background, fontFamily: `${scene.font}, sans-serif` }}
    >
      {scene.elements.map((element, i) => {
        const box: CSSProperties = {
          position: 'absolute',
          left: `${(element.x / SLIDE_WIDTH) * 100}%`,
          top: `${(element.y / SLIDE_HEIGHT) * 100}%`,
          width: `${(element.w / SLIDE_WIDTH) * 100}%`,
          height: `${(element.h / SLIDE_HEIGHT) * 100}%`,
          margin: 0,
        };

        if (element.type === 'text') {
          const Tag = element.title ? 'h2' : 'p';

          return (
            <Tag
              key={i}
              style={{
                ...box,
                color: element.color,
                fontFamily: `${element.font || scene.font}, sans-serif`,
                fontSize: `${element.size / 9.6}cqw`,
                fontWeight: element.bold ? 700 : 400,
                lineHeight: 1.2,
                letterSpacing: 0,
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                maxWidth: 'none',
              }}
            >
              {element.text}
            </Tag>
          );
        }

        if (element.type === 'shape')
          return (
            <div
              key={i}
              aria-hidden='true'
              style={{
                ...box,
                background: element.color,
                borderRadius: element.shape === 'ellipse' ? '50%' : element.shape === 'roundRect' ? '1cqw' : 0,
                clipPath:
                  element.shape === 'chevron' ? 'polygon(0 0, 75% 0, 100% 50%, 75% 100%, 0 100%, 25% 50%)' : undefined,
                minHeight: element.shape === 'line' ? 1 : undefined,
              }}
            />
          );
        if (element.type === 'image')
          return <img key={i} alt='Company logo' src={element.data} style={{ ...box, objectFit: 'contain' }} />;
        if (element.type === 'table')
          return (
            <table
              key={i}
              style={{
                ...box,
                color: element.color,
                fontFamily: `${scene.font}, sans-serif`,
                fontSize: '1.25cqw',
                tableLayout: 'fixed',
                borderCollapse: 'collapse',
              }}
            >
              <thead>
                <tr>
                  {element.columns.map((cell, j) => (
                    <th key={j} style={{ border: '1px solid #cad2df', padding: '.6cqw' }}>
                      {cell}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {element.rows.map((row, j) => (
                  <tr key={j}>
                    {row.map((cell, k) => (
                      <td key={k} style={{ border: '1px solid #cad2df', padding: '.6cqw' }}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          );
        const max = Math.max(1, ...element.items.map((item) => item.value));

        return (
          <div
            key={i}
            role='img'
            aria-label={`${element.unit}: ${element.items.map((item) => `${item.label} ${item.value}`).join(', ')}`}
            style={{ ...box, display: 'flex', gap: '2cqw', alignItems: 'end', fontSize: '1.1cqw' }}
          >
            {element.items.map((item, j) => (
              <div
                key={j}
                style={{
                  flex: 1,
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'end',
                  textAlign: 'center',
                }}
              >
                <span>
                  {item.value} {element.unit}
                </span>
                <div style={{ background: element.color, height: `${(item.value / max) * 70}%`, minHeight: 1 }} />
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
