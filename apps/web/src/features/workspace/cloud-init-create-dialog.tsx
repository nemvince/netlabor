import { cloudInitDefaultUser } from '@netlabor/catalog';
import type { OsFamily, TemplateRow } from '@netlabor/contract';
import { useState } from 'react';
import { Dialog, DialogFooter } from '../../components/dialog.tsx';
import { Field, Input, Select } from '../../components/field.tsx';
import { Notice } from '../../components/notice.tsx';

export interface CloudInitCredentials {
  cloudInitUser: string;
  cloudInitPassword: string;
  cloudInitHostname: string;
  cloudInitNetworkMode: 'dhcp' | 'static';
  cloudInitIpAddress: string;
  cloudInitGateway: string;
  cloudInitDns: string;
}

/** Per-node password so two machines never share one by default. */
function generatedPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Credentials and network prompt shown before creating a cloud-init node. */
export function CloudInitCreateDialog({
  template,
  onClose,
  onCreate,
}: {
  template: TemplateRow;
  onClose: () => void;
  onCreate: (credentials: CloudInitCredentials) => void;
}) {
  const properties = template.properties as Record<string, unknown>;
  const family: OsFamily =
    typeof properties.osFamily === 'string' ? (properties.osFamily as OsFamily) : 'debian';
  const [user, setUser] = useState(
    typeof properties.cloudInitUser === 'string' && properties.cloudInitUser
      ? properties.cloudInitUser
      : (cloudInitDefaultUser[family] ?? 'debian'),
  );
  const [password, setPassword] = useState(
    typeof properties.cloudInitPassword === 'string' && properties.cloudInitPassword
      ? properties.cloudInitPassword
      : generatedPassword(),
  );
  const [hostname, setHostname] = useState('');
  const [mode, setMode] = useState<'dhcp' | 'static'>(
    properties.cloudInitNetworkMode === 'static' ? 'static' : 'dhcp',
  );
  const [address, setAddress] = useState('');
  const [gateway, setGateway] = useState('');
  const [dns, setDns] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (user.trim() === '') {
      setError('Enter a cloud-init username.');
      return;
    }
    if (password === '') {
      setError('Enter a password; it is written to cloud-init at first boot.');
      return;
    }
    if (mode === 'static' && address.trim() === '') {
      setError('Static networking needs an address with prefix, e.g. 10.0.0.10/24.');
      return;
    }
    setError(null);
    onCreate({
      cloudInitUser: user.trim(),
      cloudInitPassword: password,
      cloudInitHostname: hostname.trim(),
      cloudInitNetworkMode: mode,
      cloudInitIpAddress: address.trim(),
      cloudInitGateway: gateway.trim(),
      cloudInitDns: dns.trim(),
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Create ${template.name}`}
      description="Cloud-init needs a login and network policy for the first boot. You can change these later in the inspector."
      width={520}
    >
      <div className="flex flex-col gap-2.5">
        <Field label="Username" htmlFor="cloudinit-user">
          <Input
            id="cloudinit-user"
            autoFocus
            value={user}
            onChange={(event) => setUser(event.target.value)}
          />
        </Field>
        <Field
          label="Password"
          htmlFor="cloudinit-password"
          hint="Generated once for this node; change it if you like."
        >
          <Input
            id="cloudinit-password"
            className="tabular"
            autoComplete="off"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Field label="Hostname" htmlFor="cloudinit-hostname" hint="Empty uses the node name.">
          <Input
            id="cloudinit-hostname"
            value={hostname}
            placeholder="node name"
            onChange={(event) => setHostname(event.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Network" htmlFor="cloudinit-network">
            <Select
              id="cloudinit-network"
              value={mode}
              onChange={(event) => setMode(event.target.value === 'static' ? 'static' : 'dhcp')}
            >
              <option value="dhcp">DHCP</option>
              <option value="static">Static</option>
            </Select>
          </Field>
          <Field
            label="Address / prefix"
            htmlFor="cloudinit-address"
            hint={mode === 'static' ? 'Required for static networking.' : undefined}
          >
            <Input
              id="cloudinit-address"
              className="tabular"
              value={address}
              placeholder="10.0.0.10/24"
              disabled={mode !== 'static'}
              onChange={(event) => setAddress(event.target.value)}
            />
          </Field>
          <Field label="Gateway" htmlFor="cloudinit-gateway">
            <Input
              id="cloudinit-gateway"
              className="tabular"
              value={gateway}
              placeholder="10.0.0.1"
              disabled={mode !== 'static'}
              onChange={(event) => setGateway(event.target.value)}
            />
          </Field>
          <Field label="DNS" htmlFor="cloudinit-dns" hint="Comma separated.">
            <Input
              id="cloudinit-dns"
              className="tabular"
              value={dns}
              placeholder="1.1.1.1, 9.9.9.9"
              disabled={mode !== 'static'}
              onChange={(event) => setDns(event.target.value)}
            />
          </Field>
        </div>
        {error ? <Notice tone="error">{error}</Notice> : null}
      </div>
      <DialogFooter>
        <button type="button" className="nb-button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="nb-button" data-variant="primary" onClick={submit}>
          Create node
        </button>
      </DialogFooter>
    </Dialog>
  );
}
