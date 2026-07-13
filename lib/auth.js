import jwt from 'jsonwebtoken';
import argon2 from 'argon2';
import bcrypt from 'bcryptjs';

const JWT_ISSUER = 'itdock';
const JWT_AUDIENCE = 'itdock-api';
const INSECURE_SECRETS = new Set([
  'itdock-secret-2024',
  'mahaz-secret-2024',
  'change-this-secret-in-production-min-32-chars',
  'build-time-placeholder-secret-32-chars-long',
]);

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32 || INSECURE_SECRETS.has(secret)) {
    throw new Error('JWT_SECRET must be a unique, randomly generated value of at least 32 characters');
  }
  return secret;
}

export async function hashPassword(password) {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
}

export async function verifyPassword(password, hash) {
  if (typeof hash !== 'string') return false;
  if (hash.startsWith('$argon2id$')) return argon2.verify(hash, password);
  // Transitional verification for existing bcrypt records. Successful logins are
  // immediately rehashed with Argon2id by the login handler.
  if (hash.startsWith('$2')) return bcrypt.compare(password, hash);
  return false;
}

export function passwordNeedsRehash(hash) {
  return typeof hash !== 'string' || !hash.startsWith('$argon2id$');
}

export function generateToken(user) {
  return jwt.sign(
    { 
      id: user.id, 
      email: user.email, 
      role: normalizeRoles(user.roles || user.role)[0],
      roles: normalizeRoles(user.roles || user.role),
      name: user.name 
    },
    getJwtSecret(),
    { expiresIn: '15m', algorithm: 'HS256', issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, getJwtSecret(), {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
  } catch (error) {
    return null;
  }
}

export function getUserFromRequest(request) {
  const token = getTokenFromRequest(request);
  if (!token) return null;
  return verifyToken(token);
}

export function getTokenFromRequest(request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7).trim();
  return request.cookies?.get('itdock_auth')?.value || null;
}

// Role permissions
export const ROLE_ALIASES = {
  super_admin: 'admin',
  it_admin: 'asset_manager',
  it_technician: 'it_support',
  viewer: 'ordinary'
};

export const ROLE_LABELS = {
  admin: 'Super Admin',
  it_support: 'IT Support',
  asset_manager: 'Asset Manager',
  ordinary: 'Ordinary'
};

export const PERMISSIONS = {
  admin: ['all'],
  it_support: ['read_all', 'vacation_approve', 'resignation_approve'],
  asset_manager: ['read_all', 'assets', 'assignments', 'maintenance', 'scrap', 'asset_delete', 'master_data'],
  ordinary: ['employee_summary'],
  // Legacy aliases remain valid while existing users are migrated on login.
  super_admin: ['all'],
  it_admin: ['read_all', 'assets', 'assignments', 'maintenance', 'scrap', 'asset_delete', 'master_data'],
  it_technician: ['read_all', 'vacation_approve', 'resignation_approve'],
  viewer: ['employee_summary']
};

export function normalizeRoles(value) {
  const input = Array.isArray(value) ? value : value ? [value] : ['ordinary'];
  return [...new Set(input.map(r => ROLE_ALIASES[r] || r).filter(r => ROLE_LABELS[r]))];
}

export function canAccess(userOrRoles, action) {
  const roles = normalizeRoles(userOrRoles?.roles || userOrRoles?.role || userOrRoles);
  return roles.some(role => {
    const perms = PERMISSIONS[role] || [];
    return perms.includes('all') || perms.includes(action) || (action === 'read' && perms.includes('read_all'));
  });
}
