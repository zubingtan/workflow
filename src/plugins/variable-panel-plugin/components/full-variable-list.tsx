/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { Tree } from '@douyinfe/semi-ui';

import { useVariableTree } from '@/form-semantics/legacy-adapter';

export function FullVariableList() {
  const treeData = useVariableTree({});

  return <Tree treeData={treeData} />;
}
