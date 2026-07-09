import { CookieConsentBanner } from "@/components/legal/cookie-consent-banner";

export function PublicSiteChrome({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <CookieConsentBanner />
    </>
  );
}
