/**
 * Diff Utilities
 * 
 * Provides text comparison and similarity analysis utilities.
 * Uses Myers diff algorithm and Levenshtein distance for comparisons.
 */

import { diffLines, diffWords, Change } from 'diff';

/**
 * Diff result structure
 */
export interface DiffResult {
  /** Total number of additions */
  additions: number;
  
  /** Total number of deletions */
  deletions: number;
  
  /** Total number of changes (additions + deletions) */
  changes: number;
  
  /** Similarity score (0.0 = completely different, 1.0 = identical) */
  similarity: number;
  
  /** Individual change details */
  changeDetails: Change[];
}

/**
 * Calculate Levenshtein distance between two strings
 * 
 * @param str1 - First string
 * @param str2 - Second string
 * @returns Levenshtein distance (number of edits needed)
 */
export function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;
  
  // Create a 2D array for dynamic programming
  const dp: number[][] = Array(len1 + 1)
    .fill(null)
    .map(() => Array(len2 + 1).fill(0));
  
  // Initialize first row and column
  for (let i = 0; i <= len1; i++) {
    dp[i][0] = i;
  }
  for (let j = 0; j <= len2; j++) {
    dp[0][j] = j;
  }
  
  // Fill the dp table
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,     // deletion
          dp[i][j - 1] + 1,     // insertion
          dp[i - 1][j - 1] + 1  // substitution
        );
      }
    }
  }
  
  return dp[len1][len2];
}

/**
 * Calculate similarity score between two strings
 * 
 * @param str1 - First string
 * @param str2 - Second string
 * @returns Similarity score (0.0 to 1.0)
 */
export function calculateSimilarity(str1: string, str2: string): number {
  if (str1 === str2) {
    return 1.0;
  }
  
  if (str1.length === 0 && str2.length === 0) {
    return 1.0;
  }
  
  const distance = levenshteinDistance(str1, str2);
  const maxLen = Math.max(str1.length, str2.length);
  
  return 1.0 - distance / maxLen;
}

/**
 * Compare two texts line by line using Myers diff algorithm
 * 
 * @param text1 - First text (original)
 * @param text2 - Second text (modified)
 * @returns Diff result with statistics
 */
export function compareLines(text1: string, text2: string): DiffResult {
  const changes = diffLines(text1, text2);
  
  let additions = 0;
  let deletions = 0;
  
  changes.forEach((change) => {
    if (change.added) {
      additions += change.count || 0;
    } else if (change.removed) {
      deletions += change.count || 0;
    }
  });
  
  const totalChanges = additions + deletions;
  const totalLines = text1.split('\n').length + additions;
  const similarity = totalLines > 0 ? 1.0 - totalChanges / totalLines : 1.0;
  
  return {
    additions,
    deletions,
    changes: totalChanges,
    similarity: Math.max(0, Math.min(1, similarity)),
    changeDetails: changes,
  };
}

/**
 * Compare two texts word by word
 * 
 * @param text1 - First text (original)
 * @param text2 - Second text (modified)
 * @returns Diff result with statistics
 */
export function compareWords(text1: string, text2: string): DiffResult {
  const changes = diffWords(text1, text2);
  
  let additions = 0;
  let deletions = 0;
  
  changes.forEach((change) => {
    if (change.added) {
      additions += change.count || 0;
    } else if (change.removed) {
      deletions += change.count || 0;
    }
  });
  
  const totalChanges = additions + deletions;
  const totalWords = text1.split(/\s+/).length + additions;
  const similarity = totalWords > 0 ? 1.0 - totalChanges / totalWords : 1.0;
  
  return {
    additions,
    deletions,
    changes: totalChanges,
    similarity: Math.max(0, Math.min(1, similarity)),
    changeDetails: changes,
  };
}

/**
 * Calculate change entropy (measure of change complexity)
 * 
 * Higher entropy = more scattered/complex changes
 * Lower entropy = more localized/simple changes
 * 
 * @param changes - Array of change objects from diff
 * @returns Entropy value (0.0 to 1.0)
 */
export function calculateChangeEntropy(changes: Change[]): number {
  if (changes.length === 0) {
    return 0;
  }
  
  // Calculate distribution of changes
  let changedSegments = 0;
  let unchangedSegments = 0;
  
  changes.forEach((change) => {
    if (change.added || change.removed) {
      changedSegments++;
    } else {
      unchangedSegments++;
    }
  });
  
  const total = changedSegments + unchangedSegments;
  
  if (total === 0) {
    return 0;
  }
  
  // Calculate entropy using Shannon's formula
  const pChanged = changedSegments / total;
  const pUnchanged = unchangedSegments / total;
  
  let entropy = 0;
  if (pChanged > 0) {
    entropy -= pChanged * Math.log2(pChanged);
  }
  if (pUnchanged > 0) {
    entropy -= pUnchanged * Math.log2(pUnchanged);
  }
  
  // Normalize to 0-1 range (max entropy is 1 when perfectly balanced)
  return entropy;
}

/**
 * Generate a unified diff patch string
 * 
 * @param text1 - Original text
 * @param text2 - Modified text
 * @param options - Patch generation options
 * @returns Unified diff patch string
 */
export function generatePatch(
  text1: string,
  text2: string,
  options?: {
    filename?: string;
    contextLines?: number;
  }
  ): string {
  const changes = diffLines(text1, text2);
  const filename = options?.filename || 'file';
  
  let patch = `--- ${filename}\n+++ ${filename}\n`;
  
  changes.forEach((change) => {
    const lines = change.value.split('\n');
    lines.pop(); // Remove empty last element from split
    
    if (change.added) {
      lines.forEach((line) => {
        patch += `+ ${line}\n`;
      });
    } else if (change.removed) {
      lines.forEach((line) => {
        patch += `- ${line}\n`;
      });
    } else {
      lines.forEach((line) => {
        patch += `  ${line}\n`;
      });
    }
  });
  
  return patch;
}

/**
 * Default export with all diff utilities
 */
export default {
  levenshteinDistance,
  calculateSimilarity,
  compareLines,
  compareWords,
  calculateChangeEntropy,
  generatePatch,
};
