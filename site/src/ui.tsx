import { cva, type VariantProps } from "class-variance-authority";
import type { AnchorHTMLAttributes } from "react";

import { ANDROID_ROBOT_PATH, ANDROID_ROBOT_VIEWBOX } from "./android-robot";
import { cn } from "./lib";

// Same variants as JoyoRogo's Button (packages/ui), rendered as links.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-transparent text-[0.9375rem] font-semibold whitespace-nowrap transition-[color,background-color,border-color,box-shadow,scale,translate] duration-150 ease-(--ease-out) outline-none select-none hover:-translate-y-px focus-visible:ring-[3px] focus-visible:ring-ring/40 active:translate-y-0 active:scale-[0.97] active:duration-100 motion-reduce:transition-colors motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[1.125rem]",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        outline: "border-border bg-card text-foreground hover:bg-muted",
        secondary:
          "bg-muted text-foreground hover:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_6%)]",
        ghost: "text-foreground hover:bg-muted",
      },
      size: {
        default: "h-12 px-5",
        lg: "h-14 px-6 text-base",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function ButtonLink({
  className,
  variant,
  size,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & VariantProps<typeof buttonVariants>) {
  return <a className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

/** GitHub's mark; lucide dropped brand icons. */
export function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" className={className}>
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

/**
 * The official Android robot head as a monochrome glyph (currentColor), not the Google Play badge. Artwork, source and
 * licence terms are documented in android-robot.ts; the footer carries the required attribution (ANDROID_ROBOT_CREDIT).
 */
export function AndroidMark({ className }: { className?: string }) {
  return (
    <svg viewBox={ANDROID_ROBOT_VIEWBOX} aria-hidden="true" focusable="false" className={className}>
      <path fill="currentColor" fillRule="evenodd" d={ANDROID_ROBOT_PATH} />
    </svg>
  );
}

/** The Apple logo as a monochrome glyph (currentColor) for iPhone links, path from Simple Icons (CC0). Apple's trademark: do not reshape. */
export function AppleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={className}>
      <path
        fill="currentColor"
        d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"
      />
    </svg>
  );
}

export const ANDROID_ROBOT_CREDIT =
  "The Android robot is reproduced or modified from work created and shared by Google and used according to terms described in the Creative Commons 3.0 Attribution License.";

/** Circular progress in the style of JoyoRogo's Ring (static, no animation needed here). */
export function Ring({
  value,
  max,
  tone,
  size = 96,
  stroke = 9,
  label,
  children,
}: {
  value: number;
  max: number;
  tone: "makan" | "bakar" | "tidur";
  size?: number;
  stroke?: number;
  label: string;
  children?: React.ReactNode;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const fraction = Math.min(1, Math.max(0, value / max));
  const c = size / 2;
  const track = { makan: "stroke-makan-soft", bakar: "stroke-bakar-soft", tidur: "stroke-tidur-soft" }[tone];
  const arc = { makan: "stroke-makan", bakar: "stroke-bakar", tidur: "stroke-tidur" }[tone];
  return (
    <div
      role="img"
      aria-label={label}
      className="relative grid shrink-0 place-items-center text-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={c} cy={c} r={radius} fill="none" strokeWidth={stroke} className={track} />
        <circle
          cx={c}
          cy={c}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          className={arc}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

/**
 * Phone frame from JoyoRogo's HeroPhone, around a real app screenshot. [src]
 * is a 640 px WebP with a 480 px twin named `<name>-480.webp`; the frame is
 * 250 to 266 px wide, so most screens take the smaller file. Images load lazily
 * unless [priority] marks the one the first screen is waiting on.
 */
export function Phone({
  src,
  alt,
  className,
  priority,
}: {
  src: string;
  alt: string;
  className?: string;
  priority?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative mx-auto w-[16.5rem] rounded-[2.6rem] bg-[oklch(0.22_0.01_85)] p-[7px] shadow-float md:w-[17.5rem]",
        className,
      )}
    >
      <img
        src={src}
        srcSet={`${src.replace(/\.webp$/, "-480.webp")} 480w, ${src} 640w`}
        sizes="(min-width: 768px) 266px, 250px"
        alt={alt}
        width={640}
        height={1280}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        decoding="async"
        className="block w-full rounded-[2.2rem] bg-background"
      />
    </div>
  );
}
