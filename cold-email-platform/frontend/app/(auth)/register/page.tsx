'use client';
import { useForm } from 'react-hook-form';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/providers';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';

export default function Register() {
  const { register, handleSubmit } = useForm<{ name: string; email: string; password: string; rememberMe: boolean }>();
  const { refreshUser } = useAuth();
  const router = useRouter();
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submit = handleSubmit(async values => {
    setError('');
    setSubmitting(true);
    try {
      await api('/api/auth/register', { method: 'POST', body: JSON.stringify(values) });
      await refreshUser();
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create your account.');
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold">Create your account</h1>
        <input {...register('name')} type="text" required minLength={2} maxLength={80} autoComplete="name" placeholder="Name" className="mt-4 w-full rounded-lg border px-3 py-3" />
        <input {...register('email')} type="email" required autoComplete="email" placeholder="Email" className="mt-4 w-full rounded-lg border px-3 py-3" />
        <input {...register('password')} type="password" required minLength={8} maxLength={72} autoComplete="new-password" placeholder="Password" className="mt-4 w-full rounded-lg border px-3 py-3" />
        <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" {...register('rememberMe')} defaultChecked />
          Keep me signed in
        </label>
        {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button disabled={submitting} className="mt-5 w-full rounded-lg bg-indigo-600 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
          {submitting ? 'Creating account...' : 'Create account'}
        </button>
        <Link href="/login" className="mt-4 block text-center text-sm text-indigo-600">Already have an account?</Link>
      </form>
    </main>
  );
}
