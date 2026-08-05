import { auditLog, type Tx } from "@cerebro/db";

/** The fixed action vocabulary from spec §4. */
export type AuditAction =
  | "flag.created"
  | "flag.updated"
  | "flag.key_changed"
  | "flag.archived"
  | "flag.restored"
  | "flag.promoted"
  | "flag.demoted"
  | "flag.enabled"
  | "flag.disabled"
  | "flag.value_changed"
  | "application.created"
  | "application.updated"
  | "application.deleted"
  | "environment.created"
  | "environment.updated"
  | "environment.reordered"
  | "environment.deleted"
  | "api_key.created"
  | "api_key.revoked"
  | "user.created"
  | "user.updated"
  | "user.disabled"
  | "permission.granted"
  | "permission.revoked";

export type AuditEntityType =
  | "flag"
  | "application"
  | "environment"
  | "api_key"
  | "user"
  | "permission";

export interface AuditInput {
  actorId: string | null;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string | null;
  environmentId?: string | null;
  applicationId?: string | null;
  before?: unknown;
  after?: unknown;
}

/** Always called inside the same transaction as the mutation it records (§2.4). */
export async function writeAudit(db: Tx, input: AuditInput): Promise<void> {
  await db.insert(auditLog).values({
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    environmentId: input.environmentId ?? null,
    applicationId: input.applicationId ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
  });
}
