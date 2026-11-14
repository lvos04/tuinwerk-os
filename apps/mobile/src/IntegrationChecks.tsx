import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Session, authorizedRequest } from "./api";
import {
  NativeButton as Button,
  NativeSelect as Select,
  nativeStyles as s,
} from "./NativeWidgets";
export function IntegrationChecks({ session }: { session: Session }) {
  const [status, setStatus] = useState<any>(null),
    [deviceId, setDeviceId] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    setStatus(await authorizedRequest(session, "/admin/integrations/status"));
  }
  useEffect(() => {
    void load().catch((error) => setMessage(error.message));
  }, [session]);
  async function test(kind: string) {
    setBusy(true);
    try {
      const result = await authorizedRequest(
        session,
        "/admin/integrations/test/" + kind,
        "POST",
        { confirm: true, ...(kind === "push" ? { deviceId } : {}) },
      );
      setMessage(result.message);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Test mislukt");
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={s.card}>
      <Text style={s.title}>Koppelingen controleren</Text>
      {message && <Text accessibilityRole="alert">{message}</Text>}
      <Text>
        Stuur een echte testmail uitsluitend naar je beheerdersadres:{" "}
        {status?.recipient || "laden…"}
      </Text>
      <Button
        disabled={busy || !status?.recipient}
        label="Testmail naar mij sturen"
        onPress={() => void test("smtp")}
      />
      <Select
        label="Mijn geregistreerde testtoestel"
        value={deviceId}
        onChange={setDeviceId}
        options={Object.fromEntries([
          ["", "Kies toestel"],
          ...(status?.devices || [])
            .filter((device: any) => device.active)
            .map((device: any, index: number) => [
              device.id,
              device.platform + " · " + (index + 1),
            ]),
        ])}
      />
      <Button
        disabled={busy || !deviceId}
        label="Echte pushmelding naar mijn toestel"
        onPress={() => void test("push")}
      />
      <Text>
        De OneDrive-test maakt een klein testbestand in de eigen appmap, leest
        het terug en verwijdert het weer.
      </Text>
      <Button
        disabled={busy}
        label="OneDrive lezen en schrijven testen"
        onPress={() => void test("onedrive")}
      />
      {(status?.checks || []).map((check: any) => (
        <View key={check.key}>
          <Text>
            {check.label} ·{" "}
            {
              (
                {
                  ready: "Ingesteld",
                  missing: "Nog instellen",
                  untested: "Nog testen",
                  passed: "Test geslaagd",
                  failed: "Test mislukt",
                } as Record<string, string>
              )[check.status]
            }
          </Text>
          <Text>{check.detail}</Text>
        </View>
      ))}
    </View>
  );
}
