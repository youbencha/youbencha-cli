<#
.SYNOPSIS
    Analyze trust from youBencha results history (JSONL).

.DESCRIPTION
    Computes per-assertion pass rates, overall trust scores, model comparisons,
    trend analysis, and trust gaps from a youBencha trust-ledger JSONL file.

.PARAMETER HistoryFile
    Path to the results-history JSONL file (e.g., trust-ledger.jsonl).

.PARAMETER TestName
    Optional. Filter results by test case name.

.PARAMETER MinRuns
    Minimum number of runs required for trust calculation. Default: 3.

.EXAMPLE
    .\analyze-trust.ps1 trust-ledger.jsonl
    .\analyze-trust.ps1 trust-ledger.jsonl -TestName "Add Rate Limiting Middleware"
    .\analyze-trust.ps1 trust-ledger.jsonl -MinRuns 5
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory, Position = 0)]
    [string]$HistoryFile,

    [Parameter()]
    [string]$TestName,

    [Parameter()]
    [int]$MinRuns = 3
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ─── Load Data ───

if (-not (Test-Path $HistoryFile)) {
    Write-Error "File not found: $HistoryFile"
    return
}

$lines = Get-Content $HistoryFile | Where-Object { $_.Trim() -ne '' }
$runs = $lines | ForEach-Object { $_ | ConvertFrom-Json }

# Apply test name filter
if ($TestName) {
    $runs = @($runs | Where-Object { $_.test_case.name -eq $TestName })
}

# ─── Helpers ───

function Format-Header([string]$text) {
    Write-Host ""
    Write-Host ("━━━ {0} ━━━" -f $text) -ForegroundColor Cyan
}

function Format-Table-Compact($data) {
    if (-not $data -or $data.Count -eq 0) {
        Write-Host "  (no data)" -ForegroundColor DarkGray
        return
    }
    $data | Format-Table -AutoSize | Out-String | Write-Host
}

# ─── Banner ───

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Yellow
Write-Host "║               youBencha Trust Analysis                      ║" -ForegroundColor Yellow
Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Yellow
Write-Host ""

