import type { JavaScriptSource, SourceSnapshot } from "@tonyxiao/javascript-source";
import { useEffect, useState } from "react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SettingsRow } from "./settingsLayout";

function sourceLabel(source: JavaScriptSource, bundles: SourceSnapshot["bundles"] = []) {
  return source.kind === "built-in"
    ? "Built-in"
    : source.kind === "bundle"
      ? `Saved bundle: ${bundles.find((bundle) => bundle.id === source.bundleId)?.version ?? source.bundleId.slice(0, 12)}`
      : `Development server: ${source.url}`;
}

export function DesktopRendererSourceSetting() {
  const bridge = window.desktopBridge;
  const [snapshot, setSnapshot] = useState<SourceSnapshot | null>(null);
  const [draftUrl, setDraftUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = async () => {
    if (bridge?.getJavaScriptSourceState) setSnapshot(await bridge.getJavaScriptSourceState());
  };
  useEffect(() => {
    let active = true;
    void bridge
      ?.getJavaScriptSourceState?.()
      .then((state) => {
        if (!active) return;
        setSnapshot(state);
        setDraftUrl(
          state.selected.kind === "development-server"
            ? state.selected.url
            : (state.defaultDevelopmentServerUrl ?? ""),
        );
      })
      .catch((cause: unknown) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [bridge]);
  if (!bridge?.getJavaScriptSourceState) return null;

  const run = async (operation: () => Promise<void>) => {
    setPending(true);
    setError(null);
    try {
      await operation();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };
  const select = async (source: JavaScriptSource) => {
    await bridge.selectJavaScriptSource!(source);
    await bridge.reloadJavaScriptSource!();
  };
  return (
    <>
      <SettingsRow
        id="javascript-source"
        title="Current source"
        description="Switching sources restarts the app. Your connections and backend are retained."
        status={snapshot ? sourceLabel(snapshot.current, snapshot.bundles) : "Loading…"}
      />
      {snapshot?.recoveryReason ? (
        <p role="status" className="px-3 py-2 text-sm text-muted-foreground">
          {snapshot.recoveryReason}
        </p>
      ) : null}
      <SettingsRow
        title="Built-in"
        description="The original JavaScript included with this app, always available for recovery."
      >
        <Button
          size="sm"
          variant="outline"
          disabled={
            pending ||
            !snapshot ||
            (snapshot.current.kind === "built-in" && snapshot.selected.kind === "built-in")
          }
          onClick={() => void run(() => select({ kind: "built-in" }))}
        >
          Use built-in
        </Button>
      </SettingsRow>
      <SettingsRow
        title="Saved bundles"
        description="Compatible JavaScript versions stored on this device. Imported bundles do not replace Built-in."
      >
        <div className="flex flex-col gap-3 py-3">
          {snapshot?.bundles.map((bundle) => (
            <div key={bundle.id} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 text-sm">
                {bundle.version}
                {!bundle.compatible
                  ? " · Requires a different native build"
                  : bundle.status === "failed"
                    ? " · Failed startup"
                    : ""}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  pending ||
                  !bundle.compatible ||
                  bundle.status === "failed" ||
                  (snapshot.current.kind === "bundle" && snapshot.current.bundleId === bundle.id)
                }
                onClick={() => void run(() => select({ kind: "bundle", bundleId: bundle.id }))}
              >
                Use bundle
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={
                  pending ||
                  (snapshot.current.kind === "bundle" && snapshot.current.bundleId === bundle.id)
                }
                onClick={() => void run(() => bridge.deleteJavaScriptBundle!(bundle.id))}
              >
                Delete
              </Button>
            </div>
          ))}
          {snapshot?.bundles.length === 0 ? (
            <p className="text-sm text-muted-foreground">No saved bundles.</p>
          ) : null}
          <div>
            <Button
              size="sm"
              variant="outline"
              disabled={pending || !snapshot?.capabilities.importBundle}
              onClick={() => void run(() => bridge.importJavaScriptBundle!())}
            >
              Import bundle…
            </Button>
          </div>
        </div>
      </SettingsRow>
      <SettingsRow
        title="Development server"
        description="Load live JavaScript from a compatible Vite server."
      >
        <div className="flex flex-col gap-2 py-3">
          <label htmlFor="javascript-server-url" className="text-xs text-muted-foreground">
            Server URL
          </label>
          <Input
            id="javascript-server-url"
            nativeInput
            size="sm"
            type="url"
            value={draftUrl}
            onChange={(event) => setDraftUrl(event.target.value)}
            disabled={pending}
            placeholder={snapshot?.defaultDevelopmentServerUrl ?? "http://machine:port"}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pending || !snapshot || !draftUrl.trim()}
              onClick={() => void run(() => select({ kind: "development-server", url: draftUrl }))}
            >
              Use development server
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending || !snapshot?.defaultDevelopmentServerUrl}
              onClick={() => setDraftUrl(snapshot?.defaultDevelopmentServerUrl ?? "")}
            >
              Reset to default
            </Button>
          </div>
        </div>
      </SettingsRow>
      {error ? (
        <p role="alert" className="px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );
}
