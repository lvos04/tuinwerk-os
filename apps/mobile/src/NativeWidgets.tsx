import React from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
export const nativeStyles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 12,
    gap: 10,
    marginVertical: 6,
  },
  title: { fontSize: 21, fontWeight: "700", color: "#204c35" },
  text: { color: "#3b503e", lineHeight: 22 },
  input: {
    borderWidth: 1,
    borderColor: "#bacab2",
    backgroundColor: "#fff",
    padding: 12,
    minHeight: 48,
    borderRadius: 8,
    color: "#203f2e",
  },
  button: {
    padding: 14,
    minHeight: 48,
    backgroundColor: "#e7eddf",
    borderRadius: 8,
    marginVertical: 4,
  },
  label: { fontWeight: "600", color: "#2d4935", marginBottom: 5 },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  error: {
    backgroundColor: "#fce8e2",
    color: "#872c1e",
    padding: 12,
    borderRadius: 8,
  },
});
export function NativeButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[nativeStyles.button, disabled && { opacity: 0.5 }]}
    >
      <Text style={nativeStyles.label}>{label}</Text>
    </Pressable>
  );
}
export function NativeField({
  label,
  value,
  onChange,
  secret = false,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  secret?: boolean;
  multiline?: boolean;
}) {
  return (
    <View>
      <Text style={nativeStyles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        secureTextEntry={secret}
        multiline={multiline}
        autoCapitalize="none"
        style={[
          nativeStyles.input,
          multiline && { minHeight: 100, textAlignVertical: "top" },
        ]}
      />
    </View>
  );
}
export function NativeSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Record<string, string>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View>
      <Text style={nativeStyles.label}>{label}</Text>
      <View style={nativeStyles.row}>
        {Object.entries(options).map(([key, title]) => (
          <NativeButton
            key={key}
            label={(value === key ? "✓ " : "") + title}
            onPress={() => onChange(key)}
          />
        ))}
      </View>
    </View>
  );
}
