import { createContext, useContext, type ReactNode } from 'react';

const OverlayContainerContext = createContext<HTMLElement | null>(null);

export function OverlayContainerProvider({
  container,
  children,
}: {
  container: HTMLElement | null;
  children: ReactNode;
}) {
  return (
    <OverlayContainerContext.Provider value={container}>
      {children}
    </OverlayContainerContext.Provider>
  );
}

export function useOverlayContainer() {
  return useContext(OverlayContainerContext);
}
