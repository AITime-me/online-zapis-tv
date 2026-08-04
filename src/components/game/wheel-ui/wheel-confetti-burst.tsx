import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "./wheel-ui.utils";

const COLORS = [
  "#0F2F2A",
  "#123B2D",
  "#C6A15B",
  "#A9823B",
  "#D6C09A",
  "#E8DCC7",
  "#F4EFE6",
] as const;

const SHAPES = ["rect", "rect", "rect", "circle", "heart"] as const;

type ParticleShape = (typeof SHAPES)[number];

type Particle = {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  opacity: number;
  shape: ParticleShape;
};

export type WheelConfettiBurstProps = {
  /** Запускает салют при переходе в true. Повторный true без сброса не запускает второй раз. */
  active: boolean;
  durationMs?: number;
  className?: string;
};

function createParticle(w: number, h: number): Particle {
  const fromSide = Math.random() < 0.22;
  const x = fromSide
    ? Math.random() < 0.5
      ? -8 + Math.random() * 24
      : w - 16 + Math.random() * 24
    : Math.random() * w;

  return {
    x,
    y: -12 - Math.random() * h * 0.28,
    w: 4 + Math.random() * 5,
    h: 5 + Math.random() * 7,
    color: COLORS[Math.floor(Math.random() * COLORS.length)] ?? COLORS[0],
    vx: (Math.random() - 0.5) * 2.4,
    vy: 1.8 + Math.random() * 2.8,
    rot: Math.random() * Math.PI * 2,
    vr: (Math.random() - 0.5) * 0.12,
    opacity: 0.65 + Math.random() * 0.35,
    shape: SHAPES[Math.floor(Math.random() * SHAPES.length)] ?? "rect",
  };
}

function drawHeart(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  rot: number,
  color: string,
  alpha: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  const s = size * 0.45;
  ctx.beginPath();
  ctx.moveTo(0, s * 0.35);
  ctx.bezierCurveTo(0, 0, -s, 0, -s, s * 0.35);
  ctx.bezierCurveTo(-s, s * 0.75, 0, s, 0, s * 1.25);
  ctx.bezierCurveTo(0, s, s, s * 0.75, s, s * 0.35);
  ctx.bezierCurveTo(s, 0, 0, 0, 0, s * 0.35);
  ctx.fill();
  ctx.restore();
}

function drawParticle(ctx: CanvasRenderingContext2D, p: Particle) {
  ctx.save();
  ctx.globalAlpha = p.opacity;

  if (p.shape === "heart") {
    drawHeart(ctx, p.x, p.y, p.w, p.rot, p.color, p.opacity);
  } else if (p.shape === "circle") {
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.w * 0.45, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = p.color;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
  }

  ctx.restore();
}

/**
 * Праздничный canvas-салют для экрана результата.
 * Не зависит от mock/API и не выбирает приз.
 */
export function WheelConfettiBurst({
  active,
  durationMs = 2800,
  className = "",
}: WheelConfettiBurstProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const wasActiveRef = useRef(false);
  const particlesRef = useRef<Particle[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const stop = () => {
      runningRef.current = false;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      particlesRef.current = [];
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.dataset.confettiState = "idle";
    };

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const nextW = Math.max(1, Math.floor(rect.width));
      const nextH = Math.max(1, Math.floor(rect.height));
      if (canvas.width !== nextW || canvas.height !== nextH) {
        canvas.width = nextW;
        canvas.height = nextH;
      }
    };

    const burst = () => {
      if (prefersReducedMotion()) {
        stop();
        canvas.dataset.confettiState = "reduced";
        return;
      }

      stop();
      resize();

      const w = canvas.width;
      const h = canvas.height;
      const count = Math.min(50, Math.max(28, Math.floor(w / 7)));
      particlesRef.current = Array.from({ length: count }, () =>
        createParticle(w, h),
      );

      runningRef.current = true;
      canvas.dataset.confettiState = "running";
      const start = performance.now();

      const frame = (now: number) => {
        if (!runningRef.current) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const elapsed = now - start;
        const fadeStart = durationMs * 0.5;
        const particles = particlesRef.current;

        for (let j = particles.length - 1; j >= 0; j -= 1) {
          const p = particles[j];
          if (!p) continue;

          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.035;
          p.rot += p.vr;

          if (elapsed > fadeStart) {
            p.opacity -= 0.016;
          }

          if (p.opacity <= 0 || p.y > canvas.height + 24) {
            particles.splice(j, 1);
            continue;
          }

          drawParticle(ctx, p);
        }

        if (elapsed < durationMs && particles.length > 0) {
          rafRef.current = requestAnimationFrame(frame);
        } else {
          stop();
          canvas.dataset.confettiState = "done";
        }
      };

      rafRef.current = requestAnimationFrame(frame);
    };

    resize();

    const risingEdge = active && !wasActiveRef.current;
    wasActiveRef.current = active;

    if (!active) {
      stop();
    } else if (risingEdge) {
      burst();
    }

    const parent = canvas.parentElement;
    const observer =
      typeof ResizeObserver !== "undefined" && parent
        ? new ResizeObserver(() => {
            if (!runningRef.current) {
              resize();
            }
          })
        : null;

    if (observer && parent) {
      observer.observe(parent);
    }

    return () => {
      observer?.disconnect();
      stop();
      // Позволяет StrictMode remount и новый mounting снова поймать rising edge.
      wasActiveRef.current = false;
    };
  }, [active, durationMs]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      data-testid="wheel-confetti-canvas"
      data-confetti-state="idle"
      className={[
        "pointer-events-none absolute inset-0 z-[5] h-full w-full",
        className,
      ].join(" ")}
    />
  );
}
