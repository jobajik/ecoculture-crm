import { GreenError, getInstanceState, greenConfig, type GreenConfig } from "./greenApi";
import { channelProblem, type ChannelCheck } from "./greenOut";

/**
 * Спросить Green API, в сети ли номер. Не бросает: ответ разбирает
 * `channelProblem` — «ok», «retry» (разовый сбой, проверить через минуту) или
 * «pause» (ключ, тариф, номер отключён). Общее для рассылок, напоминаний о
 * долгах и утренней сводки.
 */
export async function checkGreenChannel(
  which: GreenConfig | null | undefined = undefined
): Promise<{ cfg: GreenConfig | null; action: "ok" | "retry" | "pause"; text: string }> {
  // `which` — другой номер (номер Земфиры, `greenLeadsConfig`); не передан — рабочий.
  const cfg = which === undefined ? greenConfig() : which;
  if (!cfg) return { cfg: null, action: "pause", text: "WhatsApp (Green API) не подключён — владелец вводит ключи в whatsapp-key.bat" };
  let check: ChannelCheck;
  try {
    check = { state: await getInstanceState(cfg) };
  } catch (err) {
    check = { httpStatus: err instanceof GreenError ? err.status : 0 };
    console.error("green state:", err instanceof Error ? err.message : err);
  }
  return { cfg, ...channelProblem(check) };
}
