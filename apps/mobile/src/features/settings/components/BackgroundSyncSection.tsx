import { Platform, View } from "react-native";

import { AppText as Text } from "../../../components/AppText";
import { useBackgroundSyncSession } from "../../../native/use-background-sync-session";
import { SettingsActionRow } from "./SettingsActionRow";
import { SettingsSection } from "./SettingsSection";

export function BackgroundSyncSection() {
  const { supported, status, pending, error, toggle } = useBackgroundSyncSession();
  if (Platform.OS !== "ios") return null;
  const active = status.endsAt !== null;
  const message = !supported
    ? "Extended background sync requires iOS 26 or later and an updated T3 Code app."
    : status.state === "expired"
      ? "iOS ended the previous sync session early. You can start another session."
      : status.state === "completed"
        ? "The 10-minute session has finished."
        : status.state === "cancelled"
          ? "The sync session has stopped."
          : "Keep open threads syncing for up to 10 minutes after starting a session. iOS shows elapsed session time and may stop it early.";
  return (
    <SettingsSection title="Background sync">
      <SettingsActionRow
        icon="arrow.clockwise"
        label={active ? "Stop sync session" : "Sync for up to 10 minutes"}
        disabled={!supported || pending}
        loading={pending}
        onPress={() => {
          void toggle();
        }}
      />
      <View className="px-4 pb-4">
        <Text className="text-sm text-foreground-muted">{message}</Text>
        {error ? <Text className="pt-2 text-sm text-danger-foreground">{error}</Text> : null}
      </View>
    </SettingsSection>
  );
}
