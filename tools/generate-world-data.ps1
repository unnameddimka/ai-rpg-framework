param(
    [string]$InputPath = (Join-Path $PSScriptRoot "..\data\world.json"),
    [string]$OutputPath = (Join-Path $PSScriptRoot "..\src\generated\world-data.js"),
    [string]$PassagesPath = (Join-Path $PSScriptRoot "..\src\generated\world-passages.twee"),
    [string]$StoryDataPath = (Join-Path $PSScriptRoot "..\src\generated\world-storydata.twee")
)

$ErrorActionPreference = "Stop"
$knownActions = @("move","move_within_location","take_item","drop_item","give_item","give_money","place_item","consume","fill","read_aura")
$controllers = @("human","dummy","ai")
$confidences = @("low","medium","high")

function Require([bool]$condition, [string]$message) { if (-not $condition) { throw $message } }
function Register-Inventory([hashtable]$owners, [string]$id, [string]$owner) {
    Require (-not [string]::IsNullOrWhiteSpace($id)) "$owner must define an inventory ID."
    if ($owners.ContainsKey($id)) { throw "Duplicate inventory ID '$id' is owned by both $($owners[$id]) and $owner." }
    $owners[$id] = $owner
}
function Register-TechnicalId([hashtable]$owners, [string]$id, [string]$kind) {
    Require (-not [string]::IsNullOrWhiteSpace($id) -and $id -match '^[A-Za-z][A-Za-z0-9_-]*$') "$kind ID '$id' must start with a letter and contain only letters, numbers, _ or -."
    if ($owners.ContainsKey($id)) { throw "Duplicate technical ID '$id' is used by both $($owners[$id]) and $kind." }
    $owners[$id] = $kind
}
function Validate-Mind($mind, [string]$characterId) {
    Require ($null -ne $mind) "Character $characterId must define initialMind."
    foreach ($listName in @("knownFacts","beliefs","relationships","recentMemories","longTermMemories")) {
        Require ($null -ne $mind.$listName -and $mind.$listName -is [array]) "Character $characterId initialMind.$listName must be an array."
    }
    foreach ($listName in @("knownFacts","beliefs","recentMemories","longTermMemories")) {
        $seen = @{}
        foreach ($record in $mind.$listName) {
            Require (-not [string]::IsNullOrWhiteSpace([string]$record.id)) "Character $characterId $listName record needs an ID."
            Require (-not $seen.ContainsKey([string]$record.id)) "Character $characterId has duplicate $listName ID '$($record.id)'."
            $seen[[string]$record.id] = $true
        }
    }
    foreach ($belief in $mind.beliefs) { Require ($confidences -contains [string]$belief.confidence) "Character $characterId belief '$($belief.id)' has invalid confidence." }
    foreach ($listName in @("recentMemories","longTermMemories")) { foreach ($memory in $mind.$listName) {
        Require ($memory.importance -is [ValueType] -and [double]$memory.importance -ge 0 -and [double]$memory.importance -le 1) "Character $characterId memory '$($memory.id)' has invalid importance."
        Require ($memory.protected -is [bool]) "Character $characterId memory '$($memory.id)' protected must be Boolean."
    }}
}

$resolvedInput = [IO.Path]::GetFullPath($InputPath)
$resolvedOutput = [IO.Path]::GetFullPath($OutputPath)
$resolvedPassages = [IO.Path]::GetFullPath($PassagesPath)
$resolvedStoryData = [IO.Path]::GetFullPath($StoryDataPath)
Require (Test-Path -LiteralPath $resolvedInput -PathType Leaf) "Authoritative world data was not found: $resolvedInput"
$document = Get-Content -Raw -LiteralPath $resolvedInput | ConvertFrom-Json
Require ($document.schemaVersion -eq 2) "Unsupported world schemaVersion. Expected 2."
Require ($null -ne $document.locations -and $null -ne $document.characters -and $null -ne $document.abilities -and $null -ne $document.itemDefinitions -and $null -ne $document.items) "world.json must contain locations, characters, abilities, itemDefinitions, and items objects."
Require (-not [string]::IsNullOrWhiteSpace([string]$document.startLocationId) -and $null -ne $document.locations.([string]$document.startLocationId)) "startLocationId must reference an existing location."

