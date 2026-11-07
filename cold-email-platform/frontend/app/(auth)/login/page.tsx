'use client';
import { useForm } from 'react-hook-form';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/providers';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';

export default function Login() {
  const { register, handleSubmit } = useForm<{ email: string; password: string }>();
  const { refreshUser } = useAuth();
  const router = useRouter();
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submit = handleSubmit(async values => {
    setError('');
    setSubmitting(true);
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify(values) });
      await refreshUser();
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold">Welcome back</h1>
        <input {...register('email')} type="email" required autoComplete="email" placeholder="Email" className="mt-4 w-full rounded-lg border px-3 py-3" />
        <input {...register('password')} type="password" required autoComplete="current-password" placeholder="Password" className="mt-4 w-full rounded-lg border px-3 py-3" />
        {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button disabled={submitting} className="mt-5 w-full rounded-lg bg-indigo-600 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
          {submitting ? 'Signing in...' : 'Sign in'}
        </button>
        <Link href="/register" className="mt-4 block text-center text-sm text-indigo-600">Create account</Link>
      </form>
    </main>
  );
}
