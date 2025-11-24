
## Mermaid Diagrams

### Architecture Overview

```mermaid
graph LR
    A[Suite Config<br/>YAML/JSON] --> B[Orchestrator]
    B --> C[Workspace<br/>Manager]
    C --> D[Clone Repo<br/>src-modified/]
    C --> E[Clone Expected<br/>src-expected/]
    D --> F[Agent Adapter]
    F --> G[GitHub Copilot CLI]
    F --> H[Claude Code]
    F --> I[Other Agents]
    G --> J[youBencha Log<br/>Normalized Output]
    J --> K[Evaluators]
    E --> K
    K --> L[git-diff]
    K --> M[expected-diff]
    K --> N[agentic-judge]
    L --> O[Results Bundle<br/>JSON]
    M --> O
    N --> O
    O --> P[Reports<br/>Markdown/JSON]
    
    style A fill:#e1f5ff
    style O fill:#c8e6c9
    style P fill:#fff9c4
```

### User Flow: Basic Evaluation

```mermaid
flowchart TD
    Start([Developer wants to<br/>evaluate AI agent]) --> Create[Create suite.yaml<br/>with repo + agent + evaluators]
    Create --> Install{youBencha<br/>installed?}
    Install -->|No| InstallCmd[npm install -g youbencha]
    Install -->|Yes| Run[yb run -c suite.yaml]
    InstallCmd --> Run
    Run --> Clone[Clone repository to<br/>isolated workspace]
    Clone --> Execute[Execute agent<br/>with prompt]
    Execute --> Capture[Capture output &<br/>normalize to youBencha Log]
    Capture --> Eval[Run evaluators<br/>in parallel]
    Eval --> Results[Generate results.json<br/>with all metrics]
    Results --> Report[yb report --from results.json]
    Report --> Review[Review Markdown report<br/>with pass/fail status]
    Review --> Decision{Satisfied with<br/>agent output?}
    Decision -->|No| Iterate[Adjust prompt/model/<br/>configuration]
    Decision -->|Yes| Done([Agent evaluation<br/>complete])
    Iterate --> Run
    
    style Start fill:#e3f2fd
    style Done fill:#c8e6c9
    style Results fill:#fff9c4
```

### User Flow: Expected Reference Comparison

```mermaid
flowchart TD
    Start([Team has ideal<br/>implementation]) --> Branch[Create feature branch<br/>with ideal solution]
    Branch --> Config[Configure suite.yaml<br/>with expected_source: branch]
    Config --> Specify[Set expected: feature/ai-completed]
    Specify --> Run[yb run -c suite.yaml]
    Run --> Clone1[Clone source branch<br/>to src-modified/]
    Run --> Clone2[Clone expected branch<br/>to src-expected/]
    Clone1 --> Agent[Execute agent<br/>on source code]
    Agent --> Modify[Agent modifies<br/>src-modified/]
    Modify --> Compare[expected-diff evaluator<br/>compares directories]
    Clone2 --> Compare
    Compare --> Similarity[Calculate similarity<br/>score 0.0-1.0]
    Similarity --> Threshold{Score ≥<br/>threshold?}
    Threshold -->|Yes| Pass[✓ Evaluation PASSED<br/>Agent output similar to ideal]
    Threshold -->|No| Fail[✗ Evaluation FAILED<br/>Agent output differs from ideal]
    Pass --> Report[Generate detailed report<br/>with file-level diffs]
    Fail --> Report
    Report --> Action{Next step?}
    Action --> Iterate[Adjust agent prompt]
    Action --> Accept[Accept current output]
    Action --> Investigate[Investigate differences]
    
    style Start fill:#e3f2fd
    style Pass fill:#c8e6c9
    style Fail fill:#ffcdd2
```

### User Flow: Evaluator Suggestion

