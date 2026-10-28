import { Platform, View } from "react-native";

import { AppText as Text } from "../../../components/AppText";
import { useBackgroundSyncSession } from "../../../native/use-background-sync-session";
import { SettingsActionRow } from "./SettingsActionRow";
import { SettingsSection } from "./SettingsSection";

export function BackgroundSyncSection() {
  const { supported, status, pending, error, stop } = useBackgroundSyncSession();
  if (Platform.OS !== "ios") return null;
  const active = status.endsAt !== null;
  const message = !supported
    ? "Automatic background sync requires iOS 26 or later and an updated TX Code app."
    : status.state === "unavailable"
      ? "iOS did not allow extended background sync. It will be requested again next time you leave the app."
      : status.state === "expired"
        ? "iOS ended the previous sync session early. Background sync will be requested again next time you leave the app."
        : status.state === "completed"
          ? "The 10-minute session has finished. Background sync will be requested again next time you leave the app."
          : "Open threads sync automatically for up to 10 minutes when you leave the app. Returning to the app stops the session. iOS may refuse it or stop it early.";
  return (
    <SettingsSection title="Background sync">
      {active ? (
        <SettingsActionRow
          icon="arrow.clockwise"
          label="Stop sync session"
          disabled={!supported || pending}
          loading={pending}
          onPress={() => {
            void stop();
          }}
        />
      ) : null}
      <View className="px-4 pb-4">
        <Text className="text-sm text-foreground-muted">{message}</Text>
        {error ? <Text className="pt-2 text-sm text-danger-foreground">{error}</Text> : null}
      </View>
    </SettingsSection>
  );
}
