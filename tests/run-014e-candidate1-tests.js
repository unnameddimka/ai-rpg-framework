"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.resolve(__dirname, "..");
const runtimeFiles = require("./runtime-files");
const authoredValidator = require("../tools/world-authored-validator.js");

function memoryStorage() {
    const values = new Map();
    return { getItem: k => values.has(k) ? values.get(k) : null, setItem: (k,v) => values.set(k,String(v)), removeItem: k => values.delete(k) };
}
const storage = memoryStorage();
global.window = { localStorage: storage };
global.localStorage = storage;
global.setup = {};
global.State = { variables: {}, passage: "The Tavern" };
global.Engine = { play: function () {}, show: function () {} };
function load(file) { vm.runInThisContext(fs.readFileSync(path.join(root,file),"utf8"), { filename:file }); }
function assert(value, message) { if (!value) throw new Error(message); }
function ok(result, message) { assert(result && result.ok, `${message}: ${JSON.stringify(result)}`); return result; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function fresh() {
    setup.Game.resetWorld();
    ok(setup.Game.acceptPlayerDisclaimer(), "accept disclaimer");
    ok(setup.Game.acknowledgeAISetup(), "ack AI setup");
    ok(setup.Game.finalizePlayerSetup({ mode:"generic" }), "finalize player");
    return setup.Game.getWorld();
}

runtimeFiles.augment([
    "src/00-model-list.js","src/generated/world-data.js","src/07-mind-v3.js","src/08-mind-validators.js","src/09-action-option-validation.js","src/09-world-state-authority.js","src/10-game-00-item-mechanics.js","src/10-game-01-validation.js","src/10-game-02-actions.js","src/10-game-api.js","src/11-save-migration.js",
    "src/12-character-context.js","src/13-character-memory.js","src/13-verbatim-memory.js","src/14-event-perception.js","src/17-runtime-diagnostics.js",
    "src/21-ai-settings.js","src/21-ai-request-profiles.js","src/22-openrouter-client.js","src/23-ai-protocol.js","src/24-ai-request-executor.js",
    "src/24-ai-turn-scheduler.js","src/20-controllers.js","src/24-memory-consolidator.js","src/24-mind-aux-executor.js","src/23-timelapse-protocol.js","src/24-timelapse-core.js","src/24-daytime-timelapse.js"
]).forEach(load);

(function () {
    const authored = JSON.parse(fs.readFileSync(path.join(root,"data/world.json"),"utf8"));
    const privateAuthored = JSON.parse(fs.readFileSync(path.join(root,"data/world.private.json"),"utf8"));
    assert(/^(?:0\.1\.4e-candidate\d+|0\.1\.4f-playtest\d+)$/.test(JSON.parse(fs.readFileSync(path.join(root,"data/product.json"),"utf8")).version), "candidate1-or-later product version must remain authored");

    // Structured epistemic projection: channels stay separated and source is recipient-relative.
    let world = fresh();
    const mixedEvent = {
        id: 9001, type:"narrative_input", actorId:"zlata", targetId:"nell", locationId:"commonRoom", noticeability:"noticeable",
        interactionId:77, text:"Zlata points at the door. Hold still.", publicNarrative:"Zlata points at the door.", spokenText:"Hold still."
    };
    const heard = setup.EventPerception.eventProjectionForRecipient(mixedEvent,"nell",world);
    assert(heard.publicNarrative === mixedEvent.publicNarrative && heard.spokenText === mixedEvent.spokenText, "structured narrative/speech fields must survive recipient projection");
    assert(heard.epistemicParts.length === 2 && heard.epistemicParts[0].type === "direct_observation" && heard.epistemicParts[1].type === "heard_speech" && heard.epistemicParts[1].sourceCharacterId === "zlata", "recipient must receive direct observation plus attributed heard speech");
    const own = setup.EventPerception.eventProjectionForRecipient(mixedEvent,"zlata",world);
    assert(own.epistemicParts[1].type === "own_speech" && own.epistemicParts[1].sourceCharacterId === "zlata", "speaker projection must mark own speech");
    const formal = setup.EventPerception.eventProjectionForRecipient({ id:9002,type:"character_moved",actorId:"zlata",text:"Zlata moved to the yard." },"nell",world);
    assert(formal.epistemicParts.length === 1 && formal.epistemicParts[0].type === "formal_fact", "formal event must project as formal_fact");
    const modelNarrative = setup.EventPerception.projectObservationForModel("nell",{kind:"event",eventType:"narrative_input",text:mixedEvent.text,publicNarrative:mixedEvent.publicNarrative,spokenText:mixedEvent.spokenText,epistemicParts:clone(heard.epistemicParts)},world);
    const modelFormal = setup.EventPerception.projectObservationForModel("nell",{kind:"event",eventType:"character_moved",text:"Zlata moved to the yard.",epistemicParts:clone(formal.epistemicParts)},world);
    const modelResult = setup.EventPerception.projectObservationForModel("nell",{kind:"action_result",text:"A key was transferred.",data:{ok:true,events:[]}},world);
    assert(modelNarrative.worldStateAuthority === "narrative_only" && modelFormal.worldStateAuthority === "grounded_event" && modelResult.worldStateAuthority === "grounded_result", "model observation projection must retain structured world-state authority orthogonally to epistemic source");

    const combined = setup.AITurnScheduler.combineInteractionObservations([
        { id:1,kind:"event",eventType:"narrative_input",interactionId:88,actorId:"zlata",targetId:"nell",text:"Hold still.",epistemicParts:clone(heard.epistemicParts) },
        { id:2,kind:"action_result",eventType:"item_transferred",interactionId:88,actorId:"zlata",targetId:"nell",text:"A key was transferred.",epistemicParts:[{type:"formal_fact",actorId:"zlata",text:"A key was transferred."}] }
    ]);
    assert(combined.length === 1 && combined[0].epistemicParts.length === 3 && combined[0].epistemicParts.some(p=>p.type==="heard_speech") && combined[0].epistemicParts.some(p=>p.type==="formal_fact"), "combined interaction must preserve individual epistemic parts");

    // Verbatim provenance accepts new parts while legacy records remain valid.
    assert(setup.MindValidators.validateVerbatimObservation({ id:"legacy_obs",turn:1,kind:"event",text:"Legacy record.",worldStateAuthority:"narrative_only" },{world:world}).ok, "legacy verbatim without epistemicParts must remain valid");
    assert(setup.MindValidators.validateVerbatimObservation({ id:"new_obs",turn:1,kind:"event",text:"Mixed record.",worldStateAuthority:"narrative_only",epistemicParts:clone(heard.epistemicParts) },{world:world,requireSourceCharacterExists:true}).ok, "new verbatim epistemicParts must validate");

    // Recent dialogue model projection is explicit about own vs heard speech.
    setup.EventPerception.appendDialogue("nell","zlata","I saw a strange fish.",1,1,world);
    setup.EventPerception.appendDialogue("nell","nell","You did?",2,2,world);
    const recent = setup.CharacterContext.buildMaintenance("nell",{}).recentDialogue;
    assert(recent.some(r=>r.speakerId==="zlata"&&r.epistemicStatus==="heard_speech") && recent.some(r=>r.speakerId==="nell"&&r.epistemicStatus==="own_speech"), "recentDialogue must label heard vs own speech");

    // STM optional provenance normalizes duplicates; invalid source/type rejects; LTM cannot persist it.
    const baseMemory = { id:"stm_test",topic:"Fish",summary:"Zlata told me about a fish.",importance:0.5,protected:false };
    assert(setup.MindValidators.validateMemoryRecord(baseMemory,{allowEpistemicSources:true}).ok, "legacy STM without epistemicSources must remain valid");
    const duplicateSources = [{type:"heard_speech",sourceCharacterId:"zlata"},{type:"heard_speech",sourceCharacterId:"zlata"}];
    assert(setup.MindValidators.normalizeEpistemicSources(duplicateSources).length === 1, "duplicate epistemic source descriptors must normalize away");
    assert(!setup.MindValidators.validateEpistemicSources([{type:"rumor",sourceCharacterId:"zlata"}],{}).ok, "unknown epistemic source type must reject");
    assert(!setup.MindValidators.validateEpistemicSources([{type:"heard_speech",sourceCharacterId:"missing"}],{requireSourceCharacterExists:true,world:world}).ok, "missing speech source character must reject");
    assert(!setup.MindValidators.validateMemoryRecord(Object.assign({},baseMemory,{epistemicSources:[{type:"heard_speech",sourceCharacterId:"zlata"}]}),{allowEpistemicSources:false}).ok, "LTM partition must reject persisted epistemicSources");
    const stmResponse = setup.MindConsolidationProtocols.validateStmResponse({
        shortTermMemoriesToUpsert:[],
        shortTermMemoriesToAdd:[{topic:"Fish",summary:"Zlata told me about a fish.",importance:0.5,retrievalBrief:"Zlata's fish testimony",epistemicSources:duplicateSources}],
        stmRepartitions:[],beliefEffects:[],beliefsToAdd:[],activatedBeliefIds:[]
    },{mind:{shortTermMemories:[],beliefs:[]},characterIds:Object.keys(world.entities).filter(id=>world.entities[id]&&world.entities[id].type==="character")});
    assert(stmResponse.ok && stmResponse.value.shortTermMemoriesToAdd[0].epistemicSources.length === 1, "STM protocol ingress must normalize duplicate provenance before validation");

    // Save/portable mind transfer preserves optional STM and verbatim provenance without adding it to LTM.
    world.entities.nell.mind.shortTermMemories = [{id:"stm_provenance",topic:"Fish testimony",summary:"Zlata told me about a fish.",retrievalBrief:"Zlata fish testimony",importance:0.5,protected:false,epistemicSources:[{type:"heard_speech",sourceCharacterId:"zlata"}]}];
    world.entities.nell.mind.verbatimObservations = [{id:"obs_provenance",turn:1,kind:"event",text:"Zlata said there was a fish.",worldStateAuthority:"narrative_only",epistemicParts:[{type:"heard_speech",sourceCharacterId:"zlata",text:"There was a fish."}]}];
    const exportedMind = ok(setup.CharacterMindTransfer.exportMind("nell"),"export mind with provenance").document;
    assert(exportedMind.mind.shortTermMemories[0].epistemicSources[0].sourceCharacterId === "zlata" && exportedMind.mind.verbatimObservations[0].epistemicParts[0].type === "heard_speech", "portable mind export must preserve epistemic provenance");
    assert(exportedMind.mind.longTermMemories.every(memory=>memory.epistemicSources===undefined), "portable LTM must remain free of structured epistemicSources");
    ok(setup.CharacterMindTransfer.importMind("nell",clone(exportedMind)),"re-import mind with provenance");
    world = setup.Game.getWorld();
    assert(world.entities.nell.mind.shortTermMemories[0].epistemicSources[0].sourceCharacterId === "zlata" && world.entities.nell.mind.verbatimObservations[0].epistemicParts[0].type === "heard_speech", "portable mind import must preserve epistemic provenance");

    // Bright Character and Mind prompt contracts.
    const context = setup.ContextBuilder.build("nell",{pendingObservations:[]});
    const decisionSystem = setup.AIProtocol.decisionMessages(context)[0].content;
    const resultSystem = setup.AIProtocol.resultMessages(context,{type:"sleep"},{ok:true})[0].content;
    for (const prompt of [decisionSystem,resultSystem]) {
        assert(prompt.includes("=== CANONICAL / FORMAL FACTS ===") && prompt.includes("=== EVENTS YOU DIRECTLY OBSERVED ===") && prompt.includes("=== SPEECH / TESTIMONY ==="), "Character prompts must brightly separate epistemic channels");
        assert(prompt.includes("Never put *inline narration*") && prompt.includes("genuine no-op/silence") && prompt.includes("Never silently turn testimony into firsthand memory"), "Character prompts must enforce clean speech, anti-echo, and source preservation");
    }
    const stmSystem = setup.MindConsolidationProtocols.stmSystem();
    const ltmSystem = setup.MindConsolidationProtocols.ltmSystem();
    assert(stmSystem.includes("heard_speech is testimony") && stmSystem.includes("epistemicSources is optional structured provenance"), "STM prompt must preserve attributed testimony and structured source metadata");
    assert(ltmSystem.includes("Do NOT add persistent epistemicSources fields to LTM") && ltmSystem.includes("must never increase epistemic certainty"), "LTM prompt must preserve stance semantically without schema expansion");

    // Timelapse reachable catalog includes authored grounding but respects discovery boundaries.
    world = fresh();
    const catalog = setup.TimelapseAPI.getReachableCatalog("player");
    const commonRoom = catalog.find(x=>x.id==="commonRoom");
    assert(commonRoom && Array.isArray(commonRoom.description) && commonRoom.description.length > 0 && Array.isArray(commonRoom.sublocations) && commonRoom.sublocations.length > 0, "timelapse catalog must include authored location and sublocation grounding");
    assert(!catalog.some(x=>x.id==="trampledGlade"), "undiscovered secret location must not leak through timelapse grounding");
    const timelapseProtocolSource = fs.readFileSync(path.join(root,"src/23-timelapse-protocol.js"),"utf8");
    const daytimeSource = fs.readFileSync(path.join(root,"src/24-daytime-timelapse.js"),"utf8");
    assert(timelapseProtocolSource.includes("Canonical movement between named locations is owned by the engine and occurs outside narration") && timelapseProtocolSource.includes("choose a different narratable local activity"), "planner prompt must reserve canonical travel and unavailable tracked mechanics for formal contracts");
    assert(daytimeSource.includes("Describe only activity at that selected location") && daytimeSource.includes("selectedLocationGrounding"), "sponsored daytime narration must be selected-location-only and receive authored grounding");

    // Generic sleepCapacity authoring/runtime semantics.
    const bench = authored.locations.farmhouseLiving.sublocations.zlataBench;
    assert(bench.capacity===2 && bench.sleepCapacity===1 && bench.capabilities.includes("sleep") && /Sit/.test(bench.enterLabel) && !/lie down/i.test(bench.selfText), "Zlata bench must be mixed-use seating with one sleep slot");
    const invalidTooLarge = clone(authored); invalidTooLarge.locations.farmhouseLiving.sublocations.zlataBench.sleepCapacity=3;
    assert(authoredValidator.validateWorldDocument(invalidTooLarge).length>0, "sleepCapacity above ordinary capacity must fail authored validation");
    const invalidNoSleep = clone(authored); invalidNoSleep.locations.farmhouseLiving.sublocations.farmhouseLivingFloor.sleepCapacity=1;
    assert(authoredValidator.validateWorldDocument(invalidNoSleep).length>0, "sleepCapacity without sleep capability must fail authored validation");
    world = fresh();
    const farmhouseView = setup.CharacterAPI.getView("player");
    const currentSublocations = farmhouseView.location && farmhouseView.location.sublocations || [];
    assert(currentSublocations.every(position=>!position.capabilities.includes("sleep") ? position.sleep_capacity===undefined : true), "ordinary Character projection must not invent sleep_capacity on non-sleep positions");

    world = fresh();
    world.entities.player.locationId="farmhouseLiving"; world.entities.player.sublocationId="zlataBench"; world.entities.player.sleeping=false;
    world.entities.zlata.locationId="farmhouseLiving"; world.entities.zlata.sublocationId="zlataBench"; world.entities.zlata.sleeping=false;
    assert(setup.Game.validateWorld(world).ok, "capacity two must permit two awake bench occupants");
    ok(setup.CharacterAPI.perform("player",{type:"sleep"}),"first bench sleeper");
    assert(setup.Game.validateWorld(world).ok && world.entities.player.sleeping===true, "one sleeper plus one awake occupant must be valid");
    const secondOrdinary = setup.CharacterAPI.perform("zlata",{type:"sleep"});
    assert(!secondOrdinary.ok && secondOrdinary.error.code==="BED_SLEEP_CAPACITY_FULL", "ordinary sleep must reject a second sleeper on capacity-one sleep surface");
    const secondTimelapse = setup.TimelapseAPI.executeAction("zlata","farmhouseLiving",{type:"sleep",bedId:"zlataBench"});
    assert(!secondTimelapse.ok && secondTimelapse.error.code==="BED_SLEEP_CAPACITY_FULL", "timelapse sleep must reject the same second sleeper");
    world.entities.player.sublocationId="farmhouseStoveBed"; world.entities.zlata.sublocationId="farmhouseStoveBed"; world.entities.player.sleeping=true; world.entities.zlata.sleeping=true;
    assert(setup.Game.validateWorld(world).ok, "sleep-capable sublocation without sleepCapacity must default to ordinary capacity");

    // Farm sponsored jobs and tangible edible rewards are authored through generic mechanisms.
    const radovanJob = authored.dayActivities.radovanFarmAssistance;
    const bozhenaJob = authored.dayActivities.bozhenaFarmsteadAssistance;
    assert(radovanJob.kind==="sponsored_job"&&radovanJob.sponsorCharacterId==="radovan"&&radovanJob.workLocationId==="farmYard"&&radovanJob.settlement.type==="sponsor_items"&&radovanJob.settlement.minTotal===2&&radovanJob.settlement.maxTotal===3&&JSON.stringify(radovanJob.settlement.definitionIds)===JSON.stringify(["turnip","onion","buckwheatGroats","apple"]), "Radovan job must use exact generic farm reward pool");
    assert(bozhenaJob.kind==="sponsored_job"&&bozhenaJob.sponsorCharacterId==="bozhena"&&bozhenaJob.workLocationId==="farmYard"&&bozhenaJob.settlement.type==="sponsor_items"&&bozhenaJob.settlement.minTotal===2&&bozhenaJob.settlement.maxTotal===3&&JSON.stringify(bozhenaJob.settlement.definitionIds)===JSON.stringify(["eggs","farmCheese","breadLoaf"]), "Bozhena job must use exact generic household-food reward pool");
    const foodIds=["turnip","onion","buckwheatGroats","apple","eggs","farmCheese","breadLoaf"];
    foodIds.forEach(id=>{
        const d=authored.itemDefinitions[id];
        assert(d&&d.consumable===true&&d.equippable===false&&d.fillable===false&&d.consumeAction&&d.consumeAction.resultType==="remove"&&Array.isArray(d.tags)&&d.tags.includes("food"), `${id} must be a standalone edible remove-on-consume item definition`);
    });
    world=fresh();
    for(const definitionId of foodIds){
        const itemId=`test_${definitionId}`;
        world.entities[itemId]={id:itemId,type:"item",definitionId:definitionId,name:authored.itemDefinitions[definitionId].name,containerId:world.entities.player.inventoryId};
        world.inventories[world.entities.player.inventoryId].itemIds.push(itemId);
        const view=setup.CharacterAPI.getView("player");
        assert(view.available_actions.consume&&view.available_actions.consume.options.item_ids.includes(itemId), `${definitionId} must expose formal consume while carried`);
        ok(setup.CharacterAPI.perform("player",{type:"consume",item_id:itemId}),`consume ${definitionId}`);
        assert(!world.entities[itemId]&&!world.inventories[world.entities.player.inventoryId].itemIds.includes(itemId), `${definitionId} consume must remove the standalone item instance`);
    }

    // Shared public/private authoring parity keeps private-only content private.
    for(const activityId of ["radovanFarmAssistance","bozhenaFarmsteadAssistance"]) assert(JSON.stringify(privateAuthored.dayActivities[activityId])===JSON.stringify(authored.dayActivities[activityId]), `${activityId} must match in public/private world authoring`);
    for(const id of foodIds) assert(JSON.stringify(privateAuthored.itemDefinitions[id])===JSON.stringify(authored.itemDefinitions[id]), `${id} must match in public/private world authoring`);
    assert(privateAuthored.characters.captainPrice && !authored.characters.captainPrice, "private world must preserve private-only Captain Price while public world remains clean");

    // Developer agent package helper is whitelist-based and protected from recursive packaging/commit.
    const packageScript=fs.readFileSync(path.join(root,"tools/package-for-agent.ps1"),"utf8");
    const gitignore=fs.readFileSync(path.join(root,".gitignore"),"utf8");
    for(const required of ["data", "docs", "editor", "src", "tests", "tools", "AGENTS.md", "README.md", "PLAYER-README.md", "LICENSE"]) assert(packageScript.includes(`'${required}'`) || packageScript.includes(`\"${required}\"`), `agent package whitelist must include ${required}`);
    for(const excluded of [".git", ".build", "dist", "model-contract-bench", ".agent-packages", ".vscode"]) assert(packageScript.includes(`'${excluded}'`) || packageScript.includes(`\"${excluded}\"`), `agent package helper must exclude ${excluded}`);
    assert(gitignore.split(/\r?\n/).includes(".agent-packages/"), ".agent-packages must be gitignored");

    console.log("All 0.1.4e-candidate1 tests passed.");
}());
