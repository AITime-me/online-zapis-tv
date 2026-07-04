import { bookingTheme } from "@/components/booking/booking-theme";

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
      className="grid grid-cols-1 gap-2 sm:grid-cols-2"
      role="tablist"
      aria-label="Способ записи"
    >
      {options.map((option) => {
        const isActive = value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(option.id)}
            className="min-h-12 rounded-2xl border px-4 py-3.5 text-base font-medium transition active:scale-[0.99]"
            style={
              isActive
                ? {
                    borderColor: bookingTheme.green,
                    backgroundColor: bookingTheme.green,
                    color: "#ffffff",
                  }
                : {
                    borderColor: bookingTheme.border,
                    backgroundColor: bookingTheme.surface,
                    color: bookingTheme.green,
                  }
            }
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
