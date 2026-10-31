import { open } from '@tauri-apps/plugin-dialog';
import { isTauri } from './api';

/** Abre el selector nativo de carpetas. En la vista web devuelve null. */
export async function pickDirectory(title: string): Promise<string | null> {
  if (!isTauri()) return null;
  const selected = await open({
    directory: true,
    multiple: false,
    title,
  });
  return typeof selected === 'string' ? selected : null;
}
