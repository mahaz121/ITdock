'use client';
import Link from 'next/link';
import {
  Monitor, Package, Shield, RefreshCw, FileText, Users, Bell,
  Database, Github, Globe, Mail, Heart, Coffee,
  ArrowLeft, Cpu, Key, Upload, Lock, Phone,
  Search, Wrench, Server, Wifi, ExternalLink
} from 'lucide-react';

const TEAL = '#5eead4';
const TEAL_DIM = 'rgba(94,234,212,0.12)';
const TEAL_BORDER = 'rgba(94,234,212,0.25)';
const SURFACE = 'rgba(255,255,255,0.04)';
const BORDER = 'rgba(255,255,255,0.08)';
const TEXT = '#eae5ec';
const MUTED = 'rgba(234,229,236,0.55)';

const features = [
  { icon: '🖥️', label: 'Physical Asset Tracking', desc: 'Laptops, desktops, monitors, peripherals' },
  { icon: '☁️', label: 'Subscription & Cloud Tracking', desc: 'SaaS, VPS, cloud services with billing alerts' },
  { icon: '👤', label: 'Employee Management', desc: 'Link assets to people with full assignment history' },
  { icon: '🏖️', label: 'Vacation Asset Tracking', desc: 'Know where assets are when staff are away' },
  { icon: '📞', label: 'Office Extension Directory', desc: 'Internal telephone extensions with permissions' },
  { icon: '🔍', label: 'Asset Audits', desc: 'Rolling 2-month checklist audits with QC pass/fail' },
  { icon: '📄', label: 'Invoice Management', desc: 'Upload and organize invoices per asset' },
  { icon: '🔧', label: 'Maintenance Tracking', desc: 'Log repairs and maintenance history' },
  { icon: '💻', label: 'Hardware Specs', desc: 'RAM, CPU, storage, IP address per device' },
  { icon: '📦', label: 'Addon Tracking', desc: 'Track paid extras on servers and subscriptions' },
  { icon: '📡', label: 'IoT & Network Devices', desc: 'IP cameras, switches, routers with MAC/VLAN' },
  { icon: '🔐', label: 'Enterprise Security', desc: 'RBAC, 2FA, session management, audit log' },
];

