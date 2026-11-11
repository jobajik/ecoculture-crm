// node scripts/ui-demo/shot.cjs <outDir> <email> <width> path1 path2 …  — снимки страниц демо-копии под заданным сотрудником
const { chromium } = require("playwright");
const path = require("path");
const REPO = path.resolve(__dirname, "../..");
const OUT = process.env.UI_DEMO_DIR || "/tmp/ecoculture-ui-demo";
const BASE = "http://localhost:" + (process.env.PORT || 3100);
const { encode } = require(path.join(REPO, "node_modules/next-auth/jwt"));
const fs = require("fs");
const USERS = JSON.parse(fs.readFileSync(OUT + "/fixture.json", "utf-8")).Users.slice(1);
(async () => {
  const [outDir, email, width, ...paths] = process.argv.slice(2);
  fs.mkdirSync(outDir, { recursive: true });
  const u = USERS.find((r) => r[0] === email);
  const token = await encode({ token: { email, name: u[1], role: u[2], farm: u[4] || null, sub: email }, secret: "demo-secret-not-real" });
  const b = await chromium.launch();
  const ctx = await b.newContext({ timezoneId: "Asia/Almaty", locale: "ru-RU", viewport: { width: Number(width), height: Number(width) < 600 ? 800 : 900 }, deviceScaleFactor: 1 });
  await ctx.addCookies([{ name: "next-auth.session-token", value: token, domain: "localhost", path: "/" }]);
  const pg = await ctx.newPage();
  const errors = [];
  pg.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  for (const p of paths) {
    const name = (p === "/" ? "home" : p.replace(/^\//, "").replace(/[\/?=&]/g, "_")) + (Number(width) < 600 ? "-m" : "");
    try {
      const res = await pg.goto(BASE + p, { waitUntil: "networkidle", timeout: 90000 });
      await pg.waitForTimeout(700);
      const full = process.env.FULL !== "0";
      await pg.screenshot({ path: `${outDir}/${name}.png`, fullPage: full });
      const over = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      console.log(res.status(), p, "→", name + ".png", over > 2 ? `ГОРИЗОНТАЛЬНАЯ ПРОКРУТКА +${over}px` : "", pg.url().replace(BASE, "") !== p ? "→ " + pg.url().replace(BASE, "") : "");
    } catch (e) { console.log("ERR", p, String(e).slice(0, 160)); }
  }
  if (errors.length) console.log("ошибки страницы:", errors.slice(0, 5));
  await b.close();
})();
