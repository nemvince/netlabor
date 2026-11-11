import { Link } from '@tanstack/react-router';

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-xl px-8 py-16">
      <h1 className="text-xl font-semibold tracking-tight">No such page</h1>
      <p className="mt-2 text-[13px]" style={{ color: 'var(--color-ink-dim)' }}>
        The route you asked for is not part of this controller.
      </p>
      <Link to="/" className="nb-button mt-6" style={{ textDecoration: 'none' }}>
        Back to control plane
      </Link>
    </div>
  );
}
