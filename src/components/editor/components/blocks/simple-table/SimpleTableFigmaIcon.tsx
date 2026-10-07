import { useId } from 'react';

/** Keeps opaque Figma export backgrounds out of the themed icon foreground. */
export function SimpleTableFigmaIcon({
  source,
  inkLuminance,
  backgroundLuminance = 1,
  className,
}: {
  source: string;
  inkLuminance: number;
  backgroundLuminance?: number;
  className: string;
}) {
  const filterId = useId();
  const contrast = backgroundLuminance - inkLuminance;
  const values = `0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${-0.2126 / contrast} ${-0.7152 / contrast} ${-0.0722 / contrast} 0 ${backgroundLuminance / contrast}`;

  return (
    <span className={`${className} simple-table-image-icon`} aria-hidden="true">
      <svg width="0" height="0" className="absolute" focusable="false">
        <defs>
          <filter id={filterId} colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
            <feColorMatrix type="matrix" values={values} result="foreground" />
            <feFlood floodColor="currentColor" />
            <feComposite in2="foreground" operator="in" />
          </filter>
        </defs>
      </svg>
      <img src={source} width="16" height="16" alt="" style={{ filter: `url("#${filterId}")` }} />
    </span>
  );
}
