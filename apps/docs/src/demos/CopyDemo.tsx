import { CopyButton } from '@web/components/CopyButton.tsx';

export default function CopyDemo() {
  return (
    <div className="docs-stack">
      <code className="tabular rounded-[2px] border border-[var(--color-rule)] bg-[var(--color-panel-raised)] px-1.5 py-0.5 text-[12px]">
        nbk_7Qm3rT9xL2vB8nK4fA6dJ1sH5cP0eW2u
      </code>
      <CopyButton value="nbk_7Qm3rT9xL2vB8nK4fA6dJ1sH5cP0eW2u" label="Copy API key" />
    </div>
  );
}
