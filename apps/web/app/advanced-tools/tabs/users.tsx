"use client";
import { F, options, json } from "../ui";
import type { AdvancedToolsState } from "../use-advanced-tools";

export function UsersTab({ w }: { w: AdvancedToolsState }) {
  const { selected, setSelected, users, submit, api, reload, setNotice, busy } =
    w;
  return (
    <>
      <F label="Account">
        <select
          value={selected?.id || ""}
          onChange={(e) =>
            setSelected(users.find((r) => r.id === e.target.value) || null)
          }
        >
          <option value="">Kies medewerker</option>
          {options(users)}
        </select>
      </F>
      {selected && (
        <form
          key={selected.id}
          onSubmit={(e) =>
            submit(e, async (f) => {
              await api(
                "/users/" + selected.id,
                json("PATCH", {
                  name: f.get("name"),
                  role: f.get("role"),
                  active: f.get("active") === "on",
                  ...(f.get("password") ? { password: f.get("password") } : {}),
                }),
              );
              await reload();
              setSelected(null);
              setNotice("Account bijgewerkt.");
            })
          }
        >
          <F label="Naam">
            <input name="name" defaultValue={selected.name} required />
          </F>
          <F label="Rol">
            <select name="role" defaultValue={selected.role}>
              <option value="employee">Medewerker</option>
              <option value="admin">Beheerder</option>
            </select>
          </F>
          <F label="Nieuw wachtwoord (leeg = behouden)">
            <input
              name="password"
              type="password"
              minLength={12}
              autoComplete="new-password"
            />
          </F>
          <label className="checkbox">
            <input
              name="active"
              type="checkbox"
              defaultChecked={selected.active !== false}
            />{" "}
            Account actief
          </label>
          <button className="primary" disabled={busy}>
            Account opslaan
          </button>
        </form>
      )}
    </>
  );
}
