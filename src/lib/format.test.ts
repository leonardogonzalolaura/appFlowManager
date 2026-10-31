import { describe, expect, it } from 'vitest';
import { formatBytes, gitVersionLabel, shortSha, truncateMiddle, withAlpha } from './format';

describe('formatBytes', () => {
  it('muestra unidades legibles', () => {
    expect(formatBytes(0)).toBe('0 KB');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB');
  });
});

describe('gitVersionLabel', () => {
  it('quita el prefijo redundante de git', () => {
    expect(gitVersionLabel('git version 2.45.1.windows.1')).toBe(
      '2.45.1.windows.1',
    );
    expect(gitVersionLabel('Git version 2.40.0')).toBe('2.40.0');
    expect(gitVersionLabel(null)).toBe('No disponible');
  });
});

describe('truncateMiddle', () => {
  it('conserva inicio y final de rutas largas', () => {
    const result = truncateMiddle('C:\\Users\\leonardo\\AppData\\Roaming', 18);
    expect(result.length).toBeLessThanOrEqual(18);
    expect(result.startsWith('C:\\Users')).toBe(true);
    expect(result.endsWith('g')).toBe(true);
  });

  it('no toca textos cortos', () => {
    expect(truncateMiddle('C:\\data', 20)).toBe('C:\\data');
  });
});

describe('shortSha', () => {
  it('recorta el SHA y maneja valores vacíos', () => {
    expect(shortSha('abcdef1234567890', 7)).toBe('abcdef1');
    expect(shortSha(null)).toBe('—');
  });
});

describe('withAlpha', () => {
  it('convierte un color hex a rgba', () => {
    expect(withAlpha('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
    expect(withAlpha('#6aa8ff', 0.12)).toBe('rgba(106, 168, 255, 0.12)');
    expect(withAlpha('invalid', 0.3)).toContain('rgba(124, 140, 255');
  });
});
