/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useRef, useState } from 'react';

import { Minus, Variable } from 'lucide-react';

import { Button } from '@/components/ui';

import iconVariable from '../../../assets/icon-variable.png';
import { GlobalVariableEditor } from './global-variable-editor';
import { FullVariableList } from './full-variable-list';

export function VariablePanel() {
  const [isOpen, setOpen] = useState(false);
  const [tab, setTab] = useState<'variables' | 'global'>('variables');
  const tabRefs = useRef<Record<'variables' | 'global', HTMLElement | null>>({
    variables: null,
    global: null,
  });
  const focusTab = (nextTab: 'variables' | 'global') => {
    setTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  };
  const onTabKeyDown = (event: React.KeyboardEvent, currentTab: 'variables' | 'global') => {
    if (
      event.key !== 'ArrowLeft' &&
      event.key !== 'ArrowRight' &&
      event.key !== 'Home' &&
      event.key !== 'End'
    )
      return;
    event.preventDefault();
    const nextTab =
      event.key === 'Home' || (event.key === 'ArrowLeft' && currentTab === 'global')
        ? 'variables'
        : event.key === 'End' || (event.key === 'ArrowRight' && currentTab === 'variables')
        ? 'global'
        : currentTab;
    focusTab(nextTab);
  };
  return (
    <div className="relative">
      <Button
        className="rounded-lg"
        variant={isOpen ? 'outline' : 'secondary'}
        size="icon-lg"
        aria-label="Toggle Variable Panel"
        onClick={() => setOpen((value) => !value)}
      >
        {isOpen ? <Minus /> : <img src={iconVariable} width={20} height={20} alt="Variables" />}
      </Button>
      {isOpen && (
        <div
          role="dialog"
          aria-label="Variable panel"
          className="absolute top-full right-0 z-30 mt-2 w-[min(500px,calc(100vw-32px))] overflow-hidden rounded-lg border border-border bg-background p-3 shadow-md"
        >
          <div
            className="mb-3 flex items-center gap-1 border-b border-border pb-2"
            role="tablist"
            aria-label="Variable views"
          >
            <Button
              ref={(element) => {
                tabRefs.current.variables = element;
              }}
              id="variable-panel-tab-list"
              role="tab"
              aria-selected={tab === 'variables'}
              aria-controls="variable-panel-panel-list"
              tabIndex={tab === 'variables' ? 0 : -1}
              size="sm"
              variant={tab === 'variables' ? 'secondary' : 'ghost'}
              onClick={() => setTab('variables')}
              onKeyDown={(event) => onTabKeyDown(event, 'variables')}
            >
              <Variable /> Variable list
            </Button>
            <Button
              ref={(element) => {
                tabRefs.current.global = element;
              }}
              id="variable-panel-tab-global"
              role="tab"
              aria-selected={tab === 'global'}
              aria-controls="variable-panel-panel-global"
              tabIndex={tab === 'global' ? 0 : -1}
              size="sm"
              variant={tab === 'global' ? 'secondary' : 'ghost'}
              onClick={() => setTab('global')}
              onKeyDown={(event) => onTabKeyDown(event, 'global')}
            >
              Global editor
            </Button>
          </div>
          <div
            className="max-h-[500px] overflow-auto"
            id="variable-panel-panel-list"
            role="tabpanel"
            aria-labelledby="variable-panel-tab-list"
            tabIndex={0}
            hidden={tab !== 'variables'}
          >
            <FullVariableList />
          </div>
          <div
            className="max-h-[500px] overflow-auto"
            id="variable-panel-panel-global"
            role="tabpanel"
            aria-labelledby="variable-panel-tab-global"
            tabIndex={0}
            hidden={tab !== 'global'}
          >
            <GlobalVariableEditor />
          </div>
        </div>
      )}
    </div>
  );
}
