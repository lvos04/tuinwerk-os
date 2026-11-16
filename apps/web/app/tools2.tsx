"use client";
import { ReportContent } from "./moderation";

import { useEffect, useState } from "react";
import { useAdvancedTools } from "./advanced-tools/use-advanced-tools";
import { ExportsTab } from "./advanced-tools/tabs/exports";
import { AiTab } from "./advanced-tools/tabs/ai";
import { MfaTab } from "./advanced-tools/tabs/mfa";
import { TemplatesTab } from "./advanced-tools/tabs/templates";
import { BulkTab } from "./advanced-tools/tabs/bulk";
import { ItemsTab } from "./advanced-tools/tabs/items";
import { MinimumTab } from "./advanced-tools/tabs/minimum";
import { CountsTab } from "./advanced-tools/tabs/counts";
import { JournalTab } from "./advanced-tools/tabs/journal";
import { SeasonsTab } from "./advanced-tools/tabs/seasons";
import { AdminTab } from "./advanced-tools/tabs/admin";
import { UsersTab } from "./advanced-tools/tabs/users";
import { type Row, type Api, F, saveBlob } from "./advanced-tools/ui";
export function AdvancedTools(props: Parameters<typeof useAdvancedTools>[0]) {
  const w = useAdvancedTools(props);
  const { user, onlyTab, tabs, tab, setTab, error, notice } = w;
  return (
    <>
      <div className="tabs" style={{ marginBottom: 22, flexWrap: "wrap" }}>
        {Object.entries(tabs)
          .filter(([id]) => !onlyTab || id === onlyTab)
          .map(([id, l]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              {l}
            </button>
          ))}
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="alert success" role="status">
          {notice}
        </div>
      )}
      {tab === "exports" && <ExportsTab w={w} />}
      {tab === "ai" && <AiTab w={w} />}
      {tab === "mfa" && <MfaTab w={w} />}
      {tab === "templates" && <TemplatesTab w={w} />}
      {tab === "bulk" && <BulkTab w={w} />}
      {tab === "items" && <ItemsTab w={w} />}
      {tab === "minimum" && <MinimumTab w={w} />}
      {tab === "counts" && <CountsTab w={w} />}
      {tab === "journal" && <JournalTab w={w} />}
      {tab === "seasons" && <SeasonsTab w={w} />}
      {tab === "admin" && user.role === "admin" && <AdminTab w={w} />}
      {tab === "users" && user.role === "admin" && <UsersTab w={w} />}
    </>
  );
}
export function MediaGallery({
  api,
  token,
  taskId,
  assetId,
  onAnnotate,
}: {
  api: Api;
  token: string;
  taskId?: string;
  assetId?: string;
  onAnnotate?: (a: Row) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]),
    [uploads, setUploads] = useState<
      { id: string; file: File; status: string; error?: string }[]
    >([]),
    [phase, setPhase] = useState("before"),
    [error, setError] = useState(""),
    [preview, setPreview] = useState(""),
    [uploading, setUploading] = useState(false);
  const load = async () =>
    setRows(
      await api(
        "/attachments?" + (taskId ? "taskId=" + taskId : "assetId=" + assetId),
      ),
    );
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [taskId, assetId]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (uploads.some((u) => u.status !== "done")) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [uploads]);
  const send = async (id?: string) => {
    setUploading(true);
    try {
      for (const u of uploads.filter(
        (x) => x.status !== "done" && (!id || x.id === id),
      )) {
        setUploads((prev) =>
          prev.map((x) =>
            x.id === u.id ? { ...x, status: "uploading", error: undefined } : x,
          ),
        );
        try {
          const f = new FormData();
          f.append("file", u.file);
          f.append(taskId ? "taskId" : "assetId", taskId || assetId!);
          f.append("phase", phase);
          f.append("operationId", u.id);
          await api("/attachments", { method: "POST", body: f });
          setUploads((prev) =>
            prev.map((x) => (x.id === u.id ? { ...x, status: "done" } : x)),
          );
        } catch (e) {
          setUploads((prev) =>
            prev.map((x) =>
              x.id === u.id
                ? { ...x, status: "failed", error: (e as Error).message }
                : x,
            ),
          );
        }
      }
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };
  const file = async (a: Row, view: boolean) => {
    try {
      await api("/auth/me");
      const r = await fetch("/api/attachments/" + a.id + "/file", {
        headers: {
          Authorization:
            "Bearer " + (sessionStorage.getItem("tuinwerk-token") || token),
        },
      });
      if (!r.ok) throw Error("Bijlage kon niet worden opgehaald.");
      const blob = await r.blob();
      if (view) setPreview(URL.createObjectURL(blob));
      else saveBlob(blob, a.name);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      {error && <div className="alert error">{error}</div>}
      <div>
        {rows.map((a) => (
          <div className="task-row" key={a.id}>
            <span className="task-text">
              <strong>{a.name}</strong>
              <small>
                {
                  ({ before: "Voor", during: "Tijdens", after: "Na" } as Row)[
                    a.phase
                  ]
                }{" "}
                · {Math.ceil(a.size / 1024)} KB
              </small>
            </span>
            {a.mimeType?.startsWith("image/") && (
              <button
                className="text-button"
                onClick={() =>
                  onAnnotate ? onAnnotate(a) : void file(a, true)
                }
              >
                Bekijken{onAnnotate ? " / annoteren" : ""}
              </button>
            )}
            <button className="text-button" onClick={() => void file(a, false)}>
              Download
            </button>
            <ReportContent api={api} type="attachment" id={a.id} />
          </div>
        ))}
      </div>
      {preview && (
        <div>
          <button className="secondary" onClick={() => setPreview("")}>
            Foto sluiten
          </button>
          <a href={preview} target="_blank" rel="noreferrer">
            <img
              src={preview}
              alt="Bijlage op volledige grootte openen"
              style={{ width: "100%", marginTop: 10 }}
            />
          </a>
        </div>
      )}
      <hr />
      <F label="Foto’s of PDF-documenten (meerdere mogelijk)">
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,application/pdf"
          onChange={(e) => {
            setUploads((previous) => [
              ...previous,
              ...Array.from(e.target.files || []).map((file) => ({
                id: crypto.randomUUID(),
                file,
                status: "pending",
              })),
            ]);
            e.target.value = "";
          }}
        />
      </F>
      <F label="Moment">
        <select
          value={phase}
          disabled={uploads.some(
            (x) =>
              x.status === "uploading" ||
              x.status === "failed" ||
              x.status === "done",
          )}
          onChange={(e) => setPhase(e.target.value)}
        >
          <option value="before">Voor</option>
          <option value="during">Tijdens</option>
          <option value="after">Na</option>
        </select>
      </F>
      {uploads.map((u) => (
        <div className="task-row" key={u.id}>
          <span className="task-text">
            <strong>{u.file.name}</strong>
            <small>
              {
                (
                  {
                    pending: "Wacht op upload",
                    uploading: "Bezig met uploaden",
                    done: "Opgeslagen",
                    failed: "Mislukt",
                  } as Row
                )[u.status]
              }
              {u.error ? " · " + u.error : ""}
            </small>
          </span>
          {u.status === "failed" && (
            <button
              className="secondary"
              disabled={uploading}
              onClick={() => void send(u.id)}
            >
              Opnieuw proberen
            </button>
          )}
        </div>
      ))}
      {uploads.length > 0 && (
        <>
          <p className="muted">
            Houd dit venster open totdat alle bestanden opgeslagen zijn. Elke
            retry gebruikt dezelfde operatie-ID; succesvolle bestanden worden
            niet opnieuw geüpload.
          </p>
          <button
            className="primary"
            disabled={uploading || uploads.every((u) => u.status === "done")}
            onClick={() => void send()}
          >
            Wachtende bestanden uploaden
          </button>
        </>
      )}
    </>
  );
}
