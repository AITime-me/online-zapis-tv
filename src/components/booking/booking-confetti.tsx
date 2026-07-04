"use client";

import { useMemo } from "react";
import { bookingTheme } from "@/components/booking/booking-theme";

const CONFETTI_COLORS = [
  bookingTheme.green,
  bookingTheme.gold,
  "#f5f0e8",
  bookingTheme.greenMuted,
  bookingTheme.goldMuted,
] as const;

const PARTICLE_COUNT = 32;

type Particle = {
  id: number;
  left: number;
  delay: number;
  duration: number;
  size: number;
  color: string;
  drift: number;
};

export function BookingConfetti() {
  const particles = useMemo<Particle[]>(() => {
    return Array.from({ length: PARTICLE_COUNT }, (_, id) => ({
      id,
      left: Math.random() * 100,
      delay: Math.random() * 0.6,
      duration: 2.4 + Math.random() * 1.8,
      size: 5 + Math.random() * 7,
      color: CONFETTI_COLORS[id % CONFETTI_COLORS.length]!,
      drift: -30 + Math.random() * 60,
    }));
  }, []);

  return (
    <div
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
      aria-hidden
    >
      {particles.map((particle) => (
        <span
          key={particle.id}
          className="booking-confetti-particle absolute top-0 rounded-sm"
          style={{
            left: `${particle.left}%`,
            width: particle.size,
            height: particle.size * 0.65,
            backgroundColor: particle.color,
            animationDelay: `${particle.delay}s`,
            animationDuration: `${particle.duration}s`,
            ["--drift" as string]: `${particle.drift}px`,
          }}
        />
      ))}
    </div>
  );
}
