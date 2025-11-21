# Post-Evaluation: Exporting and Analyzing youBencha Results

## Overview

Post-evaluations are optional pipeline steps that run after evaluation completes, enabling you to:
- Export results to external systems (databases, APIs, webhooks)
- Run custom analysis scripts
- Aggregate results across multiple test runs
- Track metrics over time
- Trigger downstream workflows

## Value Propositions

### Single Result Analysis
**For AI Engineers evaluating one test run:**
- **Immediate Feedback**: Did the agent succeed? What changed?
- **Debugging Context**: Access to full diff, agent logs, and evaluator metrics
- **Quality Metrics**: Quantitative measures (lines changed, similarity scores, AI judge scores)
- **Cost Tracking**: Token usage and execution time per run

**Use Cases:**
- Quick validation during prompt engineering
- Debugging agent failures
- Reviewing specific code changes

### Suite of Results
**For teams running multiple test cases:**
- **Cross-Test Comparison**: Which tasks are hardest? Which prompts work best?
- **Pattern Recognition**: Common failure modes across different scenarios
- **Aggregate Metrics**: Overall pass rate, average similarity, total cost
- **Capability Assessment**: Understanding agent strengths and weaknesses

**Use Cases:**
- Agent capability assessment
- Choosing between different agent configurations
- Identifying test cases that need refinement

### Results Over Time
**For organizations tracking agent performance:**
- **Regression Detection**: Did the latest model/prompt change break anything?
- **Trend Analysis**: Is agent quality improving or degrading over time?
- **Cost Optimization**: Track spending trends and ROI
- **Performance Benchmarking**: Compare agent versions, models, or configurations
- **Long-term Planning**: Data-driven decisions about tooling and processes

**Use Cases:**
- CI/CD regression testing
- Monthly/quarterly performance reviews
- Vendor comparison and selection
- Budget forecasting and cost optimization

## Post-Evaluator Types

### 1. Webhook Post-Evaluator
Posts results to an HTTP endpoint for real-time processing.

**Use Cases:**
- Notify Slack/Teams channels of evaluation results
- Trigger CI/CD pipelines based on outcomes
- Update project management systems
- Send alerts for failures or regressions

**Configuration:**
```yaml
post_evaluators:
  - name: webhook
    config:
      url: https://api.example.com/youbencha/results
      method: POST
      headers:
        Authorization: "Bearer ${WEBHOOK_TOKEN}"
        Content-Type: "application/json"
      include_artifacts: false  # Don't upload full artifacts, just results.json
      retry_on_failure: true
      timeout_ms: 5000
```

### 2. Database Post-Evaluator
Stores results in a structured database for historical analysis.

**Use Cases:**
- Build a results repository for trend analysis
- Enable SQL queries across test runs
- Create dashboards and reports
- Track metrics over time

**Configuration:**
```yaml
post_evaluators:
  - name: database
    config:
      type: json-file  # MVP: append to JSON file
      output_path: ./results-history.jsonl  # JSONL format for time-series
      include_full_bundle: true
      
  # Future: Direct database connections
  # - name: database
  #   config:
  #     type: postgresql
  #     connection_string: "${DATABASE_URL}"
  #     table: youbencha_results
```

### 3. Custom Script Post-Evaluator
Runs user-provided scripts with access to results.

**Use Cases:**
- Custom analysis pipelines
- Integration with proprietary systems
- Complex post-processing logic
- Generate custom reports

**Configuration:**
```yaml
post_evaluators:
  - name: script
    config:
      command: ./scripts/analyze-results.sh
      args:
        - "--results"
        - "${RESULTS_PATH}"
        - "--workspace"
        - "${WORKSPACE_DIR}"
      env:
        SLACK_WEBHOOK: "${SLACK_WEBHOOK_URL}"
      timeout_ms: 30000
      working_dir: .
```

## Design Principles

1. **Optional and Non-Blocking**: Post-evaluations never fail the main evaluation
2. **Isolated Execution**: Errors in one post-evaluation don't affect others
3. **Immutable Results**: Post-evaluations receive read-only access to results
4. **Parallel Execution**: Multiple post-evaluations run concurrently
5. **Secure by Default**: No credentials stored in configs, use environment variables

## Implementation Architecture

### Post-Evaluator Interface
```typescript
interface PostEvaluation {
  readonly name: string;
  readonly description: string;
  
  // Check if post-evaluation can run (API keys present, tools installed, etc.)
  checkPreconditions(context: PostEvaluationContext): Promise<boolean>;
  
  // Execute the post-evaluation action
  execute(context: PostEvaluationContext): Promise<PostEvaluationResult>;
}
```

### Post-Evaluation Context
```typescript
interface PostEvaluationContext {
  resultsBundle: ResultsBundle;          // Complete evaluation results
  resultsBundlePath: string;             // Path to results.json
  artifactsDir: string;                  // Path to artifacts directory
  workspaceDir: string;                  // Path to workspace root
  config: Record<string, unknown>;       // Post-evaluation specific config
}
```

### Post-Evaluation Result
```typescript
interface PostEvaluationResult {
  post_evaluator: string;                // Name of post-evaluation
  status: 'success' | 'failed' | 'skipped';
  message: string;                       // Human-readable result
  duration_ms: number;
  timestamp: string;
  metadata: Record<string, unknown>;     // Post-evaluation specific data
  error?: {
    message: string;
    stack_trace?: string;
  };
}
```

## Security Considerations

1. **Credentials Management**: Use environment variables, never hardcode secrets
2. **Path Validation**: Prevent path traversal in file operations
3. **Command Injection**: Validate and sanitize script arguments
4. **Rate Limiting**: Respect API rate limits for webhooks
5. **Data Privacy**: Option to exclude sensitive data from exports

## Future Enhancements

- **Result Repository Service**: Hosted service for storing and querying results
- **Web Dashboard**: Visualize trends and compare results
- **Notification Templates**: Pre-built integrations for common services
- **Result Aggregation**: Built-in time-series analysis and reporting
- **Export Formats**: CSV, Parquet, or other analytics-friendly formats
