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

/** Selector nativo de archivos para importar el export de Monday. */
export async function pickImportFile(): Promise<string | null> {
  if (!isTauri()) return null;
  const selected = await open({
    multiple: false,
    directory: false,
    title: 'Selecciona el export de Monday',
    filters: [
      { name: 'Excel o CSV', extensions: ['xlsx', 'xls', 'xlsm', 'csv'] },
      { name: 'Excel', extensions: ['xlsx', 'xls', 'xlsm'] },
      { name: 'CSV', extensions: ['csv'] },
    ],
  });
  return typeof selected === 'string' ? selected : null;
}
