/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useVariableTree } from '@/form-semantics';

export function FullVariableList() {
  const treeData = useVariableTree();

  if (!treeData.length)
    return <div className="text-xs text-muted-foreground">No variables available yet.</div>;
  return <pre className="text-xs">{JSON.stringify(treeData, null, 2)}</pre>;
}
