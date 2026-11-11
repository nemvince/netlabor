import { describe, expect, test } from 'bun:test';
import { AppError } from '@netlabor/contract';
import {
  applianceHostname,
  applianceProvisioningScript,
  applianceUserData,
} from '../src/services/appliances.ts';

const BASE = {
  hostname: 'debian-13-xfce',
  user: 'netlabor',
  password: 'abcdef0123456789abcdef01',
  desktop: 'xfce' as const,
  packages: ['vim', 'curl'],
  commands: ['echo hello'],
};

describe('appliance provisioning script', () => {
  test('installs the desktop packages and enables the display manager', () => {
    const script = applianceProvisioningScript(BASE);
    expect(script).toContain('apt-get install -y --no-install-recommends');
    expect(script).toContain('xfce4');
    expect(script).toContain('lightdm');
    expect(script).toContain('systemctl enable lightdm');
    expect(script).toContain('systemctl set-default graphical.target');
  });

  test('appends extra packages and custom commands', () => {
    const script = applianceProvisioningScript(BASE);
    expect(script).toContain('vim');
    expect(script).toContain('curl');
    expect(script).toContain("bash -c 'echo hello'");
  });

  test('desktop none skips the display manager but keeps extra packages', () => {
    const script = applianceProvisioningScript({ ...BASE, desktop: 'none' });
    expect(script).toContain('apt-get install -y --no-install-recommends vim curl');
    expect(script).not.toContain('systemctl enable');
    expect(script).not.toContain('graphical.target');
  });

  test('emits progress markers, the success marker, and a forced poweroff', () => {
    const script = applianceProvisioningScript(BASE);
    expect(script).toContain('echo "NETLABOR_PROGRESS $1 $2"');
    expect(script).toContain('progress 5 "refreshing package lists"');
    expect(script).toContain('progress 20 "installing packages"');
    expect(script).toContain('progress 100 "build complete"');
    expect(script).toContain('echo NETLABOR_BUILD_OK');
    expect(script).toContain('echo "NETLABOR_BUILD_FAILED provisioning failed');
    expect(script.match(/systemctl poweroff -f/g)).toHaveLength(2);
  });

  test('rejects a hostile package name', () => {
    try {
      applianceProvisioningScript({ ...BASE, packages: ['foo; rm -rf /'] });
      throw new Error('expected the recipe builder to reject the package name');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('BAD_REQUEST');
    }
  });

  test('rejects multi-line custom commands', () => {
    expect(() => applianceProvisioningScript({ ...BASE, commands: ['echo ok\npoweroff'] })).toThrow(
      AppError,
    );
  });

  test('quotes single quotes so a command cannot break the script', () => {
    const script = applianceProvisioningScript({ ...BASE, commands: ["echo 'hi'"] });
    expect(script).toContain("bash -c 'echo '\\''hi'\\'''");
  });
});

describe('appliance user-data', () => {
  test('writes one cloud-init script and tees runcmd output to the console', () => {
    const userData = applianceUserData(BASE);
    expect(userData.startsWith('#cloud-config\n')).toBe(true);
    expect(userData).toContain('write_files:');
    expect(userData).toContain('path: /usr/local/sbin/netlabor-build.sh');
    expect(userData).toContain("all: '| tee -a /var/log/netlabor-build.log /dev/console'");
    expect(userData).toContain('runcmd:');
    expect(userData).toContain('[bash, /usr/local/sbin/netlabor-build.sh]');
    expect(userData).toContain('plain_text_passwd: "abcdef0123456789abcdef01"');
  });

  test('derives a safe DNS hostname from the build name', () => {
    expect(applianceHostname('Debian 13 / XFCE Lab')).toBe('debian-13-xfce-lab');
    expect(applianceHostname('---')).toBe('netlabor-appliance');
  });
});
