'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api';
import { useRouter } from 'next/navigation';
type User = { id:string; name:string; email:string; resumeLink?:string };
const Auth = createContext<{user:User|null;loading:boolean;refreshUser:()=>Promise<void>;logout:()=>Promise<void>}>({user:null,loading:true,refreshUser:async()=>{},logout:async()=>{}});
export const useAuth = () => useContext(Auth);
export function Providers({children}:{children:React.ReactNode}) {
  const [query] = useState(() => new QueryClient({defaultOptions:{queries:{retry:false}}}));
  const [user,setUser]=useState<User|null>(null); const [loading,setLoading]=useState(true); const router=useRouter();
  async function refreshUser(){try{const d=await api<{user:User}>('/api/auth/me');setUser(d.user);}catch{setUser(null);}finally{setLoading(false);}}
  async function logout(){await api('/api/auth/logout',{method:'POST'}).catch(()=>{});setUser(null);router.replace('/login');}
  useEffect(()=>{refreshUser();},[]);
  return <QueryClientProvider client={query}><Auth.Provider value={{user,loading,refreshUser,logout}}>{children}</Auth.Provider></QueryClientProvider>;
}
