import { describe, it, expect } from 'vitest';
import { parseYouTube, embedUrl } from './YouTube.jsx';

describe('links de YouTube', () => {
  it('reconoce los formatos comunes', () => {
    expect(parseYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({ video: 'dQw4w9WgXcQ', list: undefined });
    expect(parseYouTube('https://youtu.be/dQw4w9WgXcQ?t=10')).toMatchObject({ video: 'dQw4w9WgXcQ' });
    expect(parseYouTube('youtube.com/shorts/dQw4w9WgXcQ')).toMatchObject({ video: 'dQw4w9WgXcQ' });
    expect(parseYouTube('https://www.youtube.com/playlist?list=PL1234567890abcdef')).toEqual({ video: undefined, list: 'PL1234567890abcdef' });
    expect(parseYouTube('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
  });
  it('arma la URL del reproductor', () => {
    expect(embedUrl({ list: 'PLx' })).toMatch(/^https:\/\/www\.youtube\.com\/embed\/videoseries\?.*list=PLx/);
    expect(embedUrl({ video: 'dQw4w9WgXcQ' })).toMatch(/embed\/dQw4w9WgXcQ\?autoplay=1/);
  });
});
