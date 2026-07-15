import type { RunNode, WorkflowNodeDefinition } from "../client-types";

const nodeNames = {
  "input.prompt": "Input prompt",
  "process.agent": "Agent analysis",
  "output.markdown": "Markdown output",
};

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

type BoardNode = WorkflowNodeDefinition | RunNode;

function isRunNode(node: BoardNode): node is RunNode {
  return "status" in node;
}

export function WorkflowBoard({
  configuredModels,
  nodes,
}: {
  configuredModels: Record<string, string | null>;
  nodes: BoardNode[];
}) {
  return (
    <section className="board" aria-label="Board">
      <div className="board-track">
        {nodes.map((node, index) => {
          const runNode = isRunNode(node) ? node : null;
          const definitionNode = isRunNode(node) ? null : node;
          const effective = runNode?.attempt?.agentExecution?.providerSnapshot?.effectiveModel
            ?? runNode?.attempt?.providerSnapshot?.effectiveModel;
          const binding = runNode?.providerBindingRef ?? definitionNode?.config.providerBindingRef;
          const configured = binding ? configuredModels[binding] : null;
          const agentVersion = runNode?.agentDefinitionVersion?.id ?? definitionNode?.config.agentVersionRef;
          return (
            <div className="board-step" key={node.id}>
              <article className={`node-card${runNode ? ` status-${runNode.status}` : ""}`}>
                <div className="node-heading">
                  <span className="node-icon" aria-hidden="true" />
                  <div>
                    <h2>{nodeNames[node.type]}</h2>
                    <p className="mono">{node.type}</p>
                  </div>
                </div>
                {node.type === "process.agent" ? (
                  <dl className="node-facts">
                    <div><dt>Provider binding</dt><dd>{binding}</dd></div>
                    <div><dt>Agent version</dt><dd>{agentVersion}</dd></div>
                    <div><dt>Configured model</dt><dd>{configured ?? "Unavailable"}</dd></div>
                    {runNode ? <div><dt>Effective model</dt><dd>{effective ?? "Awaiting dispatch"}</dd></div> : null}
                  </dl>
                ) : null}
                {runNode ? (
                  <div className="node-status">
                    <span>{titleCase(runNode.status)}</span>
                  </div>
                ) : (
                  <div className="node-status neutral"><span>Configured</span></div>
                )}
              </article>
              {index < nodes.length - 1 ? <span className="connector" aria-hidden="true" /> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
