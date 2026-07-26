/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useService, WorkflowSelectService } from '@flowgram.ai/free-layout-editor';
import { IconButton, Spin, Typography, Avatar, Tooltip } from '@douyinfe/semi-ui';
import { IconUploadError, IconClose } from '@douyinfe/semi-icons';

import { useProblemPanel, useNodeFormPanel } from '../../plugins/panel-manager-plugin/hooks';
import { useWatchValidate } from './use-watch-validate';

export const ProblemPanel = () => {
  const { results, loading } = useWatchValidate();

  const selectService = useService(WorkflowSelectService);

  const { close: closePanel } = useProblemPanel();
  const { open: openNodeFormPanel } = useNodeFormPanel();

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        borderRadius: 'var(--app-radius-md)',
        background: 'var(--app-color-surface)',
        border: '1px solid var(--app-color-border)',
      }}
    >
      <div
        style={{
          display: 'flex',
          height: '50px',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 var(--app-space-3)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            columnGap: 'var(--app-space-1)',
            height: '100%',
          }}
        >
          <Typography.Text strong>Problem</Typography.Text>
          {loading && <Spin size="small" style={{ lineHeight: '0' }} />}
        </div>
        <IconButton
          type="tertiary"
          theme="borderless"
          icon={<IconClose />}
          onClick={() => closePanel()}
        />
      </div>
      <div
        style={{
          padding: 'var(--app-space-3)',
          display: 'flex',
          flexDirection: 'column',
          rowGap: 'var(--app-space-1)',
        }}
      >
        {results.map((i) => (
          <div
            key={i.node.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              border: '1px solid var(--app-color-border)',
              borderRadius: 'var(--app-radius-sm)',
              padding: '0 var(--app-space-1)',
              cursor: 'pointer',
            }}
            onClick={() => {
              selectService.selectNodeAndScrollToView(i.node);
              openNodeFormPanel({ nodeId: i.node.id });
            }}
          >
            <Avatar
              style={{ flexShrink: '0' }}
              src={i.node.getNodeRegistry().info.icon}
              size="24px"
              shape="square"
            />
            <div style={{ marginLeft: 'var(--app-space-2)' }}>
              <Typography.Text>{i.node.form?.values.title}</Typography.Text>
              <br />
              <Typography.Text type="danger">
                {i.feedbacks.map((i) => i.feedbackText).join(', ')}
              </Typography.Text>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export const ProblemButton = () => {
  const { open } = useProblemPanel();
  return (
    <Tooltip content="Problem">
      <IconButton
        type="tertiary"
        theme="borderless"
        icon={<IconUploadError />}
        onClick={() => open()}
      />
    </Tooltip>
  );
};
