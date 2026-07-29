import {
  regressionSuiteDefinitionSchema,
  regressionTaskDefinitionSchema,
} from '../../src/schemas/suite-v2.schema.js';
import { defaultConfig } from '../../src/schemas/config.schema.js';
import { loadRegressionSuite } from '../../src/regression/suite-loader.js';

describe('regression loader non-Error normalization', () => {
  it('normalizes non-Error suite and task schema failures', async () => {
    const suiteFile = 'examples/regression/suite.yaml';
    const suiteParse = jest
      .spyOn(regressionSuiteDefinitionSchema, 'parse')
      .mockImplementationOnce(() => {
        throw 'suite parse';
      });
    await expect(
      loadRegressionSuite(suiteFile, { ...defaultConfig })
    ).rejects.toThrow('suite parse');
    suiteParse.mockRestore();

    const taskParse = jest
      .spyOn(regressionTaskDefinitionSchema, 'parse')
      .mockImplementationOnce(() => {
        throw 'task parse';
      });
    try {
      await expect(
        loadRegressionSuite(suiteFile, { ...defaultConfig })
      ).rejects.toThrow('task parse');
    } finally {
      taskParse.mockRestore();
    }
  });

  it('loads with the default global configuration', async () => {
    await expect(
      loadRegressionSuite('examples/regression/suite.yaml')
    ).resolves.toBeDefined();
  });
});
