import type { NextAuthConfig } from "next-auth";
import type { UserRole } from "@prisma/client";

export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

export const authConfig = {
  trustHost: true,
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  session: {
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Secure-authjs.session-token"
          : "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  pages: {
    signIn: "/login",
  },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id!;
        token.role = user.role as UserRole;
        // Момент входа фиксируется один раз; при обновлении токена не меняется.
        token.authTime = Math.floor(Date.now() / 1000);
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
      }
      session.authTime = token.authTime;
      return session;
    },
  },
} satisfies NextAuthConfig;
