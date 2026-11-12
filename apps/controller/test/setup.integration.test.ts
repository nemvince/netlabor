/**
 * First-run wizard against a live controller with no accounts. Point
 * NB_TEST_API_URL at a controller started with an empty database and without
 * NB_ADMIN_PASSWORD; the suite skips once the controller has users.
 *
 *   NB_TEST_API_URL=http://127.0.0.1:8080 bun run test:integration
 */

import { describe, expect, test } from 'bun:test';
import { baseUrl, login, makeSession, needsSetup } from './live.ts';

const firstRun = baseUrl ? await needsSetup() : false;
const describeFresh = firstRun ? describe : describe.skip;

const username = `setup-${Date.now().toString(36)}`;
const password = 'first-run-password-1234';

describeFresh('first-run setup', () => {
  test('claims the admin account and signs it in', async () => {
    const session = makeSession();
    expect((await session.client.auth.setup.status({})).needsSetup).toBe(true);

    const created = await session.client.auth.setup.createAdmin({ username, password });
    expect(created.user.username).toBe(username);
    expect(session.cookie()).toContain('nb_session');

    const me = await session.client.auth.me({});
    expect(me.username).toBe(username);
    expect(me.privileges).toContain('settings.write');

    expect((await session.client.auth.setup.status({})).needsSetup).toBe(false);
  });

  test('accepts the credentials through the normal login path', async () => {
    const session = await login(username, password);
    expect((await session.client.auth.me({})).username).toBe(username);
  });

  test('refuses a second claim', async () => {
    const session = makeSession();
    await expect(
      session.client.auth.setup.createAdmin({ username: 'intruder', password }),
    ).rejects.toThrow();
    expect((await session.client.auth.setup.status({})).needsSetup).toBe(false);
  });
});
