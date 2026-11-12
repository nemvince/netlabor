import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Field, Input } from '../components/Field.tsx';
import { Notice } from '../components/Notice.tsx';
import { useMe } from '../features/auth/use-me.ts';
import { orpc } from '../lib/api.ts';
import { messageOf } from '../lib/errors.ts';
import { queryClient } from '../lib/queryClient.ts';

const loginSchema = z.object({
  username: z.string().min(1, 'enter your username').max(128),
  password: z.string().min(1, 'enter your password').max(256),
});

type LoginValues = z.infer<typeof loginSchema>;

/** Only same-origin absolute paths are valid post-login destinations. */
function safeRedirect(target: string | undefined): string {
  if (!target) return '/';
  if (!target.startsWith('/') || target.startsWith('//')) return '/';
  if (target === '/login' || target.startsWith('/login?')) return '/';
  return target;
}

export function LoginPage() {
  const search = useSearch({ from: '/login' });
  const navigate = useNavigate();
  const target = safeRedirect(search.redirect);
  const { isAuthenticated } = useMe();
  const providers = useQuery(orpc.auth.oidc.publicProviders.queryOptions({ input: {} }));
  const setup = useQuery(orpc.auth.setup.status.queryOptions({ input: {} }));
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: '', password: '' },
  });

  useEffect(() => {
    if (isAuthenticated) void navigate({ href: target, replace: true });
  }, [isAuthenticated, target, navigate]);

  const login = useMutation({
    ...orpc.auth.login.mutationOptions(),
    onSuccess: async () => {
      setServerError(null);
      queryClient.removeQueries({ queryKey: orpc.auth.me.key() });
      await queryClient.invalidateQueries();
      await navigate({ href: target, replace: true });
    },
    onError: (error) => setServerError(messageOf(error)),
  });

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    login.mutate(values);
  });

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-6">
          <div className="nb-rule-label" style={{ color: 'var(--color-copper)' }}>
            netlabor control plane
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--color-ink-dim)' }}>
            Use a local account or a configured single sign-on provider.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {search.error ? (
            <Notice tone="warn">
              Single sign-on did not complete ({search.error}). Try again or sign in with your
              password.
            </Notice>
          ) : null}
          {search.notice === 'password-changed' ? (
            <Notice tone="success">Password changed. Sign in with the new password.</Notice>
          ) : null}
          {serverError ? <Notice tone="error">{serverError}</Notice> : null}
          {setup.data?.needsSetup === true ? (
            <Notice tone="info">
              First start: this controller has no accounts yet.{' '}
              <a href="/setup" style={{ color: 'var(--color-copper)' }}>
                Run the setup wizard
              </a>{' '}
              to create your admin account.
            </Notice>
          ) : null}
        </div>

        <form className="nb-panel mt-3 flex flex-col gap-3 p-5" onSubmit={onSubmit} noValidate>
          <Field
            label="Username"
            htmlFor="login-username"
            error={form.formState.errors.username?.message}
          >
            <Input
              id="login-username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="admin"
              {...form.register('username')}
            />
          </Field>
          <Field
            label="Password"
            htmlFor="login-password"
            error={form.formState.errors.password?.message}
          >
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••••••"
              {...form.register('password')}
            />
          </Field>
          <button
            type="submit"
            className="nb-button mt-1 justify-center"
            data-variant="primary"
            disabled={login.isPending}
          >
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {providers.data && providers.data.length > 0 ? (
          <div className="mt-5">
            <div className="flex items-center gap-2">
              <span className="h-px flex-1" style={{ background: 'var(--color-rule)' }} />
              <span className="nb-rule-label">or</span>
              <span className="h-px flex-1" style={{ background: 'var(--color-rule)' }} />
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {providers.data.map((provider) => (
                <a
                  key={provider.id}
                  href={`/auth/oidc/${provider.id}/start`}
                  className="nb-button justify-center"
                  style={{ textDecoration: 'none' }}
                >
                  Continue with {provider.name}
                </a>
              ))}
            </div>
          </div>
        ) : null}

        <p className="mt-6 text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
          Sessions live in an HttpOnly cookie and end when you sign out or the session expires.
        </p>
      </div>
    </div>
  );
}
