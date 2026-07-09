export type StudioSettingsDto = {
  id: string;
  studioName: string;
  legalName: string;
  inn: string;
  ogrnip: string;
  phone: string;
  email: string;
  address: string;
  vkUrl: string;
  maxUrl: string;
  telegramUrl: string;
  whatsappUrl: string;
  workingHoursText: string;
  bookingSuccessMessage: string;
  requestSuccessMessage: string;
  gameSuccessMessage: string;
  privacyUrl: string;
  termsUrl: string;
  consentUrl: string;
  offerUrl: string;
  isOnlineBookingEnabled: boolean;
  isGameEnabled: boolean;
  isPromotionsEnabled: boolean;
  cookieBannerText: string;
  cookieDetailsUrl: string;
  createdAt: string;
  updatedAt: string;
};

export type PublicStudioSettingsDto = Pick<
  StudioSettingsDto,
  | "studioName"
  | "phone"
  | "email"
  | "address"
  | "vkUrl"
  | "maxUrl"
  | "workingHoursText"
  | "privacyUrl"
  | "termsUrl"
  | "consentUrl"
  | "offerUrl"
  | "isOnlineBookingEnabled"
  | "isGameEnabled"
  | "isPromotionsEnabled"
  | "cookieBannerText"
  | "cookieDetailsUrl"
>;

export type StudioSettingsWriteInput = Partial<
  Omit<StudioSettingsDto, "id" | "createdAt" | "updatedAt">
>;
