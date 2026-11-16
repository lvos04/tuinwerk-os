"use client";
import { json, F } from "../ui";
import type { AdvancedToolsState } from "../use-advanced-tools";

export function AiTab({ w }: { w: AdvancedToolsState }) {
  const {
    aiStatus,
    submit,
    api,
    error,
    setAiStatus,
    setSuggestion,
    busy,
    suggestion,
    reload,
    setNotice,
  } = w;
  return (
    <>
      <p className="muted">
        AI maakt alleen een voorstel. Alleen de tekst hieronder wordt na jouw
        toestemming naar de ingestelde provider gestuurd. Controleer het
        resultaat voordat je het opslaat.
      </p>
      <div className="alert">
        {aiStatus?.enabled
          ? "Provider: " + aiStatus.providerOrigin + " · " + aiStatus.model
          : "AI is uitgeschakeld. De beheerder kan de provider, sleutel en budgetten instellen via Beheer → Integraties → Optionele AI-assistent."}
      </div>
      <form
        onSubmit={(e) =>
          submit(e, async (f) => {
            const checkbox = document.querySelector<HTMLInputElement>(
              'input[name="consent"]',
            );
            if (checkbox) checkbox.checked = false;
            let r;
            try {
              r = await api(
                "/ai/suggest",
                json("POST", {
                  text: f.get("text"),
                  consent: f.get("consent") === "on",
                  providerConfigId: aiStatus?.providerConfigId,
                }),
              );
            } catch (error) {
              setAiStatus(await api("/ai/status"));
              throw error;
            }
            setSuggestion(r.suggestion);
          })
        }
      >
        <F label="Tekst voor de AI-provider">
          <textarea name="text" required maxLength={4000} rows={5} />
        </F>
        <label className="checkbox">
          <input name="consent" type="checkbox" required /> Ik geef toestemming
          deze tekst met de getoonde provider te delen.
        </label>
        <button className="primary" disabled={busy || !aiStatus?.enabled}>
          Voorstel genereren
        </button>
      </form>
      {suggestion && (
        <>
          <hr />
          <form
            onSubmit={(e) =>
              submit(e, async (f) => {
                if (
                  !window.confirm(
                    "Heb je het voorstel gecontroleerd en wil je deze taak aanmaken?",
                  )
                )
                  return;
                await api(
                  "/tasks",
                  json("POST", {
                    operationId: crypto.randomUUID(),
                    title: f.get("title"),
                    description: f.get("description"),
                  }),
                );
                setSuggestion("");
                await reload();
                setNotice("Gecontroleerd voorstel als taak opgeslagen.");
              })
            }
          >
            <F label="Titel na jouw controle">
              <input name="title" required maxLength={300} />
            </F>
            <F label="Corrigeer het voorstel">
              <textarea
                name="description"
                defaultValue={suggestion}
                rows={10}
              />
            </F>
            <button className="primary" disabled={busy}>
              Gecontroleerd voorstel opslaan
            </button>
          </form>
        </>
      )}
    </>
  );
}
