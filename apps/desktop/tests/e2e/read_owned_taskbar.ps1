param([Parameter(Mandatory=$true)][ValidateNotNullOrEmpty()][string]$AppId)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$desktopRoot = [System.Windows.Automation.AutomationElement]::RootElement
$taskbarCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'Shell_TrayWnd')
$taskbarElement = $desktopRoot.FindFirst([System.Windows.Automation.TreeScope]::Children, $taskbarCondition)
if ($null -eq $taskbarElement) { throw 'Interactive taskbar is unavailable' }
$buttonCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, ('Appid: ' + $AppId))
$taskbarButtons = $taskbarElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)
$targets = @()
foreach ($element in $taskbarButtons) {
    $current = $element.Current
    if ($current.AutomationId -eq ('Appid: ' + $AppId) -and $current.ControlType -eq [System.Windows.Automation.ControlType]::Button) {
        $bounds = $current.BoundingRectangle
        $targets += @{automationId=$current.AutomationId; x=$bounds.X; y=$bounds.Y; width=$bounds.Width; height=$bounds.Height; isOffscreen=$current.IsOffscreen; enabled=$current.IsEnabled; taskbarHwnd=$taskbarElement.Current.NativeWindowHandle}
    }
}
@{readOnly=$true; targets=$targets} | ConvertTo-Json -Depth 4 -Compress
