"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Info = {
  companyName: string;
  supportEmail: string;
  privacyContactEmail: string;
  privacyRetentionDescription: string;
  updatedAt: string;
  ready: boolean;
};
export default function PublicInformation({
  kind,
}: {
  kind: "privacy" | "support" | "deletion";
}) {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/public/info", { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw Error();
        setInfo(await r.json());
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, []);
  const title =
    kind === "privacy"
      ? "Privacy en jouw gegevens"
      : kind === "support"
        ? "Hulp bij TuinWerk"
        : "Je account verwijderen";
  return (
    <main
      style={{
        maxWidth: 800,
        margin: "auto",
        padding: "40px 24px",
        lineHeight: 1.65,
      }}
    >
      <Link href="/">TuinWerk OS</Link>
      <h1>{title}</h1>
      {error && (
        <p role="alert">
          De contactgegevens zijn tijdelijk niet bereikbaar. Probeer het later
          opnieuw.
        </p>
      )}
      {!info && !error && <p role="status">Contactgegevens laden…</p>}
      {info && (
        <>
          <p>
            Deze werkomgeving wordt beheerd door{" "}
            <strong>{info.companyName}</strong>.
          </p>
          {!info.ready && (
            <p role="status">
              De beheerder heeft de openbare contactgegevens of het bewaarbeleid
              nog niet volledig ingevuld. Deze informatie is nodig voordat de
              app via de stores wordt aangeboden.
            </p>
          )}
        </>
      )}
      {kind === "privacy" && (
        <>
          <h2>Welke gegevens worden gebruikt?</h2>
          <p>
            TuinWerk verwerkt je naam, e-mailadres, accountrechten en de
            werkgegevens die je toevoegt, zoals taken, reacties, foto's,
            tijdregistraties, planning en onderdelenverbruik. Deze gegevens
            staan op de server van de organisatie. Bevoegde collega's kunnen
            gedeelde werkgegevens zien; de beheerder kan accounts en
            bedrijfsgegevens beheren.
          </p>
          <p>
            Op je telefoon worden inloggegevens in de beveiligde opslag bewaard.
            Lokale werkgegevens en nog niet verzonden wijzigingen maken offline
            werken mogelijk. Biometrische ontgrendeling gebruikt het
            besturingssysteem; TuinWerk ontvangt geen vingerafdruk of
            gezichtsscan.
          </p>
          <h2>Toestemmingen en externe diensten</h2>
          <p>
            De camera en fotokiezer worden gebruikt wanneer je een QR-code scant
            of een foto toevoegt. Je kunt taken ook handmatig invoeren.
            Pushmeldingen zijn optioneel; met toestemming worden een
            apparaattoken en de inhoud van meldingen via Expo en Apple of Google
            verzonden. E-mail gaat via de door de organisatie ingestelde
            maildienst.
          </p>
          <p>
            Als de organisatie AI inschakelt, vraagt de app toestemming voordat
            de getoonde werkcontext naar de ingestelde AI-provider wordt
            gestuurd. OneDrive ontvangt uitsluitend versleutelde volledige
            back-ups en beperkte archiefmetadata wanneer een beheerder de
            koppeling inschakelt. Voor de koppeling worden
            Microsoft-toegangstokens beveiligd opgeslagen.
          </p>
          <p>
            TuinWerk bevat geen advertentienetwerk en gebruikt geen
            advertentie-ID voor tracking. De organisatie bepaalt welke optionele
            diensten zijn ingesteld en is verantwoordelijk voor de bijbehorende
            afspraken en bewaartermijnen.
          </p>
          <h2>Bewaren, verwijderen en back-ups</h2>
          <p style={{ whiteSpace: "pre-wrap" }}>
            {info?.privacyRetentionDescription ||
              "Het specifieke bewaarbeleid van deze organisatie is nog niet gepubliceerd."}
          </p>
          <p>
            Je kunt in de accountinstellingen je account verwijderen. Het
            account, de toegang en persoonlijke accountgegevens worden
            verwijderd. Gedeelde bedrijfsregistraties worden waar nodig zonder
            jouw accountkoppeling bewaard; verwijdering van het account
            verwijdert niet automatisch alle gedeelde taakteksten. Oude
            versleutelde back-ups kunnen eerdere gegevens bevatten totdat zij
            volgens het bewaarbeleid worden verwijderd. Neem voor inzage,
            correctie of aanvullende verwijdering contact op met de organisatie.
          </p>
          <Link href="/account-deletion">Hoe verwijder ik mijn account?</Link>
          <h2>Privacycontact</h2>
          {info?.privacyContactEmail ? (
            <a href={"mailto:" + info.privacyContactEmail}>
              {info.privacyContactEmail}
            </a>
          ) : (
            <p>Het privacycontact is nog niet ingesteld.</p>
          )}
        </>
      )}
      {kind === "support" && (
        <>
          <h2>Contact met je organisatie</h2>
          {info?.supportEmail ? (
            <p>
              Mail{" "}
              <a href={"mailto:" + info.supportEmail}>{info.supportEmail}</a>{" "}
              voor hulp met deze werkomgeving.
            </p>
          ) : (
            <p>De beheerder heeft nog geen openbaar supportadres ingesteld.</p>
          )}
          <h2>Verbinding en offline werk</h2>
          <p>
            Gebruik het HTTPS-serveradres dat je organisatie heeft gegeven.
            Controleer bij verbindingsproblemen je internetverbinding en
            serveradres. In de mobiele app laat Synchronisatie zien welke
            wijzigingen nog op je telefoon staan en welke conflicten aandacht
            vragen. Verwijder de app niet zolang je nog ongesynchroniseerd werk
            wilt bewaren.
          </p>
          <h2>Toegang</h2>
          <p>
            Je organisatie verstrekt je account. Vraag je beheerder om hulp als
            je niet kunt inloggen of je tweede factor niet meer beschikbaar is.
            Stuur nooit je wachtwoord, herstelcodes of back-upherstelcode mee in
            een hulpvraag.
          </p>
          <Link href="/account-deletion">Account verwijderen</Link>
        </>
      )}
      {kind === "deletion" && (
        <>
          <p>
            Je kunt de verwijdering zelf starten in TuinWerk. Er is geen
            telefoongesprek of supportverzoek nodig om je eigen account te
            verwijderen.
          </p>
          <ol>
            <li>
              Open de accountinstellingen in de app, of meld je hieronder aan op
              deze werkomgeving.
            </li>
            <li>
              Kies <strong>Account verwijderen</strong>. Lees welke gegevens
              worden verwijderd en welke gedeelde bedrijfsregistraties
              overblijven.
            </li>
            <li>
              Bevestig met je wachtwoord, je tweede factor indien ingesteld en
              de getoonde bevestigingstekst.
            </li>
          </ol>
          <p>
            Je toegang wordt ingetrokken. Persoonlijke accountgegevens en
            privégegevens worden verwijderd; noodzakelijke koppelingen in
            gedeelde bedrijfsregistraties worden vervangen door een algemene
            verwijderde-gebruikervermelding. Vrij ingevoerde gedeelde
            taakteksten kunnen nog informatie bevatten. Eerdere versleutelde
            back-ups vallen onder het afzonderlijke bewaarbeleid van de
            organisatie.
          </p>
          <p>
            Ben je de laatste beheerder, wijs dan eerst een andere beheerder aan
            zodat de organisatie toegang behoudt. Bewaar of synchroniseer
            gewenst lokaal werk voordat je verwijdert.
          </p>
          <p>
            <Link className="primary" href="/?account=privacy">
              Aanmelden en accountinstellingen openen
            </Link>
          </p>
          {info?.privacyContactEmail && (
            <p>
              Voor aanvullende gegevensverzoeken:{" "}
              <a href={"mailto:" + info.privacyContactEmail}>
                {info.privacyContactEmail}
              </a>
              .
            </p>
          )}
        </>
      )}
      <nav
        aria-label="Openbare informatie"
        style={{ display: "flex", gap: 20, flexWrap: "wrap", marginTop: 40 }}
      >
        <Link href="/privacy">Privacy</Link>
        <Link href="/support">Support</Link>
        <Link href="/account-deletion">Account verwijderen</Link>
        <Link href="/">Naar de app</Link>
      </nav>
    </main>
  );
}
