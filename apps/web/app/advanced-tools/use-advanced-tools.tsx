"use client";
import { useState, useEffect, type FormEvent } from "react";
import { saveBlob, type Row, type Api } from "./ui";
import { reauthFromResponse } from "../reauth";

/** Alle toestand en handelingen van AdvancedTools; gedeeld door de schermcomponenten. */
export function useAdvancedTools({
  page,
  api,
  token,
  user,
  tasks,
  items,
  assets,
  locations,
  users,
  reload,
  onlyTab,
}: {
  page: string;
  api: Api;
  token: string;
  user: Row;
  tasks: Row[];
  items: Row[];
  assets: Row[];
  locations: Row[];
  users: Row[];
  reload: () => Promise<void>;
  onlyTab?: string;
}) {
  const tabs: Record<string, string> =
    page === "tasks"
      ? { templates: "Taaksjablonen", bulk: "Bulk wijzigen", ai: "AI-voorstel" }
      : page === "inventory"
        ? {
            items: "Artikelen bewerken",
            minimum: "Minima per locatie",
            counts: "Telling aanvullen",
            journal: "Mutatiehistorie",
          }
        : page === "planning"
          ? { seasons: "Seizoenen aanpassen" }
          : page === "reports"
            ? { exports: "Achtergrondexports", ai: "AI-voorstel" }
            : page === "settings"
              ? {
                  mfa: "Tweede factor",
                  admin: "Gegevensbeheer",
                  users: "Accounts bewerken",
                }
              : { templates: "Taaksjablonen", ai: "AI-voorstel" };
  const [tab, setTab] = useState(onlyTab || Object.keys(tabs)[0]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [rows, setRows] = useState<Row[]>([]),
    [selected, setSelected] = useState<Row | null>(null),
    [extra, setExtra] = useState<Row[]>([]),
    [mfa, setMfa] = useState<Row | null>(null),
    [setup, setSetup] = useState<Row | null>(null),
    [recovery, setRecovery] = useState<string[]>([]),
    [suggestion, setSuggestion] = useState(""),
    [aiStatus, setAiStatus] = useState<Row | null>(null);
  const work = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const load = async () => {
    setSelected(null);
    if (tab === "templates") setRows(await api("/templates"));
    if (tab === "exports") setRows(await api("/reports/jobs"));
    if (tab === "seasons") {
      setRows(await api("/seasons"));
      setExtra(await api("/seasons/activations"));
    }
    if (tab === "counts") setRows(await api("/inventory/counts"));
    if (tab === "minimum") setRows(await api("/inventory/balances"));
    if (tab === "journal") setRows(await api("/inventory/movements"));
    if (tab === "mfa") setMfa(await api("/auth/mfa"));
    if (tab === "ai") setAiStatus(await api("/ai/status"));
  };
  useEffect(() => {
    void work(load);
  }, [tab]);
  const submit = (
    e: FormEvent<HTMLFormElement>,
    fn: (f: FormData) => Promise<void>,
  ) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void work(() => fn(f));
  };
  const download = async (path: string, name: string) => {
    await api("/auth/me");
    const active = sessionStorage.getItem("tuinwerk-token") || token;
    const get = () =>
      fetch("/api" + path, {
        headers: { Authorization: "Bearer " + active },
      });
    let r = await get();
    if (
      r.status === 403 &&
      (await reauthFromResponse(
        await r.json().catch(() => null),
        (credentials) =>
          api("/auth/reauth", {
            method: "POST",
            body: JSON.stringify(credentials),
          }),
      ))
    )
      r = await get();
    if (!r.ok) throw Error("Download niet beschikbaar.");
    saveBlob(await r.blob(), name);
  };
  return {
    page,
    api,
    token,
    user,
    tasks,
    items,
    assets,
    locations,
    users,
    reload,
    onlyTab,
    tabs,
    tab,
    setTab,
    busy,
    setBusy,
    error,
    setError,
    notice,
    setNotice,
    rows,
    setRows,
    selected,
    setSelected,
    extra,
    setExtra,
    mfa,
    setMfa,
    setup,
    setSetup,
    recovery,
    setRecovery,
    suggestion,
    setSuggestion,
    aiStatus,
    setAiStatus,
    work,
    load,
    submit,
    download,
  };
}
export type AdvancedToolsState = ReturnType<typeof useAdvancedTools>;
