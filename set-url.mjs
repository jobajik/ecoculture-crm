// Прописывает боевой адрес в NEXTAUTH_URL и убирает лишний VERCEL_OIDC_TOKEN,
// который Vercel дописал в .env.local при привязке проекта.
import { execFileSync } from "node:child_process";

const SITE = "https://ecoculture-crm.vercel.app";
const run = (args, opts = {}) =>
  execFileSync("vercel", args, { stdio: ["pipe", "pipe", "pipe"], shell: true, ...opts });

for (const env of ["production", "preview"]) {
  try { run(["env", "rm", "NEXTAUTH_URL", env, "--yes"]); } catch {}
  try {
    run(["env", "add", "NEXTAUTH_URL", env, "--force"], { input: SITE });
    console.log(`+ NEXTAUTH_URL -> ${env}: ${SITE}`);
  } catch (e) {
    console.log(`! NEXTAUTH_URL -> ${env}: ${String(e.stderr || e.message).replace(/\s+/g, " ").slice(0, 160)}`);
  }
}

for (const env of ["production", "preview", "development"]) {
  try { run(["env", "rm", "VERCEL_OIDC_TOKEN", env, "--yes"]); console.log(`- VERCEL_OIDC_TOKEN убран из ${env}`); } catch {}
}

console.log("--- итоговый список переменных (только имена) ---");
try { console.log(run(["env", "ls", "production"]).toString()); } catch (e) { console.log(String(e.stdout || e.message)); }
