import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const JWT_SECRET = process.env.JWT_SECRET || 'itdock-secret-2024';

export function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
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
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

export function getUserFromRequest(request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.split(' ')[1];
  return verifyToken(token);
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
