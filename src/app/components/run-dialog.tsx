"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type RunDialogProps = {
  definitionVersionId: string;
  initialPrompt?: string;
  onClose: () => void;
};

export function RunDialog({ definitionVersionId, initialPrompt = "", onClose }: RunDialogProps) {
  const router = useRouter();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (prompt.length === 0 || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workflowDefinitionVersionId: definitionVersionId,
          input: { prompt },
        }),
      });
      const body = await response.json() as { runId?: string; message?: string };
      if (!response.ok || !body.runId) {
        setError(body.message ?? "The run could not be created");
        return;
      }
      onClose();
      router.push(`/runs/${body.runId}`);
    } catch {
      setError("The run could not be created");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="sheet-layer">
      <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="run-dialog-title">
        <div className="sheet-header">
          <div>
            <h2 id="run-dialog-title">Run workflow</h2>
            <p>Enter the input for this immutable definition version.</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close run workflow">
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <form className="sheet-form" onSubmit={submit}>
          <label htmlFor="run-prompt">Prompt</label>
          <textarea
            id="run-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            autoFocus
            rows={12}
          />
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="sheet-actions">
            <button className="button secondary" type="button" onClick={onClose}>Cancel</button>
            <button className="button primary" type="submit" disabled={prompt.length === 0 || submitting}>
              {submitting ? "Creating…" : "Run"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
