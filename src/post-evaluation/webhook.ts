/**
 * Webhook Post-Evaluation
 * 
 * Posts evaluation results to an HTTP endpoint.
 * Useful for integrating with external systems, notifications, or dashboards.
 */

import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { PostEvaluation, PostEvaluationContext } from './base.js';
import { PostEvaluationResult, WebhookConfig } from '../schemas/post-evaluation.schema.js';
import * as logger from '../lib/logger.js';

// User-Agent version - update this when releasing new versions
const YOUBENCHA_VERSION = '0.1.0';

/**
 * Webhook Post-Evaluation implementation
 */
export class WebhookPostEvaluation implements PostEvaluation {
  readonly name = 'webhook';
  readonly description = 'Posts evaluation results to an HTTP webhook endpoint';

  /**
   * Check if webhook can be called (validates URL format)
   */
  async checkPreconditions(context: PostEvaluationContext): Promise<boolean> {
    const config = context.config as WebhookConfig;
    
    try {
      // Validate URL
      new URL(config.url);
      return true;
    } catch (error) {
      logger.warn(`Webhook URL invalid: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Execute webhook POST request
   */
  async execute(context: PostEvaluationContext): Promise<PostEvaluationResult> {
    const startTime = Date.now();
    const config = context.config as WebhookConfig;

    try {
      // Prepare payload
      const payload = config.include_artifacts
        ? {
            results: context.resultsBundle,
            artifacts_path: context.artifactsDir,
          }
        : { results: context.resultsBundle };

      // Make HTTP request with retry logic
      let lastError: Error | null = null;
      const maxRetries = config.retry_on_failure ? 3 : 1;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          await this.makeRequest(config, payload);
          
          const duration = Date.now() - startTime;
          return {
            post_evaluator: this.name,
            status: 'success',
            message: `Successfully posted results to ${config.url}`,
            duration_ms: duration,
            timestamp: new Date().toISOString(),
            metadata: {
              url: config.url,
              method: config.method,
              attempts: attempt,
            },
          };
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          
          if (attempt < maxRetries) {
            logger.warn(`Webhook attempt ${attempt} failed, retrying...`);
            await this.sleep(1000 * attempt); // Exponential backoff
          }
        }
      }

      // All retries failed
      const duration = Date.now() - startTime;
      return {
        post_evaluator: this.name,
        status: 'failed',
        message: `Failed to post results after ${maxRetries} attempts`,
        duration_ms: duration,
        timestamp: new Date().toISOString(),
        metadata: {
          url: config.url,
          attempts: maxRetries,
        },
        error: {
          message: lastError?.message || 'Unknown error',
          stack_trace: lastError?.stack,
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      return {
        post_evaluator: this.name,
        status: 'failed',
        message: 'Failed to execute webhook',
        duration_ms: duration,
        timestamp: new Date().toISOString(),
        error: {
          message: error instanceof Error ? error.message : String(error),
          stack_trace: error instanceof Error ? error.stack : undefined,
        },
      };
    }
  }

  /**
   * Make HTTP request
   */
  private async makeRequest(config: WebhookConfig, payload: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = new URL(config.url);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;

      const postData = JSON.stringify(payload);
      
      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: config.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'User-Agent': `youBencha/${YOUBENCHA_VERSION}`,
          ...(config.headers || {}),
        },
        timeout: config.timeout_ms || 5000,
      };

      const req = client.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(`Webhook returned status ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Webhook request timed out after ${config.timeout_ms}ms`));
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
