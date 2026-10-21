import { notFound } from 'next/navigation';
import Image from 'next/image';
import { getApiV1BaseUrl } from '@/lib/api-url';

interface StatusPageData {
  name: string;
  description?: string;
  brandColor: string;
  logo?: string;
  items: Array<{
    displayName?: string;
    monitor: {
      name: string;
      url: string;
      isActive: boolean;
      uptime: number;
      avgResponseTime: number;
      lastCheck: {
        status: string;
        responseTime: number;
        checkedAt: string;
      } | null;
    };
  }>;
}

async function getStatusPage(slug: string): Promise<StatusPageData | null> {
  try {
    const res = await fetch(`${getApiV1BaseUrl()}/status-pages/public/${slug}`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function PublicStatusPage({ params }: { params: { slug: string } }) {
  const page = await getStatusPage(params.slug);

  if (!page) {
    notFound();
  }

  const overallStatus = page.items.every((item) => item.monitor.lastCheck?.status === 'up')
    ? 'All Systems Operational'
    : page.items.some((item) => item.monitor.lastCheck?.status === 'down')
    ? 'Some Systems Experiencing Issues'
    : 'Partial Outage';

  const isOperational = overallStatus === 'All Systems Operational';

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 bg-grid [mask-image:radial-gradient(ellipse_60%_60%_at_50%_0%,black,transparent)]" />
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-primary/10 blur-[140px]" />

      <div className="relative mx-auto max-w-4xl px-4 py-12">
        {/* Header */}
        <div className="text-center">
          {page.logo && (
            <Image src={page.logo} alt={page.name} className="mx-auto mb-4 h-16" width={200} height={60} />
          )}
          <h1 className="font-display text-4xl font-bold tracking-tight">{page.name}</h1>
          {page.description && (
            <p className="mt-2 text-lg text-muted-foreground">{page.description}</p>
          )}
        </div>

        {/* Overall Status */}
        <div className={`mt-8 rounded-2xl p-6 text-center shadow-lg ${
          isOperational
            ? 'bg-emerald-500/15 border border-emerald-500/20'
            : 'bg-amber-500/15 border border-amber-500/20'
        }`}>
          <div className="flex items-center justify-center gap-3">
            <span className={`h-3 w-3 rounded-full ${isOperational ? 'bg-emerald-400 animate-pulse-dot' : 'bg-amber-400 animate-pulse'}`} />
            <h2 className="font-display text-2xl font-semibold tracking-tight">{overallStatus}</h2>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">Last updated: {new Date().toLocaleString()}</p>
        </div>

        {/* Monitors */}
        <div className="mt-8 space-y-4">
          {page.items.map((item) => {
            const monitor = item.monitor;
            const status = monitor.lastCheck?.status || 'unknown';
            const isUp = status === 'up';

            return (
              <div
                key={monitor.name}
                className="flex items-center justify-between rounded-2xl border border-border/60 bg-card/70 p-6 backdrop-blur-sm transition-all duration-300 hover:border-primary/25 hover:shadow-lg hover:shadow-primary/5"
              >
                <div>
                  <h3 className="font-display text-lg font-semibold tracking-tight">{item.displayName || monitor.name}</h3>
                  <p className="text-sm text-muted-foreground">{monitor.url}</p>
                  <div className="mt-2 flex items-center gap-4 text-sm text-muted-foreground">
                    <span>Uptime: {monitor.uptime.toFixed(2)}%</span>
                    <span>Response: {monitor.avgResponseTime}ms</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block h-3 w-3 rounded-full ${
                      isUp ? 'bg-emerald-400 animate-pulse-dot' : status === 'degraded' ? 'bg-amber-400 animate-pulse' : 'bg-red-400 animate-pulse'
                    }`}
                  />
                  <span
                    className={`font-medium capitalize ${
                      isUp ? 'text-emerald-400' : status === 'degraded' ? 'text-amber-400' : 'text-red-400'
                    }`}
                  >
                    {status}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="mt-12 text-center text-sm text-muted-foreground/60">
          <p>Powered by API Monitor SaaS</p>
        </div>
      </div>
    </div>
  );
}
