import type { NodeRow } from '@netlabor/contract';
import { Pause, Play, RotateCw, Square, SquareTerminal, TimerReset } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Input } from '../../components/Field.tsx';
import { Notice } from '../../components/Notice.tsx';
import { toast } from '../../components/Toast.tsx';
import { client } from '../../lib/api.ts';
import { messageOf } from '../../lib/errors.ts';

type NodeAction = 'start' | 'stop' | 'suspend' | 'reload';

/** Inspector console tab: quick power actions, ticket shortcut, command runner. */
export function NodeConsolePanel({
  node,
  canConsole,
  canControl,
  onOpenConsole,
  onAction,
}: {
  node: NodeRow;
  canConsole: boolean;
  canControl: boolean;
  onOpenConsole: () => void;
  onAction: (action: NodeAction) => void;
}) {
  const [commands, setCommands] = useState('');
  const [timeoutMs, setTimeoutMs] = useState('15000');
  const [transcript, setTranscript] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCommands('');
    setTranscript('');
    setError(null);
  }, []);

  async function runCommands() {
    const lines = commands
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
    if (lines.length === 0) {
      setError('Enter at least one command.');
      return;
    }
    const timeout = Number(timeoutMs);
    if (!Number.isFinite(timeout) || timeout < 1000 || timeout > 120_000) {
      setError('Timeout must be between 1000 and 120000 ms.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await client.nodes.console.exec({
        id: node.id,
        commands: lines,
        timeoutMs: timeout,
      });
      setTranscript(result.transcript);
      if (!result.ok) setError(result.timedOut ? 'The command timed out.' : 'The command failed.');
    } catch (runError) {
      setError(messageOf(runError));
    } finally {
      setBusy(false);
    }
  }

  async function resetConsole() {
    setError(null);
    try {
      await client.nodes.resetConsole({ id: node.id });
      toast.success(`Console reset for ${node.name}.`);
    } catch (resetError) {
      const message = messageOf(resetError);
      setError(message);
      toast.error(message);
    }
  }

  const started = node.status === 'started';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          className="nb-button w-full"
          data-size="sm"
          data-variant="primary"
          disabled={!canConsole}
          onClick={onOpenConsole}
        >
          <SquareTerminal size={12} aria-hidden /> Open console
        </button>
        <details
          className="rounded-[2px] border px-2 py-1.5"
          style={{ borderColor: 'var(--color-rule)' }}
        >
          <summary
            className="cursor-pointer text-[11px]"
            style={{ color: 'var(--color-ink-dim)' }}
          >
            Power &amp; maintenance
          </summary>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {canControl ? (
              <>
                <button
                  type="button"
                  className="nb-button"
                  data-size="sm"
                  disabled={started || node.status === 'suspended'}
                  onClick={() => onAction('start')}
                >
                  <Play size={12} aria-hidden /> Start
                </button>
                <button
                  type="button"
                  className="nb-button"
                  data-size="sm"
                  disabled={!started && node.status !== 'suspended'}
                  onClick={() => onAction('stop')}
                >
                  <Square size={12} aria-hidden /> Stop
                </button>
                <button
                  type="button"
                  className="nb-button"
                  data-size="sm"
                  disabled={!started}
                  onClick={() => onAction('suspend')}
                >
                  <Pause size={12} aria-hidden /> Suspend
                </button>
                <button
                  type="button"
                  className="nb-button"
                  data-size="sm"
                  disabled={!started}
                  onClick={() => onAction('reload')}
                >
                  <RotateCw size={12} aria-hidden /> Reload
                </button>
              </>
            ) : null}
            {node.consoleType === 'telnet' || node.consoleType === 'vnc' ? (
              <button
                type="button"
                className="nb-button"
                data-size="sm"
                disabled={!canConsole}
                onClick={() => void resetConsole()}
              >
                <TimerReset size={12} aria-hidden /> Reset console
              </button>
            ) : null}
          </div>
        </details>
      </div>
      <div className="tabular text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
        console {node.consoleType} · port {node.consolePort ?? '—'} · {node.status}
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}

      <div
        className="mt-1 rounded-[2px] border p-2"
        style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel-sunken)' }}
      >
        <div className="nb-rule-label mb-1">Run commands</div>
        <textarea
          aria-label="Console commands"
          className="nb-field tabular min-h-20 resize-y font-mono text-[11px]"
          placeholder={'show version\nshow ip interface brief'}
          value={commands}
          onChange={(event) => setCommands(event.target.value)}
          spellCheck={false}
        />
        <div className="mt-1 flex items-end gap-2">
          <label
            htmlFor="console-exec-timeout"
            className="flex flex-1 flex-col gap-0.5 text-[10px]"
          >
            <span style={{ color: 'var(--color-ink-faint)' }}>Timeout (ms)</span>
            <Input
              id="console-exec-timeout"
              className="py-1 text-[11px]"
              inputMode="numeric"
              value={timeoutMs}
              onChange={(event) => setTimeoutMs(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="nb-button"
            data-size="sm"
            disabled={busy || !canConsole}
            onClick={() => void runCommands()}
          >
            {busy ? 'Running…' : 'Run'}
          </button>
        </div>
        {transcript ? (
          <pre
            className="tabular mt-2 max-h-52 overflow-auto rounded-[2px] border p-2 text-[10px] leading-[1.5] whitespace-pre-wrap"
            style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel)' }}
          >
            {transcript}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
