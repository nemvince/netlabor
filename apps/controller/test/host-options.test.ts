import { describe, expect, test } from 'bun:test';
import { stripHostLevelProperties } from '../src/services/host-options.ts';
import { validateTemplateProperties } from '../src/services/templates.ts';

describe('stripHostLevelProperties', () => {
  test('drops host-reaching emulator options and keeps the rest', () => {
    expect(
      stripHostLevelProperties({
        ram: 512,
        imageId: 'image-1',
        qemuPath: '/tmp/evil',
        options: ['-drive', 'file=/etc/shadow'],
        privileged: true,
        extraVolumes: '/:/host',
        portsMapping: [{ name: 'e0', interface: 'eth0' }],
      }),
    ).toEqual({ ram: 512, imageId: 'image-1' });
  });

  test('passes safe containers through', () => {
    const safe = { ram: 256, consoleType: 'telnet' };
    expect(stripHostLevelProperties(safe)).toEqual(safe);
  });

  test('node validation keeps the image OS family', () => {
    const validated = validateTemplateProperties('qemu', { osFamily: 'alpine', ram: 256 });
    expect(validated.osFamily).toBe('alpine');
  });
});
