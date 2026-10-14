import { useSnoozeResolver } from "./useSnoozeResolver";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  DatePicker,
  Host,
  HStack,
  Picker,
  Popover,
  RNHostView,
  Spacer,
  Text,
  TextField,
  VStack,
  useNativeState,
} from "@expo/ui/swift-ui";
import {
  accessibilityHidden,
  clipped,
  font,
  datePickerStyle,
  foregroundStyle,
  frame,
  labelsHidden,
  padding,
  pickerStyle,
  tag,
} from "@expo/ui/swift-ui/modifiers";
import {
  localSnoozeDate,
  localSnoozeTime,
  type CustomSnoozeInput,
} from "@t3tools/client-runtime/state/thread-settled";
import { useState, type ReactNode } from "react";
import { NavigationContainer, NavigationIndependentTree } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ScrollView, useWindowDimensions, View } from "react-native";
import { useMobileNavigationTheme } from "../../lib/useMobileNavigationTheme";
import { NativeHeaderToolbar } from "../../native/StackHeader";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";

const durationAmounts = Array.from({ length: 99 }, (_, index) => index + 1);
const SnoozeStack = createNativeStackNavigator<{ CustomSnooze: undefined }>();
const modes = [
  { value: "text", label: "Type a time" },
  { value: "date", label: "Date and time" },
  { value: "duration", label: "Duration" },
] as const;
const units = [
  { value: "minutes", label: "Minutes" },
  { value: "hours", label: "Hours" },
  { value: "days", label: "Days" },
] as const;

export function CustomSnoozeSheet(props: {
  readonly environmentId: EnvironmentId;
  readonly onClose: () => void;
  readonly onSnooze: (snoozedUntil: string) => void;
}) {
  const { width, height } = useWindowDimensions();
  const [mode, setMode] = useState<CustomSnoozeInput["mode"]>("text");
  const text = useNativeState("");
  const [date, setDate] = useState(() => new Date(Date.now() + 3_600_000));
  const [amount, setAmount] = useState(2);
  const [unit, setUnit] = useState<"minutes" | "hours" | "days">("hours");
  const { resolve, error, pending, clearError } = useSnoozeResolver(props.environmentId);
  const { themeVariables: colors, themeAppearance } = useAppearancePreferences();
  const popoverWidth = Math.min(360, width - 32);
  const popoverHeight = Math.min(error ? 364 : 324, height - 96);
  const updateDate = (value: Date) => {
    setDate(value);
    clearError();
  };

  const submit = async () => {
    const input: CustomSnoozeInput =
      mode === "text"
        ? { mode, text: text.get() }
        : mode === "date"
          ? { mode, date: localSnoozeDate(date), time: localSnoozeTime(date) }
          : { mode, amount: String(amount), unit };
    const snoozedUntil = await resolve(input);
    if (!snoozedUntil) return;
    props.onSnooze(snoozedUntil);
    props.onClose();
  };

  return (
    <Host
      style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
      colorScheme={themeAppearance}
      seedColor={colors["--color-primary"]}
    >
      <Popover
        isPresented
        onIsPresentedChange={(presented) => {
          if (!presented) props.onClose();
        }}
      >
        <Popover.Trigger>
          <Spacer
            modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), accessibilityHidden()]}
          />
        </Popover.Trigger>
        <Popover.Content>
          <SnoozePopoverNavigation
            width={popoverWidth}
            height={popoverHeight}
            onClose={props.onClose}
            onSubmit={() => {
              void submit();
            }}
            pending={pending}
          >
            <Host
              matchContents={{ vertical: true }}
              colorScheme={themeAppearance}
              style={{ width: popoverWidth }}
            >
              <VStack
                spacing={16}
                modifiers={[padding({ all: 16 }), foregroundStyle(colors["--color-foreground"])]}
              >
                <Picker
                  label="Snooze mode"
                  selection={mode}
                  onSelectionChange={(value: CustomSnoozeInput["mode"]) => {
                    setMode(value);
                    clearError();
                  }}
                  modifiers={[pickerStyle("segmented")]}
                >
                  {modes.map((option) => (
                    <Text key={option.value} modifiers={[tag(option.value)]}>
                      {option.label}
                    </Text>
                  ))}
                </Picker>
                {mode === "text" ? (
                  <VStack
                    spacing={8}
                    modifiers={[frame({ maxWidth: Infinity, minHeight: 180, maxHeight: 180 })]}
                  >
                    <Text>Snooze until</Text>
                    <TextField
                      text={text}
                      placeholder="1w, 30days, tomorrow at 9am"
                      onTextChange={clearError}
                    />
                  </VStack>
                ) : mode === "date" ? (
                  <DatePicker
                    title="Snooze until"
                    selection={date}
                    displayedComponents={["date", "hourAndMinute"]}
                    onDateChange={updateDate}
                    modifiers={[
                      datePickerStyle("wheel"),
                      labelsHidden(),
                      frame({ maxWidth: Infinity, minHeight: 180, maxHeight: 180 }),
                    ]}
                  />
                ) : (
                  <HStack spacing={0}>
                    <Picker
                      label="Duration amount"
                      selection={amount}
                      onSelectionChange={(value: number) => {
                        setAmount(value);
                        clearError();
                      }}
                      modifiers={[
                        pickerStyle("wheel"),
                        labelsHidden(),
                        frame({ minWidth: 0, maxWidth: Infinity, minHeight: 180, maxHeight: 180 }),
                        clipped(),
                      ]}
                    >
                      {durationAmounts.map((value) => (
                        <Text
                          key={value}
                          modifiers={[tag(value), foregroundStyle(colors["--color-foreground"])]}
                        >
                          {String(value)}
                        </Text>
                      ))}
                    </Picker>
                    <Picker
                      label="Duration unit"
                      selection={unit}
                      onSelectionChange={(value: typeof unit) => {
                        setUnit(value);
                        clearError();
                      }}
                      modifiers={[
                        pickerStyle("wheel"),
                        labelsHidden(),
                        frame({ minWidth: 0, maxWidth: Infinity, minHeight: 180, maxHeight: 180 }),
                        clipped(),
                      ]}
                    >
                      {units.map((option) => (
                        <Text
                          key={option.value}
                          modifiers={[
                            tag(option.value),
                            foregroundStyle(colors["--color-foreground"]),
                          ]}
                        >
                          {option.label}
                        </Text>
                      ))}
                    </Picker>
                  </HStack>
                )}
                {error ? (
                  <Text
                    modifiers={[
                      font({ textStyle: "footnote" }),
                      foregroundStyle(colors["--color-danger-foreground"]),
                    ]}
                  >
                    {error}
                  </Text>
                ) : null}
              </VStack>
            </Host>
          </SnoozePopoverNavigation>
        </Popover.Content>
      </Popover>
    </Host>
  );
}

