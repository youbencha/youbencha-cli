import { createHash } from 'crypto';
import { E2BSdkClient, type E2BSandboxMetadata } from '../../src/e2b/index.js';

const live = process.env.E2B_LIVE_TESTS === '1';
const describeLive = live ? describe : describe.skip;

describeLive('E2B live secured sandbox smoke', () => {
  jest.setTimeout(120_000);

  test('creates, verifies, and kills one network-denied sandbox', async () => {
    const templateId = process.env.E2B_LIVE_TEMPLATE_ID;
    if (!process.env.E2B_API_KEY || !templateId) {
      throw new Error(
        'E2B_LIVE_TESTS requires E2B_API_KEY and E2B_LIVE_TEMPLATE_ID'
      );
    }
    const identity = {
      owner: 'youbencha-live-test',
      project: 'youbencha-cli',
      experimentId: `live-${Date.now()}`,
      cellId: 'a'.repeat(64),
      attemptId: 'attempt-1',
      targetId: 'no-agent',
    };
    const metadata: E2BSandboxMetadata = {
      ...identity,
      ownershipNonceHash: createHash('sha256')
        .update(JSON.stringify(identity))
        .digest('hex'),
    };
    const client = new E2BSdkClient({
      apiKey: process.env.E2B_API_KEY,
    });
    let sandboxId: string | undefined;
    try {
      const sandbox = await client.createSandbox({
        templateId,
        timeoutMs: 90_000,
        secureAccess: true,
        network: { inbound: 'none', outbound: 'none' },
        metadata,
      });
      sandboxId = sandbox.sandboxId;
      const info = await sandbox.getInfo();
      expect(info.secureAccess).toBe(true);
      expect(info.network).toEqual({
        inbound: 'none',
        outbound: 'none',
      });
      expect(info.metadata).toMatchObject(identity);
    } finally {
      if (sandboxId !== undefined) {
        await client.killSandbox(sandboxId);
      }
    }
  });
});
