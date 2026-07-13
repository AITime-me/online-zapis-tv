import { z } from "zod";
import { validateAuthUrlForRuntime } from "@/lib/auth-url-policy";
import { validateMailConfig } from "@/lib/mail/mail-config";

const baseEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_TIMEZONE: z.string().default("Asia/Yekaterinburg"),
  EXPORT_STORAGE: z.enum(["local", "s3"]).default("local"),
  EXPORT_LOCAL_DIR: z.string().default("./exports/emergency"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["development", "staging", "production"]).optional(),
  // Почта (провайдеро-независимо). Валидируется в production через mail-config.
  MAIL_PROVIDER: z.string().optional(),
  MAIL_FROM_NAME: z.string().optional(),
  MAIL_FROM_ADDRESS: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_SECURE: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_IP_FAMILY: z.string().optional(),
});

const productionEnvSchema = baseEnvSchema
  .extend({
    AUTH_SECRET: z
      .string()
      .min(32, "AUTH_SECRET должен содержать не менее 32 символов в production"),
    AUTH_URL: z.string().url("AUTH_URL должен быть валидным URL"),
    SCHEDULE_VIEW_TOKEN: z
      .string()
      .min(32, "SCHEDULE_VIEW_TOKEN должен содержать не менее 32 символов в production"),
  })
  .superRefine((value, ctx) => {
    const result = validateAuthUrlForRuntime(value.AUTH_URL, value.APP_ENV);
    if (!result.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["AUTH_URL"],
        message: result.message,
      });
    }

    // Fail-closed для почты: при MAIL_PROVIDER=smtp обязательны корректные
    // SMTP-параметры. Значение SMTP_PASSWORD в сообщение не попадает.
    const mailResult = validateMailConfig({
      MAIL_PROVIDER: value.MAIL_PROVIDER,
      MAIL_FROM_NAME: value.MAIL_FROM_NAME,
      MAIL_FROM_ADDRESS: value.MAIL_FROM_ADDRESS,
      SMTP_HOST: value.SMTP_HOST,
      SMTP_PORT: value.SMTP_PORT,
      SMTP_SECURE: value.SMTP_SECURE,
      SMTP_USER: value.SMTP_USER,
      SMTP_PASSWORD: value.SMTP_PASSWORD,
      SMTP_IP_FAMILY: value.SMTP_IP_FAMILY,
    });
    if (!mailResult.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["MAIL_PROVIDER"],
        message: mailResult.message,
      });
    }
  });

export type Env = z.infer<typeof baseEnvSchema> & {
  AUTH_SECRET?: string;
  AUTH_URL?: string;
  SCHEDULE_VIEW_TOKEN?: string;
};

function assertProductionDebugDisabled(): void {
  if (process.env.NEXT_PUBLIC_SCHEDULE_DEBUG === "true") {
    throw new Error(
      "NEXT_PUBLIC_SCHEDULE_DEBUG=true запрещён в production. Удалите переменную или установите false.",
    );
  }
}

function resolveAuthSecret(): string | undefined {
  return process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim() || undefined;
}

function isProductionRuntime(): boolean {
  if (process.env.NODE_ENV !== "production") {
    return false;
  }

  // Next.js импортирует server-модули при `next build` с NODE_ENV=production
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return false;
  }

  return true;
}

function loadEnv(): Env {
  if (isProductionRuntime()) {
    assertProductionDebugDisabled();

    const parsed = productionEnvSchema.safeParse({
      ...process.env,
      AUTH_SECRET: resolveAuthSecret(),
    });

    if (!parsed.success) {
      const details = parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      throw new Error(`Invalid production environment variables: ${details}`);
    }

    return parsed.data;
  }

  const parsed = baseEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment variables: ${details}`);
  }

  return {
    ...parsed.data,
    AUTH_SECRET: resolveAuthSecret(),
    AUTH_URL: process.env.AUTH_URL?.trim(),
    SCHEDULE_VIEW_TOKEN: process.env.SCHEDULE_VIEW_TOKEN?.trim(),
  };
}

export const env = loadEnv();

export const STUDIO_TIMEZONE = env.APP_TIMEZONE;
