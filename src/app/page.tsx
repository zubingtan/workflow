"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "./components/app-shell";
import type { ApiError, WorkflowSummary } from "./client-types";

export default function WorkflowsPage() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [open, setOpen] = useState(false);
  const [json, setJson] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<ApiError | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/workflows", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const body = await response.json() as { workflows: WorkflowSummary[] };
        setWorkflows(body.workflows);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setLoadError("Workflows could not be loaded");
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  async function importWorkflow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (json.length === 0 || importing) return;
    setImporting(true);
    setImportError(null);
    try {
      const response = await fetch("/api/workflows/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: json,
      });
      const body = await response.json() as ApiError & { workflow?: { id: string } };
      if (!response.ok || !body.workflow?.id) {
        setImportError(body);
        return;
      }
      setOpen(false);
      router.push(`/workflows/${body.workflow.id}`);
    } catch {
      setImportError({ message: "The workflow could not be imported" });
    } finally {
      setImporting(false);
    }
  }

  return (
    <AppShell>
      <main className="page page-list">
        <div className="page-heading">
          <div>
            <h1>Workflows</h1>
            <p>Immutable definitions available to run on this local M0 stack.</p>
          </div>
          <button className="button primary" type="button" onClick={() => setOpen(true)}>Import workflow</button>
        </div>
        <section className="workflow-list" aria-label="Workflow list">
          {loading ? <p className="empty-state">Loading workflows…</p> : null}
          {loadError ? <p className="form-error" role="alert">{loadError}</p> : null}
          {!loading && !loadError && workflows.length === 0 ? <p className="empty-state">No workflows yet.</p> : null}
          {workflows.map((workflow) => (
            <Link className="workflow-row" href={`/workflows/${workflow.id}`} key={workflow.id}>
              <div>
                <h2>{workflow.name}</h2>
                <p>Definition v{workflow.latestDefinitionVersion.version}</p>
              </div>
              <span className="row-arrow" aria-hidden="true">→</span>
            </Link>
          ))}
        </section>
      </main>
      {open ? (
        <div className="sheet-layer nonblocking">
          <section className="sheet" role="dialog" aria-modal="false" aria-labelledby="import-title">
            <div className="sheet-header">
              <div>
                <h2 id="import-title">Import workflow</h2>
                <p>Paste the JSON definition. Successful imports always create a new version.</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setOpen(false)} aria-label="Close import workflow">
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <form className="sheet-form" onSubmit={importWorkflow}>
              <label htmlFor="workflow-json">Workflow JSON</label>
              <textarea
                id="workflow-json"
                className="code-input"
                value={json}
                onChange={(event) => setJson(event.target.value)}
                autoFocus
                rows={18}
                spellCheck={false}
              />
              {importError ? (
                <div className="validation-error" role="alert">
                  <strong>{importError.message ?? "The definition is invalid"}</strong>
                  {importError.path !== undefined ? <p>{importError.path}</p> : null}
                  {importError.nodeId ? <p>{importError.nodeId}</p> : null}
                </div>
              ) : null}
              <div className="sheet-actions">
                <button className="button secondary" type="button" onClick={() => setOpen(false)}>Cancel</button>
                <button className="button primary" type="submit" disabled={json.length === 0 || importing}>
                  {importing ? "Importing…" : "Import"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
