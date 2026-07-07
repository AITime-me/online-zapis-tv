import { SYSTEM_SETTINGS_ADMIN_ROLES } from "@/lib/auth/api-access";
import { createOwnerAdminApiHandler } from "@/lib/auth/owner-admin-api";

export const dynamic = "force-dynamic";

export const GET = createOwnerAdminApiHandler(SYSTEM_SETTINGS_ADMIN_ROLES);
