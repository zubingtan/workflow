import { useEffect, useState, type FC } from 'react';

import { Download } from 'lucide-react';
import { usePlayground, useService } from '@flowgram.ai/free-layout-editor';
import { FlowDownloadFormat, FlowDownloadService } from '@flowgram.ai/export-plugin';

import { Button } from '@/components/ui';

const formatOptions = [
  FlowDownloadFormat.PNG,
  FlowDownloadFormat.JPEG,
  FlowDownloadFormat.SVG,
  FlowDownloadFormat.JSON,
  FlowDownloadFormat.YAML,
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
    <div className="relative">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Download"
        disabled={downloading}
        onClick={() => setVisible((value) => !value)}
      >
        <Download />
      </Button>
      {visible && (
        <div className="absolute bottom-full left-0 z-50 mb-1 flex w-28 flex-col rounded-lg border border-border bg-popover p-1 shadow-xl">
          {formatOptions.map((format) => (
            <Button
              key={format}
              size="sm"
              variant="ghost"
              className="justify-start"
              disabled={playground.config.readonly || downloading}
              onClick={async () => {
                setVisible(false);
                await downloadService.download({ format });
              }}
            >
              {format}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
};
