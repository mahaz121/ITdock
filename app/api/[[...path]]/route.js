import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { hashPassword, verifyPassword, generateToken, verifyToken, getUserFromRequest, canAccess } from '@/lib/auth';
import { sendMail } from '@/lib/mail';
import { v4 as uuidv4 } from 'uuid';
import { writeFile, mkdir, unlink, readFile } from 'fs/promises';
import path from 'path';
import { createHmac, randomBytes } from 'crypto';

// ---- TOTP helpers (RFC 6238, no external dep) ----
function _b32Decode(str) {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const s = str.toUpperCase().replace(/=+$/, '');
  let bits = 0, val = 0;
  const out = [];
  for (const c of s) {
    const idx = alpha.indexOf(c);
    if (idx < 0) continue;
    val = (val << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

function _totpCode(secret, step) {
  const key = _b32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(0, 0);
  buf.writeUInt32BE(step >>> 0, 4);
  const hmac = createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(code % 1_000_000).padStart(6, '0');
}

function verifyTOTP(secret, token) {
  const step = Math.floor(Date.now() / 30000);
  return [step - 1, step, step + 1].some(s => _totpCode(secret, s) === token);
}

function generateTOTPSecret() {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  return Array.from(randomBytes(20), b => alpha[b % 32]).join('');
}

function totpUri(secret, email) {
  const issuer = 'Mahaz';
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
}

// ---- Specs categories helper ----
function computeHasSpecs(name) {
  if (!name) return false;
  const n = name.toLowerCase();
  return ['laptop', 'desktop', 'workstation', 'server', 'vps', 'dedicated', 'cloud server', 'pc', 'computer'].some(k => n.includes(k));
}

// ---- IoT / Network device helper ----
function computeIsIoT(name) {
  if (!name) return false;
  const n = name.toLowerCase();
  return ['switch', 'router', 'access point', 'wireless ap', 'wap', 'ip camera', 'camera', 'iot sensor', 'iot device', 'iot', 'firewall', 'nas', 'access point', 'ap '].some(k => n.includes(k));
}

// ---- Security helpers ----
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

async function checkLockout(db, email) {
  const rec = await db.collection('login_attempts').findOne({ email });
  if (!rec) return null;
  if (rec.locked_until && new Date(rec.locked_until) > new Date()) {
    const mins = Math.ceil((new Date(rec.locked_until) - new Date()) / 60000);
    return `Account locked. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`;
  }
  return null;
}

async function recordFailedLogin(db, email) {
  const rec = await db.collection('login_attempts').findOne({ email });
  const count = (rec?.count || 0) + 1;
  const locked_until = count >= MAX_LOGIN_ATTEMPTS
    ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString()
    : rec?.locked_until || null;
  await db.collection('login_attempts').updateOne(
    { email },
    { $set: { count, last_attempt: new Date().toISOString(), locked_until } },
    { upsert: true }
  );
}

async function clearLoginAttempts(db, email) {
  await db.collection('login_attempts').deleteOne({ email });
}

function validatePasswordStrength(password) {
  if (!password || password.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter';
  if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one number';
  return null;
}

function sanitizeString(val) {
  if (typeof val !== 'string') return val;
  return val
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
    .trim();
}

function sanitizeBody(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = typeof v === 'string' ? sanitizeString(v) : v;
  }
  return out;
}

// ---- Session helpers ----
async function createSession(db, user, token, request) {
  const id = uuidv4();
  const tokenHash = createHmac('sha256', process.env.JWT_SECRET || 'mahaz-secret-2024').update(token).digest('hex');
  const ua = request.headers.get('user-agent') || 'Unknown';
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'Unknown';
  const now = new Date().toISOString();
  await db.collection('sessions').insertOne({ id, user_id: user.id, token_hash: tokenHash, created_at: now, last_active: now, user_agent: ua, ip });
  return id;
}

function touchSession(db, sessionId) {
  if (!sessionId) return;
  db.collection('sessions').updateOne({ id: sessionId }, { $set: { last_active: new Date().toISOString() } }).catch(() => {});
}

// ---- API key auth helper ----
const API_KEY_PREFIX = 'mhz_';
const API_KEY_HASH_SALT = process.env.API_KEY_SALT || 'mahaz-apikey-salt-2024';

function hashApiKey(key) {
  return createHmac('sha256', API_KEY_HASH_SALT).update(key).digest('hex');
}

function generateApiKey() {
  return API_KEY_PREFIX + randomBytes(32).toString('hex');
}

async function getAuthUser(request, db) {
  // 1. Try JWT
  const jwtUser = getUserFromRequest(request);
  if (jwtUser) return jwtUser;

  // 2. Try API key from X-API-Key header or "ApiKey <key>" Authorization
  const authHeader = request.headers.get('authorization') || '';
  const xApiKey = request.headers.get('x-api-key') || '';
  const rawKey = xApiKey || (authHeader.toLowerCase().startsWith('apikey ') ? authHeader.slice(7).trim() : '');

  if (!rawKey.startsWith(API_KEY_PREFIX)) return null;

  const keyHash = hashApiKey(rawKey);
  const keyRecord = await db.collection('api_keys').findOne({ key_hash: keyHash });
  if (!keyRecord) return null;
  if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) return null;

  // Update last_used async
  db.collection('api_keys').updateOne({ id: keyRecord.id }, { $set: { last_used: new Date().toISOString() } }).catch(() => {});

  const dbUser = await db.collection('users').findOne({ id: keyRecord.user_id });
  if (!dbUser) return null;
  return { id: dbUser.id, email: dbUser.email, role: dbUser.role, name: dbUser.name, via_api_key: true, api_key_id: keyRecord.id, api_key_scopes: keyRecord.scopes || [] };
}

const TOTP_HMAC_KEY = process.env.JWT_SECRET || 'mahaz-secret-2024';

function generateTotpSession(userId) {
  const exp = Date.now() + 5 * 60 * 1000;
  const payload = `${userId}|${exp}`;
  const sig = createHmac('sha256', TOTP_HMAC_KEY).update(payload).digest('hex');
  return Buffer.from(`${payload}|${sig}`).toString('base64url');
}

function verifyTotpSession(token) {
  try {
    const decoded = Buffer.from(token, 'base64url').toString();
    const parts = decoded.split('|');
    if (parts.length !== 3) return null;
    const [userId, expStr, sig] = parts;
    const payload = `${userId}|${expStr}`;
    const expected = createHmac('sha256', TOTP_HMAC_KEY).update(payload).digest('hex');
    if (sig !== expected) return null;
    if (Date.now() > parseInt(expStr)) return null;
    return userId;
  } catch { return null; }
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return NextResponse.json(data, { status, headers: corsHeaders });
}

function error(message, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: corsHeaders });
}

// Audit log helper
async function logAudit(db, userId, action, entity, entityId, details = {}) {
  await db.collection('audit_logs').insertOne({
    id: uuidv4(),
    user_id: userId,
    action,
    entity,
    entity_id: entityId,
    details,
    timestamp: new Date().toISOString()
  });
}

// Activity log helper (per asset)
async function logActivity(db, assetId, action, details, userId, userName) {
  await db.collection('activity_logs').insertOne({
    id: uuidv4(),
    asset_id: assetId,
    action,
    details,
    user_id: userId,
    user_name: userName,
    timestamp: new Date().toISOString()
  });
}

// Asset audit checklist defaults
const DEFAULT_CHECKLIST = [
  'Device powers on correctly',
  'Screen / display has no damage',
  'Keyboard and trackpad functional (laptops)',
  'All ports functional (USB, HDMI, etc.)',
  'Battery health acceptable (laptops)',
  'No physical damage or cracks',
  'Asset tag / label present and readable',
  'Operating system up to date',
  'Antivirus / security software active',
  'No unauthorized software installed',
  'Data backup confirmed',
  'Assigned to correct employee',
  'Location matches records',
  'Accessories present (charger, case, etc.)'
];

async function runAuditSchedule(db) {
  try {
    const todayStr = new Date().toISOString().split('T')[0];
    const twoMonthsAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const storableCats = await db.collection('categories').find({ category_type: 'STORABLE' }).toArray();
    const catIds = storableCats.map(c => c.id);
    const physicalAssets = await db.collection('assets').find({
      category: { $in: catIds }, archived: { $ne: true }, status: { $nin: ['Scrapped'] }
    }).toArray();
    for (const asset of physicalAssets) {
      const pending = await db.collection('assetAudits').findOne({ assetId: asset.id, status: { $in: ['scheduled', 'overdue'] } });
      if (pending) continue;
      const lastAudit = await db.collection('assetAudits').findOne(
        { assetId: asset.id, status: 'completed' },
        { sort: { conductedDate: -1 } }
      );
      const needsAudit = !lastAudit || (lastAudit.conductedDate || '') < twoMonthsAgo;
      if (needsAudit) {
        await db.collection('assetAudits').insertOne({
          id: uuidv4(), assetId: asset.id, employeeId: asset.assigned_to || null,
          conductedBy: null, scheduledDate: todayStr, conductedDate: null,
          status: 'scheduled', result: null,
          checklist: DEFAULT_CHECKLIST.map(item => ({ item, status: 'na', notes: '' })),
          overallNotes: '', followUpRequired: false, followUpNotes: '', attachments: [],
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        });
      }
    }
    // Mark overdue: scheduled but date has passed
    await db.collection('assetAudits').updateMany(
      { status: 'scheduled', scheduledDate: { $lt: todayStr } },
      { $set: { status: 'overdue', updatedAt: new Date().toISOString() } }
    );
  } catch (e) { console.error('Audit schedule error:', e); }
}

// Warranty status calculator
function getWarrantyStatus(warrantyApplicable, warrantyEndDate) {
  if (warrantyApplicable === 'N-A' || warrantyApplicable === 'No') return 'N/A';
  if (!warrantyEndDate) return 'N/A';
  const endDate = new Date(warrantyEndDate);
  const today = new Date();
  return endDate >= today ? 'Active' : 'Expired';
}

// Expiry status calculator
function getExpiryStatus(expiryDate) {
  if (!expiryDate) return 'N/A';
  const end = new Date(expiryDate);
  const today = new Date();
  return end >= today ? 'Active' : 'Expired';
}

// Check manager hierarchy to prevent circular reporting
async function checkManagerHierarchy(db, employeeId, newManagerId) {
  if (!newManagerId || employeeId === newManagerId) return false;
  
  // Get all employees this person manages (direct and indirect)
  const getAllSubordinates = async (empId, visited = new Set()) => {
    if (visited.has(empId)) return visited;
    visited.add(empId);
    
    const subordinates = await db.collection('employees').find({ manager_id: empId }).toArray();
    for (const sub of subordinates) {
      await getAllSubordinates(sub.id, visited);
    }
    return visited;
  };
  
  const subordinates = await getAllSubordinates(employeeId);
  return subordinates.has(newManagerId);
}

