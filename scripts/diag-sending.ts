import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
import { listBroadcasts, listRecipients, listWaStatuses } from "../src/lib/repo/broadcasts";
import { listWaMessages } from "../src/lib/repo/talks";
import { phoneKey } from "../src/lib/leads";
async function main() {
  const [bs, rs, msgs] = await Promise.all([listBroadcasts(true), listRecipients(true), listWaMessages()]);
  const wrote = new Set(msgs.filter((m) => m.direction === "in").map((m) => phoneKey(m.phone)));
  const day = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty" });
  for (const b of bs.filter((x) => x.status === "sending" || x.status === "paused")) {
    const mine = rs.filter((r) => r.broadcastId === b.broadcastId);
    const q = mine.filter((r) => r.status === "queued");
    const sentBy = new Map<string, number>();
    for (const r of mine.filter((r) => r.status === "sent")) sentBy.set(day(r.sentAt), (sentBy.get(day(r.sentAt)) ?? 0) + 1);
    console.log(`${b.broadcastId} «${b.title}» [${b.status}] линия «${b.line || "основная"}» запущена ${b.startedAt} · ждут ${q.length} (из них писали нам ${q.filter((r) => wrote.has(phoneKey(r.phone))).length}) · ушло по дням: ${Array.from(sentBy.entries()).map(([d, n]) => `${d}: ${n}`).join(", ")} · ${b.note}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
