// Headless verification: forge a dev session, drive the proposal editor, assert
// CKEditor mounts with table+image tools and the top/bottom Add Section buttons,
// then load the public page to confirm the render path. Secrets are read from
// .env at runtime — none are written into this file.
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
for (const f of [".env", ".env.local"]) {
  const p = path.resolve(f);
  if (fs.existsSync(p)) dotenv.config({ path: p, override: true });
}
const postgres = (await import("postgres")).default;
const { SignJWT } = await import("jose");
const { chromium } = await import("playwright");

const BASE = "http://localhost:3005";
const DATABASE_URL = process.env.DATABASE_URL;
const SECRET = process.env.AUTH_SECRET ?? process.env.BETTER_AUTH_SECRET ?? "dev-only-insecure-fallback";
if (!DATABASE_URL) { console.error("no DATABASE_URL"); process.exit(2); }

const sql = postgres(DATABASE_URL, { max: 1, ssl: "require", idle_timeout: 5 });
const [user] = await sql`select id, email, coalesce(name,'') as name, coalesce(role,'member') as role from "Users" limit 1`;
const rows = await sql.unsafe(
  `select * from "crm_Proposals" where "deletedAt" is null and status::text not in ('APPROVED','REJECTED','PAID','EXPIRED') order by number desc nulls last limit 1`
);
await sql.end();
const prop = rows[0];
if (!user) { console.error("no user"); process.exit(2); }
if (!prop) { console.error("no editable proposal"); process.exit(2); }
const tokenCol = Object.keys(prop).find((k) => /token/i.test(k));
console.log("user:", user.email, "| proposal:", prop.id, "number:", prop.number, "status:", prop.status);

const token = await new SignJWT({
  user: { id: user.id, email: user.email, name: user.name, role: user.role },
  expires: new Date(Date.now() + 7 * 864e5).toISOString(),
})
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("7d")
  .sign(new TextEncoder().encode(SECRET));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
await ctx.addCookies([{ name: "session", value: token, url: BASE, httpOnly: true, sameSite: "Lax" }]);
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

const editUrl = `${BASE}/proposals/${prop.id}/edit`;
console.log("GET", editUrl);
const resp = await page.goto(editUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
console.log("edit status:", resp && resp.status(), "final url:", page.url());

let editors = 0;
try {
  await page.waitForSelector(".ck-editor__editable", { timeout: 90000 });
  editors = await page.locator(".ck-editor__editable").count();
} catch (e) { console.log("CKEditor wait failed:", e.message); }
const tableBtn = await page.locator('button[data-cke-tooltip-text*="table" i]').count().catch(() => 0);
const imageBtn = await page.locator('button[data-cke-tooltip-text*="image" i]').count().catch(() => 0);
const addBtns = await page.getByRole("button", { name: /Add Section/i }).count().catch(() => 0);
console.log("CKEditor editables:", editors, "| table btns:", tableBtn, "| image btns:", imageBtn, "| Add Section btns:", addBtns);
await page.screenshot({ path: "/tmp/nvcrm-editor.png", fullPage: true });

let editorsAfter = editors;
if (addBtns > 0) {
  await page.getByRole("button", { name: /Add Section/i }).first().click();
  await page.waitForTimeout(2000);
  editorsAfter = await page.locator(".ck-editor__editable").count();
}
console.log("CKEditor editables after top Add Section:", editorsAfter);

let pubStatus = 0, hasTableCss = false;
try {
  const slug = prop.clientSlug ?? "x";
  const tok = tokenCol ? prop[tokenCol] : "";
  const pubUrl = `${BASE}/proposal/${prop.number}/${slug}?t=${tok}`;
  console.log("GET", pubUrl);
  const r2 = await page.goto(pubUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  pubStatus = r2 && r2.status();
  await page.waitForTimeout(1500);
  hasTableCss = await page.evaluate(() =>
    Array.from(document.querySelectorAll("style")).some(
      (s) => s.textContent.includes(".pv-prose") && s.textContent.includes("table")
    )
  );
  await page.screenshot({ path: "/tmp/nvcrm-public.png", fullPage: true });
} catch (e) { console.log("public err:", e.message); }
console.log("public status:", pubStatus, "| pv-prose table css present:", hasTableCss);
console.log("CONSOLE ERRORS:", errors.length ? errors.slice(0, 8) : "none");
await browser.close();

const pass = editors >= 1 && tableBtn >= 1 && imageBtn >= 1 && addBtns >= 2 && editorsAfter > editors;
console.log(pass ? "\nVERIFY: PASS" : "\nVERIFY: PARTIAL/FAIL");
process.exit(pass ? 0 : 1);
