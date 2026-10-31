import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

interface ToastOptions {
  title?: string;
  description?: string;
  duration?: number;
}

interface ToastRecord extends ToastOptions {
  id: number;
  tone: ToastTone;
  message: string;
}

type Listener = (toast: Omit<ToastRecord, 'id'>) => void;

const listeners = new Set<Listener>();
let nextId = 1;

function emit(tone: ToastTone, message: string, options: ToastOptions = {}) {
  listeners.forEach((listener) => listener({ tone, message, ...options }));
}

export const toast = {
  success: (message: string, options?: ToastOptions) =>
    emit('success', message, options),
  error: (message: string, options?: ToastOptions) =>
    emit('error', message, options),
  warning: (message: string, options?: ToastOptions) =>
    emit('warning', message, options),
  info: (message: string, options?: ToastOptions) =>
    emit('info', message, options),
};

const toneIcon = {
  success: 'check',
  error: 'alert',
  warning: 'alert',
  info: 'info',
} as const;

export function ToastViewport() {
  const [items, setItems] = useState<ToastRecord[]>([]);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const listener: Listener = (payload) => {
      const id = nextId++;
      const record: ToastRecord = {
        id,
        ...payload,
        duration: payload.duration ?? 4800,
      };
      setItems((current) => [...current.slice(-3), record]);

      const timer = window.setTimeout(() => {
        setItems((current) => current.filter((item) => item.id !== id));
      }, record.duration);
      timers.current.push(timer);
    };

    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      timers.current.forEach((timer) => window.clearTimeout(timer));
      timers.current = [];
    };
  }, []);

  function dismiss(id: number) {
    setItems((current) => current.filter((item) => item.id !== id));
  }

  return (
    <div className="toast-viewport" aria-label="Notificaciones">
      {items.map((item) => (
        <div
          key={item.id}
          className={`toast toast-${item.tone}`}
          role={item.tone === 'error' ? 'alert' : 'status'}
          aria-live={item.tone === 'error' ? 'assertive' : 'polite'}
        >
          <span className="toast-icon">
            <Icon name={toneIcon[item.tone]} size={17} />
          </span>
          <div className="toast-content">
            {item.title ? <p className="toast-title">{item.title}</p> : null}
            <p className="toast-message">{item.message}</p>
            {item.description ? (
              <p className="toast-description">{item.description}</p>
            ) : null}
          </div>
          <button
            type="button"
            className="toast-close"
            aria-label="Cerrar notificación"
            onClick={() => dismiss(item.id)}
          >
            <Icon name="x" size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
