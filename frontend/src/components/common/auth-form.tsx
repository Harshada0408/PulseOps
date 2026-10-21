'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';
import { Logo } from './logo';
import { ThemeToggle } from '@/components/theme-toggle';

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const { signIn, signUp } = useAuth() as any;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const signup = mode === 'signup';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(''); setInfo('');
    if (signup && password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setBusy(true);
    try {
      const r = signup ? await signUp(email.trim(), password, name.trim() || undefined) : await signIn(email.trim(), password);
      if (!r.success) { setError(r.error || 'Something went wrong'); return; }
      if (signup && !r.signedIn) { setInfo(r.message); return; }
      router.replace('/dashboard');
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Something went wrong');
    } finally { setBusy(false); }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="absolute right-4 top-4"><ThemeToggle /></div>
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center"><Logo /></div>
        <form onSubmit={submit} className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm" noValidate>
          <div>
            <h1 className="text-lg font-semibold">{signup ? 'Create your account' : 'Sign in to PulseOps'}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{signup ? 'Start monitoring your APIs in minutes.' : 'Monitor APIs and investigate incidents.'}</p>
          </div>
          {error && <p role="alert" className="rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
          {info && <p role="status" className="rounded-md border border-ok/30 bg-ok/10 px-3 py-2 text-sm text-ok">{info}</p>}
          {signup && (
            <div className="space-y-1.5"><Label htmlFor="name">Name</Label><Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></div>
          )}
          <div className="space-y-1.5"><Label htmlFor="email">Email</Label><Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" autoComplete={signup ? 'new-password' : 'current-password'} required value={password} onChange={(e) => setPassword(e.target.value)} />
            {signup && <p className="text-xs text-muted-foreground">At least 8 characters.</p>}
          </div>
          <Button type="submit" className="w-full" disabled={busy || !email || !password}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}{signup ? 'Create account' : 'Sign in'}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          {signup ? <>Already have an account? <Link href="/login" className="text-primary hover:underline">Sign in</Link></> : <>New here? <Link href="/signup" className="text-primary hover:underline">Create an account</Link></>}
        </p>
      </div>
    </div>
  );
}
