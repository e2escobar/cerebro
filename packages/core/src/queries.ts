import {
  appUser,
  application,
  auditLog,
  environment,
  flag,
  flagEnvironment,
  type AuditLog,
  type Flag,
  type FlagType,
  type Tx,
} from "@cerebro/db";
import { and, asc, desc, eq, ilike, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";

/** Read models for the management API. Cursor pagination on `(created_at, id)` (§12). */

export interface Cursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.id}`).toString("base64url");
}

export function decodeCursor(raw: string): Cursor | null {
  try {
    const [iso, id] = Buffer.from(raw, "base64url").toString("utf8").split("|");
    if (!iso || !id) return null;
    const createdAt = new Date(iso);
    return Number.isNaN(createdAt.getTime()) ? null : { createdAt, id };
  } catch {
    return null;
  }
}

export interface FlagMatrixCell {
  environmentKey: string;
  rank: number;
  state: "not_promoted" | "promoted";
  enabled: boolean;
  value: unknown;
  updatedAt: Date;
}

export interface FlagListItem extends Flag {
  environments: FlagMatrixCell[];
}

export interface ListFlagsFilters {
  /** Flags are always listed within one application. */
  applicationId: string;
  q?: string;
  type?: FlagType;
  environment?: string;
  state?: "promoted" | "not_promoted";
  archived?: boolean;
  cursor?: string;
  limit?: number;
}

export async function listFlags(
  db: Tx,
  filters: ListFlagsFilters,
): Promise<{ items: FlagListItem[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const conditions: SQL[] = [
    eq(flag.applicationId, filters.applicationId),
    filters.archived ? isNotNull(flag.archivedAt) : isNull(flag.archivedAt),
  ];

  if (filters.q) {
    const pattern = `%${filters.q}%`;
    const match = or(ilike(flag.key, pattern), ilike(flag.name, pattern));
    if (match) conditions.push(match);
  }
  if (filters.type) conditions.push(eq(flag.type, filters.type));

  if (filters.environment) {
    const [env] = await db
      .select({ id: environment.id })
      .from(environment)
      .where(eq(environment.key, filters.environment))
      .limit(1);
    if (!env) return { items: [], nextCursor: null };

    const stateCondition = filters.state
      ? and(eq(flagEnvironment.environmentId, env.id), eq(flagEnvironment.state, filters.state))
      : and(eq(flagEnvironment.environmentId, env.id));

    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${flagEnvironment} WHERE ${flagEnvironment.flagId} = ${flag.id} AND ${stateCondition})`,
    );
  }

  const cursor = filters.cursor ? decodeCursor(filters.cursor) : null;
  if (cursor) {
    conditions.push(
      sql`(${flag.createdAt}, ${flag.id}) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`,
    );
  }

  const rows = await db
    .select()
    .from(flag)
    .where(and(...conditions))
    .orderBy(desc(flag.createdAt), desc(flag.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const nextCursor =
    rows.length > limit && page.at(-1)
      ? encodeCursor({ createdAt: page.at(-1)!.createdAt, id: page.at(-1)!.id })
      : null;

  if (page.length === 0) return { items: [], nextCursor: null };

  const flagIds = page.map((f) => f.id);
  const cells = await db
    .select({
      flagId: flagEnvironment.flagId,
      environmentKey: environment.key,
      rank: environment.rank,
      state: flagEnvironment.state,
      enabled: flagEnvironment.enabled,
      value: flagEnvironment.value,
      updatedAt: flagEnvironment.updatedAt,
    })
    .from(flagEnvironment)
    .innerJoin(environment, eq(environment.id, flagEnvironment.environmentId))
    .where(sql`${flagEnvironment.flagId} = ANY(${sql.param(flagIds)}::uuid[])`)
    .orderBy(asc(environment.rank));

  const byFlag = new Map<string, FlagMatrixCell[]>();
  for (const cell of cells) {
    const list = byFlag.get(cell.flagId) ?? [];
    list.push({
      environmentKey: cell.environmentKey,
      rank: cell.rank,
      state: cell.state,
      enabled: cell.enabled,
      value: cell.value,
      updatedAt: cell.updatedAt,
    });
    byFlag.set(cell.flagId, list);
  }

  return {
    items: page.map((f) => ({ ...f, environments: byFlag.get(f.id) ?? [] })),
    nextCursor,
  };
}

export interface AuditFilters {
  applicationId?: string;
  entityType?: string;
  entityId?: string;
  environmentKey?: string;
  actorId?: string;
  from?: Date;
  to?: Date;
  cursor?: string;
  limit?: number;
}

export interface AuditEntry extends AuditLog {
  actorName: string | null;
  environmentKey: string | null;
  applicationKey: string | null;
}

export async function listAudit(
  db: Tx,
  filters: AuditFilters = {},
): Promise<{ items: AuditEntry[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const conditions: SQL[] = [];

  if (filters.applicationId) conditions.push(eq(auditLog.applicationId, filters.applicationId));
  if (filters.entityType) conditions.push(eq(auditLog.entityType, filters.entityType));
  if (filters.entityId) conditions.push(eq(auditLog.entityId, filters.entityId));
  if (filters.actorId) conditions.push(eq(auditLog.actorId, filters.actorId));
  if (filters.from) conditions.push(sql`${auditLog.createdAt} >= ${filters.from.toISOString()}`);
  if (filters.to) conditions.push(sql`${auditLog.createdAt} <= ${filters.to.toISOString()}`);

  if (filters.environmentKey) {
    const [env] = await db
      .select({ id: environment.id })
      .from(environment)
      .where(eq(environment.key, filters.environmentKey))
      .limit(1);
    if (!env) return { items: [], nextCursor: null };
    conditions.push(eq(auditLog.environmentId, env.id));
  }

  const cursor = filters.cursor ? decodeCursor(filters.cursor) : null;
  if (cursor) {
    conditions.push(
      sql`(${auditLog.createdAt}, ${auditLog.id}) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`,
    );
  }

  const rows = await db
    .select({
      entry: auditLog,
      actorName: appUser.name,
      environmentKey: environment.key,
      applicationKey: application.key,
    })
    .from(auditLog)
    .leftJoin(appUser, eq(appUser.id, auditLog.actorId))
    .leftJoin(environment, eq(environment.id, auditLog.environmentId))
    .leftJoin(application, eq(application.id, auditLog.applicationId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const nextCursor =
    rows.length > limit && last
      ? encodeCursor({ createdAt: last.entry.createdAt, id: last.entry.id })
      : null;

  return {
    items: page.map((r) => ({
      ...r.entry,
      actorName: r.actorName,
      environmentKey: r.environmentKey,
      applicationKey: r.applicationKey,
    })),
    nextCursor,
  };
}
