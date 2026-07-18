"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "../../components/app-shell";
import { RunDialog } from "../../components/run-dialog";
import { WorkflowBoard } from "../../components/workflow-board";
import type { ApiError, ResourceList, RunHistoryItem, WorkflowAuthoringDocument, WorkflowDefinitionDocument, WorkflowDetail } from "../../client-types";

const emptyResources: ResourceList = { resources: [] };
const terminalStatuses = new Set(["succeeded", "failed"]);
function statusLabel(status: string) { return status.charAt(0).toUpperCase() + status.slice(1); }
function shortDate(value: string) { return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }

export function WorkflowClient({ id, configuredModels }: { id: string; configuredModels: Record<string, string | null> }) {
  const router = useRouter();
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [resources, setResources] = useState({ agents: emptyResources, skills: emptyResources, mcps: emptyResources });
  const [runs, setRuns] = useState<RunHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [validationError, setValidationError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const [tab, setTab] = useState<"visual" | "json">("visual");
  const [runOpen, setRunOpen] = useState(false);
  const [dirtyAgents, setDirtyAgents] = useState<Set<string>>(() => new Set());
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteName, setDeleteName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetch(`/api/workflows/${id}`, { signal: controller.signal, cache: "no-store" }), fetch(`/api/workflows/${id}/runs`, { signal: controller.signal, cache: "no-store" }),
      fetch("/api/resources/agents", { signal: controller.signal, cache: "no-store" }), fetch("/api/resources/skills", { signal: controller.signal, cache: "no-store" }), fetch("/api/resources/mcps", { signal: controller.signal, cache: "no-store" }),
    ]).then(async ([detailResponse, runsResponse, agentsResponse, skillsResponse, mcpsResponse]) => {
      if (!detailResponse.ok || !runsResponse.ok) throw new Error();
      const [nextDetail, nextRuns] = await Promise.all([detailResponse.json() as Promise<WorkflowDetail>, runsResponse.json() as Promise<{ runs: RunHistoryItem[] }>]);
      setDetail(nextDetail); setRuns(nextRuns.runs); setHasUnsaved(false);
      const [agents, skills, mcps] = await Promise.all([
        agentsResponse.ok ? agentsResponse.json() as Promise<ResourceList> : Promise.resolve(emptyResources),
        skillsResponse.ok ? skillsResponse.json() as Promise<ResourceList> : Promise.resolve(emptyResources),
        mcpsResponse.ok ? mcpsResponse.json() as Promise<ResourceList> : Promise.resolve(emptyResources),
      ]);
      setResources({ agents, skills, mcps });
    }).catch((caught: unknown) => { if (!(caught instanceof DOMException && caught.name === "AbortError")) setError("Workflow could not be loaded"); }).finally(() => setLoading(false));
    return () => controller.abort();
  }, [id]);

  const current = detail?.workflowDefinitionVersion;
  const payload = useMemo(() => current ? JSON.stringify({ definition: current.definition, authoring: current.authoring }, null, 2) : "", [current]);
  const dirty = hasUnsaved;

  function change(definition: WorkflowDefinitionDocument, authoring: WorkflowAuthoringDocument) {
    setDetail((currentDetail) => currentDetail ? { ...currentDetail, workflow: { ...currentDetail.workflow, name: definition.metadata.name }, workflowDefinitionVersion: { ...currentDetail.workflowDefinitionVersion, definition, authoring } } : currentDetail);
    setHasUnsaved(true);
    setValidationError(null);
  }
  function markAgentDirty(nodeId: string) { setDirtyAgents((currentDirty) => new Set(currentDirty).add(nodeId)); }
  async function save(): Promise<WorkflowDetail | null> {
    if (!detail || saving) return detail;
    setSaving(true); setValidationError(null);
    const sources = detail.workflowDefinitionVersion.authoring.agentSources ?? {};
    const agents = [...dirtyAgents].flatMap((nodeId) => {
      const source = sources[nodeId];
      const node = detail.workflowDefinitionVersion.definition.spec.nodes.find((item) => item.id === nodeId);
      return source && node?.type === "task.agent" ? [{ nodeId, ...(source.id ? { id: source.id } : {}), name: source.name, definition: { systemPrompt: node.config.systemPrompt, providerBindingRef: node.config.providerBindingRef, skillVersionRefs: node.config.skillVersionRefs, mcpServerVersionRefs: node.config.mcpServerVersionRefs } }] : [];
    });
    try {
      const response = await fetch(`/api/workflows/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ definition: detail.workflowDefinitionVersion.definition, authoring: detail.workflowDefinitionVersion.authoring, ...(agents.length ? { agents } : {}) }) });
      const body = await response.json() as WorkflowDetail & ApiError;
      if (!response.ok || !body.workflowDefinitionVersion) { setValidationError(body); return null; }
      setDetail(body); setDirtyAgents(new Set()); setHasUnsaved(false); return body;
    } catch { setError("Workflow could not be saved"); return null; } finally { setSaving(false); }
  }
  async function testRun() { if (await save()) setRunOpen(true); }
  async function copyJson() { try { await navigator.clipboard.writeText(payload); } catch { setError("JSON could not be copied"); } }
  async function deleteWorkflow() {
    if (!detail || deleteName !== detail.workflow.name || deleting) return;
    setDeleting(true); setDeleteError("");
    try {
      const response = await fetch(`/api/workflows/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as ApiError;
        setDeleteError(body.message ?? "Workflow could not be deleted");
        return;
      }
      router.push("/");
    } catch {
      setDeleteError("Workflow could not be deleted");
    } finally {
      setDeleting(false);
    }
  }

  return <AppShell><main className="builder-page">
    {loading ? <p className="empty-state">Loading workflow…</p> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}
    {detail && current ? <>
      <header className="builder-topbar"><div><Link className="back-link" href="/">Workflows</Link><label className="workflow-name-label">Workflow name<input value={current.definition.metadata.name} onChange={(event) => change({ ...current.definition, metadata: { name: event.target.value } }, current.authoring)} /></label><span className="builder-version">Definition v{current.version}{dirty ? " · Unsaved" : ""}</span></div><div className="builder-top-actions"><Link className="button secondary" href="/resources">Resources</Link><button className="button danger" type="button" onClick={() => { setDeleteName(""); setDeleteError(""); setDeleteOpen(true); }}>Delete workflow</button><button className="button primary" type="button" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save"}</button></div></header>
      <div className="builder-tabs" role="tablist" aria-label="Workflow view"><button role="tab" aria-selected={tab === "visual"} type="button" onClick={() => setTab("visual")}>Visual</button><button role="tab" aria-selected={tab === "json"} type="button" onClick={() => setTab("json")}>JSON</button></div>
      {tab === "visual" ? <WorkflowBoard definition={current.definition} authoring={current.authoring} resources={resources} configuredModels={configuredModels} validationError={validationError} onChange={change} onTestRun={() => void testRun()} onAgentDirty={markAgentDirty} /> : <section className="json-view" aria-label="Read-only workflow JSON"><div><h2>Unsaved definition and authoring</h2><button className="button secondary" type="button" onClick={() => void copyJson()}>Copy JSON</button></div><pre>{payload}</pre></section>}
      <section className="history-section builder-history" id="history" aria-labelledby="history-title"><div className="section-heading"><h2 id="history-title">Run history</h2></div>{runs.length === 0 ? <p className="empty-state">No runs yet.</p> : <div className="table-scroll"><table><thead><tr><th>Run</th><th>Status</th><th>Definition</th><th>Created</th></tr></thead><tbody>{runs.map((run) => <tr key={run.id}><td><Link className="mono run-link" href={`/runs/${run.id}`}>{run.id}</Link></td><td><span className={`status-text status-${run.status}`}>{statusLabel(run.status)}</span></td><td>Definition v{run.workflowDefinitionVersion.version}</td><td>{shortDate(run.createdAt)}</td></tr>)}</tbody></table></div>}</section>
      {runOpen ? <RunDialog definitionVersionId={current.id} onClose={() => setRunOpen(false)} /> : null}
    </> : null}
    {deleteOpen && detail ? <div className="sheet-layer"><section className="sheet delete-workflow-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-workflow-title"><div className="sheet-header"><div><h2 id="delete-workflow-title">Delete workflow</h2><p>This permanently removes <strong>{detail.workflow.name}</strong> and its saved versions.</p></div><button className="icon-button" type="button" aria-label="Close delete workflow" onClick={() => setDeleteOpen(false)}>×</button></div><form className="sheet-form" onSubmit={(event) => { event.preventDefault(); void deleteWorkflow(); }}><label htmlFor="delete-workflow-name">Type the workflow name to confirm</label><input id="delete-workflow-name" value={deleteName} onChange={(event) => setDeleteName(event.target.value)} autoFocus autoComplete="off" />{deleteError ? <p className="form-error" role="alert">{deleteError}</p> : null}<div className="sheet-actions"><button className="button secondary" type="button" onClick={() => setDeleteOpen(false)}>Cancel</button><button className="button danger" type="submit" disabled={deleteName !== detail.workflow.name || deleting}>{deleting ? "Deleting…" : "Delete workflow"}</button></div></form></section></div> : null}
  </main></AppShell>;
}
