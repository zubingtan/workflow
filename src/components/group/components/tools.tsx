import { FC } from 'react';

import { GripVertical } from 'lucide-react';

import { GroupTitle } from './title';
import { GroupColor } from './color';

export const GroupTools: FC = () => (
  <div className="workflow-group-tools">
    <GripVertical className="workflow-group-tools-drag" />
    <GroupTitle />
    <GroupColor />
  </div>
);
