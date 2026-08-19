import { stableHash } from '../experiments/identity.js';

export interface FixtureSnapshotCandidate {
  templateBuildId?: string;
  sourceCommit: string;
  testConfigHash: string;
  cacheableSetupConfigHash: string;
  runnerProtocolVersion: string;
  allSetupStepsCacheable: boolean;
  targetSecretExposed: boolean;
  sourceOrSetupCredentialExposed: boolean;
  residualProcessCount: number;
}

export interface FixtureSnapshotEligibility {
  eligible: boolean;
  cacheKey?: string;
  reasons: string[];
}

/**
 * Computes a snapshot cache identity only when secret-free, deterministic
 * setup and process cleanup can be proven.
 */
export function evaluateFixtureSnapshotEligibility(
  candidate: FixtureSnapshotCandidate
): FixtureSnapshotEligibility {
  const reasons: string[] = [];
  if (candidate.templateBuildId === undefined) {
    reasons.push('The resolved template build is not immutable');
  }
  if (!candidate.allSetupStepsCacheable) {
    reasons.push('At least one setup step is not explicitly cacheable');
  }
  if (candidate.targetSecretExposed) {
    reasons.push('A target secret has already been exposed');
  }
  if (candidate.sourceOrSetupCredentialExposed) {
    reasons.push('A source or setup credential has already been exposed');
  }
  if (candidate.residualProcessCount !== 0) {
    reasons.push('A setup process is still running');
  }
  if (reasons.length > 0 || candidate.templateBuildId === undefined) {
    return { eligible: false, reasons };
  }

  return {
    eligible: true,
    cacheKey: stableHash({
      template_build_id: candidate.templateBuildId,
      source_commit: candidate.sourceCommit,
      test_config_hash: candidate.testConfigHash,
      cacheable_setup_config_hash: candidate.cacheableSetupConfigHash,
      runner_protocol_version: candidate.runnerProtocolVersion,
    }),
    reasons: [],
  };
}
