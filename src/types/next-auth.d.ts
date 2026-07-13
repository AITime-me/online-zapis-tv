import type { UserRole } from "@prisma/client";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
    } & DefaultSession["user"];
    /** Момент выдачи сессии (Unix seconds); ставится при входе. */
    authTime?: number;
  }

  interface User {
    role: UserRole;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: UserRole;
    /** Момент выдачи JWT (Unix seconds); ставится один раз при входе. */
    authTime?: number;
  }
}
