import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { createMailerFromEnv } from "@/lib/mail";
import {
  applyPasswordReset,
  PasswordResetError,
  requestPasswordReset,
} from "@/lib/auth/password-reset";

const BCRYPT_COST = 10;

function logMailFailure(reason: string): void {
  console.error(`[password-reset] ${reason}`);
}

export async function requestPasswordResetByEmail(email: string) {
  return requestPasswordReset(prisma, createMailerFromEnv(), {
    email,
    authUrl: process.env.AUTH_URL ?? "",
    appEnv: process.env.APP_ENV as "development" | "staging" | "production" | undefined,
    logMailFailure,
  });
}

export async function completePasswordResetByToken(params: {
  token: string;
  password: string;
  confirmation: string;
}) {
  return applyPasswordReset(
    prisma,
    {
      rawToken: params.token,
      newPassword: params.password,
      confirmation: params.confirmation,
    },
    async (plain) => bcrypt.hash(plain, BCRYPT_COST),
  );
}

export function passwordResetErrorResponse(error: PasswordResetError) {
  return {
    ok: false as const,
    code: error.code,
    error: error.message,
  };
}

export { PasswordResetError };
