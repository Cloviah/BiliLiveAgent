param(
  [Parameter(Mandatory = $true)][ValidateSet('protect', 'unprotect')][string]$Mode,
  [Parameter(Mandatory = $true)][string]$Payload,
  [switch]$MachineScope
)

Add-Type -AssemblyName System.Security

$bytes = [Convert]::FromBase64String($Payload)
$scope = if ($MachineScope) {
  [System.Security.Cryptography.DataProtectionScope]::LocalMachine
} else {
  [System.Security.Cryptography.DataProtectionScope]::CurrentUser
}

try {
  if ($Mode -eq 'protect') {
    $out = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, $scope)
  } else {
    $out = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, $scope)
  }
  [Convert]::ToBase64String($out)
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
