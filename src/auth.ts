import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import type { UserRole } from "@prisma/client";
import { authConfig, SESSION_MAX_AGE_SECONDS } from "@/auth.config";
import { prisma } from "@/lib/db";
import { markLastLogin } from "@/lib/auth/last-login";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  events: {
    async signIn({ user }) {
      if (user?.id) {
        await markLastLogin(user.id);
      }
    },
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "")
          .trim()
          .toLowerCase();
        const password = String(credentials?.password ?? "");

        if (!email || !password) {
          return null;
        }

        const requestHeaders = await headers();
        const {
          isLoginRateLimited,
          recordLoginRateLimitFailure,
          resetLoginRateLimitState,
        } = await import("@/lib/security/rate-limit/login");

        if (isLoginRateLimited(email, requestHeaders)) {
          return null;
        }

        const user = await prisma.user.findUnique({ where: { email } });

        if (!user?.isActive) {
          recordLoginRateLimitFailure(email, requestHeaders);
          return null;
        }

        const isValid = await bcrypt.compare(password, user.passwordHash);

        if (!isValid) {
          recordLoginRateLimitFailure(email, requestHeaders);
          return null;
        }

        resetLoginRateLimitState(email, requestHeaders);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
});

export const AUTH_SESSION_MAX_AGE_SECONDS = SESSION_MAX_AGE_SECONDS;
