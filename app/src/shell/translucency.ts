import { isTauri } from "@tauri-apps/api/core";
import { isMac } from "@/lib/platform";

type UserAgentData = { getHighEntropyValues: (hints: string[]) => Promise<{ platform?: string; platformVersion?: string }> };

const WINDOWS_11_PLATFORM_VERSION = 13;

async function isWindows11() {
  const data = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData;
  if (!data) return false;
  const { platform, platformVersion } = await data.getHighEntropyValues(["platform", "platformVersion"]);
  return platform === "Windows" && Number(platformVersion?.split(".")[0]) >= WINDOWS_11_PLATFORM_VERSION;
}

export async function enableTranslucency() {
  if (!isTauri()) return;
  if (isMac || (await isWindows11())) document.documentElement.dataset.translucent = "";
}
