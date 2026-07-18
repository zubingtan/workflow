"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "../components/app-shell";
import type { ApiError, Resource, ResourceList } from "../client-types";

type Kind = "agents" | "skills" | "mcps";
const labels: Record<Kind, string> = { agents: "Agents", skills: "Skills", mcps: "MCP servers" };

export default function ResourcesPage() {
  const [kind, setKind] = useState<Kind>("agents");
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<Resource | "new" | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function load(nextKind = kind) {
    setLoading(true);
    try { const response = await fetch(`/api/resources/${nextKind}`, { cache: "no-store" }); if (!response.ok) throw new Error(); const body = await response.json() as ResourceList; setResources(body.resources); } catch { setError({ message: "Resources could not be loaded" }); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps
  async function archive(resource: Resource) {
    if (!window.confirm(`Archive ${resource.name}?`)) return;
    const response = await fetch(`/api/resources/${kind}/${resource.id}`, { method: "DELETE" });
    if (!response.ok) { setError({ message: "Resource could not be archived" }); return; }
    void load();
  }
  return <AppShell><main className="page resources-page"><header className="page-heading"><div><Link className="back-link" href="/">Workflows</Link><h1>Resources</h1><p>Versioned agent, Skill, and MCP references for workflow authoring.</p></div><button className="button primary" type="button" onClick={() => setEditor("new")}>Create {labels[kind].slice(0, -1)}</button></header>
    <div className="resource-tabs" role="tablist" aria-label="Resource kind">{(Object.keys(labels) as Kind[]).map((item) => <button key={item} type="button" role="tab" aria-selected={kind === item} onClick={() => { setKind(item); setEditor(null); setError(null); }}>{labels[item]}</button>)}</div>
    {error ? <p className="form-error" role="alert">{error.message}</p> : null}{loading ? <p className="empty-state">Loading resources…</p> : null}
    {!loading ? <section className="resource-list" aria-label={labels[kind]}>{resources.length === 0 ? <p className="empty-state">No {labels[kind].toLowerCase()} yet.</p> : resources.map((resource) => <article className={`resource-row${resource.archivedAt ? " archived" : ""}`} key={resource.id}><div><h2>{resource.name}</h2><p className="mono">{resource.latestVersion ? `Version ${resource.latestVersion.version} · ${resource.latestVersion.id}` : "No version"}</p>{resource.archivedAt ? <span>Archived</span> : null}</div><div><button className="button secondary" type="button" onClick={() => setEditor(resource)}>Edit as new version</button>{!resource.archivedAt ? <button className="button secondary" type="button" onClick={() => void archive(resource)}>Archive</button> : null}</div></article>)}</section> : null}
  </main>{editor ? <ResourceEditor kind={kind} resource={editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); void load(); }} /> : null}</AppShell>;
}

function ResourceEditor({ kind, resource, onClose, onSaved }: { kind: Kind; resource: Resource | "new"; onClose: () => void; onSaved: () => void }) {
  const existing = resource === "new" ? null : resource;
  const [name, setName] = useState(existing?.name ?? "");
  const [definition, setDefinition] = useState(() => JSON.stringify(existing?.latestVersion?.definition ?? {}, null, 2));
  const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving) return; setSaving(true); setError("");
    try {
      const value = JSON.parse(definition) as Record<string, unknown>;
      const response = await fetch(existing ? `/api/resources/${kind}/${existing.id}` : `/api/resources/${kind}`, { method: existing ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, definition: value }) });
      if (!response.ok) { const body = await response.json() as ApiError; setError(body.message ?? "Resource could not be saved"); return; } onSaved();
    } catch { setError("Definition must be valid JSON"); } finally { setSaving(false); }
  }
  return <div className="sheet-layer"><section className="sheet" role="dialog" aria-modal="true" aria-labelledby="resource-editor-title"><div className="sheet-header"><div><h2 id="resource-editor-title">{existing ? "Edit as new version" : `Create ${labels[kind].slice(0, -1)}`}</h2><p>Definitions are versioned. Existing references are never edited in place.</p></div><button className="icon-button" type="button" aria-label="Close resource editor" onClick={onClose}>×</button></div><form className="sheet-form" onSubmit={submit}><label htmlFor="resource-name">Name</label><input id="resource-name" value={name} onChange={(event) => setName(event.target.value)} required /><label htmlFor="resource-definition">Definition JSON</label><textarea id="resource-definition" className="code-input" value={definition} onChange={(event) => setDefinition(event.target.value)} spellCheck={false} rows={16} />{error ? <p className="form-error" role="alert">{error}</p> : null}<div className="sheet-actions"><button className="button secondary" type="button" onClick={onClose}>Cancel</button><button className="button primary" type="submit" disabled={!name || saving}>{saving ? "Saving…" : "Save version"}</button></div></form></section></div>;
}
