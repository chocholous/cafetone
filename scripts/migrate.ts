// Minimal forward-only migration runner. Applies every .sql file in
// migrations/ in lexical order, idempotent via a _migrations table.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import "dotenv/config";

const { Client } = pg;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const client = new Client({ connectionString: url });
  await client.connect();

  await client.query(`
    create table if not exists _migrations (
      name       text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const dir = join(process.cwd(), "migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    const { rows } = await client.query(
      "select 1 from _migrations where name = $1",
      [file],
    );
    if (rows.length) {
      console.log(`skip  ${file}`);
      continue;
    }
    const sql = await readFile(join(dir, file), "utf8");
    console.log(`apply ${file}`);
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into _migrations (name) values ($1)", [file]);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  }

  await client.end();
  console.log("migrations done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
