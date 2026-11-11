import { CopyButton } from '../../components/CopyButton.tsx';
import { Notice } from '../../components/Notice.tsx';

/**
 * One-time credentials panel: the plaintext agent token and the environment
 * block are shown exactly once after creation or rotation.
 */
export function TokenOncePanel({ token, environment }: { token: string; environment: string }) {
  return (
    <div className="flex flex-col gap-3">
      <Notice tone="warn">
        This token is shown once. Copy it into the agent configuration before closing this dialog;
        it cannot be retrieved again.
      </Notice>
      <div
        className="rounded-[3px] border p-3"
        style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel-sunken)' }}
      >
        <div className="nb-rule-label">agent token</div>
        <div className="mt-1 flex items-start gap-2">
          <code className="tabular min-w-0 flex-1 break-all text-[12px]">{token}</code>
          <CopyButton value={token} label="Copy token" />
        </div>
      </div>
      <div
        className="rounded-[3px] border p-3"
        style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel-sunken)' }}
      >
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="nb-rule-label">agent environment</span>
          <CopyButton value={environment} label="Copy env" />
        </div>
        <pre className="tabular max-h-56 overflow-auto text-[11px] leading-[1.6]">
          {environment}
        </pre>
      </div>
    </div>
  );
}
