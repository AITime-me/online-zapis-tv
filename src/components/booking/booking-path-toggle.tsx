import { BookingButton } from "@/components/booking/booking-ui";
import type { CSSProperties } from "react";

export type BookingPathMode = "by-service" | "by-master";

type BookingPathToggleProps = {
  value: BookingPathMode;
  onChange: (mode: BookingPathMode) => void;
};

export function BookingPathToggle({ value, onChange }: BookingPathToggleProps) {
  const options: { id: BookingPathMode; label: string }[] = [
    { id: "by-service", label: "Выбрать услугу" },
    { id: "by-master", label: "Выбрать мастера" },
  ];

  return (
    <div
      className="booking-path-toggle grid grid-cols-1 gap-2 sm:grid-cols-2"
      role="tablist"
      aria-label="Способ записи"
    >
      {options.map((option, index) => {
        const isActive = value === option.id;
        return (
          <BookingButton
            key={option.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            variant={isActive ? "primary" : "secondary"}
            onClick={() => onChange(option.id)}
            className={`w-full`}
            style={{ "--sway-delay": `${index * 0.35}s` } as CSSProperties}
          >
            {option.label}
          </BookingButton>
        );
      })}
    </div>
  );
}
