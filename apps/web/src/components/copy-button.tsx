import { Check, Copy } from 'lucide-react';
import { Button } from '@netlabor/ui/components/button';
import { useEffect, useState } from 'react';

/** Copies a machine value to the clipboard; confirms in place for 1.6 s. */
export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Button type="button" variant="outline" size="xs" onClick={() => void copy()}>
      {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
      {copied ? 'Copied' : label}
    </Button>
  );
}
