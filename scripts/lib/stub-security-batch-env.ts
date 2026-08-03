/**
 * Preload for security batch scripts: stub server-only and set safe test env
 * before modules that import @/lib/db / env validation are evaluated.
 */
import "./stub-server-only";

if (!process.env.DATABASE_URL?.trim()) {
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@127.0.0.1:65534/security_batch_unused";
}
if (!process.env.AUTH_SECRET?.trim()) {
  process.env.AUTH_SECRET = "test-auth-secret-16chars-min";
}
process.env.SECURITY_BATCH_TEST ??= "1";
process.env.NODE_ENV ??= "test";