```mermaid
flowchart TD
    Start([Developer needs<br/>evaluation setup]) --> HasBranch{Has expected<br/>reference branch?}
    HasBranch -->|Yes| Suggest[yb suggest-eval<br/>--source main --expected feature/done]
    HasBranch -->|No| Manual[Manually create<br/>suite.yaml]
    Suggest --> Analyze[Analyze branch<br/>differences]
    Analyze --> Detect[Detect patterns:<br/>- Files changed<br/>- Test additions<br/>- Config changes<br/>- Doc updates]
    Detect --> Map[Map patterns to<br/>recommended evaluators]
    Map --> Extract[Extract metrics from<br/>expected branch]
    Extract --> Generate[Generate suggested-suite.yaml<br/>with evaluators + thresholds]
    Generate --> Review[Developer reviews<br/>suggestions]
    Review --> Customize[Customize thresholds<br/>and criteria]
    Customize --> RunEval[yb run -c suggested-suite.yaml]
    Manual --> RunEval
    RunEval --> Results[Get evaluation results]
    
    style Start fill:#e3f2fd
    style Generate fill:#fff9c4
    style Results fill:#c8e6c9
```

### Execution Model: Orchestrator Flow

```mermaid
sequenceDiagram
    participant User
    participant CLI
    participant Orchestrator
    participant Workspace
    participant Adapter
    participant Agent
    participant Evaluators
    participant Storage
    
    User->>CLI: yb run -c suite.yaml
    CLI->>Orchestrator: runEvaluation(config)
    Orchestrator->>Workspace: createWorkspace()
    Workspace->>Workspace: Clone source branch
    alt Has expected reference
        Workspace->>Workspace: Clone expected branch
    end
    Workspace-->>Orchestrator: Workspace ready
    
    Orchestrator->>Adapter: execute(context)
    Adapter->>Agent: Run with prompt
    Agent->>Agent: Modify code
    Agent-->>Adapter: stdout/stderr
    Adapter->>Adapter: Normalize to youBencha Log
    Adapter-->>Orchestrator: Execution result
    
    Orchestrator->>Storage: Save youBencha Log
    
    par Parallel Evaluator Execution
        Orchestrator->>Evaluators: git-diff.evaluate()
        Orchestrator->>Evaluators: expected-diff.evaluate()
        Orchestrator->>Evaluators: agentic-judge.evaluate()
    end
    
    Evaluators-->>Orchestrator: All results
    Orchestrator->>Orchestrator: Build results bundle
    Orchestrator->>Storage: Save results.json
    Orchestrator-->>CLI: Results bundle
    CLI-->>User: ✓ Evaluation complete
```

### Concept: Agent Adapter Pattern

```mermaid
classDiagram
    class AgentAdapter {
        <<interface>>
        +name: string
        +execute(context) Promise~Result~
        +normalizeLog(output) youBenchaLog
        +checkAvailability() Promise~boolean~
    }
    
    class CopilotCLIAdapter {
        +name: "copilot-cli"
        +execute(context)
        +normalizeLog(output)
        +checkAvailability()
    }
    
    class ClaudeAdapter {
        +name: "claude"
        +execute(context)
        +normalizeLog(output)
        +checkAvailability()
    }
    
    class CustomAdapter {
        +name: "custom-agent"
        +execute(context)
        +normalizeLog(output)
        +checkAvailability()
    }
    
    AgentAdapter <|.. CopilotCLIAdapter
    AgentAdapter <|.. ClaudeAdapter
    AgentAdapter <|.. CustomAdapter
    
    class Orchestrator {
        -adapters: Map
        +getAdapter(type) AgentAdapter
        +runEvaluation(config)
    }
    
    Orchestrator --> AgentAdapter: uses
    
    note for AgentAdapter "All agents normalized to<br/>common youBencha Log format"
```

### Concept: Evaluator Ecosystem

