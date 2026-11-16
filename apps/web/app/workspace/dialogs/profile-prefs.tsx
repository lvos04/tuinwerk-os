"use client";
import { Field } from "../ui";
import { AccountPrivacy } from "../../account-privacy";
import type { WorkspaceView } from "../use-workspace";

export function ProfilePrefsDialog({ w }: { w: WorkspaceView }) {
  const {
    submit,
    profilePrefs,
    api,
    setProfilePrefs,
    setFilter,
    busy,
    setToken,
    setUser,
    setDialog,
  } = w;
  return (
    <>
      <form
        onSubmit={(e) =>
          submit(e, async (f) => {
            const preferences = {
              ...profilePrefs.preferences,
              taskFilter: f.get("taskFilter"),
              dashboardMetrics: f.getAll("metric"),
              taskSort: f.get("taskSort"),
            };
            const next = await api("/profile/preferences", {
              method: "PATCH",
              body: JSON.stringify({
                version: profilePrefs.version,
                preferences,
              }),
            });
            setProfilePrefs(next);
            setFilter(String(f.get("taskFilter")));
          })
        }
      >
        <Field label="Standaard takenfilter">
          <select
            name="taskFilter"
            defaultValue={profilePrefs.preferences?.taskFilter || "active"}
          >
            <option value="active">Open werk</option>
            <option value="mine">Mijn taken</option>
            <option value="all">Alle taken</option>
            <option value="overdue">Achterstallig</option>
          </select>
        </Field>
        <Field label="Taaksortering">
          <select
            name="taskSort"
            defaultValue={profilePrefs.preferences?.taskSort || "newest"}
          >
            <option value="newest">Nieuwste eerst</option>
            <option value="deadline">Deadline</option>
            <option value="priority">Prioriteit</option>
            <option value="title">Titel</option>
          </select>
        </Field>
        <h3>Dashboardtegels</h3>
        {[
          ["0", "Openstaande taken"],
          ["1", "Hoge prioriteit"],
          ["2", "Achterstallig"],
          ["3", "Lage voorraad"],
        ].map(([v, l]) => (
          <label className="checkbox" key={v}>
            <input
              name="metric"
              type="checkbox"
              value={v}
              defaultChecked={
                !profilePrefs.preferences?.dashboardMetrics ||
                profilePrefs.preferences.dashboardMetrics.includes(v)
              }
            />
            {l}
          </label>
        ))}
        <button className="primary" disabled={busy}>
          Voorkeuren opslaan
        </button>
      </form>
      <hr />
      <AccountPrivacy
        api={api}
        onDeleted={() => {
          setToken("");
          setUser(null);
          setDialog("");
        }}
      />
    </>
  );
}
