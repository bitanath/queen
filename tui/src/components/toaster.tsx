/* @jsxImportSource @opentui/react */
// Toast host. Wrap the app once and call `useToast()` from anywhere to show a
// message. Only one toast is active at a time; a new call replaces it and resets
// the timer (via the remount key). Rendered as a small absolute box pinned to
// the top-right with a zIndex above the modal layer, so it sits above everything
// without blocking mouse hit-testing (and therefore drag-select) underneath.
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

import { Toast, type ToastVariant } from "./toast";

export interface ToastOptions {
  variant?: ToastVariant;
  duration?: number;
  icon?: string;
}

type ToastItem = ToastOptions & { id: number; message: string };
type ShowToast = (message: string, options?: ToastOptions) => void;

const ToastContext = createContext<ShowToast>(() => {});

export const useToast = (): ShowToast => useContext(ToastContext);

export function Toaster({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const nextId = useRef(0);

  const show = useCallback<ShowToast>((message, options) => {
    nextId.current += 1;
    setToast({ id: nextId.current, message, ...options });
  }, []);

  const dismiss = useCallback(() => setToast(null), []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <box position="absolute" top={1} right={2} zIndex={1000}>
          <Toast
            key={toast.id}
            message={toast.message}
            variant={toast.variant}
            duration={toast.duration}
            icon={toast.icon}
            onDismiss={dismiss}
          />
        </box>
      )}
    </ToastContext.Provider>
  );
}
