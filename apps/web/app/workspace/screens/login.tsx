"use client";
import { Sprout, Leaf, Check, ArrowUpRight } from "lucide-react";
import { Field } from "../ui";
import type { Workspace } from "../use-workspace";

export function LoginScreen({ w }: { w: Workspace }) {
  const { error, login, busy } = w;
  return (
    <main className="login">
      <section className="login-story">
        <div className="brand">
          <Sprout size={34} />
          <span>
            TuinWerk <b>OS</b>
          </span>
        </div>
        <span className="eyebrow">RUIMTE OM TE GROEIEN</span>
        <h1>
          Goed werk begint
          <br />
          met overzicht.
        </h1>
        <p>
          Van de eerste melding tot de laatste controle.
          <br />
          Alle werkzaamheden op één plek.
        </p>
        <div className="login-art">
          <Leaf size={180} strokeWidth={0.7} />
          <div>
            <Check /> Samen aan het werk
          </div>
        </div>
        <small>Onderhoud · Planning · Voorraad</small>
      </section>
      <section className="login-form">
        <div>
          <span className="eyebrow">WELKOM TERUG</span>
          <h2>Aan de slag</h2>
          <p>Log in op de werkomgeving van jouw team.</p>
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          <form onSubmit={login}>
            <Field label="E-mailadres">
              <input
                name="email"
                type="email"
                required
                autoComplete="username"
                placeholder="naam@bedrijf.nl"
                defaultValue={
                  typeof window !== "undefined"
                    ? sessionStorage.getItem("tuinwerk-setup-email") || ""
                    : ""
                }
              />
            </Field>
            <Field label="Wachtwoord">
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
              />
            </Field>
            <Field label="Tweede factor (indien ingesteld)">
              <input
                name="otp"
                autoComplete="one-time-code"
                placeholder="Authenticatie- of herstelcode"
              />
            </Field>
            <button className="primary" disabled={busy}>
              {busy ? "Even geduld…" : "Inloggen"} <ArrowUpRight size={18} />
            </button>
          </form>
          <p className="muted">
            Nog geen account? Je beheerder kan je toegang geven.
          </p>
          <div className="public-links">
            <a href="/privacy">Privacybeleid</a>
            <a href="/support">Hulp en contact</a>
            <a href="/account-deletion">Account verwijderen</a>
          </div>
        </div>
      </section>
    </main>
  );
}
