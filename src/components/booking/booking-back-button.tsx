"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { bookingTheme } from "@/components/booking/booking-theme";

type BookingBackButtonProps = {
  children: ReactNode;
} & Pick<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "className" | "type">;

function BackChevronIcon() {
  return (
    <svg
      aria-hidden
      className="h-5 w-5 shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  );
}

export function BookingBackButton({
  children,
  onClick,
  className = "",
  type = "button",
}: BookingBackButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      className={`inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl border-2 px-4 py-2.5 text-sm font-semibold transition hover:bg-[#f0ebe3] active:scale-[0.98] active:bg-[#e8e2d8] sm:min-h-[48px] sm:px-5 sm:text-base ${className}`}
      style={{
        color: bookingTheme.green,
        borderColor: bookingTheme.gold,
        backgroundColor: bookingTheme.surface,
      }}
    >
      <BackChevronIcon />
      <span>{children}</span>
    </button>
  );
}
