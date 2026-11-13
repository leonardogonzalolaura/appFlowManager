/** Construye la URL pública del ítem en Monday a partir de su Task ID. */
export function mondayItemUrl(externalKey: string, subdomain: string): string {
  const account = subdomain.trim().toLowerCase() || 'belcorp';
  return `https://${account}.monday.com/item/${encodeURIComponent(externalKey)}`;
}
