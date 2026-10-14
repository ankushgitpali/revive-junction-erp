$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$expectedHost = 'aws-0-ap-south-1.pooler.supabase.com'
$expectedUsername = 'postgres.gnvtvkbgpttmzvzazwfh'
$port = 5432
$database = 'postgres'
$psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
$patch = Join-Path $PSScriptRoot '..\patches\20261009000100_return_sale_duplicate_guard.sql'
$test = Join-Path $PSScriptRoot 'financial_inventory_core.test.sql'

if ($expectedHost -cne 'aws-0-ap-south-1.pooler.supabase.com' -or
    $expectedUsername -cne 'postgres.gnvtvkbgpttmzvzazwfh') {
  throw 'Refusing to run: the staging host or username does not match RJ-Staging-Test.'
}
if (-not (Test-Path -LiteralPath $psql -PathType Leaf)) {
  throw "psql was not found at the expected path: $psql"
}
if (-not (Test-Path -LiteralPath $patch -PathType Leaf)) {
  throw "Staging patch was not found: $patch"
}
if (-not (Test-Path -LiteralPath $test -PathType Leaf)) {
  throw "Integration test was not found: $test"
}

& $psql -W -X -v ON_ERROR_STOP=1 `
  -h $expectedHost -p $port -U $expectedUsername -d $database `
  -f $patch -f $test
if ($LASTEXITCODE -ne 0) {
  throw "Staging patch or SQL integration test failed (psql exit code $LASTEXITCODE)."
}
