# Bot LIVE business facts — BOT-CONTROL-PLANE-05

Дата: 2026-08-29  
Статус: implemented (schemaVersion=1)

## Endpoint

`GET /api/internal/bot/v1/live-facts`

- Auth: `Authorization: Bearer <BOT_INTERNAL_API_TOKEN>` via `withBotInternalApi`
- `Cache-Control: no-store`
- Reads **current** authoritative business SoT only
- Not managed KB; not a publication snapshot

## Fact ownership

`LIVE_FACTS_WINS_OVER_KB_PROSE_FOR_PRICE_DURATION_MASTER_ASSIGNMENT_BOOKING_MODE_ACTIVE_STATE_STUDIO_STRUCTURED`

Published KB may explain a procedure. It must not override:

- price (`priceFrom` / `priceTo` as canonical decimal strings)
- `durationMinutes`
- master ↔ service assignment (`MasterService.isEnabled`)
- `bookingMode` / booking capability
- active / inactive state
- structured studio contact + `isOnlineBookingEnabled`

## Availability boundary

This payload must never become an availability cache. Dates, slots, blocks, and appointment state stay on existing request-time APIs (`available-days`, `slots`, eligibility, bookings).

## Out of v1

- Promotions / gifts — split-brain between `PROMO_RULES` and DB `Promotion` (documented gap)
- Legacy `Service.price` column — booking catalog SoT is `priceFrom`/`priceTo`
- `MasterService.priceOverride` — unused in app services; omitted

## Sources

| Fact | Source |
| --- | --- |
| Services / prices / durations | `Service` + `ServiceCategory` |
| bookingMode | `resolveServiceBookingModes` (BookingService) |
| Masters + serviceIds | `Master` + `MasterService` |
| Studio contact / online flag | `StudioSettings` via `getPublicStudioSettings` |