// Seed default admin and master data
async function seedAdmin(db) {
  // Only create default admin if NO users exist at all (fresh install)
  const userCount = await db.collection('users').countDocuments();
  if (userCount === 0) {
    await db.collection('users').insertOne({
      id: uuidv4(),
      email: 'admin',
      password: hashPassword('admin'),
      name: 'Super Admin',
      role: 'super_admin',
      is_default_password: true,
      created_at: new Date().toISOString()
    });
    console.log('Default admin created: admin/admin (CHANGE PASSWORD IMMEDIATELY!)');
  }
  
  // Seed default company if none exists
  const companyCount = await db.collection('companies').countDocuments();
  if (companyCount === 0) {
    await db.collection('companies').insertOne({
      id: uuidv4(),
      name: 'Default Company',
      code: 'DEFAULT',
      created_at: new Date().toISOString()
    });
  }

  // Seed default categories if none exist
  const catCount = await db.collection('categories').countDocuments();
  if (catCount === 0) {
    const seedCats = [
      { name: 'Laptop', category_type: 'STORABLE' },
      { name: 'Desktop', category_type: 'STORABLE' },
      { name: 'Monitor', category_type: 'STORABLE' },
      { name: 'Cloud Server', category_type: 'SUBSCRIPTION' },
      { name: 'VPN', category_type: 'SUBSCRIPTION' },
      { name: 'Cloud Storage', category_type: 'SUBSCRIPTION' },
      { name: 'IP Camera', category_type: 'STORABLE' },
      { name: 'Network Switch', category_type: 'STORABLE' },
      { name: 'Wireless AP', category_type: 'STORABLE' },
      { name: 'Router', category_type: 'STORABLE' },
      { name: 'IoT Sensor', category_type: 'STORABLE' },
    ];
    await db.collection('categories').insertMany(seedCats.map(c => ({
      id: uuidv4(), ...c, hasSpecs: computeHasSpecs(c.name), isIoT: computeIsIoT(c.name), created_at: new Date().toISOString()
    })));
  }

  // Purge sessions older than 7 days (fire and forget)
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  db.collection('sessions').deleteMany({ last_active: { $lt: cutoff } }).catch(() => {});
  // Purge stale login_attempts records older than 1 hour that aren't locked
  const attemptsCutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  db.collection('login_attempts').deleteMany({ last_attempt: { $lt: attemptsCutoff }, locked_until: null }).catch(() => {});
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

export async function GET(request, { params }) {
  const db = await getDb();
  await seedAdmin(db);
  
  const pathSegments = params.path || [];
  const route = pathSegments.join('/');
  const url = new URL(request.url);
  const user = await getAuthUser(request, db);

  // Health check
  if (route === 'health') {
    let dbStatus = 'disconnected';
    try {
      await db.admin().ping();
      dbStatus = 'connected';
    } catch (err) {
      console.error('Health check DB error:', err);
    }
    return json({ ok: true, db: dbStatus, app: 'Mahaz' });
  }

  // Auth check
  if (route === 'auth/me') {
    if (!user) return error('Unauthorized', 401);
    const dbUser = await db.collection('users').findOne({ id: user.id });
    if (!dbUser) return error('User not found', 404);
    return json({ id: dbUser.id, email: dbUser.email, name: dbUser.name, role: dbUser.role, is_default_password: dbUser.is_default_password || false });
  }

  // TOTP status
  if (route === 'auth/totp/status') {
    if (!user) return error('Unauthorized', 401);
    const dbUser = await db.collection('users').findOne({ id: user.id });
    return json({ totp_enabled: dbUser?.totp_enabled || false });
  }

  // API keys list
  if (route === 'auth/api-keys') {
    if (!user) return error('Unauthorized', 401);
    const keys = await db.collection('api_keys').find({ user_id: user.id }).sort({ created_at: -1 }).toArray();
    return json(keys.map(k => ({ id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes, created_at: k.created_at, last_used: k.last_used, expires_at: k.expires_at })));
  }

  // Active sessions for current user
  if (route === 'auth/sessions') {
    if (!user) return error('Unauthorized', 401);
    const currentSessionId = request.headers.get('x-session-id');
    const sessions = await db.collection('sessions').find({ user_id: user.id }).sort({ last_active: -1 }).toArray();
    return json(sessions.map(s => ({
      id: s.id,
      created_at: s.created_at,
      last_active: s.last_active,
      user_agent: s.user_agent,
      ip: s.ip,
      is_current: s.id === currentSessionId
    })));
  }

  // Protected routes require auth
  if (!user && !['health'].includes(route)) {
    return error('Unauthorized', 401);
  }

  // Update session last_active (fire and forget)
  touchSession(db, request.headers.get('x-session-id'));

  // ============ MASTER DATA ============
  
  // Companies
  if (route === 'companies') {
    try { return json(await db.collection('companies').find({}).toArray()); }
    catch { return json([]); }
  }

  // Projects
  if (route === 'projects') {
    try { return json(await db.collection('projects').find({}).toArray()); }
    catch { return json([]); }
  }

  // Locations
  if (route === 'locations') {
    try { return json(await db.collection('locations').find({}).toArray()); }
    catch { return json([]); }
  }

  // Departments
  if (route === 'departments') {
    try { return json(await db.collection('departments').find({}).toArray()); }
    catch { return json([]); }
  }

  // Extensions — GET list with optional filters
  if (route === 'extensions') {
    const { dept, location, permission } = Object.fromEntries(url.searchParams);
    const query = {};
    if (dept) query.departmentId = dept;
    if (location) query.locationId = location;
    if (permission) query.permission = permission;
    try { return json(await db.collection('extensions').find(query).sort({ extensionNumber: 1 }).toArray()); }
    catch { return json([]); }
  }

  // Categories (for assets) - GET
  if (route === 'categories') {
    try { return json(await db.collection('categories').find({}).toArray()); }
    catch { return json([]); }
  }
  
  // Reset categories to new list
  if (route === 'categories/reset') {
    if (user.role !== 'super_admin') return error('Forbidden', 403);
    
    // Delete all existing categories
    await db.collection('categories').deleteMany({});
    
    // Insert new IT asset categories
    const newCategories = [
      // Computing Devices
      { id: uuidv4(), name: 'Laptop', category_type: 'STORABLE', created_at: new Date().toISOString() },
      { id: uuidv4(), name: 'Desktop', category_type: 'STORABLE', created_at: new Date().toISOString() },
      { id: uuidv4(), name: 'Tablet', category_type: 'STORABLE', created_at: new Date().toISOString() },
      { id: uuidv4(), name: 'Server', category_type: 'STORABLE', created_at: new Date().toISOString() },
      { id: uuidv4(), name: 'Workstation', category_type: 'STORABLE', created_at: new Date().toISOString() },
      { id: uuidv4(), name: 'Thin Client', category_type: 'STORABLE', created_at: new Date().toISOString() },
      
      // Networking Equipment
      { id: uuidv4(), name: 'Switch', category_type: 'STORABLE', created_at: new Date().toISOString() },
      { id: uuidv4(), name: 'Router', category_type: 'STORABLE', created_at: new Date().toISOString() },
      { id: uuidv4(), name: 'Firewall', category_type: 'STORABLE', created_at: new Date().toISOString() },
      { id: uuidv4(), name: 'Access Point', category_type: 'STORABLE', created_at: new Date().toISOString() },
      { id: uuidv4(), name: 'Modem', category_type: 'STORABLE', created_at: new Date().toISOString() },
      { id: uuidv4(), name: 'Patch Panel', category_type: 'STORABLE', created_at: new Date().toISOString() },
      
      // Peripherals & Accessories
      { id: uuidv4(), name: 'Monitor', category_type: 'STORABLE', created_at: new Date().toISOString() },
      { id: uuidv4(), name: 'Keyboard', category_type: 'STORABLE', created_at: new Date().toISOString() },
      { id: uuidv4(), name: 'Mouse', category_type: 'STORABLE', created_at: new Date().toISOString() },
      { id: uuidv4(), name: 'Docking Station', category_type: 'STORABLE', created_at: new Date().toISOString() },
      { id: uuidv4(), name: 'Headset', category_type: 'STORABLE', created_at: new Date().toISOString() },
      { id: uuidv4(), name: 'Webcam', category_type: 'STORABLE', created_at: new Date().toISOString() },
      { id: uuidv4(), name: 'External Hard Drive', category_type: 'STORABLE', created_at: new Date().toISOString() },
      
      // Imaging & Printing
      { id: uuidv4(), name: 'Camera (CCTV/Security)', category_type: 'STORABLE', created_at: new Date().toISOString() },
      { id: uuidv4(), name: 'Printer', category_type: 'STORABLE', created_at: new Date().toISOString() },
      { id: uuidv4(), name: 'Scanner', category_type: 'STORABLE', created_at: new Date().toISOString() },
      { id: uuidv4(), name: 'Photocopier', category_type: 'STORABLE', created_at: new Date().toISOString() },
      { id: uuidv4(), name: 'Projector', category_type: 'STORABLE', created_at: new Date().toISOString() },
      
      // Communication
      { id: uuidv4(), name: 'Smartphone', category_type: 'STORABLE', created_at: new Date().toISOString() },
      { id: uuidv4(), name: 'IP Phone', category_type: 'STORABLE', created_at: new Date().toISOString() },
      { id: uuidv4(), name: 'SIM Card', category_type: 'CONSUMABLE', created_at: new Date().toISOString() },
      
      // Infrastructure & Power
      { id: uuidv4(), name: 'UPS (Battery Backup)', category_type: 'STORABLE', created_at: new Date().toISOString() },
      { id: uuidv4(), name: 'PDU (Power Distribution Unit)', category_type: 'STORABLE', created_at: new Date().toISOString() },
      { id: uuidv4(), name: 'Server Rack', category_type: 'STORABLE', created_at: new Date().toISOString() },
      { id: uuidv4(), name: 'KVM Switch', category_type: 'STORABLE', created_at: new Date().toISOString() },
      
      // Software & Subscription
      { id: uuidv4(), name: 'Software License / Subscription', category_type: 'SUBSCRIPTION', created_at: new Date().toISOString() },
    ];
    
    await db.collection('categories').insertMany(newCategories);
    await logAudit(db, user.id, 'RESET', 'categories', 'all', { count: newCategories.length });
    
    return json({ success: true, count: newCategories.length, categories: newCategories });
  }

  // ============ DASHBOARD ============

  if (route === 'dashboard/charts') {
    const baseMatch = { archived: { $ne: true }, status: { $ne: 'Scrapped' } };

    // Assets by status
    const statusAgg = await db.collection('assets').aggregate([
      { $match: baseMatch },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray();

    // Assets by category (top 8)
    const categoryAgg = await db.collection('assets').aggregate([
      { $match: baseMatch },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 8 }
    ]).toArray();
    const categories = await db.collection('categories').find({}).toArray();
    const catMap = Object.fromEntries(categories.map(c => [c.id, c.name]));

    // Assets by location (top 6)
    const locationAgg = await db.collection('assets').aggregate([
      { $match: { ...baseMatch, location_id: { $ne: null } } },
      { $group: { _id: '$location_id', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 6 }
    ]).toArray();
    const locations = await db.collection('locations').find({}).toArray();
    const locMap = Object.fromEntries(locations.map(l => [l.id, l.name]));

    // Monthly additions (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);
    const monthlyAgg = await db.collection('assets').aggregate([
      { $match: { created_at: { $gte: sixMonthsAgo.toISOString() } } },
      { $group: { _id: { $substr: ['$created_at', 0, 7] }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]).toArray();

    // Summary counts
    const [totalEmployees, scrappedCount, renewalsDue] = await Promise.all([
      db.collection('employees').countDocuments({ archived: { $ne: true }, status: { $nin: ['Resigned'] } }),
      db.collection('assets').countDocuments({ status: 'Scrapped' }),
      db.collection('assets').countDocuments({
        renewal_date: {
          $lte: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
          $gte: new Date().toISOString().split('T')[0]
        },
        archived: { $ne: true }
      })
    ]);

    return json({
      status_breakdown: statusAgg.map(s => ({ status: s._id || 'Unknown', count: s.count })),
      category_breakdown: categoryAgg.map(c => ({ name: catMap[c._id] || c._id || 'Other', count: c.count })),
      location_breakdown: locationAgg.map(l => ({ name: locMap[l._id] || 'Unknown', count: l.count })),
      monthly_additions: monthlyAgg.map(m => ({ month: m._id, count: m.count })),
      total_employees: totalEmployees,
      scrapped_assets: scrappedCount,
      renewals_due: renewalsDue
    });
  }

  // Bills due this week widget data
  if (route === 'dashboard/bills') {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const sevenDaysOut = new Date(today.getTime() + 7 * 86400000).toISOString().split('T')[0];
    const assets = await db.collection('assets').find({
      renewal_date: { $lte: sevenDaysOut, $gte: todayStr },
      archived: { $ne: true },
      status: { $ne: 'Scrapped' }
    }).sort({ renewal_date: 1 }).toArray();
    const categories = await db.collection('categories').find({}).toArray();
    const catMap = Object.fromEntries(categories.map(c => [c.id, c]));
    const bills = assets.map(a => {
      const diffMs = new Date(a.renewal_date).getTime() - today.setHours(0,0,0,0);
      const daysLeft = Math.ceil(diffMs / 86400000);
      return {
        id: a.id,
        asset_tag: a.asset_tag,
        brand: a.brand || '',
        vendor_name: a.vendor_name || '',
        provider_url: a.provider_url || '',
        renewal_date: a.renewal_date,
        days_left: daysLeft,
        category_type: catMap[a.category]?.category_type || '',
        is_addon: false
      };
    });
    // Also include active addon renewals due this week
    const assetsWithAddonBills = await db.collection('assets').find({
      archived: { $ne: true },
      status: { $ne: 'Scrapped' }
    }, { projection: { id: 1, asset_tag: 1, brand: 1, addons: 1 } }).toArray();
    for (const a of assetsWithAddonBills) {
      for (const addon of (a.addons || [])) {
        if (addon.status !== 'active' || !addon.renewalDate) continue;
        if (addon.renewalDate > sevenDaysOut || addon.renewalDate < todayStr) continue;
        const diffMs = new Date(addon.renewalDate).getTime() - today.setHours(0,0,0,0);
        bills.push({
          id: `addon_${a.id}_${addon.id}`,
          asset_tag: `${a.asset_tag} — ${addon.name}`,
          brand: addon.provider || '',
          vendor_name: addon.provider || '',
          provider_url: '',
          renewal_date: addon.renewalDate,
          days_left: Math.ceil(diffMs / 86400000),
          category_type: 'ADDON',
          is_addon: true
        });
      }
    }
    bills.sort((a, b) => a.renewal_date > b.renewal_date ? 1 : -1);
    return json(bills);
  }

  if (route === 'dashboard/stats') {
    const totalAssets = await db.collection('assets').countDocuments({ 
      archived: { $ne: true },
      status: { $ne: 'Scrapped' } 
    });
    const assignedAssets = await db.collection('assets').countDocuments({ 
      archived: { $ne: true },
      status: { $in: ['Assigned', 'Temporarily Assigned', 'Handed Over (Vacation Coverage)'] } 
    });
    const inStockAssets = await db.collection('assets').countDocuments({ 
      archived: { $ne: true },
      status: 'In Stock' 
    });
    const inMaintenance = await db.collection('assets').countDocuments({ 
      archived: { $ne: true },
      status: 'In Maintenance' 
    });
    const onVacation = await db.collection('employees').countDocuments({ 
      archived: { $ne: true },
      status: 'On Vacation' 
    });
    
    const auditsDue = await db.collection('assetAudits').countDocuments({ status: { $in: ['scheduled', 'overdue'] } });
    const remoteWorkAssets = await db.collection('vacation_handovers').countDocuments({ handoverType: 'remote', status: 'active' });
    const vacationAssets = await db.collection('vacation_handovers').countDocuments({ status: 'active' });
    return json({
      total_assets: totalAssets,
      assigned_assets: assignedAssets,
      in_stock_assets: inStockAssets,
      in_maintenance: inMaintenance,
      employees_on_vacation: onVacation,
      vacation_assets: vacationAssets,
      remote_work_assets: remoteWorkAssets,
      audits_due: auditsDue
    });
  }

  // Dashboard notifications (Global - for managers and admins)
  if (route === 'dashboard/notifications') {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const notifications = [];

    // Helper: days until a date string (negative = overdue)
    const daysUntil = (dateStr) => {
      if (!dateStr) return null;
      const diff = new Date(dateStr).getTime() - today.getTime();
      return Math.ceil(diff / (1000 * 60 * 60 * 24));
    };
    const priority = (days) => (days !== null && days <= 3) ? 'high' : 'medium';

    // Vacation ended - assets pending reassignment
    const vacationEnded = await db.collection('employees').find({
      status: 'On Vacation',
      vacation_end_date: { $lte: todayStr },
      archived: { $ne: true }
    }).toArray();

    for (const emp of vacationEnded) {
      notifications.push({
        id: `vacation_${emp.id}`,
        type: 'vacation_ended',
        message: `${emp.name}'s vacation ended. Assets pending reassignment.`,
        employee_id: emp.id,
        employee_name: emp.name,
        priority: 'high',
        days_until: 0,
        created_at: emp.vacation_end_date
      });
    }

    const sevenDaysFromNow = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Warranty expiry approaching (within 7 days) - exclude archived
    const warrantyExpiring = await db.collection('assets').find({
      warranty_applicable: 'Yes',
      warranty_end_date: { $lte: sevenDaysFromNow, $gte: todayStr },
      archived: { $ne: true },
      status: { $nin: ['Scrapped', 'Canceled'] }
    }).toArray();

    for (const asset of warrantyExpiring) {
      const d = daysUntil(asset.warranty_end_date);
      notifications.push({
        id: `warranty_${asset.id}`,
        type: 'warranty_expiry',
        message: `${asset.asset_tag} warranty expires on ${asset.warranty_end_date}`,
        asset_id: asset.id,
        asset_tag: asset.asset_tag,
        expiry_date: asset.warranty_end_date,
        priority: priority(d),
        days_until: d,
        created_at: todayStr
      });
    }

    // Digital asset expiry approaching (within 7 days) - exclude archived
    const expiringAssets = await db.collection('assets').find({
      expiry_date: { $lte: sevenDaysFromNow, $gte: todayStr },
      archived: { $ne: true },
      status: { $nin: ['Scrapped', 'Canceled'] }
    }).toArray();

    for (const asset of expiringAssets) {
      const d = daysUntil(asset.expiry_date);
      notifications.push({
        id: `expiry_${asset.id}`,
        type: 'expiry_approaching',
        message: `${asset.asset_tag} expires on ${asset.expiry_date}`,
        asset_id: asset.id,
        asset_tag: asset.asset_tag,
        expiry_date: asset.expiry_date,
        priority: priority(d),
        days_until: d,
        created_at: todayStr
      });
    }

    // Renewal date approaching (within 7 days) - exclude archived
    const renewalApproaching = await db.collection('assets').find({
      renewal_date: { $lte: sevenDaysFromNow, $gte: todayStr },
      archived: { $ne: true },
      status: { $nin: ['Scrapped', 'Canceled'] }
    }).toArray();

    for (const asset of renewalApproaching) {
      const d = daysUntil(asset.renewal_date);
      notifications.push({
        id: `renewal_${asset.id}`,
        type: 'renewal_approaching',
        message: `${asset.asset_tag} renewal due on ${asset.renewal_date}`,
        asset_id: asset.id,
        asset_tag: asset.asset_tag,
        renewal_date: asset.renewal_date,
        priority: priority(d),
        days_until: d,
        created_at: todayStr
      });
    }

    // Addon renewals within 7 days
    const assetsWithAddons = await db.collection('assets').find({
      'addons.renewalDate': { $lte: sevenDaysFromNow, $gte: todayStr },
      'addons.status': 'active',
      archived: { $ne: true }
    }).toArray();
    for (const asset of assetsWithAddons) {
      for (const addon of (asset.addons || [])) {
        if (addon.status !== 'active' || !addon.renewalDate) continue;
        if (addon.renewalDate > sevenDaysFromNow || addon.renewalDate < todayStr) continue;
        const d = daysUntil(addon.renewalDate);
        notifications.push({
          id: `addon_${asset.id}_${addon.id}`,
          type: 'addon_renewal',
          message: `${asset.asset_tag} — ${addon.name} renews in ${d === 0 ? 'today' : d + ' day' + (d === 1 ? '' : 's')}`,
          asset_id: asset.id,
          asset_tag: asset.asset_tag,
          addon_name: addon.name,
          renewal_date: addon.renewalDate,
          priority: priority(d),
          days_until: d,
          created_at: todayStr
        });
      }
    }

    // Maintenance assets that need attention
    const maintenanceRecords = await db.collection('maintenance').find({
      status: 'in_progress'
    }).toArray();

    for (const maint of maintenanceRecords) {
      const asset = await db.collection('assets').findOne({ id: maint.asset_id });
      if (asset && !asset.archived) {
        notifications.push({
          id: `maintenance_${maint.id}`,
          type: 'maintenance_pending',
          message: `${asset.asset_tag} in maintenance - pending completion`,
          asset_id: asset.id,
          asset_tag: asset.asset_tag,
          maintenance_id: maint.id,
          priority: 'medium',
          days_until: null,
          created_at: maint.date
        });
      }
    }

    // Overdue asset audits
    const overdueAudits = await db.collection('assetAudits').find({ status: 'overdue' }).toArray();
    const assetMap = {};
    for (const audit of overdueAudits) {
      if (!assetMap[audit.assetId]) {
        const a = await db.collection('assets').findOne({ id: audit.assetId });
        if (a) assetMap[audit.assetId] = a;
      }
      const a = assetMap[audit.assetId];
      if (a && !a.archived) {
        notifications.push({
          id: `audit_overdue_${audit.id}`,
          type: 'audit_overdue',
          message: `${a.asset_tag} audit overdue since ${audit.scheduledDate}`,
          asset_id: a.id,
          asset_tag: a.asset_tag,
          audit_id: audit.id,
          priority: 'high',
          days_until: null,
          created_at: audit.scheduledDate
        });
      }
    }

    // Sort: high priority first, then by days_until ascending
    notifications.sort((a, b) => {
      if (a.priority === 'high' && b.priority !== 'high') return -1;
      if (b.priority === 'high' && a.priority !== 'high') return 1;
      if (a.days_until !== null && b.days_until !== null) return a.days_until - b.days_until;
      return 0;
    });

    return json(notifications);
  }
  
  // Company assigned assets
  if (route === 'dashboard/company-assets') {
    const companyAssets = await db.collection('assets').find({
      assigned_to: 'company',
      archived: { $ne: true },
      status: { $nin: ['Scrapped', 'Canceled'] }
    }).toArray();
    
    const categories = await db.collection('categories').find({}).toArray();
    const categoryMap = Object.fromEntries(categories.map(c => [c.id, c]));
    
    const assetsWithDetails = companyAssets.map(a => ({
      ...a,
      category_name: categoryMap[a.category]?.name || a.category,
      category_type: categoryMap[a.category]?.category_type || '',
      warranty_status: getWarrantyStatus(a.warranty_applicable, a.warranty_end_date),
      expiry_status: getExpiryStatus(a.expiry_date)
    }));
    
    return json(assetsWithDetails);
  }

  // Stock breakdown
  if (route === 'dashboard/stock') {
    const physicalCategories = ['Server', 'Laptop', 'Desktop', 'Monitor', 'Printer', 'Keyboard', 'Mouse', 'Other'];
    const stock = {};
    
    for (const cat of physicalCategories) {
      stock[cat] = await db.collection('assets').countDocuments({ 
        status: 'In Stock', 
        category: cat 
      });
    }
    
    stock['Consumables'] = await db.collection('assets').countDocuments({ 
      status: 'In Stock', 
      asset_type: 'Consumable'
    });
    
    return json(stock);
  }

  // ============ USERS ============
  
  if (route === 'users') {
    if (user.role !== 'super_admin') return error('Forbidden', 403);
    const users = await db.collection('users').find({}, { projection: { password: 0 } }).toArray();
    return json(users);
  }

  // ============ FILTERS (Master Data for dropdowns) ============
  
  if (route === 'filters') {
    const companies = await db.collection('companies').find({}).toArray();
    const projects = await db.collection('projects').find({}).toArray();
    const locations = await db.collection('locations').find({}).toArray();
    const departments = await db.collection('departments').find({}).toArray();
    const employees = await db.collection('employees').find({}).toArray();
    
    return json({ 
      companies: companies.map(c => ({ id: c.id, name: c.name })),
      projects: projects.map(p => ({ id: p.id, name: p.name })),
      locations: locations.map(l => ({ id: l.id, name: l.name })),
      departments: departments.map(d => ({ id: d.id, name: d.name })),
      managers: employees.map(e => ({ id: e.id, name: e.name }))
    });
  }

  // ============ EMPLOYEES ============
  
  if (route === 'employees') {
    const filter = {};
    const company_id = url.searchParams.get('company_id');
    const project_id = url.searchParams.get('project_id');
    const location_id = url.searchParams.get('location_id');
    const department_id = url.searchParams.get('department_id');
    const status = url.searchParams.get('status');
    const search = url.searchParams.get('search');
    const archived = url.searchParams.get('archived'); // New archived filter
    
    if (company_id) filter.company_id = company_id;
    if (project_id) filter.project_id = project_id;
    if (location_id) filter.location_id = location_id;
    if (department_id) filter.department_id = department_id;
    if (status) filter.status = status;
    
    // Handle archived filter
    if (archived === 'true') {
      filter.archived = true;
    } else {
      filter.archived = { $ne: true }; // Default: exclude archived
    }
    
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { employee_id: { $regex: search, $options: 'i' } }
      ];
    }
    
    const employees = await db.collection('employees').find(filter).toArray();
    
    // Get asset count for each employee
    const employeeIds = employees.map(e => e.id);
    const assignments = await db.collection('assignments').find({
      employee_id: { $in: employeeIds },
      unassigned_date: null
    }).toArray();
    
    const assetCounts = {};
    assignments.forEach(a => {
      assetCounts[a.employee_id] = (assetCounts[a.employee_id] || 0) + 1;
    });
    
    // Enrich with master data names
    const companies = await db.collection('companies').find({}).toArray();
    const projects = await db.collection('projects').find({}).toArray();
    const locations = await db.collection('locations').find({}).toArray();
    const departments = await db.collection('departments').find({}).toArray();
    
    const companyMap = Object.fromEntries(companies.map(c => [c.id, c.name]));
    const projectMap = Object.fromEntries(projects.map(p => [p.id, p.name]));
    const locationMap = Object.fromEntries(locations.map(l => [l.id, l.name]));
    const departmentMap = Object.fromEntries(departments.map(d => [d.id, d.name]));
    const employeeMap = Object.fromEntries(employees.map(e => [e.id, e.name]));
    
    const enrichedEmployees = employees.map(e => ({
      ...e,
      asset_count: assetCounts[e.id] || 0,
      company_name: companyMap[e.company_id] || '',
      project_name: projectMap[e.project_id] || '',
      location_name: locationMap[e.location_id] || '',
      department_name: departmentMap[e.department_id] || '',
      manager_name: employeeMap[e.manager_id] || ''
    }));
    
    return json(enrichedEmployees);
  }

  if (route.startsWith('employees/') && pathSegments.length === 2) {
    const empId = pathSegments[1];
    const employee = await db.collection('employees').findOne({ id: empId });
    if (!employee) return error('Employee not found', 404);
    
    // Get assigned assets
    const assignments = await db.collection('assignments').find({ 
      employee_id: empId, 
      unassigned_date: null 
    }).toArray();
    
    const assetIds = assignments.map(a => a.asset_id);
    const assets = assetIds.length > 0 
      ? await db.collection('assets').find({ id: { $in: assetIds } }).toArray()
      : [];
    
    // Add warranty status + category name to each asset
    const catIds = [...new Set(assets.map(a => a.category).filter(Boolean))];
    const cats = catIds.length > 0 ? await db.collection('categories').find({ id: { $in: catIds } }).toArray() : [];
    const catMap = Object.fromEntries(cats.map(c => [c.id, c]));
    const assetsWithStatus = assets.map(a => ({
      ...a,
      category_name: catMap[a.category]?.name || a.category || '',
      warranty_status: getWarrantyStatus(a.warranty_applicable, a.warranty_end_date),
      expiry_status: getExpiryStatus(a.expiry_date)
    }));
    
    // Get assignment history
    const assignmentHistory = await db.collection('assignments')
      .find({ employee_id: empId })
      .sort({ assigned_date: -1 })
      .toArray();
    
    // Enrich assignment history with asset info
    const allAssetIds = [...new Set(assignmentHistory.map(a => a.asset_id))];
    const allAssets = allAssetIds.length > 0
      ? await db.collection('assets').find({ id: { $in: allAssetIds } }).toArray()
      : [];
    const assetMap = Object.fromEntries(allAssets.map(a => [a.id, a]));
    
    const enrichedHistory = assignmentHistory.map(a => ({
      ...a,
      asset_tag: assetMap[a.asset_id]?.asset_tag || '',
      asset_category: assetMap[a.asset_id]?.category || ''
    }));
    
    // Get master data names
    const [company, project, location, department, manager] = await Promise.all([
      employee.company_id ? db.collection('companies').findOne({ id: employee.company_id }) : null,
      employee.project_id ? db.collection('projects').findOne({ id: employee.project_id }) : null,
      employee.location_id ? db.collection('locations').findOne({ id: employee.location_id }) : null,
      employee.department_id ? db.collection('departments').findOne({ id: employee.department_id }) : null,
      employee.manager_id ? db.collection('employees').findOne({ id: employee.manager_id }) : null
    ]);
    
    return json({ 
      ...employee, 
      assigned_assets: assetsWithStatus,
      assignment_history: enrichedHistory,
      company_name: company?.name || '',
      project_name: project?.name || '',
      location_name: location?.name || '',
      department_name: department?.name || '',
      manager_name: manager?.name || ''
    });
  }

  // ============ ASSETS ============
  
  if (route === 'assets') {
    const filter = {};
    const status = url.searchParams.get('status');
    const category = url.searchParams.get('category');
    const category_type = url.searchParams.get('category_type'); // New: filter by STORABLE/CONSUMABLE/SUBSCRIPTION
    const asset_type = url.searchParams.get('asset_type');
    const company_id = url.searchParams.get('company_id');
    const project_id = url.searchParams.get('project_id');
    const location_id = url.searchParams.get('location_id');
    const department_id = url.searchParams.get('department_id');
    const search = url.searchParams.get('search');
    const archived = url.searchParams.get('archived'); // New archived filter
    
    if (status) filter.status = status;
    if (category) filter.category = category;
    if (asset_type) filter.asset_type = asset_type;
    if (company_id) filter.company_id = company_id;
    if (project_id) filter.project_id = project_id;
    if (location_id) filter.location_id = location_id;
    if (department_id) filter.department_id = department_id;
    
    // Handle archived filter
    if (archived === 'true') {
      filter.archived = true;
    } else {
      filter.archived = { $ne: true }; // Default: exclude archived
    }
    
    if (search) {
      filter.$or = [
        { asset_tag: { $regex: search, $options: 'i' } },
        { serial_number: { $regex: search, $options: 'i' } }
      ];
    }
    
    const assets = await db.collection('assets').find(filter).toArray();
    
    // Get categories to filter by category_type
    const categories = await db.collection('categories').find({}).toArray();
    const categoryMap = Object.fromEntries(categories.map(c => [c.id, c]));
    
    // Filter by category_type if specified
    let filteredAssets = assets;
    if (category_type) {
      filteredAssets = assets.filter(a => {
        const cat = categoryMap[a.category];
        return cat && cat.category_type === category_type;
      });
    }
    
    // Get employee names for assigned assets
    const employeeIds = [...new Set(filteredAssets.map(a => a.assigned_to).filter(id => id && id !== 'company'))];
    const employees = employeeIds.length > 0 
      ? await db.collection('employees').find({ id: { $in: employeeIds } }).toArray()
      : [];
    const employeeMap = Object.fromEntries(employees.map(e => [e.id, e]));
    
    // Get master data
    const [projects, locations] = await Promise.all([
      db.collection('projects').find({}).toArray(),
      db.collection('locations').find({}).toArray()
    ]);
    const projectMap = Object.fromEntries(projects.map(p => [p.id, p.name]));
    const locationMap = Object.fromEntries(locations.map(l => [l.id, l.name]));
    
    const assetsWithDetails = filteredAssets.map(a => ({
      ...a,
      assigned_to_name: a.assigned_to ? (a.assigned_to === 'company' ? 'Company' : employeeMap[a.assigned_to]?.name || '') : '',
      warranty_status: getWarrantyStatus(a.warranty_applicable, a.warranty_end_date),
      expiry_status: getExpiryStatus(a.expiry_date),
      project_name: projectMap[a.project_id] || '',
      location_name: locationMap[a.location_id] || '',
      category_name: categoryMap[a.category]?.name || a.category,
      category_type: categoryMap[a.category]?.category_type || '',
      isIoT: !!(categoryMap[a.category]?.isIoT)
    }));
    
    return json(assetsWithDetails);
  }

  // Unassigned assets (In Stock)
  if (route === 'assets/unassigned') {
    const assets = await db.collection('assets').find({ status: 'In Stock', archived: { $ne: true } }).toArray();
    const [categories, locations] = await Promise.all([
      db.collection('categories').find({}).toArray(),
      db.collection('locations').find({}).toArray()
    ]);
    const categoryMap = Object.fromEntries(categories.map(c => [c.id, c]));
    const locationMap = Object.fromEntries(locations.map(l => [l.id, l.name]));
    return json(assets.map(a => ({
      ...a,
      category_name: categoryMap[a.category]?.name || a.category || '',
      category_type: categoryMap[a.category]?.category_type || a.category_type || '',
      location_name: locationMap[a.location_id] || ''
    })));
  }

  // Single asset with activity log
  if (route.startsWith('assets/') && pathSegments.length === 2) {
    const assetId = pathSegments[1];
    const asset = await db.collection('assets').findOne({ id: assetId });
    if (!asset) return error('Asset not found', 404);
    
    // Get activity log
    const activityLog = await db.collection('activity_logs')
      .find({ asset_id: assetId })
      .sort({ timestamp: -1 })
      .toArray();
    
    // Get current assignment
    const assignment = await db.collection('assignments').findOne({ 
      asset_id: assetId, 
      unassigned_date: null 
    });
    
    let assignedEmployee = null;
    if (assignment && assignment.employee_id !== 'company') {
      assignedEmployee = await db.collection('employees').findOne({ id: assignment.employee_id });
    }
    
    // Get master data names
    const [company, project, location, department, categoryDoc] = await Promise.all([
      asset.company_id ? db.collection('companies').findOne({ id: asset.company_id }) : null,
      asset.project_id ? db.collection('projects').findOne({ id: asset.project_id }) : null,
      asset.location_id ? db.collection('locations').findOne({ id: asset.location_id }) : null,
      asset.department_id ? db.collection('departments').findOne({ id: asset.department_id }) : null,
      asset.category ? db.collection('categories').findOne({ id: asset.category }) : null
    ]);

    return json({
      ...asset,
      warranty_status: getWarrantyStatus(asset.warranty_applicable, asset.warranty_end_date),
      expiry_status: getExpiryStatus(asset.expiry_date),
      activity_log: activityLog,
      current_assignment: assignment,
      assigned_employee: assignedEmployee,
      company_name: company?.name || '',
      project_name: project?.name || '',
      location_name: location?.name || '',
      department_name: department?.name || '',
      category_name: categoryDoc?.name || asset.category || '',
      category_type: asset.category_type || categoryDoc?.category_type || ''
    });
  }

  // ============ ASSIGNMENTS ============
  
  if (route === 'assignments') {
    const filter = {};
    const company_id = url.searchParams.get('company_id');
    const project_id = url.searchParams.get('project_id');
    const location_id = url.searchParams.get('location_id');
    const department_id = url.searchParams.get('department_id');
    const active_only = url.searchParams.get('active_only');
    
    if (active_only === 'true') filter.unassigned_date = null;
    
    const assignments = await db.collection('assignments').find(filter).toArray();
    
    // Enrich with employee and asset details
    const employeeIds = [...new Set(assignments.map(a => a.employee_id).filter(id => id && id !== 'company'))];
    const assetIds = [...new Set(assignments.map(a => a.asset_id))];
    
    const [employees, assets, projects, locations, categories] = await Promise.all([
      employeeIds.length > 0 ? db.collection('employees').find({ id: { $in: employeeIds } }).toArray() : [],
      assetIds.length > 0 ? db.collection('assets').find({ id: { $in: assetIds } }).toArray() : [],
      db.collection('projects').find({}).toArray(),
      db.collection('locations').find({}).toArray(),
      db.collection('categories').find({}).toArray()
    ]);
    
    const employeeMap = Object.fromEntries(employees.map(e => [e.id, e]));
    const assetMap = Object.fromEntries(assets.map(a => [a.id, a]));
    const projectMap = Object.fromEntries(projects.map(p => [p.id, p.name]));
    const locationMap = Object.fromEntries(locations.map(l => [l.id, l.name]));
    const categoryMap = Object.fromEntries(categories.map(c => [c.id, c]));
    
    let enrichedAssignments = assignments.map(a => {
      const asset = assetMap[a.asset_id];
      return {
        ...a,
        employee_name: a.employee_id === 'company' ? 'Company' : (employeeMap[a.employee_id]?.name || ''),
        asset_tag: asset?.asset_tag || '',
        asset_category: categoryMap[asset?.category]?.name || asset?.category_name || asset?.category || '',
        asset_category_type: categoryMap[asset?.category]?.category_type || asset?.category_type || '',
        asset_project_id: asset?.project_id || '',
        asset_location_id: asset?.location_id || '',
        project_name: projectMap[asset?.project_id] || '',
        location_name: locationMap[asset?.location_id] || ''
      };
    });
    
    // Apply filters based on asset's project/location
    if (company_id) {
      const companyAssetIds = assets.filter(a => a.company_id === company_id).map(a => a.id);
      enrichedAssignments = enrichedAssignments.filter(a => companyAssetIds.includes(a.asset_id));
    }
    if (project_id) {
      enrichedAssignments = enrichedAssignments.filter(a => a.asset_project_id === project_id);
    }
    if (location_id) {
      enrichedAssignments = enrichedAssignments.filter(a => a.asset_location_id === location_id);
    }
    
    return json(enrichedAssignments);
  }

  // ============ MAINTENANCE ============
  
  if (route === 'maintenance') {
    const records = await db.collection('maintenance').find({}).sort({ date: -1 }).toArray();
    return json(records);
  }

  // ============ AUDIT LOG ============

  if (route === 'audit') {
    if (!['super_admin', 'it_admin'].includes(user.role)) return error('Forbidden', 403);

    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
    const page = Math.max(parseInt(url.searchParams.get('page') || '1'), 1);
    const actionFilter = url.searchParams.get('action');
    const entityFilter = url.searchParams.get('entity');
    const userIdFilter = url.searchParams.get('user_id');
    const dateFrom = url.searchParams.get('date_from');
    const dateTo = url.searchParams.get('date_to');
    const q = url.searchParams.get('q');

    const filter = {};
    if (actionFilter) filter.action = actionFilter;
    if (entityFilter) filter.entity = entityFilter;
    if (userIdFilter) filter.user_id = userIdFilter;
    if (dateFrom || dateTo) {
      filter.timestamp = {};
      if (dateFrom) filter.timestamp.$gte = dateFrom;
      if (dateTo) filter.timestamp.$lte = dateTo + 'T23:59:59.999Z';
    }
    if (q) filter.$or = [
      { entity_id: { $regex: q, $options: 'i' } },
      { action: { $regex: q, $options: 'i' } }
    ];

    const total = await db.collection('audit_logs').countDocuments(filter);
    const skip = (page - 1) * limit;
    const logs = await db.collection('audit_logs').find(filter).sort({ timestamp: -1 }).skip(skip).limit(limit).toArray();

    const userIds = [...new Set(logs.map(l => l.user_id).filter(Boolean))];
    const users = userIds.length > 0 ? await db.collection('users').find({ id: { $in: userIds } }).toArray() : [];
    const userMap = Object.fromEntries(users.map(u => [u.id, u.name]));

    const enriched = logs.map(l => ({ ...l, user_name: userMap[l.user_id] || l.user_id || 'System' }));

    return json({ logs: enriched, total, page, limit, pages: Math.ceil(total / limit) });
  }

  // Distinct actors who appear in audit logs (for user filter dropdown)
  if (route === 'audit/actors') {
    if (!['super_admin', 'it_admin'].includes(user.role)) return error('Forbidden', 403);
    const distinctUserIds = await db.collection('audit_logs').distinct('user_id');
    const actors = distinctUserIds.length > 0
      ? await db.collection('users').find({ id: { $in: distinctUserIds } }, { projection: { id: 1, name: 1 } }).toArray()
      : [];
    return json(actors);
  }

  // ============ CSV EXPORT ============
  
  if (route === 'export/assets') {
    const assets = await db.collection('assets').find({}).toArray();
    const employees = await db.collection('employees').find({}).toArray();
    const projects = await db.collection('projects').find({}).toArray();
    const locations = await db.collection('locations').find({}).toArray();
    
    const employeeMap = Object.fromEntries(employees.map(e => [e.id, e.name]));
    const projectMap = Object.fromEntries(projects.map(p => [p.id, p.name]));
    const locationMap = Object.fromEntries(locations.map(l => [l.id, l.name]));
    
    let csv = 'Asset Tag,Category,Asset Type,Serial Number,Brand,Vendor,Status,Location,Project,Warranty Status,Expiry Date,Renewal Date,Assigned To,Notes\n';
    
    for (const asset of assets) {
      const warrantyStatus = getWarrantyStatus(asset.warranty_applicable, asset.warranty_end_date);
      let assignedTo = '';
      if (asset.assigned_to) {
        assignedTo = asset.assigned_to === 'company' ? 'Company' : (employeeMap[asset.assigned_to] || '');
      }
      
      csv += `"${asset.asset_tag || ''}","${asset.category || ''}","${asset.asset_type || ''}","${asset.serial_number || ''}","${asset.brand || ''}","${asset.vendor_name || ''}","${asset.status || ''}","${locationMap[asset.location_id] || ''}","${projectMap[asset.project_id] || ''}","${warrantyStatus}","${asset.expiry_date || ''}","${asset.renewal_date || ''}","${assignedTo}","${(asset.notes || '').replace(/"/g, '""')}"\n`;
    }
    
    return new NextResponse(csv, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="assets_export.csv"'
      }
    });
  }

  // ============ VACATION GET ROUTES ============

  // Vacation history (returned only)
  if (route === 'vacation/history') {
    if (!['super_admin', 'it_admin'].includes(user?.role)) return error('Forbidden', 403);
    const handovers = await db.collection('vacation_handovers').find({ status: 'returned' }).sort({ returned_at: -1, created_at: -1 }).toArray();
    const enriched = await Promise.all(handovers.map(async h => {
      const asset = await db.collection('assets').findOne({ id: h.asset_id });
      const employee = await db.collection('employees').findOne({ id: h.original_employee_id });
      const custodian = h.tempEmployeeId ? await db.collection('employees').findOne({ id: h.tempEmployeeId }) : null;
      return { ...h, asset_tag: asset?.asset_tag, employee_name: employee?.name, custodian_name: custodian?.name };
    }));
    return json(enriched);
  }

  // Active handovers list
  if (route === 'vacation/active') {
    if (!['super_admin', 'it_admin'].includes(user?.role)) return error('Forbidden', 403);
    const handovers = await db.collection('vacation_handovers').find({ status: 'active' }).sort({ created_at: -1 }).toArray();
    const enriched = await Promise.all(handovers.map(async h => {
      const asset = await db.collection('assets').findOne({ id: h.asset_id });
      const employee = await db.collection('employees').findOne({ id: h.originalEmployeeId });
      const custodian = h.tempEmployeeId ? await db.collection('employees').findOne({ id: h.tempEmployeeId }) : null;
      return { ...h, asset_tag: asset?.asset_tag, employee_name: employee?.name, custodian_name: custodian?.name };
    }));
    return json(enriched);
  }

  // Employee vacation status
  if (pathSegments[0] === 'employees' && pathSegments[2] === 'vacation' && pathSegments.length === 3) {
    const empId = pathSegments[1];
    const employee = await db.collection('employees').findOne({ id: empId });
    if (!employee) return error('Employee not found', 404);
    const handovers = await db.collection('vacation_handovers').find({ originalEmployeeId: empId, status: 'active' }).toArray();
    const enrichedHandovers = await Promise.all(handovers.map(async h => {
      const asset = await db.collection('assets').findOne({ id: h.asset_id });
      const custodian = h.tempEmployeeId ? await db.collection('employees').findOne({ id: h.tempEmployeeId }) : null;
      return { ...h, asset_tag: asset?.asset_tag, custodian_name: custodian?.name };
    }));
    return json({ vacation_status: employee.vacation_status || {}, handovers: enrichedHandovers });
  }

  // Asset documents list
  if (pathSegments[0] === 'assets' && pathSegments.length === 3 && pathSegments[2] === 'documents') {
    if (!canAccess(user.role, 'assets')) return error('Forbidden', 403);
    const assetId = pathSegments[1];
    const docs = await db.collection('asset_documents').find({ asset_id: assetId }).sort({ uploaded_at: -1 }).toArray();
    return json(docs);
  }

  // GET /api/assets/:id/addons
  if (pathSegments[0] === 'assets' && pathSegments.length === 3 && pathSegments[2] === 'addons') {
    if (!canAccess(user.role, 'assets')) return error('Forbidden', 403);
    const assetId = pathSegments[1];
    const asset = await db.collection('assets').findOne({ id: assetId });
    if (!asset) return error('Asset not found', 404);
    return json(asset.addons || []);
  }

  // Serve/download asset document
  if (pathSegments[0] === 'assets' && pathSegments[1] === 'documents' && pathSegments.length === 3) {
    const docId = pathSegments[2];
    const doc = await db.collection('asset_documents').findOne({ id: docId });
    if (!doc) return error('Document not found', 404);
    const uploadDir = process.env.UPLOAD_DIR || '/app/uploads';
    const filePath = path.join(uploadDir, doc.stored_filename);
    try {
      const fileBytes = await readFile(filePath);
      return new NextResponse(fileBytes, {
        headers: {
          'Content-Type': doc.mime_type || 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${doc.filename}"`,
        }
      });
    } catch (e) {
      return error('File not found on disk', 404);
    }
  }

  // ============ ASSET AUDITS ============

  // GET /api/audits — list all audits with optional filters
  if (route === 'audits') {
    if (!['super_admin', 'it_admin', 'it_technician'].includes(user.role)) return error('Forbidden', 403);
    await runAuditSchedule(db);
    const status = url.searchParams.get('status') || '';
    const assetId = url.searchParams.get('asset_id') || '';
    const employeeId = url.searchParams.get('employee_id') || '';
    const query = {};
    if (status) query.status = status;
    if (assetId) query.assetId = assetId;
    if (employeeId) query.employeeId = employeeId;
    const audits = await db.collection('assetAudits').find(query).sort({ scheduledDate: -1 }).toArray();
    const assets = await db.collection('assets').find({}).toArray();
    const employees = await db.collection('employees').find({}).toArray();
    const users = await db.collection('users').find({}).toArray();
    const assetById = Object.fromEntries(assets.map(a => [a.id, a]));
    const empById = Object.fromEntries(employees.map(e => [e.id, e]));
    const userById = Object.fromEntries(users.map(u => [u.id, u]));
    return json(audits.map(a => ({
      ...a,
      asset_tag: assetById[a.assetId]?.asset_tag || a.assetId,
      asset_name: assetById[a.assetId]?.asset_tag || '',
      employee_name: empById[a.employeeId]?.name || (a.employeeId === 'company' ? 'Company' : '—'),
      conducted_by_name: userById[a.conductedBy]?.name || ''
    })));
  }

  // GET /api/audits/due — list due and overdue audits
  if (route === 'audits/due') {
    if (!['super_admin', 'it_admin', 'it_technician'].includes(user.role)) return error('Forbidden', 403);
    await runAuditSchedule(db);
    const audits = await db.collection('assetAudits').find({ status: { $in: ['scheduled', 'overdue'] } }).sort({ scheduledDate: 1 }).toArray();
    const assets = await db.collection('assets').find({}).toArray();
    const assetById = Object.fromEntries(assets.map(a => [a.id, a]));
    return json(audits.map(a => ({ ...a, asset_tag: assetById[a.assetId]?.asset_tag || a.assetId })));
  }

  // GET /api/assets/:id/audits — audit history for one asset
  if (pathSegments[0] === 'assets' && pathSegments[2] === 'audits' && pathSegments.length === 3) {
    const aid = pathSegments[1];
    const audits = await db.collection('assetAudits').find({ assetId: aid }).sort({ scheduledDate: -1 }).toArray();
    const users = await db.collection('users').find({}).toArray();
    const userById = Object.fromEntries(users.map(u => [u.id, u]));
    return json(audits.map(a => ({ ...a, conducted_by_name: userById[a.conductedBy]?.name || '' })));
  }

  // GET /api/settings/smtp — return SMTP config (password masked)
  if (route === 'settings/smtp') {
    if (user.role !== 'super_admin') return error('Forbidden', 403);
    const doc = await db.collection('settings').findOne({ key: 'smtp' });
    const cfg = doc?.value || {};
    // Mask password for display
    return json({ ...cfg, pass: cfg.pass ? '••••••••' : '' });
  }

  return error('Not found', 404);
}

export async function POST(request, { params }) {
  try {
  const db = await getDb();
  await seedAdmin(db);

  const pathSegments = params.path || [];
  const route = pathSegments.join('/');

  // Wrap request.json to auto-sanitize string fields
  const _origJson = request.json.bind(request);
  request.json = async () => sanitizeBody(await _origJson());
  
  // Login
  if (route === 'auth/login') {
    const body = await request.json();
    // Accept identifier (new), or fall back to legacy email/username fields
    const identifier = body.identifier || body.username || body.email || '';
    const password = body.password;

    if (!identifier || !password) return error('Username/email and password required');

    // Lockout check (keyed on identifier string)
    const lockoutMsg = await checkLockout(db, identifier);
    if (lockoutMsg) return error(lockoutMsg, 429);

    // Find user by username OR email
    const user = await db.collection('users').findOne({
      $or: [{ username: identifier }, { email: identifier }]
    });
    if (!user || !verifyPassword(password, user.password)) {
      await recordFailedLogin(db, identifier);
      return error('Incorrect username or password.', 401);
    }

    await clearLoginAttempts(db, identifier);

    // 2FA check
    if (user.totp_enabled && user.totp_secret) {
      const totp_session = generateTotpSession(user.id);
      return json({ requires_totp: true, totp_session });
    }

    const token = generateToken(user);
    const sessionId = await createSession(db, user, token, request);
    return json({ token, session_id: sessionId, user: { id: user.id, email: user.email, name: user.name, role: user.role, is_default_password: user.is_default_password || false } });
  }

  // TOTP second-factor login
  if (route === 'auth/totp/login') {
    const { totp_session, totp_code } = await request.json();
    if (!totp_session || !totp_code) return error('Session and code required');
    const userId = verifyTotpSession(totp_session);
    if (!userId) return error('Session expired or invalid. Please sign in again.', 401);
    const user = await db.collection('users').findOne({ id: userId });
    if (!user || !user.totp_enabled) return error('Invalid session', 401);
    if (!verifyTOTP(user.totp_secret, totp_code)) return error('Invalid authenticator code', 401);
    const token = generateToken(user);
    const sessionId = await createSession(db, user, token, request);
    return json({ token, session_id: sessionId, user: { id: user.id, email: user.email, name: user.name, role: user.role, is_default_password: user.is_default_password || false } });
  }

  // Protected routes
  const user = await getAuthUser(request, db);
  if (!user) return error('Unauthorized', 401);

  // Update session last_active (fire and forget)
  touchSession(db, request.headers.get('x-session-id'));

  // TOTP setup — generate secret, store as pending (not yet active)
  if (route === 'auth/totp/setup') {
    const secret = generateTOTPSecret();
    const dbUser = await db.collection('users').findOne({ id: user.id });
    if (!dbUser) return error('User not found', 404);
    await db.collection('users').updateOne({ id: user.id }, { $set: { totp_pending_secret: secret } });
    return json({ secret, otpauth_url: totpUri(secret, dbUser.email) });
  }

  // TOTP enable — verify code against pending secret, then activate
  if (route === 'auth/totp/enable') {
    const { totp_code } = await request.json();
    if (!totp_code) return error('Code required');
    const dbUser = await db.collection('users').findOne({ id: user.id });
    if (!dbUser?.totp_pending_secret) return error('No pending 2FA setup. Call setup first.');
    if (!verifyTOTP(dbUser.totp_pending_secret, totp_code)) return error('Invalid code');
    await db.collection('users').updateOne({ id: user.id }, {
      $set: { totp_enabled: true, totp_secret: dbUser.totp_pending_secret },
      $unset: { totp_pending_secret: '' }
    });
    return json({ message: '2FA enabled successfully' });
  }

  // TOTP disable — verify current password, then deactivate
  if (route === 'auth/totp/disable') {
    const { password } = await request.json();
    if (!password) return error('Password required to disable 2FA');
    const dbUser = await db.collection('users').findOne({ id: user.id });
    if (!dbUser || !verifyPassword(password, dbUser.password)) return error('Incorrect password');
    await db.collection('users').updateOne({ id: user.id }, {
      $set: { totp_enabled: false },
      $unset: { totp_secret: '', totp_pending_secret: '' }
    });
    return json({ message: '2FA disabled' });
  }

  // Get TOTP status for current user
  if (route === 'auth/totp/status') {
    const dbUser = await db.collection('users').findOne({ id: user.id });
    return json({ totp_enabled: dbUser?.totp_enabled || false });
  }

  // Logout — delete current session
  if (route === 'auth/logout') {
    const sessionId = request.headers.get('x-session-id');
    if (sessionId) await db.collection('sessions').deleteOne({ id: sessionId, user_id: user.id });
    return json({ success: true });
  }

  // Change password
  if (route === 'auth/change-password') {
    const { current_password, new_password } = await request.json();
    if (!current_password || !new_password) return error('Both current and new password are required');
    const strengthError = validatePasswordStrength(new_password);
    if (strengthError) return error(strengthError);
    const dbUser = await db.collection('users').findOne({ id: user.id });
    if (!dbUser || !verifyPassword(current_password, dbUser.password)) return error('Current password is incorrect');
    if (current_password === new_password) return error('New password must differ from current password');
    await db.collection('users').updateOne({ id: user.id }, { $set: { password: hashPassword(new_password), is_default_password: false } });
    await logAudit(db, user.id, 'CHANGE_PASSWORD', 'user', user.id, {});
    return json({ message: 'Password changed successfully' });
  }

  // Revoke all other sessions (sign out everywhere else)
  if (route === 'auth/sessions/revoke-all') {
    const currentSessionId = request.headers.get('x-session-id');
    const query = currentSessionId
      ? { user_id: user.id, id: { $ne: currentSessionId } }
      : { user_id: user.id };
    const { deletedCount } = await db.collection('sessions').deleteMany(query);
    return json({ revoked: deletedCount });
  }

  // Create API key
  if (route === 'auth/api-keys') {
    const { name, scopes, expires_days } = await request.json();
    if (!name?.trim()) return error('Key name is required');
    const rawKey = generateApiKey();
    const keyHash = hashApiKey(rawKey);
    const prefix = rawKey.slice(0, 12) + '...';
    const expires_at = expires_days ? new Date(Date.now() + expires_days * 24 * 60 * 60 * 1000).toISOString() : null;
    const keyDoc = {
      id: uuidv4(),
      user_id: user.id,
      name: name.trim(),
      key_hash: keyHash,
      prefix,
      scopes: scopes || ['read'],
      created_at: new Date().toISOString(),
      last_used: null,
      expires_at,
    };
    await db.collection('api_keys').insertOne(keyDoc);
    await logAudit(db, user.id, 'CREATE_API_KEY', 'api_key', keyDoc.id, { name: keyDoc.name });
    // Return raw key ONCE — not stored, cannot be retrieved again
    return json({ id: keyDoc.id, name: keyDoc.name, key: rawKey, prefix, scopes: keyDoc.scopes, created_at: keyDoc.created_at, expires_at });
  }

  // ============ MASTER DATA CRUD ============
  
  // Create Company
  if (route === 'companies') {
    if (!['super_admin', 'it_admin'].includes(user.role)) return error('Forbidden', 403);
    
    const body = await request.json();
    const { name, code } = body;
    
    if (!name) return error('Company name required');
    
    const existing = await db.collection('companies').findOne({ name });
    if (existing) return error('Company already exists');
    
    const newCompany = {
      id: uuidv4(),
      name,
      code: code || '',
      created_at: new Date().toISOString()
    };
    
    await db.collection('companies').insertOne(newCompany);
    await logAudit(db, user.id, 'CREATE', 'company', newCompany.id, { name });
    
    return json(newCompany, 201);
  }
  
  // Create Project
  if (route === 'projects') {
    if (!['super_admin', 'it_admin'].includes(user.role)) return error('Forbidden', 403);
    
    const body = await request.json();
    const { name, code, company_id } = body;
    
    if (!name) return error('Project name required');
    
    const newProject = {
      id: uuidv4(),
      name,
      code: code || '',
      company_id: company_id || null,
      created_at: new Date().toISOString()
    };
    
    await db.collection('projects').insertOne(newProject);
    await logAudit(db, user.id, 'CREATE', 'project', newProject.id, { name });
    
    return json(newProject, 201);
  }
  
  // Create Location
  if (route === 'locations') {
    if (!['super_admin', 'it_admin'].includes(user.role)) return error('Forbidden', 403);
    
    const body = await request.json();
    const { name, address } = body;
    
    if (!name) return error('Location name required');
    
    const newLocation = {
      id: uuidv4(),
      name,
      address: address || '',
      created_at: new Date().toISOString()
    };
    
    await db.collection('locations').insertOne(newLocation);
    await logAudit(db, user.id, 'CREATE', 'location', newLocation.id, { name });
    
    return json(newLocation, 201);
  }
  
  // Create Department
  if (route === 'departments') {
    if (!['super_admin', 'it_admin'].includes(user.role)) return error('Forbidden', 403);
    
    const body = await request.json();
    const { name, code } = body;
    
    if (!name) return error('Department name required');
    
    const newDepartment = {
      id: uuidv4(),
      name,
      code: code || '',
      created_at: new Date().toISOString()
    };
    
    await db.collection('departments').insertOne(newDepartment);
    await logAudit(db, user.id, 'CREATE', 'department', newDepartment.id, { name });
    
    return json(newDepartment, 201);
  }
  
  // Create Category (both /categories and /asset-categories paths)
  if (route === 'asset-categories' || route === 'categories') {
    if (!['super_admin', 'it_admin'].includes(user.role)) return error('Forbidden', 403);

    const body = await request.json();
    const { name, category_type } = body;

    if (!name || !category_type) return error('Category name and type required');
    if (!['STORABLE', 'CONSUMABLE', 'SUBSCRIPTION'].includes(category_type)) {
      return error('Invalid category type. Must be STORABLE, CONSUMABLE, or SUBSCRIPTION');
    }

    const existing = await db.collection('categories').findOne({ name });
    if (existing) return error('Category already exists');

    const newCategory = {
      id: uuidv4(),
      name,
      category_type,
      hasSpecs: computeHasSpecs(name),
      isIoT: computeIsIoT(name),
      created_at: new Date().toISOString()
    };

    await db.collection('categories').insertOne(newCategory);
    await logAudit(db, user.id, 'CREATE', 'category', newCategory.id, { name, category_type });

    return json(newCategory, 201);
  }

  // ============ USERS ============
  
  if (route === 'users') {
    if (user.role !== 'super_admin') return error('Forbidden', 403);
    
    const body = await request.json();
    const { email, password, name, role } = body;
    
    if (!email || !password || !name || !role) {
      return error('All fields required');
    }
    
    const existing = await db.collection('users').findOne({ email });
    if (existing) return error('Email already exists');
    
    const newUser = {
      id: uuidv4(),
      email,
      password: hashPassword(password),
      name,
      role,
      created_at: new Date().toISOString()
    };
    
    await db.collection('users').insertOne(newUser);
    await logAudit(db, user.id, 'CREATE', 'user', newUser.id, { email, role });
    
    return json({ id: newUser.id, email, name, role }, 201);
  }

  // ============ EMPLOYEES ============
  
  if (route === 'employees') {
    if (!canAccess(user.role, 'employees')) return error('Forbidden', 403);
    
    const body = await request.json();
    const { 
      name, employee_id, company_id, project_id, location_id, department_id,
      manager_id, status = 'Active', mobile_number, telephone_extension, ...rest 
    } = body;
    
    if (!name || !employee_id) {
      return error('Name and employee_id required');
    }
    
    if (!company_id || !location_id || !department_id) {
      return error('Company, Location, and Department are required');
    }
    
    const existing = await db.collection('employees').findOne({ employee_id });
    if (existing) return error('Employee ID already exists');
    
    // Validate manager hierarchy
    if (manager_id) {
      const managerExists = await db.collection('employees').findOne({ id: manager_id });
      if (!managerExists) return error('Manager not found');
    }
    
    const newEmployee = {
      id: uuidv4(),
      name,
      employee_id,
      company_id,
      project_id: project_id || null,
      location_id,
      department_id,
      manager_id: manager_id || null,
      mobile_number: mobile_number || '',
      telephone_extension: telephone_extension || '',
      status,
      vacation_start_date: null,
      vacation_end_date: null,
      personal_email: rest.personal_email || '',
      company_email: rest.company_email || '',
      fingerprint_id: rest.fingerprint_id || '',
      ad_username: rest.ad_username || '',
      keys_provided: rest.keys_provided || false,
      created_at: new Date().toISOString()
    };
    
    await db.collection('employees').insertOne(newEmployee);
    await logAudit(db, user.id, 'CREATE', 'employee', newEmployee.id, { name, employee_id });
    
    return json(newEmployee, 201);
  }

  // ============ ASSETS ============
  
  if (route === 'assets') {
    if (!canAccess(user.role, 'assets')) return error('Forbidden', 403);

    const body = await request.json();
    const {
      asset_tag, category, brand, vendor_name,
      receive_date, warranty_applicable, warranty_end_date,
      serial_number, connection_type,
      company_id, project_id, location_id, department_id,
      expiry_date, renewal_date, company_only,
      notes, provider_url,
      specs, ipAddress, ipAddresses
    } = body;

    if (!asset_tag || !category) {
      return error('Asset tag and category required');
    }

    // Look up category to determine asset_type
    const categoryDoc = await db.collection('categories').findOne({ id: category });
    const categoryType = categoryDoc?.category_type || 'STORABLE';
    const derivedAssetType = categoryType === 'SUBSCRIPTION' ? 'Subscription'
      : categoryType === 'CONSUMABLE' ? 'Consumable'
      : 'Physical';

    const existing = await db.collection('assets').findOne({ asset_tag });
    if (existing) return error('Asset tag already exists');

    const newAsset = {
      id: uuidv4(),
      asset_tag,
      asset_type: body.asset_type || derivedAssetType,
      category,
      category_type: categoryType,
      brand: brand || '',
      vendor_name: vendor_name || '',
      receive_date: receive_date || '',
      status: 'In Stock',
      company_id: company_id || null,
      project_id: project_id || null,
      location_id: location_id || null,
      department_id: department_id || null,
      notes: notes || '',
      warranty_applicable: warranty_applicable || 'N-A',
      warranty_end_date: warranty_end_date || '',
      serial_number: serial_number || '',
      connection_type: connection_type || '',
      expiry_date: expiry_date || '',
      renewal_date: renewal_date || '',
      provider_url: provider_url || '',
      company_only: company_only || false,
      specs: specs || {},
      ipAddress: ipAddress || '',
      ipAddresses: ipAddresses || [],
      assigned_to: null,
      created_at: new Date().toISOString()
    };
    
    await db.collection('assets').insertOne(newAsset);
    await logAudit(db, user.id, 'CREATE', 'asset', newAsset.id, { asset_tag, category });
    await logActivity(db, newAsset.id, 'CREATED', `Asset ${asset_tag} created`, user.id, user.name);
    
    return json(newAsset, 201);
  }

  // Renew asset (consumables)
  if (route === 'assets/renew') {
    if (!canAccess(user.role, 'assets')) return error('Forbidden', 403);
    
    const body = await request.json();
    const { asset_id, expiry_date, renewal_date } = body;
    
    if (!asset_id) return error('Asset ID required');
    
    const asset = await db.collection('assets').findOne({ id: asset_id });
    if (!asset) return error('Asset not found', 404);
    if (asset.asset_type !== 'Consumable') return error('Only consumable assets can be renewed');
    
    await db.collection('assets').updateOne(
      { id: asset_id },
      { $set: { expiry_date, renewal_date, updated_at: new Date().toISOString() } }
    );
    
    await logAudit(db, user.id, 'RENEW', 'asset', asset_id, { expiry_date, renewal_date });
    await logActivity(db, asset_id, 'RENEWED', `Asset renewed. New expiry: ${expiry_date}`, user.id, user.name);

    return json({ success: true });
  }

  // Update billing date (Mark as Paid)
  if (route === 'assets/billing-update') {
    if (!canAccess(user.role, 'assets')) return error('Forbidden', 403);
    const body = await request.json();
    const { asset_id, new_billing_date, paid, notes } = body;
    if (!asset_id || !new_billing_date) return error('asset_id and new_billing_date required');
    const today = new Date().toISOString().split('T')[0];
    if (new_billing_date <= today) return error('New billing date must be a future date');
    const asset = await db.collection('assets').findOne({ id: asset_id });
    if (!asset) return error('Asset not found', 404);
    const previousDate = asset.renewal_date;
    await db.collection('assets').updateOne(
      { id: asset_id },
      { $set: { renewal_date: new_billing_date, updated_at: new Date().toISOString() } }
    );
    await logAudit(db, user.id, 'BILLING_UPDATED', 'asset', asset_id, {
      action: 'billing_updated', previousDate, newDate: new_billing_date,
      confirmedBy: user.id, notes: notes || '', paid: paid !== false, at: new Date().toISOString()
    });
    await logActivity(db, asset_id, 'BILLING_UPDATED',
      `Billing date updated from ${previousDate || 'none'} to ${new_billing_date}${notes ? '. Notes: ' + notes : ''}`,
      user.id, user.name
    );
    return json({ success: true, new_billing_date });
  }

  // ============ ASSIGNMENTS ============
  
  // POST /api/assets/:id/assignees — add employee to shared subscription
  if (pathSegments[0] === 'assets' && pathSegments[2] === 'assignees' && pathSegments.length === 3) {
    if (!canAccess(user.role, 'assets')) return error('Forbidden', 403);
    const assetId = pathSegments[1];
    const { employee_id } = await request.json();
    if (!employee_id) return error('employee_id required');
    const asset = await db.collection('assets').findOne({ id: assetId });
    if (!asset) return error('Asset not found', 404);
    if (asset.category_type !== 'SUBSCRIPTION') return error('Only subscription assets support shared assignees');
    const employee = await db.collection('employees').findOne({ id: employee_id });
    if (!employee) return error('Employee not found', 404);
    const already = (asset.sharedAssignees || []).find(a => a.employee_id === employee_id);
    if (already) return error('Employee already has access');
    const newAssignee = { employee_id, employee_name: employee.name, added_date: new Date().toISOString().split('T')[0], added_by: user.name };
    await db.collection('assets').updateOne({ id: assetId }, {
      $push: { sharedAssignees: newAssignee },
      $set: { isShared: true, updated_at: new Date().toISOString() }
    });
    await logAudit(db, user.id, 'ADD_SHARED_ASSIGNEE', 'asset', assetId, { employee_id, employee_name: employee.name });
    return json({ success: true });
  }

  if (route === 'assignments') {
    if (!canAccess(user.role, 'assignments')) return error('Forbidden', 403);

    const body = await request.json();
    const {
      asset_id, employee_id,
      assignment_type = 'Normal', // Normal, Temporary, Vacation Handover
      original_employee_id = null,
      project_id, location_id 
    } = body;
    
    if (!asset_id || !employee_id) {
      return error('Asset and employee required');
    }
    
    const asset = await db.collection('assets').findOne({ id: asset_id });
    if (!asset) return error('Asset not found', 404);
    if (['Assigned', 'Temporarily Assigned', 'Handed Over (Vacation Coverage)'].includes(asset.status)) {
      return error('Asset already assigned');
    }
    if (asset.status === 'Scrapped') return error('Cannot assign scrapped asset');
    
    // Check if asset is company-only
    if (asset.company_only && employee_id !== 'company') {
      return error('This asset can only be assigned to Company');
    }
    
    // Validate employee (unless 'company')
    let employeeName = 'Company';
    if (employee_id !== 'company') {
      const employee = await db.collection('employees').findOne({ id: employee_id });
      if (!employee) return error('Employee not found', 404);
      employeeName = employee.name;
    }
    
    // Determine status
    let newStatus = 'Assigned';
    if (assignment_type === 'Vacation Handover') {
      newStatus = 'Handed Over (Vacation Coverage)';
    } else if (assignment_type === 'Temporary') {
      newStatus = 'Temporarily Assigned';
    }
    
    const assignment = {
      id: uuidv4(),
      asset_id,
      employee_id,
      assigned_date: new Date().toISOString().split('T')[0],
      unassigned_date: null,
      assignment_type,
      original_employee_id,
      custody_docs: []
    };
    
    // Update asset
    const assetUpdates = { 
      status: newStatus,
      assigned_to: employee_id
    };
    if (project_id) assetUpdates.project_id = project_id;
    if (location_id) assetUpdates.location_id = location_id;
    
    await db.collection('assignments').insertOne(assignment);
    await db.collection('assets').updateOne({ id: asset_id }, { $set: assetUpdates });
    await logAudit(db, user.id, 'ASSIGN', 'asset', asset_id, { employee_id, status: newStatus, assignment_type });
    
    // Activity log
    let activityAction = 'ASSIGNED';
    let activityDetails = `Assigned to ${employeeName}`;
    if (assignment_type === 'Vacation Handover') {
      activityAction = 'VACATION_HANDOVER';
      activityDetails = `Handed over to ${employeeName} (Vacation Coverage)`;
    } else if (assignment_type === 'Temporary') {
      activityAction = 'TEMP_ASSIGNED';
      activityDetails = `Temporarily assigned to ${employeeName}`;
    }
    await logActivity(db, asset_id, activityAction, activityDetails, user.id, user.name);
    
    return json(assignment, 201);
  }

  // Unassign asset
  if (route === 'assignments/unassign') {
    if (!canAccess(user.role, 'assignments')) return error('Forbidden', 403);
    
    const body = await request.json();
    const { asset_id, return_to_stock = true } = body;
    
    if (!asset_id) return error('Asset ID required');
    
    const assignment = await db.collection('assignments').findOne({ 
      asset_id, 
      unassigned_date: null 
    });
    
    if (!assignment) return error('No active assignment found', 404);
    
    // Get employee name for activity log
    let employeeName = 'Company';
    if (assignment.employee_id !== 'company') {
      const emp = await db.collection('employees').findOne({ id: assignment.employee_id });
      employeeName = emp?.name || '';
    }
    
    await db.collection('assignments').updateOne(
      { id: assignment.id },
      { $set: { unassigned_date: new Date().toISOString().split('T')[0] } }
    );
    
    if (return_to_stock) {
      await db.collection('assets').updateOne(
        { id: asset_id },
        { $set: { status: 'In Stock', assigned_to: null } }
      );
    }
    
    await logAudit(db, user.id, 'UNASSIGN', 'asset', asset_id, { employee_id: assignment.employee_id });
    await logActivity(db, asset_id, 'RETURNED_TO_STOCK', `Returned from ${employeeName}`, user.id, user.name);
    
    return json({ success: true });
  }

  // Bulk unassign (for resignation)
  if (route === 'assignments/bulk-unassign') {
    if (!canAccess(user.role, 'assignments')) return error('Forbidden', 403);
    
    const body = await request.json();
    const { employee_id, action, new_employee_id } = body;
    
    if (!employee_id) return error('Employee ID required');
    
    const employee = await db.collection('employees').findOne({ id: employee_id });
    if (!employee) return error('Employee not found', 404);
    
    const assignments = await db.collection('assignments').find({ 
      employee_id, 
      unassigned_date: null 
    }).toArray();
    
    for (const assignment of assignments) {
      // Close current assignment
      await db.collection('assignments').updateOne(
        { id: assignment.id },
        { $set: { unassigned_date: new Date().toISOString().split('T')[0] } }
      );
      
      if (action === 'return_to_stock') {
        await db.collection('assets').updateOne(
          { id: assignment.asset_id },
          { $set: { status: 'In Stock', assigned_to: null } }
        );
        await logActivity(db, assignment.asset_id, 'RETURNED_TO_STOCK', `Returned from ${employee.name} (Resigned)`, user.id, user.name);
      } else if (action === 'reassign' && new_employee_id) {
        const newEmployee = await db.collection('employees').findOne({ id: new_employee_id });
        if (newEmployee) {
          // Create new assignment
          const newAssignment = {
            id: uuidv4(),
            asset_id: assignment.asset_id,
            employee_id: new_employee_id,
            assigned_date: new Date().toISOString().split('T')[0],
            unassigned_date: null,
            assignment_type: 'Normal',
            original_employee_id: null,
            custody_docs: []
          };
          await db.collection('assignments').insertOne(newAssignment);
          await db.collection('assets').updateOne(
            { id: assignment.asset_id },
            { $set: { status: 'Assigned', assigned_to: new_employee_id } }
          );
          await logActivity(db, assignment.asset_id, 'REASSIGNED', `Reassigned from ${employee.name} to ${newEmployee.name}`, user.id, user.name);
        }
      }
      
      await logAudit(db, user.id, 'BULK_UNASSIGN', 'asset', assignment.asset_id, { from: employee_id, action });
    }
    
    return json({ success: true, count: assignments.length });
  }

  // Return vacation assets to original owner
  if (route === 'assignments/return-from-vacation') {
    if (!canAccess(user.role, 'assignments')) return error('Forbidden', 403);
    
    const body = await request.json();
    const { employee_id } = body;
    
    if (!employee_id) return error('Employee ID required');
    
    // Find all vacation handover assignments for this employee's assets
    const vacationAssignments = await db.collection('assignments').find({
      original_employee_id: employee_id,
      assignment_type: 'Vacation Handover',
      unassigned_date: null
    }).toArray();
    
    const employee = await db.collection('employees').findOne({ id: employee_id });
    
    for (const assignment of vacationAssignments) {
      // Close vacation assignment
      await db.collection('assignments').updateOne(
        { id: assignment.id },
        { $set: { unassigned_date: new Date().toISOString().split('T')[0] } }
      );
      
      // Create new assignment back to original owner
      const newAssignment = {
        id: uuidv4(),
        asset_id: assignment.asset_id,
        employee_id: employee_id,
        assigned_date: new Date().toISOString().split('T')[0],
        unassigned_date: null,
        assignment_type: 'Normal',
        original_employee_id: null,
        custody_docs: []
      };
      
      await db.collection('assignments').insertOne(newAssignment);
      await db.collection('assets').updateOne(
        { id: assignment.asset_id },
        { $set: { status: 'Assigned', assigned_to: employee_id } }
      );
      
      await db.collection('assets').updateOne({ id: assignment.asset_id }, { $set: { vacation_remote: false } });
      await logActivity(db, assignment.asset_id, 'RETURNED_TO_OWNER', `Returned to ${employee?.name} after vacation`, user.id, user.name);
    }

    // Mark all active vacation handovers for this employee as returned
    await db.collection('vacation_handovers').updateMany(
      { originalEmployeeId: employee_id, status: 'active' },
      { $set: { status: 'returned', returnedAt: new Date().toISOString() } }
    );

    // Update employee status
    await db.collection('employees').updateOne(
      { id: employee_id },
      { $set: { status: 'Active', vacation_start_date: null, vacation_end_date: null } }
    );

    return json({ success: true, count: vacationAssignments.length });
  }

  // ============ CUSTODY DOCUMENTS ============
  
  if (route === 'assignments/custody') {
    if (!canAccess(user.role, 'custody')) return error('Forbidden', 403);
    
    const formData = await request.formData();
    const file = formData.get('file');
    const assignmentId = formData.get('assignment_id');
    
    if (!file || !assignmentId) {
      return error('File and assignment_id required');
    }
    
    // Check file size (500KB max)
    const MAX_SIZE = 500 * 1024; // 500KB
    const bytes = await file.arrayBuffer();
    if (bytes.byteLength > MAX_SIZE) {
      return error('File size exceeds 500KB limit');
    }
    
    const assignment = await db.collection('assignments').findOne({ id: assignmentId });
    if (!assignment) return error('Assignment not found', 404);
    
    const uploadDir = process.env.UPLOAD_DIR || '/app/uploads';
    await mkdir(uploadDir, { recursive: true });
    
    const ext = file.name.split('.').pop();
    const filename = `${uuidv4()}.${ext}`;
    const filepath = path.join(uploadDir, filename);
    
    await writeFile(filepath, Buffer.from(bytes));
    
    const docEntry = {
      id: uuidv4(),
      filename: file.name,
      filepath: `/uploads/${filename}`,
      size: bytes.byteLength,
      uploaded_at: new Date().toISOString(),
      uploaded_by: user.id
    };
    
    await db.collection('assignments').updateOne(
      { id: assignmentId },
      { $push: { custody_docs: docEntry } }
    );
    
    await logAudit(db, user.id, 'UPLOAD_CUSTODY', 'assignment', assignmentId, { filename: file.name });
    
    return json(docEntry, 201);
  }

  // Delete custody document
  if (route === 'assignments/custody/delete') {
    if (!['super_admin', 'it_admin'].includes(user.role)) return error('Forbidden', 403);
    
    const body = await request.json();
    const { assignment_id, doc_id } = body;
    
    if (!assignment_id || !doc_id) return error('Assignment ID and document ID required');
    
    const assignment = await db.collection('assignments').findOne({ id: assignment_id });
    if (!assignment) return error('Assignment not found', 404);
    
    // Check if deletion is allowed
    const canDelete = assignment.unassigned_date !== null; // Assignment is closed
    if (!canDelete) {
      // Check if employee resigned or vacation handover ended
      if (assignment.employee_id !== 'company') {
        const employee = await db.collection('employees').findOne({ id: assignment.employee_id });
        if (employee?.status !== 'Resigned') {
          return error('Cannot delete custody document for active assignment');
        }
      }
    }
    
    const doc = assignment.custody_docs?.find(d => d.id === doc_id);
    if (!doc) return error('Document not found', 404);
    
    // Delete file from disk
    try {
      const filepath = path.join(process.env.UPLOAD_DIR || '/app/uploads', doc.filepath.split('/').pop());
      await unlink(filepath);
    } catch (e) {
      console.error('Failed to delete file:', e);
    }
    
    // Remove from assignment
    await db.collection('assignments').updateOne(
      { id: assignment_id },
      { $pull: { custody_docs: { id: doc_id } } }
    );
    
    await logAudit(db, user.id, 'DELETE_CUSTODY', 'assignment', assignment_id, { doc_id, filename: doc.filename });
    
    return json({ success: true });
  }

  // ============ MAINTENANCE ============
  
  if (route === 'maintenance') {
    if (!canAccess(user.role, 'maintenance')) return error('Forbidden', 403);
    
    const body = await request.json();
    const { 
      asset_id, description, date, 
      work_performed, maintenance_cost, technician_cost, currency,
      maintenance_location 
    } = body;
    
    if (!asset_id || !description) {
      return error('Asset and description required');
    }
    
    const asset = await db.collection('assets').findOne({ id: asset_id });
    if (!asset) return error('Asset not found', 404);
    
    // Remove asset from employee custody if assigned
    if (['Assigned', 'Temporarily Assigned', 'Handed Over (Vacation Coverage)'].includes(asset.status)) {
      const assignment = await db.collection('assignments').findOne({ 
        asset_id, 
        unassigned_date: null 
      });
      if (assignment) {
        await db.collection('assignments').updateOne(
          { id: assignment.id },
          { $set: { unassigned_date: new Date().toISOString().split('T')[0] } }
        );
      }
    }
    
    const record = {
      id: uuidv4(),
      asset_id,
      description,
      date: date || new Date().toISOString().split('T')[0],
      work_performed: work_performed || '',
      maintenance_cost: maintenance_cost || 0,
      technician_cost: technician_cost || 0,
      currency: currency || 'USD',
      maintenance_location: maintenance_location || 'Repair Shop',
      performed_by: user.name,
      status: 'in_progress',
      completed_at: null,
      created_at: new Date().toISOString()
    };
    
    await db.collection('maintenance').insertOne(record);
    
    // Update asset status to In Maintenance
    await db.collection('assets').updateOne(
      { id: asset_id },
      { $set: { status: 'In Maintenance', updated_at: new Date().toISOString() } }
    );
    
    await logAudit(db, user.id, 'CREATE', 'maintenance', record.id, { asset_id });
    await logActivity(db, asset_id, 'SENT_TO_MAINTENANCE', description, user.id, user.name);
    
    return json(record, 201);
  }

  // Complete maintenance
  if (route === 'maintenance/complete') {
    if (!canAccess(user.role, 'maintenance')) return error('Forbidden', 403);
    
    const body = await request.json();
    const { maintenance_id, work_performed, maintenance_cost, technician_cost, currency } = body;
    
    if (!maintenance_id) return error('Maintenance ID required');
    
    const maintenance = await db.collection('maintenance').findOne({ id: maintenance_id });
    if (!maintenance) return error('Maintenance record not found', 404);
    
    // Update maintenance record
    await db.collection('maintenance').updateOne(
      { id: maintenance_id },
      { 
        $set: { 
          status: 'completed',
          completed_at: new Date().toISOString(),
          work_performed: work_performed || maintenance.work_performed,
          maintenance_cost: maintenance_cost !== undefined ? maintenance_cost : maintenance.maintenance_cost,
          technician_cost: technician_cost !== undefined ? technician_cost : maintenance.technician_cost,
          currency: currency || maintenance.currency
        } 
      }
    );
    
    // Asset stays "In Maintenance" until explicitly reassigned
    await logActivity(db, maintenance.asset_id, 'MAINTENANCE_COMPLETED', 'Maintenance work completed', user.id, user.name);
    
    return json({ success: true });
  }
  
  // Reassign after maintenance
  if (route === 'maintenance/reassign') {
    if (!canAccess(user.role, 'maintenance')) return error('Forbidden', 403);
    
    const body = await request.json();
    const { asset_id, action, employee_id } = body;
    
    if (!asset_id || !action) return error('Asset ID and action required');
    
    const asset = await db.collection('assets').findOne({ id: asset_id });
    if (!asset) return error('Asset not found', 404);
    
    if (action === 'return_to_stock') {
      await db.collection('assets').updateOne(
        { id: asset_id },
        { $set: { status: 'In Stock', updated_at: new Date().toISOString() } }
      );
      await logActivity(db, asset_id, 'RETURNED_TO_STOCK', 'Asset returned to stock after maintenance', user.id, user.name);
    } else if (action === 'assign_to_employee' && employee_id) {
      const employee = await db.collection('employees').findOne({ id: employee_id });
      if (!employee) return error('Employee not found', 404);
      
      const assignment = {
        id: uuidv4(),
        asset_id,
        employee_id,
        assigned_date: new Date().toISOString().split('T')[0],
        unassigned_date: null,
        assignment_type: 'Normal',
        original_employee_id: null,
        project_id: employee.project_id || null,
        location_id: employee.location_id || null,
        created_at: new Date().toISOString()
      };
      
      await db.collection('assignments').insertOne(assignment);
      await db.collection('assets').updateOne(
        { id: asset_id },
        { $set: { status: 'Assigned', updated_at: new Date().toISOString() } }
      );
      await logActivity(db, asset_id, 'ASSIGNED', `Assigned to ${employee.name} after maintenance`, user.id, user.name);
    }
    
    return json({ success: true });
  }

  // ============ SCRAP ============
  
  // Scrap/Cancel asset
  if (route === 'assets/scrap') {
    if (!canAccess(user.role, 'scrap')) return error('Forbidden', 403);
    
    const body = await request.json();
    const { asset_id, reason } = body;
    
    if (!asset_id) return error('Asset ID required');
    
    const asset = await db.collection('assets').findOne({ id: asset_id });
    if (!asset) return error('Asset not found', 404);
    if (asset.status === 'Scrapped' || asset.archived) return error('Asset already scrapped/archived');
    
    // Get category type
    const category = await db.collection('categories').findOne({ id: asset.category });
    const isSubscription = category && category.category_type === 'SUBSCRIPTION';
    
    // Unassign if assigned
    if (['Assigned', 'Temporarily Assigned', 'Handed Over (Vacation Coverage)'].includes(asset.status)) {
      await db.collection('assignments').updateMany(
        { asset_id, unassigned_date: null },
        { $set: { unassigned_date: new Date().toISOString().split('T')[0] } }
      );
    }
    
    // For subscriptions: mark as "Canceled", for others: "Scrapped"
    const newStatus = isSubscription ? 'Canceled' : 'Scrapped';
    const actionText = isSubscription ? 'CANCELED' : 'SCRAPPED';
    
    await db.collection('assets').updateOne(
      { id: asset_id },
      { 
        $set: { 
          status: newStatus, 
          assigned_to: null, 
          scrapped_at: new Date().toISOString(), 
          scrap_reason: reason || '',
          archived: true // Archive scrapped/canceled assets
        } 
      }
    );
    
    await logAudit(db, user.id, actionText, 'asset', asset_id, { reason });
    await logActivity(db, asset_id, actionText, reason || `Asset ${newStatus.toLowerCase()}`, user.id, user.name);
    
    return json({ success: true, action: actionText });
  }
  
  // Scrap from maintenance
  if (route === 'maintenance/scrap') {
    if (!canAccess(user.role, 'maintenance')) return error('Forbidden', 403);
    
    const body = await request.json();
    const { asset_id, reason, maintenance_id } = body;
    
    if (!asset_id) return error('Asset ID required');
    
    const asset = await db.collection('assets').findOne({ id: asset_id });
    if (!asset) return error('Asset not found', 404);
    
    // Get category type
    const category = await db.collection('categories').findOne({ id: asset.category });
    const isSubscription = category && category.category_type === 'SUBSCRIPTION';
    
    const newStatus = isSubscription ? 'Canceled' : 'Scrapped';
    const actionText = isSubscription ? 'CANCELED' : 'SCRAPPED';
    
    // Unassign if still assigned
    await db.collection('assignments').updateMany(
      { asset_id, unassigned_date: null },
      { $set: { unassigned_date: new Date().toISOString().split('T')[0] } }
    );
    
    await db.collection('assets').updateOne(
      { id: asset_id },
      { 
        $set: { 
          status: newStatus, 
          assigned_to: null, 
          scrapped_at: new Date().toISOString(), 
          scrap_reason: reason || '',
          archived: true
        } 
      }
    );
    
    // Update maintenance record if provided
    if (maintenance_id) {
      await db.collection('maintenance').updateOne(
        { id: maintenance_id },
        { 
          $set: { 
            status: 'scrapped',
            completed_at: new Date().toISOString()
          } 
        }
      );
    }
    
    await logAudit(db, user.id, actionText, 'asset', asset_id, { reason });
    await logActivity(db, asset_id, actionText, reason || `Asset ${newStatus.toLowerCase()} from maintenance`, user.id, user.name);
    
    return json({ success: true, action: actionText });
  }

  // ============ ASSET DOCUMENTS ============

  if (route === 'assets/documents') {
    const canUpload = ['super_admin', 'it_admin', 'it_technician'].includes(user.role);
    if (!canUpload) return error('Forbidden', 403);
    const formData = await request.formData();
    const file = formData.get('file');
    const assetId = formData.get('asset_id');
    const docType = formData.get('doc_type') || 'note';
    const notes = formData.get('notes') || '';
    const month = formData.get('month') || null;           // subscription_invoice
    const handoverDate = formData.get('handover_date') || null; // custody types
    const returnDate = formData.get('return_date') || null;     // temp_custody_handover
    const fromPerson = formData.get('from_person') || '';
    const toPerson = formData.get('to_person') || '';
    const tempCustodian = formData.get('temp_custodian') || '';

    if (!file || typeof file === 'string') return error('No file provided', 400);
    if (!assetId) return error('asset_id required', 400);

    const asset = await db.collection('assets').findOne({ id: assetId });
    if (!asset) return error('Asset not found', 404);

    // Per-type size and mime validation
    const pdfOnly = ['application/pdf'];
    const pdfImageTypes = ['application/pdf', 'image/jpeg', 'image/png'];
    const typeRules = {
      note:                  { maxSize: 5 * 1024 * 1024,  allowed: pdfOnly,       label: '5MB, PDF only' },
      invoice:               { maxSize: 10 * 1024 * 1024, allowed: pdfImageTypes, label: '10MB, PDF/JPG/PNG' },
      subscription_invoice:  { maxSize: 10 * 1024 * 1024, allowed: pdfOnly,       label: '10MB, PDF only' },
      custody_handover:      { maxSize: 10 * 1024 * 1024, allowed: pdfOnly,       label: '10MB, PDF only' },
      temp_custody_handover: { maxSize: 10 * 1024 * 1024, allowed: pdfOnly,       label: '10MB, PDF only' },
    };
    const rule = typeRules[docType] || typeRules.note;
    const mimeType = file.type || 'application/octet-stream';
    const bytes = await file.arrayBuffer();
    if (bytes.byteLength > rule.maxSize) return error(`File too large. Max ${rule.label}`, 400);
    if (!rule.allowed.includes(mimeType)) return error(`Invalid file type for this document type. Allowed: ${rule.label}`, 400);

    const uploadDir = process.env.UPLOAD_DIR || '/app/uploads';
    await mkdir(uploadDir, { recursive: true });
    const ext = file.name.split('.').pop().toLowerCase();
    const storedFilename = `${uuidv4()}.${ext}`;
    await writeFile(path.join(uploadDir, storedFilename), Buffer.from(bytes));

    const docEntry = {
      id: uuidv4(),
      asset_id: assetId,
      filename: file.name,
      stored_filename: storedFilename,
      mime_type: mimeType,
      size: bytes.byteLength,
      doc_type: docType,
      notes,
      month: docType === 'subscription_invoice' ? month : null,
      handover_date: ['custody_handover', 'temp_custody_handover'].includes(docType) ? handoverDate : null,
      return_date: docType === 'temp_custody_handover' ? returnDate : null,
      from_person: docType === 'custody_handover' ? fromPerson : null,
      to_person: docType === 'custody_handover' ? toPerson : null,
      temp_custodian: docType === 'temp_custody_handover' ? tempCustodian : null,
      uploaded_at: new Date().toISOString(),
      uploaded_by: user.id,
      uploaded_by_name: user.name
    };

    await db.collection('asset_documents').insertOne(docEntry);
    await logAudit(db, user.id, 'UPLOAD_DOCUMENT', 'asset', assetId, { filename: file.name, doc_type: docType });

    return json(docEntry, 201);
  }

  // ============ VACATION WORKFLOW ============

  // Start vacation — create handover records and immediately process asset routing
  if (route === 'vacation/start') {
    if (!['super_admin', 'it_admin'].includes(user.role)) return error('Forbidden', 403);
    const body = await request.json();
    const { employee_id, vacation_start, vacation_end, asset_handovers } = body;
    if (!employee_id || !vacation_start || !vacation_end || !Array.isArray(asset_handovers)) return error('employee_id, vacation_start, vacation_end, asset_handovers required');

    const employee = await db.collection('employees').findOne({ id: employee_id });
    if (!employee) return error('Employee not found', 404);

    await db.collection('employees').updateOne({ id: employee_id }, {
      $set: {
        status: 'On Vacation',
        vacation_start_date: vacation_start,
        vacation_end_date: vacation_end,
        vacation_status: {
          onVacation: true,
          vacationStart: vacation_start,
          vacationEnd: vacation_end,
          extended: false,
          extensionHistory: []
        }
      }
    });

    const createdHandovers = [];
    for (const { asset_id, handoverType, tempEmployeeId, remoteApprovedBy, remoteNotes } of asset_handovers) {
      const type = handoverType || 'stock';

      // Close current assignment
      await db.collection('assignments').updateMany(
        { asset_id, unassigned_date: null },
        { $set: { unassigned_date: new Date().toISOString(), unassigned_by: user.id } }
      );

      // Route the asset immediately — no approval step
      if (type === 'stock') {
        await db.collection('assets').updateOne({ id: asset_id }, {
          $set: { status: 'In Stock', assigned_to: null, vacation_remote: false }
        });
        await logActivity(db, asset_id, 'VACATION_STOCK', `Returned to stock during ${employee.name}'s vacation`, user.id, user.name);
      } else if (type === 'employee' && tempEmployeeId) {
        const tempEmp = await db.collection('employees').findOne({ id: tempEmployeeId });
        await db.collection('assignments').insertOne({
          id: uuidv4(), asset_id, employee_id: tempEmployeeId,
          original_employee_id: employee_id, assignment_type: 'Vacation Handover',
          assigned_date: new Date().toISOString(), assigned_by: user.id, unassigned_date: null
        });
        await db.collection('assets').updateOne({ id: asset_id }, {
          $set: { status: 'Temporarily Assigned', assigned_to: tempEmployeeId, vacation_remote: false }
        });
        await logActivity(db, asset_id, 'VACATION_HANDOVER', `Handed to ${tempEmp?.name} during ${employee.name}'s vacation. Custody form required.`, user.id, user.name);
      } else if (type === 'remote') {
        // Asset stays with original employee — mark as remote
        await db.collection('assignments').insertOne({
          id: uuidv4(), asset_id, employee_id,
          assignment_type: 'Normal', assigned_date: new Date().toISOString(), assigned_by: user.id, unassigned_date: null
        });
        await db.collection('assets').updateOne({ id: asset_id }, {
          $set: { status: 'Assigned', assigned_to: employee_id, vacation_remote: true }
        });
        await logActivity(db, asset_id, 'VACATION_REMOTE', `Asset retained by ${employee.name} during vacation for remote work. Approved by ${remoteApprovedBy || 'manager'}.`, user.id, user.name);
      }

      const doc = {
        id: uuidv4(),
        asset_id,
        originalEmployeeId: employee_id,
        handoverType: type,
        tempEmployeeId: type === 'employee' ? (tempEmployeeId || null) : null,
        tempCustodyDocId: null,
        remoteApprovedBy: type === 'remote' ? (remoteApprovedBy || '') : null,
        remoteNotes: type === 'remote' ? (remoteNotes || '') : null,
        vacationStart: vacation_start,
        vacationEnd: vacation_end,
        status: 'active',
        doc_uploaded: false,
        temp_custody_doc: null,
        receipt_confirmed: null,
        returnedAt: null,
        createdAt: new Date().toISOString()
      };
      await db.collection('vacation_handovers').insertOne(doc);
      createdHandovers.push(doc);
    }

    await logAudit(db, user.id, 'VACATION_STARTED', 'employee', employee_id, { vacation_start, vacation_end, asset_count: asset_handovers.length });
    return json({ success: true, handovers: createdHandovers });
  }

  // Upload signed custody doc for an employee-type handover
  if (pathSegments[0] === 'vacation' && pathSegments[1] === 'handover' && pathSegments[3] === 'upload-doc' && pathSegments.length === 4) {
    if (!['super_admin', 'it_admin'].includes(user.role)) return error('Forbidden', 403);
    const handoverId = pathSegments[2];
    const handover = await db.collection('vacation_handovers').findOne({ id: handoverId });
    if (!handover) return error('Handover not found', 404);

    const fd = await request.formData();
    const file = fd.get('file');
    if (!file || typeof file === 'string') return error('No file provided', 400);
    const bytes = await file.arrayBuffer();
    if (bytes.byteLength > 10 * 1024 * 1024) return error('File too large. Max 10MB', 400);
    if (file.type !== 'application/pdf') return error('Only PDF files allowed', 400);

    const uploadDir = process.env.UPLOAD_DIR || '/app/uploads';
    await mkdir(uploadDir, { recursive: true });
    const storedFilename = `${uuidv4()}.pdf`;
    await writeFile(path.join(uploadDir, storedFilename), Buffer.from(bytes));

    const docEntry = { id: uuidv4(), filename: file.name, stored_filename: storedFilename, size: bytes.byteLength, uploaded_at: new Date().toISOString(), uploaded_by: user.id };
    await db.collection('vacation_handovers').updateOne({ id: handoverId }, { $set: { doc_uploaded: true, temp_custody_doc: docEntry } });
    return json({ success: true, document: docEntry });
  }

  // Confirm physical receipt of asset (employee-type handovers only)
  if (pathSegments[0] === 'vacation' && pathSegments[1] === 'handover' && pathSegments[3] === 'confirm-receipt' && pathSegments.length === 4) {
    if (!['super_admin', 'it_admin'].includes(user.role)) return error('Forbidden', 403);
    const handoverId = pathSegments[2];
    const body = await request.json();
    const { received, note } = body;
    const handover = await db.collection('vacation_handovers').findOne({ id: handoverId });
    if (!handover) return error('Handover not found', 404);
    await db.collection('vacation_handovers').updateOne({ id: handoverId }, { $set: {
      receipt_confirmed: received !== false,
      receipt_confirmed_at: new Date().toISOString(),
      receipt_confirmed_by: user.id,
      receipt_note: note || ''
    }});
    await logAudit(db, user.id, 'RECEIPT_CONFIRMED', 'vacation_handover', handoverId, { received, note });
    return json({ success: true });
  }

  // Return asset from vacation handover
  if (pathSegments[0] === 'vacation' && pathSegments[1] === 'handover' && pathSegments[3] === 'return' && pathSegments.length === 4) {
    if (!['super_admin', 'it_admin'].includes(user.role)) return error('Forbidden', 403);
    const handoverId = pathSegments[2];
    const handover = await db.collection('vacation_handovers').findOne({ id: handoverId });
    if (!handover) return error('Handover not found', 404);

    await db.collection('assignments').updateMany(
      { asset_id: handover.asset_id, unassigned_date: null },
      { $set: { unassigned_date: new Date().toISOString(), unassigned_by: user.id } }
    );
    await db.collection('assignments').insertOne({
      id: uuidv4(), asset_id: handover.asset_id, employee_id: handover.originalEmployeeId,
      assignment_type: 'Normal', assigned_date: new Date().toISOString(), assigned_by: user.id, unassigned_date: null
    });
    await db.collection('assets').updateOne({ id: handover.asset_id }, {
      $set: { status: 'Assigned', assigned_to: handover.originalEmployeeId, vacation_remote: false }
    });
    await db.collection('vacation_handovers').updateOne({ id: handoverId }, {
      $set: { status: 'returned', returnedAt: new Date().toISOString() }
    });
    return json({ success: true });
  }

  // Extend vacation
  if (route === 'vacation/extend') {
    if (!['super_admin', 'it_admin'].includes(user.role)) return error('Forbidden', 403);
    const { employee_id, new_end_date, reason } = await request.json();
    if (!employee_id || !new_end_date || !reason) return error('employee_id, new_end_date, and reason are required');

    const employee = await db.collection('employees').findOne({ id: employee_id });
    if (!employee) return error('Employee not found', 404);

    const extensionEntry = { extended_on: new Date().toISOString(), new_end_date, reason };
    await db.collection('employees').updateOne({ id: employee_id }, {
      $set: { vacation_end_date: new_end_date, 'vacation_status.vacationEnd': new_end_date, 'vacation_status.extended': true },
      $push: { 'vacation_status.extensionHistory': extensionEntry }
    });
    await db.collection('vacation_handovers').updateMany(
      { originalEmployeeId: employee_id, status: 'active' },
      { $set: { vacationEnd: new_end_date } }
    );
    await logAudit(db, user.id, 'VACATION_EXTENDED', 'employee', employee_id, { new_end_date, reason });
    return json({ success: true });
  }

  // ============ ASSET AUDITS (POST) ============

  // POST /api/audits — create manual audit
  if (route === 'audits') {
    if (!['super_admin', 'it_admin', 'it_technician'].includes(user.role)) return error('Forbidden', 403);
    const body = await request.json();
    const { asset_id, scheduled_date } = body;
    if (!asset_id) return error('asset_id required');
    const asset = await db.collection('assets').findOne({ id: asset_id });
    if (!asset) return error('Asset not found', 404);
    const todayStr = new Date().toISOString().split('T')[0];
    const audit = {
      id: uuidv4(), assetId: asset_id, employeeId: asset.assigned_to || null,
      conductedBy: null, scheduledDate: scheduled_date || todayStr, conductedDate: null,
      status: 'scheduled', result: null,
      checklist: DEFAULT_CHECKLIST.map(item => ({ item, status: 'na', notes: '' })),
      overallNotes: '', followUpRequired: false, followUpNotes: '', attachments: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    await db.collection('assetAudits').insertOne(audit);
    return json(audit, 201);
  }

  // POST /api/audits/schedule — run rolling schedule manually
  if (route === 'audits/schedule') {
    if (!['super_admin', 'it_admin'].includes(user.role)) return error('Forbidden', 403);
    await runAuditSchedule(db);
    return json({ success: true });
  }

  // POST /api/audits/:id/complete — submit checklist results
  if (pathSegments[0] === 'audits' && pathSegments[2] === 'complete' && pathSegments.length === 3) {
    if (!['super_admin', 'it_admin', 'it_technician'].includes(user.role)) return error('Forbidden', 403);
    const auditId = pathSegments[1];
    const body = await request.json();
    const { checklist, overall_notes, follow_up_required, follow_up_notes, result } = body;
    const audit = await db.collection('assetAudits').findOne({ id: auditId });
    if (!audit) return error('Audit not found', 404);
    const todayStr = new Date().toISOString().split('T')[0];
    const nextAuditDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    await db.collection('assetAudits').updateOne({ id: auditId }, { $set: {
      checklist: checklist || audit.checklist,
      overallNotes: overall_notes || '',
      followUpRequired: follow_up_required || false,
      followUpNotes: follow_up_notes || '',
      result: result || 'pass',
      conductedBy: user.id,
      conductedDate: todayStr,
      status: 'completed',
      updatedAt: new Date().toISOString()
    }});
    // Update asset with last audit info
    await db.collection('assets').updateOne({ id: audit.assetId }, { $set: {
      last_audit_date: todayStr,
      last_audit_result: result || 'pass',
      next_audit_date: nextAuditDate,
      updated_at: new Date().toISOString()
    }});
    // Schedule the next audit (2 months from now)
    await db.collection('assetAudits').insertOne({
      id: uuidv4(), assetId: audit.assetId, employeeId: audit.employeeId,
      conductedBy: null, scheduledDate: nextAuditDate, conductedDate: null,
      status: 'scheduled', result: null,
      checklist: DEFAULT_CHECKLIST.map(item => ({ item, status: 'na', notes: '' })),
      overallNotes: '', followUpRequired: false, followUpNotes: '', attachments: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    });
    await logAudit(db, user.id, 'AUDIT_COMPLETED', 'asset', audit.assetId, { audit_id: auditId, result: result || 'pass' });
    return json({ success: true, next_audit_date: nextAuditDate });
  }

  // POST /api/audits/:id/attachments — upload file to audit
  if (pathSegments[0] === 'audits' && pathSegments[2] === 'attachments' && pathSegments.length === 3) {
    if (!['super_admin', 'it_admin', 'it_technician'].includes(user.role)) return error('Forbidden', 403);
    const auditId = pathSegments[1];
    const audit = await db.collection('assetAudits').findOne({ id: auditId });
    if (!audit) return error('Audit not found', 404);
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file) return error('File required');
    const bytes = await file.arrayBuffer();
    if (bytes.byteLength > 10 * 1024 * 1024) return error('File too large. Max 10MB');
    const uploadDir = process.env.UPLOAD_DIR || '/app/uploads';
    await mkdir(uploadDir, { recursive: true });
    const ext = file.name.split('.').pop().toLowerCase();
    const storedFilename = `audit_${uuidv4()}.${ext}`;
    await writeFile(path.join(uploadDir, storedFilename), Buffer.from(bytes));
    const attachment = { id: uuidv4(), fileName: file.name, filePath: `/uploads/${storedFilename}`, uploadedAt: new Date().toISOString() };
    await db.collection('assetAudits').updateOne({ id: auditId }, {
      $push: { attachments: attachment },
      $set: { updatedAt: new Date().toISOString() }
    });
    return json(attachment, 201);
  }

  // POST /api/extensions — create
  if (route === 'extensions') {
    if (!['super_admin', 'it_admin'].includes(user.role)) return error('Forbidden', 403);
    const body = await request.json();
    const { extensionNumber, permission } = body;
    if (!extensionNumber?.trim()) return error('extensionNumber is required');
    if (!body.assignedTo) return error('assignedTo is required');
    if (!['internal', 'local', 'international'].includes(permission)) return error('Invalid permission');
    const existing = await db.collection('extensions').findOne({ extensionNumber: extensionNumber.trim() });
    if (existing) return error(`Extension ${extensionNumber} already exists`, 409);
    const assignedEmployee = await db.collection('employees').findOne({ id: body.assignedTo });
    if (!assignedEmployee) return error('Assigned employee not found', 404);
    const doc = {
      id: uuidv4(),
      extensionNumber: extensionNumber.trim(),
      name: assignedEmployee.name || extensionNumber.trim(),
      departmentId: body.departmentId || null,
      locationId: body.locationId || null,
      permission,
      assignedTo: body.assignedTo,
      notes: body.notes || '',
      isActive: body.isActive !== false,
      createdBy: user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await db.collection('extensions').insertOne(doc);
    await logAudit(db, user.id, 'CREATE', 'extension', doc.id, { extensionNumber: doc.extensionNumber });
    return json({ success: true, extension: doc });
  }

  // POST /api/assets/:id/addons — add addon to asset
  if (pathSegments[0] === 'assets' && pathSegments[2] === 'addons' && pathSegments.length === 3) {
    if (!['super_admin', 'it_admin', 'it_technician'].includes(user.role)) return error('Forbidden', 403);
    const assetId = pathSegments[1];
    const asset = await db.collection('assets').findOne({ id: assetId });
    if (!asset) return error('Asset not found', 404);
    const body = await request.json();
    const { name, provider, cost, currency, billingCycle, startDate, renewalDate, notes } = body;
    if (!name || !billingCycle) return error('Name and billing cycle are required', 400);
    const addon = {
      id: uuidv4(),
      name: name.trim(),
      provider: provider?.trim() || '',
      cost: cost ? parseFloat(cost) : null,
      currency: currency || 'USD',
      billingCycle,
      startDate: startDate || null,
      renewalDate: renewalDate || null,
      status: 'active',
      notes: notes?.trim() || '',
      addedBy: user.id,
      addedAt: new Date().toISOString()
    };
    await db.collection('assets').updateOne({ id: assetId }, { $push: { addons: addon } });
    await logAudit(db, user.id, 'ADD_ADDON', 'asset', assetId, { addonId: addon.id, name: addon.name });
    return json({ success: true, addon });
  }

  // POST /api/settings/smtp — save SMTP config
  if (route === 'settings/smtp') {
    if (user.role !== 'super_admin') return error('Forbidden', 403);
    const body = await request.json();
    const { host, port, secure, user: smtpUser, pass, fromName, fromAddress } = body;
    if (!host || !smtpUser) return error('Host and username are required');

    // If pass is the masked placeholder, keep the existing password
    let finalPass = pass;
    if (pass === '••••••••') {
      const existing = await db.collection('settings').findOne({ key: 'smtp' });
      finalPass = existing?.value?.pass || '';
    }

    const value = { host, port: parseInt(port, 10) || 587, secure: secure || 'tls', user: smtpUser, pass: finalPass, fromName: fromName || '', fromAddress: fromAddress || smtpUser };
    await db.collection('settings').updateOne(
      { key: 'smtp' },
      { $set: { key: 'smtp', value, updatedAt: new Date().toISOString() } },
      { upsert: true }
    );
    await logAudit(db, user.id, 'UPDATE', 'settings', 'smtp', { host });
    return json({ success: true });
  }

  // POST /api/settings/smtp/test — send test email to logged-in admin
  if (route === 'settings/smtp/test') {
    if (user.role !== 'super_admin') return error('Forbidden', 403);
    const adminUser = await db.collection('users').findOne({ id: user.id });
    const to = adminUser?.email;
    if (!to) return error('No email address found for your account');
    try {
      const result = await sendMail({
        to,
        subject: '[ITdock] Test Email — Configuration Working',
        text: 'This is a test email from ITdock. Your email configuration is working correctly.',
        html: '<p>This is a test email from <strong>ITdock</strong>. Your email configuration is working correctly.</p>'
      });
      if (result.skipped) return error('SMTP is not configured. Save settings first.', 400);
      return json({ success: true, to });
    } catch (err) {
      return error(`Email failed: ${err.message}`, 400);
    }
  }

  return error('Not found', 404);
  } catch (err) {
    console.error('POST handler error:', err);
    return error(err.message || 'Internal server error', 500);
  }
}

export async function PUT(request, { params }) {
  const db = await getDb();
  const pathSegments = params.path || [];
  const route = pathSegments.join('/');
  const user = await getAuthUser(request, db);

  if (!user) return error('Unauthorized', 401);

  // ============ MASTER DATA UPDATES ============
  
  if (route.startsWith('companies/') && pathSegments.length === 2) {
    if (!['super_admin', 'it_admin'].includes(user.role)) return error('Forbidden', 403);
    
    const id = pathSegments[1];
    const body = await request.json();
    
    const updates = { ...body, updated_at: new Date().toISOString() };
    delete updates.id;
    delete updates.created_at;
    
    await db.collection('companies').updateOne({ id }, { $set: updates });
    await logAudit(db, user.id, 'UPDATE', 'company', id, { fields: Object.keys(body) });
    
    return json({ success: true });
  }
  
  if (route.startsWith('projects/') && pathSegments.length === 2) {
    if (!['super_admin', 'it_admin'].includes(user.role)) return error('Forbidden', 403);
    
    const id = pathSegments[1];
    const body = await request.json();
    
    const updates = { ...body, updated_at: new Date().toISOString() };
    delete updates.id;
    delete updates.created_at;
    
    await db.collection('projects').updateOne({ id }, { $set: updates });
    await logAudit(db, user.id, 'UPDATE', 'project', id, { fields: Object.keys(body) });
    
    return json({ success: true });
  }
  
  if (route.startsWith('locations/') && pathSegments.length === 2) {
    if (!['super_admin', 'it_admin'].includes(user.role)) return error('Forbidden', 403);
    
    const id = pathSegments[1];
    const body = await request.json();
    
    const updates = { ...body, updated_at: new Date().toISOString() };
    delete updates.id;
    delete updates.created_at;
    
    await db.collection('locations').updateOne({ id }, { $set: updates });
    await logAudit(db, user.id, 'UPDATE', 'location', id, { fields: Object.keys(body) });
    
    return json({ success: true });
  }
  
  if (route.startsWith('departments/') && pathSegments.length === 2) {
    if (!['super_admin', 'it_admin'].includes(user.role)) return error('Forbidden', 403);
    
    const id = pathSegments[1];
    const body = await request.json();
    
    const updates = { ...body, updated_at: new Date().toISOString() };
    delete updates.id;
    delete updates.created_at;
    
    await db.collection('departments').updateOne({ id }, { $set: updates });
    await logAudit(db, user.id, 'UPDATE', 'department', id, { fields: Object.keys(body) });
    
    return json({ success: true });
  }
  
  if ((route.startsWith('asset-categories/') || route.startsWith('categories/')) && pathSegments.length === 2) {
    if (!['super_admin', 'it_admin'].includes(user.role)) return error('Forbidden', 403);

    const id = pathSegments[1];
    const body = await request.json();

    if (body.category_type && !['STORABLE', 'CONSUMABLE', 'SUBSCRIPTION'].includes(body.category_type)) {
      return error('Invalid category type');
    }

    const updates = { ...body, updated_at: new Date().toISOString() };
    delete updates.id;
    delete updates.created_at;
    if (body.name) { updates.hasSpecs = computeHasSpecs(body.name); updates.isIoT = computeIsIoT(body.name); }

    await db.collection('categories').updateOne({ id }, { $set: updates });
    await logAudit(db, user.id, 'UPDATE', 'category', id, { fields: Object.keys(body) });

    return json({ success: true });
  }

  // ============ USERS ============
  
  if (route.startsWith('users/') && pathSegments.length === 2) {
    const userId = pathSegments[1];
    
    if (user.id !== userId && user.role !== 'super_admin') {
      return error('Forbidden', 403);
    }
    
    const body = await request.json();
    const updates = {};
    
    if (body.name) updates.name = body.name;
    
    // Allow email editing with uniqueness check
    if (body.email) {
      const existingUser = await db.collection('users').findOne({ 
        email: body.email, 
        id: { $ne: userId } 
      });
      if (existingUser) return error('Email already in use by another user');
      updates.email = body.email;
    }
    
    if (body.password) {
      updates.password = hashPassword(body.password);
      updates.is_default_password = false; // Clear default password flag when password is changed
    }
    if (body.role && user.role === 'super_admin') updates.role = body.role;
    
    await db.collection('users').updateOne({ id: userId }, { $set: updates });
    await logAudit(db, user.id, 'UPDATE', 'user', userId, { fields: Object.keys(updates) });
    
    return json({ success: true });
  }

  // ============ EMPLOYEES ============
  
  if (route.startsWith('employees/') && pathSegments.length === 2) {
    if (!canAccess(user.role, 'employees')) return error('Forbidden', 403);
    
    const empId = pathSegments[1];
    const body = await request.json();
    
    const employee = await db.collection('employees').findOne({ id: empId });
    if (!employee) return error('Employee not found', 404);
    
    // Validate manager hierarchy if manager_id is being updated
    if (body.manager_id && body.manager_id !== employee.manager_id) {
      const isCircular = await checkManagerHierarchy(db, empId, body.manager_id);
      if (isCircular) {
        return error('Cannot set this manager - would create circular reporting');
      }
    }
    
    const oldStatus = employee.status;
    const newStatus = body.status;
    
    // Handle vacation workflow
    if (newStatus === 'On Vacation' && oldStatus !== 'On Vacation') {
      if (!body.vacation_start_date || !body.vacation_end_date) {
        return error('Vacation start and end dates required');
      }
      
      // Handle assets based on vacation_action
      if (body.vacation_action === 'handover' && body.handover_employee_id) {
        const assignments = await db.collection('assignments').find({ 
          employee_id: empId, 
          unassigned_date: null 
        }).toArray();
        
        const handoverEmployee = await db.collection('employees').findOne({ id: body.handover_employee_id });
        
        for (const assignment of assignments) {
          // Close current assignment
          await db.collection('assignments').updateOne(
            { id: assignment.id },
            { $set: { unassigned_date: new Date().toISOString().split('T')[0] } }
          );
          
          // Create vacation handover assignment
          const newAssignment = {
            id: uuidv4(),
            asset_id: assignment.asset_id,
            employee_id: body.handover_employee_id,
            assigned_date: new Date().toISOString().split('T')[0],
            unassigned_date: null,
            assignment_type: 'Vacation Handover',
            original_employee_id: empId,
            custody_docs: []
          };
          
          await db.collection('assignments').insertOne(newAssignment);
          await db.collection('assets').updateOne(
            { id: assignment.asset_id },
            { $set: { status: 'Handed Over (Vacation Coverage)', assigned_to: body.handover_employee_id } }
          );
          
          await logActivity(db, assignment.asset_id, 'VACATION_HANDOVER', 
            `Handed over from ${employee.name} to ${handoverEmployee?.name} (Vacation)`, user.id, user.name);
        }
      } else if (body.vacation_action === 'return_to_stock') {
        const assignments = await db.collection('assignments').find({ 
          employee_id: empId, 
          unassigned_date: null 
        }).toArray();
        
        for (const assignment of assignments) {
          await db.collection('assignments').updateOne(
            { id: assignment.id },
            { $set: { unassigned_date: new Date().toISOString().split('T')[0] } }
          );
          await db.collection('assets').updateOne(
            { id: assignment.asset_id },
            { $set: { status: 'In Stock', assigned_to: null } }
          );
          await logActivity(db, assignment.asset_id, 'RETURNED_TO_STOCK', 
            `Returned from ${employee.name} (Vacation)`, user.id, user.name);
        }
      }
    }
    
    // Handle resignation workflow
    if (newStatus === 'Resigned' && oldStatus !== 'Resigned') {
      // Check if employee has active assets
      const activeAssets = await db.collection('assignments').countDocuments({
        employee_id: empId,
        unassigned_date: null
      });
      
      if (activeAssets > 0) {
        return error(`Cannot resign employee with ${activeAssets} active asset(s). Please unassign all assets first.`);
      }
      
      await logAudit(db, user.id, 'RESIGN', 'employee', empId, { name: employee.name });
    }
    
    const updateData = { ...body, updated_at: new Date().toISOString() };
    delete updateData.id;
    delete updateData.created_at;
    delete updateData.vacation_action;
    delete updateData.handover_employee_id;
    delete updateData.assigned_assets;
    delete updateData.assignment_history;
    
    // Archive resigned employees
    if (newStatus === 'Resigned' && oldStatus !== 'Resigned') {
      updateData.archived = true;
      updateData.resigned_at = new Date().toISOString();
    }
    
    await db.collection('employees').updateOne({ id: empId }, { $set: updateData });
    await logAudit(db, user.id, 'UPDATE', 'employee', empId, { fields: Object.keys(body), status_change: oldStatus !== newStatus ? `${oldStatus} -> ${newStatus}` : null });
    
    return json({ success: true });
  }

  // ============ ASSETS ============
  
  if (route.startsWith('assets/') && pathSegments.length === 2) {
    if (!canAccess(user.role, 'assets')) return error('Forbidden', 403);
    
    const assetId = pathSegments[1];
    const body = await request.json();
    
    const asset = await db.collection('assets').findOne({ id: assetId });
    if (!asset) return error('Asset not found', 404);
    
    const updates = { ...body, updated_at: new Date().toISOString() };
    delete updates.id;
    delete updates.created_at;
    delete updates.activity_log;
    delete updates.current_assignment;
    delete updates.assigned_employee;
    delete updates.warranty_status;
    delete updates.expiry_status;
    
    await db.collection('assets').updateOne({ id: assetId }, { $set: updates });
    await logAudit(db, user.id, 'UPDATE', 'asset', assetId, { fields: Object.keys(body) });
    await logActivity(db, assetId, 'UPDATED', `Asset details updated`, user.id, user.name);
    
    return json({ success: true });
  }

  // PUT /api/audits/:id — update audit (status, checklist, notes)
  if (route.startsWith('audits/') && pathSegments.length === 2) {
    if (!['super_admin', 'it_admin', 'it_technician'].includes(user.role)) return error('Forbidden', 403);
    const auditId = pathSegments[1];
    const body = await request.json();
    const audit = await db.collection('assetAudits').findOne({ id: auditId });
    if (!audit) return error('Audit not found', 404);
    const updates = { updatedAt: new Date().toISOString() };
    if (body.status) updates.status = body.status;
    if (body.checklist) updates.checklist = body.checklist;
    if (body.overallNotes !== undefined) updates.overallNotes = body.overallNotes;
    if (body.followUpRequired !== undefined) updates.followUpRequired = body.followUpRequired;
    if (body.followUpNotes !== undefined) updates.followUpNotes = body.followUpNotes;
    if (body.result) updates.result = body.result;
    await db.collection('assetAudits').updateOne({ id: auditId }, { $set: updates });
    return json({ success: true });
  }

  // Revoke a specific session
  if (route.startsWith('auth/sessions/') && pathSegments.length === 3) {
    const sessionId = pathSegments[2];
    await db.collection('sessions').deleteOne({ id: sessionId, user_id: user.id });
    return json({ success: true });
  }

  // Revoke an API key
  if (route.startsWith('auth/api-keys/') && pathSegments.length === 3) {
    const keyId = pathSegments[2];
    const result = await db.collection('api_keys').deleteOne({ id: keyId, user_id: user.id });
    if (result.deletedCount === 0) return error('Key not found', 404);
    await logAudit(db, user.id, 'DELETE_API_KEY', 'api_key', keyId, {});
    return json({ success: true });
  }

  // PUT /api/assets/:id/addons/:addonId — update addon
  if (pathSegments[0] === 'assets' && pathSegments[2] === 'addons' && pathSegments.length === 4) {
    if (!['super_admin', 'it_admin', 'it_technician'].includes(user.role)) return error('Forbidden', 403);
    const assetId = pathSegments[1];
    const addonId = pathSegments[3];
    const asset = await db.collection('assets').findOne({ id: assetId });
    if (!asset) return error('Asset not found', 404);
    const addonIdx = (asset.addons || []).findIndex(a => a.id === addonId);
    if (addonIdx === -1) return error('Addon not found', 404);
    const body = await request.json();
    const existing = asset.addons[addonIdx];
    const updated = {
      ...existing,
      name: body.name?.trim() || existing.name,
      provider: body.provider !== undefined ? (body.provider?.trim() || '') : existing.provider,
      cost: body.cost !== undefined ? (body.cost ? parseFloat(body.cost) : null) : existing.cost,
      currency: body.currency || existing.currency,
      billingCycle: body.billingCycle || existing.billingCycle,
      startDate: body.startDate !== undefined ? (body.startDate || null) : existing.startDate,
      renewalDate: body.renewalDate !== undefined ? (body.renewalDate || null) : existing.renewalDate,
      status: body.status || existing.status,
      notes: body.notes !== undefined ? (body.notes?.trim() || '') : existing.notes,
      updatedBy: user.id,
      updatedAt: new Date().toISOString()
    };
    await db.collection('assets').updateOne(
      { id: assetId },
      { $set: { [`addons.${addonIdx}`]: updated } }
    );
    await logAudit(db, user.id, 'UPDATE_ADDON', 'asset', assetId, { addonId, name: updated.name });
    return json({ success: true, addon: updated });
  }

  // PUT /api/extensions/:id — update
  if (pathSegments[0] === 'extensions' && pathSegments.length === 2) {
    if (!['super_admin', 'it_admin'].includes(user.role)) return error('Forbidden', 403);
    const extId = pathSegments[1];
    const body = await request.json();
    const existing = await db.collection('extensions').findOne({ id: extId });
    if (!existing) return error('Extension not found', 404);
    if (body.extensionNumber && body.extensionNumber.trim() !== existing.extensionNumber) {
      const dup = await db.collection('extensions').findOne({ extensionNumber: body.extensionNumber.trim(), id: { $ne: extId } });
      if (dup) return error(`Extension ${body.extensionNumber} already exists`, 409);
    }
    let assignedEmployee = null;
    if (body.assignedTo !== undefined) {
      if (!body.assignedTo) return error('assignedTo is required');
      assignedEmployee = await db.collection('employees').findOne({ id: body.assignedTo });
      if (!assignedEmployee) return error('Assigned employee not found', 404);
    }
    const updates = {
      extensionNumber: body.extensionNumber?.trim() || existing.extensionNumber,
      name: assignedEmployee?.name || body.name?.trim() || existing.name,
      departmentId: body.departmentId !== undefined ? (body.departmentId || null) : existing.departmentId,
      locationId: body.locationId !== undefined ? (body.locationId || null) : existing.locationId,
      permission: body.permission || existing.permission,
      assignedTo: body.assignedTo !== undefined ? body.assignedTo : existing.assignedTo,
      notes: body.notes !== undefined ? body.notes : existing.notes,
      isActive: body.isActive !== undefined ? body.isActive : existing.isActive,
      updatedAt: new Date().toISOString()
    };
    await db.collection('extensions').updateOne({ id: extId }, { $set: updates });
    await logAudit(db, user.id, 'UPDATE', 'extension', extId, { extensionNumber: updates.extensionNumber });
    return json({ success: true });
  }

  return error('Not found', 404);
}

export async function DELETE(request, { params }) {
  const db = await getDb();
  const pathSegments = params.path || [];
  const route = pathSegments.join('/');
  const user = await getAuthUser(request, db);

  if (!user) return error('Unauthorized', 401);

  // ============ MASTER DATA DELETES ============
  
  if (route.startsWith('companies/') && pathSegments.length === 2) {
    if (!['super_admin', 'it_admin'].includes(user.role)) return error('Forbidden', 403);
    
    const id = pathSegments[1];
    
    // Check if company is in use
    const inUse = await db.collection('employees').countDocuments({ company_id: id });
    if (inUse > 0) return error('Cannot delete company - in use by employees');
    
    await db.collection('companies').deleteOne({ id });
    await logAudit(db, user.id, 'DELETE', 'company', id, {});
    
    return json({ success: true });
  }
  
  if (route.startsWith('projects/') && pathSegments.length === 2) {
    if (!['super_admin', 'it_admin'].includes(user.role)) return error('Forbidden', 403);
    
    const id = pathSegments[1];
    
    const inUse = await db.collection('employees').countDocuments({ project_id: id });
    if (inUse > 0) return error('Cannot delete project - in use by employees');
    
    await db.collection('projects').deleteOne({ id });
    await logAudit(db, user.id, 'DELETE', 'project', id, {});
    
    return json({ success: true });
  }
  
  if (route.startsWith('locations/') && pathSegments.length === 2) {
    if (!['super_admin', 'it_admin'].includes(user.role)) return error('Forbidden', 403);
    
    const id = pathSegments[1];
    
    const inUse = await db.collection('employees').countDocuments({ location_id: id });
    if (inUse > 0) return error('Cannot delete location - in use by employees');
    
    await db.collection('locations').deleteOne({ id });
    await logAudit(db, user.id, 'DELETE', 'location', id, {});
    
    return json({ success: true });
  }
  
  if (route.startsWith('departments/') && pathSegments.length === 2) {
    if (!['super_admin', 'it_admin'].includes(user.role)) return error('Forbidden', 403);
    
    const id = pathSegments[1];
    
    const inUse = await db.collection('employees').countDocuments({ department_id: id });
    if (inUse > 0) return error('Cannot delete department - in use by employees');
    
    await db.collection('departments').deleteOne({ id });
    await logAudit(db, user.id, 'DELETE', 'department', id, {});
    
    return json({ success: true });
  }
  
  if ((route.startsWith('asset-categories/') || route.startsWith('categories/')) && pathSegments.length === 2) {
    if (!['super_admin', 'it_admin'].includes(user.role)) return error('Forbidden', 403);

    const id = pathSegments[1];

    const inUse = await db.collection('assets').countDocuments({ category: id });
    if (inUse > 0) return error(`Cannot delete — this category is used by ${inUse} asset(s)`);

    await db.collection('categories').deleteOne({ id });
    await logAudit(db, user.id, 'DELETE', 'category', id, {});

    return json({ success: true });
  }

  // ============ USERS ============
  
  if (route.startsWith('users/') && pathSegments.length === 2) {
    if (user.role !== 'super_admin') return error('Forbidden', 403);
    
    const userId = pathSegments[1];
    if (userId === user.id) return error('Cannot delete yourself');
    
    await db.collection('users').deleteOne({ id: userId });
    await logAudit(db, user.id, 'DELETE', 'user', userId, {});
    
    return json({ success: true });
  }

  // ============ EMPLOYEES ============
  
  if (route.startsWith('employees/') && pathSegments.length === 2) {
    if (!canAccess(user.role, 'employees')) return error('Forbidden', 403);
    
    const empId = pathSegments[1];
    
    const activeAssignments = await db.collection('assignments').countDocuments({ 
      employee_id: empId, 
      unassigned_date: null 
    });
    
    if (activeAssignments > 0) {
      return error('Cannot delete employee with active assignments');
    }
    
    await db.collection('employees').deleteOne({ id: empId });
    await logAudit(db, user.id, 'DELETE', 'employee', empId, {});
    
    return json({ success: true });
  }

  // ============ ASSETS ============
  
  // DELETE /api/assets/:id/assignees/:empId — remove from shared assignees
  if (pathSegments[0] === 'assets' && pathSegments[2] === 'assignees' && pathSegments.length === 4) {
    if (!canAccess(user.role, 'assets')) return error('Forbidden', 403);
    const assetId = pathSegments[1];
    const empId = pathSegments[3];
    const asset = await db.collection('assets').findOne({ id: assetId });
    if (!asset) return error('Asset not found', 404);
    const remaining = (asset.sharedAssignees || []).filter(a => a.employee_id !== empId);
    await db.collection('assets').updateOne({ id: assetId }, {
      $set: { sharedAssignees: remaining, isShared: remaining.length > 0, updated_at: new Date().toISOString() }
    });
    await logAudit(db, user.id, 'REMOVE_SHARED_ASSIGNEE', 'asset', assetId, { employee_id: empId });
    return json({ success: true });
  }

  if (route.startsWith('assets/') && pathSegments.length === 2) {
    if (!canAccess(user.role, 'assets')) return error('Forbidden', 403);

    const assetId = pathSegments[1];
    const asset = await db.collection('assets').findOne({ id: assetId });

    if (!asset) return error('Asset not found', 404);
    if (['Assigned', 'Temporarily Assigned', 'Handed Over (Vacation Coverage)'].includes(asset.status)) {
      return error('Cannot delete assigned asset');
    }
    
    await db.collection('assets').deleteOne({ id: assetId });
    await db.collection('activity_logs').deleteMany({ asset_id: assetId });
    await db.collection('asset_documents').deleteMany({ asset_id: assetId });
    await logAudit(db, user.id, 'DELETE', 'asset', assetId, {});

    return json({ success: true });
  }

  // Delete asset document
  if (pathSegments[0] === 'assets' && pathSegments[1] === 'documents' && pathSegments.length === 3) {
    if (!['super_admin', 'it_admin'].includes(user.role)) return error('Forbidden', 403);
    const docId = pathSegments[2];
    const doc = await db.collection('asset_documents').findOne({ id: docId });
    if (!doc) return error('Document not found', 404);

    const uploadDir = process.env.UPLOAD_DIR || '/app/uploads';
    try {
      await unlink(path.join(uploadDir, doc.stored_filename));
    } catch (e) { console.error('Failed to delete file from disk:', e); }

    await db.collection('asset_documents').deleteOne({ id: docId });
    await logAudit(db, user.id, 'DELETE_DOCUMENT', 'asset', doc.asset_id, { doc_id: docId, filename: doc.filename });

    return json({ success: true });
  }

  // DELETE /api/assets/:id/addons/:addonId — cancel/delete addon
  if (pathSegments[0] === 'assets' && pathSegments[2] === 'addons' && pathSegments.length === 4) {
    if (!['super_admin', 'it_admin', 'it_technician'].includes(user.role)) return error('Forbidden', 403);
    const assetId = pathSegments[1];
    const addonId = pathSegments[3];
    const cancel = new URL(request.url).searchParams.get('action') === 'cancel';
    const asset = await db.collection('assets').findOne({ id: assetId });
    if (!asset) return error('Asset not found', 404);
    const addonIdx = (asset.addons || []).findIndex(a => a.id === addonId);
    if (addonIdx === -1) return error('Addon not found', 404);
    if (cancel) {
      await db.collection('assets').updateOne(
        { id: assetId },
        { $set: { [`addons.${addonIdx}.status`]: 'cancelled', [`addons.${addonIdx}.cancelledAt`]: new Date().toISOString() } }
      );
      await logAudit(db, user.id, 'CANCEL_ADDON', 'asset', assetId, { addonId });
    } else {
      await db.collection('assets').updateOne({ id: assetId }, { $pull: { addons: { id: addonId } } });
      await logAudit(db, user.id, 'DELETE_ADDON', 'asset', assetId, { addonId });
    }
    return json({ success: true });
  }

  // DELETE /api/extensions/:id
  if (pathSegments[0] === 'extensions' && pathSegments.length === 2) {
    if (!['super_admin', 'it_admin'].includes(user.role)) return error('Forbidden', 403);
    const extId = pathSegments[1];
    const existing = await db.collection('extensions').findOne({ id: extId });
    if (!existing) return error('Extension not found', 404);
    await db.collection('extensions').deleteOne({ id: extId });
    await logAudit(db, user.id, 'DELETE', 'extension', extId, { extensionNumber: existing.extensionNumber });
    return json({ success: true });
  }

  return error('Not found', 404);
}
