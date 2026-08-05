/**
 * The ICP radar, ported from the cockpit.
 *
 * Four factors on a 0–10 scale: industry fit, signal strength, role relevance,
 * company fit. Bars would show the same numbers, but the radar is what the
 * cockpit used and it reads differently — the SHAPE is the signal. A lopsided
 * quadrilateral (10/10 on funding, 6 on role) says "the money is there but we
 * have not found the right person", which is a different next action from a
 * small-but-even shape. Four bars make you compute that; the outline shows it.
 *
 * Hand-drawn SVG rather than a chart library: four axes with a fixed domain is
 * not worth a dependency, and this way it inherits the theme's colours instead
 * of fighting a library's palette.
 */
const ORDER = [
  "industry_fit",
  "signal_strength",
  "role_relevance",
  "company_fit",
] as const;

const LABEL: Record<string, string> = {
  industry_fit: "Industry fit",
  signal_strength: "Signal",
  role_relevance: "Role",
  company_fit: "Company fit",
};

const SIZE = 220;
const CENTER = SIZE / 2;
const RADIUS = 74;
const MAX = 10;

/** Axis i, at `value`/10 of the way out. Starts at 12 o'clock and goes clockwise. */
function point(index: number, value: number, count: number) {
  const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
  const r = (Math.max(0, Math.min(MAX, value)) / MAX) * RADIUS;
  return [CENTER + r * Math.cos(angle), CENTER + r * Math.sin(angle)] as const;
}

export function IcpRadar({ swot }: { swot: Record<string, number> }) {
  // Fixed axis order, not Object.keys — the shape has to mean the same thing
  // across two leads, and object key order is not a contract.
  const axes = ORDER.filter((k) => k in swot);
  if (axes.length < 3) return null;

  const n = axes.length;
  const shape = axes
    .map((k, i) => point(i, swot[k] ?? 0, n).join(","))
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="h-56 w-56"
      role="img"
      aria-label={axes.map((k) => `${LABEL[k]} ${swot[k]}`).join(", ")}
    >
      <title>ICP factor scores</title>

      {/* Rings at 2.5 / 5 / 7.5 / 10, so a score can be read off the plot. */}
      {[0.25, 0.5, 0.75, 1].map((frac) => (
        <polygon
          key={frac}
          points={axes
            .map((_, i) => point(i, MAX * frac, n).join(","))
            .join(" ")}
          className="fill-none stroke-border"
          strokeWidth={1}
        />
      ))}

      {axes.map((k, i) => {
        const [x, y] = point(i, MAX, n);
        return (
          <line
            key={k}
            x1={CENTER}
            y1={CENTER}
            x2={x}
            y2={y}
            className="stroke-border"
            strokeWidth={1}
          />
        );
      })}

      <polygon
        points={shape}
        className="fill-primary/25 stroke-primary"
        strokeWidth={2}
      />

      {axes.map((k, i) => {
        const [x, y] = point(i, MAX + 2.6, n);
        return (
          <text
            key={k}
            x={x}
            y={y}
            textAnchor={
              Math.abs(x - CENTER) < 6 ? "middle" : x > CENTER ? "start" : "end"
            }
            dominantBaseline="middle"
            className="fill-muted-foreground text-[9px]"
          >
            {LABEL[k] ?? k} {swot[k]}
          </text>
        );
      })}
    </svg>
  );
}

export default IcpRadar;
