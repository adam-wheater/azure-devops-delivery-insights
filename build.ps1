#Requires -Version 5.1
<#
.SYNOPSIS
    Verify, version, build and package this Azure DevOps extension.

.DESCRIPTION
    Runs the same checks CI runs, in the same order, so a green local build means
    a green pipeline. The previous script skipped lint and format, which is how a
    formatting failure reached main with a "successful" local build behind it.

    Version handling covers all THREE manifests. package-lock.json was previously
    left untouched, so it drifted out of step with package.json and had to be
    corrected by hand.

.PARAMETER Version
    Exact version to release, e.g. 1.0.1. Overrides the automatic patch bump.

.PARAMETER NoBump
    Package the version already in the manifests without changing it.

.PARAMETER SkipInstall
    Reuse the existing node_modules instead of reinstalling.

.PARAMETER SkipTests
    Skip the unit tests. Everything else still runs.

.PARAMETER SkipChecks
    Skip lint and format:check. Use when a formatting nit is blocking a package
    you need now; CI still enforces both.

.EXAMPLE
    .\build.ps1
    Bumps the patch version, verifies, builds and packages.

.EXAMPLE
    .\build.ps1 -Version 1.1.0
    Releases exactly 1.1.0.

.EXAMPLE
    .\build.ps1 -NoBump -SkipInstall
    Repackages the current version quickly.
#>
[CmdletBinding()]
param(
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version,

    [switch]$NoBump,
    [switch]$SkipInstall,
    [switch]$SkipTests,
    [switch]$SkipChecks
)

$ErrorActionPreference = 'Stop'

if ($NoBump -and $Version) {
    throw "-NoBump and -Version are contradictory. Use one or the other."
}

# Every file operation is rooted here, never at the caller's current directory,
# so the script behaves identically however it is invoked.
$RepoRoot = $PSScriptRoot
$ManifestFiles = @('vss-extension.json', 'package.json', 'package-lock.json')

# -- file helpers ----------------------------------------------------------------
# Set-Content -NoNewline stripped the trailing newline from package.json and
# vss-extension.json on every run, and Set-Content can also introduce a BOM on
# Windows PowerShell. Both are avoided by going through .NET directly and writing
# back exactly what we intend.

function Resolve-RepoPath {
    param([Parameter(Mandatory)][string]$Path)
    return [System.IO.Path]::Combine($RepoRoot, $Path)
}

function Read-TextFile {
    param([Parameter(Mandatory)][string]$Path)
    $full = Resolve-RepoPath $Path
    if (-not [System.IO.File]::Exists($full)) { throw "Expected file not found: $full" }
    return [System.IO.File]::ReadAllText($full)
}

function Write-TextFile {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][AllowEmptyString()][string]$Content
    )
    # UTF-8 without a BOM, written verbatim. The manifests are LF with a trailing
    # newline today; ReadAllText/WriteAllText do not translate line endings, so a
    # regex-only edit leaves both untouched. Set-Content would have added a BOM on
    # Windows PowerShell and -NoNewline stripped the trailing newline.
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText((Resolve-RepoPath $Path), $Content, $utf8NoBom)
}

function Get-CurrentVersion {
    $manifest = Read-TextFile 'vss-extension.json' | ConvertFrom-Json
    if (-not $manifest.version) { throw "vss-extension.json has no version field." }
    if ($manifest.version -notmatch '^\d+\.\d+\.\d+$') {
        throw "vss-extension.json version '$($manifest.version)' is not major.minor.patch."
    }
    return $manifest.version
}

function Get-NextVersion {
    param([Parameter(Mandatory)][string]$Current)
    # Standard semver patch increment. The previous script rolled the patch over
    # at 10 (2.0.9 -> 2.1.0), which silently claims a minor release that never
    # happened. Marketplace versions accept any integer, so 1.0.9 -> 1.0.10.
    $parts = $Current -split '\.'
    return "{0}.{1}.{2}" -f $parts[0], $parts[1], ([int]$parts[2] + 1)
}

