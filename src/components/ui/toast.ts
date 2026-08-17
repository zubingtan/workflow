export type ToastKind = 'success' | 'error' | 'warning' | 'info';
export type ToastItem = { id: number; kind: ToastKind; message: string };

let nextToastId = 0;
const toastListenersKey = '__workflowToastListeners';
const toastListeners = ((
  globalThis as typeof globalThis & {
    __workflowToastListeners?: Set<(item: ToastItem) => void>;
  }
)[toastListenersKey] ??= new Set<(item: ToastItem) => void>());

function emitToast(kind: ToastKind, message: string) {
  const item = { id: ++nextToastId, kind, message } satisfies ToastItem;
  toastListeners.forEach((listener) => listener(item));
}

export const Toast = {
  success: (message: string) => emitToast('success', message),
  error: (message: string) => emitToast('error', message),
  warning: (message: string) => emitToast('warning', message),
  info: (message: string) => emitToast('info', message),
};

export function subscribeToasts(listener: (item: ToastItem) => void) {
  toastListeners.add(listener);
  return () => {
    toastListeners.delete(listener);
  };
}