$passageOwners = @{}; $inventoryOwners = @{}; $sublocationOwners = @{}; $technicalOwners = @{}
foreach ($lp in $document.locations.PSObject.Properties) {
    $id = $lp.Name; $location = $lp.Value
    Require ($location.id -eq $id) "Location key $id must match its id."
    Register-TechnicalId $technicalOwners $id "location $id"
    $passage = [string]$location.passage
    Require (-not [string]::IsNullOrWhiteSpace($passage) -and $passage -notmatch '[\r\n\[\]]') "Location $id has an invalid Twine passage name."
    if ($passageOwners.ContainsKey($passage)) { throw "Duplicate passage name '$passage' is used by both $($passageOwners[$passage]) and $id." }
    $passageOwners[$passage] = $id; Register-Inventory $inventoryOwners ([string]$location.inventoryId) "location $id"
    Require ($null -ne $location.sublocations.([string]$location.defaultSublocationId)) "Location $id has an invalid default sublocation."
    foreach ($sp in $location.sublocations.PSObject.Properties) {
        $sid=$sp.Name; $sub=$sp.Value; $sublocationOwners[$sid]=$id
        Require ($sub.id -eq $sid -and $sub.locationId -eq $id) "Sublocation $sid has invalid identity or parent."
        Register-TechnicalId $technicalOwners $sid "sublocation $sid"
        if (-not [string]::IsNullOrWhiteSpace([string]$sub.inventoryId)) { Register-Inventory $inventoryOwners ([string]$sub.inventoryId) "sublocation $sid" }
        foreach ($capability in @($sub.capabilities) | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }) { Require ($knownActions -contains [string]$capability) "Sublocation $sid grants unknown action '$capability'." }
        foreach ($capability in @($sub.environmentCapabilities)) { Require (-not [string]::IsNullOrWhiteSpace([string]$capability)) "Sublocation $sid has a blank environment capability." }
    }
}

foreach ($ap in $document.abilities.PSObject.Properties) {
    $id=$ap.Name; $ability=$ap.Value
    Require ($ability.id -eq $id) "Ability key $id must match its id."
    Register-TechnicalId $technicalOwners $id "ability $id"
    Require ($knownActions -contains [string]$ability.actionType) "Ability $id references unknown action '$($ability.actionType)'."
}
$humanCount=0
foreach ($cp in $document.characters.PSObject.Properties) {
    $id=$cp.Name; $character=$cp.Value
    Require ($character.id -eq $id) "Character key $id must match its id."
    Register-TechnicalId $technicalOwners $id "character $id"
    Require (-not [string]::IsNullOrWhiteSpace([string]$character.name)) "Character $id needs a name."
    Require (-not [string]::IsNullOrWhiteSpace([string]$character.playerDescription) -and -not [string]::IsNullOrWhiteSpace([string]$character.aiDescription)) "Character $id needs public and AI descriptions."
    Require ($null -ne $document.locations.([string]$character.locationId)) "Character $id has an invalid location."
    Require ($null -ne $document.locations.([string]$character.locationId).sublocations.([string]$character.sublocationId)) "Character $id has an invalid sublocation."
    Require ($character.wallet -is [ValueType] -and [int]$character.wallet -eq [double]$character.wallet -and $character.wallet -ge 0) "Character $id has an invalid wallet."
    Require ($controllers -contains [string]$character.initialControllerId) "Character $id has an unknown initial controller."
    Require (($controllers -contains [string]$character.defaultControllerId) -and $character.defaultControllerId -ne "human") "Character $id has an invalid default controller."
    if ($character.initialControllerId -eq "human") { $humanCount++ }
    Register-Inventory $inventoryOwners ([string]$character.inventoryId) "character $id"
    $assigned=@{}; foreach ($abilityId in @($character.abilityIds) | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }) { Require ($null -ne $document.abilities.([string]$abilityId)) "Character $id references missing ability '$abilityId'."; Require (-not $assigned.ContainsKey([string]$abilityId)) "Character $id assigns ability '$abilityId' more than once."; $assigned[[string]$abilityId]=$true }
    Validate-Mind $character.initialMind $id
    foreach ($relationship in $character.initialMind.relationships) { Require ($null -ne $document.characters.([string]$relationship.targetCharacterId) -and $relationship.targetCharacterId -ne $id) "Character $id has an invalid relationship target '$($relationship.targetCharacterId)'." }
}
Require ($humanCount -eq 1) "Exactly one initial human-controlled character is required; found $humanCount."

