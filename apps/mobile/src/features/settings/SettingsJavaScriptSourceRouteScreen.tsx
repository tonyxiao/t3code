import { useEffect, useMemo, useState } from "react";
import { Alert, View } from "react-native";
import type { JavaScriptSource, SourceSnapshot } from "@tonyxiao/javascript-updates";

import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { ScreenScrollView } from "../../components/ScreenScrollView";
import { createMobileJavaScriptSourceClient } from "./javascript-source";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsScreen } from "./components/SettingsScreen";
import { runAppUpdateCheck, type AppUpdateCheckState } from "../updates/app-updates";
import { flushPendingUpdateWrites } from "../updates/app-updates";

export function SettingsJavaScriptSourceRouteScreen() {
  const client = useMemo(() => createMobileJavaScriptSourceClient(), []);
  const [state, setState] = useState<SourceSnapshot | null>(null);
  const [serverUrl, setServerUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updateState, setUpdateState] = useState<AppUpdateCheckState>("idle");
  useEffect(() => {
    let active = true;
    void client
      .snapshot()
      .then((snapshot) => {
        if (!active) return;
        setState(snapshot);
        setServerUrl(snapshot.defaultDevelopmentServerUrl ?? "");
      })
      .catch((cause) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [client]);
  const select = async (source: JavaScriptSource) => {
    setBusy(true);
    setError(null);
    try {
      await client.select(source);
      await flushPendingUpdateWrites();
      await client.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const confirm = (source: JavaScriptSource) =>
    Alert.alert(
      "Switch JavaScript source?",
      "The app will reload. Your connections are retained.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Switch", onPress: () => void select(source) },
      ],
    );
  const currentLabel =
    state?.current.kind === "development-server"
      ? "Development server"
      : state?.current.kind === "bundle"
        ? "Saved bundle"
        : "Built-in";
  return (
    <SettingsScreen title="JavaScript source">
      <ScreenScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-6 px-5 py-4"
      >
        <SettingsSection title="Current source">
          <SettingsRow
            icon="chevron.left.forwardslash.chevron.right"
            label={state ? currentLabel : "Loading…"}
            value={state?.runtime.runtimeVersion || "Runtime version unavailable"}
          />
        </SettingsSection>
        <SettingsSection title="Built-in">
          <SettingsRow
            icon="cube"
            label="Use built-in"
            value="Original JavaScript included with this app"
            disabled={
              busy || !state?.capabilities.developmentServer || state.current.kind === "built-in"
            }
            onPress={() => confirm({ kind: "built-in" })}
          />
        </SettingsSection>
        <SettingsSection title="Saved bundles">
          <SettingsRow
            icon="arrow.down.circle"
            label="Check for updates"
            value={updateState === "idle" ? "Download a compatible JavaScript update" : updateState}
            disabled={busy || !state?.capabilities.automaticUpdates}
            onPress={() => {
              setBusy(true);
              void runAppUpdateCheck({
                onStateChange: setUpdateState,
                onFailure: setError,
              }).finally(() => setBusy(false));
            }}
          />
          <Text className="px-4 py-3 text-sm text-foreground-muted">
            Expo manages downloaded updates. Manual bundle import and version selection are not
            available on this build.
          </Text>
        </SettingsSection>
        <SettingsSection title="Development server">
          <View className="gap-2 px-4 py-3">
            <Text className="text-sm text-foreground-muted">Server URL</Text>
            <TextInput
              accessibilityLabel="Server URL"
              value={serverUrl}
              onChangeText={setServerUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              editable={!busy && state?.capabilities.developmentServer === true}
              placeholder="http://machine:port"
              className="text-base text-foreground"
            />
          </View>
          <SettingsRow
            icon="server.rack"
            label="Use development server"
            disabled={busy || !serverUrl.trim() || !state?.capabilities.developmentServer}
            onPress={() => confirm({ kind: "development-server", url: serverUrl })}
          />
          {state?.defaultDevelopmentServerUrl ? (
            <SettingsRow
              icon="arrow.clockwise"
              label="Reset to default"
              disabled={busy}
              onPress={() => setServerUrl(state.defaultDevelopmentServerUrl!)}
            />
          ) : null}
          {!state?.capabilities.developmentServer ? (
            <Text className="px-4 py-3 text-sm text-foreground-muted">
              Source switching requires a native build with the source launcher bridge.
            </Text>
          ) : null}
        </SettingsSection>
        {error ? (
          <Text accessibilityRole="alert" className="text-sm text-destructive">
            {error}
          </Text>
        ) : null}
      </ScreenScrollView>
    </SettingsScreen>
  );
}
