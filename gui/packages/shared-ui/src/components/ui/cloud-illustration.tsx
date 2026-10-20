import {
  createContext,
  useContext,
  useId,
  type CSSProperties,
  type ReactNode,
} from "react";
import { cn } from "../../lib/utils";

export type CloudScene = "projects" | "threads" | "search" | "panel";
export type CloudIllustrationSize = "hero" | "panel";
export type CloudIllustrationVariant = "cumulus" | "contour";

const CLOUD_MAIN =
  "M18 56 A16 16 0 1 1 20.09 24.14 A20 20 0 0 1 48.94 8.11 A22 22 0 0 1 87.86 24.47 A16 16 0 0 1 84 56 Z";
const CLOUD_SMALL =
  "M12 36 A10 10 0 1 1 14 16.2 A14 14 0 0 1 41.63 12.82 A12 12 0 1 1 46 36 Z";
const CLOUD_BANK =
  "M8 20 A6 6 0 1 1 12.02 9.54 A8 8 0 0 1 26.73 4.67 A8 8 0 0 1 41.83 6.38 A7 7 0 0 1 52.84 10.49 A5 5 0 1 1 55 20 Z";

export const CloudIllustrationVariantContext =
  createContext<CloudIllustrationVariant>("cumulus");

const DRIFT = "motion-safe:animate-cloud-drift";
const BOB = "motion-safe:animate-cloud-bob";
const SWAY = "motion-safe:animate-cloud-sway";
const WIND = "motion-safe:animate-cloud-wind";

const SIZE_CLASS: Record<CloudIllustrationSize, string> = {
  hero: "w-48 sm:w-60",
  panel: "w-28 sm:w-32",
};

const VIEWBOX: Record<CloudScene, string> = {
  projects: "0 0 160 96",
  threads: "0 0 160 96",
  search: "0 0 160 96",
  panel: "0 0 96 56",
};

const MOTION_STYLE = { transformBox: "fill-box" } as CSSProperties;

interface CloudProps {
  d: string;
  transform: string;
  variant: CloudIllustrationVariant;
  depth: "front" | "back";
  shadeId?: string;
}

