import type { ResultsBundle } from '../schemas/result.schema.js';
import type { TestCaseConfig } from '../schemas/testcase.schema.js';
import type { YouBenchaLog } from '../schemas/youbenchalog.schema.js';
import { identitySafeValue } from './identity.js';

export interface CellProvenanceInput {
  cellId: string;
  testcaseId: string;
  configHash: string;
  config: TestCaseConfig;
  result: ResultsBundle;
  log?: YouBenchaLog;
}

export interface NormalizedCellProvenance {
  cell_id: string;
  testcase_id: string;
  config_hash: string;
  source_commit_sha?: string;
  agent_type: string;
  agent_cli_version?: string;
  requested_model?: string;
  resolved_model?: string;
  youbencha_version: string;
  effective_config: unknown;
}

export interface NormalizedExperimentProvenance {
  sources: Array<{
    testcase_id: string;
    config_hash: string;
    commit_sha?: string;
  }>;
  provenance: {
    youbencha_version: string;
    agent_cli_versions: Record<string, string>;
    requested_models: Record<string, string | undefined>;
    resolved_models: Record<string, string | undefined>;
    youbencha_versions: Record<string, string>;
    cells: NormalizedCellProvenance[];
  };
  cells: NormalizedCellProvenance[];
  warnings: string[];
}

function safeOptional(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  const normalized = identitySafeValue(value);
  return typeof normalized === 'string' ? normalized : undefined;
}

function redactUrlCredentials(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactUrlCredentials);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        redactUrlCredentials(item),
      ])
    );
  }
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) {
    return value;
  }
  try {
    const url = new URL(value);
    if (url.username !== '') url.username = '[REDACTED]';
    if (url.password !== '') url.password = '[REDACTED]';
    for (const key of [...url.searchParams.keys()]) {
      if (/token|secret|password|key/i.test(key)) {
        url.searchParams.set(key, '[REDACTED]');
      }
    }
    return url.toString();
  } catch {
    return value;
  }
}

function safeConfig(config: TestCaseConfig): unknown {
  return redactUrlCredentials(identitySafeValue(config));
}

export function normalizeExperimentProvenance(
  inputs: readonly CellProvenanceInput[]
): NormalizedExperimentProvenance {
  const sorted = [...inputs].sort((left, right) =>
    left.cellId.localeCompare(right.cellId, 'en')
  );
  const cells = sorted.map((input): NormalizedCellProvenance => {
    const requestedModel = safeOptional(input.config.agent.model);
    const resolvedModel = safeOptional(input.log?.model.name);
    const cliVersion = safeOptional(input.log?.agent.version);
    const sourceCommit = safeOptional(input.result.test_case.commit);
    const youbenchaVersion =
      safeOptional(input.result.execution.youbencha_version) ?? 'unknown';
    return {
      cell_id: input.cellId,
      testcase_id: input.testcaseId,
      config_hash: input.configHash,
      ...(sourceCommit === undefined
        ? {}
        : { source_commit_sha: sourceCommit }),
      agent_type: input.config.agent.type,
      ...(cliVersion === undefined ? {} : { agent_cli_version: cliVersion }),
      ...(requestedModel === undefined
        ? {}
        : { requested_model: requestedModel }),
      ...(resolvedModel === undefined ? {} : { resolved_model: resolvedModel }),
      youbencha_version: youbenchaVersion,
      effective_config: safeConfig(input.config),
    };
  });
  const sourcesByIdentity = new Map<
    string,
    { testcase_id: string; config_hash: string; commit_sha?: string }
  >();
  for (const cell of cells) {
    const candidate = {
      testcase_id: cell.testcase_id,
      config_hash: cell.config_hash,
      ...(cell.source_commit_sha === undefined
        ? {}
        : { commit_sha: cell.source_commit_sha }),
    };
    const key = `${candidate.testcase_id}\u0000${candidate.config_hash}\u0000${candidate.commit_sha ?? ''}`;
    sourcesByIdentity.set(key, candidate);
  }

  const agentCliVersions: Record<string, string> = {};
  const requestedModels: Record<string, string | undefined> = {};
  const resolvedModels: Record<string, string | undefined> = {};
  const youbenchaVersions: Record<string, string> = {};
  for (const cell of cells) {
    if (cell.agent_cli_version !== undefined) {
      agentCliVersions[cell.cell_id] = cell.agent_cli_version;
    }
    requestedModels[cell.cell_id] = cell.requested_model;
    resolvedModels[cell.cell_id] = cell.resolved_model;
    youbenchaVersions[cell.cell_id] = cell.youbencha_version;
  }
  const warnings = cells.flatMap((cell) => {
    const missing: string[] = [];
    if (cell.agent_cli_version === undefined) missing.push('agent CLI version');
    if (cell.resolved_model === undefined) missing.push('resolved model');
    return missing.length === 0
      ? []
      : [`Cell ${cell.cell_id} is missing ${missing.join(' and ')}`];
  });

  return {
    sources: [...sourcesByIdentity.values()].sort((left, right) =>
      `${left.testcase_id}:${left.config_hash}:${left.commit_sha ?? ''}`.localeCompare(
        `${right.testcase_id}:${right.config_hash}:${right.commit_sha ?? ''}`,
        'en'
      )
    ),
    provenance: {
      youbencha_version:
        new Set(Object.values(youbenchaVersions)).size > 1
          ? 'mixed'
          : (Object.values(youbenchaVersions)[0] ?? 'unknown'),
      agent_cli_versions: agentCliVersions,
      requested_models: requestedModels,
      resolved_models: resolvedModels,
      youbencha_versions: youbenchaVersions,
      cells,
    },
    cells,
    warnings,
  };
}
