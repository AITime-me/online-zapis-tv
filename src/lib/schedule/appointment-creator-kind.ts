/**
 * Pure creator-kind helpers (no Prisma / server-only).
 * Used by admin appointment create — never trust client body.
 */
import type { UserRole } from "@prisma/client";

export const APPOINTMENT_CREATOR_KINDS = [
  "SELF_SERVICE",
  "TEYA",
  "MANAGER",
  "MASTER",
  "OTHER",
] as const;

export type AppointmentCreatorKindName =
  (typeof APPOINTMENT_CREATOR_KINDS)[number];

/**
 * Derive creator provenance for admin schedule writes from authenticated role.
 */
export function creatorKindFromAuthenticatedRole(
  role: UserRole,
): AppointmentCreatorKindName {
  if (role === "MASTER") {
    return "MASTER";
  }
  if (role === "OWNER" || role === "MANAGER") {
    return "MANAGER";
  }
  return "OTHER";
}
