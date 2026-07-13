/**
 * Отправка НЕЙТРАЛЬНОГО тестового письма через тот же Mailer, что и приложение.
 *
 * Запуск только через одноразовый ops-образ (online-zapis-tv-ops:local), НЕ через
 * runtime-контейнер `app`. Реальный SMTP_PASSWORD берётся из закрытого server env
 * и НЕ передаётся аргументом.
 *
 * Usage:
 *   npm run mail:test -- --to recipient@example.com
 */

import { createMailerFromEnv, MailConfigError } from "../src/lib/mail/index";
import { isEmailAddress } from "../src/lib/mail/mail-config";
import { MailDeliveryError } from "../src/lib/mail/mailer";

class MailTestError extends Error {}

function parseArgs(): { to: string } {
  const argv = process.argv.slice(2);

  // Секреты нельзя передавать аргументами — отклоняем явно.
  const forbidden = ["--password", "--smtp-password", "--pass", "--secret"];
  if (argv.some((arg) => forbidden.some((flag) => arg === flag || arg.startsWith(`${flag}=`)))) {
    throw new MailTestError(
      "Секреты (в т.ч. SMTP-пароль) нельзя передавать аргументами. Пароль берётся из server env.",
    );
  }

  const index = argv.indexOf("--to");
  const to = index === -1 ? undefined : argv[index + 1]?.trim();
  if (!to) {
    throw new MailTestError("Укажите получателя: --to recipient@example.com");
  }
  if (!isEmailAddress(to)) {
    throw new MailTestError("Некорректный email получателя.");
  }

  return { to };
}

async function main(): Promise<void> {
  const { to } = parseArgs();

  // Тот же Mailer, что использует приложение. Fail-closed при невалидном env.
  const mailer = createMailerFromEnv();

  await mailer.sendMail({
    to,
    subject: "Тестовое письмо — Твоё время",
    text:
      "Это тестовое письмо от сервиса «Твоё время».\n" +
      "Если вы его получили, отправка почты настроена корректно.\n" +
      "Ссылок и персональных данных здесь нет.",
  });

  console.log("[mail] тестовое письмо успешно отправлено.");
}

main().catch((error) => {
  // Наружу — только безопасные обобщённые сообщения. Никакой SMTP-конфигурации,
  // пароля, ответа сервера или содержимого письма.
  if (error instanceof MailTestError || error instanceof MailConfigError) {
    console.error(`Ошибка: ${error.message}`);
  } else if (error instanceof MailDeliveryError) {
    console.error("[mail] delivery failed");
  } else {
    console.error("[mail] тестовая отправка не удалась.");
  }
  process.exit(1);
});
