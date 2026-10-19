import { requireOptionalNativeModule } from "expo";
import * as Updates from "expo-updates";
import { Platform } from "react-native";
import {
  createExpoLauncherController,
  createExpoUpdatesClient,
  type ExpoLauncherBridge,
} from "@tonyxiao/javascript-source/expo";

export function createMobileJavaScriptSourceClient() {
  const launcher = requireOptionalNativeModule<ExpoLauncherBridge>("ExpoDevLauncher");
  const nativeSourceAvailable =
    typeof launcher?.getSourceInfo === "function" &&
    typeof launcher?.loadEmbeddedBundle === "function";
  const info = nativeSourceAvailable ? launcher.getSourceInfo() : null;
  return createExpoUpdatesClient({
    updates: Updates,
    platform: Platform.OS === "ios" ? "ios" : "android",
    ...(info?.runtimeVersion ? { runtimeVersion: info.runtimeVersion } : {}),
    ...(info?.serverUrl
      ? { defaultDevelopmentServerUrl: new URL(info.serverUrl).origin + "/" }
      : {}),
    ...(nativeSourceAvailable
      ? { sourceController: createExpoLauncherController(launcher, Updates) }
      : {}),
  });
}
