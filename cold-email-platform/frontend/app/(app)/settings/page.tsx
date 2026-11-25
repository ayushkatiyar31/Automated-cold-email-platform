'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/providers';

type GmailStatus = {
  connected: boolean;
  email: string | null;
  connectedAt: string | null;
};

const oauthErrorMessages: Record<string, string> = {
  access_denied: 'Google access was denied. To connect Gmail, choose your Google account and approve the requested permissions.',
  no_refresh_token: 'Google did not provide a refresh token. Remove this app from your Google Account third-party connections, then try again.',
  invalid_state: 'This authorization request expired or could not be verified. Return to Settings and start a new connection.',
  exchange_failed: 'Google could not complete the authorization. Try again; if it continues, verify your OAuth client and redirect URI in Google Cloud.',
  missing_send_permission: "On Google's screen, tick the checkbox 'Send email on your behalf', then continue."
};

export default function Settings() {
  const { user, refreshUser } = useAuth();
  const params = useSearchParams();
  const gmailResult = params.get('gmail');
  const reason = params.get('reason') ?? '';
  const [name, setName] = useState(user?.name ?? '');
  const [resumeLink, setResumeLink] = useState(user?.resumeLink ?? '');
  const [gmail, setGmail] = useState<GmailStatus>();
  const [message, setMessage] = useState('');
  const [connecting, setConnecting] = useState(false);

  async function loadGmailStatus() {
    const response = await api<{ gmail: GmailStatus }>('/api/gmail/status');
    setGmail(response.gmail);
  }

  useEffect(() => {
    void loadGmailStatus();
  }, [gmailResult]);

  useEffect(() => {
    setName(user?.name ?? '');
    setResumeLink(user?.resumeLink ?? '');
  }, [user]);

  async function saveProfile() {
    await api('/api/auth/profile', { method: 'PATCH', body: JSON.stringify({ name, resumeLink }) });
    await refreshUser();
    setMessage('Profile saved');
  }

  async function connect() {
    setConnecting(true);
    setMessage('');
    try {
      const { url } = await api<{ url: string }>('/api/gmail/auth-url');
      window.location.href = url;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to start Gmail connection');
      setConnecting(false);
    }
  }

  async function disconnect() {
    await api('/api/gmail/disconnect', { method: 'POST' });
    await loadGmailStatus();
    setMessage('Gmail disconnected');
  }

  const errorMessage = reason ? (oauthErrorMessages[reason] ?? 'Gmail connection failed. Try connecting again.') : '';

  return (
    <>
      <h1 className="text-2xl font-bold">Settings</h1>
      {gmailResult && (
        <div className={`mt-5 rounded-lg p-4 ${gmailResult === 'connected' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {gmailResult === 'connected'
            ? `Gmail connected successfully${gmail?.connected && gmail.email ? ` as ${gmail.email}` : ''}`
            : <>{errorMessage || 'Gmail connection failed.'} <button onClick={connect} disabled={connecting} className="ml-2 underline disabled:opacity-50">{connecting ? 'Starting...' : 'Try again'}</button></>}
        </div>
      )}
      {message && <div className="mt-4 text-sm text-indigo-600">{message}</div>}
      <section className="mt-6 max-w-2xl rounded-xl bg-white p-6 shadow-sm">
        <h2 className="font-semibold">Profile</h2>
        <label className="mt-4 block text-sm">Name<input value={name} onChange={event => setName(event.target.value)} className="mt-1 w-full rounded-lg border p-3" /></label>
        <label className="mt-4 block text-sm">Default resume link<input type="url" value={resumeLink} onChange={event => setResumeLink(event.target.value)} className="mt-1 w-full rounded-lg border p-3" /></label>
        <button onClick={saveProfile} className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">Save profile</button>
      </section>
      <section className="mt-6 max-w-2xl rounded-xl bg-white p-6 shadow-sm">
        <h2 className="font-semibold">Gmail</h2>
        <p className="mt-2 text-sm text-slate-500">{gmail?.connected ? `Connected as ${gmail.email}` : 'Not connected'}</p>
        {gmail?.connected ? (
          <button onClick={disconnect} className="mt-4 rounded-lg border px-4 py-2 text-sm">Disconnect Gmail</button>
        ) : (
          <>
            <button onClick={connect} disabled={connecting} className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {connecting ? 'Starting...' : 'Connect Gmail'}
            </button>
            <p className="mt-2 text-sm text-slate-500">On the next screen, tick ALL permission checkboxes, especially 'Send email on your behalf'.</p>
          </>
        )}
      </section>
    </>
  );
}
