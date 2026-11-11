// TABLES=1 node scripts/ui-demo/crawl.cjs <width> <email…> — обход всех страниц без параметров: статус, переадресация, боковая прокрутка, ошибки
const { chromium } = require("playwright");
const path = require("path");
const REPO = path.resolve(__dirname, "../..");
const OUT = process.env.UI_DEMO_DIR || "/tmp/ecoculture-ui-demo";
const BASE = "http://localhost:" + (process.env.PORT || 3100);
const { encode } = require(path.join(REPO, "node_modules/next-auth/jwt"));
const fs = require("fs");
const USERS = JSON.parse(fs.readFileSync(OUT + "/fixture.json", "utf-8")).Users.slice(1);
function routes(dir, base = "") {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (e.name === "api" || e.name.startsWith("[")) continue; out = out.concat(routes(path.join(dir, e.name), base + "/" + e.name)); }
    else if (e.name === "page.tsx") out.push(base || "/");
  }
  return out;
}
(async () => {
  const [width, ...emails] = process.argv.slice(2);
  const all = routes(path.join(REPO, "src/app")).filter((r) => r !== "/login" && r !== "/privacy").sort();
  const b = await chromium.launch();
  for (const email of emails) {
    const u = USERS.find((r) => r[0] === email);
    const token = await encode({ token: { email, name: u[1], role: u[2], farm: u[4] || null, sub: email }, secret: "demo-secret-not-real" });
    const ctx = await b.newContext({ timezoneId: "Asia/Almaty", locale: "ru-RU", viewport: { width: Number(width), height: Number(width) < 600 ? 800 : 900 } });
    await ctx.addCookies([{ name: "next-auth.session-token", value: token, domain: "localhost", path: "/" }]);
    const pg = await ctx.newPage(); let errs = [];
    pg.on("pageerror", (e) => errs.push(String(e).slice(0, 140)));
    let ok = 0, denied = 0; const bad = [];
    for (const r of all) {
      errs = [];
      try {
        const res = await pg.goto(BASE + r, { waitUntil: "networkidle", timeout: 60000 });
        const finalPath = new URL(pg.url()).pathname;
        if (finalPath !== r) { denied++; continue; }
        const over = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        const text = await pg.evaluate(() => document.body.innerText.slice(0, 4000));
        const broken = res.status() >= 400 || /Application error|Что-то пошло не так|Произошла ошибка/i.test(text);
        const clipped = await pg.evaluate(() => { const out = []; for (const t of document.querySelectorAll("table")) { if (!t.offsetParent) continue; let a = t.parentElement; while (a && a !== document.body) { const cs = getComputedStyle(a); if (cs.overflowX !== "visible") break; a = a.parentElement; } if (!a || a === document.body) continue; const extra = t.scrollWidth - a.clientWidth; if (extra > 8) out.push(`${extra}px(${getComputedStyle(a).overflowX})`); } return out; });
        if (clipped.length && process.env.TABLES) bad.push(`${r}: таблица шире карточки на ${clipped.join(", ")}`);
        if (over > 2 || broken || errs.length) bad.push(`${r}: ${res.status()}${over > 2 ? ` прокрутка +${over}px` : ""}${broken ? " ОШИБКА НА СТРАНИЦЕ" : ""}${errs.length ? " js: " + errs[0] : ""}`);
        else ok++;
      } catch (e) { bad.push(`${r}: ${String(e).slice(0, 100)}`); }
    }
    console.log(`${u[2]} (${email}) @${width}: открылось ${ok}, закрыто ролью ${denied}, с замечаниями ${bad.length}`);
    for (const x of bad) console.log("   " + x);
    await ctx.close();
  }
  await b.close();
})();
