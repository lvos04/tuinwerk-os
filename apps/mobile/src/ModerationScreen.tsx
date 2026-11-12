import React, { useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import { Session, authorizedRequest } from "./api";
import {
  NativeButton as Button,
  NativeField as Field,
  nativeStyles as s,
} from "./NativeWidgets";
export function ReportContent({
  session,
  targetType,
  targetId,
}: {
  session: Session;
  targetType: "task" | "comment" | "attachment";
  targetId: string;
}) {
  const [open, setOpen] = useState(false),
    [reason, setReason] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <View>
      <Button
        label={open ? "Melding sluiten" : "Ongepaste inhoud melden"}
        onPress={() => setOpen(!open)}
      />
      {open && (
        <View style={s.card}>
          <Text>
            Meld ongepaste of onveilige inhoud bij de beheerder. De beheerder
            beoordeelt de melding.
          </Text>
          <Field
            label="Reden (10–2000 tekens)"
            value={reason}
            onChange={setReason}
            multiline
          />
          <Button
            disabled={busy || reason.trim().length < 10 || reason.length > 2000}
            label="Melding versturen"
            onPress={() => {
              setBusy(true);
              void authorizedRequest(session, "/moderation/reports", "POST", {
                targetType,
                targetId,
                reason,
              })
                .then(() => {
                  setMessage(
                    "Melding ontvangen. Bekijk de voortgang bij Meldingen beoordelen.",
                  );
                  setReason("");
                  setOpen(false);
                })
                .catch((error) => setMessage(error.message))
                .finally(() => setBusy(false));
            }}
          />
        </View>
      )}
      {!!message && <Text accessibilityRole="alert">{message}</Text>}
    </View>
  );
}
export function ModerationScreen({ session }: { session: Session }) {
  const [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [settings, setSettings] = useState<any>(null),
    [phrases, setPhrases] = useState("");
  const admin = session.user.role === "admin";
  async function load() {
    setRows(await authorizedRequest(session, "/moderation/reports"));
    if (admin) {
      const config = await authorizedRequest(session, "/moderation/settings");
      setSettings(config);
      setPhrases(config.prohibitedPhrases.join("\n"));
    }
  }
  useEffect(() => {
    void load().catch((error) => setError(error.message));
  }, [session]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Actie mislukt");
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 12 }}>
      <Text style={s.title}>
        {admin ? "Meldingen beoordelen" : "Mijn inhoudsmeldingen"}
      </Text>
      {!!error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
      <Button
        label="Vernieuwen"
        disabled={busy}
        onPress={() => void run(load)}
      />
      {admin && (
        <>
          <Field
            label="Beoordelingsnotitie / reden blokkeren (10–2000 tekens)"
            value={note}
            onChange={setNote}
            multiline
          />
          <Text>
            Een gebruikersblokkade geldt voor dit bedrijfsaccount en stopt diens
            toegang. Bespreek personeelsmaatregelen volgens jullie eigen beleid.
          </Text>
        </>
      )}
      {rows.map((row) => (
        <View key={row.id} style={s.card}>
          <Text style={s.title}>{row.snapshot?.label || row.targetType}</Text>
          <Text>{row.reason}</Text>
          <Text>
            Status: {row.status} · {row.reporterName || "Mijn melding"}
          </Text>
          {admin && (
            <>
              <Text>{row.snapshot?.description}</Text>
              {(["dismiss", "hide", "restore"] as const).map((action) => (
                <Button
                  key={action}
                  disabled={
                    busy || note.trim().length < 10 || note.length > 2000
                  }
                  label={
                    {
                      dismiss: "Melding afwijzen",
                      hide: "Inhoud verbergen",
                      restore: "Inhoud herstellen",
                    }[action]
                  }
                  onPress={() =>
                    void run(() =>
                      authorizedRequest(
                        session,
                        `/moderation/reports/${row.id}/resolve`,
                        "POST",
                        { version: row.version, action, note },
                      ),
                    )
                  }
                />
              ))}
              {row.targetAuthorId &&
                row.targetAuthorId !== session.user.id &&
                row.targetAuthorActive && (
                  <Button
                    disabled={
                      busy || note.trim().length < 10 || note.length > 2000
                    }
                    label={`Gebruiker blokkeren: ${row.targetAuthorName || "auteur"}`}
                    onPress={() =>
                      Alert.alert(
                        "Gebruiker blokkeren?",
                        "Deze gebruiker verliest toegang tot het bedrijfsaccount.",
                        [
                          { text: "Annuleren", style: "cancel" },
                          {
                            text: "Blokkeren",
                            style: "destructive",
                            onPress: () =>
                              void run(() =>
                                authorizedRequest(
                                  session,
                                  `/moderation/users/${row.targetAuthorId}/block`,
                                  "POST",
                                  { reason: note },
                                ),
                              ),
                          },
                        ],
                      )
                    }
                  />
                )}
            </>
          )}
        </View>
      ))}
      {admin && settings && (
        <View style={s.card}>
          <Field
            label="Verboden tekstfragmenten — één per regel"
            value={phrases}
            onChange={setPhrases}
            multiline
          />
          <Button
            label="Tekstfilter opslaan"
            disabled={busy}
            onPress={() =>
              void run(() =>
                authorizedRequest(session, "/moderation/settings", "PUT", {
                  version: settings.version,
                  prohibitedPhrases: phrases
                    .split("\n")
                    .map((value) => value.trim())
                    .filter(Boolean),
                }),
              )
            }
          />
          <Text>
            Dit tekstfilter is geen automatische controle van afbeeldingen.
          </Text>
        </View>
      )}
    </View>
  );
}
