import { flag, flagEnvironment, type FlagValue, type Tx } from "@cerebro/db";
import { and, eq, isNull } from "drizzle-orm";

/**
 * Evaluation payload resolution (spec §5.5):
 *
 *   state !== 'promoted'  →  omitted entirely
 *   enabled === true      →  flag_environment.value
 *   enabled === false     →  flag.default_value
 *
 * Every key present therefore has a value of its declared type, so consumers
 * never handle `undefined`.
 */

export type EvaluationPayload = Record<string, FlagValue>;

export async function buildEvaluationPayload(
  db: Tx,
  applicationId: string,
  environmentId: string,
  options: { clientOnly?: boolean } = {},
): Promise<EvaluationPayload> {
  const conditions = [
    // The key's application is as much a part of its scope as its environment:
    // one application never sees another's flags.
    eq(flag.applicationId, applicationId),
    eq(flagEnvironment.environmentId, environmentId),
    eq(flagEnvironment.state, "promoted"),
    isNull(flag.archivedAt),
  ];
  if (options.clientOnly) conditions.push(eq(flag.isClientSafe, true));

  const rows = await db
    .select({
      key: flag.key,
      defaultValue: flag.defaultValue,
      enabled: flagEnvironment.enabled,
      value: flagEnvironment.value,
    })
    .from(flagEnvironment)
    .innerJoin(flag, eq(flag.id, flagEnvironment.flagId))
    .where(and(...conditions));

  const payload: EvaluationPayload = {};
  for (const row of rows) {
    payload[row.key] = row.enabled ? row.value : row.defaultValue;
  }
  return payload;
}