function Cloud({ d, transform, variant, depth, shadeId }: CloudProps) {
  if (variant === "contour") {
    return (
      <path
        d={d}
        transform={transform}
        fill="none"
        stroke="var(--cloud-line)"
        strokeWidth={depth === "front" ? 1.6 : 1.2}
        strokeDasharray={depth === "back" ? "3 3.5" : undefined}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    );
  }
  if (depth === "back") {
    return <path d={d} transform={transform} fill="var(--cloud-back)" />;
  }
  return (
    <g transform={transform}>
      {shadeId ? (
        <linearGradient id={shadeId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.35" style={{ stopColor: "var(--cloud-front)" }} />
          <stop offset="1" style={{ stopColor: "var(--cloud-shade)" }} />
        </linearGradient>
      ) : null}
      <path
        d={d}
        fill={shadeId ? `url(#${shadeId})` : "var(--cloud-front)"}
        stroke="var(--cloud-edge)"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}

function Sun({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <circle
      cx={cx}
      cy={cy}
      r={r}
      fill="var(--cloud-sun)"
      stroke="var(--cloud-sun-edge)"
      strokeWidth="1"
      vectorEffect="non-scaling-stroke"
    />
  );
}

function Wind({ lines }: { lines: readonly [number, number, number][] }) {
  return (
    <g
      stroke="var(--cloud-line)"
      strokeWidth="1.4"
      strokeLinecap="round"
      fill="none"
    >
      {lines.map(([x, y, length], index) => (
        <path
          key={`${x}-${y}`}
          d={`M${x} ${y} h${length}`}
          strokeDasharray="7 5"
          className={WIND}
          style={{ animationDelay: `${index * -1.3}s` }}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
}

function SceneArt({
  scene,
  variant,
  uid,
}: {
  scene: CloudScene;
  variant: CloudIllustrationVariant;
  uid: string;
}): ReactNode {
  const contour = variant === "contour";
  const shade = `${uid}-shade`;
  switch (scene) {
    case "projects":
      return (
        <>
          <Sun cx={122} cy={24} r={contour ? 7 : 9} />
          <g className={DRIFT} style={MOTION_STYLE}>
            <Cloud
              d={CLOUD_SMALL}
              transform={
                contour
                  ? "translate(114 20) scale(0.72)"
                  : "translate(96 18) scale(0.82)"
              }
              variant={variant}
              depth="back"
            />
          </g>
          <rect
            x="44"
            y="70"
            width="72"
            height="18"
            rx="5"
            fill="none"
            stroke="var(--cloud-line)"
            strokeWidth="1.2"
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
          />
          <g className={BOB} style={MOTION_STYLE}>
            <Cloud
              d={CLOUD_MAIN}
              transform="translate(32 14) scale(0.8)"
              variant={variant}
              depth="front"
              shadeId={shade}
            />
          </g>
          {contour ? (
            <Wind
              lines={[
                [12, 40, 14],
                [136, 58, 16],
              ]}
            />
          ) : null}
        </>
      );
    case "threads":
      return (
        <>
          <g className={DRIFT} style={MOTION_STYLE}>
            <Cloud
              d={CLOUD_BANK}
              transform="translate(10 60) scale(1.1)"
              variant={variant}
              depth="back"
            />
          </g>
          <g className={BOB} style={MOTION_STYLE}>
            <Cloud
              d={CLOUD_MAIN}
              transform="translate(74 30) scale(0.7)"
              variant={variant}
              depth="front"
              shadeId={shade}
            />
          </g>
          <path
            d="M50 40 C44 52 60 60 46 72 S34 84 30 92"
            fill="none"
            stroke="var(--cloud-line)"
            strokeWidth="1.3"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          <g
            className={SWAY}
            style={{ ...MOTION_STYLE, transformOrigin: "50% 100%" }}
          >
            <path
              d="M50 10 L61 24 L50 40 L39 24 Z"
              fill={contour ? "none" : "var(--cloud-sun)"}
              stroke={contour ? "var(--cloud-line)" : "var(--cloud-sun-edge)"}
              strokeWidth="1.3"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d="M50 10 V40 M39 24 H61"
              stroke={contour ? "var(--cloud-line)" : "var(--cloud-sun-edge)"}
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          </g>
          {contour ? (
            <>
              <circle cx="134" cy="18" r="4" fill="var(--cloud-sun)" />
              <Wind
                lines={[
                  [66, 16, 14],
                  [118, 84, 18],
                ]}
              />
            </>
          ) : null}
        </>
      );
    case "search":
      return (
        <>
          <g className={DRIFT} style={MOTION_STYLE}>
            <Cloud
              d={CLOUD_SMALL}
              transform="translate(100 10) scale(0.72)"
              variant={variant}
              depth="back"
            />
          </g>
          <g className={BOB} style={MOTION_STYLE}>
            <Cloud
              d={CLOUD_MAIN}
              transform="translate(18 26) scale(0.8)"
              variant={variant}
              depth="front"
              shadeId={shade}
            />
          </g>
          <circle
            cx="100"
            cy="60"
            r="17"
            fill="var(--cloud-lens)"
            stroke="var(--cloud-ink)"
            strokeWidth="2.4"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d="M88 64 h24"
            stroke="var(--cloud-line)"
            strokeWidth="1.2"
            strokeDasharray="2 3"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d="M112.5 72.5 L126 86"
            stroke="var(--cloud-ink)"
            strokeWidth="5"
            strokeLinecap="round"
          />
          {contour ? <Wind lines={[[136, 46, 14]]} /> : null}
        </>
      );
    case "panel":
      return (
        <>
          {contour ? (
            <circle cx="76" cy="12" r="4" fill="var(--cloud-sun)" />
          ) : (
            <Sun cx={74} cy={14} r={6} />
          )}
          <g className={BOB} style={MOTION_STYLE}>
            <Cloud
              d={CLOUD_SMALL}
              transform="translate(18 12)"
              variant={variant}
              depth="front"
              shadeId={shade}
            />
          </g>
          {contour ? (
            <Wind
              lines={[
                [4, 34, 10],
                [72, 44, 16],
              ]}
            />
          ) : null}
        </>
      );
  }
}

export interface CloudIllustrationProps {
  scene: CloudScene;
  size?: CloudIllustrationSize;
  variant?: CloudIllustrationVariant;
  className?: string;
}

export function CloudIllustration({
  scene,
  size = "panel",
  variant: variantProp,
  className,
}: CloudIllustrationProps) {
  const contextVariant = useContext(CloudIllustrationVariantContext);
  const variant = variantProp ?? contextVariant;
  const uid = useId().replace(/:/g, "");
  return (
    <svg
      viewBox={VIEWBOX[scene]}
      aria-hidden="true"
      focusable="false"
      data-cloud-illustration={variant}
      className={cn(
        "pointer-events-none h-auto shrink-0 select-none overflow-visible motion-safe:animate-cloud-enter",
        SIZE_CLASS[size],
        className,
      )}
    >
      <SceneArt scene={scene} variant={variant} uid={uid} />
    </svg>
  );
}
