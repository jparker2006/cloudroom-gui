import { useId, type CSSProperties, type ReactNode } from "react";
import { cn } from "../../lib/utils";

export type CloudScene = "projects" | "threads" | "search" | "panel";
export type CloudIllustrationSize = "hero" | "panel";

const CLOUD_SMALL =
  "M12 36 A10 10 0 1 1 14 16.2 A14 14 0 0 1 41.63 12.82 A12 12 0 1 1 46 36 Z";
const CLOUD_BANK =
  "M8 20 A6 6 0 1 1 12.02 9.54 A8 8 0 0 1 26.73 4.67 A8 8 0 0 1 41.83 6.38 A7 7 0 0 1 52.84 10.49 A5 5 0 1 1 55 20 Z";

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

function BackCloud({ d, transform }: { d: string; transform: string }) {
  return (
    <g className={DRIFT} style={MOTION_STYLE}>
      <path
        d={d}
        transform={transform}
        fill="none"
        stroke="var(--cloud-line)"
        strokeWidth="1.2"
        strokeDasharray="3 3.5"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}

function Sun({ cx, cy }: { cx: number; cy: number }) {
  return <circle cx={cx} cy={cy} r="4" fill="var(--cloud-sun)" />;
}

interface LogoProps {
  src: string;
  x: number;
  y: number;
  size: number;
  clipId: string;
}

function Logo({ src, x, y, size, clipId }: LogoProps) {
  const radius = size * 0.24;
  return (
    <g className={BOB} style={MOTION_STYLE}>
      <clipPath id={clipId}>
        <rect x={x} y={y} width={size} height={size} rx={radius} />
      </clipPath>
      <image
        href={src}
        x={x}
        y={y}
        width={size}
        height={size}
        clipPath={`url(#${clipId})`}
        preserveAspectRatio="xMidYMid slice"
      />
    </g>
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
  logo,
}: {
  scene: CloudScene;
  logo: Omit<LogoProps, "x" | "y" | "size">;
}): ReactNode {
  switch (scene) {
    case "projects":
      return (
        <>
          <Sun cx={134} cy={16} />
          <BackCloud d={CLOUD_SMALL} transform="translate(104 22) scale(0.6)" />
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
          <Logo {...logo} x={54} y={6} size={52} />
          <Wind
            lines={[
              [12, 40, 14],
              [136, 58, 16],
            ]}
          />
        </>
      );
    case "threads":
      return (
        <>
          <Sun cx={146} cy={12} />
          <BackCloud d={CLOUD_BANK} transform="translate(10 60) scale(1.1)" />
          <Logo {...logo} x={80} y={16} size={52} />
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
              d="M50 10 L61 24 L50 40 L39 24 Z M50 10 V40 M39 24 H61"
              fill="none"
              stroke="var(--cloud-line)"
              strokeWidth="1.3"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>
          <Wind
            lines={[
              [62, 16, 14],
              [118, 84, 18],
            ]}
          />
        </>
      );
    case "search":
      return (
        <>
          <BackCloud
            d={CLOUD_SMALL}
            transform="translate(100 10) scale(0.72)"
          />
          <Logo {...logo} x={26} y={18} size={48} />
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
          <Wind lines={[[136, 46, 14]]} />
        </>
      );
    case "panel":
      return (
        <>
          <Sun cx={80} cy={10} />
          <Logo {...logo} x={29} y={6} size={38} />
          <Wind
            lines={[
              [4, 34, 10],
              [74, 44, 16],
            ]}
          />
        </>
      );
  }
}

export interface CloudIllustrationProps {
  scene: CloudScene;
  logoSrc: string;
  size?: CloudIllustrationSize;
  className?: string;
}

export function CloudIllustration({
  scene,
  logoSrc,
  size = "panel",
  className,
}: CloudIllustrationProps) {
  const uid = useId().replace(/:/g, "");
  return (
    <svg
      viewBox={VIEWBOX[scene]}
      aria-hidden="true"
      focusable="false"
      className={cn(
        "pointer-events-none h-auto shrink-0 select-none overflow-visible motion-safe:animate-cloud-enter",
        SIZE_CLASS[size],
        className,
      )}
    >
      <SceneArt scene={scene} logo={{ src: logoSrc, clipId: `${uid}-logo` }} />
    </svg>
  );
}
