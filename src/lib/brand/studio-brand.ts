import { bookingTheme } from "@/components/booking/booking-theme";

/** Общие брендовые токены студии для главной и онлайн-записи. */
export const studioBrand = {
  ...bookingTheme,
  cream: "#f7f3ec",
  creamDeep: "#f0ebe3",
  creamWarm: "#faf7f2",
  ink: "#35443e",
  inkMuted: "#66706a",
  goldLine: "rgba(201, 169, 106, 0.44)",
  goldLineSoft: "rgba(201, 169, 106, 0.24)",
  shadowSoft: "0 16px 42px rgba(18, 64, 50, 0.08)",
  shadowLift: "0 22px 54px rgba(18, 64, 50, 0.12)",
} as const;
