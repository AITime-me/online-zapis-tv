"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { BookingButton } from "@/components/booking/booking-ui";

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
    <BookingButton
      type={type}
      variant="secondary"
      onClick={onClick}
      className={`min-h-11 gap-2 px-4 py-2.5 text-sm sm:px-5 sm:text-base ${className}`}
    >
      <BackChevronIcon />
      <span>{children}</span>
    </BookingButton>
  );
}
