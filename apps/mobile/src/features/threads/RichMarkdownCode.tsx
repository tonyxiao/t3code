import { richContentLanguage } from "@t3tools/chat-renderer/language";
import { richContentDocument } from "@t3tools/chat-renderer/document";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";

function RichMarkdownCode({
  content,
  language,
}: {
  content: string;
  language: "mermaid" | "json-render";
}) {
  const { themeAppearance: theme } = useAppearancePreferences();
  const [height, setHeight] = useState(180);
  const source = useMemo(
    () => ({
      // Keep the bundled browser libraries out of ordinary markdown rendering.
      html: richContentDocument(
        require("@t3tools/mobile-rich-chat") as string,
        content,
        language,
        theme,
      ),
    }),
    [content, language, theme],
  );
  return (
    <View style={{ minWidth: 0, width: "100%", height }}>
      <WebView
        source={source}
        originWhitelist={["about:blank"]}
        scrollEnabled={height >= 10000}
        style={{ backgroundColor: "transparent" }}
        onShouldStartLoadWithRequest={(request) => request.url === "about:blank"}
        onMessage={(event) => {
          try {
            const message: unknown = JSON.parse(event.nativeEvent.data);
            if (
              typeof message === "object" &&
              message !== null &&
              "height" in message &&
              typeof message.height === "number" &&
              Number.isFinite(message.height)
            )
              setHeight(Math.max(100, Math.min(10000, message.height)));
          } catch {
            /* Ignore messages outside the height bridge. */
          }
        }}
      />
    </View>
  );
}

export function renderRichMarkdownCode({
  content,
  language,
}: {
  content: string;
  language?: string | undefined;
}) {
  const kind = richContentLanguage(language);
  return kind ? <RichMarkdownCode content={content} language={kind} /> : null;
}
