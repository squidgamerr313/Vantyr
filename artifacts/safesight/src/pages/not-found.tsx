import { Link } from 'wouter';
import { ArrowRight } from 'lucide-react';
import { Logo } from '@/components/shell';

export default function NotFound() {
  return (
    <div className="dot-field flex min-h-[100dvh] flex-col px-5 py-6">
      <Logo />
      <div className="m-auto max-w-lg text-center">
        <p className="eyebrow text-lens">Error 404</p>
        <h1 className="mt-4 font-display text-6xl font-semibold leading-none">Nothing in <span className="serif font-normal italic text-lens">frame.</span></h1>
        <p className="mt-4 text-muted-foreground">This page does not exist. The monitor is still where you left it.</p>
        <Link href="/dashboard" className="btn-primary mt-8 px-5 py-2.5 text-sm" data-testid="link-notfound-monitor">Open monitor <ArrowRight className="h-4 w-4" /></Link>
      </div>
    </div>
  );
}
