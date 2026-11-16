"use client";
import { Field } from "../ui";
import type { WorkspaceView } from "../use-workspace";

export function UserDialog({ w }: { w: WorkspaceView }) {
  const { submit, post, busy } = w;
  return (
    <form
      onSubmit={(e) =>
        submit(e, async (f) => {
          await post("/users", Object.fromEntries(f));
        })
      }
    >
      <Field label="Naam">
        <input name="name" required />
      </Field>
      <Field label="E-mailadres">
        <input name="email" type="email" required />
      </Field>
      <Field label="Initieel wachtwoord (minimaal 12 tekens)">
        <input
          name="password"
          type="password"
          minLength={12}
          required
          autoComplete="new-password"
        />
      </Field>
      <Field label="Rol">
        <select name="role">
          <option value="employee">Medewerker</option>
          <option value="admin">Beheerder</option>
        </select>
      </Field>
      <button className="primary" disabled={busy}>
        Account aanmaken
      </button>
    </form>
  );
}
