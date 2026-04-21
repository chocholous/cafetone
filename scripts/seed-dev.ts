// One-shot dev seeding: ensures there's a staff row to log in as. The
// smoke-test and manual testing both rely on this. Idempotent.
import "dotenv/config";
import { ulid } from "ulid";
import { pool, query } from "../src/db.js";

const STAFF_EMAIL = process.env.DEV_STAFF_EMAIL ?? "barista@cafetone.local";

async function main() {
  const { rowCount } = await query(
    `select 1 from staff where lower(email) = lower($1)`,
    [STAFF_EMAIL],
  );
  if (rowCount === 0) {
    await query(`insert into staff (id, email) values ($1, $2)`, [
      ulid(),
      STAFF_EMAIL,
    ]);
    console.log(`seeded staff: ${STAFF_EMAIL}`);
  } else {
    console.log(`staff already present: ${STAFF_EMAIL}`);
  }

  // Reset state so repeat runs start fresh (kept small: just wipe test data).
  const wipe = process.env.DEV_WIPE === "true";
  if (wipe) {
    await query(`delete from stamps`);
    await query(`delete from redemptions`);
    await query(`delete from passes`);
    await query(`delete from apple_devices`);
    await query(`delete from customers`);
    console.log("wiped customers / passes / stamps / redemptions");
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