/** The popover owns a native navigation bar, just like the app's sheet screens. */
function SnoozePopoverNavigation(props: {
  readonly width: number;
  readonly height: number;
  readonly onClose: () => void;
  readonly onSubmit: () => void;
  readonly pending: boolean;
  readonly children: ReactNode;
}) {
  const navigationTheme = useMobileNavigationTheme();
  const { themeVariables: colors } = useAppearancePreferences();

  return (
    <VStack modifiers={[frame({ width: props.width, height: props.height })]}>
      <RNHostView>
        <View style={{ width: props.width, height: props.height }}>
          <NavigationIndependentTree>
            <NavigationContainer theme={navigationTheme}>
              <SnoozeStack.Navigator
                screenOptions={{
                  contentStyle: { backgroundColor: "transparent" },
                  headerShadowVisible: false,
                  headerStyle: {
                    backgroundColor: NATIVE_LIQUID_GLASS_SUPPORTED
                      ? "transparent"
                      : colors["--color-card"],
                  },
                  headerTintColor: colors["--color-foreground"],
                  headerTitleStyle: { fontSize: 17, fontWeight: "700" },
                  headerTransparent: NATIVE_LIQUID_GLASS_SUPPORTED,
                  title: "Custom snooze",
                }}
              >
                <SnoozeStack.Screen name="CustomSnooze">
                  {() => (
                    <>
                      <NativeHeaderToolbar placement="left">
                        <NativeHeaderToolbar.Button
                          accessibilityLabel="Cancel custom snooze"
                          icon="xmark"
                          onPress={props.onClose}
                        />
                      </NativeHeaderToolbar>
                      <NativeHeaderToolbar placement="right">
                        <NativeHeaderToolbar.Button
                          label={props.pending ? "Interpreting…" : "Snooze"}
                          disabled={props.pending}
                          onPress={props.onSubmit}
                        />
                      </NativeHeaderToolbar>
                      <ScrollView
                        contentInsetAdjustmentBehavior="automatic"
                        showsVerticalScrollIndicator={false}
                      >
                        {props.children}
                      </ScrollView>
                    </>
                  )}
                </SnoozeStack.Screen>
              </SnoozeStack.Navigator>
            </NavigationContainer>
          </NavigationIndependentTree>
        </View>
      </RNHostView>
    </VStack>
  );
}