if ($TestName) {
    Write-Host "Filter: test_case.name == `"$TestName`"" -ForegroundColor DarkGray
} else {
    Write-Host "Filter: all test cases" -ForegroundColor DarkGray
}

# ─── Section 1: Overall Trust Score ───

Format-Header "Overall Trust Score"

$totalRuns = $runs.Count
if ($totalRuns -lt $MinRuns) {
    Write-Host "  Status: insufficient_data" -ForegroundColor DarkYellow
    Write-Host "  Runs: $totalRuns / $MinRuns required"
    Write-Host "  Need at least $MinRuns runs for trust calculation"
} else {
    $passed = @($runs | Where-Object { $_.summary.overall_status -eq 'passed' }).Count
    $failed = $totalRuns - $passed
    $trustScore = [Math]::Round(($passed / $totalRuns) * 100)

    $trustLevel = switch ($true) {
        ($trustScore -ge 95) { "HIGH - Ship confidently" }
        ($trustScore -ge 80) { "MODERATE - Ship with caveats" }
        ($trustScore -ge 60) { "LOW - Needs prompt refinement" }
        default              { "VERY LOW - Agent struggles with this task" }
    }

    $levelColor = switch ($true) {
        ($trustScore -ge 95) { 'Green' }
        ($trustScore -ge 80) { 'Yellow' }
        ($trustScore -ge 60) { 'DarkYellow' }
        default              { 'Red' }
    }

    Write-Host "  Total Runs: $totalRuns" -ForegroundColor White
    Write-Host "  Passed:     $passed" -ForegroundColor Green
    Write-Host "  Failed:     $failed" -ForegroundColor $(if ($failed -gt 0) { 'Red' } else { 'Green' })
    Write-Host "  Trust:      $trustScore%" -ForegroundColor $levelColor
    Write-Host "  Level:      $trustLevel" -ForegroundColor $levelColor
}

# ─── Section 2: Per-Evaluator Pass Rates ───

Format-Header "Per-Evaluator Pass Rates"

$allEvaluators = $runs | ForEach-Object { $_.evaluators } | ForEach-Object { $_ }
$grouped = $allEvaluators | Group-Object -Property evaluator

$evalTable = $grouped | ForEach-Object {
    $total = $_.Count
    $p = @($_.Group | Where-Object { $_.status -eq 'passed' }).Count
    $f = @($_.Group | Where-Object { $_.status -eq 'failed' }).Count
    $s = @($_.Group | Where-Object { $_.status -eq 'skipped' }).Count
    [PSCustomObject]@{
        Evaluator = $_.Name
        Total     = $total
        Passed    = $p
        Failed    = $f
        Skipped   = $s
        PassRate  = "$([Math]::Round(($p / $total) * 100))%"
    }
} | Sort-Object { [int]($_.PassRate -replace '%','') }

Format-Table-Compact $evalTable

# ─── Section 3: Per-Assertion Trust Scores ───

Format-Header "Per-Assertion Trust Scores"

$judgeResults = $allEvaluators | Where-Object { $_.evaluator -like 'agentic-judge*' -and $null -ne $_.assertions }

$assertionEntries = @()
foreach ($result in $judgeResults) {
    $props = $result.assertions
    if ($props -is [PSCustomObject]) {
        $props.PSObject.Properties | ForEach-Object {
            $assertionEntries += [PSCustomObject]@{ Key = $_.Name; Value = $_.Value }
        }
    }
}

if ($assertionEntries.Count -gt 0) {
    $assertionGroups = $assertionEntries | Group-Object -Property Key

    $assertionTable = $assertionGroups | ForEach-Object {
        $values = @($_.Group | ForEach-Object {
            if ($_.Value -is [double] -or $_.Value -is [int] -or $_.Value -is [decimal]) { $_.Value } else { 0 }
        })
        $avg = [Math]::Round(($values | Measure-Object -Average).Average * 100)
        $min = ($values | Measure-Object -Minimum).Minimum
        $max = ($values | Measure-Object -Maximum).Maximum

        [PSCustomObject]@{
            Assertion   = $_.Name
            Samples     = $_.Count
            AvgScorePct = "$avg%"
            Min         = $min
            Max         = $max
            AlwaysPass  = ($values | ForEach-Object { $_ -eq 1 } | Where-Object { -not $_ }).Count -eq 0
            NeverPass   = ($values | ForEach-Object { $_ -eq 0 } | Where-Object { -not $_ }).Count -eq 0
        }
    } | Sort-Object { [int]($_.AvgScorePct -replace '%','') }

    Format-Table-Compact $assertionTable
} else {
    Write-Host "  (no assertion data found)" -ForegroundColor DarkGray
}

# ─── Section 4: Recent Trend (Last 5 Runs) ───

Format-Header "Recent Trend (Last 5 Runs)"

$recent = $runs | Select-Object -Last 5
$i = 0
$trendTable = $recent | ForEach-Object {
    $i++
    $statusColor = switch ($_.summary.overall_status) {
        'passed' { 'passed' }
        'failed' { 'FAILED' }
        default  { $_.summary.overall_status }
    }
    [PSCustomObject]@{
        Run        = $i
        Date       = if ($_.exported_at) { $_.exported_at } else { $_.execution.completed_at }
        Status     = $statusColor
        Passed     = $_.summary.passed
        Failed     = $_.summary.failed
        DurationSec = [Math]::Round($_.execution.duration_ms / 1000)
    }
}

Format-Table-Compact $trendTable

# ─── Section 5: Model Comparison ───

Format-Header "Model Comparison"

$agentGroups = $runs | Group-Object -Property { $_.agent.type }

$modelTable = $agentGroups | ForEach-Object {
    $total = $_.Count
    $p = @($_.Group | Where-Object { $_.summary.overall_status -eq 'passed' }).Count
    $avgDur = [Math]::Round(($_.Group | ForEach-Object { $_.execution.duration_ms } | Measure-Object -Average).Average / 1000)

    [PSCustomObject]@{
        Agent       = $_.Name
        Runs        = $total
        PassRate    = "$([Math]::Round(($p / $total) * 100))%"
        AvgDurationSec = $avgDur
    }
} | Sort-Object { [int]($_.PassRate -replace '%','') } -Descending

Format-Table-Compact $modelTable

# ─── Section 6: Trust Gaps (Weakest Assertions) ───

Format-Header "Trust Gaps (Weakest Assertions)"

if ($assertionEntries.Count -gt 0) {
    $gapTable = $assertionGroups | ForEach-Object {
        $values = @($_.Group | ForEach-Object {
            if ($_.Value -is [double] -or $_.Value -is [int] -or $_.Value -is [decimal]) { $_.Value } else { 0 }
        })
        $avg = [Math]::Round(($values | Measure-Object -Average).Average * 100)

        [PSCustomObject]@{
            Assertion   = $_.Name
            AvgScorePct = $avg
        }
    } | Sort-Object AvgScorePct | Select-Object -First 5

    $gapTable | ForEach-Object {
        $color = if ($_.AvgScorePct -lt 50) { 'Red' } elseif ($_.AvgScorePct -lt 80) { 'Yellow' } else { 'Green' }
        Write-Host ("  {0,-40} {1}%" -f $_.Assertion, $_.AvgScorePct) -ForegroundColor $color
    }
} else {
    Write-Host "  (no assertion data found)" -ForegroundColor DarkGray
}

# ─── Section 7: Recommendation ───

Format-Header "Recommendation"

if ($totalRuns -lt $MinRuns) {
    Write-Host "  Insufficient data - run more evaluations to build trust" -ForegroundColor DarkYellow
    Write-Host "  Suggestion: yb run -c <testcase>.yaml  (repeat $MinRuns+ times)" -ForegroundColor DarkGray
} elseif ($trustScore -ge 95) {
    Write-Host "  HIGH TRUST ($trustScore%) - Agent reliably implements this spec" -ForegroundColor Green
    Write-Host "  Safe to use in production workflows" -ForegroundColor Green
} elseif ($trustScore -ge 80) {
    Write-Host "  MODERATE TRUST ($trustScore%) - Agent mostly succeeds but has occasional failures" -ForegroundColor Yellow
    Write-Host "  Review failing assertions and consider refining the prompt" -ForegroundColor Yellow
} elseif ($trustScore -ge 60) {
    Write-Host "  LOW TRUST ($trustScore%) - Agent struggles with some requirements" -ForegroundColor DarkYellow
    Write-Host "  Focus on weakest assertions above - consider breaking the task into smaller specs" -ForegroundColor DarkYellow
} else {
    Write-Host "  VERY LOW TRUST ($trustScore%) - Agent cannot reliably implement this spec" -ForegroundColor Red
    Write-Host "  Consider: simpler spec, different model, or more detailed prompt" -ForegroundColor Red
}

Write-Host ""
