/** Контакты студии для клиентской зоны (можно переопределить через env). */
export const bookingStudio = {
  name: "Твоё время",
  phone: process.env.NEXT_PUBLIC_STUDIO_PHONE ?? "+79129793090",
  phoneDisplay:
    process.env.NEXT_PUBLIC_STUDIO_PHONE_DISPLAY ?? "+7 (912) 979-30-90",
  address: "Курган, ул. Володарского, 30",
} as const;

export const bookingStudioTelHref = `tel:${bookingStudio.phone.replace(/\D/g, "")}`;
