import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Crypto from "expo-crypto";
import { authorizedRequest, Session } from "./api";

type Row = Record<string, any>;
type Props = { session: Session; onError?: (error: unknown) => void };
const today = () => new Date().toISOString().slice(0, 10);
const dateText = (value: any) => String(value || "").slice(0, 10);
const frequencies: Record<string, string> = {
  daily: "Dagen",
  weekly: "Weken",
  monthly: "Maanden",
  yearly: "Jaren",
  dates: "Vaste datums",
};
const days = ["Zo", "Ma", "Di", "Wo", "Do", "Vr", "Za"];
const statuses: Record<string, string> = {
  open: "Open",
  planned: "Gepland",
  in_progress: "Bezig",
  completed: "Afgerond",
  blocked: "Geblokkeerd",
  cancelled: "Geannuleerd",
  archived: "Gearchiveerd",
};
const emptyRule = () => ({
  title: "",
  description: "",
  frequency: "monthly",
  interval: "1",
  startDate: today(),
  endDate: "",
  mode: "calendar",
  weekdays: [1] as number[],
  nth: "",
  weekday: 1,
  dates: "",
  exceptions: "",
  assetId: "",
  locationId: "",
  assigneeIds: [] as string[],
  checklist: "",
});
const newActivity = () => ({
  title: "",
  offsetDays: "0",
  description: "",
  assetId: "",
  locationId: "",
  assigneeIds: [] as string[],
  checklist: "",
});
function Input({
  label,
  value,
  onChange,
  multiline = false,
  numeric = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  numeric?: boolean;
}) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        style={[s.input, multiline && s.multiline]}
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        keyboardType={numeric ? "numbers-and-punctuation" : "default"}
        autoCapitalize="sentences"
      />
    </View>
  );
}
function Button({
  label,
  onPress,
  disabled = false,
  secondary = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[s.button, secondary && s.secondary, disabled && s.disabled]}
    >
      <Text style={[s.buttonText, secondary && s.secondaryText]}>{label}</Text>
    </Pressable>
  );
}
function Select({
  label,
  options,
  value,
  onChange,
  multiple = false,
}: {
  label: string;
  options: Record<string, string>;
  value: string | string[];
  onChange: (value: any) => void;
  multiple?: boolean;
}) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <View style={s.wrap}>
        {Object.entries(options).map(([key, title]) => {
          const selected = multiple
            ? (value as string[]).includes(key)
            : value === key;
          return (
            <Pressable
              key={key}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              onPress={() =>
                onChange(
                  multiple
                    ? selected
                      ? (value as string[]).filter((v) => v !== key)
                      : [...(value as string[]), key]
                    : key,
                )
              }
              style={[s.chip, selected && s.selected]}
            >
              <Text style={[s.chipText, selected && s.selectedText]}>
                {selected ? "✓ " : ""}
                {title}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
function requireDate(value: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw Error("Voer een bestaande datum in als JJJJ-MM-DD.");
  return value;
}
function dateList(value: string) {
  return value
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(requireDate);
}
function checklistLines(value: string, original: Row[] = []) {
  return value
    .split("\n")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((text) => {
      const existing = original.find((x) => x && x.text === text);
      return {
        ...existing,
        text,
        required: existing?.required ?? true,
        done: false,
      };
    });
}

/** Online maintenance administration. Forms remain intact after network/version errors. */
export function MaintenanceScreen({ session, onError }: Props) {
  const [rules, setRules] = useState<Row[]>([]),
    [seasons, setSeasons] = useState<Row[]>([]),
    [activations, setActivations] = useState<Row[]>([]),
    [users, setUsers] = useState<Row[]>([]),
    [assets, setAssets] = useState<Row[]>([]),
    [locations, setLocations] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [tab, setTab] = useState("rules");
  const [ruleEditor, setRuleEditor] = useState(false),
    [editingRule, setEditingRule] = useState<Row | null>(null),
    [rule, setRule] = useState(emptyRule());
  const [seasonEditor, setSeasonEditor] = useState(false),
    [editingSeason, setEditingSeason] = useState<Row | null>(null),
    [seasonName, setSeasonName] = useState(""),
    [activities, setActivities] = useState<ReturnType<typeof newActivity>[]>([
      newActivity(),
    ]);
  const [activate, setActivate] = useState<Row | null>(null),
    [anchor, setAnchor] = useState(today()),
    [assigned, setAssigned] = useState<string[]>([]),
    [overrideAssigned, setOverrideAssigned] = useState(false),
    [activationOp, setActivationOp] = useState("");
  const [shift, setShift] = useState<Row | null>(null),
    [shiftDate, setShiftDate] = useState(today()),
    [history, setHistory] = useState<{ title: string; rows: Row[] } | null>(
      null,
    );
  const load = useCallback(async () => {
    const result = await Promise.all(
      [
        "/recurrences",
        "/seasons",
        "/seasons/activations",
        "/users",
        "/assets",
        "/locations",
      ].map((path) => authorizedRequest(session, path)),
    );
    setRules(result[0]);
    setSeasons(result[1]);
    setActivations(result[2]);
    setUsers(result[3]);
    setAssets(result[4]);
    setLocations(result[5]);
  }, [session]);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Actie mislukt. Probeer opnieuw.",
      );
      onError?.(e);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    let mounted = true;
    setBusy(true);
    load()
      .catch((e) => {
        if (mounted)
          setError(e instanceof Error ? e.message : "Onderhoud laden mislukt");
      })
      .finally(() => {
        if (mounted) setBusy(false);
      });
    return () => {
      mounted = false;
    };
  }, [load]);
  const userOptions = Object.fromEntries(
    users.filter((u) => u.active !== false).map((u) => [u.id, u.name]),
  );
  const assetOptions = {
    "": "Geen machine",
    ...Object.fromEntries(
      assets.filter((a) => a.status !== "archived").map((a) => [a.id, a.name]),
    ),
  };
  const locationOptions = {
    "": "Geen locatie",
    ...Object.fromEntries(
      locations.filter((l) => l.active !== false).map((l) => [l.id, l.name]),
    ),
  };
  const updateRule = (key: string, value: any) =>
    setRule((r) => ({ ...r, [key]: value }));
  function openRule(row?: Row) {
    setEditingRule(row || null);
    const c = row?.config || {},
      t = row?.taskTemplate || {};
    setRule(
      row
        ? {
            title: row.title,
            description: row.description || "",
            frequency: c.frequency || "monthly",
            interval: String(c.interval || 1),
            startDate: c.startDate,
            endDate: c.endDate || "",
            mode: c.mode || "calendar",
            weekdays: c.weekdays || [1],
            nth: c.nthWeekday ? String(c.nthWeekday.nth) : "",
            weekday: c.nthWeekday?.weekday ?? 1,
            dates: (c.dates || []).join("\n"),
            exceptions: (c.exceptions || []).join("\n"),
            assetId: t.assetId || "",
            locationId: t.locationId || "",
            assigneeIds: t.assigneeIds || t.assignedTo || [],
            checklist: (t.checklist || [])
              .map((x: any) => (typeof x === "string" ? x : x.text))
              .join("\n"),
          }
        : emptyRule(),
    );
    setRuleEditor(true);
    setHistory(null);
  }
  async function saveRule() {
    if (!rule.title.trim()) throw Error("Vul een titel in.");
    const interval = Number(rule.interval);
    if (!Number.isInteger(interval) || interval < 1)
      throw Error("Voer een positief heel interval in.");
    const config: Row = {
      frequency: rule.frequency,
      interval,
      startDate: requireDate(rule.startDate),
      mode: rule.mode,
      exceptions: dateList(rule.exceptions),
    };
    if (rule.endDate) config.endDate = requireDate(rule.endDate);
    if (rule.frequency === "dates") config.dates = dateList(rule.dates);
    if (rule.mode === "calendar" && rule.frequency === "weekly")
      config.weekdays = rule.weekdays;
    if (
      rule.mode === "calendar" &&
      ["monthly", "yearly"].includes(rule.frequency) &&
      rule.nth
    )
      config.nthWeekday = { nth: Number(rule.nth), weekday: rule.weekday };
    const body = {
      title: rule.title.trim(),
      description: rule.description,
      config,
      taskTemplate: {
        ...(editingRule?.taskTemplate || {}),
        assetId: rule.assetId || null,
        locationId: rule.locationId || null,
        assigneeIds: rule.assigneeIds,
        checklist: checklistLines(
          rule.checklist,
          editingRule?.taskTemplate?.checklist,
        ),
      },
      ...(editingRule ? { version: editingRule.version } : {}),
    };
    await authorizedRequest(
      session,
      "/recurrences" + (editingRule ? "/" + editingRule.id : ""),
      editingRule ? "PATCH" : "POST",
      body,
    );
    setRuleEditor(false);
    await load();
    setNotice(
      "Onderhoudssjabloon opgeslagen. De worker maakt komende beurten aan.",
    );
  }
  function openSeason(row?: Row) {
    setEditingSeason(row || null);
    setSeasonName(row?.name || "");
    setActivities(
      row
        ? row.activities.map((a: Row) => ({
            ...newActivity(),
            ...a,
            offsetDays: String(a.offsetDays),
            checklist: (a.checklist || [])
              .map((x: any) => (typeof x === "string" ? x : x.text))
              .join("\n"),
          }))
        : [newActivity()],
    );
    setSeasonEditor(true);
  }
  async function saveSeason() {
    if (!seasonName.trim()) throw Error("Geef het seizoen een naam.");
    const entries = activities.map((a, index) => {
      if (!a.title.trim() || !Number.isInteger(Number(a.offsetDays)))
        throw Error(
          "Elke activiteit heeft een titel en een heel aantal relatieve dagen nodig.",
        );
      return {
        ...a,
        title: a.title.trim(),
        offsetDays: Number(a.offsetDays),
        assetId: a.assetId || null,
        locationId: a.locationId || null,
        checklist: checklistLines(
          a.checklist,
          editingSeason?.activities[index]?.checklist,
        ),
      };
    });
    await authorizedRequest(
      session,
      "/seasons" + (editingSeason ? "/" + editingSeason.id : ""),
      editingSeason ? "PATCH" : "POST",
      {
        name: seasonName.trim(),
        activities: entries,
        ...(editingSeason ? { version: editingSeason.version } : {}),
      },
    );
    setSeasonEditor(false);
    await load();
    setNotice(
      "Seizoenssjabloon opgeslagen. Eerdere activaties blijven behouden.",
    );
  }
  const updateActivity = (index: number, key: string, value: any) =>
    setActivities((rows) =>
      rows.map((a, i) => (i === index ? { ...a, [key]: value } : a)),
    );
  const closeEditors = () => {
    setRuleEditor(false);
    setSeasonEditor(false);
    setActivate(null);
    setShift(null);
    setHistory(null);
  };
  return (
    <View style={s.container}>
      <Text accessibilityRole="header" style={s.title}>
        Onderhoud & seizoenen
      </Text>
      <Text style={s.muted}>
        Deze beheerschermen hebben verbinding nodig. Niet-opgeslagen invoer
        blijft staan bij een fout.
      </Text>
      <Select
        label="Overzicht"
        options={{
          rules: "Herhalend onderhoud",
          seasons: "Seizoenssjablonen",
          activations: "Geactiveerde seizoenen",
        }}
        value={tab}
        onChange={(value) => {
          setTab(value);
          closeEditors();
        }}
      />
      {busy && <ActivityIndicator accessibilityLabel="Bezig met verwerken" />}
      {!!error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error} Bij een versieconflict: vernieuw het overzicht en open de
          actuele versie voordat je opnieuw wijzigt.
        </Text>
      )}
      {!!notice && (
        <Text accessibilityRole="alert" style={s.notice}>
          {notice}
        </Text>
      )}
      <Button
        secondary
        label="Overzicht vernieuwen"
        disabled={busy}
        onPress={() => void run(load)}
      />
      {tab === "rules" && !ruleEditor && (
        <>
          <Button
            label="Onderhoudssjabloon toevoegen"
            disabled={busy}
            onPress={() => openRule()}
          />
          <Button
            secondary
            label="Komende onderhoudsbeurten nu aanmaken"
            disabled={busy}
            onPress={() =>
              void run(async () => {
                const result = await authorizedRequest(
                  session,
                  "/recurrences/generate",
                  "POST",
                  {},
                );
                await load();
                setNotice(
                  `${result.generated} beurten aangemaakt.${result.failures?.length ? " " + result.failures.length + " sjablonen hebben een fout; controleer toegewezen medewerkers." : ""}`,
                );
              })
            }
          />
          {!rules.length && !busy && (
            <Text style={s.muted}>Nog geen onderhoudssjablonen.</Text>
          )}
          {rules.map((row) => (
            <View key={row.id} style={s.card}>
              <Text style={s.heading}>{row.title}</Text>
              <Text>
                {row.active ? "Actief" : "Gepauzeerd"} · Elke{" "}
                {row.config.interval || 1}{" "}
                {frequencies[row.config.frequency]?.toLowerCase()} · Vanaf{" "}
                {row.config.startDate}
              </Text>
              <Text style={s.muted}>
                {row.occurrenceCount || 0} beurten ·{" "}
                {row.config.mode === "completion"
                  ? "Vanaf laatste uitvoering"
                  : "Vaste kalender"}
              </Text>
              <Button
                secondary
                label="Sjabloon bewerken"
                disabled={busy}
                onPress={() => openRule(row)}
              />
              <Button
                secondary
                label="Uitvoeringshistorie bekijken"
                disabled={busy}
                onPress={() =>
                  void run(async () =>
                    setHistory({
                      title: row.title,
                      rows: await authorizedRequest(
                        session,
                        `/recurrences/${row.id}/occurrences`,
                      ),
                    }),
                  )
                }
              />
              <Button
                secondary
                label={
                  row.active
                    ? "Toekomstige generatie pauzeren"
                    : "Generatie hervatten"
                }
                disabled={busy}
                onPress={() =>
                  Alert.alert(
                    row.active ? "Onderhoud pauzeren?" : "Onderhoud hervatten?",
                    "Bestaande opdrachten blijven zichtbaar.",
                    [
                      { text: "Annuleren", style: "cancel" },
                      {
                        text: "Bevestigen",
                        onPress: () =>
                          void run(async () => {
                            await authorizedRequest(
                              session,
                              "/recurrences/" + row.id,
                              "PATCH",
                              { version: row.version, active: !row.active },
                            );
                            await load();
                          }),
                      },
                    ],
                  )
                }
              />
            </View>
          ))}
        </>
      )}
      {ruleEditor && (
        <View style={s.card}>
          <Text style={s.heading}>
            {editingRule ? "Onderhoud wijzigen" : "Nieuw onderhoud"}
          </Text>
          {editingRule && (
            <Text style={s.muted}>
              Een kalenderwijziging vervangt nog niet gestarte toekomstige
              beurten. Uitgevoerd en begonnen werk blijft behouden.
            </Text>
          )}
          <Input
            label="Titel"
            value={rule.title}
            onChange={(v) => updateRule("title", v)}
          />
          <Input
            label="Omschrijving"
            value={rule.description}
            onChange={(v) => updateRule("description", v)}
            multiline
          />
          <Select
            label="Herhaal op basis van"
            options={{ calendar: "Kalender", completion: "Laatste uitvoering" }}
            value={rule.mode}
            onChange={(v) => {
              updateRule("mode", v);
              if (v === "completion" && rule.frequency === "dates")
                updateRule("frequency", "daily");
            }}
          />
          <Select
            label="Frequentie"
            options={
              rule.mode === "completion"
                ? Object.fromEntries(
                    Object.entries(frequencies).filter(([k]) => k !== "dates"),
                  )
                : frequencies
            }
            value={rule.frequency}
            onChange={(v) => updateRule("frequency", v)}
          />
          {rule.frequency !== "dates" && (
            <Input
              label="Elke hoeveel dagen / weken / maanden / jaren?"
              numeric
              value={rule.interval}
              onChange={(v) => updateRule("interval", v)}
            />
          )}
          <Input
            label="Startdatum (JJJJ-MM-DD)"
            value={rule.startDate}
            onChange={(v) => updateRule("startDate", v)}
          />
          <Input
            label="Einddatum (optioneel, JJJJ-MM-DD)"
            value={rule.endDate}
            onChange={(v) => updateRule("endDate", v)}
          />
          {rule.mode === "calendar" && rule.frequency === "weekly" && (
            <Select
              multiple
              label="Weekdagen"
              options={Object.fromEntries(days.map((d, i) => [String(i), d]))}
              value={rule.weekdays.map(String)}
              onChange={(v) => updateRule("weekdays", v.map(Number))}
            />
          )}
          {rule.mode === "calendar" &&
            ["monthly", "yearly"].includes(rule.frequency) && (
              <>
                <Select
                  label="Dag van de maand"
                  options={{
                    "": "Datum van startdag",
                    "1": "Eerste weekdag",
                    "2": "Tweede weekdag",
                    "3": "Derde weekdag",
                    "4": "Vierde weekdag",
                    "5": "Vijfde weekdag",
                    "-1": "Laatste weekdag",
                  }}
                  value={rule.nth}
                  onChange={(v) => updateRule("nth", v)}
                />
                {!!rule.nth && (
                  <Select
                    label="Weekdag"
                    options={Object.fromEntries(
                      days.map((d, i) => [String(i), d]),
                    )}
                    value={String(rule.weekday)}
                    onChange={(v) => updateRule("weekday", Number(v))}
                  />
                )}
              </>
            )}
          {rule.frequency === "dates" && (
            <Input
              label="Kalenderdatums (één JJJJ-MM-DD per regel)"
              value={rule.dates}
              onChange={(v) => updateRule("dates", v)}
              multiline
            />
          )}
          <Input
            label="Uitzonderingsdatums (optioneel, één per regel)"
            value={rule.exceptions}
            onChange={(v) => updateRule("exceptions", v)}
            multiline
          />
          <Select
            label="Machine"
            options={assetOptions}
            value={rule.assetId}
            onChange={(v) => updateRule("assetId", v)}
          />
          <Select
            label="Locatie"
            options={locationOptions}
            value={rule.locationId}
            onChange={(v) => updateRule("locationId", v)}
          />
          <Select
            multiple
            label="Toegewezen medewerkers"
            options={userOptions}
            value={rule.assigneeIds}
            onChange={(v) => updateRule("assigneeIds", v)}
          />
          <Input
            label="Checklist (één controle per regel; nieuwe zijn verplicht)"
            value={rule.checklist}
            onChange={(v) => updateRule("checklist", v)}
            multiline
          />
          <Button
            label="Onderhoud opslaan"
            disabled={busy}
            onPress={() => void run(saveRule)}
          />
          <Button
            secondary
            label="Bewerken sluiten"
            disabled={busy}
            onPress={() => setRuleEditor(false)}
          />
        </View>
      )}
      {history && (
        <View style={s.card}>
          <Text style={s.heading}>Historie · {history.title}</Text>
          {history.rows.map((row, i) => (
            <View key={row.taskId + ":" + i} style={s.history}>
              <Text style={s.label}>
                {dateText(row.dueDate)} · {statuses[row.status] || row.status}
              </Text>
              <Text>{row.title}</Text>
              {row.completedAt && (
                <Text>
                  Afgerond: {new Date(row.completedAt).toLocaleString("nl-NL")}
                </Text>
              )}
              {row.superseded && (
                <Text style={s.muted}>
                  Vervangen na wijziging van de herhaalregel
                </Text>
              )}
            </View>
          ))}
          {!history.rows.length && <Text>Nog geen uitvoeringsbeurten.</Text>}
          <Button
            secondary
            label="Historie sluiten"
            onPress={() => setHistory(null)}
          />
        </View>
      )}
      {tab === "seasons" && !seasonEditor && (
        <>
          <Button
            label="Seizoenssjabloon toevoegen"
            disabled={busy}
            onPress={() => openSeason()}
          />
          {seasons.map((row) => (
            <View key={row.id} style={s.card}>
              <Text style={s.heading}>{row.name}</Text>
              {row.activities.map((a: Row, i: number) => (
                <Text key={i}>
                  {Number(a.offsetDays) >= 0 ? "+" : ""}
                  {a.offsetDays} dagen · {a.title}
                </Text>
              ))}
              <Button
                secondary
                label="Sjabloon bewerken"
                disabled={busy}
                onPress={() => openSeason(row)}
              />
              <Button
                label="Seizoen activeren"
                disabled={busy}
                onPress={() => {
                  setActivate(row);
                  setAnchor(today());
                  setAssigned([]);
                  setOverrideAssigned(false);
                  setActivationOp(Crypto.randomUUID());
                }}
              />
            </View>
          ))}
          {!seasons.length && !busy && (
            <Text style={s.muted}>
              Maak activiteiten rond een start-, oogst- of teeltwisseldatum.
            </Text>
          )}
        </>
      )}
      {seasonEditor && (
        <View style={s.card}>
          <Text style={s.heading}>
            {editingSeason ? "Seizoen wijzigen" : "Nieuw seizoenssjabloon"}
          </Text>
          <Input
            label="Naam van het seizoen"
            value={seasonName}
            onChange={setSeasonName}
          />
          {activities.map((a, i) => (
            <View key={i} style={s.activity}>
              <Text style={s.heading}>Activiteit {i + 1}</Text>
              <Input
                label="Titel activiteit"
                value={a.title}
                onChange={(v) => updateActivity(i, "title", v)}
              />
              <Input
                label="Dagen vanaf startdatum (negatief = ervoor)"
                numeric
                value={a.offsetDays}
                onChange={(v) => updateActivity(i, "offsetDays", v)}
              />
              <Input
                label="Omschrijving activiteit"
                value={a.description}
                onChange={(v) => updateActivity(i, "description", v)}
                multiline
              />
              <Select
                label="Machine"
                options={assetOptions}
                value={a.assetId}
                onChange={(v) => updateActivity(i, "assetId", v)}
              />
              <Select
                label="Locatie"
                options={locationOptions}
                value={a.locationId}
                onChange={(v) => updateActivity(i, "locationId", v)}
              />
              <Select
                multiple
                label="Medewerkers"
                options={userOptions}
                value={a.assigneeIds}
                onChange={(v) => updateActivity(i, "assigneeIds", v)}
              />
              <Input
                label="Checklist (nieuwe controles zijn verplicht)"
                value={a.checklist}
                onChange={(v) => updateActivity(i, "checklist", v)}
                multiline
              />
              {activities.length > 1 && (
                <Button
                  secondary
                  label="Activiteit verwijderen"
                  onPress={() =>
                    setActivities((rows) => rows.filter((_, n) => n !== i))
                  }
                />
              )}
            </View>
          ))}
          <Button
            secondary
            label="Activiteit toevoegen"
            onPress={() => setActivities((rows) => [...rows, newActivity()])}
          />
          <Button
            label="Seizoenssjabloon opslaan"
            disabled={busy}
            onPress={() => void run(saveSeason)}
          />
          <Button
            secondary
            label="Bewerken sluiten"
            disabled={busy}
            onPress={() => setSeasonEditor(false)}
          />
        </View>
      )}
      {activate && (
        <View style={s.card}>
          <Text style={s.heading}>Activeren · {activate.name}</Text>
          <Input
            label="Gebeurtenisdatum (JJJJ-MM-DD)"
            value={anchor}
            onChange={setAnchor}
          />
          <View style={s.switchRow}>
            <Text style={s.label}>
              Medewerkers voor alle activiteiten vervangen
            </Text>
            <Switch
              accessibilityLabel="Medewerkers vervangen"
              value={overrideAssigned}
              onValueChange={setOverrideAssigned}
            />
          </View>
          {overrideAssigned && (
            <Select
              multiple
              label="Medewerkers voor dit seizoen"
              options={userOptions}
              value={assigned}
              onChange={setAssigned}
            />
          )}
          <Text style={s.muted}>
            Hiermee worden {activate.activities.length} echte taken aangemaakt.
          </Text>
          <Button
            label="Activatie bevestigen"
            disabled={busy}
            onPress={() =>
              void run(async () => {
                const result = await authorizedRequest(
                  session,
                  `/seasons/${activate.id}/activate`,
                  "POST",
                  {
                    operationId: activationOp,
                    date: requireDate(anchor),
                    ...(overrideAssigned ? { assigneeIds: assigned } : {}),
                  },
                );
                setActivate(null);
                await load();
                setNotice(`${result.taskIds.length} seizoenstaken aangemaakt.`);
              })
            }
          />
          <Button
            secondary
            label="Annuleren"
            onPress={() => setActivate(null)}
          />
        </View>
      )}
      {tab === "activations" && (
        <>
          {!activations.length && !busy && (
            <Text style={s.muted}>Er zijn nog geen seizoenen geactiveerd.</Text>
          )}
          {activations.map((row) => (
            <View style={s.card} key={row.id}>
              <Text style={s.heading}>{row.name}</Text>
              <Text>
                Gebeurtenisdatum: {dateText(row.anchorDate)} ·{" "}
                {row.taskIds.length} taken
              </Text>
              <Button
                secondary
                label="Seizoensplanning verschuiven"
                disabled={busy}
                onPress={() => {
                  setShift(row);
                  setShiftDate(dateText(row.anchorDate));
                  setOverrideAssigned(false);
                  setAssigned([]);
                }}
              />
            </View>
          ))}
        </>
      )}
      {shift && (
        <View style={s.card}>
          <Text style={s.heading}>Verschuiven · {shift.name}</Text>
          <Input
            label="Nieuwe gebeurtenisdatum (JJJJ-MM-DD)"
            value={shiftDate}
            onChange={setShiftDate}
          />
          <Text style={s.muted}>
            Alleen nog niet gestarte taken verschuiven. Begonnen en afgeronde
            taken blijven behouden. Persoonlijke agendablokken veranderen niet
            mee.
          </Text>
          <View style={s.switchRow}>
            <Text style={s.label}>Medewerkers vervangen</Text>
            <Switch
              accessibilityLabel="Medewerkers bij verschuiving vervangen"
              value={overrideAssigned}
              onValueChange={setOverrideAssigned}
            />
          </View>
          {overrideAssigned && (
            <Select
              multiple
              label="Nieuwe medewerkers"
              options={userOptions}
              value={assigned}
              onChange={setAssigned}
            />
          )}
          <Button
            label="Verschuiving bevestigen"
            disabled={busy}
            onPress={() =>
              void run(async () => {
                const result = await authorizedRequest(
                  session,
                  `/seasons/activations/${shift.id}/shift`,
                  "POST",
                  {
                    version: shift.version,
                    date: requireDate(shiftDate),
                    ...(overrideAssigned ? { assigneeIds: assigned } : {}),
                  },
                );
                setShift(null);
                await load();
                setNotice(
                  `${result.shifted.length} taken verschoven; ${result.skipped.length} begonnen/afgeronde taken behouden.`,
                );
              })
            }
          />
          <Button secondary label="Annuleren" onPress={() => setShift(null)} />
        </View>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  container: { gap: 12 },
  title: { fontSize: 25, fontWeight: "800", color: "#173e31" },
  heading: { fontSize: 18, fontWeight: "700", color: "#173e31" },
  muted: { fontSize: 14, lineHeight: 21, color: "#53665d" },
  field: { gap: 7, marginVertical: 7 },
  label: { fontSize: 15, fontWeight: "600", color: "#233e32" },
  input: {
    borderColor: "#9eafa4",
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 48,
    padding: 12,
    fontSize: 16,
    backgroundColor: "#fff",
    color: "#172e24",
  },
  multiline: { minHeight: 90, textAlignVertical: "top" },
  button: {
    minHeight: 48,
    borderRadius: 10,
    backgroundColor: "#176349",
    padding: 12,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 4,
  },
  buttonText: { fontSize: 16, fontWeight: "700", color: "#fff" },
  secondary: {
    backgroundColor: "#edf3ee",
    borderWidth: 1,
    borderColor: "#b0c1b5",
  },
  secondaryText: { color: "#1c4c36" },
  disabled: { opacity: 0.5 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 46,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#a8bbae",
    backgroundColor: "#fff",
  },
  chipText: { fontSize: 15, color: "#294b36" },
  selected: { backgroundColor: "#1d664a", borderColor: "#1d664a" },
  selectedText: { color: "#fff", fontWeight: "700" },
  card: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ccd9cf",
    borderRadius: 14,
    padding: 15,
    gap: 9,
  },
  activity: {
    padding: 12,
    borderWidth: 1,
    borderColor: "#cbd8cc",
    borderRadius: 10,
    gap: 4,
    marginVertical: 8,
  },
  error: {
    color: "#9c2925",
    backgroundColor: "#fff0ed",
    padding: 12,
    borderRadius: 8,
    lineHeight: 22,
  },
  notice: {
    color: "#185834",
    backgroundColor: "#e5f4e7",
    padding: 12,
    borderRadius: 8,
    lineHeight: 22,
  },
  history: {
    borderBottomWidth: 1,
    borderBottomColor: "#e2e9e2",
    paddingVertical: 12,
    gap: 4,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
});
