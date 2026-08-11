import { useEffect, useRef } from 'react';

import { NodePanelRenderProps as NodePanelRenderPropsDefault } from '@flowgram.ai/free-node-panel-plugin';
import { WorkflowPortEntity } from '@flowgram.ai/free-layout-editor';

import { NodePlaceholder } from './node-placeholder';
import { NodeList } from './node-list';

interface NodePanelRenderProps extends NodePanelRenderPropsDefault {
  panelProps?: {
    fromPort?: WorkflowPortEntity;
    enableNodePlaceholder?: boolean;
  };
}

export const NodePanel: React.FC<NodePanelRenderProps> = (props) => {
  const { onSelect, position, onClose, containerNode, panelProps = {} } = props;
  const { enableNodePlaceholder, fromPort } = panelProps;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const handleScroll = () => onClose();
    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute z-40"
      style={{ top: position.y, left: position.x }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {enableNodePlaceholder && <NodePlaceholder />}
      <div className="mt-2 w-64 rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-xl">
        <div className="flex items-center justify-between px-2 pb-2">
          <span className="text-xs font-semibold">Add node</span>
          <button
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={onClose}
            aria-label="Close node library"
          >
            ×
          </button>
        </div>
        <NodeList onSelect={onSelect} containerNode={containerNode} fromPort={fromPort} />
      </div>
    </div>
  );
};
