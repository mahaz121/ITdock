'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, KeyRound } from 'lucide-react';

function ResetPasswordForm() {
  const token = useSearchParams().get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (password !== confirm) return setMessage('Passwords do not match.');
    setLoading(true); setMessage('');
    try {
      const response = await fetch('/api/auth/reset-password', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ token, new_password:password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || data.error || 'Unable to reset password');
      setSuccess(true); setMessage(data.message);
    } catch (error) { setMessage(error.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="w-full max-w-md rounded-3xl p-8" style={{background:'rgba(255,255,255,0.025)', border:'1px solid rgba(255,255,255,0.09)', boxShadow:'0 24px 80px rgba(0,0,0,0.45)'}}>
      <img src="/logo.png" alt="ITdock logo" className="w-14 h-14 object-contain mx-auto mb-5" />
      <h1 className="text-2xl font-bold text-center">Choose a new password</h1>
      <p className="text-sm text-center mt-2 mb-7" style={{color:'rgba(234,229,236,0.55)'}}>Use at least twelve characters with uppercase, lowercase, and a number.</p>
      {!success && token && <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm"><span className="flex items-center gap-2 mb-2"><KeyRound className="w-4 h-4" />New password</span><input type="password" required minLength={12} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} className="w-full h-11 rounded-xl px-3" /></label>
        <label className="block text-sm"><span className="mb-2 block">Confirm password</span><input type="password" required value={confirm} onChange={e => setConfirm(e.target.value)} className="w-full h-11 rounded-xl px-3" /></label>
        <button disabled={loading} className="w-full h-11 rounded-xl font-semibold text-white disabled:opacity-60" style={{background:'#0d9488'}}>{loading ? 'Resetting…' : 'Reset password'}</button>
      </form>}
      {!token && <p className="text-sm text-center" style={{color:'#f87171'}}>This reset link is invalid.</p>}
      {message && <p className="text-sm text-center mt-5" style={{color:success ? '#5eead4' : '#f87171'}}>{message}</p>}
      <Link href="/" className="flex items-center justify-center gap-2 text-sm mt-6" style={{color:'rgba(234,229,236,0.5)'}}><ArrowLeft className="w-4 h-4" />Back to sign in</Link>
    </div>
  );
}

export default function ResetPasswordPage() {
  return <main className="min-h-screen flex items-center justify-center px-6" style={{background:'#050810', color:'#eae5ec'}}><Suspense fallback={null}><ResetPasswordForm /></Suspense></main>;
}
