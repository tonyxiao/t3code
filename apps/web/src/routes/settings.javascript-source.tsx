import { createFileRoute } from "@tanstack/react-router";

import { isElectron } from "../env";
import { DesktopRendererSourceSetting } from "../components/settings/DesktopRendererSourceSetting";
import { SettingsPageContainer, SettingsSection } from "../components/settings/settingsLayout";

function SettingsFrontendSourceRoute() {
  return (
    <SettingsPageContainer>
      <SettingsSection title="JavaScript source">
        {isElectron ? (
          <DesktopRendererSourceSetting />
        ) : (
          <p className="px-3 text-sm text-muted-foreground">
            JavaScript source is managed in the desktop app.
          </p>
        )}
      </SettingsSection>
      {isElectron ? (
        <p className="px-3 text-sm text-muted-foreground">
          If the development frontend fails to load, choose View → Use Built-in JavaScript in the
          app menu to recover.
        </p>
      ) : null}
    </SettingsPageContainer>
  );
}

export const Route = createFileRoute("/settings/javascript-source")({
  component: SettingsFrontendSourceRoute,
});
