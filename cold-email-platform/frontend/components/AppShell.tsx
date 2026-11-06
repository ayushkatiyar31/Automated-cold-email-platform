'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/providers';
import { Spinner } from './ui';
export default function AppShell({children}:{children:React.ReactNode}){
  const {user,loading,logout}=useAuth(); const router=useRouter(); const path=usePathname();
  useEffect(()=>{if(!loading&&!user)router.replace('/login');},[loading,user,router]);
  if(loading)return <div className="flex min-h-screen items-center justify-center"><Spinner/></div>; if(!user)return null;
  const links=[['Dashboard','/dashboard'],['Campaigns','/campaigns'],['Templates','/templates'],['Settings','/settings']];
  return <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]"><aside className="border-b bg-white p-4 md:min-h-screen md:border-r"><div className="text-xl font-bold text-indigo-600">ColdSend</div><nav className="mt-6 flex gap-2 overflow-auto md:flex-col">{links.map(([label,href])=> <Link key={href} href={href} className={`rounded-lg px-3 py-2 text-sm font-medium ${path===href?'bg-indigo-50 text-indigo-700':'text-slate-600 hover:bg-slate-100'}`}>{label}</Link>)}</nav><button onClick={logout} className="mt-4 hidden px-3 py-2 text-sm text-slate-500 md:block">Sign out</button></aside><main className="p-4 md:p-8">{children}</main></div>;
}
