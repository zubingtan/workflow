"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "../../components/app-shell";
import { RunDialog } from "../../components/run-dialog";
import { WorkflowBoard } from "../../components/workflow-board";
import type { RunHistoryItem, WorkflowDetail } from "../../client-types";

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function WorkflowClient({
  id,
  configuredModels,
}: {
  id: string;
  configuredModels: Record<string, string | null>;
}) {
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [runs, setRuns] = useState<RunHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [runOpen, setRunOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetch(`/api/workflows/${id}`, { signal: controller.signal, cache: "no-store" }),
      fetch(`/api/workflows/${id}/runs`, { signal: controller.signal, cache: "no-store" }),
    ]).then(async ([detailResponse, runsResponse]) => {
      if (!detailResponse.ok || !runsResponse.ok) throw new Error();
      const [nextDetail, nextRuns] = await Promise.all([
        detailResponse.json() as Promise<WorkflowDetail>,
        runsResponse.json() as Promise<{ runs: RunHistoryItem[] }>,
      ]);
      setDetail(nextDetail);
      setRuns(nextRuns.runs);
    }).catch((caught: unknown) => {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) {
        setError("Workflow could not be loaded");
      }
    }).finally(() => setLoading(false));
    return () => controller.abort();
  }, [id]);

  return (
    <AppShell>
      <main className="page workflow-page">
        {loading ? <p className="empty-state">Loading workflow…</p> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {detail ? (
          <>
            <div className="page-heading workflow-heading">
              <div>
                <Link className="back-link" href="/">Workflows</Link>
                <h1>{detail.workflow.name}</h1>
                <p className="mono">Definition v{detail.workflowDefinitionVersion.version}</p>
              </div>
              <button className="button primary" type="button" onClick={() => setRunOpen(true)}>Run workflow</button>
            </div>
            <WorkflowBoard
              configuredModels={configuredModels}
              nodes={detail.workflowDefinitionVersion.definition.spec.nodes}
            />
            <section className="history-section" id="history" aria-labelledby="history-title">
              <div className="section-heading">
                <h2 id="history-title">History</h2>
                <Link href="#history">History</Link>
              </div>
              {runs.length === 0 ? <p className="empty-state">No runs yet.</p> : (
                <div className="table-scroll">
                  <table>
                    <thead><tr><th>Run</th><th>Status</th><th>Definition</th><th>Created</th></tr></thead>
                    <tbody>
                      {runs.map((run) => (
                        <tr key={run.id}>
                          <td><Link className="mono run-link" href={`/runs/${run.id}`}>{run.id}</Link></td>
                          <td><span className={`status-text status-${run.status}`}>{statusLabel(run.status)}</span></td>
                          <td>Definition v{run.workflowDefinitionVersion.version}</td>
                          <td>{shortDate(run.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            {runOpen ? (
              <RunDialog
                definitionVersionId={detail.workflowDefinitionVersion.id}
                onClose={() => setRunOpen(false)}
              />
            ) : null}
          </>
        ) : null}
      </main>
    </AppShell>
  );
}