export default function AboutPage() {
  return (
    <div style={{ background: '#050810', minHeight: '100vh', color: TEXT, fontFamily: "'Geist', system-ui, sans-serif" }}>

      {/* Nav */}
      <nav style={{ borderBottom: `1px solid ${BORDER}`, backdropFilter: 'blur(12px)', background: 'rgba(5,8,16,0.8)', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: '#0d9488', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 16px rgba(94,234,212,0.35)' }}>
              <span style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>IT</span>
            </div>
            <span style={{ fontWeight: 700, fontSize: 16, color: TEXT }}>ITdock</span>
          </div>
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: MUTED, textDecoration: 'none' }}>
            <ArrowLeft size={14} /> Back to app
          </Link>
        </div>
      </nav>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 24px 80px' }}>

        {/* Section 1 — App Info (hero) */}
        <section style={{ textAlign: 'center', padding: '72px 0 56px' }}>
          <div style={{ width: 72, height: 72, borderRadius: 20, background: '#0d9488', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', boxShadow: '0 0 40px rgba(94,234,212,0.4)' }}>
            <Package size={36} color="#fff" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 48, fontWeight: 800, color: TEXT, margin: 0, lineHeight: 1.15 }}>
              IT<span style={{ color: TEAL }}>dock</span>
            </h1>
            <span style={{ fontSize: 13, padding: '4px 12px', borderRadius: 99, background: TEAL_DIM, color: TEAL, border: `1px solid ${TEAL_BORDER}`, fontWeight: 600 }}>v3.4</span>
          </div>
          <p style={{ fontSize: 15, color: MUTED, margin: '0 0 16px', fontWeight: 500 }}>
            Enterprise IT Asset Management · Open Source · Free
          </p>
          <p style={{ fontSize: 15, color: MUTED, maxWidth: 560, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.7, marginBottom: 28 }}>
            ITdock is a free, open-source platform built for modern IT teams to track assets, subscriptions, employees, and infrastructure.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, padding: '4px 12px', borderRadius: 99, background: 'rgba(0,200,150,0.12)', color: '#34C759', border: '1px solid rgba(0,200,150,0.25)', fontWeight: 600 }}>Production Ready</span>
            <span style={{ fontSize: 12, padding: '4px 12px', borderRadius: 99, background: 'rgba(255,149,0,0.12)', color: '#FF9500', border: '1px solid rgba(255,149,0,0.25)', fontWeight: 600 }}>Open Source</span>
            <span style={{ fontSize: 12, padding: '4px 12px', borderRadius: 99, background: 'rgba(94,234,212,0.10)', color: TEAL, border: `1px solid ${TEAL_BORDER}`, fontWeight: 600 }}>Free Forever</span>
          </div>
        </section>

        {/* Section 2 — Features */}
        <section style={{ marginBottom: 64 }}>
          <h2 style={{ fontSize: 26, fontWeight: 700, color: TEXT, marginBottom: 8 }}>What ITdock Can Do</h2>
          <p style={{ fontSize: 14, color: MUTED, marginBottom: 28 }}>Everything your IT team needs, in one clean interface.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
            {features.map(({ icon, label, desc }) => (
              <div key={label} style={{ borderRadius: 14, padding: '18px 20px', background: SURFACE, border: `1px solid ${BORDER}`, display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0, marginTop: 2 }}>{icon}</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: TEXT, marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.55 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Section 3 — Author */}
        <section style={{ marginBottom: 64 }}>
          <h2 style={{ fontSize: 26, fontWeight: 700, color: TEXT, marginBottom: 20 }}>Author</h2>
          <div style={{ borderRadius: 20, padding: '36px 32px', background: TEAL_DIM, border: `1px solid ${TEAL_BORDER}` }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24, flexWrap: 'wrap' }}>
              <div style={{ width: 72, height: 72, borderRadius: 18, background: 'linear-gradient(135deg, #0d9488, #5eead4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 26, color: '#050810', flexShrink: 0 }}>
                M
              </div>
              <div style={{ flex: 1, minWidth: 240 }}>
                <h3 style={{ fontSize: 20, fontWeight: 700, color: TEXT, margin: '0 0 6px' }}>Riaz Rahman Bhuyan (Mahaz)</h3>
                <p style={{ fontSize: 14, color: MUTED, margin: '0 0 16px', lineHeight: 1.65 }}>
                  IT systems enthusiast building practical tools for real-world asset management challenges.
                  ITdock was born from the frustration of managing IT inventory across spreadsheets — it exists
                  to give IT teams a clean, fast, and trustworthy single source of truth.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Section 4 — Connect */}
        <section style={{ marginBottom: 64 }}>
          <h2 style={{ fontSize: 26, fontWeight: 700, color: TEXT, marginBottom: 20 }}>Connect</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {[
              { label: '🌐 mahaz.uk', href: 'https://mahaz.uk' },
              { label: '💼 LinkedIn', href: 'https://www.linkedin.com/in/mahaz-abdullah/' },
              { label: '🐙 GitHub', href: 'https://github.com/mahaz121' },
              { label: '🐙 ITdock GitHub', href: 'https://github.com/mahaz121/ITdock' },
            ].map(({ label, href }) => (
              <a key={label} href={href} target="_blank" rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 500, padding: '9px 18px', borderRadius: 10, background: SURFACE, color: TEXT, textDecoration: 'none', border: `1px solid ${BORDER}` }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = TEAL_BORDER; e.currentTarget.style.color = TEAL; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.color = TEXT; }}>
                {label}
              </a>
            ))}
          </div>
        </section>

        {/* Section 5 — Support */}
        <section style={{ marginBottom: 64 }}>
          <h2 style={{ fontSize: 26, fontWeight: 700, color: TEXT, marginBottom: 8 }}>Support This Project</h2>
          <p style={{ fontSize: 14, color: MUTED, maxWidth: 520, lineHeight: 1.65, marginBottom: 24 }}>
            ITdock is free. If it helped your team, consider buying the author a coffee.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
            <a href="https://ko-fi.com/mahaz" target="_blank" rel="noopener noreferrer"
              style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '20px 24px', borderRadius: 16, background: SURFACE, border: `1px solid ${BORDER}`, textDecoration: 'none' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = TEAL_BORDER}
              onMouseLeave={e => e.currentTarget.style.borderColor = BORDER}>
              <Coffee size={28} color="#f59e0b" />
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: TEXT }}>☕ Ko-fi</div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>Buy a Coffee · PayPal &amp; Card</div>
              </div>
            </a>
            <a href="https://github.com/sponsors/mahaz121" target="_blank" rel="noopener noreferrer"
              style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '20px 24px', borderRadius: 16, background: SURFACE, border: `1px solid ${BORDER}`, textDecoration: 'none' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = TEAL_BORDER}
              onMouseLeave={e => e.currentTarget.style.borderColor = BORDER}>
              <Heart size={28} color="#f87171" />
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: TEXT }}>GitHub Sponsors</div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>github.com/sponsors/mahaz121</div>
              </div>
            </a>
          </div>
        </section>

        {/* Section 6 — Footer */}
        <footer style={{ textAlign: 'center', paddingTop: 32, borderTop: `1px solid ${BORDER}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10 }}>
            <div style={{ width: 24, height: 24, borderRadius: 6, background: '#0d9488', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: '#fff', fontWeight: 700, fontSize: 10 }}>IT</span>
            </div>
            <span style={{ fontWeight: 700, fontSize: 14, color: TEXT }}>ITdock</span>
          </div>
          <p style={{ fontSize: 13, color: MUTED, margin: '0 0 4px' }}>
            ITdock v3.4 · MIT License · © 2026 Riaz Rahman Bhuyan (Mahaz)
          </p>
          <p style={{ fontSize: 12, color: 'rgba(234,229,236,0.3)', margin: 0 }}>
            itdock.mahaz.uk · mahaz.uk
          </p>
        </footer>

      </div>
    </div>
  );
}
