"use client";
import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import type { SettingsApi, SettingsRow as Row } from "./system-settings";

const when = (value?: string | null) =>
  value
    ? new Date(value).toLocaleString("nl-NL", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Nog niet";

/** Beheer van koppelsleutels voor de alleen-lezen Bedrijfskoppeling API v1. */
export function BusinessLinkKeys({ api }: { api: SettingsApi }) {
  const [keys, setKeys] = useState<Row[]>([]),
    [name, setName] = useState("Bedrijfsdashboard"),
    [created, setCreated] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false),
    [settings, setSettings] = useState<Row | null>(null);
  const load = async () => {
    const [list, snapshot] = await Promise.all([
      api("/admin/koppelsleutels"),
      api("/settings"),
    ]);
    setKeys(list);
    setSettings(snapshot);
  };
  const enabled = !!settings?.values?.koppelingEnabled;
  const toggle = (next: boolean) =>
    run(async () => {
      if (!settings) return;
      setSettings(
        await api("/settings", {
          method: "PATCH",
          body: JSON.stringify({
            version: settings.version,
            values: { koppelingEnabled: next },
          }),
        }),
      );
    });
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const create = () =>
    run(async () => {
      setCopied(false);
      setCreated(
        await api("/admin/koppelsleutels", {
          method: "POST",
          body: JSON.stringify({ naam: name }),
        }),
      );
    });
  const revoke = (key: Row) => {
    if (
      !window.confirm(
        `Koppelsleutel "${key.naam}" (${key.voorvoegsel}…) intrekken? Gekoppelde apps verliezen direct hun toegang.`,
      )
    )
      return;
    void run(async () => {
      await api("/admin/koppelsleutels/" + key.id, { method: "DELETE" });
      if (created?.id === key.id) setCreated(null);
    });
  };
  return (
    <section className="panel padded system-section">
      <h2>
        <KeyRound size={20} /> Bedrijfskoppeling
      </h2>
      <p className="muted">
        Koppelsleutels geven andere bedrijfsapps, zoals het Bedrijfsdashboard,
        alleen-lezen toegang tot kerncijfers via <code>/api/koppeling/v1</code>.
        Er worden geen persoonsgegevens of notities gedeeld. Een sleutel is
        alleen direct na het aanmaken zichtbaar.
      </p>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy || !settings}
          onChange={(e) => void toggle(e.target.checked)}
        />
        Bedrijfskoppeling ingeschakeld
      </label>
      <p className="muted">
        {enabled
          ? "De koppeling is actief: apps met een geldige sleutel kunnen de gegevens lezen."
          : "Standaard uit. Zolang de koppeling uit staat, weigert de API elk verzoek (ook met een geldige sleutel). Je kunt sleutels wel alvast aanmaken of intrekken."}
      </p>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {created?.sleutel && (
        <div className="alert success" role="status">
          <strong>Nieuwe sleutel voor {created.naam}</strong>
          <p>{created.melding}</p>
          <code style={{ wordBreak: "break-all" }}>{created.sleutel}</code>
          <div className="toolbar">
            <button
              className="secondary"
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(created.sleutel)
                  .then(() => setCopied(true))
                  .catch(() =>
                    setError(
                      "Kopiëren mislukt; selecteer de sleutel handmatig",
                    ),
                  )
              }
            >
              {copied ? "Gekopieerd" : "Kopiëren"}
            </button>
            <button className="secondary" onClick={() => setCreated(null)}>
              Ik heb de sleutel bewaard
            </button>
          </div>
        </div>
      )}
      <div className="toolbar">
        <label className="field">
          <span>Naam van de koppeling</span>
          <input
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button
          className="primary"
          disabled={busy || !name.trim()}
          onClick={() => void create()}
        >
          Sleutel aanmaken
        </button>
      </div>
      {keys.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Naam</th>
                <th>Sleutel</th>
                <th>Aangemaakt</th>
                <th>Laatst gebruikt</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td>{k.naam}</td>
                  <td>
                    <code>{k.voorvoegsel}…</code>
                  </td>
                  <td>
                    {when(k.aangemaakt_op)}
                    {k.aangemaakt_door ? ` · ${k.aangemaakt_door}` : ""}
                  </td>
                  <td>{when(k.laatst_gebruikt_op)}</td>
                  <td>
                    {k.ingetrokken_op ? (
                      <span className="badge">
                        Ingetrokken {when(k.ingetrokken_op)}
                      </span>
                    ) : (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => revoke(k)}
                      >
                        Intrekken
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
