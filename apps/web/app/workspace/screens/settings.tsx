"use client";
import { Administration } from "../../administration";
import { date } from "../ui";
import type { WorkspaceView } from "../use-workspace";

export function SettingsScreen({ w }: { w: WorkspaceView }) {
  const {
    api,
    token,
    user,
    users,
    items,
    assets,
    locations,
    tasks,
    sessions,
    adminStatus,
    reload,
    setDialog,
    setSelected,
    setPage,
    run,
    setSessions,
  } = w;
  return (
    <Administration
      api={api}
      token={token}
      user={user}
      users={users}
      items={items}
      assets={assets}
      locations={locations}
      tasks={tasks}
      sessions={sessions}
      adminStatus={adminStatus}
      reload={reload}
      onSecurity={() => setDialog("advanced")}
      onCreateUser={() => {
        setSelected(null);
        setDialog("user");
      }}
      onImport={() => setDialog("import")}
      onCatalog={() => setPage("locations")}
    >
      <div className="settings-grid">
        <section className="panel padded">
          <h2>Systeemstatus</h2>
          {adminStatus && (
            <dl className="system-status-list">
              <dt>Database</dt>
              <dd>
                {(
                  Number(adminStatus.databaseBytes || 0) /
                  1024 /
                  1024
                ).toLocaleString("nl-NL", {
                  maximumFractionDigits: 1,
                })}{" "}
                MB
              </dd>
              <dt>Vrije opslag</dt>
              <dd>
                {adminStatus.storage
                  ? (
                      Number(adminStatus.storage.availableBytes) /
                      1024 /
                      1024 /
                      1024
                    ).toLocaleString("nl-NL", {
                      maximumFractionDigits: 1,
                    }) + " GB"
                  : "Niet beschikbaar"}
              </dd>
              <dt>Achtergrondtaken</dt>
              <dd>
                {adminStatus.worker?.state === "ok"
                  ? "Actief"
                  : adminStatus.worker?.state === "stale"
                    ? "Controle nodig"
                    : "Status onbekend"}
              </dd>
            </dl>
          )}
        </section>
        <section className="panel padded">
          <h2>Aanmeldsessies</h2>
          {sessions.map((session) => (
            <div className="task-row" key={session.id}>
              <span className="task-text">
                {session.device || session.deviceName || "Apparaat"}
                <small>{date(session.createdAt)}</small>
              </span>
              <button
                className="text-button"
                onClick={() =>
                  run(async () => {
                    await api("/auth/sessions/" + session.id, {
                      method: "DELETE",
                    });
                    setSessions(await api("/auth/sessions"));
                  })
                }
              >
                Intrekken
              </button>
            </div>
          ))}
        </section>
      </div>
    </Administration>
  );
}
