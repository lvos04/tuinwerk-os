import React, { useRef, useState } from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Svg, { Circle, Line, Text as SvgText } from "react-native-svg";
import { captureRef } from "react-native-view-shot";
type Mark = {
  kind: "circle" | "arrow" | "text";
  x: number;
  y: number;
  text?: string;
};
/** Annotations are a new derivative JPEG; caller always keeps the original. */
export function PhotoAnnotator({
  uri,
  onSave,
  onCancel,
}: {
  uri: string;
  onSave: (annotated: string) => void;
  onCancel: () => void;
}) {
  const canvas = useRef<View>(null),
    [marks, setMarks] = useState<Mark[]>([]),
    [mode, setMode] = useState<Mark["kind"]>("circle"),
    [label, setLabel] = useState(""),
    [error, setError] = useState(""),
    [size, setSize] = useState({ width: 300, height: 260 });
  const button = (title: string, action: () => void) => (
    <Pressable
      accessibilityRole="button"
      onPress={action}
      style={styles.button}
    >
      <Text>{title}</Text>
    </Pressable>
  );
  return (
    <View style={styles.wrapper}>
      <Text style={styles.title}>Foto annoteren</Text>
      <Text>
        Tik op de foto om een markering te plaatsen. Het origineel blijft apart
        bewaard.
      </Text>
      <View
        ref={canvas}
        collapsable={false}
        style={{ height: 260, backgroundColor: "#fff" }}
        onLayout={(event) => setSize(event.nativeEvent.layout)}
      >
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
        />
        <Svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${size.width} ${size.height}`}
          onPress={(event) => {
            const { x, y } = {
              x: event.nativeEvent.locationX,
              y: event.nativeEvent.locationY,
            };
            setMarks([...marks, { kind: mode, x, y, text: label || "Let op" }]);
          }}
        >
          {marks.map((mark, index) =>
            mark.kind === "circle" ? (
              <Circle
                key={index}
                cx={mark.x}
                cy={mark.y}
                r={24}
                fill="transparent"
                stroke="#d83a25"
                strokeWidth={4}
              />
            ) : mark.kind === "text" ? (
              <SvgText
                key={index}
                x={mark.x}
                y={mark.y}
                fontSize={20}
                fontWeight="bold"
                fill="#d83a25"
                stroke="#fff"
                strokeWidth={0.5}
              >
                {mark.text}
              </SvgText>
            ) : (
              <React.Fragment key={index}>
                <Line
                  x1={mark.x - 40}
                  y1={mark.y - 40}
                  x2={mark.x}
                  y2={mark.y}
                  stroke="#d83a25"
                  strokeWidth={4}
                />
                <Line
                  x1={mark.x - 18}
                  y1={mark.y}
                  x2={mark.x}
                  y2={mark.y}
                  stroke="#d83a25"
                  strokeWidth={4}
                />
                <Line
                  x1={mark.x}
                  y1={mark.y - 18}
                  x2={mark.x}
                  y2={mark.y}
                  stroke="#d83a25"
                  strokeWidth={4}
                />
              </React.Fragment>
            ),
          )}
        </Svg>
      </View>
      <View style={styles.row}>
        {button(mode === "circle" ? "✓ Cirkel" : "Cirkel", () =>
          setMode("circle"),
        )}
        {button(mode === "arrow" ? "✓ Pijl" : "Pijl", () => setMode("arrow"))}
        {button(mode === "text" ? "✓ Tekst" : "Tekst", () => setMode("text"))}
      </View>
      {mode === "text" && (
        <TextInput
          accessibilityLabel="Annotatietekst"
          placeholder="Tekst op foto"
          value={label}
          onChangeText={setLabel}
          style={styles.input}
        />
      )}
      <View style={styles.row}>
        {button("Ongedaan", () => setMarks(marks.slice(0, -1)))}
        {button("Opslaan", () => {
          void captureRef(canvas, { format: "jpg", quality: 0.9 })
            .then(onSave)
            .catch((e) => setError(String(e)));
        })}
        {button("Annuleren", onCancel)}
      </View>
      {!!error && <Text>{error}</Text>}
    </View>
  );
}
const styles = StyleSheet.create({
  wrapper: { gap: 12, padding: 12, backgroundColor: "#fff", borderRadius: 12 },
  title: { fontSize: 20, fontWeight: "700" },
  row: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  button: {
    padding: 14,
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: "#e7eddf",
  },
  input: { borderWidth: 1, borderColor: "#819377", padding: 12, minHeight: 48 },
});
