import { richContentLanguage } from "@t3tools/chat-renderer/language";
import { richContentDocument } from "@t3tools/chat-renderer/document";
import {
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
} from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { RichInputFocusContext, type RichInputTarget } from "./richInputFocus";

function parseBridgeMessage(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function RichMarkdownCode({
  content,
  language,
}: {
  content: string;
  language: "mermaid" | "json-render";
}) {
  const { themeAppearance: theme } = useAppearancePreferences();
  const [height, setHeight] = useState(180);
  const container = useRef<ComponentRef<typeof View>>(null);
  const inputBounds = useRef<{ top: number; bottom: number } | null>(null);
  const onInputFocus = useContext(RichInputFocusContext);
  const releaseInputFocus = useEffectEvent((target: RichInputTarget) =>
    onInputFocus?.(target, false),
  );
  const inputTarget = useMemo<RichInputTarget>(
    () => ({
      measure: (callback) => {
        container.current?.measureInWindow((_x, y) => {
          const bounds = inputBounds.current;
          if (bounds) callback(y + bounds.top, y + bounds.bottom);
        });
      },
    }),
    [],
  );
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
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- unregisters this WebView input focus owner when its native view unmounts
  useEffect(() => () => releaseInputFocus(inputTarget), [inputTarget]);
  return (
    <View ref={container} collapsable={false} style={{ minWidth: 0, width: "100%", height }}>
      <WebView
        source={source}
        originWhitelist={["about:blank"]}
        scrollEnabled={height >= 10000}
        style={{ backgroundColor: "transparent" }}
        onLoadStart={() => {
          inputBounds.current = null;
          onInputFocus?.(inputTarget, false);
        }}
        onShouldStartLoadWithRequest={(request) => request.url === "about:blank"}
        onMessage={(event) => {
          const message = parseBridgeMessage(event.nativeEvent.data);
          if (
            typeof message === "object" &&
            message !== null &&
            "height" in message &&
            typeof message.height === "number" &&
            Number.isFinite(message.height)
          )
            setHeight(Math.max(100, Math.min(10000, message.height)));
          if (typeof message === "object" && message !== null && "inputFocus" in message) {
            const bounds = message.inputFocus;
            if (bounds === null) {
              inputBounds.current = null;
              onInputFocus?.(inputTarget, false);
            } else if (
              typeof bounds === "object" &&
              "top" in bounds &&
              typeof bounds.top === "number" &&
              Number.isFinite(bounds.top) &&
              "bottom" in bounds &&
              typeof bounds.bottom === "number" &&
              Number.isFinite(bounds.bottom)
            ) {
              inputBounds.current = { top: bounds.top, bottom: bounds.bottom };
              onInputFocus?.(inputTarget, true);
            }
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