function Set-ManifestVersion {
    <#
        Rewrites the version in all three manifests.

        package.json and vss-extension.json each carry exactly one root "version".
        package-lock.json carries the same value twice at the top - once at the
        document root and once under packages."" - and then hundreds of unrelated
        dependency versions, which must NOT be touched. Only the header prefix
        (everything before the first "node_modules/" entry) is rewritten, and the
        replacement count is asserted so a surprise fails the build instead of
        corrupting the lockfile.
    #>
    param(
        [Parameter(Mandatory)][string]$From,
        [Parameter(Mandatory)][string]$To
    )

    $pattern = [regex]::Escape('"version": "' + $From + '"')
    $replacement = '"version": "' + $To + '"'

    foreach ($file in @('vss-extension.json', 'package.json')) {
        $text = Read-TextFile $file
        $matchCount = ([regex]::Matches($text, $pattern)).Count
        if ($matchCount -ne 1) {
            throw "${file}: expected exactly 1 occurrence of version $From, found $matchCount."
        }
        Write-TextFile $file ([regex]::Replace($text, $pattern, $replacement))
    }

    $lockText = Read-TextFile 'package-lock.json'
    $boundary = $lockText.IndexOf('"node_modules/')
    if ($boundary -lt 0) { $boundary = [Math]::Min(2000, $lockText.Length) }
    $header = $lockText.Substring(0, $boundary)
    $rest = $lockText.Substring($boundary)

    $headerMatches = ([regex]::Matches($header, $pattern)).Count
    if ($headerMatches -ne 2) {
        throw "package-lock.json : expected 2 root occurrences of version $From, found $headerMatches. Not touching the lockfile."
    }
    Write-TextFile 'package-lock.json' ([regex]::Replace($header, $pattern, $replacement) + $rest)

    Write-Host "  Version: $From -> $To  (vss-extension.json, package.json, package-lock.json)" -ForegroundColor Green
}

function Invoke-Step {
    param(
        [Parameter(Mandatory)][string]$Label,
        [Parameter(Mandatory)][string[]]$CommandArgs,
        # Printed when the step fails. A build script that only says "exit code 1"
        # makes the reader go and find the remedy that the script already knew.
        [string]$Hint
    )
    Write-Host $Label -ForegroundColor Cyan
    & npm @CommandArgs
    if ($LASTEXITCODE -ne 0) {
        if ($Hint) { Write-Host "  $Hint" -ForegroundColor Yellow }
        throw "npm $($CommandArgs -join ' ') failed with exit code $LASTEXITCODE"
    }
}

function Assert-NpmScripts {
    <#
        Fail by name if package.json no longer defines something this script runs.

        This exists because of a real failure: build.ps1 was changed to run lint
        and format:check, both of which were defined with single-quoted globs.
        cmd.exe does not strip single quotes, so on Windows those scripts looked
        for a file literally named 'src/**/*.{ts,tsx}' and the build died on a
        step that had always passed on Linux CI.
    #>
    param([Parameter(Mandatory)][string[]]$Names)
    $package = Read-TextFile 'package.json' | ConvertFrom-Json
    $defined = @($package.scripts.PSObject.Properties.Name)
    $missing = @($Names | Where-Object { $defined -notcontains $_ })
    if ($missing.Count -gt 0) {
        throw "package.json defines no script named: $($missing -join ', ')"
    }
}

# --- run ---------------------------------------------------------------------

# The product name comes from the manifest so this file is identical in every
# extension repository and can be copied between them unchanged.
$ProductName = (Read-TextFile 'vss-extension.json' | ConvertFrom-Json).name
Write-Host ""
Write-Host "=== $ProductName - build & package ===" -ForegroundColor White
Write-Host ""

Push-Location $PSScriptRoot

# Snapshot the manifests so a failure after the bump can put them back. Without
# this, a failed build left the version already incremented and the next run
# skipped a number, making it impossible to tell what actually shipped.
$snapshot = @{}
$restoreNeeded = $false

