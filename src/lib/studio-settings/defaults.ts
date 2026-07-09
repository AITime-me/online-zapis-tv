export const STUDIO_SETTINGS_ID = "default" as const;

export const DEFAULT_REQUEST_SUCCESS_MESSAGE =
  "Спасибо! Заявка отправлена. Менеджер студии свяжется с вами, чтобы уточнить детали и помочь с записью.";

export const DEFAULT_COOKIE_BANNER_TEXT =
  "Мы используем cookie, чтобы сайт работал корректно и становился удобнее. Продолжая пользоваться сайтом, вы соглашаетесь с использованием cookie.";

export const DEFAULT_STUDIO_SETTINGS = {
  id: STUDIO_SETTINGS_ID,
  studioName: "Твоё время",
  legalName: "ИП Кузнецова Светлана Викторовна",
  inn: "450144605881",
  ogrnip: "324450000034680",
  phone: "8 912 979-30-90",
  email: "ipku82@bk.ru",
  address: "г. Курган, ул. Володарского, 30",
  vkUrl: "https://vk.me/tvoiovremya",
  maxUrl: "https://web.max.ru/267619155",
  telegramUrl: "",
  whatsappUrl: "",
  workingHoursText: "",
  bookingSuccessMessage: DEFAULT_REQUEST_SUCCESS_MESSAGE,
  requestSuccessMessage: DEFAULT_REQUEST_SUCCESS_MESSAGE,
  gameSuccessMessage: DEFAULT_REQUEST_SUCCESS_MESSAGE,
  privacyUrl: "/privacy",
  termsUrl: "/terms",
  consentUrl: "/consent",
  offerUrl: "/offer",
  isOnlineBookingEnabled: true,
  isGameEnabled: true,
  isPromotionsEnabled: true,
  cookieBannerText: DEFAULT_COOKIE_BANNER_TEXT,
  cookieDetailsUrl: "/cookies",
} as const;
