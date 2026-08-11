import { useState } from 'react';

import { Minus, Variable } from 'lucide-react';

import { Button } from '@/components/ui';

import iconVariable from '../../../assets/icon-variable.png';
import { GlobalVariableEditor } from './global-variable-editor';
import { FullVariableList } from './full-variable-list';

export function VariablePanel() {
  const [isOpen, setOpen] = useState(false);
  const [tab, setTab] = useState<'variables' | 'global'>('variables');
  return (
    <div className="relative">
      <Button
        className={isOpen ? 'rounded-lg' : 'rounded-full'}
        variant={isOpen ? 'outline' : 'secondary'}
        size="icon-lg"
        aria-label="Toggle Variable Panel"
        onClick={() => setOpen((value) => !value)}
      >
        {isOpen ? <Minus /> : <img src={iconVariable} width={20} height={20} alt="Variables" />}
      </Button>
      {isOpen && (
        <div className="absolute right-0 bottom-12 z-30 w-[min(500px,calc(100vw-32px))] overflow-hidden rounded-xl border border-border bg-background p-3 shadow-xl">
          <div className="mb-3 flex items-center gap-1 border-b border-border pb-2">
            <Button
              size="sm"
              variant={tab === 'variables' ? 'secondary' : 'ghost'}
              onClick={() => setTab('variables')}
            >
              <Variable /> Variable list
            </Button>
            <Button
              size="sm"
              variant={tab === 'global' ? 'secondary' : 'ghost'}
              onClick={() => setTab('global')}
            >
              Global editor
            </Button>
          </div>
          <div className="max-h-[500px] overflow-auto">
            {tab === 'variables' ? <FullVariableList /> : <GlobalVariableEditor />}
          </div>
        </div>
      )}
    </div>
  );
}
