# Сообщить о проблеме (публичная форма на /booking)

Отдельный канал клиентских обращений о проблемах на сайте.

## Переменные окружения (staging / production)

Добавьте в закрытый env-файл сервера (не в Git):

- `PROBLEM_REPORT_TELEGRAM_BOT_TOKEN` — токен отдельного Telegram-бота клиентских обращений
- `PROBLEM_REPORT_TELEGRAM_CHAT_ID` — chat id получателя (владелец / менеджерская группа)

Бот **не** должен совпадать с ботом «Тех-сторож» (`TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` в health-monitor).

Если переменные не заданы:

- внутренняя заявка `BookingRequest` с типом `WEBSITE_PROBLEM_REPORT` всё равно создаётся;
- в лог пишется безопасное предупреждение без секретов;
- клиент получает успешный ответ.

## Хранение

Обращения сохраняются в существующей таблице `booking_requests`:

- `type = WEBSITE_PROBLEM_REPORT`
- `source = WEBSITE_PROBLEM_REPORT`
- `clientId` / `appointmentId` = null (клиент и запись не создаются)
- метаданные страницы / UA / viewport — в `comment` (маркер `PROBLEM_REPORT_V1`)

Видимы OWNER и MANAGER в `/admin/booking-requests`. В колонке расписания не показываются.

## Миграция

`prisma/migrations/20260731120000_website_problem_report/`

Применить на staging отдельно (`prisma migrate deploy`). Не выполнять из этой задачи на staging/production.
