/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState, type FC } from 'react';

import { Download } from 'lucide-react';
import { usePlayground, useService } from '@flowgram.ai/free-layout-editor';
import { FlowDownloadFormat, FlowDownloadService } from '@flowgram.ai/export-plugin';

import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Toast } from '@/components/ui/management';
import { Button } from '@/components/ui';

import { ToolbarTooltip } from './toolbar-tooltip';

const formatOptions = [
  { label: 'PNG', value: FlowDownloadFormat.PNG },
  { label: 'JPEG', value: FlowDownloadFormat.JPEG },
  { label: 'SVG', value: FlowDownloadFormat.SVG },
  { label: 'JSON', value: FlowDownloadFormat.JSON },
  { label: 'YAML', value: FlowDownloadFormat.YAML },
];

export const DownloadTool: FC = () => {
  const [downloading, setDownloading] = useState(false);
  const [visible, setVisible] = useState(false);
  const playground = usePlayground();
  const downloadService = useService(FlowDownloadService);
  useEffect(() => {
    const subscription = downloadService.onDownloadingChange(setDownloading);
    return () => subscription.dispose();
  }, [downloadService]);
  return (
    <Popover open={visible} onOpenChange={setVisible} modal={false}>
      <ToolbarTooltip label="Download workflow">
        <PopoverTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label="Download" disabled={downloading}>
              <Download />
            </Button>
          }
        />
      </ToolbarTooltip>
      <PopoverContent side="top" align="start" className="w-28 p-1">
        <PopoverTitle className="sr-only">Download workflow</PopoverTitle>
        <div className="flex flex-col">
          {formatOptions.map(({ label, value }) => (
            <Button
              key={value}
              size="sm"
              variant="ghost"
              className="justify-start"
              disabled={playground.config.readonly || downloading}
              onClick={async () => {
                setVisible(false);
                await downloadService.download({ format: value });
                Toast.success(`Download ${label} successfully`);
              }}
            >
              {label}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};
