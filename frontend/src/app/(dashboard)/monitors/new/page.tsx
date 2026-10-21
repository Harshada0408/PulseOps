'use client';

import { useRouter } from 'next/navigation';
import { Api } from '@/lib/api';
import { MonitorForm } from '@/components/common/monitor-form';
import { PageHeader, Panel } from '@/components/common/ui';
import { useToast } from '@/components/common/toast';

export default function NewMonitorPage() {
  const router = useRouter();
  const toast = useToast();
  return (
    <>
      <PageHeader title="New monitor" description="PulseOps will check this URL on the interval you choose and open an incident when your rules are met." />
      <Panel className="max-w-3xl">
        <MonitorForm submitLabel="Create monitor" onCancel={() => router.push('/monitors')}
          onSubmit={async (input) => { const m = await Api.createMonitor(input); toast('success', 'Monitor created.'); router.push(`/monitors/${m.id}`); }} />
      </Panel>
    </>
  );
}
