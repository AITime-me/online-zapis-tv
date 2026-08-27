import {
  appendCampaignUtmParams,
  assertNoPiiInUrl,
  assertSafeCommCtaLink,
} from "@/lib/communications/cta-link-policy";
import {
  generateOpaqueToken,
  hashOpaqueToken,
} from "@/lib/security/opaque-token";

export const COMM_REDIRECT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function generateOpaqueRedirectToken(): string {
  return generateOpaqueToken();
}

export function hashRedirectToken(token: string): string {
  return hashOpaqueToken(token);
}

export function buildTrackedRedirectTarget(input: {
  targetUrl: string;
  campaignSlug: string;
  buttonKey: string;
  utmSource?: string;
  utmMedium?: string;
}): string {
  const withUtm = appendCampaignUtmParams(input.targetUrl, {
    campaignSlug: input.campaignSlug,
    buttonKey: input.buttonKey,
    utmSource: input.utmSource,
    utmMedium: input.utmMedium,
  });
  assertNoPiiInUrl(withUtm);
  assertSafeCommCtaLink(withUtm);
  return withUtm;
}

export function buildPublicRedirectPath(token: string): string {
  return `/r/${token}`;
}
