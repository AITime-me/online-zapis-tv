import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { headers } from "next/headers";
import { authConfig, SESSION_MAX_AGE_SECONDS } from "@/auth.config";
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
        const requestHeaders = await headers();
        const { verifyCredentialsLogin } = await import(
          "@/lib/security/login-throttle/credentials-login"
        );

        return verifyCredentialsLogin(credentials, requestHeaders);
      },
    }),
  ],
});

export const AUTH_SESSION_MAX_AGE_SECONDS = SESSION_MAX_AGE_SECONDS;
