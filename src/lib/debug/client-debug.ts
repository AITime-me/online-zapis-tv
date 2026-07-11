type ClientDebugMeta = Record<string, string | number | boolean | null | undefined>;

function isClientDebugEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_CLIENT_DEBUG === "true"
  );
}

export function clientDebugLog(scope: string, meta?: ClientDebugMeta): void {
  if (!isClientDebugEnabled()) {
    return;
  }

  console.log(`[${scope}]`, meta ?? {});
}

export function clientDebugWarn(scope: string, meta?: ClientDebugMeta): void {
  if (!isClientDebugEnabled()) {
    return;
  }

  console.warn(`[${scope}]`, meta ?? {});
}
