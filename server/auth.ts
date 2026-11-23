import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { db } from './db.ts';
import type { LedgerSpace, UserProfile, UserRole } from '../src/types.ts';

export interface AuthenticatedRequest extends Request {
  user?: UserProfile;
  tokenHash?: string;
}

const VALID_SPACES: LedgerSpace[] = ['business', 'family', 'personal'];
const VALID_ROLES: UserRole[] = ['owner', 'admin', 'editor', 'viewer'];

export function isValidSpace(val: unknown): val is LedgerSpace {
  return typeof val === 'string' && VALID_SPACES.includes(val as LedgerSpace);
}

export function isValidRole(val: unknown): val is UserRole {
  return typeof val === 'string' && VALID_ROLES.includes(val as UserRole);
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createSession(userId: string): string {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const now = new Date();
  const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  db.prepare(
    `INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`
  ).run(tokenHash, userId, now.toISOString(), expires.toISOString());

  db.prepare(`UPDATE users SET last_active_at = ? WHERE id = ?`).run(now.toISOString(), userId);

  return token;
}

export function parseAllowedSpaces(raw: string): LedgerSpace[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(isValidSpace);
    }
  } catch {
    // ignore malformed
  }
  return ['personal'];
}

export function rowToUserProfile(row: {
  id: string;
  name: string;
  email: string;
  role: string;
  allowed_spaces: string;
  created_at: string;
  last_active_at?: string | null;
}): UserProfile {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role as UserRole,
    allowedSpaces: parseAllowedSpaces(row.allowed_spaces),
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at ?? undefined,
  };
}

export function authenticateToken(rawToken: string | undefined): {
  user: UserProfile;
  tokenHash: string;
} | null {
  if (!rawToken || rawToken.length < 20) return null;
  const tokenHash = hashToken(rawToken);
  const nowIso = new Date().toISOString();

  const row = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.role, u.allowed_spaces, u.created_at, u.last_active_at, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`
    )
    .get(tokenHash) as
    | {
        id: string;
        name: string;
        email: string;
        role: string;
        allowed_spaces: string;
        created_at: string;
        last_active_at: string | null;
        expires_at: string;
      }
    | undefined;

  if (!row) return null;
  if (row.expires_at < nowIso) {
    db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(tokenHash);
    return null;
  }

  return { user: rowToUserProfile(row), tokenHash };
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
  const result = authenticateToken(token);
  if (!result) {
    res.status(401).json({ error: 'Требуется авторизация' });
    return;
  }
  req.user = result.user;
  req.tokenHash = result.tokenHash;
  next();
}

export function canReadSpace(user: UserProfile, space: LedgerSpace): boolean {
  return user.allowedSpaces.includes(space);
}

export function canWriteSpace(user: UserProfile, space: LedgerSpace): boolean {
  if (user.role === 'viewer') return false;
  return user.allowedSpaces.includes(space);
}

export function canManageUsers(user: UserProfile): boolean {
  return user.role === 'owner' || user.role === 'admin';
}

export function canManageBanks(user: UserProfile): boolean {
  return user.role === 'owner' || user.role === 'admin';
}
