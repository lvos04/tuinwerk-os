import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Session, authorizedRequest } from "./api";
import {
  NativeButton as Button,
  NativeField as Field,
  NativeSelect as Select,
  nativeStyles as s,
} from "./NativeWidgets";
type Row = Record<string, any>;
const when = (value: any) =>
  value ? new Date(value).toLocaleString("nl-NL") : "Nog niet";
export function BackupChecks({
  session,
  local,
  remote,
  onRecorded,
  disabled,
}: {
  session: Session;
  local: Row[];
  remote: Row[];
  onRecorded: () => Promise<void>;
  disabled: boolean;
}) {
  const [checks, setChecks] = useState<Row[]>([]),
    [selected, setSelected] = useState(""),
    [source, setSource] = useState("local"),
    [archive, setArchive] = useState(""),
    [secret, setSecret] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [taskReference, setTaskReference] = useState(""),
    [fileReference, setFileReference] = useState(""),
    [taskChecked, setTaskChecked] = useState(false),
    [fileChecked, setFileChecked] = useState(false),
    [notes, setNotes] = useState("");
  const load = async () =>
    setChecks(
      await authorizedRequest(session, "/admin/backups/restore-checks"),
    );
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [session.user.id, session.endpoint]);
  const pending = checks.some(
    (row) => !["completed", "failed"].includes(row.technicalState),
  );
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(
      () => void load().catch((e) => setError(e.message)),
      4000,
    );
    return () => clearInterval(timer);
  }, [pending]);
  const current = checks.find((row) => row.id === selected);
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Controle mislukt");
    } finally {
      setBusy(false);
    }
  };
  const choose = (id: string) => {
    setSelected(id);
    setTaskChecked(false);
    setFileChecked(false);
    setTaskReference("");
    setFileReference("");
    setNotes("");
  };
  return (
    <View style={{ gap: 12 }}>
      <Text style={s.title}>Periodieke herstelcontrole</Text>
      <Text style={s.text}>
        1. Laat een gekozen archief ontsleutelen en controleer structuur en
        checksums. Deze stap verandert niets op deze server.
      </Text>
      <Text style={s.text}>
        2. Open in een aparte herstelde testinstallatie een bekende taak en foto
        of document. Leg daarna je eigen waarnemingen vast. De technische
        archiefcontrole alleen bewijst geen succesvol gegevensherstel.
      </Text>
      {!!error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
      <Select
        label="Archiefbron voor de controle"
        options={{ local: "Op deze server", onedrive: "OneDrive" }}
        value={source}
        onChange={(v) => {
          setSource(v);
          setArchive("");
        }}
      />
      <Select
        label="Te controleren back-up"
        value={archive}
        onChange={setArchive}
        options={{
          "": "Kies een archief",
          ...Object.fromEntries(
            (source === "local"
              ? local.filter((row) => row.localAvailable !== false)
              : remote
            ).map((row) => [
              row.id,
              when((row.manifest || row).createdAt) +
                " · " +
                row.id.slice(0, 8),
            ]),
          ),
        }}
      />
      <Field
        label="Extern bewaarde herstelsleutel"
        value={secret}
        onChange={setSecret}
        secret
      />
      <Button
        label="Stap 1 — veilige archiefcontrole starten"
        disabled={busy || disabled || !archive}
        onPress={() =>
          void run(async () => {
            if (secret.length < 20 || secret.length > 512)
              throw Error("Voer de herstelcode van 20–512 tekens in.");
            const result = await authorizedRequest(
              session,
              "/admin/backups/restore-checks",
              "POST",
              { archiveId: archive, source, recoverySecret: secret },
            );
            choose(result.id);
            setSecret("");
            await load();
          })
        }
      />
      {current && (
        <View style={s.card}>
          <Text style={s.title}>Geselecteerde controle</Text>
          <Text>
            {current.technicalState === "completed"
              ? "Ontsleuteling, archiefstructuur en checksums gecontroleerd."
              : current.technicalState === "failed"
                ? "Archiefcontrole mislukt."
                : "Archiefcontrole loopt…"}
          </Text>
          {!!current.error && <Text style={s.error}>{current.error}</Text>}
          {current.result?.manifest && (
            <Text>
              Archiefdatum: {when(current.result.manifest.createdAt)} ·
              database, bestanden, exports en configuratie.
            </Text>
          )}
          {current.recordedAt ? (
            <Text>
              Menselijke controles vastgelegd op {when(current.recordedAt)}. Dit
              is geen automatisch bewijs van een productieherstel.
            </Text>
          ) : (
            current.technicalState === "completed" &&
            current.canRecord !== false && (
              <>
                <Text style={s.title}>Stap 2 — eigen controles vastleggen</Text>
                <Field
                  label="Gecontroleerde taak (titel of referentie)"
                  value={taskReference}
                  onChange={setTaskReference}
                />
                <Button
                  label={`${taskChecked ? "✓ " : ""}Ik heb deze taak geopend en gecontroleerd in de aparte herstelde testinstallatie`}
                  onPress={() => setTaskChecked(!taskChecked)}
                />
                <Field
                  label="Gecontroleerde foto-/documentnaam"
                  value={fileReference}
                  onChange={setFileReference}
                />
                <Button
                  label={`${fileChecked ? "✓ " : ""}Ik heb dit bestand geopend en bekeken in de aparte herstelde testinstallatie`}
                  onPress={() => setFileChecked(!fileChecked)}
                />
                <Field
                  label="Testserver en bevindingen (optioneel)"
                  value={notes}
                  onChange={setNotes}
                  multiline
                />
                <Button
                  label="Daadwerkelijke controles vastleggen"
                  disabled={busy || !taskChecked || !fileChecked}
                  onPress={() =>
                    void run(async () => {
                      await authorizedRequest(
                        session,
                        "/admin/backups/restore-checks/" +
                          current.id +
                          "/record",
                        "POST",
                        {
                          version: current.version,
                          taskChecked,
                          fileChecked,
                          taskReference,
                          fileReference,
                          notes,
                        },
                      );
                      await load();
                      await onRecorded();
                    })
                  }
                />
              </>
            )
          )}
        </View>
      )}
      <Text style={s.title}>Controlehistorie</Text>
      <Button label="Historie vernieuwen" onPress={() => void run(load)} />
      {!checks.length && <Text>Nog geen periodieke controle gestart.</Text>}
      {checks.slice(0, 15).map((row) => (
        <View style={s.card} key={row.id}>
          <Button
            label={`${when(row.createdAt)} · ${row.recordedAt ? "Controles vastgelegd" : row.technicalState === "completed" ? "Alleen archief technisch gecontroleerd" : row.technicalState === "failed" ? "Mislukt" : "In uitvoering"}`}
            onPress={() => choose(row.id)}
          />
          {row.recordedAt && (
            <Text>
              Taak: {row.taskReference} · Bestand: {row.fileReference}
              {row.notes ? " · " + row.notes : ""}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}
