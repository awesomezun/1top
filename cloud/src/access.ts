export type HostedAccess = {
  kind: 'operator' | 'subscription' | 'trial';
  expires_at: number | null;
  max_devices: number;
};

export class AccessDenied extends Error {
  readonly status = 403;
  readonly code = 'hosted_access_required';
  constructor() {
    super('Managed remote access is currently limited to approved accounts. Local monitoring and the demo remain available.');
  }
}

/** Grants are provisioned by the operator or the verified billing handler.
 * A Google sign-in or a client-supplied plan never creates a grant.
 */
export async function hostedAccess(db: D1Database, userId: string): Promise<HostedAccess | null> {
  const row = await db.prepare(
    'SELECT kind,expires_at,max_devices FROM hosted_access WHERE user_id=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)',
  ).bind(userId, Math.floor(Date.now() / 1000)).first<HostedAccess>();
  if (!row || !['operator', 'subscription', 'trial'].includes(row.kind) ||
      !Number.isInteger(row.max_devices) || row.max_devices < 1 || row.max_devices > 25 ||
      (row.kind !== 'operator' && row.expires_at === null)) return null;
  return row;
}

export async function requireHostedAccess(db: D1Database, userId: string): Promise<HostedAccess> {
  const access = await hostedAccess(db, userId);
  if (!access) throw new AccessDenied();
  return access;
}

export function accessDeadline(access: HostedAccess, sessionDeadline: number): number {
  return access.expires_at === null ? sessionDeadline : Math.min(sessionDeadline, access.expires_at * 1000);
}