try {
    foreach ($file in $ManifestFiles) { $snapshot[$file] = Read-TextFile $file }

    if ($SkipInstall) {
        Write-Host "[1/7] Skipping install (-SkipInstall)." -ForegroundColor DarkGray
    }
    else {
        # npm ci, not npm install: it installs exactly the lockfile and fails if
        # the lockfile disagrees with package.json, rather than quietly rewriting
        # the lockfile underneath the release being built.
        #
        # --legacy-peer-deps is NOT optional: .github/workflows/ci.yml passes it,
        # and a script that claims to mirror CI while installing differently is
        # worse than one that never claimed it.
        Invoke-Step '[1/7] Installing dependencies (npm ci)...' `
            -CommandArgs @('ci', '--legacy-peer-deps', '--no-audit', '--no-fund') `
            -Hint 'If the failure is the environment rather than the lockfile, re-run with -SkipInstall.'
    }

    Assert-NpmScripts @('lint', 'format:check', 'test', 'build', 'package')

    # Steps 2-4 mirror the CI workflow exactly. Any of them failing here means CI
    # would have failed too. -SkipChecks exists because a formatting nit should
    # never be the reason a hotfix cannot be packaged.
    if ($SkipChecks) {
        Write-Host '[2/7] Skipping lint (-SkipChecks).' -ForegroundColor Yellow
        Write-Host '[3/7] Skipping format check (-SkipChecks). CI will still enforce it.' -ForegroundColor Yellow
    }
    else {
        Invoke-Step '[2/7] Linting...' -CommandArgs @('run', 'lint') -Hint 'Fix with: npm run lint:fix'
        Invoke-Step '[3/7] Checking formatting...' -CommandArgs @('run', 'format:check') -Hint 'Fix with: npm run format'
    }

    if ($SkipTests) {
        Write-Host "[4/7] Skipping tests (-SkipTests)." -ForegroundColor Yellow
    }
    else {
        Invoke-Step '[4/7] Running tests...' @('test')
    }

    $current = Get-CurrentVersion

    if ($NoBump) {
        $target = $current
        Write-Host "[5/7] Keeping version $target (-NoBump)." -ForegroundColor DarkGray
    }
    else {
        $target = if ($Version) { $Version } else { Get-NextVersion -Current $current }
        if ($target -eq $current) {
            throw "Version $target is already the current version. Use -NoBump to repackage it."
        }
        Write-Host "[5/7] Setting version..." -ForegroundColor Cyan
        $restoreNeeded = $true
        Set-ManifestVersion -From $current -To $target
    }

    # npm run build also runs postbuild, which verifies the emitted bundle:
    # stylesheet linked, referenced assets present, lazy chunks emitted.
    Invoke-Step '[6/7] Building for production...' @('run', 'build')
    Invoke-Step '[7/7] Packaging .vsix...' @('run', 'package')

    # Confirm the artefact that exists is the one we meant to build. The previous
    # script picked the newest .vsix by timestamp, which would happily report a
    # stale package if this run had not actually produced one.
    $manifest = Read-TextFile 'vss-extension.json' | ConvertFrom-Json
    $expectedName = "$($manifest.publisher).$($manifest.id)-$target.vsix"
    $outDir = Resolve-RepoPath 'out'
    $expectedPath = [System.IO.Path]::Combine($outDir, $expectedName)

    if (-not (Test-Path -LiteralPath $expectedPath)) {
        $found = Get-ChildItem -Path $outDir -Filter '*.vsix' -File -ErrorAction SilentlyContinue |
            ForEach-Object { $_.Name }
        throw "Expected $expectedName in out/ but it is not there. Found: $($found -join ', ')"
    }

    $restoreNeeded = $false
    $vsix = Get-Item -LiteralPath $expectedPath
    $sizeKb = [math]::Round($vsix.Length / 1KB, 1)

    Write-Host ""
    Write-Host "=== Done ===" -ForegroundColor Green
    Write-Host "  Version : $target"
    Write-Host "  Package : $($vsix.FullName) ($sizeKb KB)"
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor White
    Write-Host "  1. Commit the version bump (3 manifest files)."
    Write-Host "  2. Upload the .vsix at https://marketplace.visualstudio.com/manage"
    Write-Host ""
    Write-Host "  Note: the Marketplace rejects a version that already exists, so" -ForegroundColor DarkGray
    Write-Host "  do not re-upload $target once it has been published." -ForegroundColor DarkGray
    Write-Host ""
}
catch {
    if ($restoreNeeded) {
        Write-Host ""
        Write-Host "Build failed after the version bump - restoring the manifests." -ForegroundColor Yellow
        foreach ($file in $ManifestFiles) {
            try { Write-TextFile $file $snapshot[$file] }
            catch { Write-Host "  Could not restore ${file}: $_" -ForegroundColor Red }
        }
    }
    Write-Host ""
    Write-Host "BUILD FAILED: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    exit 1
}
finally {
    Pop-Location
}
