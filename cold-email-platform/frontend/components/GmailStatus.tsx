'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type GmailStatusData = {
  gmail: {
    connected: boolean;
    email: string | null;
  };
};

export default function GmailStatus({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<GmailStatusData>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<GmailStatusData>('/api/gmail/status')
      .then(setStatus)
      .catch(() => setStatus(undefined))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="text-xs text-slate-400">Checking Gmail...</div>;
  }

  const connected = status?.gmail.connected;
  const email = status?.gmail.email;

  if (compact) {
    return (
      <div className="rounded-lg border border-slate-200 px-3 py-2">
        <div className="flex items-center gap-2 text-xs">
          <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-slate-300'}`} />
          <span className="font-medium text-slate-700">{connected ? 'Gmail connected' : 'Gmail not connected'}</span>
        </div>
        {connected && <div className="mt-1 truncate text-xs text-slate-500" title={email ?? undefined}>{email}</div>}
      </div>
    );
  }

  return (
    <section className={`rounded-xl border p-5 shadow-sm ${connected ? 'border-green-200 bg-green-50' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 font-semibold">
            <span className={`h-2.5 w-2.5 rounded-full ${connected ? 'bg-green-500' : 'bg-slate-300'}`} />
            {connected ? 'Gmail account connected' : 'No Gmail account connected'}
          </div>
          <p className="mt-2 text-sm text-slate-600">
            {connected ? email : 'Connect Gmail to send campaigns from your account.'}
          </p>
        </div>
        <Link href="/settings" className="shrink-0 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm font-medium text-indigo-700">
          {connected ? 'Manage' : 'Connect Gmail'}
        </Link>
      </div>
    </section>
  );
}