```mermaid
graph TD
    A[Evaluation Context] --> B{Evaluator Type}
    
    B --> C[Code-Based<br/>Evaluators]
    B --> D[Command-Based<br/>Evaluators]
    B --> E[Agentic<br/>Evaluators]
    B --> F[Log-Based<br/>Evaluators]
    
    C --> C1[git-diff<br/>Files changed, LOC]
    C --> C2[expected-diff<br/>Similarity to ideal]
    C --> C3[semantic-diff<br/>AST comparison]
    
    D --> D1[build<br/>Build success/fail]
    D --> D2[tests<br/>Test pass rate]
    D --> D3[lint<br/>Code quality]
    D --> D4[typecheck<br/>Type errors]
    
    E --> E1[agentic-judge<br/>Custom criteria with AI]
    E --> E2[code-review<br/>Agent-powered review]
    
    F --> F1[tokens<br/>Usage & cost]
    F --> F2[timing<br/>Performance metrics]
    
    C1 --> G[Evaluation Results]
    C2 --> G
    D1 --> G
    D2 --> G
    D3 --> G
    D4 --> G
    E1 --> G
    F1 --> G
    
    G --> H[Results Bundle]
    H --> I[Reports<br/>JSON, Markdown, HTML]
    
    style A fill:#e3f2fd
    style G fill:#fff9c4
    style H fill:#c8e6c9
    
    classDef mvp fill:#c8e6c9,stroke:#4caf50,stroke-width:2px
    classDef planned fill:#e0e0e0,stroke:#9e9e9e,stroke-width:1px,stroke-dasharray: 5 5
    
    class C1,C2,E1,F1 mvp
    class C3,D1,D2,D3,D4,E2,F2 planned
```

### Concept: Workspace Isolation

```mermaid
graph TB
    subgraph "Host System"
        Suite[suite.yaml]
    end
    
    subgraph ".youbencha-workspace/"
        subgraph "run-2025-11-08-123456/"
            subgraph "src-modified/"
                M1[Original code]
                M2[Agent modifications]
            end
            
            subgraph "src-expected/ (optional)"
                E1[Ideal implementation]
            end
            
            subgraph "artifacts/"
                A1[youbencha.log.json]
                A2[results.json]
                A3[report.md]
                A4[diffs/]
            end
        end
        
        subgraph "run-2025-11-08-234567/"
            M3[Another run...]
        end
    end
    
    Suite --> src-modified/
    Git1[Git Clone<br/>source branch] --> src-modified/
    Git2[Git Clone<br/>expected branch] --> src-expected/
    
    Agent[AI Agent] --> M2
    M1 --> Evaluators
    M2 --> Evaluators
    E1 --> Evaluators
    Evaluators --> artifacts/
    
    style src-modified/ fill:#fff3e0
    style src-expected/ fill:#e8f5e9
    style artifacts/ fill:#e3f2fd
```

### Use Case: Prompt Engineering Iteration

```mermaid
flowchart LR
    V1[Prompt v1:<br/>'Add tests'] --> Run1[yb run -c v1.yaml]
    Run1 --> R1[Score: 65%<br/>Coverage: 45%]
    R1 --> Analyze1[Low coverage,<br/>missing edge cases]
    Analyze1 --> V2[Prompt v2:<br/>'Add comprehensive tests<br/>including edge cases']
    
    V2 --> Run2[yb run -c v2.yaml]
    Run2 --> R2[Score: 82%<br/>Coverage: 78%]
    R2 --> Analyze2[Better, but<br/>missing error tests]
    Analyze2 --> V3[Prompt v3:<br/>'Add tests with edge cases,<br/>error handling, and<br/>boundary conditions']
    
    V3 --> Run3[yb run -c v3.yaml]
    Run3 --> R3[Score: 94%<br/>Coverage: 91%]
    R3 --> Success[✓ Meets criteria<br/>Deploy prompt]
    
    style V1 fill:#ffcdd2
    style V2 fill:#fff9c4
    style V3 fill:#c8e6c9
    style Success fill:#a5d6a7
```

### Timeline: Evaluation Run

```mermaid
gantt
    title youBencha Evaluation Timeline
    dateFormat ss
    axisFormat %Ss
    
    section Setup
    Parse config           :a1, 00, 1s
    Create workspace       :a2, after a1, 2s
    Clone source repo      :a3, after a2, 5s
    Clone expected repo    :a4, after a2, 5s
    
    section Agent
    Execute agent          :b1, after a3, 12s
    Normalize logs         :b2, after b1, 1s
    Save youBencha log     :b3, after b2, 1s
    
    section Evaluators
    git-diff               :c1, after b3, 2s
    expected-diff          :c2, after b3, 3s
    agentic-judge          :c3, after b3, 8s
    
    section Results
    Aggregate results      :d1, after c3, 1s
    Save results bundle    :d2, after d1, 1s
    Generate report        :d3, after d2, 2s
```