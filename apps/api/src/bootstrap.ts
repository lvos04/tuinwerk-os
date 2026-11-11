import { pool, query } from "./db";
import { passwordHash } from "./auth";
async function main() {
  const email = process.env.ADMIN_EMAIL,
    password = process.env.ADMIN_PASSWORD,
    name = process.env.ADMIN_NAME || "Beheerder";
  if (!email || !password)
    throw new Error("ADMIN_EMAIL en ADMIN_PASSWORD verplicht");
  const rows = await query(
    "INSERT INTO users(email,name,password_hash,role) VALUES($1,$2,$3,'admin') ON CONFLICT(email) DO NOTHING RETURNING id",
    [email.toLowerCase(), name, passwordHash(password)],
  );
  console.log(
    rows.length ? "Beheerder aangemaakt" : "Account bestaat al; niet gewijzigd",
  );
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
