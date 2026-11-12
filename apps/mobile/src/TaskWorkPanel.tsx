import React, { useState } from "react";
import { Alert, Image, Text, View } from "react-native";
import {
  NativeButton as Button,
  NativeField as Field,
  NativeSelect as Select,
  nativeStyles as s,
} from "./NativeWidgets";
import { PhotoAnnotator } from "./PhotoAnnotator";
import { taskSyncState } from "./work-model";
import type { PendingOperation } from "./queue";
type Row = Record<string, any>;
type Props = {
  task: Row;
  catalogs: Record<string, Row[]>;
  queue: PendingOperation[];
  busy: boolean;
  online: boolean;
  timer: Row | null;
  photo: string | null;
  annotated: string | null;
  onPhoto: (camera: boolean) => void;
  onAnnotation: (uri: string) => void;
  onSavePhoto: (phase: string) => void;
  onStatus: (status: string, reason: string) => void;
  onChecklist: (checklist: Row[]) => void;
  onTimer: (action: "start" | "pause" | "stop") => void;
  onTime: (minutes: number) => void;
  onPart: (payload: Row) => void;
  onResolve: () => void;
  onSync: () => void;
};
export function TaskWorkPanel(props: Props) {
  const { task, catalogs, queue, busy, online, timer } = props;
  const [section, setSection] = useState("work"),
    [reason, setReason] = useState(""),
    [minutes, setMinutes] = useState("30"),
    [query, setQuery] = useState(""),
    [item, setItem] = useState(""),
    [location, setLocation] = useState(""),
    [quantity, setQuantity] = useState("1"),
    [note, setNote] = useState(""),
    [phase, setPhase] = useState("after"),
    [annotating, setAnnotating] = useState(false);
  const state = taskSyncState(task.id, queue, !!task.localDraft);
  const readOnly = ["completed", "cancelled", "archived"].includes(task.status);
  const items = (catalogs["inventory/items"] || [])
    .filter(
      (row) =>
        row.active !== false &&
        `${row.name} ${row.sku}`.toLowerCase().includes(query.toLowerCase()),
    )
    .slice(0, 30);
  const balances = (catalogs["inventory/balances"] || []).filter(
    (row) => row.itemId === item,
  );
  const locations = Object.fromEntries(
    balances.map((row) => [
      row.locationId,
      `${row.locationName || (catalogs.locations || []).find((loc) => loc.id === row.locationId)?.name || "Opslag"} · ${row.quantity} beschikbaar`,
    ]),
  );
  return (
    <View style={{ gap: 12 }}>
      <View style={s.card}>
        <Text accessibilityLiveRegion="polite" style={s.label}>
          {state.status === "confirmed"
            ? "✓ Op de server bevestigd"
            : state.status === "unverified"
              ? "◷ Verzonden; actuele serverstatus nog ophalen"
              : state.status === "pending"
                ? `◷ ${state.count} wijziging(en) veilig op dit toestel`
                : state.status === "conflict"
                  ? "! Conflict — jouw invoer is bewaard"
                  : "! Invoer corrigeren — jouw concept is bewaard"}
        </Text>
        {state.photos > 0 && (
          <Text>{state.photos} foto('s) wachten op serverbevestiging.</Text>
        )}
        {state.count > 0 && (
          <Button
            label={
              state.status === "pending"
                ? "Wachtende wijzigingen bekijken"
                : "Conflict bekijken en oplossen"
            }
            onPress={props.onResolve}
          />
        )}
        <Text style={s.text}>
          {online
            ? "Verbinding beschikbaar."
            : "Offline: wijzigingen en foto’s blijven lokaal tot synchronisatie."}
        </Text>
      </View>
      <Select
        label="Taak uitvoeren"
        value={section}
        onChange={setSection}
        options={{
          work: "✓ Werk",
          photos: "▣ Foto",
          time: "◷ Tijd",
          parts: "＋ Onderdelen",
        }}
      />
      {section === "work" && (
        <>
          <Text style={s.title}>Checklist en afronden</Text>
          <Text>
            Bewaar foto’s, tijd en onderdelen voordat je afrondt. Een lokaal
            concept blijft herkenbaar tot de server het heeft bevestigd.
          </Text>
          {(task.checklist || []).length === 0 && (
            <Text>Geen checklist. Je kunt direct starten.</Text>
          )}
          {(task.checklist || []).map((line: Row, index: number) => (
            <Button
              key={line.id || index}
              disabled={busy || readOnly}
              label={`${line.done ? "☑" : "☐"} ${line.text}${line.required ? " · verplicht" : ""}`}
              onPress={() =>
                props.onChecklist(
                  task.checklist.map((row: Row, i: number) =>
                    i === index ? { ...row, done: !row.done } : row,
                  ),
                )
              }
            />
          ))}
          {!readOnly && (
            <>
              <Button
                disabled={busy || task.status === "in_progress"}
                label="▶ Aan het werk"
                onPress={() => props.onStatus("in_progress", "")}
              />
              <Field
                label="Blokkade / reden"
                value={reason}
                onChange={setReason}
              />
              <Button
                disabled={busy || !reason.trim()}
                label="Werk blokkeren"
                onPress={() => props.onStatus("blocked", reason)}
              />
              <Button
                disabled={
                  busy ||
                  (task.checklist || []).some(
                    (row: Row) => row.required && !row.done,
                  )
                }
                label="✓ Taak afronden"
                onPress={() =>
                  Alert.alert(
                    "Taak afronden?",
                    "Je checklist en lokale wijzigingen blijven bewaard en worden op volgorde gesynchroniseerd.",
                    [
                      { text: "Terug", style: "cancel" },
                      {
                        text: "Afronden",
                        onPress: () => props.onStatus("completed", ""),
                      },
                    ],
                  )
                }
              />
            </>
          )}
          {["completed", "cancelled"].includes(task.status) && (
            <>
              <Field
                label="Reden voor heropenen"
                value={reason}
                onChange={setReason}
              />
              <Button
                disabled={busy || !reason.trim()}
                label="Taak heropenen"
                onPress={() => props.onStatus("open", reason)}
              />
            </>
          )}
        </>
      )}
      {section === "photos" && (
        <>
          <Text style={s.title}>Voor- en nafoto’s</Text>
          <Select
            label="Moment"
            value={phase}
            onChange={setPhase}
            options={{ before: "Voor", during: "Tijdens", after: "Na" }}
          />
          <Button
            disabled={busy || task.status === "archived"}
            label="Camera openen"
            onPress={() => props.onPhoto(true)}
          />
          <Button
            disabled={busy || task.status === "archived"}
            label="Foto uit bibliotheek"
            onPress={() => props.onPhoto(false)}
          />
          {props.photo && (
            <>
              <Image
                source={{ uri: props.annotated || props.photo }}
                style={{ height: 220, width: "100%", resizeMode: "contain" }}
              />
              <Button
                label="Pijl, cirkel of tekst toevoegen"
                onPress={() => setAnnotating(true)}
              />
              {annotating && (
                <PhotoAnnotator
                  uri={props.photo}
                  onCancel={() => setAnnotating(false)}
                  onSave={(uri) => {
                    props.onAnnotation(uri);
                    setAnnotating(false);
                  }}
                />
              )}
              <Button
                disabled={busy}
                label="Foto veilig bewaren bij taak"
                onPress={() => props.onSavePhoto(phase)}
              />
            </>
          )}
          <Text>Het origineel blijft naast eventuele annotatie bestaan.</Text>
        </>
      )}
      {section === "time" && (
        <>
          <Text style={s.title}>Bestede tijd</Text>
          {timer && (
            <Text>
              {timer.taskId === task.id ? "Deze taak" : "Andere taak"} ·{" "}
              {timer.runningSince ? "timer loopt" : "gepauzeerd"}
            </Text>
          )}
          <Button
            disabled={busy || !!timer?.runningSince || readOnly}
            label="▶ Start / hervat timer"
            onPress={() => props.onTimer("start")}
          />
          {timer?.taskId === task.id && (
            <>
              <Button
                disabled={busy || !timer?.runningSince}
                label="Ⅱ Pauzeer"
                onPress={() => props.onTimer("pause")}
              />
              <Button
                disabled={busy}
                label="■ Stop en bewaar tijd"
                onPress={() => props.onTimer("stop")}
              />
            </>
          )}
          <Field
            label="Of handmatig: minuten"
            value={minutes}
            onChange={setMinutes}
          />
          <Button
            disabled={
              busy ||
              !Number.isFinite(Number(minutes)) ||
              Number(minutes) <= 0 ||
              task.status === "archived"
            }
            label="Minuten bewaren"
            onPress={() => props.onTime(Number(minutes))}
          />
        </>
      )}
      {section === "parts" && (
        <>
          <Text style={s.title}>Onderdelen bij deze taak</Text>
          <Field
            label="Zoek artikel of artikelnummer"
            value={query}
            onChange={setQuery}
          />
          <Select
            label="Artikel"
            value={item}
            options={Object.fromEntries(
              items.map((row) => [row.id, `${row.name} · ${row.sku || ""}`]),
            )}
            onChange={(value) => {
              setItem(value);
              setLocation("");
            }}
          />
          {item && (
            <>
              <Select
                label="Uit opslaglocatie"
                value={location}
                options={locations}
                onChange={setLocation}
              />
              {!balances.length && (
                <Text>
                  Geen opgeslagen voorraadlocatie gevonden. Synchroniseer of
                  beheer het artikel in Voorraad.
                </Text>
              )}
              <Field
                label="Gebruikt aantal"
                value={quantity}
                onChange={setQuantity}
              />
              <Field label="Notitie" value={note} onChange={setNote} />
              <Text style={s.text}>
                Dit wordt een concept tot de server de voorraad heeft
                gecontroleerd. Het bevestigde saldo verandert pas daarna.
              </Text>
              <Button
                disabled={
                  busy ||
                  !location ||
                  !Number.isFinite(Number(quantity.replace(",", "."))) ||
                  Number(quantity.replace(",", ".")) <= 0 ||
                  readOnly
                }
                label="Onderdeelverbruik bewaren"
                onPress={() =>
                  props.onPart({
                    taskId: task.id,
                    itemId: item,
                    locationId: location,
                    quantity: Number(quantity.replace(",", ".")),
                    type: "usage",
                    reason: note,
                  })
                }
              />
            </>
          )}
        </>
      )}
    </View>
  );
}
