/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { ChevronDown, ChevronRight } from 'lucide-react';

import { useVariableTree } from '@/form-semantics';

type VariableTreeNode = ReturnType<typeof useVariableTree>[number];

function VariableTreeItem({ node, depth }: { node: VariableTreeNode; depth: number }) {
  const hasChildren = Boolean(node.children?.length);
  const content = (
    <>
      <span className="min-w-0 flex-1 truncate" title={node.value}>
        {node.label}
      </span>
      <code className="max-w-[60%] truncate text-xs text-muted-foreground">{node.value}</code>
    </>
  );

  if (!hasChildren) {
    return (
      <div
        className="flex min-h-7 items-center gap-1.5 rounded-md px-2 py-1 text-sm hover:bg-accent"
        role="treeitem"
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        {content}
      </div>
    );
  }

  return (
    <details open={depth === 0} role="treeitem">
      <summary
        className="flex min-h-7 cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-1 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        {depth === 0 ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
        {content}
      </summary>
      <div role="group">
        {node.children?.map((child) => (
          <VariableTreeItem key={child.key} node={child} depth={depth + 1} />
        ))}
      </div>
    </details>
  );
}

export function FullVariableList() {
  const treeData = useVariableTree();

  if (!treeData.length)
    return <div className="text-xs text-muted-foreground">No variables available yet.</div>;
  return (
    <div className="flex flex-col gap-0.5" role="tree" aria-label="Available variables">
      {treeData.map((node) => (
        <VariableTreeItem key={node.key} node={node} depth={0} />
      ))}
    </div>
  );
}
