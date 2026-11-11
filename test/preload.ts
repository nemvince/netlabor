/**
 * Preload for integration tests: points the controller at the test database and
 * refuses to run against a non-test database.
 */

const url = process.env.NB_TEST_DATABASE_URL ?? process.env.NB_DATABASE_URL;
if (!url) {
  throw new Error('NB_TEST_DATABASE_URL (or NB_DATABASE_URL) is required for integration tests');
}
const databaseName = new URL(url).pathname.replace(/^\//, '');
if (!/test/i.test(databaseName)) {
  throw new Error(`refusing to run integration tests against database "${databaseName}"`);
}
process.env.NB_DATABASE_URL = url;
process.env.NB_PUBLIC_URL = process.env.NB_PUBLIC_URL ?? 'http://127.0.0.1:8080';
process.env.NB_SECRET_KEY = process.env.NB_SECRET_KEY ?? Buffer.alloc(32, 7).toString('base64');
process.env.NB_LOG_LEVEL = process.env.NB_LOG_LEVEL ?? 'error';
process.env.NB_ADMIN_PASSWORD = process.env.NB_ADMIN_PASSWORD ?? 'test-password-1234';
