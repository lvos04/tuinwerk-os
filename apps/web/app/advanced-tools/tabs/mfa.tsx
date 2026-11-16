"use client";
import { json, F, saveBlob } from "../ui";
import type { AdvancedToolsState } from "../use-advanced-tools";

export function MfaTab({ w }: { w: AdvancedToolsState }) {
  const {
    mfa,
    setup,
    submit,
    setSetup,
    api,
    busy,
    user,
    setRecovery,
    setMfa,
    setNotice,
    recovery,
  } = w;
  return (
    <>
      <p className="muted">
        Beveilig je beheerdersaccount met een authenticator-app. Elke
        herstelcode werkt één keer.
      </p>
      {mfa?.requiredForAdmins && !mfa?.enabled && (
        <div className="alert error" role="alert">
          Een tweede factor is verplicht voor beheerders. Stel deze nu in om
          beheerfuncties weer te kunnen gebruiken.
        </div>
      )}
      {!mfa?.available && (
        <div className="alert error">
          De beveiligingssleutel is nog niet beschikbaar. De server maakt deze
          automatisch aan; controleer of de configuratieopslag toegankelijk is.
        </div>
      )}
      <p>
        Tweede factor:{" "}
        <strong>{mfa?.enabled ? "Ingeschakeld" : "Uitgeschakeld"}</strong>
      </p>
      {!mfa?.enabled && !setup && (
        <form
          onSubmit={(e) =>
            submit(e, async (f) =>
              setSetup(
                await api(
                  "/auth/mfa/setup",
                  json("POST", { password: f.get("password") }),
                ),
              ),
            )
          }
        >
          <F label="Bevestig je wachtwoord">
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </F>
          <button className="primary" disabled={busy || !mfa?.available}>
            Tweede factor instellen
          </button>
        </form>
      )}
      {setup && (
        <>
          <p>
            Voeg in je authenticator handmatig een tijdgebonden account toe met
            deze sleutel:
          </p>
          <code
            style={{
              display: "block",
              padding: 15,
              overflowWrap: "anywhere",
              background: "#f2f5ed",
            }}
          >
            {setup.secret}
          </code>
          <p className="muted">
            Account: {user.email} · TuinWerk OS · 6 cijfers · 30 seconden
          </p>
          <form
            onSubmit={(e) =>
              submit(e, async (f) => {
                const r = await api(
                  "/auth/mfa/enable",
                  json("POST", { otp: f.get("otp") }),
                );
                setRecovery(r.recoveryCodes);
                setSetup(null);
                setMfa(await api("/auth/mfa"));
                setNotice(
                  "Tweede factor ingeschakeld. Bewaar de herstelcodes nu veilig.",
                );
              })
            }
          >
            <F label="Code uit je authenticator">
              <input
                name="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
              />
            </F>
            <button className="primary" disabled={busy}>
              Activeren
            </button>
          </form>
        </>
      )}
      {recovery.length > 0 && (
        <>
          <h3>Herstelcodes — alleen nu zichtbaar</h3>
          <pre className="preview">{recovery.join("\n")}</pre>
          <button
            className="secondary"
            onClick={() =>
              saveBlob(
                new Blob([recovery.join("\n")], { type: "text/plain" }),
                "tuinwerk-herstelcodes.txt",
              )
            }
          >
            Herstelcodes downloaden
          </button>
          <label className="checkbox">
            <input
              type="checkbox"
              onChange={(e) => {
                if (e.target.checked) setRecovery([]);
              }}
            />{" "}
            Ik heb deze codes veilig opgeslagen; verberg ze.
          </label>
        </>
      )}
      {mfa?.enabled && (
        <>
          <hr />
          <form
            onSubmit={(e) =>
              submit(e, async (f) => {
                if (
                  !window.confirm(
                    "Tweede factor uitschakelen voor dit account?",
                  )
                )
                  return;
                await api(
                  "/auth/mfa/disable",
                  json("POST", {
                    password: f.get("password"),
                    otp: f.get("otp"),
                  }),
                );
                setMfa(await api("/auth/mfa"));
                setNotice("Tweede factor uitgeschakeld.");
              })
            }
          >
            <F label="Wachtwoord">
              <input name="password" type="password" required />
            </F>
            <F label="Authenticatiecode of herstelcode">
              <input name="otp" required />
            </F>
            <button className="secondary" disabled={busy}>
              Tweede factor uitschakelen
            </button>
          </form>
        </>
      )}
    </>
  );
}
