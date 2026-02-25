import { RecentQueryCache } from './recentQueryCache';

describe('RecentQueryCache', () => {
  it('caches values within TTL', async () => {
    let now = 1_000;
    const cache = new RecentQueryCache<string>({
      maxEntries: 10,
      defaultTtlMs: 100,
      now: () => now,
    });

    const fetcher = jest.fn(async () => 'value-1');

    await expect(cache.getOrCreate('k', fetcher)).resolves.toBe('value-1');
    expect(fetcher).toHaveBeenCalledTimes(1);

    now += 50;
    await expect(cache.getOrCreate('k', fetcher)).resolves.toBe('value-1');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('expires cached values after TTL', async () => {
    let now = 1_000;
    const cache = new RecentQueryCache<string>({
      maxEntries: 10,
      defaultTtlMs: 100,
      now: () => now,
    });

    const fetcher = jest.fn(async () => `value-${now}`);

    await expect(cache.getOrCreate('k', fetcher)).resolves.toBe('value-1000');
    expect(fetcher).toHaveBeenCalledTimes(1);

    now += 150;
    await expect(cache.getOrCreate('k', fetcher)).resolves.toBe('value-1150');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('dedupes in-flight fetches', async () => {
    const cache = new RecentQueryCache<string>({
      maxEntries: 10,
      defaultTtlMs: 100,
    });

    let resolve!: (v: string) => void;
    const fetcher = jest.fn(
      () =>
        new Promise<string>((r) => {
          resolve = r;
        }),
    );

    const p1 = cache.getOrCreate('k', fetcher);
    const p2 = cache.getOrCreate('k', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);

    resolve('value-1');
    await expect(p1).resolves.toBe('value-1');
    await expect(p2).resolves.toBe('value-1');
  });

  it('evicts least-recently-used entries when over capacity', () => {
    const cache = new RecentQueryCache<number>({
      maxEntries: 2,
      defaultTtlMs: 10_000,
    });

    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.size()).toBe(2);

    // Touch 'a' to make it most-recently-used.
    expect(cache.get('a')).toBe(1);

    cache.set('c', 3);
    expect(cache.size()).toBe(2);

    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
  });
});

