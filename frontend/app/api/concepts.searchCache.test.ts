jest.mock('./base', () => ({
  API_BASE_URL: 'http://api.test',
  getApiHeaders: async () => ({ 'Content-Type': 'application/json' }),
}));

describe('searchConcepts (recent query cache)', () => {
  beforeEach(() => {
    jest.resetModules();
    global.fetch = jest.fn() as any;
    (global.fetch as jest.Mock).mockReset();
  });

  it('dedupes identical normalized queries', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ query: 'test', results: [], count: 0 }),
    });

    const { searchConcepts } = await import('./concepts');
    await searchConcepts('  test  ', 'g1', 10);
    await searchConcepts('test', 'g1', 10);

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not share cache across different graphIds', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ query: 'test', results: [], count: 0 }),
    });

    const { searchConcepts } = await import('./concepts');
    await searchConcepts('test', 'g1', 10);
    await searchConcepts('test', 'g2', 10);

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

