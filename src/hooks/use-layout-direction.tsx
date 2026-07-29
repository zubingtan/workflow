/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from 'react';

import { LayoutDirection } from '../utils/rotate-ports';

/**
 * #190: editor-layer React Context that owns the canvas layout direction
 * state. Lifted out of the toolbar `useState` so that:
 *  - the toolbar toggle reads/writes it,
 *  - the `AutoLayout` button reads it (for `rankdir`),
 *  - the `useEditorProps.onInit` ADD_NODE listener reads it (via the ref
 *    mirror) to rotate newly-added nodes' ports,
 *  - the `document.onLoaded` callback reads it to decide whether to
 *    batch-rotate ports after loading a vertical workflow.
 *
 * `directionRef` is a stable `useRef` mirror of `direction`, so closures
 * captured once at editor init (e.g. the `onContentChange` listener
 * registered in `onInit`) always read the latest value without needing to
 * re-register the listener on every toggle. The same ref is shared with
 * `app.tsx` (via the `externalRef` prop) so `saveWorkflow` can include the
 * current direction in the persisted workflow JSON.
 */
interface LayoutDirectionContextValue {
  direction: LayoutDirection;
  directionRef: RefObject<LayoutDirection>;
  setDirection: (direction: LayoutDirection) => void;
}

const LayoutDirectionContext = createContext<LayoutDirectionContextValue | null>(null);

export const LayoutDirectionProvider = ({
  initialDirection,
  externalRef,
  children,
}: {
  initialDirection: LayoutDirection;
  /**
   * Optional ref owned by `app.tsx` (alongside `ctxRef`) that mirrors the
   * current direction so `saveWorkflow` can persist it. When provided, the
   * provider writes to it on every change; when omitted, the provider uses
   * an internal ref.
   */
  externalRef?: MutableRefObject<LayoutDirection>;
  children: ReactNode;
}) => {
  const internalRef = useRef<LayoutDirection>(initialDirection);
  const directionRef = externalRef ?? internalRef;
  // Sync the ref to the initial value once on mount. This covers the
  // external-ref path where app.tsx created the ref with a default 'LR'
  // before the loaded workflow's direction was known. Subsequent toggles
  // update the ref via `setDirection`; we must NOT overwrite it on every
  // render or the latest toggle would be lost. The dependency array is
  // intentionally [initialDirection] only: the Editor is fully
  // unmounted/remounted when switching workflows, so this effect re-runs
  // with the fresh loaded direction each time.
  useEffect(() => {
    directionRef.current = initialDirection;
  }, [initialDirection, directionRef]);
  const [direction, setDirectionState] = useState<LayoutDirection>(initialDirection);
  const value = useMemo<LayoutDirectionContextValue>(
    () => ({
      direction,
      directionRef,
      setDirection: (next: LayoutDirection) => {
        directionRef.current = next;
        setDirectionState(next);
      },
    }),
    [direction, directionRef]
  );
  return (
    <LayoutDirectionContext.Provider value={value}>{children}</LayoutDirectionContext.Provider>
  );
};

export function useLayoutDirection(): LayoutDirectionContextValue {
  const ctx = useContext(LayoutDirectionContext);
  if (!ctx) {
    throw new Error('useLayoutDirection must be used within a LayoutDirectionProvider');
  }
  return ctx;
}
