import { describe, expect, test } from 'bun:test';
import { ProjectApplyInput } from '@netlabor/contract';
import { runningJobLimit } from '../src/services/jobs.ts';

describe('resource safeguards', () => {
  test('caps heavy job kinds and applies a default elsewhere', () => {
    expect(runningJobLimit('appliance.build')).toBe(2);
    expect(runningJobLimit('os.download')).toBe(2);
    expect(runningJobLimit('image.sync')).toBe(4);
    expect(runningJobLimit('some.future.job')).toBe(8);
  });

  test('rejects an oversized apply manifest before it reaches the service', () => {
    const node = { name: 'n' };
    const parse = ProjectApplyInput.safeParse({
      nodes: Array.from({ length: 2_001 }, () => node),
    });
    expect(parse.success).toBe(false);
  });
});
