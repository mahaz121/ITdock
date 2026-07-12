'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Mail } from 'lucide-react';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch('/api/auth/forgot-password', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ email }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || data.error || 'Unable to send reset link');
      setMessage(data.message);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-6" style={{background:'#050810', color:'#eae5ec'}}>
      <div className="w-full max-w-md rounded-3xl p-8" style={{background:'rgba(255,255,255,0.025)', border:'1px solid rgba(255,255,255,0.09)', boxShadow:'0 24px 80px rgba(0,0,0,0.45)'}}>
        <img src="/logo.png" alt="ITdock logo" className="w-14 h-14 object-contain mx-auto mb-5" />
        <h1 className="text-2xl font-bold text-center">Reset your password</h1>
        <p className="text-sm text-center mt-2 mb-7" style={{color:'rgba(234,229,236,0.55)'}}>Enter your account email and we’ll send a secure link that expires in 30 minutes.</p>
        <form onSubmit={submit} className="space-y-4">
          <label className="block text-sm">
            <span className="flex items-center gap-2 mb-2"><Mail className="w-4 h-4" />Email address</span>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} className="w-full h-11 rounded-xl px-3" style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.1)'}} />
          </label>
          <button disabled={loading} className="w-full h-11 rounded-xl font-semibold text-white disabled:opacity-60" style={{background:'#0d9488'}}>{loading ? 'Sending…' : 'Send reset link'}</button>
        </form>
        {message && <p className="text-sm text-center mt-5" style={{color:'#5eead4'}}>{message}</p>}
        <Link href="/" className="flex items-center justify-center gap-2 text-sm mt-6" style={{color:'rgba(234,229,236,0.5)'}}><ArrowLeft className="w-4 h-4" />Back to sign in</Link>
      </div>
    </main>
  );
}
