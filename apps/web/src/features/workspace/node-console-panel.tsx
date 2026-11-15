import type { NodeRow } from '@netlabor/contract';
import {
  PauseIcon as Pause,
  PlayIcon as Play,
  ArrowClockwiseIcon as RotateCw,
  SquareIcon as Square,
  TerminalIcon as SquareTerminal,
  ClockCounterClockwiseIcon as TimerReset,
} from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Input } from '../../components/field.tsx';
import { Notice } from '../../components/notice.tsx';
import { toast } from '../../components/toast.tsx';
import { client } from '../../lib/api.ts';
import { messageOf } from '../../lib/errors.ts';
import { Button } from '@netlabor/ui/components/button';
import { Textarea } from '@netlabor/ui/components/textarea';

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
        <Button
          type="button"
          disabled={!canConsole}
          onClick={onOpenConsole}
          className="w-full"
          variant="default"
          size="xs"
        >
          <SquareTerminal size={12} aria-hidden /> Open console
        </Button>
        <details
          className="rounded-[2px] border px-2 py-1.5"
          style={{ borderColor: 'var(--color-rule)' }}
        >
          <summary className="cursor-pointer text-[11px]" style={{ color: 'var(--color-ink-dim)' }}>
            Power &amp; maintenance
          </summary>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {canControl ? (
              <>
                <Button
                  type="button"
                  disabled={started || node.status === 'suspended'}
                  onClick={() => onAction('start')}
                  variant="outline"
                  size="xs"
                >
                  <Play size={12} aria-hidden /> Start
                </Button>
                <Button
                  type="button"
                  disabled={!started && node.status !== 'suspended'}
                  onClick={() => onAction('stop')}
                  variant="outline"
                  size="xs"
                >
                  <Square size={12} aria-hidden /> Stop
                </Button>
                <Button
                  type="button"
                  disabled={!started}
                  onClick={() => onAction('suspend')}
                  variant="outline"
                  size="xs"
                >
                  <Pause size={12} aria-hidden /> Suspend
                </Button>
                <Button
                  type="button"
                  disabled={!started}
                  onClick={() => onAction('reload')}
                  variant="outline"
                  size="xs"
                >
                  <RotateCw size={12} aria-hidden /> Reload
                </Button>
              </>
            ) : null}
            {node.consoleType === 'telnet' || node.consoleType === 'vnc' ? (
              <Button
                type="button"
                disabled={!canConsole}
                onClick={() => void resetConsole()}
                variant="outline"
                size="xs"
              >
                <TimerReset size={12} aria-hidden /> Reset console
              </Button>
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
        <Textarea
          aria-label="Console commands"
          className="tabular min-h-20 resize-y font-mono text-[11px]"
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
          <Button
            type="button"
            disabled={busy || !canConsole}
            onClick={() => void runCommands()}
            variant="outline"
            size="xs"
          >
            {busy ? 'Running…' : 'Run'}
          </Button>
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
