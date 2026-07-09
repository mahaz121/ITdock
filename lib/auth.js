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
      role: user.role,
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
export const PERMISSIONS = {
  super_admin: ['all'],
  it_admin: ['employees', 'assets', 'assignments', 'maintenance', 'scrap', 'audit', 'export'],
  it_technician: ['assignments', 'custody', 'maintenance', 'export'],
  viewer: ['read', 'export']
};

export function canAccess(role, action) {
  if (!role) return false;
  const perms = PERMISSIONS[role];
  if (!perms) return false;
  if (perms.includes('all')) return true;
  if (action === 'read' || action === 'export') return true;
  return perms.includes(action);
}
