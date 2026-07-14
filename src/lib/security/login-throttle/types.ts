import type { LoginThrottleScope } from "@prisma/client";

export type LoginThrottleRow = {
  id: string;
  scope: LoginThrottleScope;
  keyHash: string;
  failedCount: number;
  windowStartedAt: Date;
  blockedUntil: Date | null;
};

export type LoginThrottlePrisma = {
  loginThrottleEntry: {
    findUnique(args: {
      where: { scope_keyHash: { scope: LoginThrottleScope; keyHash: string } };
    }): Promise<LoginThrottleRow | null>;
    create(args: {
      data: {
        scope: LoginThrottleScope;
        keyHash: string;
        failedCount: number;
        windowStartedAt: Date;
        blockedUntil: Date | null;
      };
    }): Promise<LoginThrottleRow>;
    update(args: {
      where: { id: string };
      data: {
        failedCount?: number;
        windowStartedAt?: Date;
        blockedUntil?: Date | null;
      };
    }): Promise<LoginThrottleRow>;
    deleteMany(args: {
      where?: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  $transaction<T>(
    fn: (tx: LoginThrottlePrisma) => Promise<T>,
    options?: { isolationLevel?: string },
  ): Promise<T>;
};

export type LoginThrottleScopeConfig = {
  scope: LoginThrottleScope;
  keyHash: string;
  maxFailures: number;
  windowMs: number;
  blockMs: number;
};
