import { query } from "../db.js";
import { config } from "../config.js";

// DB-backed cooldown check. Memory caches don't survive multi-instance
// deploys, and the DB already has the data we need.
export async function canStamp(customerId: string): Promise<boolean> {
  const { rows } = await query<{ seconds_since: number | null }>(
    `
    select extract(epoch from (now() - last_stamp_at))::int as seconds_since
    from customers
    where id = $1
    `,
    [customerId],
  );
  const row = rows[0];
  if (!row || row.seconds_since == null) return true;
  return row.seconds_since >= config.limits.stampCooldownSeconds;
}
