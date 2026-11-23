import { describe, expect, test } from 'bun:test';
import { assertSingleTenantIssuer } from '../src/services/oidc.ts';

const TENANT = '11111111-2222-3333-4444-555555555555';

describe('assertSingleTenantIssuer', () => {
  test('accepts an Entra tenant issuer', () => {
    expect(() =>
      assertSingleTenantIssuer(`https://login.microsoftonline.com/${TENANT}/v2.0`),
    ).not.toThrow();
  });

  test('rejects the multi-tenant aliases', () => {
    for (const tenant of ['common', 'organizations', 'consumers']) {
      expect(() =>
        assertSingleTenantIssuer(`https://login.microsoftonline.com/${tenant}/v2.0`),
      ).toThrow();
    }
  });

  test('leaves other providers alone', () => {
    expect(() => assertSingleTenantIssuer('https://idp.example.com/realms/school')).not.toThrow();
  });
});
