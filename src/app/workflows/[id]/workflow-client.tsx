"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "../../components/app-shell";
import { RunDialog } from "../../components/run-dialog";
import { WorkflowBoard } from "../../components/workflow-board";
import type { Run, RunHistoryItem, WorkflowDetail } from "../../client-types";

const terminalStatuses = new Set(["succeeded", "failed"]);

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
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<Run | null>(null);

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

  useEffect(() => {
    if (!activeRunId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    async function refreshHistory() {
      const response = await fetch(`/api/workflows/${id}/runs`, { cache: "no-store" });
      if (!response.ok || stopped) return;
      const body = await response.json() as { runs: RunHistoryItem[] };
      if (!stopped) setRuns(body.runs);
    }

    async function poll() {
      controller = new AbortController();
      try {
        const response = await fetch(`/api/runs/${activeRunId}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error();
        const body = await response.json() as { run: Run };
        if (stopped) return;
        setActiveRun(body.run);
        if (terminalStatuses.has(body.run.status)) {
          void refreshHistory();
        } else {
          timer = setTimeout(poll, 150);
        }
      } catch (caught) {
        if (stopped || (caught instanceof DOMException && caught.name === "AbortError")) return;
        setError("Run could not be loaded");
      }
    }

    void poll();
    return () => {
      stopped = true;
      controller?.abort();
      if (timer) clearTimeout(timer);
    };
  }, [activeRunId, id]);

  const output = activeRun?.nodes.find((node) => node.type === "output.markdown")?.output?.markdown;

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
              definition={detail.workflowDefinitionVersion.definition}
              run={activeRun}
            />
            {activeRun ? (
              <section className="output-panel" aria-label="Output">
                <div className="section-heading"><h2>Output</h2></div>
                {output ? <div className="markdown-output">{output}</div> : (
                  <p className="empty-state">Output will appear when the run succeeds.</p>
                )}
              </section>
            ) : null}
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
                onCreated={setActiveRunId}
                onClose={() => setRunOpen(false)}
              />
            ) : null}
          </>
        ) : null}
      </main>
    </AppShell>
  );
}
