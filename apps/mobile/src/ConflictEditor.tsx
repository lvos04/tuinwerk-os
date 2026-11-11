import React, { useState } from "react";
import { Text, View } from "react-native";
import {
  NativeButton as Button,
  NativeField as Field,
  NativeSelect as Select,
  nativeStyles as s,
} from "./NativeWidgets";
type Row = Record<string, any>;
const names: Record<string, string> = {
  title: "Titel",
  description: "Omschrijving",
  version: "Basisversie",
  reason: "Reden",
  quantity: "Aantal",
  locationId: "Opslaglocatie",
  toLocationId: "Nieuwe opslaglocatie",
  assetId: "Machine",
  priority: "Prioriteit",
  status: "Status",
  type: "Mutatietype",
  minutes: "Minuten",
  startedAt: "Starttijd",
  endsAt: "Eindtijd",
  startsAt: "Begintijd",
  deadline: "Deadline",
  plannedAt: "Geplande datum",
  shared: "Gedeeld",
  body: "Opmerking",
  itemId: "Artikel",
  taskId: "Taak",
};
export function ConflictEditor({
  payload,
  onChange,
  catalogs,
  current,
}: {
  payload: Row;
  onChange: (value: Row) => void;
  catalogs: Record<string, Row[]>;
  current?: Row | null;
}) {
  const [advanced, setAdvanced] = useState(false);
  const set = (key: string, value: any) =>
    onChange({ ...payload, [key]: value });
  const choices = (key: string) => ({
    "": "Geen",
    ...Object.fromEntries(
      (catalogs[key] || []).map((row) => [row.id, row.name || row.title]),
    ),
  });
  return (
    <View style={{ gap: 10 }}>
      {current?.balances && (
        <View style={s.card}>
          <Text style={s.title}>Actuele voorraad</Text>
          {current.balances.map((balance: Row) => (
            <Text key={balance.locationId}>
              {balance.locationName || balance.locationId}: {balance.quantity} ·
              versie {balance.version}
            </Text>
          ))}
        </View>
      )}
      {current && (
        <View style={s.card}>
          <Text style={s.title}>Serverversie vergelijken</Text>
          {Object.entries(current)
            .filter(
              ([key, value]) => key in payload && typeof value !== "object",
            )
            .map(([key, value]) => (
              <Text key={key}>
                {names[key] || key}: {String(value ?? "")}
              </Text>
            ))}
          {typeof current.version === "number" && (
            <Button
              label={`Na controle serverversie ${current.version} gebruiken`}
              onPress={() => set("version", current.version)}
            />
          )}
        </View>
      )}
      {Object.entries(payload)
        .filter(([key]) => !["id", "operationId", "version"].includes(key))
        .map(([key, value]) => {
          if (
            [
              "locationId",
              "toLocationId",
              "assetId",
              "itemId",
              "taskId",
            ].includes(key)
          )
            return (
              <Select
                key={key}
                label={names[key]}
                value={value || ""}
                onChange={(value) => set(key, value || null)}
                options={choices(
                  key.includes("Location") || key === "locationId"
                    ? "locations"
                    : key === "assetId"
                      ? "assets"
                      : key === "itemId"
                        ? "inventory/items"
                        : "tasks",
                )}
              />
            );
          if (key === "priority" || key === "status" || key === "type")
            return (
              <Select
                key={key}
                label={names[key]}
                value={value}
                onChange={(value) => set(key, value)}
                options={
                  key === "priority"
                    ? {
                        low: "Laag",
                        normal: "Normaal",
                        high: "Hoog",
                        critical: "Kritiek",
                      }
                    : key === "status"
                      ? {
                          open: "Open",
                          planned: "Gepland",
                          in_progress: "Bezig",
                          blocked: "Geblokkeerd",
                          completed: "Afgerond",
                          cancelled: "Geannuleerd",
                          archived: "Gearchiveerd",
                        }
                      : {
                          receipt: "Aanvulling",
                          usage: "Verbruik",
                          transfer: "Verplaatsing",
                          correction: "Correctie",
                        }
                }
              />
            );
          if (key === "assignedTo" && Array.isArray(value))
            return (
              <View key={key}>
                <Text style={s.label}>Toewijzing</Text>
                {(catalogs.users || []).map((user) => (
                  <Button
                    key={user.id}
                    label={`${value.includes(user.id) ? "✓ " : ""}${user.name}`}
                    onPress={() =>
                      set(
                        key,
                        value.includes(user.id)
                          ? value.filter((id) => id !== user.id)
                          : [...value, user.id],
                      )
                    }
                  />
                ))}
              </View>
            );
          if (key === "checklist" && Array.isArray(value))
            return (
              <View key={key}>
                <Text style={s.label}>Checklist</Text>
                {value.map((line, index) => (
                  <Button
                    key={line.id || index}
                    label={`${line.done ? "☑" : "☐"} ${line.text}`}
                    onPress={() =>
                      set(
                        key,
                        value.map((row, i) =>
                          i === index ? { ...row, done: !row.done } : row,
                        ),
                      )
                    }
                  />
                ))}
              </View>
            );
          if (key === "lines" && Array.isArray(value))
            return (
              <View key={key}>
                <Text style={s.label}>Telregels</Text>
                {value.map((line, index) => (
                  <View key={line.itemId + line.locationId}>
                    <Text>
                      {(catalogs["inventory/items"] || []).find(
                        (row) => row.id === line.itemId,
                      )?.name || line.itemId}
                    </Text>
                    {current?.lines?.find(
                      (row: Row) =>
                        row.itemId === line.itemId &&
                        row.locationId === line.locationId,
                    ) &&
                      (() => {
                        const server = current.lines.find(
                          (row: Row) =>
                            row.itemId === line.itemId &&
                            row.locationId === line.locationId,
                        );
                        return (
                          <View>
                            <Text>
                              Server: {server.currentQuantity} · versie{" "}
                              {server.currentVersion}
                            </Text>
                            <Button
                              label="Deze serverversie na controle overnemen"
                              onPress={() =>
                                set(
                                  key,
                                  value.map((row, i) =>
                                    i === index
                                      ? {
                                          ...row,
                                          expectedVersion:
                                            server.currentVersion,
                                        }
                                      : row,
                                  ),
                                )
                              }
                            />
                          </View>
                        );
                      })()}
                    <Field
                      label="Geteld aantal"
                      value={String(line.quantity)}
                      onChange={(n) =>
                        set(
                          key,
                          value.map((row, i) =>
                            i === index ? { ...row, quantity: Number(n) } : row,
                          ),
                        )
                      }
                    />
                    <Field
                      label="Bevestigde voorraadversie na controle"
                      value={String(line.expectedVersion)}
                      onChange={(n) =>
                        set(
                          key,
                          value.map((row, i) =>
                            i === index
                              ? { ...row, expectedVersion: Number(n) }
                              : row,
                          ),
                        )
                      }
                    />
                  </View>
                ))}
              </View>
            );
          if (typeof value === "boolean")
            return (
              <Button
                key={key}
                label={`${value ? "✓ " : ""}${names[key] || key}`}
                onPress={() => set(key, !value)}
              />
            );
          if (value === null || ["string", "number"].includes(typeof value))
            return (
              <Field
                key={key}
                label={names[key] || key}
                value={String(value ?? "")}
                multiline={["description", "body", "reason"].includes(key)}
                onChange={(text) =>
                  set(key, typeof value === "number" ? Number(text) : text)
                }
              />
            );
          return (
            <Text key={key}>
              {names[key] || key}: aanvullende velden, zie geavanceerd.
            </Text>
          );
        })}
      <Button
        label={
          advanced ? "Geavanceerd sluiten" : "Geavanceerde gegevens bekijken"
        }
        onPress={() => setAdvanced(!advanced)}
      />
      {advanced && <Text selectable>{JSON.stringify(payload, null, 2)}</Text>}
    </View>
  );
}
