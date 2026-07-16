"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "../../components/app-shell";
import { RunDialog } from "../../components/run-dialog";
import { WorkflowBoard } from "../../components/workflow-board";
import type { Run, WorkflowDetail } from "../../client-types";

const terminalStatuses = new Set(["succeeded", "failed"]);

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function timestamp(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function duration(run: Run) {
  if (!run.startedAt) return "—";
  const end = run.completedAt ? new Date(run.completedAt).getTime() : Date.now();
  return `${Math.max(0, (end - new Date(run.startedAt).getTime()) / 1000).toFixed(1)}s`;
}

export function RunClient({
  id,
  configuredModels,
}: {
  id: string;
  configuredModels: Record<string, string | null>;
}) {
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState("");
  const [runOpen, setRunOpen] = useState(false);
  const [definition, setDefinition] = useState<WorkflowDetail["workflowDefinitionVersion"]["definition"] | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    async function poll() {
      controller = new AbortController();
      try {
        const response = await fetch(`/api/runs/${id}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error();
        const body = await response.json() as { run: Run };
        if (stopped) return;
        setRun(body.run);
        setError("");
        if (!terminalStatuses.has(body.run.status)) timer = setTimeout(poll, 150);
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
  }, [id]);

  useEffect(() => {
    if (!run) return;
    const controller = new AbortController();
    void fetch(`/api/workflows/${run.workflow.id}`, {
      signal: controller.signal,
      cache: "no-store",
    }).then(async (response) => {
      if (!response.ok) throw new Error();
      return response.json() as Promise<WorkflowDetail>;
    }).then((detail) => setDefinition(detail.workflowDefinitionVersion.definition)).catch((caught: unknown) => {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) {
        setError("Workflow definition could not be loaded");
      }
    });
    return () => controller.abort();
  }, [run?.workflow.id]);

  const output = run?.nodes.find((node) => node.type === "output.markdown")?.output?.markdown;

  return (
    <AppShell>
      <main className="page run-page">
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {!run && !error ? <p className="empty-state">Loading run…</p> : null}
        {run ? (
          <>
            <div className="run-header">
              <div>
                <Link className="back-link" href={`/workflows/${run.workflow.id}`}>{run.workflow.name}</Link>
                <h1>{run.workflow.name}</h1>
                <p className="mono">Run {run.id}</p>
              </div>
              <button className="button secondary" type="button" onClick={() => setRunOpen(true)}>Run again</button>
            </div>
            <section className="run-facts" aria-label="Run facts">
              <dl>
                <div><dt>Status</dt><dd className={`status-text status-${run.status}`}>{statusLabel(run.status)}</dd></div>
                <div><dt>Definition</dt><dd>Definition v{run.workflowDefinitionVersion.version}</dd></div>
                <div><dt>Started</dt><dd>{timestamp(run.startedAt)}</dd></div>
                <div><dt>Duration</dt><dd>{duration(run)}</dd></div>
              </dl>
            </section>
            {definition ? (
              <WorkflowBoard
                configuredModels={configuredModels}
                definition={definition}
                run={run}
              />
            ) : <p className="empty-state">Loading workflow canvas…</p>}
            {run.error ? (
              <section className="failure-panel" aria-labelledby="failure-title">
                <div>
                  <h2 id="failure-title">What happened</h2>
                  <p className="error-code mono">{run.error.code}</p>
                  <p>{run.error.message}</p>
                </div>
                <dl>
                  <div><dt>Affected node</dt><dd>{run.error.nodeId}</dd></div>
                  <div><dt>Why downstream was skipped</dt><dd>The Markdown output depends on the failed Agent result.</dd></div>
                  <div><dt>M0 does not support Retry</dt><dd>A new Run avoids repeating an unknown provider outcome.</dd></div>
                  <div><dt>Next step</dt><dd>Check the provider binding, then use Run again to create a separate Run.</dd></div>
                </dl>
              </section>
            ) : null}
            <section className="output-panel" aria-label="Output">
              <div className="section-heading"><h2>Output</h2></div>
              {output ? <div className="markdown-output">{output}</div> : (
                <p className="empty-state">{run.status === "failed" ? "No output was produced." : "Output will appear when the run succeeds."}</p>
              )}
            </section>
            <div className="run-history-link">
              <Link href={`/workflows/${run.workflow.id}#history`}>History</Link>
            </div>
            {runOpen ? (
              <RunDialog
                definitionVersionId={run.workflowDefinitionVersion.id}
                initialPrompt={run.input.prompt}
                onClose={() => setRunOpen(false)}
              />
            ) : null}
          </>
        ) : null}
      </main>
    </AppShell>
  );
}
