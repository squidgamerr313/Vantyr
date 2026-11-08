import { type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { motion } from 'framer-motion';
import { Activity, BookOpen, ClipboardCheck, History, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StorageNotice } from '@/components/storage-notice';

const NAV = [
  { href: '/dashboard', label: 'Monitor', icon: Activity },
  { href: '/events', label: 'Events', icon: History },
  { href: '/review', label: 'Review', icon: ClipboardCheck },
  { href: '/settings', label: 'Settings', icon: SlidersHorizontal },
  { href: '/docs', label: 'Docs', icon: BookOpen },
];

export function LogoMark({ className, inverse = false }: { className?: string; inverse?: boolean }) {
  return (
    <img src={`${import.meta.env.BASE_URL}${inverse ? 'safesight-icon.svg' : 'safesight-icon-ink.svg'}`} width={80} height={80} className={className} alt="" aria-hidden="true" />
  );
}

export function Logo({ inverse = false, compact = false }: { inverse?: boolean; compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5 rounded-lg" data-testid="link-home" aria-label="VANTYR home">
      <LogoMark className="h-8 w-8" inverse={inverse} />
      <span className={cn('font-display text-[19px] font-semibold tracking-tight', compact && 'hidden min-[360px]:inline')}>VANTYR</span>
    </Link>
  );
}

export function AppShell({ children, variant = 'default' }: { children: ReactNode; variant?: 'default' | 'brand' }) {
  const [loc] = useLocation();
  const brand = variant === 'brand';
  return (
    <div className={cn('min-h-[100dvh] overflow-x-clip', brand && 'ss-brand')}>
      <a href="#main" className="skip-link" data-testid="link-skip">Skip to content</a>
      <header className={cn('sticky top-0 z-40', brand ? 'ss-brand-head' : 'border-b border-[hsl(var(--rule))] bg-[hsl(220_30%_98.5%/0.82)] backdrop-blur-xl')}>
        <div className="mx-auto flex h-16 max-w-[1500px] items-center gap-3 px-4 md:gap-6 md:px-6">
          <Logo inverse={brand} compact />
          <nav className="flex min-w-0 items-center gap-0.5 sm:gap-1" aria-label="Main">
            {NAV.map((n) => {
              const active = loc === n.href;
              return (
                <Link key={n.href} href={n.href} data-testid={`link-nav-${n.label.toLowerCase()}`} aria-current={active ? 'page' : undefined} aria-label={n.label}
                  className={cn('relative flex h-16 min-w-11 items-center justify-center gap-1.5 px-2.5 text-sm transition-colors', active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                  <n.icon className={cn('h-4 w-4', active && 'text-lens')} />
                  <span className="sr-only sm:not-sr-only">{n.label}</span>
                  {active && <motion.span layoutId="nav-rule" className="absolute inset-x-1 bottom-0 h-[2px] bg-[hsl(var(--lens))]" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-[1500px] px-4 py-6 md:px-6 md:py-10"><StorageNotice />{children}</main>
    </div>
  );
}

export function PageHeader({ eyebrow, title, sub, right }: { eyebrow: string; title: ReactNode; sub?: string; right?: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }} className="mb-8 flex flex-wrap items-end gap-4 border-b border-[hsl(var(--rule))] pb-6">
      <div className="min-w-0">
        <p className="eyebrow text-lens"><span className="tick" />{eyebrow}</p>
        <h1 className="mt-3 font-display text-4xl font-semibold leading-none md:text-5xl">{title}</h1>
        {sub && <p className="mt-3 max-w-xl text-[15px] text-muted-foreground">{sub}</p>}
      </div>
      {right && <div className="ml-auto flex flex-wrap items-center gap-2">{right}</div>}
    </motion.div>
  );
}

/** Unboxed section: title on a rule, content below. */
export function Panel({ title, icon, right, children, className }: { title?: string; icon?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('min-w-0', className)}>
      {title && (
        <div className="mb-3 flex items-center gap-2 border-b border-[hsl(var(--rule))] pb-2.5">
          {icon && <span className="text-lens">{icon}</span>}
          <h2 className="eyebrow text-foreground">{title}</h2>
          <div className="ml-auto">{right}</div>
        </div>
      )}
      <div>{children}</div>
    </section>
  );
}

export const LEVEL_STYLE: Record<string, string> = {
  low: 'text-[hsl(var(--safe))] bg-[hsl(158_60%_94%)] ring-[hsl(158_50%_80%)]',
  moderate: 'text-[hsl(var(--warn))] bg-[hsl(40_90%_93%)] ring-[hsl(36_80%_76%)]',
  high: 'text-[hsl(var(--hot))] bg-[hsl(352_80%_95%)] ring-[hsl(352_60%_82%)]',
  uncertain: 'text-[hsl(var(--ink)/0.75)] bg-[hsl(var(--muted))] ring-[hsl(var(--rule))]',
};

const LEVEL_DOT: Record<string, string> = { low: 'bg-[hsl(var(--safe))]', moderate: 'bg-[hsl(var(--warn))]', high: 'bg-[hsl(var(--hot))]', uncertain: 'bg-[hsl(var(--ink)/0.45)]' };

export function LevelBadge({ level, testId }: { level: string; testId?: string }) {
  return (
    <span data-testid={testId} className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wider ring-1', LEVEL_STYLE[level] ?? LEVEL_STYLE.uncertain)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', LEVEL_DOT[level] ?? LEVEL_DOT.uncertain)} />
      {level}
    </span>
  );
}

export function SourceBadge({ source }: { source: 'live' | 'demo' }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider ring-1',
      source === 'live' ? 'text-[hsl(var(--lens-deep))] ring-[hsl(234_60%_84%)] bg-[hsl(234_80%_97%)]' : 'text-[hsl(var(--sim))] ring-[hsl(262_40%_84%)] bg-[hsl(262_60%_97%)]')}>
      {source === 'live' ? 'Live camera' : 'Simulated'}
    </span>
  );
}
