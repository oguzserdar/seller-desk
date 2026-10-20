/**
 * The test database and settings. The database name must end in "_test":
 * the suite drops and rebuilds its schema, so it refuses anything else.
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://seller_desk@127.0.0.1:54329/seller_desk_test";

export function assertTestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) {
    throw new Error(`Refusing to run integration tests against "${name}": the database name must end in _test.`);
  }
}

export const TEST_ENV: Record<string, string> = {
  APP_MODE: "fixture",
  APP_URL: "http://localhost:4310",
  DATABASE_URL: TEST_DATABASE_URL,
  DATABASE_POOL_MAX: "10",
  BETTER_AUTH_SECRET: "test-only-auth-secret-0123456789abcdef0123456789",
  JOBS_SECRET: "test-only-jobs-secret-0123456789abcdef0123456789",
};
