import { mapWithConcurrency } from '../../src/lib/concurrency.js';

describe('mapWithConcurrency', () => {
  it('enforces the concurrency limit and preserves result order', async () => {
    let active = 0;
    let peak = 0;

    const results = await mapWithConcurrency(
      [40, 5, 20, 10],
      2,
      async (value) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, value));
        active -= 1;
        return value * 2;
      }
    );

    expect(peak).toBe(2);
    expect(results).toEqual([80, 10, 40, 20]);
  });

  it('rejects invalid limits', async () => {
    await expect(
      mapWithConcurrency([1], 0, async (value) => value)
    ).rejects.toThrow('positive integer');
  });
});
