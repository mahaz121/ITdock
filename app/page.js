'use client';
import CustodyFormsPage from './CustodyFormsPage';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import QRCode from 'qrcode';
import {
  LayoutDashboard, Users, Package, Wrench, Trash2, FileText, Building2,
  Plus, Pencil, LogOut, Settings, Settings2, Download, Eye, EyeOff, Upload, UserX,
  Database, Laptop, Monitor, Keyboard, Mouse, HardDrive, Cable, Cloud, MapPin, Briefcase,
  Check, ChevronsUpDown, ArrowLeft, Clock, Server, Printer, Search, SlidersHorizontal, X,
  Bell, AlertTriangle, RefreshCw, Calendar, Link2, Mail, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  Shield, ShieldCheck, ShieldOff, KeyRound, Info, ExternalLink, CreditCard, FolderOpen,
  Plane, ClipboardList, Copy, UserPlus, UserMinus, Phone, Cpu, Wifi,
  PlusCircle, XCircle, Github, Star, Heart, Coffee, Layers, Zap, Globe
} from 'lucide-react';

// Excel export helper
function downloadXlsx(rows, sheetName, fileName) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, fileName);
}

let apiRequestSequence = 0;

// API helper
const api = {
  token: null,
  setToken(token, sessionId = null) {
    this.token = token;
    if (typeof window !== 'undefined') {
      localStorage.setItem('mahaz_token', token);
      localStorage.removeItem('itdock_token'); // migrate old key
      if (sessionId) { localStorage.setItem('mahaz_session', sessionId); localStorage.removeItem('itdock_session'); }
    }
  },
  getToken() {
    if (!this.token && typeof window !== 'undefined') {
      // migrate: pick up token from old key if new key not set
      this.token = localStorage.getItem('mahaz_token') || localStorage.getItem('itdock_token') || null;
      if (this.token && !localStorage.getItem('mahaz_token')) {
        localStorage.setItem('mahaz_token', this.token);
        localStorage.removeItem('itdock_token');
      }
    }
    return this.token;
  },
  getSessionId() {
    if (typeof window !== 'undefined')
      return localStorage.getItem('mahaz_session') || localStorage.getItem('itdock_session') || null;
    return null;
  },
  clearToken() {
    this.token = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('mahaz_token');
      localStorage.removeItem('mahaz_session');
      localStorage.removeItem('itdock_token');
      localStorage.removeItem('itdock_session');
    }
  },
  async request(method, path, data = null, isFormData = false) {
    const headers = {};
    const token = this.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (!isFormData) headers['Content-Type'] = 'application/json';
    const sessionId = this.getSessionId();
    if (sessionId) headers['X-Session-Id'] = sessionId;
    const options = { method, headers };
    if (data) options.body = isFormData ? data : JSON.stringify(data);
    const shouldTrack = typeof window !== 'undefined' && method === 'GET' && !path.startsWith('dashboard/notifications');
    const requestId = shouldTrack ? ++apiRequestSequence : null;
    if (shouldTrack) {
      window.__itdockActiveRequests = (window.__itdockActiveRequests || 0) + 1;
      window.dispatchEvent(new CustomEvent('itdock:request-change', { detail: { requestId, active: window.__itdockActiveRequests } }));
    }
    try {
    const res = await fetch(`/api/${path}`, options);
    if (res.status === 401) {
      const hadToken = !!this.token;
      this.clearToken();
      if (hadToken) throw new Error('Session expired');
      // No token — this is a login failure; surface the actual server error
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || 'Incorrect username or password.');
    }
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || 'Request failed'); }
    const contentType = res.headers.get('content-type');
    if (contentType?.includes('text/csv')) return res.blob();
    return res.json();
    } finally {
      if (shouldTrack) {
        window.__itdockActiveRequests = Math.max(0, (window.__itdockActiveRequests || 1) - 1);
        window.dispatchEvent(new CustomEvent('itdock:request-change', { detail: { requestId, active: window.__itdockActiveRequests } }));
      }
    }
  },
  get: (path) => api.request('GET', path),
  post: (path, data) => api.request('POST', path, data),
  put: (path, data) => api.request('PUT', path, data),
  delete: (path) => api.request('DELETE', path),
  upload: (path, formData) => api.request('POST', path, formData, true),
};

// ---- Confirm Modal (replaces all window.confirm / confirm() calls) ----
const ConfirmContext = React.createContext(null);

function ConfirmProvider({ children }) {
  const [state, setState] = useState({
    open: false, title: '', description: '', confirmLabel: 'Confirm', variant: 'danger', resolve: null
  });

  const confirm = useCallback((opts) => new Promise(resolve => {
    setState({ open: true, title: opts.title || 'Confirm', description: opts.description || '', confirmLabel: opts.confirmLabel || 'Confirm', variant: opts.variant || 'danger', resolve });
  }), []);

  const handleConfirm = () => setState(s => { const r = s.resolve; r && r(true); return { ...s, open: false }; });
  const handleCancel  = () => setState(s => { const r = s.resolve; r && r(false); return { ...s, open: false }; });

  const confirmBg = state.variant === 'danger' ? '#dc2626' : state.variant === 'warning' ? '#f59e0b' : '#1a1a1a';

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={state.open} onOpenChange={o => { if (!o) handleCancel(); }}>
        <DialogContent className="max-w-sm" style={{background:'#050810', border:'1px solid rgba(255,255,255,0.12)'}}>
          <DialogHeader>
            <DialogTitle style={{color:'#eae5ec'}}>{state.title}</DialogTitle>
            {state.description && <DialogDescription style={{color:'rgba(234,229,236,0.6)'}}>{state.description}</DialogDescription>}
          </DialogHeader>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={handleCancel}
              style={{background:'transparent', color:'rgba(234,229,236,0.8)', border:'1px solid rgba(255,255,255,0.15)', borderRadius:'8px', padding:'8px 16px', fontWeight:500, fontSize:'14px', cursor:'pointer'}}>
              Cancel
            </button>
            <button onClick={handleConfirm}
              style={{background:confirmBg, color:'#ffffff', border:'none', borderRadius:'8px', padding:'8px 16px', fontWeight:500, fontSize:'14px', cursor:'pointer'}}>
              {state.confirmLabel}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

function useConfirm() { return React.useContext(ConfirmContext); }

// Searchable Select Component
function SearchableSelect({ options, value, onChange, placeholder, disabled = false, onCreateNew = null }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  
  const filteredOptions = useMemo(() => {
    if (!search) return options || [];
    return (options || []).filter(opt => 
      (opt.name || '').toLowerCase().includes(search.toLowerCase())
    );
  }, [options, search]);
  
  const selectedOption = (options || []).find(opt => opt.id === value);
  
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between font-normal" disabled={disabled}>
          {selectedOption ? selectedOption.name : placeholder}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0" align="start">
        <Command>
          <CommandInput placeholder={`Search...`} value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>
              {onCreateNew ? (
                <Button variant="ghost" className="w-full" onClick={() => { setOpen(false); onCreateNew(search); }}>
                  <Plus className="h-4 w-4 mr-2" /> Create New
                </Button>
              ) : 'No results found.'}
            </CommandEmpty>
            <CommandGroup>
              {filteredOptions.map((opt) => (
                <CommandItem key={opt.id} value={opt.name} onSelect={() => { onChange(opt.id); setOpen(false); setSearch(''); }}>
                  <Check className={`mr-2 h-4 w-4 ${value === opt.id ? "opacity-100" : "opacity-0"}`} />
                  {opt.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// Error Boundary — shows actual crash message in-panel instead of full-page Next.js error
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(err) { return { error: err }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, color: '#f87171', fontFamily: 'monospace' }}>
          <p style={{ fontWeight: 700, marginBottom: 8 }}>Render error (share this with the developer):</p>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, color: '#fca5a5' }}>{String(this.state.error)}{'\n\n'}{this.state.error?.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// Filter Bar Component
function FilterBar({ filters, filterOptions, onFilterChange, onClear, showCompany = true, showProject = true, showLocation = true, showDepartment = true }) {
  const hasFilters = Object.values(filters).some(v => v && v !== '__all__');
  const handleChange = (key, value) => onFilterChange(key, value === '__all__' ? '' : value);
  
  return (
    <div className="flex flex-wrap items-center gap-3 mb-4 p-3 rounded-xl" style={{background: '#0a0e17', border: '1px solid rgba(255,255,255,0.06)'}}>
      <SlidersHorizontal className="h-4 w-4" style={{color: 'rgba(234,229,236,0.4)'}} />
      {showCompany && filterOptions.companies?.length > 0 && (
        <Select value={filters.company_id || '__all__'} onValueChange={(v) => handleChange('company_id', v)}>
          <SelectTrigger className="w-36 h-9"><SelectValue placeholder="Company" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Companies</SelectItem>
            {filterOptions.companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {showProject && filterOptions.projects?.length > 0 && (
        <Select value={filters.project_id || '__all__'} onValueChange={(v) => handleChange('project_id', v)}>
          <SelectTrigger className="w-36 h-9"><SelectValue placeholder="Project" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Projects</SelectItem>
            {filterOptions.projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {showLocation && filterOptions.locations?.length > 0 && (
        <Select value={filters.location_id || '__all__'} onValueChange={(v) => handleChange('location_id', v)}>
          <SelectTrigger className="w-36 h-9"><SelectValue placeholder="Location" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Locations</SelectItem>
            {filterOptions.locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {showDepartment && filterOptions.departments?.length > 0 && (
        <Select value={filters.department_id || '__all__'} onValueChange={(v) => handleChange('department_id', v)}>
          <SelectTrigger className="w-36 h-9"><SelectValue placeholder="Department" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Departments</SelectItem>
            {filterOptions.departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {hasFilters && <Button variant="ghost" size="sm" onClick={onClear} className="h-9"><X className="h-4 w-4 mr-1" /> Clear</Button>}
    </div>
  );
}

// Landing Page
function MahazLandingPage({ onLogin }) {
  // Login modal state
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [totpSession, setTotpSession] = useState(null);
  const [totpCode, setTotpCode] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  const openLogin = () => { setLoginOpen(true); setTotpSession(null); setTotpCode(''); setLoginEmail(''); setLoginPassword(''); };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginLoading(true);
    api.clearToken();
    try {
      const res = await api.post('auth/login', { identifier: loginEmail, password: loginPassword });
      if (res.requires_totp) {
        setTotpSession(res.totp_session);
      } else {
        api.setToken(res.token, res.session_id);
        setLoginOpen(false);
        onLogin(res.user);
        toast.success('Welcome to ITdock!');
      }
    } catch (err) { toast.error(err.message); }
    finally { setLoginLoading(false); }
  };

  const handleTotpLogin = async (e) => {
    e.preventDefault();
    setLoginLoading(true);
    try {
      const res = await api.post('auth/totp/login', { totp_session: totpSession, totp_code: totpCode });
      api.setToken(res.token, res.session_id);
      setLoginOpen(false);
      onLogin(res.user);
      toast.success('Welcome to ITdock!');
    } catch (err) {
      toast.error(err.message);
      if (err.message.includes('expired')) { setTotpSession(null); setTotpCode(''); }
    }
    finally { setLoginLoading(false); }
  };

  const features = [
    { icon: Monitor, title: 'Asset Tracking', desc: 'Track every physical asset from purchase to retirement — serial numbers, warranties, locations, all in one view.' },
    { icon: Users, title: 'Employee Management', desc: 'Link assets to people. See who has what, handle vacation coverage, and manage resignations cleanly.' },
    { icon: Bell, title: 'Smart Alerts', desc: 'Get notified before warranties expire, subscriptions renew, or billing dates hit. Never miss a deadline.' },
    { icon: ShieldCheck, title: 'Enterprise Security', desc: 'TOTP 2FA, session management, account lockout, idle timeout, and scoped API keys.' },
    { icon: Layers, title: 'Category System', desc: 'Physical, subscription, and consumable assets each behave differently. ITdock knows the difference.' },
    { icon: Download, title: 'Excel Export', desc: 'Export any view to a clean Excel file in one click. Your data, your format.' },
    { icon: Package, title: 'Asset Addons', desc: 'Track addon services per asset — billing cycles, renewal dates, and status in one place.' },
    { icon: Cpu, title: 'Hardware Specs', desc: 'Record CPU, RAM, storage, GPU and IP addresses for servers and workstations.' },
    { icon: Phone, title: 'Extension Directory', desc: 'Maintain an internal telephone extension registry with department and location filters.' },
  ];

  const highlights = [
    {
      label: 'Complete visibility',
      headline: 'Every asset.\nAccounted for.',
      desc: 'From laptops to SaaS subscriptions, see the full picture of your IT estate in one clean interface. Assign, track, and retire with full audit history.',
      mockup: (
        <div className="rounded-2xl p-5" style={{background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)'}}>
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-semibold" style={{color:'rgba(234,229,236,0.5)'}}>ASSETS — 48 total</span>
            <span className="text-xs px-2 py-0.5 rounded-full" style={{background:'rgba(94,234,212,0.12)', color:'#5eead4'}}>Live</span>
          </div>
          {[
            {tag:'AST-001',name:'MacBook Pro 14"',user:'J. Smith',status:'Assigned',color:'#34C759'},
            {tag:'AST-002',name:'Dell PowerEdge R740',user:'IT Dept',status:'In Stock',color:'#5eead4'},
            {tag:'AST-003',name:'Adobe Creative Cloud',user:'Design',status:'Active',color:'#34C759'},
            {tag:'AST-004',name:'Cisco Switch 24P',user:'Server Room',status:'Assigned',color:'#34C759'},
          ].map((a,i) => (
            <div key={i} className="flex items-center justify-between py-2.5" style={{borderBottom: i < 3 ? '1px solid rgba(255,255,255,0.05)' : 'none'}}>
              <div>
                <p className="text-sm font-medium" style={{color:'#eae5ec'}}>{a.name}</p>
                <p className="text-xs" style={{color:'rgba(234,229,236,0.4)'}}>{a.tag} · {a.user}</p>
              </div>
              <span className="text-xs px-2.5 py-0.5 rounded-full font-medium" style={{background:`${a.color}18`, color:a.color}}>{a.status}</span>
            </div>
          ))}
        </div>
      ),
    },
    {
      label: 'Instant insights',
      headline: 'Dashboard that\nactually works.',
      desc: 'KPI cards, asset distribution, category breakdowns and monthly trends — all on one screen. No configuration needed.',
      mockup: (
        <div className="rounded-2xl p-5" style={{background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)'}}>
          <div className="text-xs font-semibold mb-4" style={{color:'rgba(234,229,236,0.5)'}}>DASHBOARD OVERVIEW</div>
          <div className="grid grid-cols-2 gap-2.5 mb-4">
            {[{label:'Total Assets',val:'48',color:'#5eead4'},{label:'Assigned',val:'31',color:'#34C759'},{label:'Expiring Soon',val:'3',color:'#FF9500'},{label:'In Maintenance',val:'2',color:'#FF3B30'}].map((s,i) => (
              <div key={i} className="p-3 rounded-xl" style={{background:'#0a0e17'}}>
                <p className="text-xl font-bold" style={{color:s.color}}>{s.val}</p>
                <p className="text-xs mt-0.5" style={{color:'rgba(234,229,236,0.55)'}}>{s.label}</p>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <div className="text-xs mb-1.5" style={{color:'rgba(234,229,236,0.4)'}}>BY CATEGORY</div>
            {[{name:'Laptops',pct:62},{name:'Subscriptions',pct:24},{name:'Peripherals',pct:14}].map(r => (
              <div key={r.name}>
                <div className="flex justify-between text-xs mb-1" style={{color:'rgba(234,229,236,0.6)'}}>
                  <span>{r.name}</span><span>{r.pct}%</span>
                </div>
                <div className="h-1.5 rounded-full" style={{background:'rgba(255,255,255,0.06)'}}>
                  <div className="h-1.5 rounded-full bg-[#0d9488]" style={{width:`${r.pct}%`}} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ),
    },
    {
      label: 'Never miss a renewal',
      headline: 'Subscriptions\nunder control.',
      desc: 'Track billing dates, warranty expirations, addon renewals, and SaaS cycles. Colour-coded alerts surface problems before they happen.',
      mockup: (
        <div className="rounded-2xl p-5" style={{background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)'}}>
          <div className="text-xs font-semibold mb-4" style={{color:'rgba(234,229,236,0.5)'}}>UPCOMING RENEWALS</div>
          {[
            {name:'Adobe Creative Cloud',date:'Apr 15',days:3,color:'#FF3B30'},
            {name:'GitHub Enterprise',date:'Apr 20',days:8,color:'#FF9500'},
            {name:'Cloudflare Pro',date:'Apr 28',days:16,color:'#34C759'},
            {name:'Zoom Business',date:'May 5',days:23,color:'#5eead4'},
          ].map((r,i) => (
            <div key={i} className="flex items-center justify-between py-2.5" style={{borderBottom: i < 3 ? '1px solid rgba(255,255,255,0.05)' : 'none'}}>
              <div>
                <p className="text-sm font-medium" style={{color:'#eae5ec'}}>{r.name}</p>
                <p className="text-xs" style={{color:'rgba(234,229,236,0.4)'}}>{r.date}</p>
              </div>
              <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold" style={{background:`${r.color}18`, color:r.color}}>{r.days}d</span>
            </div>
          ))}
        </div>
      ),
    },
  ];

  // Intersection Observer for fade-up
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => entries.forEach(el => { if (el.isIntersecting) el.target.classList.add('visible'); }),
      { threshold: 0.12 }
    );
    document.querySelectorAll('.fade-up').forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="min-h-screen" style={{background:'#050810', fontFamily:'Geist, -apple-system, BlinkMacSystemFont, sans-serif'}}>
      {/* Ambient background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{zIndex:0}}>
        <div className="absolute" style={{top:'-10%', right:'-5%', width:700, height:700, borderRadius:'50%', background:'radial-gradient(circle, rgba(94,234,212,0.05) 0%, transparent 65%)'}} />
        <div className="absolute" style={{bottom:'-10%', left:'-5%', width:500, height:500, borderRadius:'50%', background:'radial-gradient(circle, rgba(13,148,136,0.04) 0%, transparent 65%)'}} />
      </div>

      {/* ── Nav ── */}
      <nav className="sticky top-0 z-50" style={{background:'rgba(5,8,16,0.88)', backdropFilter:'blur(20px)', WebkitBackdropFilter:'blur(20px)', borderBottom:'1px solid rgba(255,255,255,0.07)'}}>
        <div className="flex items-center justify-between px-6 sm:px-10 h-14 max-w-7xl mx-auto">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="ITdock" style={{width:32, height:32, borderRadius:8, objectFit:'contain'}} />
            <span className="text-base font-bold" style={{color:'#eae5ec'}}>ITdock</span>
          </div>
          <div className="hidden md:flex items-center gap-7">
            {[['Features','#features'],['About','/about']].map(([label,href]) => (
              <a key={label} href={href} className="text-sm font-medium transition-colors" style={{color:'rgba(234,229,236,0.55)'}}
                onMouseEnter={e=>e.target.style.color='#5eead4'} onMouseLeave={e=>e.target.style.color='rgba(234,229,236,0.55)'}>{label}</a>
            ))}
            <a href="https://github.com/mahaz121" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm font-medium" style={{color:'rgba(234,229,236,0.55)'}}
              onMouseEnter={e=>e.currentTarget.style.color='#5eead4'} onMouseLeave={e=>e.currentTarget.style.color='rgba(234,229,236,0.55)'}>
              <Github className="h-3.5 w-3.5" />GitHub
            </a>
          </div>
          <button onClick={openLogin} className="px-5 py-2 rounded-full text-sm font-semibold text-white transition-all"
            style={{background:'#0d9488', boxShadow:'0 2px 10px rgba(94,234,212,0.25)'}}>
            Sign In
          </button>
        </div>
      </nav>

      {/* ── 1. Hero ── */}
      <section className="relative z-10 flex flex-col items-center justify-center text-center px-6 pt-24 pb-24">
        <div className="fade-up max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-8 text-xs font-semibold" style={{background:'rgba(94,234,212,0.10)', color:'#5eead4', border:'1px solid rgba(94,234,212,0.2)'}}>
            <span className="w-1.5 h-1.5 rounded-full bg-[#0d9488] animate-pulse" />
            Free &amp; Open Source IT Asset Management
          </div>
          <h1 className="font-bold mb-6 leading-tight tracking-tight" style={{fontSize:'clamp(2.5rem,6.5vw,4.25rem)', color:'#eae5ec'}}>
            IT asset management.<br />
            <span style={{background:'linear-gradient(90deg, #5eead4, #0d9488)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent'}}>Built for your team.</span>
          </h1>
          <p className="max-w-xl mx-auto mb-10 text-lg leading-relaxed" style={{color:'rgba(234,229,236,0.6)'}}>
            Track every asset, employee, and subscription in one place. Open source, self-hosted, production ready.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button onClick={openLogin} className="px-8 py-3.5 rounded-full text-base font-semibold text-white"
              style={{background:'#0d9488', boxShadow:'0 4px 18px rgba(94,234,212,0.35)'}}>
              Get Started — It's Free
            </button>
            <a href="#features" className="px-8 py-3.5 rounded-full text-base font-semibold"
              style={{color:'#5eead4', border:'1.5px solid rgba(94,234,212,0.3)', textDecoration:'none'}}>
              See Features ↓
            </a>
          </div>
        </div>

        {/* Hero mockup */}
        <div className="fade-up mt-16 w-full max-w-2xl mx-auto">
          <div className="rounded-3xl p-6" style={{background:'rgba(255,255,255,0.025)', border:'1px solid rgba(255,255,255,0.07)', boxShadow:'0 16px 64px rgba(0,0,0,0.6)'}}>
            <div className="flex items-center gap-2 mb-5 pb-4" style={{borderBottom:'1px solid rgba(255,255,255,0.06)'}}>
              <img src="/logo.png" alt="ITdock logo" className="w-7 h-7 object-contain" />
              <span className="text-sm font-bold" style={{color:'#eae5ec'}}>ITdock</span>
              <span className="text-xs ml-1" style={{color:'rgba(234,229,236,0.35)'}}>Dashboard</span>
              <div className="ml-auto flex gap-1.5">{['#FF3B30','#FF9500','#34C759'].map(c=><div key={c} className="w-2.5 h-2.5 rounded-full" style={{background:c}} />)}</div>
            </div>
            <div className="grid grid-cols-4 gap-3 mb-5">
              {[{l:'Total',v:'48',c:'#5eead4'},{l:'Assigned',v:'31',c:'#34C759'},{l:'Expiring',v:'3',c:'#FF9500'},{l:'Maintenance',v:'2',c:'#FF3B30'}].map((s,i)=>(
                <div key={i} className="p-3 rounded-xl text-center" style={{background:'#0a0e17'}}>
                  <p className="text-xl font-bold" style={{color:s.c}}>{s.v}</p>
                  <p className="text-xs mt-0.5" style={{color:'rgba(234,229,236,0.5)'}}>{s.l}</p>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              {[
                {tag:'AST-001',n:'MacBook Pro 14"',u:'J. Smith',s:'Assigned',c:'#34C759'},
                {tag:'AST-002',n:'Adobe Creative Cloud',u:'IT Dept',s:'Active',c:'#5eead4'},
                {tag:'AST-003',n:'Dell PowerEdge R740',u:'Server Room',s:'In Stock',c:'rgba(234,229,236,0.5)'},
              ].map((a,i)=>(
                <div key={i} className="flex items-center justify-between p-2.5 rounded-xl" style={{background:'#0a0e17'}}>
                  <div className="flex items-center gap-2.5">
                    <span className="text-xs font-mono" style={{color:'rgba(234,229,236,0.35)'}}>{a.tag}</span>
                    <span className="text-sm font-medium" style={{color:'#eae5ec'}}>{a.n}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs hidden sm:block" style={{color:'rgba(234,229,236,0.5)'}}>{a.u}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{background:`${a.c}18`,color:a.c}}>{a.s}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── 3. Alternating highlights ── */}
      <section id="highlights" className="relative z-10" style={{background:'#0a0e17'}}>
        {highlights.map((h, i) => (
          <div key={i} className={`flex flex-col ${i % 2 === 0 ? 'md:flex-row' : 'md:flex-row-reverse'} items-center gap-12 px-8 py-20 max-w-6xl mx-auto`}>
            <div className="flex-1 fade-up">
              <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{color:'#5eead4'}}>{h.label}</p>
              <h2 className="font-bold mb-4 leading-tight" style={{fontSize:'clamp(2rem,4vw,2.75rem)', color:'#eae5ec', whiteSpace:'pre-line'}}>{h.headline}</h2>
              <p className="text-base leading-relaxed" style={{color:'rgba(234,229,236,0.6)', maxWidth:400}}>{h.desc}</p>
            </div>
            <div className="flex-1 fade-up w-full max-w-sm mx-auto">{h.mockup}</div>
          </div>
        ))}
      </section>

      {/* ── 4. Feature Grid ── */}
      <section id="features" className="relative z-10 py-24 px-8" style={{background:'#050810'}}>
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14 fade-up">
            <h2 className="font-bold mb-3" style={{fontSize:'clamp(1.75rem,3.5vw,2.5rem)', color:'#eae5ec'}}>Everything your IT team needs</h2>
            <p className="text-base" style={{color:'rgba(234,229,236,0.55)'}}>One platform, zero spreadsheets.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map((f, i) => {
              const Icon = f.icon;
              return (
                <div key={i} className="fade-up p-6 rounded-2xl" style={{background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)'}}>
                  <div className="w-10 h-10 rounded-xl mb-4 flex items-center justify-center" style={{background:'rgba(94,234,212,0.10)'}}>
                    <Icon className="h-5 w-5" style={{color:'#5eead4'}} />
                  </div>
                  <h3 className="font-semibold mb-2 text-sm" style={{color:'#eae5ec'}}>{f.title}</h3>
                  <p className="text-sm leading-relaxed" style={{color:'rgba(234,229,236,0.5)'}}>{f.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── 5. Open Source section ── */}
      <section className="relative z-10 py-20 px-8" style={{background:'#0a0e17'}}>
        <div className="max-w-4xl mx-auto">
          <div className="rounded-2xl p-8 sm:p-12 flex flex-col sm:flex-row items-center gap-8 fade-up"
            style={{background:'linear-gradient(135deg, rgba(94,234,212,0.07), rgba(13,148,136,0.05))', border:'1px solid rgba(94,234,212,0.2)'}}>
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center shrink-0" style={{background:'rgba(94,234,212,0.12)', border:'1px solid rgba(94,234,212,0.2)'}}>
              <Github className="h-8 w-8" style={{color:'#5eead4'}} />
            </div>
            <div className="flex-1 text-center sm:text-left">
              <h2 className="text-2xl font-bold mb-2" style={{color:'#eae5ec'}}>Free &amp; Open Source</h2>
              <p className="text-base leading-relaxed mb-5" style={{color:'rgba(234,229,236,0.6)'}}>
                ITdock is fully open source. Self-host it on your own infrastructure, customize it for your team, or contribute to make it better for everyone.
              </p>
              <div className="flex flex-wrap gap-3 justify-center sm:justify-start">
                <a href="https://github.com/mahaz121" target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold text-white"
                  style={{background:'#0d9488', boxShadow:'0 3px 12px rgba(94,234,212,0.25)', textDecoration:'none'}}>
                  <Github className="h-4 w-4" />View on GitHub
                </a>
                <a href="https://github.com/mahaz121" target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold"
                  style={{color:'#5eead4', border:'1.5px solid rgba(94,234,212,0.3)', textDecoration:'none'}}>
                  <Star className="h-4 w-4" />Star on GitHub
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 7. Support section ── */}
      <section className="relative z-10 py-20 px-8" style={{background:'#0a0e17'}}>
        <div className="max-w-2xl mx-auto text-center fade-up">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-5" style={{background:'rgba(255,100,100,0.12)'}}>
            <Heart className="h-6 w-6" style={{color:'#ff6b6b'}} />
          </div>
          <h2 className="text-2xl font-bold mb-3" style={{color:'#eae5ec'}}>Support the Project</h2>
          <p className="text-base leading-relaxed mb-8" style={{color:'rgba(234,229,236,0.55)'}}>
            ITdock is free, self-hosted, and open source. If it saves your team time, consider supporting its continued development.
          </p>
          <div className="flex gap-3 justify-center flex-wrap">
            <a href="https://ko-fi.com/mahaz" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-6 py-3 rounded-full text-sm font-semibold text-white"
              style={{background:'#0d9488', textDecoration:'none', boxShadow:'0 3px 12px rgba(94,234,212,0.25)'}}>
              <Coffee className="h-4 w-4" />Buy a Coffee
            </a>
            <a href="https://github.com/mahaz121" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-6 py-3 rounded-full text-sm font-semibold"
              style={{color:'#5eead4', border:'1.5px solid rgba(94,234,212,0.3)', textDecoration:'none'}}>
              <Star className="h-4 w-4" />Star on GitHub
            </a>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="relative z-10 px-8 py-8" style={{background:'#0a0e17', borderTop:'1px solid rgba(255,255,255,0.06)'}}>
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="ITdock logo" className="w-7 h-7 object-contain" />
            <span className="font-bold text-sm" style={{color:'#eae5ec'}}>ITdock</span>
            <span className="text-xs px-2 py-0.5 rounded-full ml-1" style={{background:'rgba(94,234,212,0.1)', color:'#5eead4', border:'1px solid rgba(94,234,212,0.2)'}}>Open Source</span>
          </div>
          <div className="flex items-center gap-5">
            {[['Features','#features'],['About','/about'],['GitHub','https://github.com/mahaz121']].map(([label, href]) => (
              <a key={label} href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer"
                className="text-xs" style={{color:'rgba(234,229,236,0.4)', textDecoration:'none'}}>{label}</a>
            ))}
          </div>
          <p className="text-xs" style={{color:'rgba(234,229,236,0.3)'}}>© 2026 Mahaz · MIT License</p>
        </div>
      </footer>

      {/* ── Login Modal ── */}
      <Dialog open={loginOpen} onOpenChange={v => { setLoginOpen(v); if (!v) setTotpSession(null); }}>
        <DialogContent style={{background:'#050810', border:'1px solid rgba(255,255,255,0.10)', color:'#eae5ec', maxWidth:400}}>
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 rounded-xl bg-[#0d9488] flex items-center justify-center" style={{boxShadow:'0 0 14px rgba(94,234,212,0.3)'}}>
                {totpSession ? <KeyRound className="h-5 w-5 text-white" /> : <img src="/logo.png" alt="ITdock logo" className="h-7 w-7 object-contain" />}
              </div>
              <DialogTitle style={{color:'#eae5ec'}}>{totpSession ? 'Two-Factor Auth' : 'Sign in to ITdock'}</DialogTitle>
            </div>
          </DialogHeader>
          {!totpSession ? (
            <form onSubmit={handleLogin} className="space-y-4 mt-2">
              <div>
                <Label className="text-xs mb-1.5 block" style={{color:'rgba(234,229,236,0.6)'}}>Username or Email</Label>
                <Input type="text" placeholder="Enter username or email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} required autoFocus />
              </div>
              <div>
                <Label className="text-xs mb-1.5 block" style={{color:'rgba(234,229,236,0.6)'}}>Password</Label>
                <div className="relative">
                  <Input type={showLoginPassword ? 'text' : 'password'} placeholder="••••••••" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} required className="pr-10" />
                  <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2" onClick={() => setShowLoginPassword(v => !v)}>
                    {showLoginPassword ? <EyeOff className="h-4 w-4" style={{color:'rgba(234,229,236,0.4)'}} /> : <Eye className="h-4 w-4" style={{color:'rgba(234,229,236,0.4)'}} />}
                  </button>
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={loginLoading} style={{background:'#0d9488', color:'#fff'}}>
                {loginLoading ? 'Signing in…' : 'Sign In'}
              </Button>
              <a href="/forgot-password" className="block text-center text-xs hover:underline" style={{color:'rgba(234,229,236,0.5)'}}>Forgot password?</a>
            </form>
          ) : (
            <form onSubmit={handleTotpLogin} className="space-y-4 mt-2">
              <p className="text-sm" style={{color:'rgba(234,229,236,0.6)'}}>Enter the 6-digit code from your authenticator app.</p>
              <div>
                <Label className="text-xs mb-1.5 block" style={{color:'rgba(234,229,236,0.6)'}}>Authentication Code</Label>
                <Input type="text" inputMode="numeric" maxLength={6} placeholder="000000" value={totpCode}
                  onChange={e => setTotpCode(e.target.value.replace(/\D/g,''))} className="text-center text-xl tracking-widest font-mono" autoFocus />
              </div>
              <Button type="submit" className="w-full" disabled={loginLoading || totpCode.length !== 6} style={{background:'#0d9488', color:'#fff'}}>
                {loginLoading ? 'Verifying…' : 'Verify'}
              </Button>
              <button type="button" onClick={() => setTotpSession(null)} className="w-full text-xs text-center" style={{color:'rgba(234,229,236,0.4)'}}>← Back to password</button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Login Page
function LoginPage({ onLogin, onBack }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [totpSession, setTotpSession] = useState(null);
  const [totpCode, setTotpCode] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    api.clearToken(); // ensure stale token never masks wrong-password errors as "Session expired"
    try {
      const res = await api.post('auth/login', { identifier: email, password });
      if (res.requires_totp) {
        setTotpSession(res.totp_session);
      } else {
        api.setToken(res.token, res.session_id);
        onLogin(res.user);
        if (res.user.is_default_password) {
          toast.warning('⚠️ Please change your default password immediately!', { duration: 8000 });
        } else {
          toast.success('Welcome to ITdock!');
        }
      }
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  };

  const handleTotpSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post('auth/totp/login', { totp_session: totpSession, totp_code: totpCode });
      api.setToken(res.token, res.session_id);
      onLogin(res.user);
      toast.success('Welcome to ITdock!');
    } catch (err) {
      toast.error(err.message);
      if (err.message.includes('expired')) { setTotpSession(null); setTotpCode(''); }
    }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4" style={{background:'#0a0e17'}}>
      <style>{`@keyframes loginFadeIn { from { opacity:0; transform:scale(0.97) translateY(8px); } to { opacity:1; transform:scale(1) translateY(0); } }`}</style>
      <div className="w-full max-w-sm" style={{animation:'loginFadeIn 0.25s ease'}}>
        <div className="text-center mb-6">
          {totpSession ? (
            <div className="w-14 h-14 rounded-2xl bg-[#0d9488] mx-auto mb-3 flex items-center justify-center" style={{boxShadow:'0 4px 16px rgba(94,234,212,0.25)'}}>
              <KeyRound className="h-7 w-7 text-white" />
            </div>
          ) : (
            <img src="/logo.png" alt="ITdock logo" className="w-16 h-16 object-contain mx-auto mb-3" />
          )}
          <h1 className="text-2xl font-bold" style={{color:'#eae5ec'}}>ITdock</h1>
          <p className="text-sm mt-1" style={{color:'rgba(234,229,236,0.6)'}}>{totpSession ? 'Two-Factor Authentication' : 'Sign in to your account'}</p>
        </div>
        <div className="rounded-[18px] p-7" style={{background:'#050810', boxShadow:'0 4px 24px rgba(0,0,0,0.4)', border:'1px solid rgba(0,0,0,0.3)'}}>
          {!totpSession ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label className="text-sm font-medium mb-1.5 block" style={{color:'#eae5ec'}}>Username / Email</Label>
                <Input type="text" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin" required />
              </div>
              <div>
                <Label className="text-sm font-medium mb-1.5 block" style={{color:'#eae5ec'}}>Password</Label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              <button type="submit" className="w-full py-3 rounded-full text-sm font-semibold text-white transition-all mt-2"
                style={{background:'#0d9488', boxShadow:'0 2px 8px rgba(94,234,212,0.25)', opacity: loading ? 0.7 : 1}} disabled={loading}>
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
              <p className="text-center text-xs mt-1">
                <a href="/forgot-password" className="hover:underline" style={{color:'rgba(234,229,236,0.4)'}}>
                  Forgot password?
                </a>
              </p>
            </form>
          ) : (
            <form onSubmit={handleTotpSubmit} className="space-y-4">
              <p className="text-sm text-center" style={{color:'rgba(234,229,236,0.6)'}}>Enter the 6-digit code from your authenticator app</p>
              <div>
                <Label className="text-sm font-medium mb-1.5 block" style={{color:'#eae5ec'}}>Authenticator Code</Label>
                <Input type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={totpCode} onChange={(e) => setTotpCode(e.target.value.replace(/\D/g,''))} placeholder="000000" className="text-center text-2xl tracking-[0.5em] font-mono" required autoFocus />
              </div>
              <button type="submit" className="w-full py-3 rounded-full text-sm font-semibold text-white transition-all"
                style={{background:'#0d9488', opacity:(loading || totpCode.length !== 6) ? 0.6 : 1}} disabled={loading || totpCode.length !== 6}>
                {loading ? 'Verifying...' : 'Verify'}
              </button>
              <p className="text-center">
                <button type="button" className="text-xs hover:underline" style={{color:'rgba(234,229,236,0.4)'}} onClick={() => { setTotpSession(null); setTotpCode(''); }}>← Back to sign in</button>
              </p>
            </form>
          )}
        </div>
        {onBack && (
          <p className="text-center text-xs mt-4">
            <button onClick={onBack} className="hover:underline" style={{color:'rgba(234,229,236,0.4)'}}>← Back to home</button>
          </p>
        )}
        <p className="text-center text-xs mt-3" style={{color:'rgba(234,229,236,0.4)'}}>
          © 2026 ITdock · Developed by Mahaz
        </p>
      </div>
    </div>
  );
}

// Notification Bell Component
function NotificationBell({ onNotificationClick }) {
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const [billingDialogOpen, setBillingDialogOpen] = useState(false);
  const [billingAsset, setBillingAsset] = useState(null);
  const [billingData, setBillingData] = useState({ paid: true, new_billing_date: '', notes: '' });
  const [billingLoading, setBillingLoading] = useState(false);

  useEffect(() => { loadNotifications(); }, []);

  const loadNotifications = async () => {
    try {
      const data = await api.get('dashboard/notifications');
      setNotifications(data);
    } catch (err) { console.error('Failed to load notifications'); }
  };

  const openBillingDialog = (e, notif) => {
    e.stopPropagation();
    const nextMonth = notif.renewal_date
      ? new Date(new Date(notif.renewal_date).setMonth(new Date(notif.renewal_date).getMonth() + 1)).toISOString().split('T')[0]
      : new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
    setBillingAsset({ id: notif.asset_id, tag: notif.asset_tag, renewal_date: notif.renewal_date });
    setBillingData({ paid: true, new_billing_date: nextMonth, notes: '' });
    setBillingDialogOpen(true);
  };

  const handleBillingUpdate = async () => {
    if (!billingData.new_billing_date) return toast.error('Please select a new billing date');
    setBillingLoading(true);
    try {
      await api.post('assets/billing-update', { asset_id: billingAsset.id, new_billing_date: billingData.new_billing_date, paid: billingData.paid, notes: billingData.notes });
      toast.success(`Billing date updated to ${billingData.new_billing_date}`);
      setBillingDialogOpen(false);
      loadNotifications();
    } catch (err) { toast.error(err.message); }
    setBillingLoading(false);
  };

  const handleNotificationAction = (notif) => {
    setOpen(false);
    onNotificationClick(notif);
  };

  const criticalCount = notifications.filter(n => n.priority === 'high').length;
  const unreadCount = notifications.length;
  const hasCritical = criticalCount > 0;

  const notifLabel = (n) => {
    if (n.type === 'vacation_ended') return 'Vacation Ended';
    if (n.type === 'warranty_expiry') return n.priority === 'high' ? 'Warranty Critical' : 'Warranty Expiring';
    if (n.type === 'expiry_approaching') return n.priority === 'high' ? 'Expires Soon' : 'Expiry Alert';
    if (n.type === 'renewal_approaching') return n.priority === 'high' ? 'Renewal Critical' : 'Renewal Due';
    if (n.type === 'maintenance_pending') return 'Maintenance Pending';
    if (n.type === 'audit_overdue') return 'Audit Overdue';
    if (n.type === 'addon_renewal') return n.priority === 'high' ? 'Addon Critical' : 'Addon Renewal';
    return 'Notification';
  };

  const daysLabel = (n) => {
    if (n.days_until === null || n.days_until === undefined) return null;
    if (n.days_until === 0) return 'Today';
    if (n.days_until === 1) return 'Tomorrow';
    return `${n.days_until} days`;
  };

  const iconEl = (n) => {
    const isCrit = n.priority === 'high';
    if (n.type === 'vacation_ended') return <Calendar className="h-4 w-4 text-red-600" />;
    if (n.type === 'maintenance_pending') return <Wrench className="h-4 w-4 text-blue-600" />;
    if (n.type === 'renewal_approaching') return <RefreshCw className={`h-4 w-4 ${isCrit ? 'text-red-500' : 'text-yellow-500'}`} />;
    if (n.type === 'audit_overdue') return <ClipboardList className="h-4 w-4 text-red-500" />;
    if (n.type === 'addon_renewal') return <Package className={`h-4 w-4 ${isCrit ? 'text-red-500' : 'text-yellow-500'}`} />;
    return <AlertTriangle className={`h-4 w-4 ${isCrit ? 'text-red-500' : 'text-orange-500'}`} />;
  };

  const iconBg = (n) => {
    if (n.priority === 'high') return 'rgba(248,113,113,0.10)';
    if (n.type === 'renewal_approaching') return 'rgba(251,146,60,0.10)';
    if (n.type === 'maintenance_pending') return 'rgba(94,234,212,0.10)';
    return 'rgba(251,146,60,0.10)';
  };

  return (
    <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="relative">
          <Bell className={`h-5 w-5 ${hasCritical ? 'text-red-400' : ''}`} />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full text-white text-xs flex items-center justify-center font-bold"
              style={{background: hasCritical ? '#FF3B30' : '#FF9500', boxShadow: hasCritical ? '0 0 8px rgba(255,68,68,0.6)' : 'none'}}>
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end" style={{background: '#050810', border: '1px solid rgba(255,255,255,0.10)', boxShadow:'0 8px 32px rgba(0,0,0,0.5)'}}>
        <div className="p-3 flex items-center justify-between" style={{borderBottom: '1px solid rgba(255,255,255,0.06)'}}>
          <h3 className="font-semibold text-sm" style={{color:'#eae5ec'}}>Notifications</h3>
          {hasCritical && (
            <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{background:'rgba(248,113,113,0.12)', color:'#f87171', border:'1px solid rgba(248,113,113,0.2)'}}>
              {criticalCount} CRITICAL
            </span>
          )}
        </div>
        <ScrollArea className="max-h-96">
          {notifications.length === 0 ? (
            <div className="p-6 text-center text-sm" style={{color: 'rgba(234,229,236,0.4)'}}>No notifications</div>
          ) : (
            <div>
              {notifications.map((n, i) => {
                const dl = daysLabel(n);
                const isCrit = n.priority === 'high';
                return (
                  <div key={i} className="p-3 cursor-pointer transition-colors"
                    style={{borderBottom: '1px solid rgba(255,255,255,0.04)', borderLeft: isCrit ? '3px solid #FF3B30' : '3px solid transparent'}}
                    onMouseEnter={e => e.currentTarget.style.background = '#0a0e17'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    onClick={() => handleNotificationAction(n)}>
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 p-1.5 rounded-full flex-shrink-0" style={{background: iconBg(n)}}>
                        {iconEl(n)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium truncate" style={{color:'#eae5ec'}}>{notifLabel(n)}</p>
                          {dl && (
                            <span className="text-xs font-bold flex-shrink-0 px-1.5 py-0.5 rounded" style={{
                              background: isCrit ? 'rgba(248,113,113,0.12)' : 'rgba(251,146,60,0.12)',
                              color: isCrit ? '#FF3B30' : '#FF9500'
                            }}>{dl}</span>
                          )}
                        </div>
                        <p className="text-xs mt-0.5 truncate" style={{color: 'rgba(234,229,236,0.6)'}}>{n.message}</p>
                        <div className="flex items-center justify-between mt-1">
                          <p className="text-xs font-medium" style={{color:'#5eead4'}}>Click to view →</p>
                          {n.type === 'renewal_approaching' && n.asset_id && (
                            <button className="text-xs font-bold px-2 py-0.5 rounded" style={{background:'#0d9488', color:'#fff'}} onClick={(e) => openBillingDialog(e, n)}>
                              Mark Paid
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>

    {/* Confirm Bill Payment Modal */}
    <Dialog open={billingDialogOpen} onOpenChange={setBillingDialogOpen}>
      <DialogContent style={{background:'#050810', border:'1px solid rgba(255,255,255,0.10)', color:'#eae5ec'}}>
        <DialogHeader><DialogTitle>Confirm Bill Payment</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div><p className="text-xs mb-1" style={{color:'rgba(234,229,236,0.5)'}}>Asset</p><p className="text-sm font-medium">{billingAsset?.tag}</p></div>
            <div><p className="text-xs mb-1" style={{color:'rgba(234,229,236,0.5)'}}>Current Billing Date</p><p className="text-sm font-medium">{billingAsset?.renewal_date || '—'}</p></div>
          </div>
          <div>
            <Label className="text-xs mb-1 block" style={{color:'rgba(234,229,236,0.7)'}}>Have you paid this bill?</Label>
            <div className="flex gap-2">
              <button className="flex-1 py-1.5 rounded text-sm font-medium" style={{background: billingData.paid ? '#0d9488' : 'rgba(255,255,255,0.06)', color: billingData.paid ? '#fff' : 'rgba(234,229,236,0.5)'}} onClick={() => setBillingData(d => ({...d, paid: true}))}>Yes</button>
              <button className="flex-1 py-1.5 rounded text-sm font-medium" style={{background: !billingData.paid ? '#FF3B30' : 'rgba(255,255,255,0.06)', color: !billingData.paid ? '#fff' : 'rgba(234,229,236,0.5)'}} onClick={() => setBillingData(d => ({...d, paid: false}))}>No</button>
            </div>
          </div>
          <div>
            <Label className="text-xs mb-1 block" style={{color:'rgba(234,229,236,0.7)'}}>Next Billing Date <span style={{color:'#FF3B30'}}>*</span></Label>
            <Input type="date" value={billingData.new_billing_date} onChange={e => setBillingData(d => ({...d, new_billing_date: e.target.value}))} style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.12)', color:'#eae5ec'}} />
          </div>
          <div>
            <Label className="text-xs mb-1 block" style={{color:'rgba(234,229,236,0.7)'}}>Payment Notes (optional)</Label>
            <Input placeholder="Invoice number, amount, etc." value={billingData.notes} onChange={e => setBillingData(d => ({...d, notes: e.target.value}))} style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.12)', color:'#eae5ec'}} />
          </div>
        </div>
        <DialogFooter className="mt-4">
          <Button variant="ghost" onClick={() => setBillingDialogOpen(false)} style={{color:'rgba(234,229,236,0.6)'}}>Cancel</Button>
          <Button onClick={handleBillingUpdate} disabled={billingLoading} style={{background:'#0d9488', color:'#fff'}}>{billingLoading ? 'Saving...' : 'Confirm & Update'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

// Password strength helper
function getPasswordStrength(pw) {
  if (!pw) return { score: 0, label: '', color: '' };
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const levels = [
    { label: '', color: '' },
    { label: 'Very Weak', color: '#FF3B30' },
    { label: 'Weak', color: '#FF8800' },
    { label: 'Fair', color: '#FF9500' },
    { label: 'Strong', color: '#34C759' },
    { label: 'Very Strong', color: '#5eead4' },
  ];
  return { score, ...levels[score] };
}

// Force password change modal — shown after login if is_default_password
function ForcePasswordChangeModal({ onPasswordChanged }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const strength = getPasswordStrength(next);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (next !== confirm) { toast.error('Passwords do not match'); return; }
    setLoading(true);
    try {
      await api.post('auth/change-password', { current_password: current, new_password: next });
      toast.success('Password changed successfully');
      onPasswordChanged();
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center" style={{background:'rgba(0,0,0,0.5)', backdropFilter:'blur(6px)'}}>
      <div className="w-full max-w-md rounded-[18px] p-8" style={{background:'#050810', border:'1px solid rgba(255,149,0,0.25)', boxShadow:'0 8px 48px rgba(0,0,0,0.48)'}}>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{background:'rgba(251,146,60,0.12)', border:'1px solid rgba(251,146,60,0.2)'}}>
            <KeyRound className="h-5 w-5" style={{color:'#FF9500'}} />
          </div>
          <div>
            <h2 className="text-lg font-bold" style={{color:'#eae5ec'}}>Change Default Password</h2>
            <p className="text-xs" style={{color:'rgba(234,229,236,0.6)'}}>You must set a new password before continuing</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div><Label className="text-sm mb-1.5 block">Current Password</Label>
            <Input type="password" value={current} onChange={e => setCurrent(e.target.value)} placeholder="Enter current password" required />
          </div>
          <div><Label className="text-sm mb-1.5 block">New Password</Label>
            <Input type="password" value={next} onChange={e => setNext(e.target.value)} placeholder="Min 8 chars, upper, lower, number" required />
            {next && (
              <div className="mt-2">
                <div className="flex gap-1 mb-1">{[1,2,3,4,5].map(i => (
                  <div key={i} className="h-1 flex-1 rounded-full transition-all" style={{background: i <= strength.score ? strength.color : 'rgba(255,255,255,0.10)'}} />
                ))}</div>
                <p className="text-xs" style={{color: strength.color}}>{strength.label}</p>
              </div>
            )}
          </div>
          <div><Label className="text-sm mb-1.5 block">Confirm New Password</Label>
            <Input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Repeat new password" required />
          </div>
          <Button type="submit" className="w-full bg-[#0d9488] hover:bg-[#0062CC] mt-2" disabled={loading || strength.score < 3}>
            {loading ? 'Changing...' : 'Set New Password'}
          </Button>
        </form>
      </div>
    </div>
  );
}

// Security Dialog — 2FA + Active Sessions tabs
function SecurityDialog({ open, onOpenChange, onLogout }) {
  const [activeSecTab, setActiveSecTab] = useState('2fa');
  // 2FA state
  const [totpEnabled, setTotpEnabled] = useState(null);
  const [step, setStep] = useState('idle');
  const [secret, setSecret] = useState('');
  const [otpauthUrl, setOtpauthUrl] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [code, setCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  // Sessions state
  const [sessions, setSessions] = useState([]);
  const [sessLoading, setSessLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  // Change password state
  const [cpCurrent, setCpCurrent] = useState('');
  const [cpNew, setCpNew] = useState('');
  const [cpConfirm, setCpConfirm] = useState('');
  const cpStrength = getPasswordStrength(cpNew);
  // API keys state
  const [apiKeys, setApiKeys] = useState([]);
  const [apiKeysLoading, setApiKeysLoading] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyScopes, setNewKeyScopes] = useState(['read']);
  const [newKeyExpiry, setNewKeyExpiry] = useState('');
  const [createdKey, setCreatedKey] = useState(null); // shown once after creation
  const [keyCopied, setKeyCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    loadTotpStatus();
    loadSessions();
    loadApiKeys();
    setStep('idle'); setCode(''); setDisablePassword('');
    setCpCurrent(''); setCpNew(''); setCpConfirm('');
    setCreatedKey(null); setNewKeyName(''); setNewKeyScopes(['read']); setNewKeyExpiry('');
  }, [open]);

  const loadApiKeys = async () => {
    setApiKeysLoading(true);
    try { const d = await api.get('auth/api-keys'); setApiKeys(d); } catch {}
    finally { setApiKeysLoading(false); }
  };

  const createApiKey = async () => {
    if (!newKeyName.trim()) { toast.error('Key name is required'); return; }
    setLoading(true);
    try {
      const res = await api.post('auth/api-keys', {
        name: newKeyName.trim(),
        scopes: newKeyScopes,
        expires_days: newKeyExpiry ? parseInt(newKeyExpiry) : null,
      });
      setCreatedKey(res);
      setApiKeys(k => [{ id: res.id, name: res.name, prefix: res.prefix, scopes: res.scopes, created_at: res.created_at, last_used: null, expires_at: res.expires_at }, ...k]);
      setNewKeyName(''); setNewKeyScopes(['read']); setNewKeyExpiry('');
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  };

  const revokeApiKey = async (id) => {
    try {
      await api.delete(`auth/api-keys/${id}`);
      setApiKeys(k => k.filter(x => x.id !== id));
      toast.success('API key revoked');
    } catch (err) { toast.error(err.message); }
  };

  const copyKey = async (key) => {
    await navigator.clipboard.writeText(key).catch(() => {});
    setKeyCopied(true);
    setTimeout(() => setKeyCopied(false), 2000);
  };

  const changePassword = async () => {
    if (cpNew !== cpConfirm) { toast.error('Passwords do not match'); return; }
    if (cpStrength.score < 3) { toast.error('Password is too weak'); return; }
    setLoading(true);
    try {
      await api.post('auth/change-password', { current_password: cpCurrent, new_password: cpNew });
      toast.success('Password changed');
      setCpCurrent(''); setCpNew(''); setCpConfirm('');
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  };

  const loadTotpStatus = async () => {
    try { const d = await api.get('auth/totp/status'); setTotpEnabled(d.totp_enabled); } catch {}
  };

  const loadSessions = async () => {
    setSessLoading(true);
    try { const d = await api.get('auth/sessions'); setSessions(d); } catch {}
    finally { setSessLoading(false); }
  };

  const startSetup = async () => {
    setLoading(true);
    try {
      const d = await api.post('auth/totp/setup', {});
      const qr = await QRCode.toDataURL(d.otpauth_url, { width: 220, margin: 2, color: { dark: '#050810', light: '#ffffff' } });
      setSecret(d.secret); setOtpauthUrl(d.otpauth_url); setQrDataUrl(qr); setStep('setup');
    }
    catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  };

  const confirmEnable = async () => {
    if (code.length !== 6) { toast.error('Enter the 6-digit code'); return; }
    setLoading(true);
    try { await api.post('auth/totp/enable', { totp_code: code }); toast.success('2FA enabled'); setTotpEnabled(true); setStep('idle'); setCode(''); }
    catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  };

  const confirmDisable = async () => {
    if (!disablePassword) { toast.error('Enter your password'); return; }
    setLoading(true);
    try { await api.post('auth/totp/disable', { password: disablePassword }); toast.success('2FA disabled'); setTotpEnabled(false); setStep('idle'); setDisablePassword(''); }
    catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  };

  const revokeSession = async (sessionId, isCurrent) => {
    try {
      await api.delete(`auth/sessions/${sessionId}`);
      if (isCurrent) { onOpenChange(false); onLogout(); }
      else { setSessions(s => s.filter(x => x.id !== sessionId)); toast.success('Session revoked'); }
    } catch (err) { toast.error(err.message); }
  };

  const fmtDate = (d) => d ? new Date(d).toLocaleString() : '—';
  const shortUA = (ua = '') => {
    if (ua.includes('Chrome')) return 'Chrome';
    if (ua.includes('Firefox')) return 'Firefox';
    if (ua.includes('Safari')) return 'Safari';
    if (ua.includes('Edge')) return 'Edge';
    return ua.slice(0, 30) || 'Unknown';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-[#0071E3]" />Security
          </DialogTitle>
        </DialogHeader>
        <Tabs value={activeSecTab} onValueChange={setActiveSecTab}>
          <TabsList className="w-full">
            <TabsTrigger value="2fa" className="flex-1 text-xs">2FA</TabsTrigger>
            <TabsTrigger value="sessions" className="flex-1 text-xs">Sessions</TabsTrigger>
            <TabsTrigger value="password" className="flex-1 text-xs">Password</TabsTrigger>
            <TabsTrigger value="apikeys" className="flex-1 text-xs">API Keys</TabsTrigger>
          </TabsList>
          <TabsContent value="2fa" className="pt-4 space-y-4">
            {step === 'idle' && (<>
              <div className="flex items-center gap-3 p-4 rounded-xl" style={{background:'#0a0e17', border:'1px solid rgba(255,255,255,0.06)'}}>
                {totpEnabled ? <ShieldCheck className="h-6 w-6 shrink-0" style={{color:'#34C759'}} /> : <ShieldOff className="h-6 w-6 shrink-0" style={{color:'rgba(234,229,236,0.4)'}} />}
                <div>
                  <p className="font-semibold text-sm" style={{color:'#eae5ec'}}>{totpEnabled ? '2FA is enabled' : '2FA is disabled'}</p>
                  <p className="text-xs mt-0.5" style={{color:'rgba(234,229,236,0.6)'}}>{totpEnabled ? 'Your account requires an authenticator code on sign-in.' : 'Add an extra layer of security to your account.'}</p>
                </div>
              </div>
              {!totpEnabled
                ? <Button className="w-full bg-[#0d9488] hover:bg-[#0062CC] text-white" onClick={startSetup} disabled={loading}><Shield className="h-4 w-4 mr-2" />{loading ? 'Generating...' : 'Enable 2FA'}</Button>
                : <Button variant="outline" className="w-full" style={{borderColor:'rgba(255,59,48,0.3)',color:'#FF3B30'}} onClick={() => setStep('disable')}><ShieldOff className="h-4 w-4 mr-2" />Disable 2FA</Button>
              }
            </>)}
            {step === 'setup' && (<>
              <p className="text-sm" style={{color:'rgba(234,229,236,0.6)'}}>Add this to Google Authenticator, Authy, or any TOTP app.</p>
              {qrDataUrl && (
                <div className="flex justify-center">
                  <div className="p-3 rounded-2xl" style={{background:'#fff', boxShadow:'0 0 28px rgba(94,234,212,0.18)'}}>
                    <img src={qrDataUrl} alt="Scan this QR code with your authenticator app" className="w-44 h-44" />
                  </div>
                </div>
              )}
              <div className="p-3 rounded-xl space-y-1" style={{background:'rgba(94,234,212,0.10)', border:'1px solid rgba(94,234,212,0.15)'}}>
                <p className="text-xs" style={{color:'rgba(234,229,236,0.6)'}}>Secret key (manual entry)</p>
                <p className="font-mono text-sm tracking-widest select-all" style={{color:'#eae5ec'}}>{secret}</p>
              </div>
              <div className="p-3 rounded-xl" style={{background:'#0a0e17', border:'1px solid rgba(255,255,255,0.06)'}}>
                <p className="text-xs mb-1" style={{color:'rgba(234,229,236,0.6)'}}>Open in authenticator app</p>
                <a href={otpauthUrl} className="text-xs break-all hover:underline" style={{color:'#5eead4'}}>{otpauthUrl}</a>
              </div>
              <div><Label className="text-sm mb-1.5 block">Enter 6-digit code to confirm</Label>
                <Input type="text" inputMode="numeric" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g,''))} placeholder="000000" className="text-center text-xl tracking-[0.4em] font-mono" autoFocus />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setStep('idle')}>Cancel</Button>
                <Button className="flex-1 bg-[#0d9488] hover:bg-[#0062CC]" onClick={confirmEnable} disabled={loading || code.length !== 6}>{loading ? 'Verifying...' : 'Confirm & Enable'}</Button>
              </div>
            </>)}
            {step === 'disable' && (<>
              <p className="text-sm" style={{color:'rgba(234,229,236,0.6)'}}>Confirm your password to disable 2FA.</p>
              <div><Label className="text-sm mb-1.5 block">Current Password</Label>
                <Input type="password" value={disablePassword} onChange={e => setDisablePassword(e.target.value)} placeholder="Enter password" autoFocus />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setStep('idle')}>Cancel</Button>
                <Button className="flex-1 text-white" style={{background:'#FF3B30'}} onClick={confirmDisable} disabled={loading || !disablePassword}>{loading ? 'Disabling...' : 'Disable 2FA'}</Button>
              </div>
            </>)}
          </TabsContent>
          <TabsContent value="sessions" className="pt-4">
            {sessLoading ? (
              <p className="text-center text-sm py-6" style={{color:'rgba(234,229,236,0.4)'}}>Loading sessions...</p>
            ) : sessions.length === 0 ? (
              <p className="text-center text-sm py-6" style={{color:'rgba(234,229,236,0.4)'}}>No active sessions found</p>
            ) : (
              <div className="space-y-2">
                {sessions.filter(s => !s.is_current).length > 0 && (
                  <div className="flex justify-end mb-1">
                    <Button size="sm" variant="ghost" className="text-xs h-7 px-2" style={{color:'#FF3B30'}}
                      onClick={async () => {
                        try { const r = await api.post('auth/sessions/revoke-all', {}); setSessions(s => s.filter(x => x.is_current)); toast.success(`Revoked ${r.revoked} other session${r.revoked !== 1 ? 's' : ''}`); }
                        catch (err) { toast.error(err.message); }
                      }}>Revoke all others</Button>
                  </div>
                )}
                {sessions.map(s => (
                  <div key={s.id} className="p-3 rounded-xl flex items-start justify-between gap-3" style={{background: s.is_current ? 'rgba(94,234,212,0.10)' : '#0a0e17', border: `1px solid ${s.is_current ? 'rgba(94,234,212,0.2)' : 'rgba(255,255,255,0.06)'}`}}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-sm font-semibold" style={{color:'#eae5ec'}}>{shortUA(s.user_agent)}</p>
                        {s.is_current && <span className="text-xs px-1.5 py-0.5 rounded" style={{background:'#0d9488', color:'white'}}>current</span>}
                      </div>
                      <p className="text-xs" style={{color:'rgba(234,229,236,0.6)'}}>{s.ip} · Last active {fmtDate(s.last_active)}</p>
                      <p className="text-xs" style={{color:'rgba(234,229,236,0.4)'}}>Signed in {fmtDate(s.created_at)}</p>
                    </div>
                    <Button size="sm" variant="ghost" className="shrink-0 text-xs h-7 px-2" style={{color:'#FF3B30'}} onClick={() => revokeSession(s.id, s.is_current)}>
                      {s.is_current ? 'Sign out' : 'Revoke'}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
          <TabsContent value="password" className="pt-4 space-y-4">
            <div><Label className="text-sm mb-1.5 block">Current Password</Label>
              <Input type="password" value={cpCurrent} onChange={e => setCpCurrent(e.target.value)} placeholder="Enter current password" />
            </div>
            <div><Label className="text-sm mb-1.5 block">New Password</Label>
              <Input type="password" value={cpNew} onChange={e => setCpNew(e.target.value)} placeholder="Min 8 chars, upper, lower, number" />
              {cpNew && (
                <div className="mt-2">
                  <div className="flex gap-1 mb-1">{[1,2,3,4,5].map(i => (
                    <div key={i} className="h-1 flex-1 rounded-full transition-all" style={{background: i <= cpStrength.score ? cpStrength.color : 'rgba(255,255,255,0.10)'}} />
                  ))}</div>
                  <p className="text-xs" style={{color: cpStrength.color}}>{cpStrength.label}</p>
                </div>
              )}
            </div>
            <div><Label className="text-sm mb-1.5 block">Confirm New Password</Label>
              <Input type="password" value={cpConfirm} onChange={e => setCpConfirm(e.target.value)} placeholder="Repeat new password" />
            </div>
            <Button className="w-full bg-[#0d9488] hover:bg-[#0062CC]" onClick={changePassword} disabled={loading || !cpCurrent || cpStrength.score < 3 || cpNew !== cpConfirm}>
              {loading ? 'Changing...' : 'Change Password'}
            </Button>
          </TabsContent>

          <TabsContent value="apikeys" className="pt-4 space-y-4">
            {/* Created key reveal — shown once */}
            {createdKey && (
              <div className="p-4 rounded-xl space-y-3" style={{background:'rgba(52,199,89,0.08)', border:'1px solid rgba(52,199,89,0.25)'}}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold" style={{color:'#1B8043'}}>Key created — copy now, it won't be shown again</p>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" style={{color: keyCopied ? '#34C759' : '#0d9488'}} onClick={() => copyKey(createdKey.key)}>
                    {keyCopied ? <Check className="h-3.5 w-3.5 mr-1" /> : <Download className="h-3.5 w-3.5 mr-1" />}
                    {keyCopied ? 'Copied!' : 'Copy'}
                  </Button>
                </div>
                <p className="font-mono text-xs break-all select-all p-2 rounded" style={{background:'#0a0e17', color:'#eae5ec', border:'1px solid rgba(255,255,255,0.06)'}}>{createdKey.key}</p>
                <Button size="sm" variant="ghost" className="text-xs h-6 p-0" style={{color:'rgba(234,229,236,0.4)'}} onClick={() => setCreatedKey(null)}>Dismiss</Button>
              </div>
            )}

            {/* Create new key form */}
            <div className="p-4 rounded-xl space-y-3" style={{background:'#0a0e17', border:'1px solid rgba(255,255,255,0.06)'}}>
              <p className="text-sm font-semibold" style={{color:'#eae5ec'}}>New API Key</p>
              <Input placeholder="Key name (e.g. Integration Bot)" value={newKeyName} onChange={e => setNewKeyName(e.target.value)} className="h-8 text-sm" />
              <div className="flex gap-2 flex-wrap">
                {['read','write','export'].map(s => (
                  <button key={s} type="button" onClick={() => setNewKeyScopes(sc => sc.includes(s) ? sc.filter(x => x !== s) : [...sc, s])}
                    className="text-xs px-3 py-1 rounded-full transition-all"
                    style={{background: newKeyScopes.includes(s) ? 'rgba(94,234,212,0.10)' : '#050810', color: newKeyScopes.includes(s) ? '#0d9488' : '#6E6E73', border: `1px solid ${newKeyScopes.includes(s) ? 'rgba(94,234,212,0.3)' : 'rgba(255,255,255,0.10)'}`}}>
                    {s}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 items-center">
                <Input placeholder="Expires in days (blank = never)" type="number" min="1" value={newKeyExpiry} onChange={e => setNewKeyExpiry(e.target.value)} className="h-8 text-sm flex-1" />
                <Button size="sm" className="bg-[#0d9488] hover:bg-[#0062CC] shrink-0" onClick={createApiKey} disabled={loading || !newKeyName.trim()}>Generate</Button>
              </div>
            </div>

            {/* Existing keys list */}
            {apiKeysLoading ? (
              <p className="text-center text-sm py-4" style={{color:'rgba(234,229,236,0.4)'}}>Loading...</p>
            ) : apiKeys.length === 0 ? (
              <p className="text-center text-sm py-4" style={{color:'rgba(234,229,236,0.4)'}}>No API keys yet</p>
            ) : (
              <div className="space-y-2">
                {apiKeys.map(k => (
                  <div key={k.id} className="p-3 rounded-xl flex items-center justify-between gap-3" style={{background:'#0a0e17', border:'1px solid rgba(255,255,255,0.06)'}}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-sm font-semibold truncate" style={{color:'#eae5ec'}}>{k.name}</p>
                        {k.scopes?.map(s => (
                          <span key={s} className="text-xs px-1.5 py-0.5 rounded" style={{background:'rgba(94,234,212,0.10)', color:'#5eead4'}}>{s}</span>
                        ))}
                      </div>
                      <p className="font-mono text-xs" style={{color:'rgba(234,229,236,0.4)'}}>{k.prefix}</p>
                      <p className="text-xs" style={{color:'rgba(234,229,236,0.6)'}}>
                        Created {new Date(k.created_at).toLocaleDateString()}
                        {k.last_used && ` · Last used ${new Date(k.last_used).toLocaleDateString()}`}
                        {k.expires_at && ` · Expires ${new Date(k.expires_at).toLocaleDateString()}`}
                      </p>
                    </div>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs shrink-0" style={{color:'#FF3B30'}} onClick={() => revokeApiKey(k.id)}>Revoke</Button>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// Sidebar
function Sidebar({ activeTab, setActiveTab, user, onLogout, notificationCount }) {
  const [twoFactorOpen, setTwoFactorOpen] = useState(false);
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'assets', label: 'Assets', icon: Monitor },
    { id: 'employees', label: 'Employees', icon: Users },
    { id: 'extensions', label: 'Extensions', icon: Phone },
    { id: 'company-emails', label: 'Company Emails', icon: Mail },
    { id: 'assignments', label: 'Assignments', icon: Link2 },
    { id: 'custody', label: 'Custody Forms', icon: FileText },
    { id: 'maintenance', label: 'Maintenance', icon: Wrench },
    { id: 'scrap', label: 'Scrap', icon: Trash2 },
  ];

  if (['super_admin', 'it_admin'].includes(user.role)) {
    menuItems.push({ id: 'vacation', label: 'Vacation', icon: Plane });
    menuItems.push({ id: 'audits', label: 'Audits', icon: ClipboardList });
    menuItems.push({ id: 'master', label: 'Master Data', icon: Database });
    menuItems.push({ id: 'settings', label: 'Settings', icon: Settings });
  }
  if (user.role === 'super_admin') {
    menuItems.push({ id: 'users', label: 'Users', icon: Settings2 });
  }

  menuItems.push({ id: 'about', label: 'About Author', icon: Info });

  const handleNavClick = (id) => setActiveTab(id);

  return (
    <aside className="w-64 h-screen sticky top-0 flex flex-col shrink-0 z-20" style={{background: '#050810', borderRight: '1px solid rgba(255,255,255,0.08)', color:'#eae5ec'}}>
      <div className="p-5" style={{borderBottom: '1px solid rgba(255,255,255,0.06)'}}>
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => handleNavClick('dashboard')}>
          <img src="/logo.png" alt="ITdock" style={{width:36, height:36, borderRadius:10, objectFit:'contain', flexShrink:0}} />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold" style={{color:'#eae5ec'}}>ITdock</h1>
              <span className="text-xs px-1.5 py-0.5 rounded font-semibold" style={{background:'rgba(94,234,212,0.12)', color:'#5eead4', fontSize:'10px'}}>v3.4</span>
            </div>
            <p className="text-xs" style={{color:'rgba(234,229,236,0.4)'}}>Asset Management</p>
          </div>
        </div>
      </div>
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id || (activeTab === 'employee-detail' && item.id === 'employees') || (activeTab === 'asset-detail' && item.id === 'assets');
          return (
            <button key={item.id} onClick={() => handleNavClick(item.id)}
              className="w-full flex items-center gap-3 py-2.5 rounded-lg transition-all duration-150 text-left"
              style={isActive
                ? {background:'rgba(94,234,212,0.10)', borderLeft:'3px solid #5eead4', color:'#5eead4', paddingLeft:'9px', paddingRight:'12px'}
                : {color:'rgba(234,229,236,0.6)', borderLeft:'3px solid transparent', paddingLeft:'9px', paddingRight:'12px'}}>
              <Icon className="h-4 w-4 shrink-0" />
              <span className="text-sm font-medium flex-1">{item.label}</span>
              {item.badge > 0 && <span className="text-xs font-bold text-white px-1.5 py-0.5 rounded-full" style={{background:'#FF3B30', minWidth:'18px', textAlign:'center'}}>{item.badge}</span>}
            </button>
          );
        })}
      </nav>
      <div className="p-4" style={{borderTop: '1px solid rgba(255,255,255,0.06)'}}>
        <div className="flex items-center justify-between mb-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate" style={{color:'#eae5ec'}}>{user.name}</p>
            <p className="text-xs" style={{color:'rgba(234,229,236,0.6)'}}>{user.role.replace(/_/g, ' ')}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Security" onClick={() => setTwoFactorOpen(true)} style={{color:'rgba(234,229,236,0.6)'}}>
              <Shield className="h-4 w-4" />
            </Button>
            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{background:'rgba(94,234,212,0.10)', color:'#5eead4'}}>{user.role.split('_')[0]}</span>
          </div>
        </div>
        <Button variant="outline" className="w-full text-sm" style={{borderColor:'rgba(255,255,255,0.10)', color:'rgba(234,229,236,0.6)'}} onClick={onLogout}>
          <LogOut className="h-4 w-4 mr-2" />Sign Out
        </Button>
      </div>
      <SecurityDialog open={twoFactorOpen} onOpenChange={setTwoFactorOpen} onLogout={onLogout} />
    </aside>
  );
}

// Dashboard
function BarRow({ label, count, max, color = '#5eead4' }) {
  const pct = max > 0 ? Math.max(Math.round((count / max) * 100), 2) : 0;
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <div className="text-xs truncate" style={{color:'rgba(234,229,236,0.6)', width:'112px', flexShrink:0}} title={label}>{label}</div>
      <div className="flex-1 h-1.5 rounded-full" style={{background:'#0a0e17'}}>
        <div className="h-1.5 rounded-full transition-all duration-700" style={{width:`${pct}%`, background:color}} />
      </div>
      <div className="text-xs font-semibold" style={{color:'#eae5ec', width:'28px', textAlign:'right', flexShrink:0}}>{count}</div>
    </div>
  );
}

function Dashboard({ onNavigate, onNavigateToBills }) {
  const [stats, setStats] = useState(null);
  const [charts, setCharts] = useState(null);
  const [bills, setBills] = useState([]);
  const [billingDialogOpen, setBillingDialogOpen] = useState(false);
  const [billingAsset, setBillingAsset] = useState(null);
  const [billingData, setBillingData] = useState({ paid: true, new_billing_date: '', notes: '' });
  const [billingLoading, setBillingLoading] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [statsData, chartsData, billsData] = await Promise.all([
        api.get('dashboard/stats'),
        api.get('dashboard/charts'),
        api.get('dashboard/bills')
      ]);
      setStats(statsData);
      setCharts(chartsData);
      setBills(billsData || []);
    } catch (err) { toast.error('Failed to load dashboard'); }
  };

  const openBillingDialog = (e, b) => {
    e.stopPropagation();
    const nextMonth = b.renewal_date
      ? new Date(new Date(b.renewal_date).setMonth(new Date(b.renewal_date).getMonth() + 1)).toISOString().split('T')[0]
      : new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
    setBillingAsset({ id: b.id, tag: b.asset_tag, renewal_date: b.renewal_date });
    setBillingData({ paid: true, new_billing_date: nextMonth, notes: '' });
    setBillingDialogOpen(true);
  };

  const handleBillingUpdate = async () => {
    if (!billingData.new_billing_date) return toast.error('Please select a new billing date');
    setBillingLoading(true);
    try {
      await api.post('assets/billing-update', { asset_id: billingAsset.id, new_billing_date: billingData.new_billing_date, paid: billingData.paid, notes: billingData.notes });
      toast.success(`Billing date updated to ${billingData.new_billing_date}`);
      setBillingDialogOpen(false);
      loadData();
    } catch (err) { toast.error(err.message); }
    setBillingLoading(false);
  };

  const exportXlsx = async () => {
    try {
      const assets = await api.get('assets');
      const rows = assets.map(a => ({
        'Asset Tag': a.asset_tag || '',
        'Category': a.category_name || a.category || '',
        'Serial Number': a.serial_number || '',
        'Brand': a.brand || '',
        'Status': a.status || '',
        'Location': a.location_name || '',
        'Assigned To': a.assigned_to === 'company' ? 'Company' : (a.employee_name || ''),
        'Warranty': a.warranty_applicable || '',
        'Warranty End': a.warranty_end_date || '',
        'Renewal Date': a.renewal_date || '',
        'Notes': a.notes || '',
      }));
      downloadXlsx(rows, 'Assets', `itdock_assets_${new Date().toISOString().slice(0,10)}.xlsx`);
      toast.success('Excel file downloaded');
    } catch (err) { toast.error('Export failed'); }
  };

  const getLast6Months = () => {
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleString('default', { month: 'short' });
      months.push({ key, label });
    }
    return months;
  };

  const STATUS_COLORS = {
    'In Stock': '#34C759',
    'Assigned': '#5eead4',
    'Temporarily Assigned': '#5AC8FA',
    'Handed Over (Vacation Coverage)': '#FF9500',
    'In Maintenance': '#FF6B35',
    'Scrapped': '#8E8E93'
  };

  if (!stats || !charts) return (
    <div className="p-8 flex items-center justify-center h-64">
      <p style={{color:'rgba(234,229,236,0.4)'}}>Loading dashboard...</p>
    </div>
  );

  const totalStatusCount = (charts.status_breakdown || []).reduce((s, i) => s + i.count, 0);
  const maxCategory = Math.max(...(charts.category_breakdown || []).map(c => c.count), 1);
  const maxLocation = Math.max(...(charts.location_breakdown || []).map(l => l.count), 1);

  const last6Months = getLast6Months();
  const monthlyMap = Object.fromEntries((charts.monthly_additions || []).map(m => [m.month, m.count]));
  const monthlyData = last6Months.map(m => ({ ...m, count: monthlyMap[m.key] || 0 }));
  const maxMonthly = Math.max(...monthlyData.map(m => m.count), 1);

  const KpiCard = ({ label, value, color, sub, onClick, icon: Icon }) => (
    <Card className={onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''} onClick={onClick}>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium mb-1" style={{color:'rgba(234,229,236,0.6)'}}>{label}</p>
            <p className="text-3xl font-bold" style={{color}}>{value ?? '—'}</p>
            {sub && <p className="text-xs mt-1" style={{color:'rgba(234,229,236,0.4)'}}>{sub}</p>}
          </div>
          {Icon && <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{background:`${color}18`}}><Icon className="h-4 w-4" style={{color}} /></div>}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="p-8 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold" style={{color:'#eae5ec'}}>Dashboard</h1>
        <Button onClick={exportXlsx} variant="outline" size="sm"><Download className="h-4 w-4 mr-2" />Export Excel</Button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard label="Total Assets" value={stats.total_assets} color="#0d9488" icon={Monitor} onClick={() => onNavigate('assets')} sub="Click to view all" />
        <KpiCard label="Assigned" value={stats.assigned_assets} color="#0d9488" icon={Users} onClick={() => onNavigate('assignments')} sub="Active assignments" />
        <KpiCard label="In Stock" value={stats.in_stock_assets} color="#34C759" icon={Package} onClick={() => onNavigate('assets')} sub="Available assets" />
        <KpiCard label="On Vacation" value={stats.employees_on_vacation ?? 0} color="#FF9500" icon={Calendar} onClick={() => onNavigate('vacation')} sub="Employees away" />
        <KpiCard label="Remote Work Assets" value={stats.remote_work_assets ?? 0} color="#FF9500" icon={Plane} onClick={() => onNavigate('vacation')} sub="On vacation remote" />
        <KpiCard label="Bills Due" value={charts.renewals_due} color={charts.renewals_due > 0 ? '#FF3B30' : '#34C759'} icon={Bell} sub="This week" onClick={onNavigateToBills} />
        <KpiCard label="Audits Due" value={stats.audits_due ?? 0} color={stats.audits_due > 0 ? '#FF9500' : '#34C759'} icon={ClipboardList} onClick={() => onNavigate('audits')} sub="Physical assets" />
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Status breakdown */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold" style={{color:'#eae5ec'}}>Assets by Status</CardTitle></CardHeader>
          <CardContent>
            {/* Segmented bar */}
            <div className="flex rounded-full overflow-hidden h-3 mb-4" style={{gap:'1px'}}>
              {(charts.status_breakdown || []).filter(s => s.count > 0).map(s => (
                <div key={s.status} title={`${s.status}: ${s.count}`}
                  style={{width:`${(s.count/totalStatusCount)*100}%`, background: STATUS_COLORS[s.status] || '#8E8E93', minWidth:'3px'}} />
              ))}
            </div>
            {/* Legend */}
            <div className="space-y-2">
              {(charts.status_breakdown || []).map(s => (
                <div key={s.status} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{background: STATUS_COLORS[s.status] || '#8E8E93'}} />
                    <span className="text-xs" style={{color:'rgba(234,229,236,0.6)'}}>{s.status}</span>
                  </div>
                  <span className="text-xs font-semibold" style={{color:'#eae5ec'}}>{s.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Category breakdown */}
        <Card className="lg:col-span-3">
          <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold" style={{color:'#eae5ec'}}>Assets by Category</CardTitle></CardHeader>
          <CardContent>
            {(charts.category_breakdown || []).length === 0
              ? <p className="text-sm" style={{color:'rgba(234,229,236,0.4)'}}>No data yet</p>
              : (charts.category_breakdown || []).map((c, i) => (
                  <BarRow key={c.name} label={c.name} count={c.count} max={maxCategory}
                    color={i === 0 ? '#0d9488' : i === 1 ? '#34C759' : i === 2 ? '#FF9500' : '#5AC8FA'} />
                ))
            }
          </CardContent>
        </Card>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Location breakdown */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold" style={{color:'#eae5ec'}}>Assets by Location</CardTitle></CardHeader>
          <CardContent>
            {(charts.location_breakdown || []).length === 0
              ? <p className="text-sm" style={{color:'rgba(234,229,236,0.4)'}}>No location data yet</p>
              : (charts.location_breakdown || []).map(l => (
                  <BarRow key={l.name} label={l.name} count={l.count} max={maxLocation} color="#0d9488" />
                ))
            }
          </CardContent>
        </Card>

        {/* Monthly additions */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold" style={{color:'#eae5ec'}}>Monthly Asset Additions</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-end gap-2" style={{height:'120px'}}>
              {monthlyData.map(m => (
                <div key={m.key} className="flex-1 flex flex-col items-center justify-end gap-1">
                  {m.count > 0 && <span className="text-xs font-medium" style={{color:'#5eead4'}}>{m.count}</span>}
                  <div className="w-full rounded-t-md transition-all duration-700"
                    style={{height:`${Math.max((m.count / maxMonthly) * 90, m.count > 0 ? 6 : 2)}px`,
                      background: m.count > 0 ? '#0d9488' : '#0a0e17'}} />
                  <span className="text-xs" style={{color:'rgba(234,229,236,0.4)'}}>{m.label}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bills Due This Week widget */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold" style={{color:'#eae5ec'}}>Bills Due This Week</CardTitle>
          <button onClick={onNavigateToBills} className="text-xs font-medium" style={{color:'#5eead4'}}>View All Due Bills →</button>
        </CardHeader>
        <CardContent>
          {bills.length === 0 ? (
            <p className="text-sm" style={{color:'rgba(234,229,236,0.4)'}}>No bills due this week.</p>
          ) : (
            <div className="space-y-2">
              {bills.map(b => {
                const borderColor = b.days_left < 0 ? '#FF3B30' : b.days_left <= 1 ? '#FF9500' : '#0d9488';
                const badgeText = b.days_left < 0 ? 'OVERDUE' : b.days_left === 0 ? 'Due Today' : b.days_left === 1 ? 'Due Tomorrow' : `Due in ${b.days_left} days`;
                const badgeBg = b.days_left < 0 ? '#FF3B30' : b.days_left <= 1 ? '#FF9500' : '#0d9488';
                return (
                  <div key={b.id} className="flex items-center justify-between p-2.5 rounded-lg cursor-pointer" style={{borderLeft:`3px solid ${borderColor}`, background:'#0a0e17', paddingLeft:'10px'}} onClick={onNavigateToBills}>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate" style={{color:'#eae5ec'}}>
                        {b.provider_url ? <a href={b.provider_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{color:'#5eead4'}} className="flex items-center gap-1">{b.asset_tag} <ExternalLink className="h-3 w-3" /></a> : b.asset_tag}
                      </p>
                      <p className="text-xs truncate" style={{color:'rgba(234,229,236,0.6)'}}>{b.vendor_name || b.brand || '—'}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 ml-3 shrink-0">
                      <span className="text-xs" style={{color:'rgba(234,229,236,0.6)'}}>{b.renewal_date}</span>
                      <span className="text-xs font-bold text-white px-1.5 py-0.5 rounded" style={{background:badgeBg}}>{badgeText}</span>
                      <button className="text-xs font-bold px-2 py-0.5 rounded mt-0.5" style={{background:'#0d9488', color:'#fff'}} onClick={(e) => openBillingDialog(e, b)}>Mark Paid</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirm Bill Payment Modal */}
      <Dialog open={billingDialogOpen} onOpenChange={setBillingDialogOpen}>
        <DialogContent style={{background:'#050810', border:'1px solid rgba(255,255,255,0.10)', color:'#eae5ec'}}>
          <DialogHeader><DialogTitle>Confirm Bill Payment</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-xs mb-1" style={{color:'rgba(234,229,236,0.5)'}}>Asset</p><p className="text-sm font-medium">{billingAsset?.tag}</p></div>
              <div><p className="text-xs mb-1" style={{color:'rgba(234,229,236,0.5)'}}>Current Billing Date</p><p className="text-sm font-medium">{billingAsset?.renewal_date || '—'}</p></div>
            </div>
            <div>
              <Label className="text-xs mb-1 block" style={{color:'rgba(234,229,236,0.7)'}}>Have you paid this bill?</Label>
              <div className="flex gap-2">
                <button className="flex-1 py-1.5 rounded text-sm font-medium" style={{background: billingData.paid ? '#0d9488' : 'rgba(255,255,255,0.06)', color: billingData.paid ? '#fff' : 'rgba(234,229,236,0.5)'}} onClick={() => setBillingData(d => ({...d, paid: true}))}>Yes</button>
                <button className="flex-1 py-1.5 rounded text-sm font-medium" style={{background: !billingData.paid ? '#FF3B30' : 'rgba(255,255,255,0.06)', color: !billingData.paid ? '#fff' : 'rgba(234,229,236,0.5)'}} onClick={() => setBillingData(d => ({...d, paid: false}))}>No</button>
              </div>
            </div>
            <div>
              <Label className="text-xs mb-1 block" style={{color:'rgba(234,229,236,0.7)'}}>Next Billing Date <span style={{color:'#FF3B30'}}>*</span></Label>
              <Input type="date" value={billingData.new_billing_date} onChange={e => setBillingData(d => ({...d, new_billing_date: e.target.value}))} style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.12)', color:'#eae5ec'}} />
            </div>
            <div>
              <Label className="text-xs mb-1 block" style={{color:'rgba(234,229,236,0.7)'}}>Payment Notes (optional)</Label>
              <Input placeholder="Invoice number, amount, etc." value={billingData.notes} onChange={e => setBillingData(d => ({...d, notes: e.target.value}))} style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.12)', color:'#eae5ec'}} />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={() => setBillingDialogOpen(false)} style={{color:'rgba(234,229,236,0.6)'}}>Cancel</Button>
            <Button onClick={handleBillingUpdate} disabled={billingLoading} style={{background:'#0d9488', color:'#fff'}}>{billingLoading ? 'Saving...' : 'Confirm & Update'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const EMPLOYEE_PAGE_SIZE = 40;

function ITdockPageLoader({ label = 'Loading employees', fullScreen = false }) {
  return (
    <div className={`${fullScreen ? 'min-h-screen' : 'min-h-[360px] rounded-xl'} flex items-center justify-center overflow-hidden relative`} style={{background:'#050810'}}>
      <style>{`
        @keyframes pageLoaderOrbit { to { transform: rotate(360deg); } }
        @keyframes pageLoaderPulse { 0%,100% { transform:scale(.96); opacity:.72; } 50% { transform:scale(1.04); opacity:1; } }
        @keyframes pageLoaderScan { 0% { transform:translateX(-110%); } 100% { transform:translateX(310%); } }
        @keyframes pageLoaderBlink { 0%,100% { opacity:.3; } 50% { opacity:1; } }
      `}</style>
      <div className="absolute inset-0 opacity-30" style={{backgroundImage:'linear-gradient(rgba(94,234,212,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(94,234,212,.035) 1px, transparent 1px)', backgroundSize:'36px 36px', maskImage:'radial-gradient(circle at center, black, transparent 68%)'}} />
      <div className="text-center relative z-10">
        <div className="relative w-24 h-24 mx-auto mb-6 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full" style={{border:'1px solid rgba(94,234,212,.12)', boxShadow:'0 0 45px rgba(13,148,136,.16)'}} />
          <div className="absolute inset-2 rounded-full" style={{border:'1px solid transparent', borderTopColor:'#5eead4', borderRightColor:'rgba(94,234,212,.18)', animation:'pageLoaderOrbit 1.6s linear infinite'}} />
          <div className="absolute inset-5 rounded-full" style={{background:'rgba(94,234,212,.055)', border:'1px solid rgba(94,234,212,.14)', animation:'pageLoaderPulse 2s ease-in-out infinite'}} />
          <img src="/logo.png" alt="ITdock logo" className="w-12 h-12 object-contain relative z-10" />
        </div>
        <p className="text-sm font-semibold tracking-[0.22em] uppercase" style={{color:'#eae5ec'}}>{label}</p>
        <div className="w-44 h-px mx-auto mt-4 overflow-hidden" style={{background:'rgba(94,234,212,.12)'}}>
          <div className="w-16 h-full" style={{background:'linear-gradient(90deg, transparent, #5eead4, transparent)', animation:'pageLoaderScan 1.45s ease-in-out infinite'}} />
        </div>
        <div className="flex justify-center gap-1.5 mt-4" aria-hidden="true">
          {[0,1,2].map(index => <span key={index} className="w-1 h-1 rounded-full" style={{background:'#5eead4', animation:`pageLoaderBlink 1.2s ${index * .18}s ease-in-out infinite`}} />)}
        </div>
      </div>
    </div>
  );
}

function GlobalRequestLoader() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let showTimer = null;
    const update = (event) => {
      const active = event?.detail?.active ?? window.__itdockActiveRequests ?? 0;
      if (active > 0) {
        if (!showTimer) showTimer = setTimeout(() => setVisible(true), 180);
      } else {
        if (showTimer) clearTimeout(showTimer);
        showTimer = null;
        setVisible(false);
      }
    };
    window.addEventListener('itdock:request-change', update);
    update();
    return () => {
      window.removeEventListener('itdock:request-change', update);
      if (showTimer) clearTimeout(showTimer);
    };
  }, []);

  if (!visible) return null;
  return <div className="fixed inset-0 z-[100]"><ITdockPageLoader label="Loading ITdock" fullScreen /></div>;
}

// Employees List
function EmployeesList({ user, onViewEmployee, onCreateEmployee, onAssignAsset }) {
  const [employees, setEmployees] = useState([]);
  const [filterOptions, setFilterOptions] = useState({});
  const [filters, setFilters] = useState({});
  const [searchTerm, setSearchTerm] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({});
  const [vacationDialogOpen, setVacationDialogOpen] = useState(false);
  const [resignDialogOpen, setResignDialogOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [inlineEditId, setInlineEditId] = useState(null);
  const [inlineEditData, setInlineEditData] = useState({});
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importRows, setImportRows] = useState([]);
  const [importPreview, setImportPreview] = useState(null);
  const [importFileName, setImportFileName] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalEmployees, setTotalEmployees] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [employeeLoading, setEmployeeLoading] = useState(true);
  const employeeLoadRequest = React.useRef(0);
  const confirm = useConfirm();

  const canEdit = ['super_admin', 'it_admin'].includes(user.role);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchTerm(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => { loadFilterOptions(); }, []);
  useEffect(() => { loadData(); }, [filters, debouncedSearchTerm, showArchived, currentPage]);

  const loadFilterOptions = async () => {
    try { setFilterOptions(await api.get('filters')); }
    catch (err) { console.error('Failed to load employee filters', err); }
  };

  const loadData = async () => {
    const requestId = ++employeeLoadRequest.current;
    setEmployeeLoading(true);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
      if (debouncedSearchTerm) params.set('search', debouncedSearchTerm);
      if (showArchived) params.set('archived', 'true');
      params.set('paginated', 'true');
      params.set('page', String(currentPage));
      params.set('page_size', String(EMPLOYEE_PAGE_SIZE));
      const emps = await api.get(`employees?${params.toString()}`);
      if (requestId !== employeeLoadRequest.current) return;
      setEmployees(emps.items || []);
      setTotalEmployees(emps.total || 0);
      setTotalPages(emps.total_pages || 1);
    } catch (err) {
      if (requestId === employeeLoadRequest.current) toast.error('Failed to load employees');
    } finally {
      if (requestId === employeeLoadRequest.current) setEmployeeLoading(false);
    }
  };

  const openDialog = () => {
    setFormData({ name: '', employee_id: '', designation: '', company_id: '', project_id: '', location_id: '', department_id: '', manager_id: '', mobile_number: '', status: 'Active' });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    try {
      await api.post('employees', formData);
      toast.success('Employee created');
      setDialogOpen(false);
      loadFilterOptions();
      loadData();
    } catch (err) { toast.error(err.message); }
  };

  const handleStatusChange = (emp, newStatus) => {
    setSelectedEmployee(emp);
    if (newStatus === 'On Vacation') {
      setVacationDialogOpen(true);
    } else if (newStatus === 'Resigned') {
      setResignDialogOpen(true);
    } else {
      updateStatus(emp.id, newStatus);
    }
  };

  const updateStatus = async (empId, status, extras = {}) => {
    try {
      await api.put(`employees/${empId}`, { status, ...extras });
      toast.success('Status updated');
      loadData();
    } catch (err) { toast.error(err.message); }
  };

  const handleDelete = async (id) => {
    const ok = await confirm({ title: 'Delete Employee', description: 'This employee will be permanently deleted.', confirmLabel: 'Delete' });
    if (!ok) return;
    try { await api.delete(`employees/${id}`); toast.success('Deleted'); loadData(); }
    catch (err) { toast.error(err.message); }
  };

  const startInlineEdit = (emp) => {
    setInlineEditId(emp.id);
    setInlineEditData({ ...emp });
  };

  const cancelInlineEdit = () => {
    setInlineEditId(null);
    setInlineEditData({});
  };

  const saveInlineEdit = async () => {
    if (!inlineEditData.name?.trim()) { toast.error('Name is required'); return; }
    if (inlineEditData.company_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inlineEditData.company_email)) {
      toast.error('Invalid email format'); return;
    }
    try {
      await api.put(`employees/${inlineEditId}`, inlineEditData);
      toast.success('Employee updated');
      setInlineEditId(null);
      setInlineEditData({});
      loadData();
    } catch (err) { toast.error(err.message); }
  };

  const getStatusColor = (s) => {
    if (s === 'Active') return 'bg-green-100 text-green-800';
    if (s === 'On Vacation') return 'bg-orange-100 text-orange-800';
    if (s === 'Resigned') return 'bg-red-100 text-red-800';
    return 'bg-[rgba(255,255,255,0.06)] text-[#eae5ec] border border-white/10';
  };

  const exportEmployees = async () => {
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
      if (debouncedSearchTerm) params.set('search', debouncedSearchTerm);
      if (showArchived) params.set('archived', 'true');
      const exportData = await api.get(`employees?${params.toString()}`);
      const rows = exportData.map(e => ({
      'Name': e.name || '',
      'Employee ID': e.employee_id || '',
      'Position': e.position || '',
      'Work Email': e.company_email || '',
      'Phone': e.phone || '',
      'Department': e.department_name || '',
      'Location': e.location_name || '',
      'Company': e.company_name || '',
      'Project': e.project_name || '',
      'Status': e.status || '',
      'Assets': e.asset_count || 0,
      }));
      downloadXlsx(rows, 'Employees', `mahaz_employees_${new Date().toISOString().slice(0,10)}.xlsx`);
      toast.success('Excel file downloaded');
    } catch (err) { toast.error(err.message); }
  };

  const resetEmployeeImport = () => {
    setImportRows([]);
    setImportPreview(null);
    setImportFileName('');
    setImportLoading(false);
  };

  const handleEmployeeImportFile = async (file) => {
    if (!file) return;
    setImportLoading(true);
    setImportPreview(null);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error('The workbook does not contain a worksheet');
      const parsed = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false }).map(row =>
        Object.fromEntries(Object.entries(row).map(([header, value]) => [String(header).trim(), value]))
      );
      const requiredHeaders = ['Company', 'Department', 'Employee Name', 'Designation', 'Manager', 'Work Phone', 'Employee ID', 'Project'];
      const headers = parsed.length ? Object.keys(parsed[0]).map(header => String(header).trim()) : [];
      const missingHeaders = requiredHeaders.filter(header => !headers.includes(header));
      if (missingHeaders.length) throw new Error(`Missing required columns: ${missingHeaders.join(', ')}`);
      const rows = parsed
        .map(row => Object.fromEntries(requiredHeaders.map(header => [header, String(row[header] ?? '').trim()])))
        .filter(row => requiredHeaders.some(header => row[header]));
      if (!rows.length) throw new Error('The spreadsheet contains no employee rows');
      const preview = await api.post('employees/import', { rows, dry_run: true });
      setImportRows(rows);
      setImportPreview(preview);
      setImportFileName(file.name);
    } catch (err) {
      resetEmployeeImport();
      toast.error(err.message);
    } finally {
      setImportLoading(false);
    }
  };

  const confirmEmployeeImport = async () => {
    if (!importRows.length || importPreview?.issues?.length) return;
    setImportLoading(true);
    try {
      const result = await api.post('employees/import', { rows: importRows, dry_run: false });
      toast.success(`Imported ${result.total} employees: ${result.create_employees} created, ${result.update_employees} updated`);
      setImportDialogOpen(false);
      resetEmployeeImport();
      loadFilterOptions();
      loadData();
    } catch (err) { toast.error(err.message); }
    finally { setImportLoading(false); }
  };

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-white">Employees</h1>
        <div className="flex items-center space-x-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#AEAEB2]" />
            <Input placeholder="Search..." value={searchTerm} onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }} className="pl-10 w-64" />
          </div>
          <div className="flex items-center space-x-2 border rounded-md px-3 py-2">
            <Checkbox id="archived-emp" checked={showArchived} onCheckedChange={(checked) => { setShowArchived(checked); setCurrentPage(1); }} />
            <label htmlFor="archived-emp" className="text-sm text-[#1D1D1F] cursor-pointer">Show Archived</label>
          </div>
          <Button onClick={exportEmployees} variant="outline" size="sm"><Download className="h-4 w-4 mr-2" />Export</Button>
          {canEdit && <Button onClick={() => { resetEmployeeImport(); setImportDialogOpen(true); }} variant="outline" size="sm"><Upload className="h-4 w-4 mr-2" />Import Excel</Button>}
          {canEdit && <Button onClick={openDialog} className="bg-[#0d9488] hover:bg-[#0062CC]"><Plus className="h-4 w-4 mr-2" />Add Employee</Button>}
        </div>
      </div>

      <FilterBar filters={filters} filterOptions={filterOptions} onFilterChange={(k, v) => { setFilters({...filters, [k]: v}); setCurrentPage(1); }} onClear={() => { setFilters({}); setCurrentPage(1); }} />

      {employeeLoading ? <ITdockPageLoader /> : <>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>ID</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Assets</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {employees.map((emp) => (
              <React.Fragment key={emp.id}>
                <TableRow>
                  <TableCell className="font-medium cursor-pointer hover:text-[#0071E3] transition-colors" onClick={() => inlineEditId !== emp.id && onViewEmployee(emp.id)}>{emp.name}</TableCell>
                  <TableCell>{emp.employee_id}</TableCell>
                  <TableCell>{emp.company_name}</TableCell>
                  <TableCell>{emp.project_name || '-'}</TableCell>
                  <TableCell>{emp.location_name}</TableCell>
                  <TableCell>{emp.department_name}</TableCell>
                  <TableCell>
                    {emp.asset_count > 0 ? (
                      <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">{emp.asset_count} {emp.asset_count === 1 ? 'item' : 'items'}</Badge>
                    ) : (
                      <span className="text-[#AEAEB2] text-sm">No assets</span>
                    )}
                  </TableCell>
                  <TableCell><Badge className={getStatusColor(emp.status)}>{emp.status}</Badge></TableCell>
                  <TableCell>
                    <div className="flex space-x-1">
                      {inlineEditId !== emp.id && <Button size="sm" variant="ghost" onClick={() => onViewEmployee(emp.id)}><Eye className="h-4 w-4" /></Button>}
                      {canEdit && inlineEditId !== emp.id && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => onAssignAsset(emp)} title="Assign asset" className="h-8 px-2 text-xs" style={{color:'#5eead4'}}><Link2 className="h-4 w-4 mr-1" />Assign Asset</Button>
                          <Button size="sm" variant="ghost" onClick={() => startInlineEdit(emp)} title="Edit inline"><Pencil className="h-4 w-4" /></Button>
                          <Button size="sm" variant="ghost" onClick={() => handleDelete(emp.id)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                        </>
                      )}
                      {canEdit && inlineEditId === emp.id && (
                        <>
                          <Button size="sm" className="bg-[#0d9488] hover:bg-[#0062CC] text-white h-7 px-2 text-xs" onClick={saveInlineEdit}>Save</Button>
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={cancelInlineEdit}>Cancel</Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
                {inlineEditId === emp.id && (
                  <TableRow>
                    <TableCell colSpan={9} className="p-0">
                      <div className="px-4 py-4" style={{background:'rgba(94,234,212,0.05)', borderTop:'1px solid rgba(94,234,212,0.15)', borderBottom:'1px solid rgba(94,234,212,0.15)'}}>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                          <div>
                            <label className="text-xs block mb-1" style={{color:'rgba(234,229,236,0.6)'}}>Name *</label>
                            <Input className="h-8 text-sm" value={inlineEditData.name || ''} onChange={e => setInlineEditData({...inlineEditData, name: e.target.value})} />
                          </div>
                          <div>
                            <label className="text-xs block mb-1" style={{color:'rgba(234,229,236,0.6)'}}>Position</label>
                            <Input className="h-8 text-sm" value={inlineEditData.position || ''} onChange={e => setInlineEditData({...inlineEditData, position: e.target.value})} placeholder="Job title..." />
                          </div>
                          <div>
                            <label className="text-xs block mb-1" style={{color:'rgba(234,229,236,0.6)'}}>Work Email</label>
                            <Input className="h-8 text-sm" type="email" value={inlineEditData.company_email || ''} onChange={e => setInlineEditData({...inlineEditData, company_email: e.target.value})} placeholder="email@company.com" />
                            <p className="text-[10px] mt-1 leading-snug" style={{color:'rgba(234,229,236,0.4)'}}>Only fill this in if the employee has a company-provided email address.</p>
                          </div>
                          <div>
                            <label className="text-xs block mb-1" style={{color:'rgba(234,229,236,0.6)'}}>Phone</label>
                            <Input className="h-8 text-sm" value={inlineEditData.mobile_number || ''} onChange={e => setInlineEditData({...inlineEditData, mobile_number: e.target.value})} />
                          </div>
                          <div>
                            <label className="text-xs block mb-1" style={{color:'rgba(234,229,236,0.6)'}}>Department</label>
                            <SearchableSelect options={filterOptions.departments || []} value={inlineEditData.department_id} onChange={v => setInlineEditData({...inlineEditData, department_id: v})} placeholder="Select..." />
                          </div>
                          <div>
                            <label className="text-xs block mb-1" style={{color:'rgba(234,229,236,0.6)'}}>Location</label>
                            <SearchableSelect options={filterOptions.locations || []} value={inlineEditData.location_id} onChange={v => setInlineEditData({...inlineEditData, location_id: v})} placeholder="Select..." />
                          </div>
                          <div>
                            <label className="text-xs block mb-1" style={{color:'rgba(234,229,236,0.6)'}}>Project</label>
                            <SearchableSelect options={filterOptions.projects || []} value={inlineEditData.project_id} onChange={v => setInlineEditData({...inlineEditData, project_id: v})} placeholder="Select..." />
                          </div>
                          <div>
                            <label className="text-xs block mb-1" style={{color:'rgba(234,229,236,0.6)'}}>Manager</label>
                            <SearchableSelect options={(filterOptions.managers || []).filter(manager => manager.id !== emp.id)} value={inlineEditData.manager_id} onChange={v => setInlineEditData({...inlineEditData, manager_id: v})} placeholder="Select..." />
                          </div>
                        </div>
                        <div className="flex gap-2 justify-end items-center">
                          <span className="text-xs mr-2" style={{color:'rgba(234,229,236,0.4)'}}>* Name is required</span>
                          <Button size="sm" variant="ghost" onClick={cancelInlineEdit} style={{borderColor:'rgba(255,255,255,0.12)'}}>Cancel</Button>
                          <Button size="sm" className="bg-[#0d9488] hover:bg-[#0062CC] text-white" onClick={saveInlineEdit}>Save Changes</Button>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            ))}
          </TableBody>
        </Table>
      </Card>

      <div className="flex items-center justify-between mt-4">
        <p className="text-sm" style={{color:'rgba(234,229,236,0.55)'}}>
          {totalEmployees === 0 ? 'No employees' : `Showing ${(currentPage - 1) * EMPLOYEE_PAGE_SIZE + 1}-${Math.min(currentPage * EMPLOYEE_PAGE_SIZE, totalEmployees)} of ${totalEmployees}`}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setCurrentPage(page => Math.max(1, page - 1))}><ChevronLeft className="h-4 w-4 mr-1" />Previous</Button>
          <span className="text-sm px-2">Page {currentPage} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(page => Math.min(totalPages, page + 1))}>Next<ChevronRight className="h-4 w-4 ml-1" /></Button>
        </div>
      </div>
      </>}

      {/* Add Employee Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add Employee</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Name *</Label><Input value={formData.name || ''} onChange={(e) => setFormData({...formData, name: e.target.value})} /></div>
            <div><Label>Employee ID *</Label><Input value={formData.employee_id || ''} onChange={(e) => setFormData({...formData, employee_id: e.target.value})} /></div>
            <div><Label>Designation</Label><Input value={formData.designation || ''} onChange={(e) => setFormData({...formData, designation: e.target.value})} /></div>
            <div><Label>Company *</Label>
              <SearchableSelect options={filterOptions.companies || []} value={formData.company_id} onChange={(v) => setFormData({...formData, company_id: v})} placeholder="Select company..." />
            </div>
            <div><Label>Project *</Label>
              <SearchableSelect options={filterOptions.projects || []} value={formData.project_id} onChange={(v) => setFormData({...formData, project_id: v})} placeholder="Select project..." />
            </div>
            <div><Label>Location</Label>
              <SearchableSelect options={filterOptions.locations || []} value={formData.location_id} onChange={(v) => setFormData({...formData, location_id: v})} placeholder="Select location..." />
            </div>
            <div><Label>Department *</Label>
              <SearchableSelect options={filterOptions.departments || []} value={formData.department_id} onChange={(v) => setFormData({...formData, department_id: v})} placeholder="Select department..." />
            </div>
            <div><Label>Manager</Label>
              <SearchableSelect options={filterOptions.managers || []} value={formData.manager_id} onChange={(v) => setFormData({...formData, manager_id: v})} placeholder="Select manager..." />
            </div>
            <div><Label>Mobile Number</Label><Input value={formData.mobile_number || ''} onChange={(e) => setFormData({...formData, mobile_number: e.target.value})} /></div>
            <div><Label>Status</Label>
              <Select value={formData.status || 'Active'} onValueChange={(v) => setFormData({...formData, status: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="On Vacation">On Vacation</SelectItem>
                  <SelectItem value="Resigned">Resigned</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Work Email</Label><Input type="email" value={formData.company_email || ''} onChange={(e) => setFormData({...formData, company_email: e.target.value})} placeholder="name@company.com" /><p className="text-xs mt-1.5" style={{color:'rgba(234,229,236,0.4)'}}>Optional — only enter an address provided by the employee’s company.</p></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} className="bg-[#0d9488] hover:bg-[#0062CC]">Create Employee</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Employee Excel Import */}
      <Dialog open={importDialogOpen} onOpenChange={(open) => { setImportDialogOpen(open); if (!open) resetEmployeeImport(); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import Employees from Excel</DialogTitle>
            <DialogDescription>Upload an Excel file with these columns: Company, Department, Employee Name, Designation, Manager, Work Phone, Employee ID, and Project.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Excel file (.xlsx or .xls)</Label>
              <Input type="file" accept=".xlsx,.xls" disabled={importLoading} onChange={event => handleEmployeeImportFile(event.target.files?.[0])} />
              <p className="text-xs mt-1.5" style={{color:'rgba(234,229,236,0.5)'}}>Existing employees are updated by Employee ID. Empty spreadsheet cells remain empty. Missing master data is created automatically.</p>
            </div>
            {importLoading && <div className="flex items-center gap-2 text-sm"><RefreshCw className="h-4 w-4 animate-spin" />Reading and validating the spreadsheet…</div>}
            {importPreview && <>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {[
                  ['Rows', importPreview.total],
                  ['New employees', importPreview.create_employees],
                  ['Employees updated', importPreview.update_employees],
                  ['Companies created', importPreview.create_companies],
                  ['Departments created', importPreview.create_departments],
                  ['Projects created', importPreview.create_projects],
                  ['Managers not matched', importPreview.unmatched_managers],
                ].map(([label, value]) => <Card key={label}><CardContent className="p-3"><p className="text-xs" style={{color:'rgba(234,229,236,0.5)'}}>{label}</p><p className="text-xl font-semibold">{value}</p></CardContent></Card>)}
              </div>
              {importPreview.issues?.length > 0 ? (
                <Alert className="border-red-500/40 bg-red-500/10">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Fix these spreadsheet issues before importing</AlertTitle>
                  <AlertDescription>
                    <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
                      {importPreview.issues.slice(0, 50).map((issue, index) => <p key={`${issue.row}-${issue.field}-${index}`}>Row {issue.row} · {issue.field}: {issue.message}</p>)}
                      {importPreview.issues.length > 50 && <p>…and {importPreview.issues.length - 50} more issues</p>}
                    </div>
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert className="border-green-500/40 bg-green-500/10"><Check className="h-4 w-4" /><AlertTitle>Ready to import</AlertTitle><AlertDescription>{importFileName} passed validation. Review the preview below, then confirm the import.</AlertDescription></Alert>
              )}
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Employee ID</TableHead><TableHead>Employee Name</TableHead><TableHead>Company</TableHead><TableHead>Department</TableHead><TableHead>Project</TableHead></TableRow></TableHeader>
                  <TableBody>{importRows.slice(0, 8).map((row, index) => <TableRow key={`${row['Employee ID']}-${index}`}><TableCell>{row['Employee ID'] || '—'}</TableCell><TableCell>{row['Employee Name'] || '—'}</TableCell><TableCell>{row.Company || '—'}</TableCell><TableCell>{row.Department || '—'}</TableCell><TableCell>{row.Project || '—'}</TableCell></TableRow>)}</TableBody>
                </Table>
                {importRows.length > 8 && <p className="p-3 text-xs" style={{color:'rgba(234,229,236,0.5)'}}>Showing 8 of {importRows.length} rows.</p>}
              </div>
            </>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)} disabled={importLoading}>Cancel</Button>
            <Button onClick={confirmEmployeeImport} disabled={importLoading || !importPreview || importPreview.issues?.length > 0} className="bg-[#0d9488] hover:bg-[#0062CC]">{importLoading ? 'Importing…' : 'Confirm Import'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Vacation Modal */}
      <VacationModal open={vacationDialogOpen} onOpenChange={setVacationDialogOpen} employee={selectedEmployee} employees={employees} onConfirm={async (data) => {
        try {
          await api.post('vacation/start', data);
          toast.success('Vacation started — assets routed');
          setVacationDialogOpen(false);
          loadData();
        } catch (err) { toast.error(err.message); }
      }} />

      {/* Resign Dialog */}
      <ResignDialog open={resignDialogOpen} onOpenChange={setResignDialogOpen} employee={selectedEmployee} employees={employees} onConfirm={async (action, newEmpId) => {
        try {
          await api.post('assignments/bulk-unassign', { employee_id: selectedEmployee.id, action, new_employee_id: newEmpId });
          await api.put(`employees/${selectedEmployee.id}`, { status: 'Resigned' });
          toast.success('Resignation processed');
          setResignDialogOpen(false);
          loadData();
        } catch (err) { toast.error(err.message); }
      }} />
    </div>
  );
}

// Vacation Dialog
// Legacy VacationDialog — kept for backward compat, new flow uses VacationModal
function VacationDialog({ open, onOpenChange, employee, employees, onConfirm }) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [action, setAction] = useState('return_to_stock');
  const [handoverId, setHandoverId] = useState('');

  const otherEmployees = employees?.filter(e => e.id !== employee?.id && e.status === 'Active').map(e => ({ id: e.id, name: e.name })) || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set Vacation for {employee?.name}</DialogTitle>
          <DialogDescription>Configure vacation dates and asset handling</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Start Date *</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
            <div><Label>End Date *</Label><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
          </div>
          <div>
            <Label>What to do with assigned assets?</Label>
            <RadioGroup value={action} onValueChange={setAction} className="mt-2">
              <div className="flex items-center space-x-2"><RadioGroupItem value="return_to_stock" id="return" /><Label htmlFor="return">Return to Stock</Label></div>
              <div className="flex items-center space-x-2"><RadioGroupItem value="handover" id="handover" /><Label htmlFor="handover">Temporarily assign to another employee</Label></div>
            </RadioGroup>
          </div>
          {action === 'handover' && (
            <div><Label>Handover To *</Label>
              <SearchableSelect options={otherEmployees} value={handoverId} onChange={setHandoverId} placeholder="Select employee..." />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => onConfirm({ vacation_start_date: startDate, vacation_end_date: endDate, vacation_action: action, handover_employee_id: handoverId })}
            className="bg-[#0d9488]" disabled={!startDate || !endDate || (action === 'handover' && !handoverId)}>Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// VacationModal — per-asset routing: stock | employee | remote (no approval needed)
function VacationModal({ open, onOpenChange, employee, preselectedAssetId, employees, onConfirm }) {
  const [vacationStart, setVacationStart] = useState('');
  const [vacationEnd, setVacationEnd] = useState('');
  const [assignedAssets, setAssignedAssets] = useState([]);
  const [assetRoutes, setAssetRoutes] = useState({});
  const [loading, setLoading] = useState(false);

  const otherEmployees = (employees || []).filter(e => e.id !== employee?.id && e.status === 'Active').map(e => ({ id: e.id, name: e.name }));

  useEffect(() => {
    if (!open || !employee?.id) return;
    api.get(`employees/${employee.id}`).then(emp => {
      const assets = emp.assigned_assets || [];
      setAssignedAssets(assets);
      const initial = {};
      assets.forEach(a => { initial[a.id] = { handoverType: 'stock', tempEmployeeId: '', remoteApprovedBy: '', remoteNotes: '' }; });
      setAssetRoutes(initial);
    }).catch(() => {});
  }, [open, employee?.id]);

  const setRoute = (assetId, field, val) => {
    setAssetRoutes(prev => ({ ...prev, [assetId]: { ...(prev[assetId] || {}), [field]: val } }));
  };

  const canSubmit = vacationStart && vacationEnd && assignedAssets.every(a => {
    const r = assetRoutes[a.id] || {};
    if (r.handoverType === 'stock') return true;
    if (r.handoverType === 'employee') return !!r.tempEmployeeId;
    if (r.handoverType === 'remote') return !!r.remoteApprovedBy;
    return true;
  });

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const asset_handovers = assignedAssets.map(a => {
        const r = assetRoutes[a.id] || { handoverType: 'stock' };
        return {
          asset_id: a.id,
          handoverType: r.handoverType || 'stock',
          tempEmployeeId: r.handoverType === 'employee' ? (r.tempEmployeeId || null) : null,
          remoteApprovedBy: r.handoverType === 'remote' ? (r.remoteApprovedBy || '') : null,
          remoteNotes: r.handoverType === 'remote' ? (r.remoteNotes || '') : null,
        };
      });
      await onConfirm({ employee_id: employee.id, vacation_start: vacationStart, vacation_end: vacationEnd, asset_handovers });
    } finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send on Vacation — {employee?.name}</DialogTitle>
          <DialogDescription>Set vacation dates and choose what happens to each assigned asset.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Vacation Start *</Label><Input type="date" value={vacationStart} onChange={e => setVacationStart(e.target.value)} /></div>
            <div><Label>Expected Return *</Label><Input type="date" value={vacationEnd} onChange={e => setVacationEnd(e.target.value)} /></div>
          </div>
          <div>
            <Label className="mb-2 block">Assigned Assets ({assignedAssets.length})</Label>
            {assignedAssets.length === 0 ? (
              <p className="text-sm" style={{color:'rgba(234,229,236,0.4)'}}>No assets assigned to this employee.</p>
            ) : (
              <div className="space-y-3">
                {assignedAssets.map(asset => {
                  const r = assetRoutes[asset.id] || { handoverType: 'stock' };
                  const isPreselected = asset.id === preselectedAssetId;
                  return (
                    <div key={asset.id} className="p-3 rounded-lg" style={{background: isPreselected ? 'rgba(94,234,212,0.08)' : '#0a0e17', border: isPreselected ? '1px solid #93C5FD' : '1px solid rgba(255,255,255,0.06)'}}>
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className="text-sm font-medium">{asset.asset_tag}</p>
                          <p className="text-xs" style={{color:'rgba(234,229,236,0.6)'}}>{asset.category}</p>
                        </div>
                        {isPreselected && <Badge className="bg-blue-100 text-blue-800 text-xs">Pre-selected</Badge>}
                      </div>
                      <RadioGroup value={r.handoverType} onValueChange={v => setRoute(asset.id, 'handoverType', v)} className="flex flex-wrap gap-3">
                        <div className="flex items-center gap-1.5"><RadioGroupItem value="stock" id={`stock-${asset.id}`} /><Label htmlFor={`stock-${asset.id}`} className="text-sm cursor-pointer">Return to Stock</Label></div>
                        <div className="flex items-center gap-1.5"><RadioGroupItem value="employee" id={`emp-${asset.id}`} /><Label htmlFor={`emp-${asset.id}`} className="text-sm cursor-pointer">Hand to Employee</Label></div>
                        <div className="flex items-center gap-1.5"><RadioGroupItem value="remote" id={`remote-${asset.id}`} /><Label htmlFor={`remote-${asset.id}`} className="text-sm cursor-pointer">Remote Work</Label></div>
                      </RadioGroup>
                      {r.handoverType === 'employee' && (
                        <div className="mt-2 space-y-1.5">
                          <SearchableSelect options={otherEmployees} value={r.tempEmployeeId} onChange={v => setRoute(asset.id, 'tempEmployeeId', v)} placeholder="Select receiving employee..." />
                          <p className="text-xs" style={{color:'rgba(234,229,236,0.4)'}}>Upload custody form in Active Vacations tab after submission.</p>
                        </div>
                      )}
                      {r.handoverType === 'remote' && (
                        <div className="mt-2 space-y-2">
                          <Input placeholder="Approved by (manager name) *" value={r.remoteApprovedBy} onChange={e => setRoute(asset.id, 'remoteApprovedBy', e.target.value)} className="text-sm" style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.12)', color:'#eae5ec'}} />
                          <Input placeholder="Reason / notes (optional)" value={r.remoteNotes} onChange={e => setRoute(asset.id, 'remoteNotes', e.target.value)} className="text-sm" style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.12)', color:'#eae5ec'}} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} className="bg-[#FF9500] hover:bg-[#E68900] text-white" disabled={!canSubmit || loading}>
            <Calendar className="h-4 w-4 mr-1.5" />{loading ? 'Submitting...' : 'Submit Vacation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Resign Dialog
function ResignDialog({ open, onOpenChange, employee, employees, onConfirm }) {
  const [action, setAction] = useState('return_to_stock');
  const [newEmpId, setNewEmpId] = useState('');

  const otherEmployees = employees?.filter(e => e.id !== employee?.id && e.status === 'Active').map(e => ({ id: e.id, name: e.name })) || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Process Resignation: {employee?.name}</DialogTitle>
          <DialogDescription>How should the assigned assets be handled?</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <RadioGroup value={action} onValueChange={setAction}>
            <div className="flex items-center space-x-2"><RadioGroupItem value="return_to_stock" id="return2" /><Label htmlFor="return2">Return all assets to Stock</Label></div>
            <div className="flex items-center space-x-2"><RadioGroupItem value="reassign" id="reassign" /><Label htmlFor="reassign">Reassign all assets to another employee</Label></div>
          </RadioGroup>
          {action === 'reassign' && (
            <div><Label>Reassign To *</Label>
              <SearchableSelect options={otherEmployees} value={newEmpId} onChange={setNewEmpId} placeholder="Select employee..." />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => onConfirm(action, newEmpId)} className="bg-red-600 hover:bg-red-700" disabled={action === 'reassign' && !newEmpId}>Confirm Resignation</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Employee Detail
function EmployeeDetail({ employeeId, user, onBack, onViewAsset }) {
  const [employee, setEmployee] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [vacationModalOpen, setVacationModalOpen] = useState(false);
  const [resignDialogOpen, setResignDialogOpen] = useState(false);
  const [returnVacationDialogOpen, setReturnVacationDialogOpen] = useState(false);
  const [extendVacationOpen, setExtendVacationOpen] = useState(false);
  const [extendReason, setExtendReason] = useState('');
  const [extendNewDate, setExtendNewDate] = useState('');
  const [vacationHandovers, setVacationHandovers] = useState([]);

  const canEdit = ['super_admin', 'it_admin'].includes(user?.role);

  useEffect(() => { if (employeeId) loadData(); }, [employeeId]);

  const loadData = async () => {
    try {
      const [empData, empsData] = await Promise.all([
        api.get(`employees/${employeeId}`),
        api.get('employees?status=Active&lightweight=true')
      ]);
      setEmployee(empData);
      setEmployees(empsData);
      if (empData.status === 'On Vacation') {
        api.get(`employees/${employeeId}/vacation`).then(d => setVacationHandovers(d.handovers || [])).catch(() => {});
      }
    } catch (err) { toast.error('Failed to load employee'); }
  };

  const handleVacationSubmit = async (data) => {
    try {
      await api.post('vacation/start', data);
      toast.success('Vacation started — assets routed');
      setVacationModalOpen(false);
      loadData();
    } catch (err) { toast.error(err.message); }
  };

  const handleResignSubmit = async (action, newEmpId) => {
    try {
      await api.post('assignments/bulk-unassign', { employee_id: employeeId, action, new_employee_id: newEmpId });
      await api.put(`employees/${employeeId}`, { status: 'Resigned' });
      toast.success('Resignation processed');
      setResignDialogOpen(false);
      loadData();
    } catch (err) { toast.error(err.message); }
  };

  const handleExtendVacation = async () => {
    if (!extendNewDate || !extendReason) return;
    try {
      await api.post('vacation/extend', { employee_id: employeeId, new_end_date: extendNewDate, reason: extendReason });
      toast.success('Vacation extended');
      setExtendVacationOpen(false);
      setExtendReason(''); setExtendNewDate('');
      loadData();
    } catch (err) { toast.error(err.message); }
  };

  const handleReturnFromVacation = async (action, newEmpId, newEndDate) => {
    try {
      if (action === 'extend') {
        await api.post('vacation/extend', { employee_id: employeeId, new_end_date: newEndDate, reason: 'Vacation extended' });
        toast.success('Vacation extended');
      } else {
        await api.post('assignments/return-from-vacation', { employee_id: employeeId });
        await api.put(`employees/${employeeId}`, { status: 'Active', vacation_status: { onVacation: false } });
        toast.success('Returned from vacation — assets reassigned');
      }
      setReturnVacationDialogOpen(false);
      loadData();
    } catch (err) { toast.error(err.message); }
  };

  if (!employee) return <div className="p-8"><ITdockPageLoader label="Loading employee" /></div>;

  const isOnVacation = employee.status === 'On Vacation';
  const isActive = employee.status === 'Active';
  const vacationEnded = isOnVacation && employee.vacation_end_date && new Date(employee.vacation_end_date) <= new Date();

  return (
    <div className="p-8">
      <Button variant="ghost" onClick={onBack} className="mb-4"><ArrowLeft className="h-4 w-4 mr-2" />Back to Employees</Button>
      
      <div className="grid grid-cols-3 gap-6">
        <Card className="col-span-2">
          <CardHeader className="flex flex-row items-start justify-between">
            <div>
              <CardTitle>{employee.name}</CardTitle>
              <CardDescription>Employee ID: {employee.employee_id}</CardDescription>
            </div>
            {canEdit && (
              <div className="flex gap-2">
                {isActive && (
                  <>
                    <button size="sm" onClick={() => setVacationModalOpen(true)}
                      style={{background:'#f59e0b', color:'#ffffff', border:'none', borderRadius:'8px', padding:'6px 12px', fontWeight:500, fontSize:'13px', cursor:'pointer', display:'flex', alignItems:'center', gap:'4px'}}>
                      <Calendar className="h-4 w-4" />Set Vacation
                    </button>
                    <button size="sm" onClick={() => setResignDialogOpen(true)}
                      style={{background:'#dc2626', color:'#ffffff', border:'none', borderRadius:'8px', padding:'6px 12px', fontWeight:500, fontSize:'13px', cursor:'pointer', display:'flex', alignItems:'center', gap:'4px'}}>
                      <UserX className="h-4 w-4" />Resignation
                    </button>
                  </>
                )}
                {isOnVacation && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setExtendVacationOpen(true)} style={{borderColor:'#FF9500', color:'#FF9500'}}>
                      <Calendar className="h-4 w-4 mr-1" />Extend Vacation
                    </Button>
                    <Button size="sm" className="bg-[#0d9488]" onClick={() => setReturnVacationDialogOpen(true)}>
                      <RefreshCw className="h-4 w-4 mr-1" />Mark Returned
                    </Button>
                  </>
                )}
              </div>
            )}
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-sm text-[#6E6E73]">Company</p><p className="font-medium">{employee.company_name || '-'}</p></div>
              <div><p className="text-sm text-[#6E6E73]">Project</p><p className="font-medium">{employee.project_name || '-'}</p></div>
              <div><p className="text-sm text-[#6E6E73]">Location</p><p className="font-medium">{employee.location_name || '-'}</p></div>
              <div><p className="text-sm text-[#6E6E73]">Department</p><p className="font-medium">{employee.department_name || '-'}</p></div>
              <div><p className="text-sm text-[#6E6E73]">Manager</p><p className="font-medium">{employee.manager_name || '-'}</p></div>
              <div><p className="text-sm text-[#6E6E73]">Mobile</p><p className="font-medium">{employee.mobile_number || '-'}</p></div>
              <div><p className="text-sm text-[#6E6E73]">Status</p><Badge className={employee.status === 'Active' ? 'bg-green-100 text-green-800' : employee.status === 'On Vacation' ? 'bg-orange-100 text-orange-800' : 'bg-red-100 text-red-800'}>{employee.status}</Badge></div>
              {isOnVacation && (
                <div><p className="text-sm text-[#6E6E73]">Vacation</p><p className="font-medium">{employee.vacation_start_date} → {employee.vacation_end_date}</p></div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-lg">Assigned Assets</CardTitle></CardHeader>
          <CardContent>
            {employee.assigned_assets?.length > 0 ? (
              <div className="space-y-2">
                {employee.assigned_assets.map(a => {
                  const linkedAssetId = a.id || a.asset_id;
                  return (
                  <div key={linkedAssetId} className="flex justify-between items-center p-2 rounded cursor-pointer transition-colors"
                    style={{background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.08)'}}
                    onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,0.08)'}
                    onMouseLeave={e => e.currentTarget.style.background='rgba(255,255,255,0.05)'}
                    onClick={() => linkedAssetId && onViewAsset(linkedAssetId)}>
                    <div>
                      <p className="font-medium text-sm" style={{color:'#eae5ec'}}>{a.name || a.asset_tag}</p>
                      <p className="text-xs" style={{color:'rgba(234,229,236,0.5)'}}>{a.category_name || a.category || 'Uncategorised'}</p>
                    </div>
                    <button type="button" aria-label={`View asset ${a.asset_tag || a.name || ''}`} title="View asset"
                      onClick={(e) => { e.stopPropagation(); if (linkedAssetId) onViewAsset(linkedAssetId); }}
                      className="p-2 rounded hover:bg-white/10 disabled:opacity-40" disabled={!linkedAssetId}>
                      <Eye className="h-4 w-4 shrink-0" style={{color:'rgba(234,229,236,0.65)'}} />
                    </button>
                  </div>
                  );
                })}
              </div>
            ) : <p className="text-sm" style={{color:'rgba(234,229,236,0.4)'}}>No assets assigned</p>}
          </CardContent>
        </Card>
      </div>

      {employee.assignment_history?.length > 0 && (
        <Card className="mt-6">
          <CardHeader><CardTitle className="text-lg">Assignment History</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow><TableHead>Asset</TableHead><TableHead>Assigned</TableHead><TableHead>Returned</TableHead><TableHead>Type</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {employee.assignment_history.map(h => (
                  <TableRow key={h.id}>
                    <TableCell className="font-medium">{h.asset_tag}</TableCell>
                    <TableCell>{h.assigned_date}</TableCell>
                    <TableCell>{h.unassigned_date || '-'}</TableCell>
                    <TableCell><Badge variant="outline">{h.assignment_type}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Vacation Modal */}
      <VacationModal
        open={vacationModalOpen}
        onOpenChange={setVacationModalOpen}
        employee={employee}
        employees={employees}
        onConfirm={handleVacationSubmit}
      />

      {/* Extend Vacation Dialog */}
      <Dialog open={extendVacationOpen} onOpenChange={setExtendVacationOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Extend Vacation — {employee.name}</DialogTitle>
            <DialogDescription>Current end: {employee.vacation_end_date}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div><Label>New Return Date *</Label><Input type="date" value={extendNewDate} onChange={e => setExtendNewDate(e.target.value)} min={employee.vacation_end_date} /></div>
            <div><Label>Reason *</Label><Input value={extendReason} onChange={e => setExtendReason(e.target.value)} placeholder="Reason for extension..." /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtendVacationOpen(false)}>Cancel</Button>
            <Button onClick={handleExtendVacation} className="bg-[#FF9500] hover:bg-[#E68900] text-white" disabled={!extendNewDate || !extendReason}>Extend</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resignation Dialog */}
      <ResignDialog 
        open={resignDialogOpen} 
        onOpenChange={setResignDialogOpen} 
        employee={employee} 
        employees={employees} 
        onConfirm={handleResignSubmit} 
      />

      {/* Return from Vacation / Extend Dialog */}
      <ReturnVacationDialog
        open={returnVacationDialogOpen}
        onOpenChange={setReturnVacationDialogOpen}
        employee={employee}
        onConfirm={handleReturnFromVacation}
      />
    </div>
  );
}

// Return from Vacation Dialog
function ReturnVacationDialog({ open, onOpenChange, employee, onConfirm }) {
  const [action, setAction] = useState('return');
  const [newEndDate, setNewEndDate] = useState('');

  useEffect(() => {
    if (open && employee?.vacation_end_date) {
      const currentEnd = new Date(employee.vacation_end_date);
      currentEnd.setDate(currentEnd.getDate() + 7);
      setNewEndDate(currentEnd.toISOString().split('T')[0]);
    }
  }, [open, employee]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Return from Vacation: {employee?.name}</DialogTitle>
          <DialogDescription>
            {employee?.vacation_end_date && new Date(employee.vacation_end_date) <= new Date() 
              ? `Vacation ended on ${employee.vacation_end_date}. Choose an action.`
              : `Current vacation ends on ${employee?.vacation_end_date}`
            }
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <RadioGroup value={action} onValueChange={setAction}>
            <div className="flex items-center space-x-2 p-3 rounded-lg transition-colors" style={{border:'1px solid rgba(255,255,255,0.08)'}}>
              <RadioGroupItem value="return" id="return_vac" />
              <div className="flex-1">
                <Label htmlFor="return_vac" className="font-medium cursor-pointer text-white">Return to Work</Label>
                <p className="text-sm" style={{color:'rgba(234,229,236,0.6)'}}>Reassign all assets back to this employee</p>
              </div>
            </div>
            <div className="flex items-center space-x-2 p-3 rounded-lg transition-colors" style={{border:'1px solid rgba(255,255,255,0.08)'}}>
              <RadioGroupItem value="extend" id="extend_vac" />
              <div className="flex-1">
                <Label htmlFor="extend_vac" className="font-medium cursor-pointer text-white">Extend Vacation</Label>
                <p className="text-sm" style={{color:'rgba(234,229,236,0.6)'}}>Keep current asset handovers in place</p>
              </div>
            </div>
          </RadioGroup>
          {action === 'extend' && (
            <div>
              <Label>New End Date *</Label>
              <Input type="date" value={newEndDate} onChange={(e) => setNewEndDate(e.target.value)} min={new Date().toISOString().split('T')[0]} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button 
            onClick={() => onConfirm(action, null, newEndDate)} 
            className="bg-[#0d9488]"
            disabled={action === 'extend' && !newEndDate}
          >
            {action === 'return' ? 'Return & Reassign Assets' : 'Extend Vacation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Vacation Page — 2 tabs: Active Vacations, Vacation History (no approval workflow)
function PendingApprovalsPage({ user, onViewAsset, onViewEmployee }) {
  const [tab, setTab] = useState('active');
  const [active, setActive] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(null);
  const fileRefs = React.useRef({});
  const confirm = useConfirm();

  // Extend vacation modal
  const [extendOpen, setExtendOpen] = useState(false);
  const [extendEmp, setExtendEmp] = useState(null);
  const [extendDate, setExtendDate] = useState('');
  const [extendReason, setExtendReason] = useState('');

  // Receipt confirmation modal
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptHandover, setReceiptHandover] = useState(null);
  const [receiptReceived, setReceiptReceived] = useState(true);
  const [receiptNote, setReceiptNote] = useState('');

  const canEdit = ['super_admin', 'it_admin'].includes(user?.role);

  const loadData = async () => {
    setLoading(true);
    try {
      const [a, h] = await Promise.all([
        api.get('vacation/active'),
        api.get('vacation/history').catch(() => [])
      ]);
      setActive(a || []);
      setHistory(h || []);
    } catch { toast.error('Failed to load vacation data'); }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const handleUploadDoc = async (handoverId, file) => {
    setUploading(handoverId);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.upload(`vacation/handover/${handoverId}/upload-doc`, fd);
      toast.success('Custody form uploaded');
      loadData();
    } catch (err) { toast.error(err.message); }
    setUploading(null);
  };

  const handleExtend = async () => {
    if (!extendDate || !extendReason) return toast.error('Date and reason required');
    try {
      await api.post('vacation/extend', { employee_id: extendEmp.id, new_end_date: extendDate, reason: extendReason });
      toast.success('Vacation extended');
      setExtendOpen(false);
      loadData();
    } catch (err) { toast.error(err.message); }
  };

  const handleMarkReturned = async (handoverId) => {
    const ok = await confirm({ title: 'Mark as Returned', description: 'Mark this asset as returned from vacation?', confirmLabel: 'Mark Returned', variant: 'primary' });
    if (!ok) return;
    try {
      await api.post(`vacation/handover/${handoverId}/return`, {});
      toast.success('Asset returned');
      loadData();
    } catch (err) { toast.error(err.message); }
  };

  const handleConfirmReceipt = async () => {
    try {
      await api.post(`vacation/handover/${receiptHandover.id}/confirm-receipt`, { received: receiptReceived, note: receiptNote });
      toast.success(receiptReceived ? 'Receipt confirmed' : 'Non-receipt recorded');
      setReceiptOpen(false);
      loadData();
    } catch (err) { toast.error(err.message); }
  };

  // Group active handovers by employee
  const activeByEmployee = active.reduce((acc, h) => {
    const key = h.originalEmployeeId || h.original_employee_id;
    if (!acc[key]) acc[key] = { employee_id: key, employee_name: h.employee_name, vacation_start: h.vacationStart || h.vacation_start, vacation_end: h.vacationEnd || h.vacation_end, handovers: [] };
    acc[key].handovers.push(h);
    return acc;
  }, {});

  const daysLeft = (endDate) => {
    return Math.ceil((new Date(endDate) - new Date().setHours(0,0,0,0)) / 86400000);
  };

  const handoverTypeLabel = (type) => {
    if (type === 'stock') return 'In Stock';
    if (type === 'employee') return 'Handed to Employee';
    if (type === 'remote') return 'Remote Work';
    return type || '—';
  };

  const handoverTypeBadgeStyle = (type) => {
    if (type === 'stock') return { background: 'rgba(52,199,89,0.15)', color: '#34C759' };
    if (type === 'employee') return { background: 'rgba(10,132,255,0.15)', color: '#0A84FF' };
    if (type === 'remote') return { background: 'rgba(255,149,0,0.15)', color: '#FF9500' };
    return {};
  };

  if (loading) return <div className="p-8"><ITdockPageLoader label="Loading approvals" /></div>;

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6" style={{color:'#eae5ec'}}>Vacation</h1>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="active">Active Vacations <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full" style={{background:'rgba(255,255,255,0.1)'}}>{Object.keys(activeByEmployee).length}</span></TabsTrigger>
          <TabsTrigger value="history">Vacation History</TabsTrigger>
        </TabsList>

        {/* Tab 1: Active Vacations */}
        <TabsContent value="active">
          {Object.keys(activeByEmployee).length === 0 ? (
            <div className="text-center py-16" style={{color:'rgba(234,229,236,0.4)'}}>
              <Plane className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No employees currently on vacation</p>
            </div>
          ) : (
            <div className="space-y-4 mt-4">
              {Object.values(activeByEmployee).map(emp => {
                const dl = daysLeft(emp.vacation_end);
                return (
                  <div key={emp.employee_id} className="p-4 rounded-xl" style={{background:'#050810', border:'1px solid rgba(255,255,255,0.08)'}}>
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-semibold" style={{color:'#eae5ec'}}>{emp.employee_name}</p>
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{background: dl < 0 ? 'rgba(255,59,48,0.15)' : 'rgba(255,149,0,0.15)', color: dl < 0 ? '#FF3B30' : '#FF9500'}}>
                            {dl < 0 ? `${Math.abs(dl)}d overdue` : dl === 0 ? 'Returns today' : `${dl}d remaining`}
                          </span>
                        </div>
                        <p className="text-xs" style={{color:'rgba(234,229,236,0.5)'}}>
                          {emp.vacation_start} → {emp.vacation_end} · {emp.handovers.length} asset(s)
                        </p>
                      </div>
                      {canEdit && (
                        <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" onClick={() => { setExtendEmp({ id: emp.employee_id, name: emp.employee_name }); setExtendDate(''); setExtendReason(''); setExtendOpen(true); }}>
                          Extend Vacation
                        </Button>
                      )}
                    </div>
                    {/* Asset rows */}
                    <div className="space-y-2">
                      {emp.handovers.map(h => {
                        const isEmployee = h.handoverType === 'employee';
                        const isRemote = h.handoverType === 'remote';
                        const receiptStatus = !isEmployee ? 'not_required' : (h.receipt_confirmed === true ? 'confirmed' : (h.receipt_confirmed === false ? 'not_received' : 'pending'));
                        if (!fileRefs.current[h.id]) fileRefs.current[h.id] = React.createRef();
                        return (
                          <div key={h.id} className="flex items-center justify-between gap-3 py-2 px-3 rounded-lg" style={{background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.05)'}}>
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <span className="font-medium text-sm" style={{color:'#eae5ec'}}>{h.asset_tag}</span>
                              <span className="text-xs px-2 py-0.5 rounded font-medium" style={handoverTypeBadgeStyle(h.handoverType)}>{handoverTypeLabel(h.handoverType)}</span>
                              {isEmployee && h.custodian_name && <span className="text-xs" style={{color:'rgba(234,229,236,0.5)'}}>→ {h.custodian_name}</span>}
                              {isRemote && h.remoteApprovedBy && <span className="text-xs" style={{color:'rgba(234,229,236,0.5)'}}>Approved by: {h.remoteApprovedBy}</span>}
                            </div>
                            {canEdit && (
                              <div className="flex items-center gap-1.5 shrink-0">
                                {/* Employee handover: custody form upload */}
                                {isEmployee && !h.doc_uploaded && (
                                  <>
                                    <input type="file" accept=".pdf" style={{display:'none'}} ref={fileRefs.current[h.id]}
                                      onChange={e => { const f = e.target.files?.[0]; if (f) { e.target.value = ''; handleUploadDoc(h.id, f); } }} />
                                    <Button size="sm" variant="ghost" className="h-6 text-xs px-2" style={{color:'#FF3B30'}} disabled={uploading === h.id} onClick={() => fileRefs.current[h.id]?.current?.click()}>
                                      <Upload className="h-3 w-3 mr-1" />{uploading === h.id ? '…' : 'Upload Form'}
                                    </Button>
                                  </>
                                )}
                                {isEmployee && h.doc_uploaded && receiptStatus === 'pending' && (
                                  <Button size="sm" variant="ghost" className="h-6 text-xs px-2" style={{color:'#FF9500'}} onClick={() => { setReceiptHandover(h); setReceiptReceived(true); setReceiptNote(''); setReceiptOpen(true); }}>
                                    Confirm Receipt
                                  </Button>
                                )}
                                {isEmployee && h.doc_uploaded && receiptStatus === 'confirmed' && (
                                  <span className="text-xs font-medium" style={{color:'#34C759'}}>Received ✓</span>
                                )}
                                {isEmployee && !h.doc_uploaded && <span className="text-xs" style={{color:'rgba(234,229,236,0.3)'}}>Form required</span>}
                                {/* Return button */}
                                <Button size="sm" variant="ghost" className="h-6 text-xs px-2" style={{color:'#34C759', borderColor:'rgba(52,199,89,0.3)'}} onClick={() => handleMarkReturned(h.id)}>
                                  Return
                                </Button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* Tab 2: Vacation History */}
        <TabsContent value="history">
          {history.length === 0 ? (
            <div className="text-center py-16" style={{color:'rgba(234,229,236,0.4)'}}>
              <p className="font-medium">No vacation history yet</p>
            </div>
          ) : (
            <Card className="mt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead>Employee</TableHead>
                    <TableHead>Handover Type</TableHead>
                    <TableHead>Custodian</TableHead>
                    <TableHead>Dates</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map(h => (
                    <TableRow key={h.id}>
                      <TableCell className="font-medium">{h.asset_tag}</TableCell>
                      <TableCell style={{color:'rgba(234,229,236,0.7)'}}>{h.employee_name}</TableCell>
                      <TableCell>
                        <span className="text-xs px-2 py-0.5 rounded font-medium" style={handoverTypeBadgeStyle(h.handoverType)}>{handoverTypeLabel(h.handoverType)}</span>
                      </TableCell>
                      <TableCell style={{color:'rgba(234,229,236,0.7)'}}>{h.handoverType === 'employee' ? (h.custodian_name || '—') : h.handoverType === 'remote' ? (h.remoteApprovedBy ? `Mgr: ${h.remoteApprovedBy}` : '—') : '—'}</TableCell>
                      <TableCell className="text-xs" style={{color:'rgba(234,229,236,0.5)'}}>{h.vacationStart || h.vacation_start} → {h.vacationEnd || h.vacation_end}</TableCell>
                      <TableCell>
                        <span className="text-xs font-bold px-2 py-0.5 rounded" style={{background:'rgba(52,199,89,0.15)', color:'#34C759'}}>Returned</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Extend Vacation Modal */}
      <Dialog open={extendOpen} onOpenChange={setExtendOpen}>
        <DialogContent style={{background:'#050810', border:'1px solid rgba(255,255,255,0.10)', color:'#eae5ec'}}>
          <DialogHeader><DialogTitle>Extend Vacation — {extendEmp?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label className="text-xs mb-1 block" style={{color:'rgba(234,229,236,0.7)'}}>New Return Date *</Label>
              <Input type="date" value={extendDate} onChange={e => setExtendDate(e.target.value)} style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.12)', color:'#eae5ec'}} />
            </div>
            <div>
              <Label className="text-xs mb-1 block" style={{color:'rgba(234,229,236,0.7)'}}>Reason *</Label>
              <Input placeholder="Reason for extension..." value={extendReason} onChange={e => setExtendReason(e.target.value)} style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.12)', color:'#eae5ec'}} />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={() => setExtendOpen(false)} style={{color:'rgba(234,229,236,0.6)'}}>Cancel</Button>
            <Button onClick={handleExtend} style={{background:'#0d9488', color:'#fff'}}>Confirm Extension</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Receipt Modal */}
      <Dialog open={receiptOpen} onOpenChange={setReceiptOpen}>
        <DialogContent style={{background:'#050810', border:'1px solid rgba(255,255,255,0.10)', color:'#eae5ec'}}>
          <DialogHeader><DialogTitle>Confirm Asset Receipt</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-sm" style={{color:'rgba(234,229,236,0.7)'}}>Has <strong>{receiptHandover?.custodian_name}</strong> physically received <strong>{receiptHandover?.asset_tag}</strong>?</p>
            <div className="flex gap-2">
              <button className="flex-1 py-2 rounded text-sm font-medium" style={{background: receiptReceived ? '#34C759' : 'rgba(255,255,255,0.06)', color: receiptReceived ? '#fff' : 'rgba(234,229,236,0.5)'}} onClick={() => setReceiptReceived(true)}>Yes</button>
              <button className="flex-1 py-2 rounded text-sm font-medium" style={{background: !receiptReceived ? '#FF3B30' : 'rgba(255,255,255,0.06)', color: !receiptReceived ? '#fff' : 'rgba(234,229,236,0.5)'}} onClick={() => setReceiptReceived(false)}>No</button>
            </div>
            {!receiptReceived && (
              <div>
                <Label className="text-xs mb-1 block" style={{color:'rgba(234,229,236,0.7)'}}>Why not received? *</Label>
                <Input placeholder="Reason..." value={receiptNote} onChange={e => setReceiptNote(e.target.value)} style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.12)', color:'#eae5ec'}} />
              </div>
            )}
          </div>
          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={() => setReceiptOpen(false)} style={{color:'rgba(234,229,236,0.6)'}}>Cancel</Button>
            <Button onClick={handleConfirmReceipt} disabled={!receiptReceived && !receiptNote} style={{background:'#0d9488', color:'#fff'}}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Assets List
function AssetsList({ user, onViewAsset, billsFilter, onClearBillsFilter, assignmentTarget, onAssignmentComplete, onCancelAssignment }) {
  const [assets, setAssets] = useState([]);
  const [filterOptions, setFilterOptions] = useState({});
  const [filters, setFilters] = useState({});
  const [searchTerm, setSearchTerm] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({});
  const [categories, setCategories] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [showIoTOnly, setShowIoTOnly] = useState(false);
  const [assetInlineEditId, setAssetInlineEditId] = useState(null);
  const [assetInlineEditData, setAssetInlineEditData] = useState({});
  const [assigningAssetId, setAssigningAssetId] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalAssets, setTotalAssets] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [assetsLoading, setAssetsLoading] = useState(true);
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');

  const canEdit = ['super_admin', 'it_admin'].includes(user.role);

  useEffect(() => { loadCategories(); loadFilterOptions(); }, []);
  useEffect(() => { const timer = setTimeout(() => setDebouncedSearchTerm(searchTerm), 300); return () => clearTimeout(timer); }, [searchTerm]);
  useEffect(() => { loadData(); }, [filters, debouncedSearchTerm, showArchived, showIoTOnly, billsFilter, currentPage]);

  const loadCategories = async () => {
    try {
      const data = await api.get('categories');
      setCategories(data);
    } catch (err) { console.error('Failed to load categories'); }
  };

  const loadFilterOptions = async () => {
    try { setFilterOptions(await api.get('filters')); }
    catch (err) { console.error('Failed to load asset filters', err); }
  };

  const loadData = async () => {
    setAssetsLoading(true);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
      if (debouncedSearchTerm) params.set('search', debouncedSearchTerm);
      if (showArchived) params.set('archived', 'true');
      if (showIoTOnly) params.set('iot_only', 'true');
      if (billsFilter) params.set('category_type', 'SUBSCRIPTION');
      if (billsFilter) {
        const sevenDaysOut = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
        params.set('renewal_before', sevenDaysOut);
      }
      params.set('paginated', 'true'); params.set('page', String(currentPage)); params.set('page_size', '40');
      const result = await api.get(`assets?${params.toString()}`);
      setAssets(result.items || []);
      setTotalAssets(result.total || 0);
      setTotalPages(result.total_pages || 1);
    } catch (err) { toast.error('Failed to load assets'); }
    finally { setAssetsLoading(false); }
  };

  const openDialog = () => {
    setFormData({ asset_type: 'Physical', category: 'Laptop', brand: '', vendor_name: '', receive_date: '', warranty_applicable: 'N-A', warranty_end_date: '', serial_number: '', connection_type: 'Wired', company_id: '', project_id: assignmentTarget?.project_id || '', location_id: assignmentTarget?.location_id || '', notes: '' });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (showSerialNumber && !formData.serial_number?.trim()) {
      toast.error('Serial Number is required for physical assets');
      return;
    }
    try {
      const createdAsset = await api.post('assets', formData);
      if (assignmentTarget) {
        try {
          await api.post('assignments', { asset_id: createdAsset.id, employee_id: assignmentTarget.id, assignment_type: 'Normal', project_id: assignmentTarget.project_id, location_id: assignmentTarget.location_id });
          toast.success(`Asset created and assigned to ${assignmentTarget.name}`);
          setDialogOpen(false);
          onAssignmentComplete(assignmentTarget.id);
        } catch (assignError) {
          setDialogOpen(false);
          loadData();
          toast.error(`Asset was created but could not be assigned: ${assignError.message}`);
        }
        return;
      }
      toast.success('Asset created');
      setDialogOpen(false);
      loadData();
    } catch (err) { toast.error(err.message); }
  };

  const assignExistingAsset = async (asset) => {
    if (!assignmentTarget || assigningAssetId) return;
    setAssigningAssetId(asset.id);
    try {
      await api.post('assignments', { asset_id: asset.id, employee_id: assignmentTarget.id, assignment_type: 'Normal', project_id: assignmentTarget.project_id, location_id: assignmentTarget.location_id });
      toast.success(`${asset.asset_tag} assigned to ${assignmentTarget.name}`);
      onAssignmentComplete(assignmentTarget.id);
    } catch (err) {
      toast.error(err.message);
      loadData();
    } finally {
      setAssigningAssetId(null);
    }
  };

  const startAssetInlineEdit = (a) => {
    setAssetInlineEditId(a.id);
    setAssetInlineEditData({ ...a });
  };

  const cancelAssetInlineEdit = () => {
    setAssetInlineEditId(null);
    setAssetInlineEditData({});
  };

  const saveAssetInlineEdit = async () => {
    try {
      await api.put(`assets/${assetInlineEditId}`, assetInlineEditData);
      toast.success('Asset updated');
      setAssetInlineEditId(null);
      setAssetInlineEditData({});
      loadData();
    } catch (err) { toast.error(err.message); }
  };

  const getEditCategoryType = () => {
    const cat = categories.find(c => c.id === assetInlineEditData.category_id || c.id === assetInlineEditData.category);
    return cat?.category_type || 'STORABLE';
  };

  const getStatusColor = (s) => {
    const colors = { 'In Stock': 'bg-green-100 text-green-800', 'Assigned': 'bg-blue-100 text-blue-800', 'Temporarily Assigned': 'bg-purple-100 text-purple-800', 'Handed Over (Vacation Coverage)': 'bg-orange-100 text-orange-800', 'In Maintenance': 'bg-yellow-100 text-yellow-800', 'Scrapped': 'bg-red-100 text-red-800' };
    return colors[s] || 'bg-[rgba(255,255,255,0.06)] text-[#eae5ec] border border-white/10';
  };

  // Fix: look up category by ID, not by hardcoded name
  const selectedAddCategory = categories.find(c => c.id === formData.category);
  const addCategoryType = selectedAddCategory?.category_type || '';
  const addCategoryName = selectedAddCategory?.name || '';
  // SN always visible for physical (STORABLE) categories
  const showSerialNumber = addCategoryType === 'STORABLE';
  // Subscription categories show billing date, not warranty
  const isSubscription = addCategoryType === 'SUBSCRIPTION';
  // Connection type only for keyboard/mouse accessories (match by name)
  const showConnectionType = ['Keyboard', 'Mouse'].includes(addCategoryName);
  // Hardware specs — shown when category hasSpecs is true
  const showSpecs = !!(selectedAddCategory?.hasSpecs);
  // IoT/Network specs — shown when category isIoT is true
  const showIoTSpecs = !!(selectedAddCategory?.isIoT);

  const exportAssets = async () => {
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key,value]) => { if (value) params.set(key,value); });
      if (debouncedSearchTerm) params.set('search',debouncedSearchTerm);
      if (showArchived) params.set('archived','true');
      if (showIoTOnly) params.set('iot_only','true');
      if (billsFilter) { params.set('category_type','SUBSCRIPTION'); params.set('renewal_before',new Date(Date.now()+7*86400000).toISOString().split('T')[0]); }
      const exportData = await api.get(`assets?${params.toString()}`);
      const rows = exportData.map(a => ({
      'Asset Tag': a.asset_tag || '',
      'Category': a.category_name || '',
      'Type': a.category_type || '',
      'Serial Number': a.serial_number || '',
      'Brand': a.brand || '',
      'Status': a.status || '',
      'Location': a.location_name || '',
      'Assigned To': a.assigned_to === 'company' ? 'Company' : (a.employee_name || ''),
      'Warranty': a.warranty_applicable || '',
      'Warranty End': a.warranty_end_date || '',
      'Next Billing': a.renewal_date || '',
      'Purchase Date': a.receive_date || '',
      'Vendor': a.vendor_name || '',
      'IP Address': a.ipAddress || '',
      'Processor': a.specs?.processor || '',
      'RAM': a.specs?.ram || '',
      'Storage': a.specs?.storage || '',
      'GPU': a.specs?.gpu || '',
      'OS': a.specs?.os || '',
      'Notes': a.notes || '',
      }));
      downloadXlsx(rows, 'Assets', `mahaz_assets_${new Date().toISOString().slice(0,10)}.xlsx`);
      toast.success('Excel file downloaded');
    } catch (err) { toast.error(err.message); }
  };

  if (assetsLoading) return <div className="p-8"><ITdockPageLoader label="Loading assets" /></div>;

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-white">Assets</h1>
        <div className="flex items-center space-x-3">
          <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#AEAEB2]" /><Input placeholder="Search..." value={searchTerm} onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }} className="pl-10 w-64" /></div>
          <Button onClick={exportAssets} variant="outline" size="sm"><Download className="h-4 w-4 mr-2" />Export</Button>
          {canEdit && <Button onClick={openDialog} className="bg-[#0d9488] hover:bg-[#0062CC]"><Plus className="h-4 w-4 mr-2" />{assignmentTarget ? 'Add & Assign Asset' : 'Add Asset'}</Button>}
        </div>
      </div>

      {assignmentTarget && (
        <div className="mb-4 flex items-center gap-3 px-4 py-3 rounded-xl" style={{background:'rgba(94,234,212,0.08)', border:'1px solid rgba(94,234,212,0.22)'}}>
          <UserPlus className="h-5 w-5 shrink-0" style={{color:'#5eead4'}} />
          <div>
            <p className="text-sm font-semibold" style={{color:'#eae5ec'}}>Assign an asset to {assignmentTarget.name}</p>
            <p className="text-xs" style={{color:'rgba(234,229,236,0.5)'}}>Search for an available asset below, or create a new one to assign it automatically.</p>
          </div>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={onCancelAssignment}><X className="h-4 w-4 mr-1" />Cancel</Button>
        </div>
      )}

      {/* Bills filter indicator */}
      {billsFilter && (
        <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-lg" style={{background:'rgba(94,234,212,0.08)', border:'1px solid #93C5FD'}}>
          <Bell className="h-4 w-4 shrink-0" style={{color:'#5eead4'}} />
          <span className="text-sm font-medium" style={{color:'#1D4ED8'}}>Filtered: Bills due this week</span>
          <button onClick={onClearBillsFilter} className="ml-auto flex items-center gap-1 text-xs font-medium" style={{color:'rgba(234,229,236,0.6)'}}>
            <X className="h-3.5 w-3.5" />Clear filter
          </button>
        </div>
      )}

      {/* Enhanced Filters */}
      <div className="mb-4 p-4 rounded-lg" style={{background:'#0a0e17', border:'1px solid rgba(255,255,255,0.08)'}}>
        <div className="flex flex-wrap gap-3 items-center">
          <Select value={filters.category || 'all'} onValueChange={(v) => { setFilters({...filters, category: v === 'all' ? '' : v}); setCurrentPage(1); }}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Filter by Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          
          <Select value={filters.category_type || 'all'} onValueChange={(v) => { setFilters({...filters, category_type: v === 'all' ? '' : v}); setCurrentPage(1); }}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Filter by Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="STORABLE">Storable</SelectItem>
              <SelectItem value="CONSUMABLE">Consumable</SelectItem>
              <SelectItem value="SUBSCRIPTION">Subscription</SelectItem>
            </SelectContent>
          </Select>
          
          <div className="flex items-center space-x-2">
            <Checkbox id="archived" checked={showArchived} onCheckedChange={(checked) => { setShowArchived(checked); setCurrentPage(1); }} />
            <label htmlFor="archived" className="text-sm text-[#1D1D1F] cursor-pointer">Show Archived</label>
          </div>

          <button onClick={() => { setShowIoTOnly(v => !v); setCurrentPage(1); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={{background: showIoTOnly ? 'rgba(94,234,212,0.18)' : 'rgba(255,255,255,0.05)', color: showIoTOnly ? '#5eead4' : 'rgba(234,229,236,0.5)', border: `1px solid ${showIoTOnly ? 'rgba(94,234,212,0.4)' : 'rgba(255,255,255,0.1)'}` }}>
            <Wifi className="h-3.5 w-3.5" />Network/IoT
          </button>

          {(filters.category || filters.category_type || showArchived || showIoTOnly) && (
            <Button variant="outline" size="sm" onClick={() => { setFilters({}); setShowArchived(false); setShowIoTOnly(false); setCurrentPage(1); }}><X className="h-4 w-4 mr-1" />Clear Filters</Button>
          )}
        </div>
      </div>

      <FilterBar filters={filters} filterOptions={filterOptions} onFilterChange={(k, v) => { setFilters({...filters, [k]: v}); setCurrentPage(1); }} onClear={() => { setFilters({}); setCurrentPage(1); }} />

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Asset Tag</TableHead>
              <TableHead>Serial Number</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Assigned To</TableHead>
              <TableHead>IP Address</TableHead>
              <TableHead>Specs</TableHead>
              <TableHead>Warranty</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {assets.map((a, index) => (
              <React.Fragment key={a.id}>
                <TableRow className="cursor-pointer" onClick={() => assetInlineEditId !== a.id && onViewAsset(a.id)}>
                  <TableCell className="text-[#6E6E73]">{index + 1}</TableCell>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {a.asset_tag}
                      {a.isShared && <span className="text-xs font-medium px-1.5 py-0.5 rounded" style={{background:'rgba(94,234,212,0.15)', color:'#5eead4'}}><Users className="h-3 w-3 inline mr-0.5" />{(a.sharedAssignees?.length || 0)} seats</span>}
                      {(a.category_type === 'SUBSCRIPTION' || a.asset_type === 'Subscription') && a.provider_url && (
                        <a href={a.provider_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} title="Provider website" style={{color:'#5eead4'}}>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-[#6E6E73]">{a.serial_number || '-'}</TableCell>
                  <TableCell>{a.category_name || a.category}</TableCell>
                  <TableCell><Badge className={getStatusColor(a.status)}>{a.status}</Badge></TableCell>
                  <TableCell>{a.assigned_to_name || '-'}</TableCell>
                  <TableCell>
                    {a.ipAddress ? (
                      <span className="text-xs font-mono flex items-center gap-1" style={{color:'#5eead4'}}>
                        {a.ipAddress}
                        <button title="Copy IP" onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(a.ipAddress); toast.success('IP copied!'); }} style={{color:'rgba(234,229,236,0.4)'}}><Copy className="h-3 w-3" /></button>
                      </span>
                    ) : <span style={{color:'rgba(234,229,236,0.3)'}}>—</span>}
                  </TableCell>
                  <TableCell>
                    {a.isIoT && (a.specs?.macAddress || a.specs?.firmware) ? (
                      <span className="text-xs" style={{color:'rgba(234,229,236,0.7)'}}>
                        {[a.specs?.macAddress && <span key="mac" className="font-mono">{a.specs.macAddress}</span>, a.specs?.firmware && `fw ${a.specs.firmware}`].filter(Boolean).reduce((acc, el, i) => i === 0 ? [el] : [...acc, ' · ', el], [])}
                      </span>
                    ) : (a.specs?.processor || a.specs?.ram || a.specs?.storage) ? (
                      <span className="text-xs" style={{color:'rgba(234,229,236,0.7)'}}>
                        {[a.specs?.processor?.split(' ').slice(-2).join(' '), a.specs?.ram, a.specs?.storage].filter(Boolean).join(' / ')}
                      </span>
                    ) : <span style={{color:'rgba(234,229,236,0.3)'}}>—</span>}
                  </TableCell>
                  <TableCell>{(a.category_type === 'SUBSCRIPTION' || a.asset_type === 'Subscription') ? (a.renewal_date ? (() => {
                    const daysLeft = Math.ceil((new Date(a.renewal_date) - new Date().setHours(0,0,0,0)) / 86400000);
                    const color = daysLeft < 0 ? '#FF3B30' : daysLeft <= 1 ? '#FF9500' : '#0d9488';
                    return <span className="text-xs font-medium" style={{color}}>{a.renewal_date}</span>;
                  })() : <span className="text-xs" style={{color:'rgba(234,229,236,0.4)'}}>—</span>) : <Badge variant="outline" className={a.warranty_status === 'Active' ? 'text-green-600' : a.warranty_status === 'Expired' ? 'text-red-600' : ''}>{a.warranty_status}</Badge>}</TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    <div className="flex space-x-1">
                      {assignmentTarget && !a.assigned_to && ['In Stock', 'Available'].includes(a.status) && assetInlineEditId !== a.id && (
                        <Button size="sm" onClick={() => assignExistingAsset(a)} disabled={!!assigningAssetId} className="h-8 px-2 text-xs bg-[#0d9488] hover:bg-[#0f766e] text-white">
                          <UserPlus className="h-4 w-4 mr-1" />{assigningAssetId === a.id ? 'Assigning…' : 'Assign'}
                        </Button>
                      )}
                      {assetInlineEditId !== a.id && <Button size="sm" variant="ghost" onClick={() => onViewAsset(a.id)}><Eye className="h-4 w-4" /></Button>}
                      {canEdit && assetInlineEditId !== a.id && (
                        <Button size="sm" variant="ghost" onClick={e => { e.stopPropagation(); startAssetInlineEdit(a); }} title="Edit asset"><Pencil className="h-4 w-4" /></Button>
                      )}
                      {canEdit && assetInlineEditId === a.id && (
                        <>
                          <Button size="sm" className="bg-[#0d9488] hover:bg-[#0062CC] text-white h-7 px-2 text-xs" onClick={e => { e.stopPropagation(); saveAssetInlineEdit(); }}>Save</Button>
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={e => { e.stopPropagation(); cancelAssetInlineEdit(); }}>Cancel</Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
                {assetInlineEditId === a.id && (
                  <TableRow>
                    <TableCell colSpan={12} className="p-0">
                      <div className="px-4 py-4" style={{background:'rgba(94,234,212,0.05)', borderTop:'1px solid rgba(94,234,212,0.15)', borderBottom:'1px solid rgba(94,234,212,0.15)'}}>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                          <div>
                            <label className="text-xs block mb-1" style={{color:'rgba(234,229,236,0.6)'}}>Asset Tag</label>
                            <Input className="h-8 text-sm" value={assetInlineEditData.asset_tag || ''} disabled />
                          </div>
                          <div>
                            <label className="text-xs block mb-1" style={{color:'rgba(234,229,236,0.6)'}}>Category</label>
                            <Select value={assetInlineEditData.category_id || assetInlineEditData.category || ''} onValueChange={v => {
                              const nowSubscription = categories.find(c => c.id === v)?.category_type === 'SUBSCRIPTION';
                              setAssetInlineEditData({
                                ...assetInlineEditData,
                                category_id: v,
                                category: v,
                                warranty_end_date: nowSubscription ? '' : assetInlineEditData.warranty_end_date,
                                warranty_applicable: nowSubscription ? 'N-A' : assetInlineEditData.warranty_applicable,
                                renewal_date: !nowSubscription ? '' : assetInlineEditData.renewal_date,
                              });
                            }}>
                              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                              <SelectContent>{categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          <div>
                            <label className="text-xs block mb-1" style={{color:'rgba(234,229,236,0.6)'}}>Serial Number</label>
                            <Input className="h-8 text-sm" value={assetInlineEditData.serial_number || ''} onChange={e => setAssetInlineEditData({...assetInlineEditData, serial_number: e.target.value})} />
                          </div>
                          <div>
                            <label className="text-xs block mb-1" style={{color:'rgba(234,229,236,0.6)'}}>Brand</label>
                            <Input className="h-8 text-sm" value={assetInlineEditData.brand || ''} onChange={e => setAssetInlineEditData({...assetInlineEditData, brand: e.target.value})} />
                          </div>
                          <div>
                            <label className="text-xs block mb-1" style={{color:'rgba(234,229,236,0.6)'}}>Status</label>
                            <Select value={assetInlineEditData.status || ''} onValueChange={v => setAssetInlineEditData({...assetInlineEditData, status: v})}>
                              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="In Stock">In Stock</SelectItem>
                                <SelectItem value="Assigned">Assigned</SelectItem>
                                <SelectItem value="In Maintenance">In Maintenance</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <label className="text-xs block mb-1" style={{color:'rgba(234,229,236,0.6)'}}>Location</label>
                            <SearchableSelect options={filterOptions.locations || []} value={assetInlineEditData.location_id} onChange={v => setAssetInlineEditData({...assetInlineEditData, location_id: v})} placeholder="Select..." />
                          </div>
                          <div>
                            <label className="text-xs block mb-1" style={{color:'rgba(234,229,236,0.6)'}}>Purchase Date</label>
                            <Input className="h-8 text-sm" type="date" value={assetInlineEditData.receive_date || ''} onChange={e => setAssetInlineEditData({...assetInlineEditData, receive_date: e.target.value})} />
                          </div>
                          {getEditCategoryType() === 'SUBSCRIPTION' ? (
                            <>
                              <div>
                                <label className="text-xs block mb-1" style={{color:'rgba(234,229,236,0.6)'}}>Next Billing Date</label>
                                <Input className="h-8 text-sm" type="date" value={assetInlineEditData.renewal_date || ''} onChange={e => setAssetInlineEditData({...assetInlineEditData, renewal_date: e.target.value})} />
                              </div>
                              <div>
                                <label className="text-xs block mb-1" style={{color:'rgba(234,229,236,0.6)'}}>Provider Website</label>
                                <Input className="h-8 text-sm" type="url" placeholder="https://provider.com" value={assetInlineEditData.provider_url || ''} onChange={e => setAssetInlineEditData({...assetInlineEditData, provider_url: e.target.value})} />
                              </div>
                            </>
                          ) : (
                            <div>
                              <label className="text-xs block mb-1" style={{color:'rgba(234,229,236,0.6)'}}>Warranty Expiry</label>
                              <Input className="h-8 text-sm" type="date" value={assetInlineEditData.warranty_end_date || ''} onChange={e => setAssetInlineEditData({...assetInlineEditData, warranty_end_date: e.target.value})} />
                            </div>
                          )}
                        </div>
                        <div className="mb-3">
                          <label className="text-xs block mb-1" style={{color:'rgba(234,229,236,0.6)'}}>Notes</label>
                          <Textarea className="text-sm" rows={2} value={assetInlineEditData.notes || ''} onChange={e => setAssetInlineEditData({...assetInlineEditData, notes: e.target.value})} placeholder="Optional notes..." />
                        </div>
                        <div className="flex gap-2 justify-end items-center">
                          <span className="text-xs mr-2" style={{color:'rgba(234,229,236,0.4)'}}>Asset tags are generated automatically</span>
                          <Button size="sm" variant="ghost" onClick={cancelAssetInlineEdit} style={{borderColor:'rgba(255,255,255,0.12)'}}>Cancel</Button>
                          <Button size="sm" className="bg-[#0d9488] hover:bg-[#0062CC] text-white" onClick={saveAssetInlineEdit}>Save Changes</Button>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            ))}
          </TableBody>
        </Table>
      </Card>

      <div className="flex items-center justify-between mt-4">
        <p className="text-sm" style={{color:'rgba(234,229,236,0.55)'}}>{totalAssets === 0 ? 'No assets' : `Showing ${(currentPage - 1) * 40 + 1}-${Math.min(currentPage * 40, totalAssets)} of ${totalAssets}`}</p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setCurrentPage(page => Math.max(1, page - 1))}><ChevronLeft className="h-4 w-4 mr-1" />Previous</Button>
          <span className="text-sm px-2">Page {currentPage} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(page => Math.min(totalPages, page + 1))}>Next<ChevronRight className="h-4 w-4 ml-1" /></Button>
        </div>
      </div>

      {/* Create Asset Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add Asset</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Asset Tag</Label><Input value="Generated automatically from category" disabled /></div>
            <div><Label>Category *</Label>
              <Select value={formData.category} onValueChange={(v) => {
                const nowSubscription = categories.find(c => c.id === v)?.category_type === 'SUBSCRIPTION';
                setFormData({
                  ...formData,
                  category: v,
                  warranty_end_date: nowSubscription ? '' : formData.warranty_end_date,
                  warranty_applicable: nowSubscription ? 'N-A' : formData.warranty_applicable,
                  renewal_date: !nowSubscription ? '' : formData.renewal_date,
                });
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {/* Serial Number — always visible for physical (STORABLE) categories, never replaced by Brand */}
            {showSerialNumber && <div><Label>Serial Number *</Label><Input value={formData.serial_number || ''} onChange={(e) => setFormData({...formData, serial_number: e.target.value})} placeholder="e.g. SN-ABC123" /></div>}
            {/* Brand — always present alongside Serial Number, never replaces it */}
            <div><Label>Brand</Label><Input value={formData.brand || ''} onChange={(e) => setFormData({...formData, brand: e.target.value})} /></div>
            {/* Connection Type — only for Keyboard/Mouse, detected by category name */}
            {showConnectionType && (
              <div><Label>Connection Type</Label>
                <Select value={formData.connection_type || 'Wired'} onValueChange={(v) => setFormData({...formData, connection_type: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="Wired">Wired</SelectItem><SelectItem value="Wireless">Wireless</SelectItem></SelectContent>
                </Select>
              </div>
            )}
            <div><Label>Vendor</Label><Input value={formData.vendor_name || ''} onChange={(e) => setFormData({...formData, vendor_name: e.target.value})} /></div>
            <div><Label>Purchase Date</Label><Input type="date" value={formData.receive_date || ''} onChange={(e) => setFormData({...formData, receive_date: e.target.value})} /></div>
            {/* Warranty — shown for all non-subscription categories */}
            {!isSubscription && <>
              <div><Label>Warranty</Label>
                <Select value={formData.warranty_applicable || 'N-A'} onValueChange={(v) => setFormData({...formData, warranty_applicable: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="Yes">Yes</SelectItem><SelectItem value="No">No</SelectItem><SelectItem value="N-A">N/A</SelectItem></SelectContent>
                </Select>
              </div>
              {formData.warranty_applicable === 'Yes' && <div><Label>Warranty End Date</Label><Input type="date" value={formData.warranty_end_date || ''} onChange={(e) => setFormData({...formData, warranty_end_date: e.target.value})} /></div>}
            </>}
            {/* Next Billing Date + Provider Website — subscription only */}
            {isSubscription && (
              <>
                <div><Label>Next Billing Date</Label><Input type="date" value={formData.renewal_date || ''} onChange={(e) => setFormData({...formData, renewal_date: e.target.value})} /></div>
                <div><Label>Provider Website</Label><Input type="url" placeholder="https://provider.com" value={formData.provider_url || ''} onChange={(e) => setFormData({...formData, provider_url: e.target.value})} /></div>
              </>
            )}
          </div>
          {/* Hardware Specifications — only for hasSpecs categories */}
          {showSpecs && (
            <div className="mt-4 pt-4 border-t" style={{borderColor:'rgba(255,255,255,0.08)'}}>
              <div className="flex items-center gap-2 mb-3">
                <Cpu className="h-4 w-4" style={{color:'#5eead4'}} />
                <h3 className="text-sm font-semibold" style={{color:'#eae5ec'}}>Hardware Specifications</h3>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">Processor</Label><Input placeholder="e.g. Intel Core i7-12th Gen" value={formData.specs?.processor || ''} onChange={e => setFormData({...formData, specs: {...(formData.specs||{}), processor: e.target.value}})} /></div>
                <div><Label className="text-xs">RAM</Label><Input placeholder="e.g. 16GB DDR4 3200MHz" value={formData.specs?.ram || ''} onChange={e => setFormData({...formData, specs: {...(formData.specs||{}), ram: e.target.value}})} /></div>
                <div><Label className="text-xs">Storage</Label><Input placeholder="e.g. 512GB NVMe SSD" value={formData.specs?.storage || ''} onChange={e => setFormData({...formData, specs: {...(formData.specs||{}), storage: e.target.value}})} /></div>
                <div><Label className="text-xs">GPU (optional)</Label><Input placeholder="e.g. NVIDIA RTX 3060" value={formData.specs?.gpu || ''} onChange={e => setFormData({...formData, specs: {...(formData.specs||{}), gpu: e.target.value}})} /></div>
                <div><Label className="text-xs">Operating System</Label><Input placeholder="e.g. Windows 11 Pro" value={formData.specs?.os || ''} onChange={e => setFormData({...formData, specs: {...(formData.specs||{}), os: e.target.value}})} /></div>
                <div><Label className="text-xs">CPU Cores</Label><Input placeholder="e.g. 8 cores / 16 threads" value={formData.specs?.cores || ''} onChange={e => setFormData({...formData, specs: {...(formData.specs||{}), cores: e.target.value}})} /></div>
                <div><Label className="text-xs">Bandwidth</Label><Input placeholder="e.g. 1Gbps unmetered" value={formData.specs?.bandwidth || ''} onChange={e => setFormData({...formData, specs: {...(formData.specs||{}), bandwidth: e.target.value}})} /></div>
              </div>
              <div className="mt-3 pt-3 border-t" style={{borderColor:'rgba(255,255,255,0.06)'}}>
                <div className="flex items-center gap-2 mb-2">
                  <Wifi className="h-4 w-4" style={{color:'#5eead4'}} />
                  <h4 className="text-xs font-semibold" style={{color:'rgba(234,229,236,0.8)'}}>Network</h4>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">IP Address</Label>
                    <Input placeholder="e.g. 192.168.1.45" value={formData.ipAddress || ''} onChange={e => setFormData({...formData, ipAddress: e.target.value})} />
                  </div>
                  <div>
                    <Label className="text-xs">Additional IPs (comma-separated)</Label>
                    <Input placeholder="e.g. 10.0.0.1, 10.0.0.2" value={(formData.ipAddresses || []).join(', ')} onChange={e => setFormData({...formData, ipAddresses: e.target.value.split(',').map(s => s.trim()).filter(Boolean)})} />
                  </div>
                </div>
              </div>
            </div>
          )}
          {/* IoT / Network Device Specs */}
          {showIoTSpecs && (
            <div className="mt-4 pt-4 border-t" style={{borderColor:'rgba(255,255,255,0.08)'}}>
              <div className="flex items-center gap-2 mb-3">
                <Wifi className="h-4 w-4" style={{color:'#5eead4'}} />
                <h3 className="text-sm font-semibold" style={{color:'#eae5ec'}}>Network / IoT Details</h3>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">MAC Address</Label>
                  <Input placeholder="e.g. AA:BB:CC:DD:EE:FF" value={formData.specs?.macAddress || ''} onChange={e => setFormData({...formData, specs: {...(formData.specs||{}), macAddress: e.target.value}})} />
                </div>
                <div>
                  <Label className="text-xs">IP Address</Label>
                  <Input placeholder="e.g. 192.168.1.100" value={formData.ipAddress || ''} onChange={e => setFormData({...formData, ipAddress: e.target.value})} />
                </div>
                <div>
                  <Label className="text-xs">VLAN</Label>
                  <Input placeholder="e.g. VLAN 10 or 10" value={formData.specs?.vlan || ''} onChange={e => setFormData({...formData, specs: {...(formData.specs||{}), vlan: e.target.value}})} />
                </div>
                <div>
                  <Label className="text-xs">Firmware Version</Label>
                  <Input placeholder="e.g. 2.1.4-r3" value={formData.specs?.firmware || ''} onChange={e => setFormData({...formData, specs: {...(formData.specs||{}), firmware: e.target.value}})} />
                </div>
                <div>
                  <Label className="text-xs">Management URL</Label>
                  <Input placeholder="e.g. http://192.168.1.1" value={formData.specs?.managementUrl || ''} onChange={e => setFormData({...formData, specs: {...(formData.specs||{}), managementUrl: e.target.value}})} />
                </div>
                <div>
                  <Label className="text-xs">Ports</Label>
                  <Input placeholder="e.g. 24x GbE + 4x SFP+" value={formData.specs?.ports || ''} onChange={e => setFormData({...formData, specs: {...(formData.specs||{}), ports: e.target.value}})} />
                </div>
                <div>
                  <Label className="text-xs">Resolution (cameras)</Label>
                  <Input placeholder="e.g. 4K / 8MP" value={formData.specs?.resolution || ''} onChange={e => setFormData({...formData, specs: {...(formData.specs||{}), resolution: e.target.value}})} />
                </div>
                <div>
                  <Label className="text-xs">Additional IPs</Label>
                  <Input placeholder="e.g. 10.0.0.1, 10.0.0.2" value={(formData.ipAddresses || []).join(', ')} onChange={e => setFormData({...formData, ipAddresses: e.target.value.split(',').map(s => s.trim()).filter(Boolean)})} />
                </div>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div className="col-span-2"><Label>Notes</Label><Textarea value={formData.notes} onChange={(e) => setFormData({...formData, notes: e.target.value})} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} className="bg-[#0d9488]">{assignmentTarget ? 'Create & Assign' : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Asset Detail
function AssetDetail({ assetId, user, onBack, onViewEmployee, onNavigateToEmployeeCreate, onNavigateToMaintenance }) {
  const [asset, setAsset] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignData, setAssignData] = useState({});
  const [renewDialogOpen, setRenewDialogOpen] = useState(false);
  const [renewData, setRenewData] = useState({});
  const [filterOptions, setFilterOptions] = useState({});
  const [maintenanceRecords, setMaintenanceRecords] = useState([]);
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [completeFormData, setCompleteFormData] = useState({});
  const [documents, setDocuments] = useState([]);
  const [docUploading, setDocUploading] = useState(null); // null or type string while uploading
  const [docForms, setDocForms] = useState({}); // per-type field state
  const [vacationModalOpen, setVacationModalOpen] = useState(false);
  const [assetAudits, setAssetAudits] = useState([]);
  const [billingDialogOpen, setBillingDialogOpen] = useState(false);
  const [billingData, setBillingData] = useState({ paid: true, new_billing_date: '', notes: '' });
  const [billingLoading, setBillingLoading] = useState(false);
  const [sharedDialogOpen, setSharedDialogOpen] = useState(false);
  const [addAssigneeEmpId, setAddAssigneeEmpId] = useState('');
  const [sharedLoading, setSharedLoading] = useState(false);
  const [addons, setAddons] = useState([]);
  const [addonDialogOpen, setAddonDialogOpen] = useState(false);
  const [addonEditing, setAddonEditing] = useState(null); // null = add, obj = edit
  const [addonForm, setAddonForm] = useState({ name: '', provider: '', cost: '', currency: 'USD', billingCycle: 'monthly', startDate: '', renewalDate: '', notes: '' });
  const [addonSaving, setAddonSaving] = useState(false);
  const noteFileRef = React.useRef(null);
  const invoiceFileRef = React.useRef(null);
  const subInvoiceFileRef = React.useRef(null);
  const custodyFileRef = React.useRef(null);
  const tempCustodyFileRef = React.useRef(null);

  const canAssign = ['super_admin', 'it_admin', 'it_technician'].includes(user.role);
  const canDeleteDoc = ['super_admin', 'it_admin'].includes(user.role);
  const confirm = useConfirm();
  const currencies = ['SAR', 'USD', 'GBP', 'EUR', 'AED', 'QAR', 'KWD', 'BHD', 'OMR', 'INR', 'PKR', 'BDT'];

  useEffect(() => { if (assetId) loadData(); }, [assetId]);

  const loadData = async () => {
    try {
      const [assetData, emps, opts, maintenance, docs, audits, addonData] = await Promise.all([
        api.get(`assets/${assetId}`),
        api.get('employees?status=Active&lightweight=true').catch(() => []),
        api.get('filters').catch(() => ({})),
        api.get(`maintenance?asset_id=${encodeURIComponent(assetId)}`).catch(() => []),
        api.get(`assets/${assetId}/documents`).catch(() => []),
        api.get(`assets/${assetId}/audits`).catch(() => []),
        api.get(`assets/${assetId}/addons`).catch(() => [])
      ]);
      setAsset(assetData);
      setEmployees(emps);
      setFilterOptions(opts);
      setMaintenanceRecords(maintenance.filter(m => m.asset_id === assetId));
      setDocuments(docs);
      setAssetAudits(audits || []);
      setAddons(addonData || []);
    } catch (err) { toast.error('Failed to load asset'); }
  };

  const handleAssign = async () => {
    try {
      await api.post('assignments', { asset_id: assetId, employee_id: assignData.employee_id, assignment_type: 'Normal', project_id: assignData.project_id, location_id: assignData.location_id });
      toast.success('Asset assigned');
      setAssignDialogOpen(false);
      loadData();
    } catch (err) { toast.error(err.message); }
  };

  const handleUnassign = async () => {
    const ok = await confirm({ title: 'Unassign Asset', description: 'Remove the current assignment for this asset?', confirmLabel: 'Unassign', variant: 'primary' });
    if (!ok) return;
    try {
      await api.post('assignments/unassign', { asset_id: assetId });
      toast.success('Asset unassigned');
      loadData();
    } catch (err) { toast.error(err.message); }
  };

  const handleRenew = async () => {
    try {
      await api.post('assets/renew', { asset_id: assetId, ...renewData });
      toast.success('Asset renewed');
      setRenewDialogOpen(false);
      loadData();
    } catch (err) { toast.error(err.message); }
  };

  const openAddonDialog = (existing = null) => {
    setAddonEditing(existing);
    setAddonForm(existing ? {
      name: existing.name, provider: existing.provider || '', cost: existing.cost ?? '', currency: existing.currency || 'USD',
      billingCycle: existing.billingCycle || 'monthly', startDate: existing.startDate || '', renewalDate: existing.renewalDate || '',
      notes: existing.notes || ''
    } : { name: '', provider: '', cost: '', currency: 'USD', billingCycle: 'monthly', startDate: '', renewalDate: '', notes: '' });
    setAddonDialogOpen(true);
  };

  const handleSaveAddon = async () => {
    if (!addonForm.name.trim()) return toast.error('Name is required');
    setAddonSaving(true);
    try {
      if (addonEditing) {
        await api.put(`assets/${assetId}/addons/${addonEditing.id}`, addonForm);
        toast.success('Addon updated');
      } else {
        await api.post(`assets/${assetId}/addons`, addonForm);
        toast.success('Addon added');
      }
      setAddonDialogOpen(false);
      loadData();
    } catch (err) { toast.error(err.message); }
    setAddonSaving(false);
  };

  const handleCancelAddon = async (addonId) => {
    const ok = await confirm({ title: 'Cancel Addon', description: 'Mark this addon as cancelled?', confirmLabel: 'Cancel Addon' });
    if (!ok) return;
    try {
      await api.delete(`assets/${assetId}/addons/${addonId}?action=cancel`);
      toast.success('Addon cancelled');
      loadData();
    } catch (err) { toast.error(err.message); }
  };

  const handleDeleteAddon = async (addonId) => {
    const ok = await confirm({ title: 'Remove Addon', description: 'Remove this addon permanently? This cannot be undone.', confirmLabel: 'Remove' });
    if (!ok) return;
    try {
      await api.delete(`assets/${assetId}/addons/${addonId}`);
      toast.success('Addon removed');
      loadData();
    } catch (err) { toast.error(err.message); }
  };

  const handleCompleteMaintenance = async () => {
    try {
      await api.post('maintenance/complete', {
        maintenance_id: completeFormData.maintenance_id,
        work_performed: completeFormData.work_performed,
        maintenance_cost: completeFormData.maintenance_cost,
        technician_cost: completeFormData.technician_cost,
        currency: completeFormData.currency
      });
      toast.success('Maintenance completed - You can now reassign from Maintenance page');
      setCompleteDialogOpen(false);
      loadData();
    } catch (err) { toast.error(err.message); }
  };

  const handleDocUpload = async (e, docType) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setDocUploading(docType);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('asset_id', assetId);
      fd.append('doc_type', docType);
      const form = docForms[docType] || {};
      if (form.notes) fd.append('notes', form.notes);
      if (form.month) fd.append('month', form.month);
      if (form.handover_date) fd.append('handover_date', form.handover_date);
      if (form.return_date) fd.append('return_date', form.return_date);
      if (form.from_person) fd.append('from_person', form.from_person);
      if (form.to_person) fd.append('to_person', form.to_person);
      if (form.temp_custodian) fd.append('temp_custodian', form.temp_custodian);
      await api.upload('assets/documents', fd);
      toast.success('Document uploaded');
      const docs = await api.get(`assets/${assetId}/documents`);
      setDocuments(docs);
      setDocForms(prev => ({ ...prev, [docType]: {} }));
    } catch (err) { toast.error(err.message); }
    setDocUploading(null);
  };

  const updateDocForm = (type, field, value) => {
    setDocForms(prev => ({ ...prev, [type]: { ...(prev[type] || {}), [field]: value } }));
  };

  const handleDocDelete = async (docId) => {
    const ok = await confirm({ title: 'Delete Document', description: 'This document will be permanently deleted.', confirmLabel: 'Delete' });
    if (!ok) return;
    try {
      await api.delete(`assets/documents/${docId}`);
      setDocuments(prev => prev.filter(d => d.id !== docId));
      toast.success('Document deleted');
    } catch (err) { toast.error(err.message); }
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const openBillingDialog = () => {
    const nextMonth = asset.renewal_date
      ? new Date(new Date(asset.renewal_date).setMonth(new Date(asset.renewal_date).getMonth() + 1)).toISOString().split('T')[0]
      : new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
    setBillingData({ paid: true, new_billing_date: nextMonth, notes: '' });
    setBillingDialogOpen(true);
  };

  const handleBillingUpdate = async () => {
    if (!billingData.new_billing_date) return toast.error('Please select a new billing date');
    setBillingLoading(true);
    try {
      await api.post('assets/billing-update', { asset_id: assetId, new_billing_date: billingData.new_billing_date, paid: billingData.paid, notes: billingData.notes });
      toast.success(`Billing date updated to ${billingData.new_billing_date}`);
      setBillingDialogOpen(false);
      loadData();
    } catch (err) { toast.error(err.message); }
    setBillingLoading(false);
  };

  const handleToggleShared = async (enable) => {
    try {
      await api.put(`assets/${assetId}`, { isShared: enable, sharedAssignees: enable ? (asset.sharedAssignees || []) : [] });
      loadData();
    } catch (err) { toast.error(err.message); }
  };

  const handleAddAssignee = async () => {
    if (!addAssigneeEmpId) return;
    setSharedLoading(true);
    try {
      await api.post(`assets/${assetId}/assignees`, { employee_id: addAssigneeEmpId });
      toast.success('Assignee added');
      setSharedDialogOpen(false);
      setAddAssigneeEmpId('');
      loadData();
    } catch (err) { toast.error(err.message); }
    setSharedLoading(false);
  };

  const handleRemoveAssignee = async (empId, empName) => {
    const ok = await confirm({ title: 'Remove Assignee', description: `Remove ${empName} from this subscription?`, confirmLabel: 'Remove' });
    if (!ok) return;
    try {
      await api.delete(`assets/${assetId}/assignees/${empId}`);
      toast.success('Assignee removed');
      loadData();
    } catch (err) { toast.error(err.message); }
  };

  if (!asset) return <div className="p-8"><ITdockPageLoader label="Loading asset" /></div>;

  const employeeOptions = [{ id: 'company', name: 'Company' }, ...employees.map(e => ({ id: e.id, name: `${e.name} (${e.employee_id})` }))];
  const selectedAssignEmployee = employees.find(e => e.id === assignData.employee_id);
  const selectedAssignProject = filterOptions.projects?.find(p => p.id === selectedAssignEmployee?.project_id)?.name || selectedAssignEmployee?.project_name || 'Not assigned';
  const selectedAssignLocation = filterOptions.locations?.find(l => l.id === selectedAssignEmployee?.location_id)?.name || selectedAssignEmployee?.location_name || 'Not assigned';
  const isExpired = asset.expiry_status === 'Expired';
  const isExpiringOrExpired = asset.asset_type === 'Consumable' && asset.expiry_date;
  const isSubscriptionExpiring = asset.renewal_date && Math.ceil((new Date(asset.renewal_date) - new Date().setHours(0,0,0,0)) / 86400000) <= 7;

  return (
    <div className="p-8">
      <Button variant="ghost" onClick={onBack} className="mb-4"><ArrowLeft className="h-4 w-4 mr-2" />Back to Assets</Button>
      
      <div className="grid grid-cols-3 gap-6">
        <Card className="col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div><CardTitle>{asset.asset_tag}</CardTitle><CardDescription>{asset.category_name || asset.category} - {asset.asset_type}</CardDescription></div>
            <div className="flex space-x-2">
              <Badge className={asset.status === 'In Stock' ? 'bg-green-100 text-green-800' : asset.status === 'Assigned' ? 'bg-blue-100 text-blue-800' : 'bg-[rgba(255,255,255,0.06)] text-[#eae5ec] border border-white/10'}>{asset.status}</Badge>
              {asset.asset_type === 'Physical' && <Badge variant="outline" className={asset.warranty_status === 'Active' ? 'text-green-600' : 'text-red-600'}>Warranty: {asset.warranty_status}</Badge>}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-sm text-[#6E6E73]">Category</p><p className="font-medium">{asset.category_name || asset.category}</p></div>
              {asset.serial_number && <div><p className="text-sm text-[#6E6E73]">Serial Number</p><p className="font-medium flex items-center gap-2">{asset.serial_number}<button title="Copy" onClick={() => { navigator.clipboard.writeText(asset.serial_number); toast.success('Copied!'); }} className="text-[#6E6E73] hover:text-white transition-colors"><Copy className="h-3.5 w-3.5" /></button></p></div>}
              {asset.connection_type && <div><p className="text-sm text-[#6E6E73]">Connection</p><p className="font-medium">{asset.connection_type}</p></div>}
              <div><p className="text-sm text-[#6E6E73]">Brand</p><p className="font-medium">{asset.brand || '-'}</p></div>
              <div><p className="text-sm text-[#6E6E73]">Vendor</p><p className="font-medium">{asset.vendor_name || '-'}</p></div>
              <div><p className="text-sm text-[#6E6E73]">Receive Date</p><p className="font-medium">{asset.receive_date || '-'}</p></div>
              {asset.warranty_end_date && <div><p className="text-sm text-[#6E6E73]">Warranty End</p><p className="font-medium">{asset.warranty_end_date}</p></div>}
              {asset.expiry_date && <div><p className="text-sm text-[#6E6E73]">Expiry Date</p><p className="font-medium">{asset.expiry_date}</p></div>}
              {asset.renewal_date && <div><p className="text-sm text-[#6E6E73]">Next Billing Date</p><p className="font-medium flex items-center gap-2">{asset.renewal_date}{isSubscriptionExpiring && <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{background:'#FF9500', color:'#fff'}}>Due Soon</span>}</p></div>}
              {asset.provider_url && <div><p className="text-sm text-[#6E6E73]">Provider Website</p><p className="font-medium"><a href={asset.provider_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1" style={{color:'#5eead4'}}>{asset.provider_url} <ExternalLink className="h-3.5 w-3.5 shrink-0" /></a></p></div>}
              <div><p className="text-sm text-[#6E6E73]">Project</p><p className="font-medium">{asset.project_name || '-'}</p></div>
              <div><p className="text-sm text-[#6E6E73]">Location</p><p className="font-medium">{asset.location_name || '-'}</p></div>
              <div><p className="text-sm text-[#6E6E73]">Assigned To</p>
                {asset.assigned_employee ? (
                  <p className="font-medium text-[#0071E3] cursor-pointer" onClick={() => onViewEmployee(asset.assigned_employee.id)}>{asset.assigned_employee.name}</p>
                ) : asset.assigned_to === 'company' ? <p className="font-medium">Company</p> : <p className="font-medium">-</p>}
              </div>
              {asset.last_audit_date && <div><p className="text-sm text-[#6E6E73]">Last Audited</p><p className="font-medium flex items-center gap-2">{asset.last_audit_date} {asset.last_audit_result && <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{background: asset.last_audit_result === 'pass' ? 'rgba(52,199,89,0.15)' : 'rgba(255,59,48,0.15)', color: asset.last_audit_result === 'pass' ? '#34C759' : '#FF3B30'}}>{asset.last_audit_result === 'pass' ? 'QC Pass' : 'Action Required'}</span>}</p></div>}
              {asset.next_audit_date && <div><p className="text-sm text-[#6E6E73]">Next Audit Due</p><p className="font-medium">{asset.next_audit_date}</p></div>}
              {asset.notes && <div className="col-span-2"><p className="text-sm text-[#6E6E73]">Notes</p><p className="font-medium">{asset.notes}</p></div>}
            </div>

            {/* Specifications card — hardware and/or IoT fields */}
            {(asset.specs?.processor || asset.specs?.ram || asset.specs?.storage || asset.specs?.gpu || asset.specs?.os || asset.specs?.cores || asset.specs?.bandwidth || asset.ipAddress || asset.specs?.macAddress || asset.specs?.firmware || asset.specs?.vlan || asset.specs?.managementUrl || asset.specs?.ports || asset.specs?.resolution) && (
              <div className="mt-5 pt-4 border-t" style={{borderColor:'rgba(255,255,255,0.08)'}}>
                <div className="flex items-center gap-2 mb-3">
                  {(asset.specs?.macAddress || asset.specs?.firmware) ? <Wifi className="h-4 w-4" style={{color:'#5eead4'}} /> : <Cpu className="h-4 w-4" style={{color:'#5eead4'}} />}
                  <h3 className="text-sm font-semibold" style={{color:'#eae5ec'}}>Specifications</h3>
                  {asset.isIoT && <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{background:'rgba(94,234,212,0.12)', color:'#5eead4', border:'1px solid rgba(94,234,212,0.2)'}}>Network/IoT</span>}
                </div>
                <div className="rounded-xl p-4 space-y-2" style={{background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)'}}>
                  {[
                    { label: 'Processor', value: asset.specs?.processor },
                    { label: 'RAM', value: asset.specs?.ram },
                    { label: 'Storage', value: asset.specs?.storage },
                    { label: 'GPU', value: asset.specs?.gpu },
                    { label: 'Operating System', value: asset.specs?.os },
                    { label: 'CPU Cores', value: asset.specs?.cores },
                    { label: 'Bandwidth', value: asset.specs?.bandwidth },
                    { label: 'MAC Address', value: asset.specs?.macAddress, mono: true },
                    { label: 'VLAN', value: asset.specs?.vlan },
                    { label: 'Firmware', value: asset.specs?.firmware, mono: true },
                    { label: 'Ports', value: asset.specs?.ports },
                    { label: 'Resolution', value: asset.specs?.resolution },
                  ].filter(r => r.value).map(r => (
                    <div key={r.label} className="flex items-center justify-between py-0.5">
                      <span className="text-xs" style={{color:'rgba(234,229,236,0.5)', minWidth:'110px'}}>{r.label}</span>
                      <span className={`text-sm font-medium flex-1 text-right ${r.mono ? 'font-mono' : ''}`} style={{color:'#eae5ec'}}>{r.value}</span>
                    </div>
                  ))}
                  {asset.specs?.managementUrl && (
                    <div className="flex items-center justify-between py-0.5">
                      <span className="text-xs" style={{color:'rgba(234,229,236,0.5)', minWidth:'110px'}}>Mgmt URL</span>
                      <a href={asset.specs.managementUrl} target="_blank" rel="noopener noreferrer" className="text-sm flex items-center gap-1.5 flex-1 justify-end" style={{color:'#5eead4'}}>
                        {asset.specs.managementUrl.replace(/^https?:\/\//, '')}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  )}
                  {asset.ipAddress && (
                    <div className="flex items-center justify-between py-0.5 mt-1 pt-2" style={{borderTop:'1px solid rgba(255,255,255,0.06)'}}>
                      <span className="text-xs" style={{color:'rgba(234,229,236,0.5)', minWidth:'110px'}}>IP Address</span>
                      <span className="text-sm font-mono font-medium flex items-center gap-2" style={{color:'#5eead4'}}>
                        {asset.ipAddress}
                        <button title="Copy" onClick={() => { navigator.clipboard.writeText(asset.ipAddress); toast.success('IP copied!'); }}><Copy className="h-3 w-3" style={{color:'rgba(94,234,212,0.6)'}} /></button>
                      </span>
                    </div>
                  )}
                  {asset.ipAddresses?.length > 0 && (
                    <div className="flex items-start justify-between py-0.5">
                      <span className="text-xs" style={{color:'rgba(234,229,236,0.5)', minWidth:'110px'}}>Additional IPs</span>
                      <div className="flex flex-wrap gap-1.5 justify-end">
                        {asset.ipAddresses.map(ip => (
                          <span key={ip} className="text-xs font-mono flex items-center gap-1 px-2 py-0.5 rounded" style={{background:'rgba(94,234,212,0.08)', color:'#5eead4'}}>
                            {ip}
                            <button title="Copy" onClick={() => { navigator.clipboard.writeText(ip); toast.success('IP copied!'); }}><Copy className="h-3 w-3" /></button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2 mt-6 pt-4 border-t">
              {canAssign && asset.status === 'In Stock' && <Button onClick={() => { setAssignData({}); setAssignDialogOpen(true); }} className="bg-[#0d9488]">Assign Asset</Button>}
              {canAssign && ['Assigned', 'Temporarily Assigned', 'Handed Over (Vacation Coverage)'].includes(asset.status) && <Button onClick={handleUnassign} variant="outline">Unassign</Button>}
              {canAssign && asset.assigned_employee && asset.status === 'Assigned' && (
                <Button variant="outline" onClick={() => setVacationModalOpen(true)} style={{borderColor:'#FF9500', color:'#FF9500'}}>
                  <Calendar className="h-4 w-4 mr-1.5" />Send on Vacation
                </Button>
              )}
              {canAssign && asset.status === 'In Maintenance' && (() => {
                const inProgressRecord = maintenanceRecords.find(m => m.status === 'in_progress');
                const completedRecords = maintenanceRecords.filter(m => m.status === 'completed' && asset.status === 'In Maintenance');
                
                if (inProgressRecord) {
                  // Show Complete Maintenance button
                  return (
                    <Button onClick={() => {
                      setCompleteFormData({
                        maintenance_id: inProgressRecord.id,
                        work_performed: inProgressRecord.work_performed || '',
                        maintenance_cost: inProgressRecord.maintenance_cost || '',
                        technician_cost: inProgressRecord.technician_cost || '',
                        currency: inProgressRecord.currency || 'USD'
                      });
                      setCompleteDialogOpen(true);
                    }} className="bg-green-600 hover:bg-green-700 text-white">
                      <Check className="h-4 w-4 mr-2" />Complete Maintenance
                    </Button>
                  );
                } else if (completedRecords.length > 0) {
                  // Show message to go to Maintenance page for reassignment
                  return (
                    <Alert className="flex-1">
                      <AlertDescription className="flex items-center justify-between">
                        <span>Maintenance completed. Go to Maintenance page to reassign this asset.</span>
                        <Button size="sm" onClick={onNavigateToMaintenance} className="bg-[#0d9488] hover:bg-[#0062CC] ml-4">
                          Go to Maintenance
                        </Button>
                      </AlertDescription>
                    </Alert>
                  );
                }
                return null;
              })()}
              {isExpiringOrExpired && <Button onClick={() => { setRenewData({}); setRenewDialogOpen(true); }} variant="outline" className={isExpired ? 'border-red-300 text-red-600 hover:bg-red-50' : ''}><RefreshCw className="h-4 w-4 mr-2" />{isExpired ? 'Renew (Expired)' : 'Renew / Extend'}</Button>}
              {isSubscriptionExpiring && canAssign && <Button onClick={openBillingDialog} style={{background:'#0d9488', color:'#fff'}}><CreditCard className="h-4 w-4 mr-2" />Mark as Paid / Update Billing Date</Button>}
            </div>
            
            {/* Shared Assignees — subscription assets only */}
            {asset.category_type === 'SUBSCRIPTION' && (
              <div className="mt-6 pt-4 border-t">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold flex items-center gap-2">
                    <Users className="h-4 w-4" style={{color:'#5eead4'}} />
                    Shared Assignees
                    {asset.isShared && <span className="text-xs font-medium px-1.5 py-0.5 rounded" style={{background:'rgba(94,234,212,0.15)', color:'#5eead4'}}>{(asset.sharedAssignees?.length || 0)} seats</span>}
                  </h3>
                  {canAssign && (
                    <div className="flex items-center gap-2">
                      {!asset.isShared ? (
                        <Button size="sm" variant="outline" onClick={() => handleToggleShared(true)} style={{borderColor:'rgba(94,234,212,0.3)', color:'#5eead4'}}>
                          <Users className="h-3.5 w-3.5 mr-1.5" />Enable Shared
                        </Button>
                      ) : (
                        <>
                          <Button size="sm" onClick={() => { setAddAssigneeEmpId(''); setSharedDialogOpen(true); }} style={{background:'#0d9488', color:'#fff'}}>
                            <UserPlus className="h-3.5 w-3.5 mr-1.5" />Add Seat
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleToggleShared(false)} className="text-xs" style={{color:'rgba(234,229,236,0.4)'}}>Disable</Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
                {asset.isShared && (asset.sharedAssignees?.length || 0) === 0 && (
                  <p className="text-sm" style={{color:'rgba(234,229,236,0.4)'}}>No assignees yet. Click "Add Seat" to grant access.</p>
                )}
                {(asset.sharedAssignees || []).map(sa => (
                  <div key={sa.employee_id} className="flex items-center justify-between p-2.5 rounded-lg mb-1.5" style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)'}}>
                    <div>
                      <p className="text-sm font-medium">{sa.employee_name}</p>
                      <p className="text-xs" style={{color:'rgba(234,229,236,0.4)'}}>Added {sa.added_date} by {sa.added_by}</p>
                    </div>
                    {canAssign && (
                      <Button size="sm" variant="ghost" onClick={() => handleRemoveAssignee(sa.employee_id, sa.employee_name)} title="Remove">
                        <UserMinus className="h-3.5 w-3.5" style={{color:'#FF3B30'}} />
                      </Button>
                    )}
                  </div>
                ))}
                {!asset.isShared && (
                  <p className="text-sm" style={{color:'rgba(234,229,236,0.4)'}}>Shared mode is off. Enable to track multiple users on this subscription.</p>
                )}
              </div>
            )}

            {/* Addons — shown for all assets; always visible if user can manage */}
            {(() => {
              const today = new Date().toISOString().slice(0, 10);
              const soon = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
              const renewColor = (d) => {
                if (!d) return {};
                if (d < today) return { color: '#FF3B30' };
                if (d <= soon) return { color: '#FF9500' };
                return { color: '#5eead4' };
              };
              return (
                <div className="mt-6 pt-4 border-t" style={{borderColor:'rgba(255,255,255,0.08)'}}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold flex items-center gap-2" style={{color:'#eae5ec'}}>
                      <Package className="h-4 w-4" style={{color:'#5eead4'}} />
                      Addons
                      {addons.filter(a => a.status === 'active').length > 0 && (
                        <span className="text-xs font-medium px-1.5 py-0.5 rounded" style={{background:'rgba(94,234,212,0.15)', color:'#5eead4'}}>
                          {addons.filter(a => a.status === 'active').length} active
                        </span>
                      )}
                    </h3>
                    {canAssign && (
                      <Button size="sm" onClick={() => openAddonDialog()} style={{background:'#0d9488', color:'#fff'}}>
                        <PlusCircle className="h-3.5 w-3.5 mr-1.5" />Add Addon
                      </Button>
                    )}
                  </div>
                  {addons.length === 0 ? (
                    <p className="text-sm" style={{color:'rgba(234,229,236,0.4)'}}>No addons yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {addons.map(addon => (
                        <div key={addon.id} className="flex items-center justify-between p-3 rounded-xl" style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.07)'}}>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-semibold" style={{color:'#eae5ec'}}>{addon.name}</span>
                              {addon.provider && <span className="text-xs" style={{color:'rgba(234,229,236,0.5)'}}>{addon.provider}</span>}
                              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${addon.status === 'active' ? 'bg-green-900/30 text-green-400' : addon.status === 'cancelled' ? 'bg-red-900/30 text-red-400' : 'bg-yellow-900/30 text-yellow-400'}`}>
                                {addon.status}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 mt-1 flex-wrap">
                              {addon.cost != null && <span className="text-xs" style={{color:'rgba(234,229,236,0.6)'}}>{addon.cost} {addon.currency} / {addon.billingCycle}</span>}
                              {addon.renewalDate && (
                                <span className="text-xs font-medium" style={renewColor(addon.renewalDate)}>
                                  Renews {addon.renewalDate}
                                  {addon.renewalDate < today && ' (overdue)'}
                                  {addon.renewalDate >= today && addon.renewalDate <= soon && ' (soon)'}
                                </span>
                              )}
                            </div>
                            {addon.notes && <p className="text-xs mt-0.5" style={{color:'rgba(234,229,236,0.4)'}}>{addon.notes}</p>}
                          </div>
                          {canAssign && (
                            <div className="flex items-center gap-1 ml-3 shrink-0">
                              <Button size="sm" variant="ghost" onClick={() => openAddonDialog(addon)} title="Edit">
                                <Pencil className="h-3.5 w-3.5" style={{color:'rgba(234,229,236,0.5)'}} />
                              </Button>
                              {addon.status === 'active' && (
                                <Button size="sm" variant="ghost" onClick={() => handleCancelAddon(addon.id)} title="Cancel addon">
                                  <XCircle className="h-3.5 w-3.5" style={{color:'#FF9500'}} />
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" onClick={() => handleDeleteAddon(addon.id)} title="Remove">
                                <Trash2 className="h-3.5 w-3.5" style={{color:'#FF3B30'}} />
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Maintenance History */}
            {maintenanceRecords.length > 0 && (
              <div className="mt-6 pt-4 border-t">
                <h3 className="font-semibold mb-3">Maintenance History</h3>
                <div className="space-y-3">
                  {maintenanceRecords.map(record => {
                    const totalCost = (parseFloat(record.maintenance_cost) || 0) + (parseFloat(record.technician_cost) || 0);
                    return (
                      <div key={record.id} className="p-3 border rounded-lg" style={{background:'rgba(255,255,255,0.035)', borderColor:'rgba(255,255,255,0.08)'}}>
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <p className="font-medium text-sm">{record.date}</p>
                            <p className="text-sm text-[#6E6E73]">{record.description}</p>
                            {record.work_performed && (
                              <p className="text-xs text-[#6E6E73] mt-1">Work: {record.work_performed}</p>
                            )}
                          </div>
                          <Badge className={
                            record.status === 'completed' ? 'bg-green-100 text-green-800' :
                            record.status === 'scrapped' ? 'bg-red-100 text-red-800' :
                            'bg-yellow-100 text-yellow-800'
                          }>
                            {record.status === 'in_progress' ? 'In Progress' : record.status}
                          </Badge>
                        </div>
                        <div className="flex justify-between items-center text-xs text-[#6E6E73]">
                          <span>Location: {record.maintenance_location || 'N/A'}</span>
                          {totalCost > 0 && (
                            <span className="font-medium" style={{color:'#5eead4'}}>
                              {totalCost.toFixed(2)} {record.currency || 'USD'}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[#AEAEB2] mt-1">By: {record.performed_by}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {/* Documents Section — 5 types */}
            {(() => {
              const isSubscription = asset.category_type === 'SUBSCRIPTION';
              const canUpload = ['super_admin', 'it_admin', 'it_technician'].includes(user.role);
              const docsByType = (type) => documents.filter(d => d.doc_type === type);

              const DocRow = ({ doc }) => (
                <div key={doc.id} className="flex items-center justify-between p-2.5 rounded-lg" style={{background:'#0a0e17', border:'1px solid rgba(255,255,255,0.06)'}}>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FileText className="h-4 w-4 shrink-0" style={{color:'#5eead4'}} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{doc.filename}</p>
                      <p className="text-xs" style={{color:'rgba(234,229,236,0.4)'}}>
                        {formatFileSize(doc.size)} · {new Date(doc.uploaded_at).toLocaleDateString()} · {doc.uploaded_by_name}
                        {doc.month && ` · ${doc.month}`}
                        {doc.handover_date && ` · Handover: ${doc.handover_date}`}
                        {doc.notes && ` · ${doc.notes}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-3">
                    <Button size="sm" variant="ghost" onClick={() => window.open(`/api/assets/documents/${doc.id}`, '_blank')} title="Download"><Download className="h-3.5 w-3.5" /></Button>
                    {canDeleteDoc && <Button size="sm" variant="ghost" onClick={() => handleDocDelete(doc.id)} title="Delete"><Trash2 className="h-3.5 w-3.5" style={{color:'#FF3B30'}} /></Button>}
                  </div>
                </div>
              );

              const DocSection = ({ type, title, accept, hint, fileRef, extraFields }) => {
                const typeDocs = docsByType(type);
                const isUploading = docUploading === type;
                return (
                  <div className="mt-5 pt-4 border-t">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-semibold" style={{color:'#eae5ec'}}>{title} <span className="font-normal text-xs ml-1" style={{color:'rgba(234,229,236,0.4)'}}>({hint})</span></h4>
                      {canUpload && (
                        <div className="flex items-center gap-1.5">
                          <input ref={fileRef} type="file" accept={accept} style={{display:'none'}} onChange={(e) => handleDocUpload(e, type)} />
                          <Button size="sm" className="bg-[#0d9488] hover:bg-[#0062CC] text-white h-7 text-xs px-2.5" onClick={() => fileRef.current?.click()} disabled={!!docUploading}>
                            <Upload className="h-3 w-3 mr-1" />{isUploading ? 'Uploading...' : 'Upload'}
                          </Button>
                        </div>
                      )}
                    </div>
                    {canUpload && extraFields}
                    {typeDocs.length === 0 ? (
                      <p className="text-xs" style={{color:'rgba(234,229,236,0.4)'}}>No {title.toLowerCase()} uploaded yet.</p>
                    ) : (
                      <div className="space-y-1.5 mt-2">{typeDocs.map(doc => <DocRow key={doc.id} doc={doc} />)}</div>
                    )}
                  </div>
                );
              };

              return (
                <div className="mt-6 pt-4 border-t">
                  <h3 className="font-semibold mb-1">Documents</h3>

                  <DocSection
                    type="note" title="PDF Notes" accept=".pdf" hint="PDF only, max 5MB" fileRef={noteFileRef}
                    extraFields={<Input className="mb-2 h-7 text-xs" placeholder="Notes (optional)" value={docForms.note?.notes || ''} onChange={e => updateDocForm('note', 'notes', e.target.value)} />}
                  />

                  <DocSection
                    type="invoice" title="Invoices" accept=".pdf,.jpg,.jpeg,.png" hint="PDF/JPG/PNG, max 10MB" fileRef={invoiceFileRef}
                    extraFields={<Input className="mb-2 h-7 text-xs" placeholder="Notes (optional)" value={docForms.invoice?.notes || ''} onChange={e => updateDocForm('invoice', 'notes', e.target.value)} />}
                  />

                  {isSubscription && (
                    <DocSection
                      type="subscription_invoice" title="Subscription Invoices" accept=".pdf" hint="PDF only, max 10MB" fileRef={subInvoiceFileRef}
                      extraFields={
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <input type="month" className="h-7 text-xs rounded-md border px-2" style={{borderColor:'rgba(255,255,255,0.12)'}} value={docForms.subscription_invoice?.month || ''} onChange={e => updateDocForm('subscription_invoice', 'month', e.target.value)} placeholder="Month" />
                          <Input className="h-7 text-xs" placeholder="Description (optional)" value={docForms.subscription_invoice?.notes || ''} onChange={e => updateDocForm('subscription_invoice', 'notes', e.target.value)} />
                        </div>
                      }
                    />
                  )}

                  <DocSection
                    type="custody_handover" title="Custody Handover Papers" accept=".pdf" hint="PDF only, max 10MB" fileRef={custodyFileRef}
                    extraFields={
                      <div className="grid grid-cols-2 gap-2 mb-2">
                        <div><p className="text-xs mb-0.5" style={{color:'rgba(234,229,236,0.6)'}}>Handover Date</p><Input type="date" className="h-7 text-xs" value={docForms.custody_handover?.handover_date || ''} onChange={e => updateDocForm('custody_handover', 'handover_date', e.target.value)} /></div>
                        <Input className="h-7 text-xs" placeholder="Handed From" value={docForms.custody_handover?.from_person || ''} onChange={e => updateDocForm('custody_handover', 'from_person', e.target.value)} />
                        <Input className="h-7 text-xs" placeholder="Handed To" value={docForms.custody_handover?.to_person || ''} onChange={e => updateDocForm('custody_handover', 'to_person', e.target.value)} />
                        <Input className="h-7 text-xs" placeholder="Description (optional)" value={docForms.custody_handover?.notes || ''} onChange={e => updateDocForm('custody_handover', 'notes', e.target.value)} />
                      </div>
                    }
                  />

                  <DocSection
                    type="temp_custody_handover" title="Temporary Custody Handover (Vacation)" accept=".pdf" hint="PDF only, max 10MB" fileRef={tempCustodyFileRef}
                    extraFields={
                      <div className="grid grid-cols-2 gap-2 mb-2">
                        <div><p className="text-xs mb-0.5" style={{color:'rgba(234,229,236,0.6)'}}>Handover Date</p><Input type="date" className="h-7 text-xs" value={docForms.temp_custody_handover?.handover_date || ''} onChange={e => updateDocForm('temp_custody_handover', 'handover_date', e.target.value)} /></div>
                        <div><p className="text-xs mb-0.5" style={{color:'rgba(234,229,236,0.6)'}}>Return Date</p><Input type="date" className="h-7 text-xs" value={docForms.temp_custody_handover?.return_date || ''} onChange={e => updateDocForm('temp_custody_handover', 'return_date', e.target.value)} /></div>
                        <Input className="h-7 text-xs" placeholder="Temp Custodian Name" value={docForms.temp_custody_handover?.temp_custodian || ''} onChange={e => updateDocForm('temp_custody_handover', 'temp_custodian', e.target.value)} />
                        <Input className="h-7 text-xs" placeholder="Description (optional)" value={docForms.temp_custody_handover?.notes || ''} onChange={e => updateDocForm('temp_custody_handover', 'notes', e.target.value)} />
                      </div>
                    }
                  />
                </div>
              );
            })()}
          </CardContent>
        </Card>

        {/* Audit History */}
        {assetAudits.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-lg">Audit History</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {assetAudits.map(audit => {
                  const passCount = (audit.checklist || []).filter(c => c.status === 'pass').length;
                  const total = (audit.checklist || []).length;
                  return (
                    <div key={audit.id} className="flex items-center justify-between p-3 rounded-lg" style={{background:'#0a0e17', border:'1px solid rgba(255,255,255,0.06)'}}>
                      <div className="min-w-0">
                        <p className="text-sm font-medium" style={{color:'#eae5ec'}}>{audit.scheduledDate}</p>
                        <p className="text-xs mt-0.5" style={{color:'rgba(234,229,236,0.5)'}}>By: {audit.conducted_by_name || '—'} · {passCount}/{total} pass</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-3">
                        <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{background: audit.status === 'completed' ? 'rgba(52,199,89,0.15)' : audit.status === 'overdue' ? 'rgba(255,59,48,0.15)' : 'rgba(59,130,246,0.15)', color: audit.status === 'completed' ? '#34C759' : audit.status === 'overdue' ? '#FF3B30' : '#60a5fa'}}>{audit.status}</span>
                        {audit.result && <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{background: audit.result === 'pass' ? 'rgba(52,199,89,0.15)' : 'rgba(255,59,48,0.15)', color: audit.result === 'pass' ? '#34C759' : '#FF3B30'}}>{audit.result === 'pass' ? 'Pass' : 'Fail'}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle className="text-lg">Activity Log</CardTitle></CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              {asset.activity_log?.length > 0 ? (
                <div className="space-y-4">
                  {asset.activity_log.map((log) => (
                    <div key={log.id} className="flex space-x-3 pb-3 border-b border-gray-100">
                      <Clock className="h-4 w-4 text-[#AEAEB2] mt-1 shrink-0" />
                      <div>
                        <p className="text-sm font-medium">{log.action}</p>
                        <p className="text-sm text-[#6E6E73]">{log.details}</p>
                        <p className="text-xs text-[#AEAEB2] mt-1">{new Date(log.timestamp).toLocaleString()} by {log.user_name}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="text-[#AEAEB2] text-sm">No activity recorded</p>}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Assign Dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Assign Asset</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Assign To *</Label>
              <SearchableSelect options={employeeOptions} value={assignData.employee_id} onChange={(v) => setAssignData({...assignData, employee_id: v})} placeholder="Select employee..." onCreateNew={() => { setAssignDialogOpen(false); onNavigateToEmployeeCreate(); }} />
            </div>
            {assignData.employee_id === 'company' ? <>
              <div><Label>Project</Label><SearchableSelect options={filterOptions.projects || []} value={assignData.project_id} onChange={(v) => setAssignData({...assignData, project_id: v})} placeholder="Select project..." /></div>
              <div><Label>Location</Label><SearchableSelect options={filterOptions.locations || []} value={assignData.location_id} onChange={(v) => setAssignData({...assignData, location_id: v})} placeholder="Select location..." /></div>
            </> : <>
              <div><Label>Project</Label><Input value={selectedAssignEmployee ? selectedAssignProject : 'Select an employee first'} readOnly disabled /></div>
              <div><Label>Location</Label><Input value={selectedAssignEmployee ? selectedAssignLocation : 'Select an employee first'} readOnly disabled /></div>
            </>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleAssign} className="bg-[#0d9488]" disabled={!assignData.employee_id}>Assign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Renew Dialog */}
      <Dialog open={renewDialogOpen} onOpenChange={setRenewDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Renew Asset</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>New Expiry Date</Label><Input type="date" value={renewData.expiry_date || ''} onChange={(e) => setRenewData({...renewData, expiry_date: e.target.value})} /></div>
            <div><Label>Next Renewal Date</Label><Input type="date" value={renewData.renewal_date || ''} onChange={(e) => setRenewData({...renewData, renewal_date: e.target.value})} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenewDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleRenew} className="bg-[#0d9488]">Renew</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Bill Payment Dialog */}
      <Dialog open={billingDialogOpen} onOpenChange={setBillingDialogOpen}>
        <DialogContent style={{background:'#050810', border:'1px solid rgba(255,255,255,0.10)', color:'#eae5ec'}}>
          <DialogHeader><DialogTitle>Confirm Bill Payment</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-xs mb-1" style={{color:'rgba(234,229,236,0.5)'}}>Asset</p><p className="text-sm font-medium">{asset?.asset_tag}</p></div>
              <div><p className="text-xs mb-1" style={{color:'rgba(234,229,236,0.5)'}}>Current Billing Date</p><p className="text-sm font-medium">{asset?.renewal_date || '—'}</p></div>
            </div>
            <div>
              <Label className="text-xs mb-1 block" style={{color:'rgba(234,229,236,0.7)'}}>Have you paid this bill?</Label>
              <div className="flex gap-2">
                <button className="flex-1 py-1.5 rounded text-sm font-medium" style={{background: billingData.paid ? '#0d9488' : 'rgba(255,255,255,0.06)', color: billingData.paid ? '#fff' : 'rgba(234,229,236,0.5)'}} onClick={() => setBillingData(d => ({...d, paid: true}))}>Yes</button>
                <button className="flex-1 py-1.5 rounded text-sm font-medium" style={{background: !billingData.paid ? '#FF3B30' : 'rgba(255,255,255,0.06)', color: !billingData.paid ? '#fff' : 'rgba(234,229,236,0.5)'}} onClick={() => setBillingData(d => ({...d, paid: false}))}>No</button>
              </div>
            </div>
            <div>
              <Label className="text-xs mb-1 block" style={{color:'rgba(234,229,236,0.7)'}}>Next Billing Date <span style={{color:'#FF3B30'}}>*</span></Label>
              <Input type="date" value={billingData.new_billing_date} onChange={e => setBillingData(d => ({...d, new_billing_date: e.target.value}))} style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.12)', color:'#eae5ec'}} />
            </div>
            <div>
              <Label className="text-xs mb-1 block" style={{color:'rgba(234,229,236,0.7)'}}>Payment Notes (optional)</Label>
              <Input placeholder="Invoice number, amount, etc." value={billingData.notes} onChange={e => setBillingData(d => ({...d, notes: e.target.value}))} style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.12)', color:'#eae5ec'}} />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={() => setBillingDialogOpen(false)} style={{color:'rgba(234,229,236,0.6)'}}>Cancel</Button>
            <Button onClick={handleBillingUpdate} disabled={billingLoading} style={{background:'#0d9488', color:'#fff'}}>{billingLoading ? 'Saving...' : 'Confirm & Update'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Complete Maintenance Dialog */}
      <Dialog open={completeDialogOpen} onOpenChange={setCompleteDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Complete Maintenance</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Work Performed *</Label>
              <Textarea 
                value={completeFormData.work_performed || ''} 
                onChange={(e) => setCompleteFormData({...completeFormData, work_performed: e.target.value})} 
                rows={3} 
                placeholder="Describe what was done..." 
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Maintenance Cost</Label>
                <Input 
                  type="number" 
                  step="0.01" 
                  value={completeFormData.maintenance_cost} 
                  onChange={(e) => setCompleteFormData({...completeFormData, maintenance_cost: e.target.value})} 
                  placeholder="0.00"
                />
              </div>
              <div>
                <Label>Technician Cost</Label>
                <Input 
                  type="number" 
                  step="0.01" 
                  value={completeFormData.technician_cost} 
                  onChange={(e) => setCompleteFormData({...completeFormData, technician_cost: e.target.value})} 
                  placeholder="0.00"
                />
              </div>
            </div>
            <div>
              <Label>Currency</Label>
              <Select value={completeFormData.currency} onValueChange={(v) => setCompleteFormData({...completeFormData, currency: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {currencies.map(cur => <SelectItem key={cur} value={cur}>{cur}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Alert>
              <AlertDescription>
                After completing, go to the Maintenance page to reassign this asset.
              </AlertDescription>
            </Alert>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleCompleteMaintenance}
              className="bg-green-600 hover:bg-green-700 text-white"
              disabled={!completeFormData.work_performed}
            >
              <Check className="h-4 w-4 mr-2" />Complete Maintenance
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Shared Assignee Dialog */}
      <Dialog open={sharedDialogOpen} onOpenChange={setSharedDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Seat — {asset.asset_tag}</DialogTitle><DialogDescription>Select an employee to grant access to this shared subscription.</DialogDescription></DialogHeader>
          <div className="space-y-3 py-2">
            <Label>Employee *</Label>
            <SearchableSelect
              options={employees.filter(e => !(asset.sharedAssignees || []).some(sa => sa.employee_id === e.id)).map(e => ({ id: e.id, name: `${e.name} (${e.employee_id})` }))}
              value={addAssigneeEmpId}
              onChange={setAddAssigneeEmpId}
              placeholder="Search employee..."
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSharedDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleAddAssignee} disabled={!addAssigneeEmpId || sharedLoading} style={{background:'#0d9488', color:'#fff'}}>{sharedLoading ? 'Adding...' : 'Add Seat'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add / Edit Addon Dialog */}
      <Dialog open={addonDialogOpen} onOpenChange={setAddonDialogOpen}>
        <DialogContent style={{background:'#050810', border:'1px solid rgba(255,255,255,0.10)', color:'#eae5ec', maxWidth:'480px'}}>
          <DialogHeader>
            <DialogTitle style={{color:'#eae5ec'}}>{addonEditing ? 'Edit Addon' : 'Add Addon'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div><Label className="text-xs mb-1 block" style={{color:'rgba(234,229,236,0.6)'}}>Name *</Label>
              <Input placeholder="e.g. Cloudflare Pro" value={addonForm.name} onChange={e => setAddonForm({...addonForm, name: e.target.value})} /></div>
            <div><Label className="text-xs mb-1 block" style={{color:'rgba(234,229,236,0.6)'}}>Provider</Label>
              <Input placeholder="e.g. Cloudflare" value={addonForm.provider} onChange={e => setAddonForm({...addonForm, provider: e.target.value})} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs mb-1 block" style={{color:'rgba(234,229,236,0.6)'}}>Cost</Label>
                <Input type="number" placeholder="0.00" value={addonForm.cost} onChange={e => setAddonForm({...addonForm, cost: e.target.value})} /></div>
              <div><Label className="text-xs mb-1 block" style={{color:'rgba(234,229,236,0.6)'}}>Currency</Label>
                <select value={addonForm.currency} onChange={e => setAddonForm({...addonForm, currency: e.target.value})} className="w-full h-9 px-2 rounded-md text-sm" style={{background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)', color:'#eae5ec'}}>
                  {['SAR','USD','GBP','EUR','AED','QAR','KWD','INR','PKR','BDT'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div><Label className="text-xs mb-1 block" style={{color:'rgba(234,229,236,0.6)'}}>Billing Cycle *</Label>
              <select value={addonForm.billingCycle} onChange={e => setAddonForm({...addonForm, billingCycle: e.target.value})} className="w-full h-9 px-2 rounded-md text-sm" style={{background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)', color:'#eae5ec'}}>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
                <option value="one-time">One-time</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs mb-1 block" style={{color:'rgba(234,229,236,0.6)'}}>Start Date</Label>
                <Input type="date" value={addonForm.startDate} onChange={e => setAddonForm({...addonForm, startDate: e.target.value})} /></div>
              <div><Label className="text-xs mb-1 block" style={{color:'rgba(234,229,236,0.6)'}}>Renewal Date</Label>
                <Input type="date" value={addonForm.renewalDate} onChange={e => setAddonForm({...addonForm, renewalDate: e.target.value})} /></div>
            </div>
            {addonEditing && (
              <div><Label className="text-xs mb-1 block" style={{color:'rgba(234,229,236,0.6)'}}>Status</Label>
                <select value={addonForm.status || 'active'} onChange={e => setAddonForm({...addonForm, status: e.target.value})} className="w-full h-9 px-2 rounded-md text-sm" style={{background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)', color:'#eae5ec'}}>
                  <option value="active">Active</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="expired">Expired</option>
                </select>
              </div>
            )}
            <div><Label className="text-xs mb-1 block" style={{color:'rgba(234,229,236,0.6)'}}>Notes</Label>
              <Input placeholder="Optional notes" value={addonForm.notes} onChange={e => setAddonForm({...addonForm, notes: e.target.value})} /></div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setAddonDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveAddon} disabled={addonSaving} style={{background:'#0d9488', color:'#fff'}}>
              {addonSaving ? 'Saving…' : addonEditing ? 'Save Changes' : 'Add Addon'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Vacation Modal — pre-filled with this asset's employee */}
      {asset.assigned_employee && (
        <VacationModal
          open={vacationModalOpen}
          onOpenChange={setVacationModalOpen}
          employee={asset.assigned_employee}
          preselectedAssetId={assetId}
          employees={employees}
          onConfirm={async (data) => {
            try {
              await api.post('vacation/start', data);
              toast.success('Vacation started — assets routed');
              setVacationModalOpen(false);
              loadData();
            } catch (err) { toast.error(err.message); }
          }}
        />
      )}
    </div>
  );
}

// Assignments Page
function AssignmentsPage({ user, onViewAsset }) {
  const [assignments, setAssignments] = useState([]);
  const [unassignedAssets, setUnassignedAssets] = useState([]);
  const [filterOptions, setFilterOptions] = useState({});
  const [filters, setFilters] = useState({});
  const [employees, setEmployees] = useState([]);
  const [quickAssignOpen, setQuickAssignOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [assignTo, setAssignTo] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalAssignments, setTotalAssignments] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [unassignedPage, setUnassignedPage] = useState(1);
  const [unassignedTotal, setUnassignedTotal] = useState(0);
  const [unassignedPages, setUnassignedPages] = useState(1);

  const canAssign = ['super_admin', 'it_admin', 'it_technician'].includes(user.role);

  useEffect(() => { loadReferenceData(); }, [unassignedPage]);
  useEffect(() => { loadAssignments(); }, [filters, currentPage]);

  const loadReferenceData = async () => {
    try {
      const [unassignedData, opts, emps] = await Promise.all([
        api.get(`assets/unassigned?paginated=true&page=${unassignedPage}&page_size=40`),
        api.get('filters'),
        api.get('employees?status=Active&lightweight=true')
      ]);
      setUnassignedAssets(unassignedData.items || []);
      setUnassignedTotal(unassignedData.total || 0);
      setUnassignedPages(unassignedData.total_pages || 1);
      setFilterOptions(opts);
      setEmployees(emps);
    } catch (err) { toast.error('Failed to load data'); }
  };

  const loadAssignments = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ active_only: 'true', paginated: 'true', page: String(currentPage), page_size: '40' });
      Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
      const result = await api.get(`assignments?${params.toString()}`);
      setAssignments(result.items || []);
      setTotalAssignments(result.total || 0);
      setTotalPages(result.total_pages || 1);
    } catch (err) { toast.error('Failed to load assignments'); }
    finally { setLoading(false); }
  };

  const handleQuickAssign = async () => {
    try {
      await api.post('assignments', { asset_id: selectedAsset.id, employee_id: assignTo, assignment_type: 'Normal' });
      toast.success('Asset assigned');
      setQuickAssignOpen(false);
      loadAssignments();
      loadReferenceData();
    } catch (err) { toast.error(err.message); }
  };

  const employeeOptions = [{ id: 'company', name: 'Company' }, ...employees.map(e => ({ id: e.id, name: `${e.name} (${e.employee_id})` }))];

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-white mb-6">Assignments</h1>

      <Tabs defaultValue="active">
        <TabsList><TabsTrigger value="active">Active Assignments</TabsTrigger><TabsTrigger value="unassigned">Unassigned Assets ({unassignedAssets.length})</TabsTrigger></TabsList>
        
        <TabsContent value="active">
          <FilterBar filters={filters} filterOptions={filterOptions} onFilterChange={(k, v) => { setFilters({...filters, [k]: v}); setCurrentPage(1); }} onClear={() => { setFilters({}); setCurrentPage(1); }} />
          <Card>
            <Table>
              <TableHeader><TableRow><TableHead>Asset</TableHead><TableHead>Category</TableHead><TableHead>Assigned To</TableHead><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Project</TableHead></TableRow></TableHeader>
              <TableBody>
                {assignments.map(a => (
                  <TableRow key={a.id} className="cursor-pointer" onClick={() => onViewAsset(a.asset_id)}>
                    <TableCell className="font-medium">{a.asset_tag}</TableCell>
                    <TableCell>{a.asset_category || '-'}</TableCell>
                    <TableCell>{a.employee_name}</TableCell>
                    <TableCell>{a.assigned_date}</TableCell>
                    <TableCell><Badge variant="outline">{a.assignment_type}</Badge></TableCell>
                    <TableCell>{a.project_name}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <div className="flex items-center justify-between mt-4">
            <p className="text-sm" style={{color:'rgba(234,229,236,0.55)'}}>{totalAssignments === 0 ? 'No assignments' : `Showing ${(currentPage - 1) * 40 + 1}-${Math.min(currentPage * 40, totalAssignments)} of ${totalAssignments}`}</p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={currentPage <= 1 || loading} onClick={() => setCurrentPage(page => Math.max(1, page - 1))}><ChevronLeft className="h-4 w-4 mr-1" />Previous</Button>
              <span className="text-sm px-2">Page {currentPage} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={currentPage >= totalPages || loading} onClick={() => setCurrentPage(page => Math.min(totalPages, page + 1))}>Next<ChevronRight className="h-4 w-4 ml-1" /></Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="unassigned">
          <Card>
            <Table>
              <TableHeader><TableRow><TableHead>Asset Tag</TableHead><TableHead>Category</TableHead><TableHead>Brand</TableHead><TableHead>Location</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {unassignedAssets.map(a => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.asset_tag}</TableCell>
                    <TableCell>{a.category_name || a.category || '-'}</TableCell>
                    <TableCell>{a.brand}</TableCell>
                    <TableCell>{a.location_name}</TableCell>
                    <TableCell>
                      {canAssign && <Button size="sm" onClick={() => { setSelectedAsset(a); setAssignTo(''); setQuickAssignOpen(true); }}>Quick Assign</Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <div className="flex items-center justify-between mt-4"><p className="text-sm" style={{color:'rgba(234,229,236,0.55)'}}>{unassignedTotal===0?'No unassigned assets':`Showing ${(unassignedPage-1)*40+1}-${Math.min(unassignedPage*40,unassignedTotal)} of ${unassignedTotal}`}</p><div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={unassignedPage<=1} onClick={()=>setUnassignedPage(page=>Math.max(1,page-1))}><ChevronLeft className="h-4 w-4 mr-1"/>Previous</Button><span className="text-sm px-2">Page {unassignedPage} of {unassignedPages}</span><Button variant="outline" size="sm" disabled={unassignedPage>=unassignedPages} onClick={()=>setUnassignedPage(page=>Math.min(unassignedPages,page+1))}>Next<ChevronRight className="h-4 w-4 ml-1"/></Button></div></div>
        </TabsContent>
      </Tabs>

      <Dialog open={quickAssignOpen} onOpenChange={setQuickAssignOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Quick Assign: {selectedAsset?.asset_tag}</DialogTitle></DialogHeader>
          <div><Label>Assign To</Label>
            <SearchableSelect options={employeeOptions} value={assignTo} onChange={setAssignTo} placeholder="Select employee..." />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuickAssignOpen(false)}>Cancel</Button>
            <Button onClick={handleQuickAssign} className="bg-[#0d9488]" disabled={!assignTo}>Assign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Helper: map internal category_type to display label
function catTypeLabel(t) {
  if (t === 'SUBSCRIPTION') return 'Subscription / Rent';
  if (t === 'CONSUMABLE') return 'Consumable';
  return 'Physical Asset';
}

// Master Data Page
function MasterDataPage({ user }) {
  const [activeTab, setActiveTab] = useState('companies');
  const [data, setData] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({});
  const [editing, setEditing] = useState(null);
  const [auditSettings, setAuditSettings] = useState({ intervalMonths: 2, advanceDays: 7 });
  const [savingAuditSettings, setSavingAuditSettings] = useState(false);
  const confirm = useConfirm();
  const canManageAuditSettings = user.role === 'super_admin' || (user.roles || []).includes('admin');

  useEffect(() => { loadData(); }, [activeTab]);

  const loadData = async () => {
    try {
      if (activeTab === 'audit-schedule') {
        const d = await api.get('settings/audit-schedule');
        setAuditSettings(d || { intervalMonths: 2, advanceDays: 7 });
        return;
      }
      const d = await api.get(activeTab); setData(d || []);
    }
    catch (err) { toast.error('Failed to load data'); setData([]); }
  };

  const saveAuditSettings = async () => {
    setSavingAuditSettings(true);
    try {
      const saved = await api.put('settings/audit-schedule', auditSettings);
      setAuditSettings(saved);
      toast.success('Audit schedule settings updated');
    } catch (err) { toast.error(err.message); }
    finally { setSavingAuditSettings(false); }
  };

  const openDialog = (item = null) => {
    if (item) {
      setEditing(item);
      setFormData({ ...item });
    } else {
      setEditing(null);
      setFormData(activeTab === 'categories'
        ? { name: '', short_name: '', category_type: 'STORABLE' }
        : activeTab === 'companies' ? { name: '', name_ar: '', code: '', logo: '' } : { name: '', code: '', address: '' });
    }
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!formData.name?.trim()) { toast.error('Name is required'); return; }
    if (activeTab === 'categories' && !formData.category_type) { toast.error('Type is required'); return; }
    try {
      if (editing) { await api.put(`${activeTab}/${editing.id}`, formData); toast.success('Updated'); }
      else { await api.post(activeTab, formData); toast.success('Created'); }
      setDialogOpen(false);
      loadData();
    } catch (err) { toast.error(err.message); }
  };

  const handleDelete = async (id) => {
    const ok = await confirm({ title: 'Delete Item', description: 'This item will be permanently deleted.', confirmLabel: 'Delete' });
    if (!ok) return;
    try { await api.delete(`${activeTab}/${id}`); toast.success('Deleted'); loadData(); }
    catch (err) { toast.error(err.message); }
  };

  const masterTabs = [
    { id: 'companies', label: 'Companies', icon: Building2 },
    { id: 'projects', label: 'Projects', icon: Briefcase },
    { id: 'locations', label: 'Locations', icon: MapPin },
    { id: 'departments', label: 'Departments', icon: Users },
    { id: 'categories', label: 'Categories', icon: FolderOpen },
    { id: 'audit-schedule', label: 'Audit Schedule', icon: Clock },
  ];

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-white mb-6">Master Data</h1>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>{masterTabs.map(t => <TabsTrigger key={t.id} value={t.id}><t.icon className="h-4 w-4 mr-2" />{t.label}</TabsTrigger>)}</TabsList>

        {/* Standard tabs: Companies, Projects, Locations, Departments */}
        {masterTabs.filter(t => !['categories', 'audit-schedule'].includes(t.id)).map(t => (
          <TabsContent key={t.id} value={t.id}>
            <div className="flex justify-end mb-4">
              <Button onClick={() => openDialog()} className="bg-[#0d9488]"><Plus className="h-4 w-4 mr-2" />Add {t.label.slice(0, -1)}</Button>
            </div>
            <Card>
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Code / Address</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(data || []).map(item => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell style={{color:'rgba(234,229,236,0.6)'}}>{item.code || item.address || '-'}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={() => openDialog(item)}><Pencil className="h-4 w-4" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => handleDelete(item.id)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>
        ))}

        {/* Categories tab — separate rendering with Type column */}
        <TabsContent value="categories">
          <div className="flex justify-end mb-4">
            <Button onClick={() => openDialog()} className="bg-[#0d9488]"><Plus className="h-4 w-4 mr-2" />Add Category</Button>
          </div>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category Name</TableHead>
                  <TableHead>Short Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data || []).map(item => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell className="font-mono">{item.short_name || item.code || '-'}</TableCell>
                    <TableCell>
                      <Badge className={
                        item.category_type === 'SUBSCRIPTION'
                          ? 'bg-[rgba(168,85,247,0.15)] text-purple-400 border-0'
                          : item.category_type === 'CONSUMABLE'
                          ? 'bg-[rgba(255,176,32,0.15)] text-[#FFD060] border-0'
                          : 'bg-[rgba(94,234,212,0.15)] text-[#0071E3] border-0'
                      }>
                        {catTypeLabel(item.category_type)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => openDialog(item)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(item.id)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="audit-schedule">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Automatic Audit Schedule</CardTitle>
              <CardDescription>Controls when the next physical asset audit becomes due and how early it appears in the audit queue.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>Audit interval (months)</Label>
                  <Input type="number" min="1" max="24" disabled={!canManageAuditSettings} value={auditSettings.intervalMonths} onChange={e => setAuditSettings({...auditSettings, intervalMonths:Number(e.target.value)})} />
                  <p className="text-xs mt-1" style={{color:'rgba(234,229,236,0.45)'}}>Example: 2 schedules each asset two months after its completed audit.</p>
                </div>
                <div>
                  <Label>Schedule in advance (days)</Label>
                  <Input type="number" min="0" max="90" disabled={!canManageAuditSettings} value={auditSettings.advanceDays} onChange={e => setAuditSettings({...auditSettings, advanceDays:Number(e.target.value)})} />
                  <p className="text-xs mt-1" style={{color:'rgba(234,229,236,0.45)'}}>The audit record appears this many days before its due date.</p>
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={saveAuditSettings} disabled={savingAuditSettings || !canManageAuditSettings} className="bg-[#0d9488]">{savingAuditSettings ? 'Saving…' : 'Save Audit Schedule'}</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialog — handles all tabs; categories gets radio type selector */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit' : 'Add'} {activeTab === 'categories' ? 'Category' : activeTab.slice(0, -1)}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div><Label>Name *</Label><Input value={formData.name || ''} onChange={(e) => setFormData({...formData, name: e.target.value})} /></div>
            {activeTab === 'companies' && <>
              <div><Label>Arabic Company Name</Label><Input dir="rtl" value={formData.name_ar || ''} onChange={(e) => setFormData({...formData, name_ar: e.target.value})} /></div>
              <div><Label>Company Logo</Label><Input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { const file=e.target.files?.[0]; if (!file) return; if (file.size > 1024*1024) return toast.error('Logo must be smaller than 1 MB'); const reader=new FileReader(); reader.onload=()=>setFormData({...formData,logo:reader.result}); reader.readAsDataURL(file); }} />{formData.logo && <img src={formData.logo} alt="Company logo" className="mt-2 h-16 max-w-48 object-contain" />}</div>
            </>}
            {activeTab === 'categories' ? (
              <div className="space-y-4">
                <div><Label>Short Name</Label><Input maxLength={8} value={formData.short_name || ''} onChange={(e) => setFormData({...formData, short_name: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')})} placeholder="e.g. LAP" /><p className="text-xs mt-1" style={{color:'rgba(234,229,236,0.45)'}}>Used for automatic asset tags, such as LAP-000001.</p></div>
                <div>
                <Label className="block mb-2">Type *</Label>
                <RadioGroup value={formData.category_type || 'STORABLE'} onValueChange={v => setFormData({...formData, category_type: v})} className="space-y-2">
                  <div className="flex items-center space-x-3 p-3 rounded-lg transition-colors" style={{border:'1px solid rgba(255,255,255,0.08)'}}>
                    <RadioGroupItem value="STORABLE" id="type-storable" />
                    <div>
                      <Label htmlFor="type-storable" className="font-medium cursor-pointer text-white">Physical Asset</Label>
                      <p className="text-xs" style={{color:'rgba(234,229,236,0.6)'}}>Laptops, monitors, servers, peripherals</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3 p-3 rounded-lg transition-colors" style={{border:'1px solid rgba(255,255,255,0.08)'}}>
                    <RadioGroupItem value="SUBSCRIPTION" id="type-subscription" />
                    <div>
                      <Label htmlFor="type-subscription" className="font-medium cursor-pointer text-white">Subscription / Rent</Label>
                      <p className="text-xs" style={{color:'rgba(234,229,236,0.6)'}}>Cloud services, VPNs, software licenses</p>
                    </div>
                  </div>
                </RadioGroup>
                </div>
              </div>
            ) : activeTab === 'locations' ? (
              <div><Label>Address</Label><Input value={formData.address || ''} onChange={(e) => setFormData({...formData, address: e.target.value})} /></div>
            ) : (
              <div><Label>Code</Label><Input value={formData.code || ''} onChange={(e) => setFormData({...formData, code: e.target.value})} /></div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} className="bg-[#0d9488]">{editing ? 'Update' : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Maintenance Page
function MaintenancePage({ user }) {
  const [records, setRecords] = useState([]);
  const [assets, setAssets] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [reassignDialogOpen, setReassignDialogOpen] = useState(false);
  const [formData, setFormData] = useState({});
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [reassignAction, setReassignAction] = useState('return_to_stock');
  const [reassignEmployeeId, setReassignEmployeeId] = useState('');
  const [employees, setEmployees] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [referencesLoading, setReferencesLoading] = useState(true);
  const [recordsLoading, setRecordsLoading] = useState(true);

  const canCreate = ['super_admin', 'it_admin', 'it_technician'].includes(user.role);

  const currencies = ['SAR', 'USD', 'GBP', 'EUR', 'AED', 'QAR', 'KWD', 'BHD', 'OMR', 'INR', 'PKR', 'BDT'];
  const locations = ['Under Warranty', 'Repair Shop', 'In-Office Warehouse'];

  useEffect(() => { loadReferences(); }, []);
  useEffect(() => { loadRecords(); }, [currentPage]);

  const loadReferences = async () => {
    setReferencesLoading(true);
    try {
      const [ass, emps] = await Promise.all([
        api.get('assets?lightweight=true'),
        api.get('employees?status=Active&lightweight=true')
      ]);
      setAssets(ass);
      setEmployees(emps);
    } catch (err) { toast.error('Failed to load data'); }
    finally { setReferencesLoading(false); }
  };

  const loadRecords = async () => {
    setRecordsLoading(true);
    try {
      const result = await api.get(`maintenance?paginated=true&page=${currentPage}&page_size=40`);
      setRecords(result.items || []); setTotalRecords(result.total || 0); setTotalPages(result.total_pages || 1);
    } catch (err) { toast.error('Failed to load maintenance records'); }
    finally { setRecordsLoading(false); }
  };

  const openDialog = () => {
    setFormData({ 
      asset_id: '', 
      description: '', 
      date: new Date().toISOString().split('T')[0],
      work_performed: '',
      maintenance_cost: '',
      technician_cost: '',
      currency: 'USD',
      maintenance_location: 'Repair Shop'
    });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    try {
      await api.post('maintenance', formData);
      toast.success('Maintenance record created - Asset removed from custody');
      setDialogOpen(false);
      loadRecords(); loadReferences();
    } catch (err) { toast.error(err.message); }
  };

  const openCompleteDialog = (record) => {
    setSelectedRecord(record);
    setFormData({
      work_performed: record.work_performed || '',
      maintenance_cost: record.maintenance_cost || '',
      technician_cost: record.technician_cost || '',
      currency: record.currency || 'USD'
    });
    setCompleteDialogOpen(true);
  };

  const handleComplete = async () => {
    try {
      await api.post('maintenance/complete', {
        maintenance_id: selectedRecord.id,
        work_performed: formData.work_performed,
        maintenance_cost: formData.maintenance_cost,
        technician_cost: formData.technician_cost,
        currency: formData.currency
      });
      toast.success('Maintenance completed - Ready for reassignment');
      setCompleteDialogOpen(false);
      loadRecords(); loadReferences();
    } catch (err) { toast.error(err.message); }
  };

  const openReassignDialog = (record) => {
    const asset = assets.find(a => a.id === record.asset_id);
    setSelectedAsset(asset);
    setSelectedRecord(record);
    setReassignAction('return_to_stock');
    setReassignEmployeeId('');
    setReassignDialogOpen(true);
  };

  const handleReassign = async () => {
    try {
      await api.post('maintenance/reassign', {
        asset_id: selectedRecord.asset_id,
        action: reassignAction,
        employee_id: reassignEmployeeId
      });
      toast.success(reassignAction === 'return_to_stock' ? 'Asset returned to stock' : 'Asset assigned to employee');
      setReassignDialogOpen(false);
      loadRecords(); loadReferences();
    } catch (err) { toast.error(err.message); }
  };

  const handleScrap = async (record) => {
    const asset = assets.find(a => a.id === record.asset_id);
    const reason = prompt('Reason for scrapping from maintenance?');
    if (!reason) return;
    
    try {
      await api.post('maintenance/scrap', {
        asset_id: record.asset_id,
        maintenance_id: record.id,
        reason
      });
      toast.success(`Asset ${asset?.category_type === 'SUBSCRIPTION' ? 'canceled' : 'scrapped'} and archived`);
      loadRecords(); loadReferences();
    } catch (err) { toast.error(err.message); }
  };

  const getStatusBadge = (status) => {
    if (status === 'completed') return <Badge className="bg-green-100 text-green-800">Completed</Badge>;
    if (status === 'scrapped') return <Badge className="bg-red-100 text-red-800">Scrapped</Badge>;
    return <Badge className="bg-yellow-100 text-yellow-800">In Progress</Badge>;
  };

  const assetOptions = assets.filter(a => !['Scrapped', 'Canceled'].includes(a.status)).map(a => ({ 
    id: a.id, 
    name: `${a.asset_tag} - ${a.category_name || a.category}` 
  }));

  const employeeOptions = employees.map(e => ({ id: e.id, name: e.name }));

  if (referencesLoading || recordsLoading) return <div className="p-8"><ITdockPageLoader label="Loading maintenance" /></div>;

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-white">Maintenance Records</h1>
        {canCreate && <Button onClick={openDialog} className="bg-[#0d9488] hover:bg-[#0062CC]"><Plus className="h-4 w-4 mr-2" />Add Record</Button>}
      </div>
      
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Asset</TableHead>
              <TableHead>Serial Number</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Cost</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>By</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="text-center text-[#AEAEB2]">No maintenance records</TableCell></TableRow>
            ) : (
              records.map(r => {
                const asset = assets.find(a => a.id === r.asset_id);
                const totalCost = (parseFloat(r.maintenance_cost) || 0) + (parseFloat(r.technician_cost) || 0);
                return (
                  <TableRow key={r.id}>
                    <TableCell>{r.date}</TableCell>
                    <TableCell className="font-medium">{asset?.asset_tag || r.asset_id}</TableCell>
                    <TableCell className="text-sm text-[#6E6E73]">{asset?.serial_number || '-'}</TableCell>
                    <TableCell>
                      <div>{r.description}</div>
                      {r.work_performed && <div className="text-xs text-[#6E6E73] mt-1">Work: {r.work_performed}</div>}
                    </TableCell>
                    <TableCell><Badge variant="outline">{r.maintenance_location || 'N/A'}</Badge></TableCell>
                    <TableCell>
                      {totalCost > 0 ? (
                        <span className="font-medium">{totalCost.toFixed(2)} {r.currency || 'USD'}</span>
                      ) : (
                        <span className="text-[#AEAEB2]">-</span>
                      )}
                    </TableCell>
                    <TableCell>{getStatusBadge(r.status)}</TableCell>
                    <TableCell>{r.performed_by}</TableCell>
                    <TableCell>
                      <div className="flex space-x-1">
                        {r.status === 'in_progress' && (
                          <>
                            <Button size="sm" onClick={() => openCompleteDialog(r)} className="bg-green-600 hover:bg-green-700 text-white">
                              <Check className="h-3 w-3 mr-1" />Complete
                            </Button>
                            <Button size="sm" onClick={() => handleScrap(r)} className="bg-red-600 hover:bg-red-700 text-white">
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </>
                        )}
                        {r.status === 'completed' && asset?.status === 'In Maintenance' && (
                          <Button size="sm" onClick={() => openReassignDialog(r)} className="bg-[#0d9488] hover:bg-[#0062CC] text-white">
                            Reassign
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      <div className="flex items-center justify-between mt-4">
        <p className="text-sm" style={{color:'rgba(234,229,236,0.55)'}}>{totalRecords === 0 ? 'No maintenance records' : `Showing ${(currentPage - 1) * 40 + 1}-${Math.min(currentPage * 40, totalRecords)} of ${totalRecords}`}</p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setCurrentPage(page => Math.max(1, page - 1))}><ChevronLeft className="h-4 w-4 mr-1" />Previous</Button>
          <span className="text-sm px-2">Page {currentPage} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(page => Math.min(totalPages, page + 1))}>Next<ChevronRight className="h-4 w-4 ml-1" /></Button>
        </div>
      </div>

      {/* Create Maintenance Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add Maintenance Record</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>Asset *</Label>
              <SearchableSelect 
                options={assetOptions} 
                value={formData.asset_id} 
                onChange={(v) => setFormData({...formData, asset_id: v})} 
                placeholder="Select asset..." 
              />
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" value={formData.date || ''} onChange={(e) => setFormData({...formData, date: e.target.value})} />
            </div>
            <div>
              <Label>Maintenance Location *</Label>
              <Select value={formData.maintenance_location} onValueChange={(v) => setFormData({...formData, maintenance_location: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {locations.map(loc => <SelectItem key={loc} value={loc}>{loc}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label>Description *</Label>
              <Textarea value={formData.description || ''} onChange={(e) => setFormData({...formData, description: e.target.value})} rows={2} />
            </div>
            <div className="col-span-2">
              <Label>Work Performed</Label>
              <Textarea value={formData.work_performed || ''} onChange={(e) => setFormData({...formData, work_performed: e.target.value})} rows={2} placeholder="Details of work done..." />
            </div>
            <div>
              <Label>Maintenance Cost</Label>
              <Input 
                type="number" 
                step="0.01" 
                value={formData.maintenance_cost} 
                onChange={(e) => setFormData({...formData, maintenance_cost: e.target.value})} 
                placeholder="0.00"
              />
            </div>
            <div>
              <Label>Technician Cost</Label>
              <Input 
                type="number" 
                step="0.01" 
                value={formData.technician_cost} 
                onChange={(e) => setFormData({...formData, technician_cost: e.target.value})} 
                placeholder="0.00"
              />
            </div>
            <div className="col-span-2">
              <Label>Currency</Label>
              <Select value={formData.currency} onValueChange={(v) => setFormData({...formData, currency: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {currencies.map(cur => <SelectItem key={cur} value={cur}>{cur}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} className="bg-[#0d9488] hover:bg-[#0062CC]" disabled={!formData.asset_id || !formData.description}>
              Create Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Complete Maintenance Dialog */}
      <Dialog open={completeDialogOpen} onOpenChange={setCompleteDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Complete Maintenance</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Work Performed *</Label>
              <Textarea value={formData.work_performed || ''} onChange={(e) => setFormData({...formData, work_performed: e.target.value})} rows={3} placeholder="Describe what was done..." />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Maintenance Cost</Label>
                <Input 
                  type="number" 
                  step="0.01" 
                  value={formData.maintenance_cost} 
                  onChange={(e) => setFormData({...formData, maintenance_cost: e.target.value})} 
                  placeholder="0.00"
                />
              </div>
              <div>
                <Label>Technician Cost</Label>
                <Input 
                  type="number" 
                  step="0.01" 
                  value={formData.technician_cost} 
                  onChange={(e) => setFormData({...formData, technician_cost: e.target.value})} 
                  placeholder="0.00"
                />
              </div>
            </div>
            <div>
              <Label>Currency</Label>
              <Select value={formData.currency} onValueChange={(v) => setFormData({...formData, currency: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {currencies.map(cur => <SelectItem key={cur} value={cur}>{cur}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Alert>
              <AlertDescription>
                After completing, the asset will remain "In Maintenance" until you reassign it.
              </AlertDescription>
            </Alert>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleComplete} className="bg-green-600 hover:bg-green-700 text-white" disabled={!formData.work_performed}>
              <Check className="h-4 w-4 mr-2" />Complete Maintenance
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reassign Dialog */}
      <Dialog open={reassignDialogOpen} onOpenChange={setReassignDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reassign Asset After Maintenance</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Alert>
              <AlertDescription>
                Asset: <strong>{selectedAsset?.asset_tag}</strong> - Maintenance completed
              </AlertDescription>
            </Alert>
            <RadioGroup value={reassignAction} onValueChange={setReassignAction}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="return_to_stock" id="stock" />
                <Label htmlFor="stock">Return to Stock</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="assign_to_employee" id="assign" />
                <Label htmlFor="assign">Assign to Employee</Label>
              </div>
            </RadioGroup>
            {reassignAction === 'assign_to_employee' && (
              <div>
                <Label>Select Employee *</Label>
                <SearchableSelect 
                  options={employeeOptions} 
                  value={reassignEmployeeId} 
                  onChange={setReassignEmployeeId} 
                  placeholder="Choose employee..." 
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReassignDialogOpen(false)}>Cancel</Button>
            <Button 
              onClick={handleReassign} 
              className="bg-[#0d9488] hover:bg-[#0062CC]"
              disabled={reassignAction === 'assign_to_employee' && !reassignEmployeeId}
            >
              Reassign Asset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Company Emails — employee-backed email directory
function CompanyEmailsPage({ user }) {
  const [entries, setEntries] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [filterOptions, setFilterOptions] = useState({});
  const [filters, setFilters] = useState({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ employee_id:'', email:'' });
  const [saving, setSaving] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalEntries, setTotalEntries] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const confirm = useConfirm();
  const canEdit = ['super_admin', 'it_admin'].includes(user.role);

  useEffect(() => { loadReferences(); }, []);
  useEffect(() => { const timer = setTimeout(() => setDebouncedSearch(search), 300); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { loadEntries(); }, [filters, debouncedSearch, currentPage]);

  const loadReferences = async () => {
    try {
      const [employeeData, options] = await Promise.all([api.get('employees?status=Active&lightweight=true'), api.get('filters')]);
      setEmployees(employeeData || []);
      setFilterOptions(options || {});
    } catch (err) { toast.error('Failed to load email reference data'); }
  };

  const loadEntries = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ paginated:'true', page:String(currentPage), page_size:'40' });
      Object.entries(filters).forEach(([key,value]) => { if (value) params.set(key,value); });
      if (debouncedSearch) params.set('search', debouncedSearch);
      const result = await api.get(`company-emails?${params.toString()}`);
      setEntries(result.items || []); setTotalEntries(result.total || 0); setTotalPages(result.total_pages || 1);
    } catch (err) { toast.error('Failed to load company emails'); }
    finally { setLoading(false); }
  };

  const openAdd = () => { setEditing(null); setForm({employee_id:'',email:''}); setDialogOpen(true); };
  const openEdit = (entry) => { setEditing(entry); setForm({employee_id:entry.employee_id,email:entry.email}); setDialogOpen(true); };

  const save = async () => {
    if (!form.employee_id || !form.email?.trim()) return toast.error('Employee and email are required');
    setSaving(true);
    try {
      if (editing) await api.put(`company-emails/${editing.employee_id}`, {email:form.email});
      else await api.post('company-emails', form);
      toast.success(editing ? 'Company email updated' : 'Company email assigned');
      setDialogOpen(false);
      loadEntries(); loadReferences();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const remove = async (entry) => {
    const ok = await confirm({title:'Remove Company Email',description:`Remove ${entry.email} from ${entry.fullName}?`,confirmLabel:'Remove'});
    if (!ok) return;
    try { await api.delete(`company-emails/${entry.employee_id}`); toast.success('Company email removed'); loadEntries(); loadReferences(); }
    catch (err) { toast.error(err.message); }
  };

  const availableEmployees = employees.filter(employee => !employee.company_email || employee.id === form.employee_id);
  const filtered = entries.filter(entry => {
    if (filters.company_id && entry.company_id !== filters.company_id) return false;
    if (filters.project_id && entry.project_id !== filters.project_id) return false;
    if (filters.department_id && entry.department_id !== filters.department_id) return false;
    if (filters.location_id && entry.location_id !== filters.location_id) return false;
    if (search) {
      const query = search.toLowerCase();
      if (!entry.email?.toLowerCase().includes(query) && !entry.fullName?.toLowerCase().includes(query)) return false;
    }
    return true;
  });

  if (loading) return <div className="p-8"><ITdockPageLoader label="Loading company emails" /></div>;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-2xl font-bold" style={{color:'#eae5ec'}}>Company Emails</h1><p className="text-sm mt-0.5" style={{color:'rgba(234,229,236,0.5)'}}>Employee company email directory</p></div>
        {canEdit && <Button onClick={openAdd} className="bg-[#0d9488]"><Plus className="h-4 w-4 mr-2" />Add Company Email</Button>}
      </div>
      <div className="relative mb-4"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{color:'rgba(234,229,236,0.4)'}} /><Input value={search} onChange={e=>{setSearch(e.target.value);setCurrentPage(1)}} placeholder="Search email or employee..." className="pl-9 max-w-md" /></div>
      <FilterBar filters={filters} filterOptions={filterOptions} onFilterChange={(key,value)=>{setFilters({...filters,[key]:value});setCurrentPage(1)}} onClear={()=>{setFilters({});setCurrentPage(1)}} />
      <Card><Table>
        <TableHeader><TableRow><TableHead>Work Email</TableHead><TableHead>Full Name</TableHead><TableHead>Company</TableHead><TableHead>Project</TableHead><TableHead>Department</TableHead><TableHead>Location</TableHead>{canEdit&&<TableHead>Actions</TableHead>}</TableRow></TableHeader>
        <TableBody>{filtered.length===0 ? <TableRow><TableCell colSpan={canEdit?7:6} className="text-center py-10" style={{color:'rgba(234,229,236,0.4)'}}>No company emails found</TableCell></TableRow> : filtered.map(entry=><TableRow key={entry.employee_id}>
          <TableCell><a href={`mailto:${entry.email}`} style={{color:'#5eead4'}}>{entry.email}</a></TableCell><TableCell className="font-medium">{entry.fullName}</TableCell><TableCell>{entry.company||'—'}</TableCell><TableCell>{entry.project||'—'}</TableCell><TableCell>{entry.department||'—'}</TableCell><TableCell>{entry.location||'—'}</TableCell>
          {canEdit&&<TableCell><Button size="sm" variant="ghost" onClick={()=>openEdit(entry)}><Pencil className="h-4 w-4" /></Button><Button size="sm" variant="ghost" onClick={()=>remove(entry)}><Trash2 className="h-4 w-4 text-red-500" /></Button></TableCell>}
        </TableRow>)}</TableBody>
      </Table></Card>
      <div className="flex items-center justify-between mt-4"><p className="text-sm" style={{color:'rgba(234,229,236,0.55)'}}>{totalEntries===0?'No company emails':`Showing ${(currentPage-1)*40+1}-${Math.min(currentPage*40,totalEntries)} of ${totalEntries}`}</p><div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={currentPage<=1} onClick={()=>setCurrentPage(page=>Math.max(1,page-1))}><ChevronLeft className="h-4 w-4 mr-1"/>Previous</Button><span className="text-sm px-2">Page {currentPage} of {totalPages}</span><Button variant="outline" size="sm" disabled={currentPage>=totalPages} onClick={()=>setCurrentPage(page=>Math.min(totalPages,page+1))}>Next<ChevronRight className="h-4 w-4 ml-1"/></Button></div></div>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>{editing?'Edit':'Add'} Company Email</DialogTitle><DialogDescription>Profile details are inherited from the selected employee.</DialogDescription></DialogHeader><div className="space-y-4">
        <div><Label>Employee *</Label><SearchableSelect options={availableEmployees.map(e=>({id:e.id,name:`${e.name} (${e.employee_id})`}))} value={form.employee_id} onChange={value=>setForm({...form,employee_id:value})} placeholder="Select employee..." disabled={!!editing} /></div>
        <div><Label>Work Email *</Label><Input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder="name@company.com" /><p className="text-xs mt-1.5" style={{color:'rgba(234,229,236,0.4)'}}>Only use an email address provided by the employee’s company.</p></div>
      </div><DialogFooter><Button variant="outline" onClick={()=>setDialogOpen(false)}>Cancel</Button><Button onClick={save} disabled={saving} className="bg-[#0d9488]">{saving?'Saving…':editing?'Save Changes':'Assign Email'}</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}

// Extensions Page — telephone extension directory
function ExtensionsPage({ user }) {
  const [extensions, setExtensions] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [locations, setLocations] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [telephoneAssets, setTelephoneAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCompany, setFilterCompany] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [filterLoc, setFilterLoc] = useState('');
  const [filterPerm, setFilterPerm] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [extensionsLoading, setExtensionsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalExtensions, setTotalExtensions] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const canEdit = ['super_admin', 'it_admin'].includes(user.role);
  const confirm = useConfirm();

  useEffect(() => { loadReferenceData(); }, []);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => { loadExtensions(); }, [currentPage, debouncedSearch, filterCompany, filterDept, filterLoc, filterPerm]);

  const loadReferenceData = async () => {
    setLoading(true);
    try {
      const [depts, locs, companiesData, emps, assets] = await Promise.all([
        api.get('departments').catch(() => []),
        api.get('locations').catch(() => []),
        api.get('companies').catch(() => []),
        api.get('employees?lightweight=true').catch(() => []),
        api.get('assets?category_name=IT%20Telephone&lightweight=true').catch(() => []),
      ]);
      setDepartments(Array.isArray(depts) ? depts : []);
      setLocations(Array.isArray(locs) ? locs : []);
      setCompanies(Array.isArray(companiesData) ? companiesData : []);
      setEmployees(Array.isArray(emps) ? emps.filter(e => e.status === 'Active') : []);
      setTelephoneAssets(Array.isArray(assets) ? assets : []);
    } catch (err) {
      console.error('Extensions load error:', err);
      toast.error('Failed to load extensions');
    } finally {
      setLoading(false);
    }
  };

  const loadExtensions = async () => {
    setExtensionsLoading(true);
    try {
      const params = new URLSearchParams({ paginated: 'true', page: String(currentPage), page_size: '40' });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (filterCompany) params.set('company_id', filterCompany);
      if (filterDept) params.set('dept', filterDept);
      if (filterLoc) params.set('location', filterLoc);
      if (filterPerm) params.set('permission', filterPerm);
      const result = await api.get(`extensions?${params.toString()}`);
      setExtensions(result.items || []);
      setTotalExtensions(result.total || 0);
      setTotalPages(result.total_pages || 1);
    } catch (err) {
      toast.error('Failed to load extensions');
    } finally {
      setExtensionsLoading(false);
    }
  };

  const openAdd = () => {
    setEditingId(null);
    setForm({ isActive: true, permission: 'internal', phoneType: 'none', phoneAssetId: null });
    setDialogOpen(true);
  };

  const openEdit = (ext) => {
    setEditingId(ext.id);
    setForm({ ...ext });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.extensionNumber?.trim()) return toast.error('Extension number is required');
    if (!form.assignedTo) return toast.error('Assign an employee to this extension');
    if (!form.permission) return toast.error('Permission level is required');
    if (form.phoneType === 'physical' && !form.phoneAssetId) return toast.error('Select an available IT Telephone asset');
    setSaving(true);
    try {
      const assignedEmployee = employees.find(e => e.id === form.assignedTo);
      const payload = {
        ...form,
        name: assignedEmployee?.name || form.name || form.extensionNumber.trim()
      };
      if (editingId) {
        await api.put(`extensions/${editingId}`, payload);
        toast.success('Extension updated');
      } else {
        await api.post('extensions', payload);
        toast.success('Extension added');
      }
      setDialogOpen(false);
      loadExtensions();
    } catch (err) { toast.error(err.message); }
    setSaving(false);
  };

  const handleDelete = async (ext) => {
    const warn = ext.assignedTo ? 'This extension is assigned to an employee. ' : '';
    const ok = await confirm({ title: 'Delete Extension', description: `${warn}Delete extension ${ext.extensionNumber}?`, confirmLabel: 'Delete' });
    if (!ok) return;
    try {
      await api.delete(`extensions/${ext.id}`);
      toast.success('Extension deleted');
      loadExtensions();
    } catch (err) { toast.error(err.message); }
  };

  const handleToggleActive = async (ext) => {
    try {
      await api.put(`extensions/${ext.id}`, { ...ext, isActive: !ext.isActive });
      loadExtensions();
    } catch (err) { toast.error(err.message); }
  };

  const getDeptName = (id) => departments.find(d => d.id === id)?.name || '—';
  const getLocName = (id) => locations.find(l => l.id === id)?.name || '—';
  const getEmpName = (id) => employees.find(e => e.id === id)?.name || null;
  const getPhoneAsset = (id) => telephoneAssets.find(a => a.id === id);

  const permBadge = (p) => {
    if (p === 'internal') return { label: 'Internal', style: { background: 'rgba(142,142,147,0.2)', color: '#8E8E93' } };
    if (p === 'local') return { label: 'Local', style: { background: 'rgba(10,132,255,0.15)', color: '#0A84FF' } };
    if (p === 'international') return { label: 'International', style: { background: 'rgba(52,199,89,0.15)', color: '#34C759' } };
    return { label: p, style: {} };
  };

  const filtered = (extensions || []).filter(e => {
    const assignedEmployee = employees.find(emp => emp.id === e.assignedTo);
    if (filterCompany && assignedEmployee?.company_id !== filterCompany) return false;
    if (filterDept && e.departmentId !== filterDept) return false;
    if (filterLoc && e.locationId !== filterLoc) return false;
    if (filterPerm && e.permission !== filterPerm) return false;
    if (search) {
      const q = search.toLowerCase();
      const employeeName = e.assignedTo ? getEmpName(e.assignedTo) : '';
      if (!e.extensionNumber?.toLowerCase().includes(q) && !e.name?.toLowerCase().includes(q) && !employeeName?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  if (loading || extensionsLoading) return <div className="p-8"><ITdockPageLoader label="Loading extensions" /></div>;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{color:'#eae5ec'}}>Extension Directory</h1>
          <p className="text-sm mt-0.5" style={{color:'rgba(234,229,236,0.5)'}}>Internal telephone extensions</p>
        </div>
        {canEdit && (
          <Button onClick={openAdd} className="bg-[#0d9488] hover:bg-[#0b8070] text-white">
            <Plus className="h-4 w-4 mr-2" />Add Extension
          </Button>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{color:'rgba(234,229,236,0.4)'}} />
          <Input placeholder="Search extension or employee..." value={search} onChange={e => { setSearch(e.target.value); setCurrentPage(1); }} className="pl-9" style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.10)', color:'#eae5ec'}} />
        </div>
        <Select value={filterCompany || '__all__'} onValueChange={v => { setFilterCompany(v === '__all__' ? '' : v); setCurrentPage(1); }}>
          <SelectTrigger style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.10)', color:'#eae5ec', width:'170px'}}>
            <SelectValue placeholder="All Companies" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Companies</SelectItem>
            {companies.map(company => <SelectItem key={company.id} value={company.id}>{company.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterDept || '__all__'} onValueChange={v => { setFilterDept(v === '__all__' ? '' : v); setCurrentPage(1); }}>
          <SelectTrigger style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.10)', color:'#eae5ec', width:'160px'}}>
            <SelectValue placeholder="All Departments" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Departments</SelectItem>
            {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterLoc || '__all__'} onValueChange={v => { setFilterLoc(v === '__all__' ? '' : v); setCurrentPage(1); }}>
          <SelectTrigger style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.10)', color:'#eae5ec', width:'150px'}}>
            <SelectValue placeholder="All Locations" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Locations</SelectItem>
            {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterPerm || '__all__'} onValueChange={v => { setFilterPerm(v === '__all__' ? '' : v); setCurrentPage(1); }}>
          <SelectTrigger style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.10)', color:'#eae5ec', width:'160px'}}>
            <SelectValue placeholder="All Permissions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Permissions</SelectItem>
            <SelectItem value="internal">Internal</SelectItem>
            <SelectItem value="local">Local</SelectItem>
            <SelectItem value="international">International</SelectItem>
          </SelectContent>
        </Select>
        {(search || filterCompany || filterDept || filterLoc || filterPerm) && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setFilterCompany(''); setFilterDept(''); setFilterLoc(''); setFilterPerm(''); setCurrentPage(1); }} style={{color:'rgba(234,229,236,0.5)'}}>
            <X className="h-4 w-4 mr-1" />Clear
          </Button>
        )}
      </div>

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ext. No.</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Permission</TableHead>
              <TableHead>Assigned To</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Status</TableHead>
              {canEdit && <TableHead>Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canEdit ? 8 : 7} className="text-center py-12" style={{color:'rgba(234,229,236,0.4)'}}>
                  <Phone className="h-10 w-10 mx-auto mb-2 opacity-20" />
                  <p>No extensions found</p>
                </TableCell>
              </TableRow>
            ) : filtered.map(ext => {
              const badge = permBadge(ext.permission);
              const empName = ext.assignedTo ? getEmpName(ext.assignedTo) : null;
              return (
                <TableRow key={ext.id}>
                  <TableCell>
                    <span className="text-lg font-bold" style={{color:'#eae5ec'}}>{ext.extensionNumber}</span>
                  </TableCell>
                  <TableCell style={{color:'rgba(234,229,236,0.7)'}}>{getDeptName(ext.departmentId)}</TableCell>
                  <TableCell style={{color:'rgba(234,229,236,0.7)'}}>{getLocName(ext.locationId)}</TableCell>
                  <TableCell>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={badge.style}>{badge.label}</span>
                  </TableCell>
                  <TableCell style={{color:'rgba(234,229,236,0.7)'}}>
                    {empName ? <span className="text-sm" style={{color:'#5eead4'}}>{empName}</span> : <span style={{color:'rgba(234,229,236,0.3)'}}>Unassigned</span>}
                  </TableCell>
                  <TableCell style={{color:'rgba(234,229,236,0.7)'}}>
                    {ext.phoneType === 'physical'
                      ? <span className="text-sm">{getPhoneAsset(ext.phoneAssetId)?.asset_tag || ext.phoneAssetTag || 'Physical phone'}</span>
                      : ext.phoneType === 'softphone'
                        ? <span className="text-sm" style={{color:'#5eead4'}}>Softphone</span>
                        : <span style={{color:'rgba(234,229,236,0.3)'}}>None</span>}
                  </TableCell>
                  <TableCell>
                    {canEdit ? (
                      <button onClick={() => handleToggleActive(ext)} className="text-xs font-semibold px-2 py-0.5 rounded-full cursor-pointer transition-all" style={ext.isActive ? {background:'rgba(52,199,89,0.15)', color:'#34C759'} : {background:'rgba(142,142,147,0.15)', color:'#8E8E93'}}>
                        {ext.isActive ? 'Active' : 'Inactive'}
                      </button>
                    ) : (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={ext.isActive ? {background:'rgba(52,199,89,0.15)', color:'#34C759'} : {background:'rgba(142,142,147,0.15)', color:'#8E8E93'}}>
                        {ext.isActive ? 'Active' : 'Inactive'}
                      </span>
                    )}
                  </TableCell>
                  {canEdit && (
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(ext)} style={{color:'rgba(234,229,236,0.5)'}}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleDelete(ext)} style={{color:'#FF3B30'}}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <div className="flex items-center justify-between mt-4">
        <p className="text-sm" style={{color:'rgba(234,229,236,0.55)'}}>{totalExtensions === 0 ? 'No extensions' : `Showing ${(currentPage - 1) * 40 + 1}-${Math.min(currentPage * 40, totalExtensions)} of ${totalExtensions}`}</p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setCurrentPage(page => Math.max(1, page - 1))}><ChevronLeft className="h-4 w-4 mr-1" />Previous</Button>
          <span className="text-sm px-2">Page {currentPage} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(page => Math.min(totalPages, page + 1))}>Next<ChevronRight className="h-4 w-4 ml-1" /></Button>
        </div>
      </div>

      {/* Add / Edit Modal */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg" style={{background:'#050810', border:'1px solid rgba(255,255,255,0.10)', color:'#eae5ec'}}>
          <DialogHeader>
            <DialogTitle style={{color:'#eae5ec'}}>{editingId ? 'Edit Extension' : 'Add Extension'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div>
                <Label className="text-xs mb-1.5 block" style={{color:'rgba(234,229,236,0.7)'}}>Extension Number *</Label>
                <Input placeholder="e.g. 1042" value={form.extensionNumber || ''} onChange={e => setForm({...form, extensionNumber: e.target.value})} style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.12)', color:'#eae5ec'}} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs mb-1.5 block" style={{color:'rgba(234,229,236,0.7)'}}>Department</Label>
                <Select value={form.departmentId || '__none__'} onValueChange={v => setForm({...form, departmentId: v === '__none__' ? null : v})}>
                  <SelectTrigger style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.12)', color:'#eae5ec'}}>
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs mb-1.5 block" style={{color:'rgba(234,229,236,0.7)'}}>Location</Label>
                <Select value={form.locationId || '__none__'} onValueChange={v => setForm({...form, locationId: v === '__none__' ? null : v})}>
                  <SelectTrigger style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.12)', color:'#eae5ec'}}>
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs mb-1.5 block" style={{color:'rgba(234,229,236,0.7)'}}>Permission Level *</Label>
              <Select value={form.permission || 'internal'} onValueChange={v => setForm({...form, permission: v})}>
                <SelectTrigger style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.12)', color:'#eae5ec'}}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="internal">Internal — internal calls only</SelectItem>
                  <SelectItem value="local">Local — internal + local calls</SelectItem>
                  <SelectItem value="international">International — all calls</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1.5 block" style={{color:'rgba(234,229,236,0.7)'}}>Assign to Employee *</Label>
              <SearchableSelect
                options={employees.map(e => ({ id: e.id, name: e.name }))}
                value={form.assignedTo || ''}
                onChange={v => setForm({...form, assignedTo: v || null})}
                placeholder="Search employee..."
              />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block" style={{color:'rgba(234,229,236,0.7)'}}>Phone Type (optional)</Label>
              <Select value={form.phoneType || 'none'} onValueChange={v => setForm({...form, phoneType:v, phoneAssetId:v === 'physical' ? form.phoneAssetId : null})}>
                <SelectTrigger style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.12)', color:'#eae5ec'}}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="softphone">Softphone</SelectItem>
                  <SelectItem value="physical">Physical phone</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.phoneType === 'physical' && (
              <div>
                <Label className="text-xs mb-1.5 block" style={{color:'rgba(234,229,236,0.7)'}}>IT Telephone Asset *</Label>
                <SearchableSelect
                  options={telephoneAssets.filter(a => !a.assigned_to || a.id === form.phoneAssetId).map(a => ({id:a.id, name:`${a.asset_tag}${a.brand ? ` · ${a.brand}` : ''}${a.serial_number ? ` · ${a.serial_number}` : ''}`}))}
                  value={form.phoneAssetId || ''}
                  onChange={v => setForm({...form, phoneAssetId:v || null})}
                  placeholder="Select an unassigned telephone..."
                />
                <p className="text-xs mt-1.5" style={{color:'rgba(234,229,236,0.4)'}}>Only unassigned assets in the exact “IT Telephone” category are shown.</p>
              </div>
            )}
            <div>
              <Label className="text-xs mb-1.5 block" style={{color:'rgba(234,229,236,0.7)'}}>Notes (optional)</Label>
              <Textarea placeholder="Any notes about this extension..." value={form.notes || ''} onChange={e => setForm({...form, notes: e.target.value})} rows={2} style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.12)', color:'#eae5ec', resize:'none'}} />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="ext-active" checked={form.isActive !== false} onCheckedChange={v => setForm({...form, isActive: v})} />
              <Label htmlFor="ext-active" className="text-sm cursor-pointer" style={{color:'rgba(234,229,236,0.8)'}}>Active</Label>
            </div>
          </div>
          <DialogFooter className="mt-2">
            <Button variant="ghost" onClick={() => setDialogOpen(false)} style={{color:'rgba(234,229,236,0.6)'}}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} style={{background:'#0d9488', color:'#fff'}}>
              {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Add Extension'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Scrap Page
function ScrapPage({ user }) {
  const [assets, setAssets] = useState([]);
  const [scrappedOrCanceled, setScrappedOrCanceled] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState('');
  const [selectedAssetData, setSelectedAssetData] = useState(null);
  const [reason, setReason] = useState('');

  const canScrap = ['super_admin', 'it_admin'].includes(user.role);
  const confirm = useConfirm();

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [activeData, archivedData] = await Promise.all([
        api.get('assets?lightweight=true'),
        api.get('assets?archived=true&statuses=Scrapped%2CCanceled')
      ]);
      setAssets((activeData || []).filter(a => !['Scrapped', 'Canceled'].includes(a.status)));
      const allAssetRows = [...(activeData || []), ...(archivedData || [])];
      const seen = new Set();
      setScrappedOrCanceled(allAssetRows.filter(a => {
        if (!['Scrapped', 'Canceled'].includes(a.status) || seen.has(a.id)) return false;
        seen.add(a.id);
        return true;
      }));
    } catch (err) { toast.error('Failed to load assets'); }
  };

  const handleScrap = async () => {
    const asset = assets.find(a => a.id === selectedAsset);
    const isSub = asset?.category_type === 'SUBSCRIPTION';
    const actionText = isSub ? 'cancel this subscription' : 'scrap this asset';
    const ok = await confirm({ title: isSub ? 'Cancel Subscription' : 'Scrap Asset', description: `Are you sure you want to ${actionText}? This cannot be undone.`, confirmLabel: isSub ? 'Cancel Subscription' : 'Scrap Asset' });
    if (!ok) return;
    
    try {
      const response = await api.post('assets/scrap', { asset_id: selectedAsset, reason });
      const action = response.action || 'SCRAPPED';
      toast.success(`Asset ${action.toLowerCase()} successfully`);
      setDialogOpen(false);
      loadData();
    } catch (err) { toast.error(err.message); }
  };

  const handleOpenDialog = (assetId = '') => {
    setSelectedAsset(assetId);
    const asset = assets.find(a => a.id === assetId);
    setSelectedAssetData(asset);
    setReason('');
    setDialogOpen(true);
  };

  const assetOptions = assets.map(a => ({ 
    id: a.id, 
    name: `${a.asset_tag} - ${a.category_name || a.category} (${a.status})` 
  }));
  
  const buttonText = selectedAssetData?.category_type === 'SUBSCRIPTION' ? 'Cancel Subscription' : 'Scrap Asset';
  const dialogTitle = selectedAssetData?.category_type === 'SUBSCRIPTION' ? 'Cancel Subscription' : 'Scrap Asset';

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-white">Scrap / Cancel Management</h1>
        {canScrap && (
          <Button onClick={() => handleOpenDialog()} className="bg-red-600 hover:bg-red-700 text-white">
            <Trash2 className="h-4 w-4 mr-2" />Scrap / Cancel Asset
          </Button>
        )}
      </div>
      <Card>
        <CardHeader><CardTitle>Scrapped / Canceled Assets</CardTitle></CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Asset Tag</TableHead>
              <TableHead>Serial Number</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {scrappedOrCanceled.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-[#AEAEB2]">No scrapped or canceled assets</TableCell></TableRow>
            ) : (
              scrappedOrCanceled.map(a => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.asset_tag}</TableCell>
                  <TableCell className="text-sm text-[#6E6E73]">{a.serial_number || '-'}</TableCell>
                  <TableCell>{a.category_name || a.category}</TableCell>
                  <TableCell>
                    <Badge className={a.status === 'Canceled' ? 'bg-orange-100 text-orange-800' : 'bg-red-100 text-red-800'}>
                      {a.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{a.scrapped_at ? new Date(a.scrapped_at).toLocaleDateString() : '-'}</TableCell>
                  <TableCell>{a.scrap_reason || '-'}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>This action cannot be undone. The asset will be archived.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Asset *</Label>
              <SearchableSelect 
                options={assetOptions} 
                value={selectedAsset} 
                onChange={(v) => {
                  setSelectedAsset(v);
                  const asset = assets.find(a => a.id === v);
                  setSelectedAssetData(asset);
                }} 
                placeholder="Select asset..." 
              />
            </div>
            {selectedAssetData && (
              <Alert>
                <AlertDescription>
                  <strong>Type:</strong> {selectedAssetData.category_type || 'STORABLE'}
                  {selectedAssetData.category_type === 'SUBSCRIPTION' && ' - This will cancel the subscription'}
                </AlertDescription>
              </Alert>
            )}
            <div><Label>Reason</Label><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleScrap} className="bg-red-600 hover:bg-red-700 text-white" disabled={!selectedAsset}>
              {buttonText}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Audits Page — Asset Audit Checklist (rolling, every 2 months)
const CHECKLIST_ITEMS = [
  'Device powers on correctly','Screen / display has no damage','Keyboard and trackpad functional (laptops)',
  'All ports functional (USB, HDMI, etc.)','Battery health acceptable (laptops)','No physical damage or cracks',
  'Asset tag / label present and readable','Operating system up to date','Antivirus / security software active',
  'No unauthorized software installed','Data backup confirmed','Assigned to correct employee',
  'Location matches records','Accessories present (charger, case, etc.)'
];

function AuditsPage({ user }) {
  const [audits, setAudits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [conductOpen, setConductOpen] = useState(false);
  const [selectedAudit, setSelectedAudit] = useState(null);
  const [checklist, setChecklist] = useState([]);
  const [overallNotes, setOverallNotes] = useState('');
  const [followUp, setFollowUp] = useState(false);
  const [followUpNotes, setFollowUpNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [manualDialogOpen, setManualDialogOpen] = useState(false);
  const [manualAssets, setManualAssets] = useState([]);
  const [manualAssetId, setManualAssetId] = useState('');
  const [manualDate, setManualDate] = useState(new Date().toISOString().split('T')[0]);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleAudit, setRescheduleAudit] = useState(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [auditCadence, setAuditCadence] = useState({ intervalMonths: 2, advanceDays: 7 });
  const [currentPage, setCurrentPage] = useState(1);
  const [totalAudits, setTotalAudits] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const normalizedRoles = user.roles || [];
  const canReschedule = user.role === 'super_admin' || normalizedRoles.includes('admin') || normalizedRoles.includes('it_support');

  useEffect(() => { loadData(); }, [filterStatus, currentPage]);

  const loadData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      params.set('paginated','true'); params.set('page',String(currentPage)); params.set('page_size','40');
      const [data, cadence] = await Promise.all([api.get(`audits?${params.toString()}`), api.get('settings/audit-schedule').catch(() => auditCadence)]);
      setAudits(data.items || []); setTotalAudits(data.total || 0); setTotalPages(data.total_pages || 1);
      setAuditCadence(cadence || auditCadence);
    } catch { toast.error('Failed to load audits'); }
    setLoading(false);
  };

  const openConduct = (audit) => {
    setSelectedAudit(audit);
    setChecklist(audit.checklist?.length ? [...audit.checklist] : CHECKLIST_ITEMS.map(item => ({ item, status: 'na', notes: '' })));
    setOverallNotes(audit.overallNotes || '');
    setFollowUp(audit.followUpRequired || false);
    setFollowUpNotes(audit.followUpNotes || '');
    setConductOpen(true);
  };

  const setItemStatus = (idx, status) => {
    setChecklist(prev => prev.map((c, i) => i === idx ? { ...c, status } : c));
  };
  const setItemNotes = (idx, notes) => {
    setChecklist(prev => prev.map((c, i) => i === idx ? { ...c, notes } : c));
  };

  const checkedCount = checklist.filter(c => c.status !== 'na').length;
  const hasFailures = checklist.some(c => c.status === 'fail');
  const allPassOrNA = checklist.every(c => c.status === 'pass' || c.status === 'na');

  const submitAudit = async (result) => {
    if (!selectedAudit) return;
    setSubmitting(true);
    try {
      await api.post(`audits/${selectedAudit.id}/complete`, {
        checklist, overall_notes: overallNotes, follow_up_required: followUp,
        follow_up_notes: followUpNotes, result
      });
      toast.success(`Audit submitted — ${result === 'pass' ? 'QC Pass ✓' : 'Failures logged'}`);
      setConductOpen(false);
      loadData();
    } catch (err) { toast.error(err.message); }
    setSubmitting(false);
  };

  const openManualDialog = async () => {
    try {
      const assets = await api.get('assets?lightweight=true');
      setManualAssets((assets || []).filter(a => !a.archived && a.status !== 'Scrapped'));
    } catch { setManualAssets([]); }
    setManualAssetId('');
    setManualDate(new Date().toISOString().split('T')[0]);
    setManualDialogOpen(true);
  };

  const openReschedule = (audit) => {
    setRescheduleAudit(audit);
    setRescheduleDate(audit.scheduledDate || '');
    setRescheduleOpen(true);
  };

  const saveReschedule = async () => {
    if (!rescheduleAudit || !rescheduleDate) return;
    try {
      await api.put(`audits/${rescheduleAudit.id}`, { scheduledDate: rescheduleDate });
      toast.success('Audit date updated');
      setRescheduleOpen(false);
      loadData();
    } catch (err) { toast.error(err.message); }
  };

  const scheduleManualAudit = async () => {
    if (!manualAssetId) return toast.error('Select an asset');
    try {
      await api.post('audits', { asset_id: manualAssetId, scheduled_date: manualDate });
      toast.success('Audit scheduled');
      setManualDialogOpen(false);
      loadData();
    } catch (err) { toast.error(err.message); }
  };

  const statusBadge = (s) => {
    const map = { scheduled: { bg: 'rgba(59,130,246,0.15)', color: '#60a5fa', label: 'Scheduled' }, completed: { bg: 'rgba(52,199,89,0.15)', color: '#34C759', label: 'Completed' }, overdue: { bg: 'rgba(255,59,48,0.15)', color: '#FF3B30', label: 'Overdue' }, skipped: { bg: 'rgba(174,174,178,0.15)', color: '#AEAEB2', label: 'Skipped' } };
    const c = map[s] || map.scheduled;
    return <span className="text-xs font-bold px-2 py-0.5 rounded" style={{background: c.bg, color: c.color}}>{c.label}</span>;
  };
  const resultBadge = (r) => {
    if (!r) return null;
    const map = { pass: { bg: 'rgba(52,199,89,0.15)', color: '#34C759', label: 'Pass' }, fail: { bg: 'rgba(255,59,48,0.15)', color: '#FF3B30', label: 'Fail' }, partial: { bg: 'rgba(255,149,0,0.15)', color: '#FF9500', label: 'Partial' } };
    const c = map[r] || map.pass;
    return <span className="text-xs font-bold px-2 py-0.5 rounded" style={{background: c.bg, color: c.color}}>{c.label}</span>;
  };

  if (loading) return <div className="p-8"><ITdockPageLoader label="Loading audits" /></div>;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{color:'#eae5ec'}}>Asset Audits</h1>
          <p className="text-sm mt-0.5" style={{color:'rgba(234,229,236,0.5)'}}>Every {auditCadence.intervalMonths} month{auditCadence.intervalMonths === 1 ? '' : 's'} · appears {auditCadence.advanceDays} day{auditCadence.advanceDays === 1 ? '' : 's'} before due</p>
        </div>
        <Button onClick={openManualDialog} style={{background:'#0d9488', color:'#fff'}}><Plus className="h-4 w-4 mr-2" />Schedule Manual Audit</Button>
      </div>

      {/* Filter bar */}
      <div className="flex gap-2 mb-4">
        {['', 'scheduled', 'overdue', 'completed', 'skipped'].map(s => (
          <button key={s} className="text-xs px-3 py-1.5 rounded-full font-medium" style={{ background: filterStatus === s ? '#0d9488' : 'rgba(255,255,255,0.06)', color: filterStatus === s ? '#fff' : 'rgba(234,229,236,0.6)' }} onClick={() => { setFilterStatus(s); setCurrentPage(1); }}>
            {s === '' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Asset</TableHead>
              <TableHead>Assigned Employee</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>Conducted By</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8" style={{color:'rgba(234,229,236,0.4)'}}>Loading audits...</TableCell></TableRow>
            ) : (audits || []).length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8" style={{color:'rgba(234,229,236,0.4)'}}>No audits found. Physical assets will be scheduled automatically.</TableCell></TableRow>
            ) : (
              (audits || []).map(audit => (
                <TableRow key={audit.id}>
                  <TableCell className="font-medium">{audit.asset_tag}</TableCell>
                  <TableCell style={{color:'rgba(234,229,236,0.6)'}}>{audit.employee_name || '—'}</TableCell>
                  <TableCell style={{color:'rgba(234,229,236,0.6)'}}>{audit.scheduledDate}</TableCell>
                  <TableCell>{statusBadge(audit.status)}</TableCell>
                  <TableCell>{resultBadge(audit.result)}</TableCell>
                  <TableCell style={{color:'rgba(234,229,236,0.6)'}}>{audit.conducted_by_name || '—'}</TableCell>
                  <TableCell>
                    {canReschedule && ['scheduled', 'overdue'].includes(audit.status) && (
                      <Button size="sm" variant="ghost" className="text-xs h-7 mr-1" onClick={() => openReschedule(audit)} title="Edit audit date"><Calendar className="h-3.5 w-3.5 mr-1" />Date</Button>
                    )}
                    {['scheduled', 'overdue'].includes(audit.status) && (
                      <Button size="sm" className="bg-[#0d9488] text-white text-xs h-7" onClick={() => openConduct(audit)}>Conduct Audit</Button>
                    )}
                    {audit.status === 'completed' && (
                      <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => openConduct(audit)}>View</Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <div className="flex items-center justify-between mt-4"><p className="text-sm" style={{color:'rgba(234,229,236,0.55)'}}>{totalAudits===0?'No audits':`Showing ${(currentPage-1)*40+1}-${Math.min(currentPage*40,totalAudits)} of ${totalAudits}`}</p><div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={currentPage<=1||loading} onClick={()=>setCurrentPage(page=>Math.max(1,page-1))}><ChevronLeft className="h-4 w-4 mr-1"/>Previous</Button><span className="text-sm px-2">Page {currentPage} of {totalPages}</span><Button variant="outline" size="sm" disabled={currentPage>=totalPages||loading} onClick={()=>setCurrentPage(page=>Math.min(totalPages,page+1))}>Next<ChevronRight className="h-4 w-4 ml-1"/></Button></div></div>

      <Dialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Edit Audit Date</DialogTitle><DialogDescription>{rescheduleAudit?.asset_tag}</DialogDescription></DialogHeader>
          <div><Label>Due Date</Label><Input type="date" value={rescheduleDate} onChange={e => setRescheduleDate(e.target.value)} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRescheduleOpen(false)}>Cancel</Button>
            <Button className="bg-[#0d9488]" onClick={saveReschedule} disabled={!rescheduleDate}>Save Date</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Conduct Audit Modal */}
      <Dialog open={conductOpen} onOpenChange={setConductOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" style={{background:'#050810', border:'1px solid rgba(255,255,255,0.10)', color:'#eae5ec'}}>
          <DialogHeader>
            <DialogTitle className="text-lg">
              {selectedAudit?.status === 'completed' ? 'Audit Result' : 'Conduct Audit'} — {selectedAudit?.asset_tag}
            </DialogTitle>
            <p className="text-sm" style={{color:'rgba(234,229,236,0.5)'}}>Employee: {selectedAudit?.employee_name || '—'} · Due: {selectedAudit?.scheduledDate}</p>
          </DialogHeader>

          {/* Progress indicator */}
          <div className="flex items-center justify-between py-2 px-3 rounded-lg mb-2" style={{background:'rgba(255,255,255,0.04)'}}>
            <span className="text-sm font-medium" style={{color:'rgba(234,229,236,0.7)'}}>Checklist Progress</span>
            <span className="text-sm font-bold" style={{color: checkedCount === checklist.length ? '#34C759' : '#FF9500'}}>{checkedCount} / {checklist.length} items checked</span>
          </div>

          {/* Checklist */}
          <div className="space-y-2">
            {checklist.map((c, idx) => (
              <div key={idx} className="p-3 rounded-lg" style={{background: c.status === 'pass' ? 'rgba(52,199,89,0.08)' : c.status === 'fail' ? 'rgba(255,59,48,0.08)' : 'rgba(255,255,255,0.03)', border: `1px solid ${c.status === 'pass' ? 'rgba(52,199,89,0.2)' : c.status === 'fail' ? 'rgba(255,59,48,0.2)' : 'rgba(255,255,255,0.06)'}` }}>
                <div className="flex items-center justify-between gap-3 mb-1">
                  <span className="text-sm flex-1" style={{color:'#eae5ec'}}>{idx + 1}. {c.item}</span>
                  <div className="flex gap-1 shrink-0">
                    {['pass', 'fail', 'na'].map(s => (
                      <button key={s} disabled={selectedAudit?.status === 'completed'} onClick={() => setItemStatus(idx, s)}
                        className="text-xs px-2 py-0.5 rounded font-bold"
                        style={{ background: c.status === s ? (s === 'pass' ? '#34C759' : s === 'fail' ? '#FF3B30' : '#6E6E73') : 'rgba(255,255,255,0.06)', color: c.status === s ? '#fff' : 'rgba(234,229,236,0.5)', opacity: selectedAudit?.status === 'completed' ? 0.7 : 1 }}>
                        {s === 'na' ? 'N/A' : s.charAt(0).toUpperCase() + s.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                <Input className="h-7 text-xs mt-1" placeholder="Notes (optional)" value={c.notes || ''} disabled={selectedAudit?.status === 'completed'} onChange={e => setItemNotes(idx, e.target.value)} style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', color:'#eae5ec'}} />
              </div>
            ))}
          </div>

          {/* Bottom section */}
          <div className="space-y-3 mt-4 pt-4" style={{borderTop:'1px solid rgba(255,255,255,0.08)'}}>
            <div>
              <Label className="text-xs mb-1 block" style={{color:'rgba(234,229,236,0.7)'}}>Overall Notes</Label>
              <Textarea rows={2} value={overallNotes} disabled={selectedAudit?.status === 'completed'} onChange={e => setOverallNotes(e.target.value)} placeholder="General observations..." style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.12)', color:'#eae5ec', fontSize:'0.8125rem'}} />
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={followUp} disabled={selectedAudit?.status === 'completed'} onChange={e => setFollowUp(e.target.checked)} className="rounded" />
                <span className="text-sm" style={{color:'rgba(234,229,236,0.7)'}}>Follow-up required</span>
              </label>
            </div>
            {followUp && (
              <Input className="h-8 text-sm" placeholder="Follow-up notes..." value={followUpNotes} disabled={selectedAudit?.status === 'completed'} onChange={e => setFollowUpNotes(e.target.value)} style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.12)', color:'#eae5ec'}} />
            )}
          </div>

          {selectedAudit?.status !== 'completed' && (
            <DialogFooter className="mt-4 gap-2">
              <Button variant="ghost" onClick={() => setConductOpen(false)} style={{color:'rgba(234,229,236,0.6)'}}>Cancel</Button>
              <Button onClick={() => submitAudit('fail')} disabled={submitting || !hasFailures} style={{background: hasFailures ? '#FF3B30' : 'rgba(255,59,48,0.3)', color:'#fff'}}>
                {submitting ? 'Saving...' : 'Submit with Failures'}
              </Button>
              <Button onClick={() => submitAudit('pass')} disabled={submitting || !allPassOrNA} style={{background: allPassOrNA ? '#34C759' : 'rgba(52,199,89,0.3)', color:'#fff'}}>
                {submitting ? 'Saving...' : 'Mark as QC Pass ✓'}
              </Button>
            </DialogFooter>
          )}
          {selectedAudit?.status === 'completed' && (
            <DialogFooter className="mt-4">
              <Button variant="ghost" onClick={() => setConductOpen(false)} style={{color:'rgba(234,229,236,0.6)'}}>Close</Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Schedule Manual Audit Dialog */}
      <Dialog open={manualDialogOpen} onOpenChange={setManualDialogOpen}>
        <DialogContent style={{background:'#050810', border:'1px solid rgba(255,255,255,0.10)', color:'#eae5ec'}}>
          <DialogHeader><DialogTitle>Schedule Manual Audit</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label className="text-xs mb-1 block" style={{color:'rgba(234,229,236,0.7)'}}>Asset *</Label>
              <select value={manualAssetId} onChange={e => setManualAssetId(e.target.value)} style={{width:'100%', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.12)', borderRadius:'8px', padding:'8px', color:'#eae5ec', fontSize:'0.8125rem'}}>
                <option value="">Select asset...</option>
                {manualAssets.map(a => <option key={a.id} value={a.id}>{a.asset_tag} — {a.category_name || a.category || ''}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs mb-1 block" style={{color:'rgba(234,229,236,0.7)'}}>Scheduled Date</Label>
              <Input type="date" value={manualDate} onChange={e => setManualDate(e.target.value)} style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.12)', color:'#eae5ec'}} />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={() => setManualDialogOpen(false)} style={{color:'rgba(234,229,236,0.6)'}}>Cancel</Button>
            <Button onClick={scheduleManualAudit} style={{background:'#0d9488', color:'#fff'}}>Schedule</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// SMTP Settings Tab
function SmtpSettingsTab() {
  const [cfg, setCfg] = useState({ host: '', port: '587', secure: 'tls', user: '', pass: '', fromName: '', fromAddress: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testRecipient, setTestRecipient] = useState('');
  const [testResult, setTestResult] = useState(null); // { ok, msg }

  useEffect(() => {
    api.get('settings/smtp').then(data => {
      setCfg(prev => ({ ...prev, ...data }));
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setTestResult(null);
    try {
      await api.post('settings/smtp', cfg);
      toast.success('Email settings saved');
    } catch (err) { toast.error(err.message); }
    setSaving(false);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.post('settings/smtp/test', { ...cfg, to: testRecipient });
      setTestResult({ ok: true, msg: `Test email sent to ${res.to}` });
    } catch (err) {
      setTestResult({ ok: false, msg: err.message });
    }
    setTesting(false);
  };

  if (loading) return <div className="p-8"><ITdockPageLoader label="Loading settings" /></div>;

  const fieldStyle = { background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:'8px', padding:'8px 12px', color:'#eae5ec', fontSize:'14px', width:'100%', outline:'none' };
  const labelStyle = { color:'rgba(234,229,236,0.6)', fontSize:'13px', display:'block', marginBottom:'6px' };

  return (
    <div className="mt-4 space-y-6 max-w-xl">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label style={labelStyle}>SMTP Host</label>
          <input style={fieldStyle} value={cfg.host} onChange={e => setCfg({...cfg, host: e.target.value})} placeholder="smtp.gmail.com" />
        </div>
        <div>
          <label style={labelStyle}>SMTP Port</label>
          <input style={fieldStyle} value={cfg.port} onChange={e => setCfg({...cfg, port: e.target.value})} placeholder="587" />
        </div>
        <div>
          <label style={labelStyle}>Encryption</label>
          <select style={fieldStyle} value={cfg.secure} onChange={e => setCfg({...cfg, secure: e.target.value})}>
            <option value="tls">TLS (recommended)</option>
            <option value="ssl">SSL</option>
            <option value="none">None</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Username</label>
          <input style={fieldStyle} value={cfg.user} onChange={e => setCfg({...cfg, user: e.target.value})} placeholder="your@email.com" />
        </div>
        <div>
          <label style={labelStyle}>Password</label>
          <input style={fieldStyle} type="password" value={cfg.pass} onChange={e => setCfg({...cfg, pass: e.target.value})} placeholder="App password" />
        </div>
        <div>
          <label style={labelStyle}>From Name</label>
          <input style={fieldStyle} value={cfg.fromName} onChange={e => setCfg({...cfg, fromName: e.target.value})} placeholder="ITdock Alerts" />
        </div>
        <div className="col-span-2">
          <label style={labelStyle}>From Address</label>
          <input style={fieldStyle} value={cfg.fromAddress} onChange={e => setCfg({...cfg, fromAddress: e.target.value})} placeholder="noreply@yourdomain.com" />
        </div>
        <div className="col-span-2">
          <label style={labelStyle}>Test Recipient</label>
          <input style={fieldStyle} type="email" value={testRecipient} onChange={e => setTestRecipient(e.target.value)} placeholder="recipient@example.com" />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={handleTest} disabled={testing || !cfg.host || !cfg.user || !testRecipient}
          style={{background:'rgba(255,255,255,0.06)', color:'#eae5ec', border:'1px solid rgba(255,255,255,0.12)', borderRadius:'8px', padding:'8px 16px', fontWeight:500, fontSize:'14px', cursor: (testing || !cfg.host) ? 'not-allowed' : 'pointer', opacity: (testing || !cfg.host) ? 0.5 : 1}}>
          {testing ? 'Sending…' : 'Test Email'}
        </button>
        <button onClick={handleSave} disabled={saving || !cfg.host || !cfg.user}
          style={{background:'#1a1a1a', color:'#ffffff', border:'none', borderRadius:'8px', padding:'8px 16px', fontWeight:500, fontSize:'14px', cursor:(saving || !cfg.host || !cfg.user) ? 'not-allowed' : 'pointer', opacity:(saving || !cfg.host || !cfg.user) ? 0.5 : 1}}>
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
        {testResult && (
          <span style={{fontSize:'13px', color: testResult.ok ? '#4ade80' : '#f87171'}}>
            {testResult.ok ? '✓ ' : '✗ '}{testResult.msg}
          </span>
        )}
      </div>

      <div className="rounded-xl p-4 text-xs space-y-1" style={{background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.06)', color:'rgba(234,229,236,0.5)'}}>
        <p className="font-semibold mb-2" style={{color:'rgba(234,229,236,0.7)'}}>Common SMTP configurations</p>
        <p>Gmail — smtp.gmail.com · Port 587 · TLS (use App Password, not Gmail password)</p>
        <p>Outlook — smtp-mail.outlook.com · Port 587 · TLS</p>
        <p>Zoho — smtp.zoho.com · Port 587 · TLS</p>
        <p>Custom — your mail server hostname and credentials</p>
      </div>
    </div>
  );
}

// Settings Page
function SettingsPage({ user }) {
  const [activeSettingsTab, setActiveSettingsTab] = useState('general');
  const canSeeLogs = ['super_admin', 'it_admin'].includes(user?.role);
  const isSuperAdmin = user?.role === 'super_admin';

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6" style={{color:'#eae5ec'}}>Settings</h1>
      <Tabs value={activeSettingsTab} onValueChange={setActiveSettingsTab}>
        <TabsList>
          <TabsTrigger value="general"><Settings className="h-4 w-4 mr-2" />General</TabsTrigger>
          {isSuperAdmin && <TabsTrigger value="email"><Mail className="h-4 w-4 mr-2" />Email</TabsTrigger>}
          {canSeeLogs && <TabsTrigger value="logs"><FileText className="h-4 w-4 mr-2" />System Logs</TabsTrigger>}
        </TabsList>
        <TabsContent value="general">
          <Card className="mt-4">
            <CardContent className="pt-6">
              <p className="text-sm" style={{color:'rgba(234,229,236,0.5)'}}>General settings will be available here.</p>
            </CardContent>
          </Card>
        </TabsContent>
        {isSuperAdmin && (
          <TabsContent value="email">
            <Card className="mt-4">
              <CardHeader>
                <CardTitle className="text-base">Email / SMTP Configuration</CardTitle>
                <CardDescription>Configure the outgoing email server for alerts and notifications.</CardDescription>
              </CardHeader>
              <CardContent>
                <SmtpSettingsTab />
              </CardContent>
            </Card>
          </TabsContent>
        )}
        {canSeeLogs && (
          <TabsContent value="logs">
            <AuditLogPage user={user} embedded />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

// Audit Log Page
function AuditLogPage({ user, embedded }) {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [allUsers, setAllUsers] = useState([]);

  const [filters, setFilters] = useState({ q: '', action: '', entity: '', user_id: '', date_from: '', date_to: '' });
  const [applied, setApplied] = useState({ q: '', action: '', entity: '', user_id: '', date_from: '', date_to: '' });

  const ACTIONS = ['CREATE','UPDATE','DELETE','ASSIGN','UNASSIGN','BULK_UNASSIGN','RESIGN','RENEW','CHANGE_PASSWORD',
    'CREATE_API_KEY','DELETE_API_KEY','UPLOAD_CUSTODY','DELETE_CUSTODY','UPLOAD_DOCUMENT','DELETE_DOCUMENT',
    'COMPLETE_MAINTENANCE','SCRAP','RESTORE','RESET'];
  const ENTITIES = ['asset','employee','user','assignment','maintenance','category','company','project','location','department','api_key'];

  const getActionColor = (action) => {
    if (['CREATE','RESTORE'].some(a => action.includes(a))) return 'bg-green-100 text-green-800';
    if (['UPDATE','CHANGE_PASSWORD','RENEW','RESET'].some(a => action.includes(a))) return 'bg-blue-100 text-blue-800';
    if (['DELETE'].some(a => action.includes(a))) return 'bg-red-100 text-red-800';
    if (['ASSIGN'].some(a => action.includes(a))) return 'bg-purple-100 text-purple-800';
    if (['SCRAP'].some(a => action.includes(a))) return 'bg-orange-100 text-orange-800';
    if (['UPLOAD'].some(a => action.includes(a))) return 'bg-blue-50 text-blue-700';
    return 'bg-[rgba(255,255,255,0.06)] text-[#eae5ec] border border-white/10';
  };

  const formatDetails = (details) => {
    if (!details || Object.keys(details).length === 0) return '—';
    return Object.entries(details).map(([k, v]) => {
      if (v === null || v === undefined || v === '') return null;
      const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return `${k.replace(/_/g, ' ')}: ${val}`;
    }).filter(Boolean).join(' · ');
  };

  const loadLogs = async (p = 1, f = applied) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: p, limit: 50 });
      if (f.q) params.set('q', f.q);
      if (f.action) params.set('action', f.action);
      if (f.entity) params.set('entity', f.entity);
      if (f.user_id) params.set('user_id', f.user_id);
      if (f.date_from) params.set('date_from', f.date_from);
      if (f.date_to) params.set('date_to', f.date_to);
      const data = await api.get(`audit?${params.toString()}`);
      setLogs(data.logs);
      setTotal(data.total);
      setPage(data.page);
      setPages(data.pages);
    } catch (err) { toast.error(err.message || 'Failed to load audit log'); }
    setLoading(false);
  };

  useEffect(() => {
    api.get('audit/actors').then(setAllUsers).catch(() => {});
    loadLogs(1, applied);
  }, []);

  const applyFilters = () => {
    setApplied({ ...filters });
    loadLogs(1, filters);
  };

  const clearFilters = () => {
    const empty = { q: '', action: '', entity: '', user_id: '', date_from: '', date_to: '' };
    setFilters(empty);
    setApplied(empty);
    loadLogs(1, empty);
  };

  const handleExport = () => {
    downloadXlsx(logs.map(l => ({
      Timestamp: new Date(l.timestamp).toLocaleString(),
      User: l.user_name || '',
      Action: l.action,
      Entity: l.entity,
      'Entity ID': l.entity_id || '',
      Details: formatDetails(l.details)
    })), 'Audit Log', `audit_log_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  if (!['super_admin', 'it_admin'].includes(user?.role)) {
    return <div className="p-8"><p style={{color:'rgba(234,229,236,0.6)'}}>Access restricted to administrators.</p></div>;
  }

  return (
    <div className={embedded ? 'pt-4' : 'p-8'}>
      {!embedded && (
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold" style={{color:'#eae5ec'}}>Audit Log</h1>
            <p className="text-sm mt-0.5" style={{color:'rgba(234,229,236,0.6)'}}>{total} total entries</p>
          </div>
          <Button onClick={handleExport} variant="outline" size="sm"><Download className="h-4 w-4 mr-2" />Export Excel</Button>
        </div>
      )}
      {embedded && (
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm" style={{color:'rgba(234,229,236,0.6)'}}>{total} total entries</p>
          <Button onClick={handleExport} variant="outline" size="sm"><Download className="h-4 w-4 mr-2" />Export Excel</Button>
        </div>
      )}

      {/* Filter bar */}
      <Card className="mb-4">
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-3">
            <Input placeholder="Search action / entity ID..." value={filters.q} onChange={e => setFilters({...filters, q: e.target.value})}
              onKeyDown={e => e.key === 'Enter' && applyFilters()} />
            <select value={filters.action} onChange={e => setFilters({...filters, action: e.target.value})}
              style={{fontSize:'0.8125rem', border:'1px solid rgba(255,255,255,0.12)', borderRadius:'8px', padding:'0 8px', background:'#0a0e17', color: filters.action ? '#1D1D1F' : '#AEAEB2', height:'36px'}}>
              <option value="">All Actions</option>
              {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <select value={filters.entity} onChange={e => setFilters({...filters, entity: e.target.value})}
              style={{fontSize:'0.8125rem', border:'1px solid rgba(255,255,255,0.12)', borderRadius:'8px', padding:'0 8px', background:'#0a0e17', color: filters.entity ? '#1D1D1F' : '#AEAEB2', height:'36px'}}>
              <option value="">All Entities</option>
              {ENTITIES.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
            <select value={filters.user_id} onChange={e => setFilters({...filters, user_id: e.target.value})}
              style={{fontSize:'0.8125rem', border:'1px solid rgba(255,255,255,0.12)', borderRadius:'8px', padding:'0 8px', background:'#0a0e17', color: filters.user_id ? '#1D1D1F' : '#AEAEB2', height:'36px'}}>
              <option value="">All Users</option>
              {allUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <Input type="date" value={filters.date_from} onChange={e => setFilters({...filters, date_from: e.target.value})} placeholder="From date" />
            <Input type="date" value={filters.date_to} onChange={e => setFilters({...filters, date_to: e.target.value})} placeholder="To date" />
          </div>
          <div className="flex gap-2">
            <Button onClick={applyFilters} className="bg-[#0d9488] hover:bg-[#0062CC] text-white" size="sm" disabled={loading}>
              <Search className="h-3.5 w-3.5 mr-1.5" />Apply
            </Button>
            <Button onClick={clearFilters} variant="outline" size="sm">Clear</Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <ScrollArea className="h-[540px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Entity ID</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8" style={{color:'rgba(234,229,236,0.4)'}}>Loading...</TableCell></TableRow>
              ) : logs.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8" style={{color:'rgba(234,229,236,0.4)'}}>No audit entries found</TableCell></TableRow>
              ) : logs.map(log => (
                <TableRow key={log.id}>
                  <TableCell className="text-sm whitespace-nowrap" style={{color:'rgba(234,229,236,0.6)'}}>{new Date(log.timestamp).toLocaleString()}</TableCell>
                  <TableCell className="text-sm font-medium">{log.user_name || '—'}</TableCell>
                  <TableCell><Badge className={getActionColor(log.action)} style={{fontSize:'0.7rem'}}>{log.action}</Badge></TableCell>
                  <TableCell className="text-sm capitalize">{log.entity}</TableCell>
                  <TableCell className="text-xs font-mono" style={{color:'rgba(234,229,236,0.4)', maxWidth:'120px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}} title={log.entity_id}>{log.entity_id || '—'}</TableCell>
                  <TableCell className="text-sm max-w-xs" style={{color:'rgba(234,229,236,0.6)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}} title={formatDetails(log.details)}>{formatDetails(log.details)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3" style={{borderTop:'1px solid rgba(255,255,255,0.06)'}}>
            <p className="text-sm" style={{color:'rgba(234,229,236,0.6)'}}>Page {page} of {pages || 1} · {total} entries</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => { const p = page - 1; setPage(p); loadLogs(p); }}>Previous</Button>
              <Button size="sm" variant="outline" disabled={page >= pages || loading} onClick={() => { const p = page + 1; setPage(p); loadLogs(p); }}>Next</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// Users Page
function UsersPage({ currentUser }) {
  const roleOptions = [
    { id: 'admin', label: 'Super Admin' },
    { id: 'it_support', label: 'IT Support' },
    { id: 'asset_manager', label: 'Asset Manager' },
    { id: 'ordinary', label: 'Ordinary' }
  ];
  const [users, setUsers] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formData, setFormData] = useState({});
  const confirm = useConfirm();

  useEffect(() => { api.get('users').then(setUsers).catch(() => toast.error('Failed to load users')); }, []);

  const openDialog = (u = null) => {
    if (u) { setEditing(u); setFormData({ email: u.email, name: u.name, roles: u.roles || [u.role], password: '' }); }
    else { setEditing(null); setFormData({ email: '', name: '', roles: ['ordinary'], password: '' }); }
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    try {
      if (editing) { const updates = { name: formData.name, roles: formData.roles }; if (formData.password) updates.password = formData.password; await api.put(`users/${editing.id}`, updates); }
      else { await api.post('users', formData); }
      toast.success(editing ? 'Updated' : 'Created');
      setDialogOpen(false);
      const u = await api.get('users'); setUsers(u);
    } catch (err) { toast.error(err.message); }
  };

  const handleDelete = async (id) => {
    const ok = await confirm({ title: 'Delete User', description: 'This user will be permanently deleted.', confirmLabel: 'Delete' });
    if (!ok) return;
    try { await api.delete(`users/${id}`); toast.success('Deleted'); const u = await api.get('users'); setUsers(u); }
    catch (err) { toast.error(err.message); }
  };

  const getRoleColor = (r) => {
    const colors = { admin: 'bg-red-100 text-red-800', asset_manager: 'bg-blue-100 text-blue-800', it_support: 'bg-green-100 text-green-800', ordinary: 'bg-[rgba(255,255,255,0.06)] text-[#eae5ec] border border-white/10' };
    return colors[r] || 'bg-[rgba(255,255,255,0.06)] text-[#eae5ec] border border-white/10';
  };

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-white">User Management</h1>
        <Button onClick={() => openDialog()} className="bg-[#0d9488]"><Plus className="h-4 w-4 mr-2" />Add User</Button>
      </div>
      <Card>
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {users.map(u => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.name}</TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell><div className="flex flex-wrap gap-1">{(u.roles || [u.role]).map(r => <Badge key={r} className={getRoleColor(r)}>{roleOptions.find(o => o.id === r)?.label || r.replace('_', ' ')}</Badge>)}</div></TableCell>
                <TableCell>
                  <Button size="sm" variant="ghost" onClick={() => openDialog(u)}><Pencil className="h-4 w-4" /></Button>
                  {u.id !== currentUser.id && <Button size="sm" variant="ghost" onClick={() => handleDelete(u.id)}><Trash2 className="h-4 w-4 text-red-500" /></Button>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'Edit' : 'Add'} User</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Name *</Label><Input value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} /></div>
            <div><Label>Email *</Label><Input type="email" value={formData.email} onChange={(e) => setFormData({...formData, email: e.target.value})} disabled={!!editing} /></div>
            <div><Label>{editing ? 'New Password' : 'Password *'}</Label><Input type="password" value={formData.password} onChange={(e) => setFormData({...formData, password: e.target.value})} /></div>
            <div><Label>Roles *</Label>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {roleOptions.map(option => <label key={option.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={(formData.roles || []).includes(option.id)} onChange={e => setFormData({...formData, roles: e.target.checked ? [...(formData.roles || []), option.id] : (formData.roles || []).filter(r => r !== option.id)})} />{option.label}</label>)}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} className="bg-[#0d9488]" disabled={!formData.name || !formData.email || !(formData.roles || []).length || (!editing && !formData.password)}>{editing ? 'Update' : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Main App
// About Author Page (in-app)
function AboutDeveloperPage() {
  const features = [
    { icon: Monitor, label: 'Physical Asset Tracking', desc: 'Laptops, desktops, monitors, and peripherals' },
    { icon: Cloud, label: 'Subscription & Cloud Tracking', desc: 'SaaS, VPS, and cloud services with billing alerts' },
    { icon: Users, label: 'Employee Management', desc: 'Link assets to people with full assignment history' },
    { icon: Plane, label: 'Vacation Asset Tracking', desc: 'Know where assets are when staff are away' },
    { icon: Phone, label: 'Office Extension Directory', desc: 'Internal telephone extensions with permissions' },
    { icon: ClipboardList, label: 'Asset Audits', desc: 'Rolling checklist audits with QC pass/fail' },
    { icon: FileText, label: 'Invoice Management', desc: 'Upload and organize invoices per asset' },
    { icon: Wrench, label: 'Maintenance Tracking', desc: 'Log repairs and maintenance history' },
    { icon: Cpu, label: 'Hardware Specifications', desc: 'RAM, CPU, storage, and IP address per device' },
    { icon: PlusCircle, label: 'Addon Tracking', desc: 'Track paid extras on servers and subscriptions' },
    { icon: Wifi, label: 'IoT & Network Devices', desc: 'IP cameras, switches, and routers with MAC/VLAN' },
    { icon: Shield, label: 'Enterprise Security', desc: 'RBAC, 2FA, session management, and audit logs' },
    { icon: Link2, label: 'API Integration', desc: 'Connect ITdock with external systems and workflows' },
    { icon: ShieldCheck, label: 'Warranty Management', desc: 'Track coverage, expiration dates, and warranty status' },
    { icon: Building2, label: 'Vendor Management', desc: 'Manage suppliers, contacts, purchases, and relationships' },
    { icon: Package, label: 'IT Inventory Management', desc: 'Maintain a complete, accurate view of your IT inventory' },
  ];

  const links = [
    { icon: Globe, label: 'mahaz.uk', href: 'https://mahaz.uk' },
    { icon: ExternalLink, label: 'LinkedIn', href: 'https://www.linkedin.com/in/mahaz-abdullah/' },
    { icon: Github, label: 'GitHub', href: 'https://github.com/mahaz121' },
    { icon: Github, label: 'ITdock GitHub', href: 'https://github.com/mahaz121/ITdock' },
  ];

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-8">

      {/* Section 1 — App Info (hero) */}
      <div className="rounded-2xl p-7" style={{background:'rgba(94,234,212,0.08)', border:'1px solid rgba(94,234,212,0.22)'}}>
        <div className="flex items-start gap-5 mb-4">
          <img src="/logo.png" alt="ITdock logo" className="w-14 h-14 object-contain shrink-0" />
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold" style={{color:'#eae5ec'}}>ITdock</h1>
              <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold" style={{background:'rgba(94,234,212,0.15)', color:'#5eead4', border:'1px solid rgba(94,234,212,0.3)'}}>v3.4</span>
            </div>
            <p className="text-sm mt-1" style={{color:'rgba(234,229,236,0.55)'}}>Enterprise IT Asset Management · Open Source · Free</p>
          </div>
        </div>
        <p className="text-sm leading-relaxed" style={{color:'rgba(234,229,236,0.75)'}}>
          ITdock is a free, open-source platform built for modern IT teams to track assets, subscriptions, employees, and infrastructure.
        </p>
      </div>

      {/* Section 2 — Features */}
      <div>
        <h2 className="font-semibold text-base mb-4" style={{color:'#eae5ec'}}>What ITdock Can Do</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {features.map(({icon: Icon, label, desc}) => (
            <div key={label} className="flex items-start gap-3 p-3 rounded-xl" style={{background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)'}}>
              <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{background:'rgba(94,234,212,0.10)', border:'1px solid rgba(94,234,212,0.20)'}}>
                <Icon className="h-4 w-4" style={{color:'#5eead4'}} />
              </span>
              <div>
                <p className="text-sm font-medium" style={{color:'#eae5ec'}}>{label}</p>
                <p className="text-xs" style={{color:'rgba(234,229,236,0.45)'}}>{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Section 3 — Author */}
      <div>
        <h2 className="font-semibold text-base mb-3" style={{color:'#eae5ec'}}>About Author</h2>
        <div className="rounded-xl p-5" style={{background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)'}}>
          <div>
            <p className="font-semibold" style={{color:'#eae5ec'}}>Riaz Rahman Bhuyan (Mahaz)</p>
            <p className="text-sm mt-1" style={{color:'#5eead4'}}>Cloud Engineer</p>
            <div className="flex flex-wrap gap-2 mt-4">
              {links.map(({icon: Icon, label, href}) => (
                <a key={label} href={href} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium"
                  style={{background:'rgba(255,255,255,0.04)', color:'#eae5ec', border:'1px solid rgba(255,255,255,0.10)', textDecoration:'none'}}>
                  <Icon className="h-3.5 w-3.5" style={{color:'#5eead4'}} />{label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Section 5 — Support */}
      <div>
        <h2 className="font-semibold text-base mb-2" style={{color:'#eae5ec'}}>Support This Project</h2>
        <p className="text-sm mb-4" style={{color:'rgba(234,229,236,0.55)'}}>ITdock is free. If it helped your team, consider buying the author a coffee.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button onClick={() => window.open('https://ko-fi.com/mahaz', '_blank')}
            className="flex items-center gap-3 p-4 rounded-xl text-left"
            style={{background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)', cursor:'pointer'}}>
            <Coffee className="h-5 w-5 shrink-0" style={{color:'#f59e0b'}} />
            <div>
              <p className="text-sm font-medium" style={{color:'#eae5ec'}}>☕ Ko-fi</p>
              <p className="text-xs" style={{color:'rgba(234,229,236,0.45)'}}>Buy a Coffee · PayPal &amp; Card</p>
            </div>
          </button>
          <button onClick={() => window.open('https://github.com/sponsors/mahaz121', '_blank')}
            className="flex items-center gap-3 p-4 rounded-xl text-left"
            style={{background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)', cursor:'pointer'}}>
            <Heart className="h-5 w-5 shrink-0" style={{color:'#f87171'}} />
            <div>
              <p className="text-sm font-medium" style={{color:'#eae5ec'}}>GitHub Sponsors</p>
              <p className="text-xs" style={{color:'rgba(234,229,236,0.45)'}}>github.com/sponsors/mahaz121</p>
            </div>
          </button>
        </div>
      </div>

      {/* Section 6 — Footer */}
      <div className="pt-4 text-center" style={{borderTop:'1px solid rgba(255,255,255,0.06)'}}>
        <p className="text-xs" style={{color:'rgba(234,229,236,0.35)'}}>ITdock v3.4 · MIT License · © 2026 Riaz Rahman Bhuyan (Mahaz)</p>
        <p className="text-xs mt-1" style={{color:'rgba(234,229,236,0.25)'}}>itdock.mahaz.uk · mahaz.uk</p>
      </div>

    </div>
  );
}

// Idle timeout watcher — 30 min inactivity → warning → 60s countdown → auto-logout
const IDLE_MINUTES = 30;
const WARN_SECONDS = 60;

function IdleTimeoutWatcher({ onLogout }) {
  const [showWarning, setShowWarning] = useState(false);
  const [countdown, setCountdown] = useState(WARN_SECONDS);
  const idleTimer = React.useRef(null);
  const countdownTimer = React.useRef(null);

  const resetIdle = useCallback(() => {
    if (showWarning) return;
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      setShowWarning(true);
      setCountdown(WARN_SECONDS);
    }, IDLE_MINUTES * 60 * 1000);
  }, [showWarning]);

  useEffect(() => {
    const events = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'];
    events.forEach(e => window.addEventListener(e, resetIdle, { passive: true }));
    resetIdle();
    return () => {
      events.forEach(e => window.removeEventListener(e, resetIdle));
      clearTimeout(idleTimer.current);
      clearInterval(countdownTimer.current);
    };
  }, [resetIdle]);

  useEffect(() => {
    if (showWarning) {
      countdownTimer.current = setInterval(() => {
        setCountdown(c => {
          if (c <= 1) { clearInterval(countdownTimer.current); onLogout(); return 0; }
          return c - 1;
        });
      }, 1000);
    } else {
      clearInterval(countdownTimer.current);
    }
    return () => clearInterval(countdownTimer.current);
  }, [showWarning, onLogout]);

  const stayLoggedIn = () => {
    setShowWarning(false);
    setCountdown(WARN_SECONDS);
    resetIdle();
  };

  if (!showWarning) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{background:'rgba(0,0,0,0.4)', backdropFilter:'blur(4px)'}}>
      <div className="w-full max-w-sm rounded-[18px] p-8 text-center" style={{background:'#050810', border:'1px solid rgba(255,255,255,0.08)', boxShadow:'0 8px 48px rgba(0,0,0,0.48)'}}>
        <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center" style={{background:'rgba(251,146,60,0.12)', border:'2px solid rgba(255,149,0,0.3)'}}>
          <Clock className="h-8 w-8" style={{color:'#FF9500'}} />
        </div>
        <h2 className="text-xl font-bold mb-2" style={{color:'#eae5ec'}}>Session Expiring</h2>
        <p className="text-sm mb-4" style={{color:'rgba(234,229,236,0.6)'}}>You've been inactive. You'll be signed out in</p>
        <div className="text-5xl font-bold mb-6" style={{color: countdown <= 10 ? '#FF3B30' : '#FF9500'}}>{countdown}</div>
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" style={{borderColor:'rgba(255,255,255,0.12)', color:'rgba(234,229,236,0.6)'}} onClick={onLogout}>Sign Out</Button>
          <Button className="flex-1 bg-[#0d9488] hover:bg-[#0f766e] text-white" onClick={stayLoggedIn}>Stay Logged In</Button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [loading, setLoading] = useState(true);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
  const [selectedAssetId, setSelectedAssetId] = useState(null);
  const [assetsBillsFilter, setAssetsBillsFilter] = useState(false);
  const [assetAssignmentTarget, setAssetAssignmentTarget] = useState(null);

  useEffect(() => { checkAuth(); }, []);

  const checkAuth = async () => {
    const token = api.getToken();
    if (token) {
      try { const userData = await api.get('auth/me'); setUser(userData); }
      catch { api.clearToken(); }
    }
    setLoading(false);
  };

  const handleLogout = async () => {
    try { await api.post('auth/logout', {}); } catch {}
    api.clearToken();
    setUser(null);
    setActiveTab('dashboard');
    toast.success('Logged out');
  };

  const navigateToTab = useCallback((tab) => {
    setActiveTab(tab);
    setSelectedEmployeeId(null);
    setSelectedAssetId(null);
    if (tab !== 'assets') setAssetAssignmentTarget(null);
  }, []);

  const viewEmployee = (id) => { setSelectedEmployeeId(id); setActiveTab('employee-detail'); };
  const viewAsset = (id) => { setSelectedAssetId(id); setActiveTab('asset-detail'); };
  const startAssetAssignment = (employee) => {
    setAssetsBillsFilter(false);
    setAssetAssignmentTarget({ id: employee.id, name: employee.name, project_id: employee.project_id || '', project_name: employee.project_name || '', location_id: employee.location_id || '', location_name: employee.location_name || '' });
    setActiveTab('assets');
  };
  const finishAssetAssignment = (employeeId) => {
    setAssetAssignmentTarget(null);
    viewEmployee(employeeId);
  };

  // Handle notification click - navigate to appropriate page
  const handleNotificationClick = (notif) => {
    if (notif.type === 'vacation_ended' && notif.employee_id) return viewEmployee(notif.employee_id);
    if (notif.type === 'maintenance_pending') return setActiveTab('maintenance');
    if (notif.type === 'audit_overdue') return setActiveTab('audits');
    // Warranty, expiry, renewal, and addon notifications are actionable in asset details.
    if (notif.asset_id) return viewAsset(notif.asset_id);
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center overflow-hidden relative" style={{background:'#050810'}}>
      <style>{`
        @keyframes loaderOrbit { to { transform: rotate(360deg); } }
        @keyframes loaderPulse { 0%,100% { transform:scale(.96); opacity:.72; } 50% { transform:scale(1.04); opacity:1; } }
        @keyframes loaderScan { 0% { transform:translateX(-110%); } 100% { transform:translateX(310%); } }
        @keyframes loaderBlink { 0%,100% { opacity:.3; } 50% { opacity:1; } }
      `}</style>
      <div className="absolute inset-0 opacity-30" style={{backgroundImage:'linear-gradient(rgba(94,234,212,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(94,234,212,.035) 1px, transparent 1px)', backgroundSize:'36px 36px', maskImage:'radial-gradient(circle at center, black, transparent 68%)'}} />
      <div className="text-center relative z-10">
        <div className="relative w-28 h-28 mx-auto mb-7 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full" style={{border:'1px solid rgba(94,234,212,.12)', boxShadow:'0 0 45px rgba(13,148,136,.16)'}} />
          <div className="absolute inset-2 rounded-full" style={{border:'1px solid transparent', borderTopColor:'#5eead4', borderRightColor:'rgba(94,234,212,.18)', animation:'loaderOrbit 1.6s linear infinite'}} />
          <div className="absolute inset-5 rounded-full" style={{background:'rgba(94,234,212,.055)', border:'1px solid rgba(94,234,212,.14)', animation:'loaderPulse 2s ease-in-out infinite'}} />
          <img src="/logo.png" alt="ITdock logo" className="w-14 h-14 object-contain relative z-10" />
        </div>
        <p className="text-sm font-semibold tracking-[0.22em] uppercase" style={{color:'#eae5ec'}}>Initializing ITdock</p>
        <div className="w-44 h-px mx-auto mt-4 overflow-hidden" style={{background:'rgba(94,234,212,.12)'}}>
          <div className="w-16 h-full" style={{background:'linear-gradient(90deg, transparent, #5eead4, transparent)', animation:'loaderScan 1.45s ease-in-out infinite'}} />
        </div>
        <div className="flex justify-center gap-1.5 mt-4" aria-hidden="true">
          {[0,1,2].map(i => <span key={i} className="w-1 h-1 rounded-full" style={{background:'#5eead4', animation:`loaderBlink 1.2s ${i * .18}s ease-in-out infinite`}} />)}
        </div>
      </div>
    </div>
  );

  if (!user) {
    return <MahazLandingPage onLogin={setUser} />;
  }

  return (
    <ConfirmProvider>
    <div className="flex h-screen overflow-hidden" style={{background: '#0a0e17', color:'#eae5ec'}}>
      <GlobalRequestLoader />
      <IdleTimeoutWatcher onLogout={handleLogout} />
      {user.is_default_password && <ForcePasswordChangeModal onPasswordChanged={() => setUser({...user, is_default_password: false})} />}
      <Sidebar activeTab={activeTab} setActiveTab={navigateToTab} user={user} onLogout={handleLogout} />
      <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-14 flex items-center justify-end px-6 shrink-0" style={{background: '#050810', borderBottom: '1px solid rgba(255,255,255,0.08)'}}>
          <NotificationBell onNotificationClick={handleNotificationClick} />
        </header>
        <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden" style={{background:'#0a0e17', color:'#eae5ec'}}>
          <ErrorBoundary key={activeTab}>
          {activeTab === 'dashboard' && <Dashboard onNavigate={navigateToTab} onNavigateToBills={() => { setAssetsBillsFilter(true); navigateToTab('assets'); }} />}
          {activeTab === 'employees' && <EmployeesList user={user} onViewEmployee={viewEmployee} onCreateEmployee={() => {}} onAssignAsset={startAssetAssignment} />}
          {activeTab === 'employee-detail' && <EmployeeDetail employeeId={selectedEmployeeId} user={user} onBack={() => navigateToTab('employees')} onViewAsset={viewAsset} />}
          {activeTab === 'assets' && <AssetsList user={user} onViewAsset={viewAsset} billsFilter={assetsBillsFilter} onClearBillsFilter={() => setAssetsBillsFilter(false)} assignmentTarget={assetAssignmentTarget} onAssignmentComplete={finishAssetAssignment} onCancelAssignment={() => setAssetAssignmentTarget(null)} />}
          {activeTab === 'asset-detail' && <AssetDetail assetId={selectedAssetId} user={user} onBack={() => navigateToTab('assets')} onViewEmployee={viewEmployee} onNavigateToEmployeeCreate={() => navigateToTab('employees')} onNavigateToMaintenance={() => setActiveTab('maintenance')} />}
          {activeTab === 'extensions' && <ExtensionsPage user={user} />}
          {activeTab === 'company-emails' && <CompanyEmailsPage user={user} />}
          {activeTab === 'assignments' && <AssignmentsPage user={user} onViewAsset={viewAsset} />}
          {activeTab === 'custody' && <CustodyFormsPage user={user} api={api} />}
          {activeTab === 'maintenance' && <MaintenancePage user={user} />}
          {activeTab === 'scrap' && <ScrapPage user={user} />}
          {activeTab === 'vacation' && <PendingApprovalsPage user={user} onViewAsset={viewAsset} onViewEmployee={viewEmployee} />}
          {activeTab === 'audits' && <AuditsPage user={user} />}
          {activeTab === 'master' && <MasterDataPage user={user} />}
          {activeTab === 'settings' && <SettingsPage user={user} />}
          {activeTab === 'users' && <UsersPage currentUser={user} />}
          {activeTab === 'about' && <AboutDeveloperPage />}
          </ErrorBoundary>
        </main>
      </div>
    </div>
    </ConfirmProvider>
  );
}
