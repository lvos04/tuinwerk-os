"use client";
import { Search, Clock } from "lucide-react";
import { statuses, priorities, date, Empty } from "../ui";
import type { WorkspaceView } from "../use-workspace";

export function TasksScreen({ w }: { w: WorkspaceView }) {
  const {
    filter,
    setFilter,
    view,
    setView,
    search,
    setSearch,
    filtered,
    openTask,
    name,
    locations,
    users,
  } = w;
  return (
    <>
      <div className="toolbar">
        <div className="tabs">
          {[
            ["active", "Open werk"],
            ["mine", "Mijn taken"],
            ["all", "Alle taken"],
            ["completed", "Afgerond"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={filter === id ? "active" : ""}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="segmented">
          <button
            className={view === "list" ? "active" : ""}
            onClick={() => setView("list")}
          >
            Lijst
          </button>
          <button
            className={view === "board" ? "active" : ""}
            onClick={() => setView("board")}
          >
            Bord
          </button>
        </div>
      </div>
      <div className="filters">
        <label className="search">
          <Search size={18} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Zoek op titel, omschrijving of categorie"
            aria-label="Taken zoeken"
          />
        </label>
        <select
          aria-label="Taakfilter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="active">Open werk</option>
          <option value="all">Alle taken</option>
          <option value="mine">Mijn taken</option>
          <option value="unassigned">Niet toegewezen</option>
          <option value="overdue">Achterstallig</option>
          {Object.entries(statuses).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {filtered.length ? (
        view === "board" ? (
          <div className="board">
            {Object.entries(statuses)
              .slice(0, 5)
              .map(([id, label]) => (
                <section key={id}>
                  <h3>
                    {label}{" "}
                    <span>
                      {filtered.filter((t) => t.status === id).length}
                    </span>
                  </h3>
                  {filtered
                    .filter((t) => t.status === id)
                    .map((t) => (
                      <button
                        className="board-card"
                        key={t.id}
                        onClick={() => openTask(t)}
                      >
                        <span className={"badge " + t.priority}>
                          {priorities[t.priority]}
                        </span>
                        <strong>{t.title}</strong>
                        <small>{name(locations, t.locationId)}</small>
                        <div>
                          <Clock size={13} />
                          {date(t.deadline)}
                        </div>
                      </button>
                    ))}
                </section>
              ))}
          </div>
        ) : (
          <div className="panel table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Taak</th>
                  <th>Status</th>
                  <th>Prioriteit</th>
                  <th>Locatie</th>
                  <th>Deadline</th>
                  <th>Toegewezen</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <button
                        className="link title-link"
                        onClick={() => openTask(t)}
                      >
                        {t.title}
                      </button>
                      <small className="cell-sub">
                        {t.category || "Algemeen"}
                      </small>
                    </td>
                    <td>
                      <span className={"badge " + t.status}>
                        {statuses[t.status]}
                      </span>
                    </td>
                    <td>
                      <span className={"priority " + t.priority}>
                        ● {priorities[t.priority]}
                      </span>
                    </td>
                    <td>{name(locations, t.locationId)}</td>
                    <td>{date(t.deadline)}</td>
                    <td>
                      {(t.assignedTo || [])
                        .map((id: string) => name(users, id))
                        .join(", ") || "Niet toegewezen"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <Empty title="Geen taken gevonden">
          Pas je filters aan of maak een nieuwe taak aan.
        </Empty>
      )}
    </>
  );
}
