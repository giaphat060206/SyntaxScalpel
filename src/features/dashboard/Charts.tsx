export interface Slice {
  label: string;
  share: number;
  color: string;
}

export interface Bar {
  label: string;
  value: number;
  display: string;
  color: string;
}

export interface Part {
  label: string;
  value: number;
  color: string;
}

const RADIUS = 42;
const STROKE = 14;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * A donut drawn as stroke dashes on one circle: each slice is an arc whose length
 * is its share and whose offset is everything before it. No charting library, and
 * the aria-label repeats the numbers the arcs encode, so a test can assert the
 * drawing without reading pixels.
 */
export function Donut({ slices, label }: { slices: Slice[]; label: string }) {
  let offset = 0;
  const arcs = slices.map((slice) => {
    const length = clamp(slice.share) * CIRCUMFERENCE;
    const arc = { ...slice, length, offset };
    offset += length;
    return arc;
  });

  return (
    <svg viewBox="0 0 100 100" role="img" aria-label={label} className="h-40 w-40 shrink-0">
      <g transform="rotate(-90 50 50)">
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={STROKE}
        />
        {arcs.map((arc) => (
          <circle
            key={arc.label}
            cx="50"
            cy="50"
            r={RADIUS}
            fill="none"
            stroke={arc.color}
            strokeWidth={STROKE}
            strokeDasharray={`${arc.length} ${CIRCUMFERENCE - arc.length}`}
            strokeDashoffset={-arc.offset}
          />
        ))}
      </g>
    </svg>
  );
}

/** Horizontal bars, scaled to the largest value so the widest bar fills the row. */
export function Bars({ items, max, label }: { items: Bar[]; max: number; label: string }) {
  return (
    <ul role="img" aria-label={label} className="m-0 list-none space-y-1.5 p-0">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2 text-xs">
          <span className="w-36 shrink-0 break-all text-white/80" title={item.label}>
            {item.label}
          </span>
          <svg className="h-2.5 min-w-0 flex-1" role="presentation">
            <rect x="0" y="0" width="100%" height="100%" rx="2" fill="rgba(255,255,255,0.06)" />
            <rect
              x="0"
              y="0"
              width={`${max > 0 ? clamp(item.value / max) * 100 : 0}%`}
              height="100%"
              rx="2"
              fill={item.color}
            />
          </svg>
          <span className="w-16 shrink-0 text-right text-dimmed">{item.display}</span>
        </li>
      ))}
    </ul>
  );
}

/** One stacked bar for a whole that has two or three parts. */
export function Split({ parts, label }: { parts: Part[]; label: string }) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  let x = 0;

  return (
    <svg
      viewBox="0 0 100 6"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className="h-2 w-full"
    >
      {parts.map((part) => {
        const width = total > 0 ? (part.value / total) * 100 : 0;
        const rect = (
          <rect key={part.label} x={x} y="0" width={width} height="6" fill={part.color} />
        );
        x += width;
        return rect;
      })}
    </svg>
  );
}
