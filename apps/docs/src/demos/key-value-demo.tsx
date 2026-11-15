import { KeyValueEditor } from '@web/components/key-value-editor.tsx';
import { useState } from 'react';

export default function KeyValueDemo() {
  const [value, setValue] = useState<Record<string, unknown>>({
    ram: 512,
    adapterType: 'virtio-net-pci',
    consoleAutoStart: true,
  });

  return (
    <div className="flex flex-col gap-2">
      <KeyValueEditor
        value={value}
        onChange={setValue}
        keyPlaceholder="property"
        valuePlaceholder="value"
        addLabel="Add property"
        ariaLabel="Node properties"
      />
      <p className="tabular text-[11px] text-[var(--color-ink-faint)]">{JSON.stringify(value)}</p>
    </div>
  );
}
