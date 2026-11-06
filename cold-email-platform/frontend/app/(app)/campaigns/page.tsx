'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Empty } from '@/components/ui';
export default function Campaigns(){
 const [search,setSearch]=useState('');const [status,setStatus]=useState('');const [page,setPage]=useState(1);
 const {data,isLoading}=useQuery({queryKey:['campaigns',search,status,page],queryFn:()=>api<any>(`/api/campaigns?search=${encodeURIComponent(search)}&status=${status}&page=${page}&limit=20`)});
 return <><div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold">Campaigns</h1><Link href="/campaigns/new" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">New campaign</Link></div>
 <div className="mt-6 flex gap-3"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search campaigns" className="max-w-sm rounded-lg border bg-white px-3 py-2"/><select value={status} onChange={e=>setStatus(e.target.value)} className="rounded-lg border bg-white px-3 py-2"><option value="">All statuses</option>{['draft','pending','sending','sent','paused','cancelled','failed'].map(s=><option key={s}>{s}</option>)}</select></div>
 {isLoading?<div className="mt-8 h-40 animate-pulse rounded-xl bg-white"/>:!data?.items.length?<div className="mt-8"><Empty title="No campaigns found"/></div>:<div className="mt-6 overflow-x-auto rounded-xl bg-white"><table className="w-full text-left text-sm"><thead className="border-b text-slate-500"><tr><th className="p-4">Name</th><th>Status</th><th>Sent</th><th>Failed</th><th></th></tr></thead><tbody>{data.items.map((c:any)=><tr key={c._id} className="border-b last:border-0"><td className="p-4 font-medium">{c.name}</td><td className="capitalize">{c.status}</td><td>{c.counts?.sent||0}</td><td>{c.counts?.failed||0}</td><td><Link href={`/campaigns/${c._id}`} className="text-indigo-600">Open</Link></td></tr>)}</tbody></table></div>}
 <div className="mt-4 flex gap-2"><button disabled={page===1} onClick={()=>setPage(p=>p-1)} className="rounded border px-3 py-1">Previous</button><span className="px-2 py-1">Page {page} of {data?.pages||1}</span><button disabled={page>= (data?.pages||1)} onClick={()=>setPage(p=>p+1)} className="rounded border px-3 py-1">Next</button></div></>;
}
