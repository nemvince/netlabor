import { describe, expect, test } from 'bun:test';
import { softwareCatalog } from '../src/software.ts';

const PACKAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9+._-]*(?::[A-Za-z0-9._-]+)?$/;

describe('software catalog', () => {
  test('has unique ids and Debian packages for every entry', () => {
    const ids = new Set<string>();
    for (const entry of softwareCatalog) {
      expect(ids.has(entry.id)).toBe(false);
      ids.add(entry.id);
      expect((entry.packages.debian ?? []).length).toBeGreaterThan(0);
    }
  });

  test('every package name is shell-safe', () => {
    for (const entry of softwareCatalog) {
      for (const packages of Object.values(entry.packages)) {
        for (const name of packages ?? []) expect(name).toMatch(PACKAGE_NAME);
      }
    }
  });

  test('covers office, sysadmin, network and server roles', () => {
    const groups = new Set(softwareCatalog.map((entry) => entry.group));
    for (const group of ['office', 'sysadmin', 'network', 'server', 'tools']) {
      expect(groups.has(group as (typeof softwareCatalog)[number]['group'])).toBe(true);
    }
  });
});
