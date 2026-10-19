import { useState } from "react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SettingsRow } from "./settingsLayout";

export function DesktopRendererSourceSetting() {
  const bridge = window.desktopBridge;
  const setLocalRendererUrl = bridge?.setLocalRendererUrl;
  const [currentUrl] = useState(() => bridge?.getLocalRendererUrl?.() ?? null);
  const [draftUrl, setDraftUrl] = useState(
    currentUrl ?? bridge?.getLastLocalRendererUrl?.() ?? "http://localhost:5733",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!bridge?.getLocalRendererUrl || !setLocalRendererUrl) return null;

  const apply = async (url: string | null) => {
    setPending(true);
    setError(null);
    try {
      await setLocalRendererUrl(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change the frontend source.");
      setPending(false);
    }
  };

  return (
    <SettingsRow
      id="frontend-source"
      title="Frontend source"
      description="Use the frontend bundled with this app or a local development server. Changing the source restarts the app and keeps your connections and backend."
      status={currentUrl === null ? "Bundled frontend" : `Development server: ${currentUrl}`}
    >
      <div className="flex flex-wrap items-center gap-2 py-3">
        <div className="w-full min-w-48 flex-1 sm:max-w-72">
          <Input
            aria-label="Development server URL"
            nativeInput
            size="sm"
            type="url"
            value={draftUrl}
            onChange={(event) => setDraftUrl(event.target.value)}
            placeholder="http://localhost:5733"
            disabled={pending}
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={pending || draftUrl.trim().length === 0 || draftUrl === currentUrl}
          onClick={() => void apply(draftUrl)}
        >
          Use development server
        </Button>
        {currentUrl !== null ? (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => void apply(null)}>
            Use bundled frontend
          </Button>
        ) : null}
      </div>
      {error ? <p className="pb-2 text-xs text-destructive">{error}</p> : null}
    </SettingsRow>
  );
}
