import { Link } from "react-router-dom";

type Props = {
  /** Pass `null` for a static mark (no link). Default links to /projects. */
  to?: string | null;
  compact?: boolean;
  /** Light wordmark on a black surface. */
  inverted?: boolean;
  subtitle?: string;
  className?: string;
};

/** Dotted chevron — drawn, not an image. */
function Mark({ size = 28 }: { size?: number }) {
  const dots: Array<[number, number, number]> = [
    [3, 6, 1.15],
    [3, 14, 1.45],
    [3, 22, 1.15],
    [9, 9, 1.55],
    [9, 19, 1.55],
    [15, 12, 1.85],
    [15, 16, 1.85],
    [21, 14, 2.15],
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 26 28" aria-hidden className="shrink-0">
      {dots.map(([cx, cy, r], i) => (
        <circle key={i} cx={cx} cy={cy} r={r} fill="#FF5A00" />
      ))}
    </svg>
  );
}

/** Terrix AI wordmark. SVG mark + text, no image file. */
export function BrandMark({ to, compact = false, inverted = false, subtitle, className = "" }: Props) {
  const href = to === null ? null : to ?? "/projects";
  const name = inverted ? "text-white" : "text-[#0A0A0A]";
  const sub = inverted ? "text-zinc-400" : "text-[#71717A]";

  const inner = (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Mark size={compact ? 26 : 32} />
      <span className="min-w-0 leading-tight">
        <span className={`block font-display font-semibold tracking-tight ${compact ? "text-[15px]" : "text-lg"} ${name}`}>
          Terrix <span className="text-[#FF5A00]">AI</span>
        </span>
        {subtitle ? <span className={`block text-[11px] ${sub}`}>{subtitle}</span> : null}
      </span>
    </span>
  );

  if (!href) return inner;
  return (
    <Link to={href} className="inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A00]/50">
      {inner}
    </Link>
  );
}
