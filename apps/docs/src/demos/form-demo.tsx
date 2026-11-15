import { CheckboxOption, Field, Input, Select, Textarea } from '@web/components/field.tsx';
import { useState } from 'react';

export default function FormDemo() {
  const [name, setName] = useState('r1');
  const [kind, setKind] = useState('qemu');
  const [notes, setNotes] = useState('Uplink to the core switch.');
  const [managed, setManaged] = useState(true);

  return (
    <div className="flex flex-col gap-3">
      <Field label="Node name" htmlFor="demo-name" hint="Unique inside the project.">
        <Input id="demo-name" value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label="Emulator" htmlFor="demo-kind">
        <Select id="demo-kind" value={kind} onChange={(event) => setKind(event.target.value)}>
          <option value="qemu">qemu</option>
          <option value="iou">iou</option>
          <option value="vpcs">vpcs</option>
          <option value="docker">docker</option>
        </Select>
      </Field>
      <Field label="Notes" htmlFor="demo-notes">
        <Textarea
          id="demo-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </Field>
      <CheckboxOption
        label="Managed by automation"
        description="Apply may reconcile this node from the manifest."
        checked={managed}
        onChange={(event) => setManaged(event.target.checked)}
      />
      <pre className="tabular rounded-[3px] border border-[var(--color-rule)] bg-[var(--color-panel-sunken)] p-2 text-[11px] text-[var(--color-ink-dim)]">
        {JSON.stringify({ name, kind, notes, managed }, null, 2)}
      </pre>
    </div>
  );
}