foreach ($dp in $document.itemDefinitions.PSObject.Properties) {
    $id=$dp.Name; $definition=$dp.Value
    Require ($definition.id -eq $id) "Item definition key $id must match its id."
    Register-TechnicalId $technicalOwners $id "item definition $id"
    Require (-not [string]::IsNullOrWhiteSpace([string]$definition.name)) "Item definition $id needs a name."
    Require ($definition.description -is [string]) "Item definition $id description must be a string."
    Require (-not [string]::IsNullOrWhiteSpace([string]$definition.familyId)) "Item definition $id needs a familyId."
    Require ($definition.tags -is [array]) "Item definition $id tags must be an array."
    foreach ($tag in @($definition.tags)) { Require (-not [string]::IsNullOrWhiteSpace([string]$tag)) "Item definition $id tags must be non-empty strings." }

    if ($null -ne $definition.consumable) {
        $component=$definition.consumable
        Require (-not [string]::IsNullOrWhiteSpace([string]$component.actionLabel)) "Item definition $id consumable needs an actionLabel."
        Require (@("destroy","transform") -contains [string]$component.resultType) "Item definition $id consumable has an invalid resultType."
        if ($component.resultType -eq "transform") { Require ($null -ne $document.itemDefinitions.([string]$component.resultDefinitionId)) "Item definition $id consumable references missing result definition '$($component.resultDefinitionId)'." }
        Require ($component.publicText -is [string] -and $component.feedbackText -is [string]) "Item definition $id consumable texts must be strings."
    }
    if ($null -ne $definition.fillable) {
        $component=$definition.fillable
        Require (-not [string]::IsNullOrWhiteSpace([string]$component.actionLabel)) "Item definition $id fillable needs an actionLabel."
        Require (-not [string]::IsNullOrWhiteSpace([string]$component.requiredEnvironmentCapability)) "Item definition $id fillable needs a requiredEnvironmentCapability."
        Require ($null -ne $document.itemDefinitions.([string]$component.resultDefinitionId)) "Item definition $id fillable references missing result definition '$($component.resultDefinitionId)'."
        Require ($component.publicText -is [string] -and $component.feedbackText -is [string]) "Item definition $id fillable texts must be strings."
    }
    if ($null -ne $definition.equippable) {
        Require ($definition.equippable.slotIds -is [array]) "Item definition $id equippable.slotIds must be an array."
        foreach ($slot in @($definition.equippable.slotIds)) { Require (-not [string]::IsNullOrWhiteSpace([string]$slot)) "Item definition $id equippable slot IDs must be non-empty strings." }
    }
}
foreach ($ip in $document.items.PSObject.Properties) {
    $id=$ip.Name; $item=$ip.Value
    Require ($item.id -eq $id) "Item key $id must match its id."
    Register-TechnicalId $technicalOwners $id "item $id"
    Require ($null -ne $document.itemDefinitions.([string]$item.definitionId)) "Item $id references missing item definition '$($item.definitionId)'."
    Require ($inventoryOwners.ContainsKey([string]$item.containerId)) "Item $id references missing inventory '$($item.containerId)'."
}

$json = ($document | ConvertTo-Json -Depth 100) -replace '</','<\/'
$javascript = "/* Generated from data/world.json. Do not edit this file directly. */`r`n(function () {`r`n    `"use strict`";`r`n    setup.GeneratedWorldData = $json;`r`n}());`r`n"
$passages = foreach ($lp in $document.locations.PSObject.Properties) { ":: $($lp.Value.passage)`r`n<div id=`"location-view`"></div>`r`n" }
$startPassage = $document.locations.([string]$document.startLocationId).passage
$storyData = ":: StoryData`r`n{`r`n  `"ifid`": `"7A96C8DB-CDD6-4B5C-A486-4EF8A4DB12BB`",`r`n  `"format`": `"SugarCube`",`r`n  `"format-version`": `"2.37.3`",`r`n  `"start`": `"$startPassage`",`r`n  `"zoom`": 1`r`n}`r`n"

$targets=@(@($resolvedOutput,$javascript),@($resolvedPassages,($passages -join "`r`n")),@($resolvedStoryData,$storyData)); $temps=@()
try { foreach($target in $targets){ $dir=Split-Path -Parent $target[0]; New-Item -ItemType Directory -Force -Path $dir|Out-Null; $tmp=$target[0]+".tmp"; [IO.File]::WriteAllText($tmp,[string]$target[1],[Text.UTF8Encoding]::new($false)); $temps+=@($tmp) }; for($i=0;$i -lt $targets.Count;$i++){ Move-Item -Force -LiteralPath $temps[$i] -Destination $targets[$i][0] } }
finally { foreach($tmp in $temps){ if(Test-Path -LiteralPath $tmp){ Remove-Item -LiteralPath $tmp } } }
Write-Host "Generated $resolvedOutput"; Write-Host "Generated $resolvedPassages"; Write-Host "Generated $resolvedStoryData"
