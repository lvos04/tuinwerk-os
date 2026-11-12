import React, { useEffect, useState } from "react";
import { Alert, Linking, Text, View } from "react-native";
import { Session, authorizedRequest } from "./api";
import {
  NativeButton as Button,
  NativeField as Field,
  nativeStyles as s,
} from "./NativeWidgets";
export function AccountScreen({
  session,
  pendingCount,
  syncing,
  onDelete,
}: {
  session: Session;
  pendingCount: number;
  syncing: boolean;
  onDelete: (input: {
    password: string;
    otp?: string;
    confirmation: string;
  }) => Promise<void>;
}) {
  const [password, setPassword] = useState(""),
    [otp, setOtp] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [privacy, setPrivacy] = useState<Record<string, any> | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [expanded, setExpanded] = useState(false);
  useEffect(() => {
    authorizedRequest(session, "/auth/privacy")
      .then(setPrivacy)
      .catch((error) => setError(error.message));
  }, [session]);
  async function link(path: string) {
    try {
      const base = new URL(session.endpoint);
      if (
        base.protocol !== "https:" &&
        !["localhost", "127.0.0.1", "10.0.2.2"].includes(base.hostname)
      )
        throw new Error("Gebruik een beveiligd serveradres.");
      await Linking.openURL(session.endpoint.replace(/\/api$/, "") + path);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Link openen mislukt.");
    }
  }
  return (
    <View style={{ gap: 12 }}>
      <Text style={s.title}>Mijn account en privacy</Text>
      <Text>
        {session.user.name} · {session.user.email}
      </Text>
      {error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
      <Button
        label="Privacybeleid lezen"
        onPress={() => void link("/privacy")}
      />
      <Button label="Ondersteuning" onPress={() => void link("/support")} />
      {privacy && (
        <View style={{ gap: 8 }}>
          <Text style={s.title}>Wat wordt verwijderd?</Text>
          {privacy.removed?.map((text: string) => (
            <Text key={text}>• {text}</Text>
          ))}
          <Text style={s.title}>Wat blijft bewaard?</Text>
          {privacy.retained?.map((text: string) => (
            <Text key={text}>• {text}</Text>
          ))}
          <Text>{privacy.fileCleanup}</Text>
          <Text>{privacy.lastAdministrator}</Text>
        </View>
      )}
      <Button
        label={
          expanded ? "Accountverwijdering sluiten" : "Mijn account verwijderen"
        }
        onPress={() => setExpanded(!expanded)}
      />
      {expanded && (
        <View style={s.card}>
          <Text style={s.title}>Definitief account verwijderen</Text>
          <Text style={s.text}>
            Dit verwijdert je account en toegangssessies. Gedeelde taken,
            onderhouds- en voorraadgeschiedenis blijven waar nodig
            geanonimiseerd bewaard. Je lokale cache, foto-concepten en
            persoonlijke wachtrij worden op dit toestel gewist na
            serverbevestiging.
          </Text>
          <Text style={pendingCount ? s.error : s.text}>
            {pendingCount
              ? `${pendingCount} niet-bevestigde wijzigingen staan nog op dit toestel. Deze concepten en bijbehorende foto’s gaan verloren als je doorgaat. Synchroniseer ze eerst als je ze wilt behouden.`
              : "Er zijn geen niet-bevestigde wijzigingen op dit toestel."}
          </Text>
          {syncing && (
            <Text>
              Wacht tot de actieve synchronisatie klaar is voordat je je account
              verwijdert.
            </Text>
          )}
          <Field
            label="Huidig wachtwoord"
            secret
            value={password}
            onChange={setPassword}
          />
          <Field
            label="Tweede factor of herstelcode (indien ingeschakeld)"
            value={otp}
            onChange={setOtp}
          />
          <Field
            label="Typ VERWIJDER MIJN ACCOUNT"
            value={confirmation}
            onChange={setConfirmation}
          />
          <Button
            disabled={
              busy ||
              syncing ||
              !privacy?.canDelete ||
              !password ||
              confirmation !== "VERWIJDER MIJN ACCOUNT"
            }
            label={
              busy
                ? "Account wordt verwijderd…"
                : "Account en lokale gegevens definitief verwijderen"
            }
            onPress={() =>
              Alert.alert(
                "Account definitief verwijderen?",
                `${pendingCount} lokale wijzigingen worden gewist. Deze actie kan niet ongedaan worden gemaakt.`,
                [
                  { text: "Annuleren", style: "cancel" },
                  {
                    text: "Definitief verwijderen",
                    style: "destructive",
                    onPress: () => {
                      setBusy(true);
                      setError("");
                      void onDelete({
                        password,
                        otp: otp || undefined,
                        confirmation,
                      })
                        .catch((error) => setError(error.message))
                        .finally(() => {
                          setBusy(false);
                          setPassword("");
                          setOtp("");
                        });
                    },
                  },
                ],
              )
            }
          />
        </View>
      )}
    </View>
  );
}
