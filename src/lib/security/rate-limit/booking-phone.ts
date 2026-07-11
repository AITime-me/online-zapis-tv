import { normalizePhone } from "@/lib/phone/normalize-phone";
import type { RateLimitPolicyId } from "./types";
import { enforceRateLimitFromRequest } from "./check";

export function enforceValidatedPhoneRateLimit(
  request: Request,
  policyId: RateLimitPolicyId,
  phone: string | null | undefined,
) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return null;
  }

  return enforceRateLimitFromRequest(request, policyId, [normalizedPhone]);
}
