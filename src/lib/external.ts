import { openUrl } from '@tauri-apps/plugin-opener';
import { isTauri, normalizeError } from './api';
import { toast } from '../components/ui/Toast';

/**
 * Abre una URL externa en el navegador del sistema (o en una pestaña en modo web).
 * `app` permite forzar un navegador concreto, por ejemplo `msedge`.
 */
export async function openExternalUrl(
  url: string,
  app?: string,
): Promise<void> {
  try {
    if (isTauri()) {
      try {
        await openUrl(url, app);
      } catch (caught) {
        // No enmascarar errores de permisos: si el scope de Tauri rechaza la
        // URL, abrirla con el navegador predeterminado confunde al usuario.
        const message = normalizeError(caught).message.toLowerCase();
        if (
          !app ||
          message.includes('not allowed') ||
          message.includes('forbidden')
        ) {
          throw caught;
        }
        // Si el navegador solicitado no está disponible, usa el predeterminado.
        await openUrl(url);
      }
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  } catch (caught) {
    toast.error('No se pudo abrir el enlace', {
      description: normalizeError(caught).message,
    });
  }
}
