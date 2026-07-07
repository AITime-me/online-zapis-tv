import { USERS_ADMIN_ROLES } from "@/lib/auth/api-access";
import { createOwnerAdminApiHandler } from "@/lib/auth/owner-admin-api";

export const dynamic = "force-dynamic";

export const GET = createOwnerAdminApiHandler(USERS_ADMIN_ROLES);
