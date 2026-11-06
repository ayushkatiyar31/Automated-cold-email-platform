'use client';
import { useForm } from 'react-hook-form';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/providers';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
export default function Login(){const {register,handleSubmit}=useForm<{email:string;password:string}>();const {refreshUser}=useAuth();const router=useRouter();const submit=handleSubmit(async values=>{await api('/api/auth/login',{method:'POST',body:JSON.stringify(values)});await refreshUser();router.replace('/dashboard');});return <main className="flex min-h-screen items-center justify-center p-4"><form onSubmit={submit} className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm"><h1 className="text-2xl font-bold">Welcome back</h1>{['email','password'].map((key)=><input key={key} type={key==='password'?key:'email'} {...register(key as 'email')} required placeholder={key[0].toUpperCase()+key.slice(1)} className="mt-4 w-full rounded-lg border px-3 py-3"/>)}<button className="mt-5 w-full rounded-lg bg-indigo-600 py-3 font-semibold text-white">Sign in</button><Link href="/register" className="mt-4 block text-center text-sm text-indigo-600">Create account</Link></form></main>}
