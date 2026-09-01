"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.resolve(__dirname, "..");
const runtimeFiles = require("./runtime-files");

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
function assert(value,message){ if(!value) throw new Error(message); }
function ok(result,message){ assert(result&&result.ok, `${message}: ${JSON.stringify(result)}`); return result; }
function emptyUpdates(){ return { relationshipsToUpsert:[], activatedBeliefIds:[] }; }
function emptyStmResult(){ return { shortTermMemoriesToUpsert:[], shortTermMemoriesToAdd:[], stmRepartitions:[], beliefEffects:[], beliefsToAdd:[], activatedBeliefIds:[] }; }
function emptyLtmResult(){ return { longTermMemoriesToUpsert:[], longTermMemoriesToAdd:[], retirementGroups:[], higherOrderBeliefEffects:[], beliefsToAdd:[], activatedBeliefIds:[] }; }
function mindProtocolResponse(messages){
    const user=String(messages&&messages[1]&&messages[1].content||"");
    let payload=null; try{ payload=JSON.parse(user); }catch(error){}
    if(!payload||!payload.stage) return null;
    if(payload.stage==="mind-v3-stm") return {ok:true,content:JSON.stringify(emptyStmResult()),modelId:"test",usage:{}};
    if(payload.stage==="mind-v3-ltm") return {ok:true,content:JSON.stringify(emptyLtmResult()),modelId:"test",usage:{}};
    if(payload.stage==="mind-v3-reconciliation") return {ok:true,content:JSON.stringify({resolutions:[],activatedBeliefIds:[]}),modelId:"test",usage:{}};
    return null;
}

runtimeFiles.augment([
"src/00-model-list.js","src/generated/world-data.js","src/07-mind-v3.js","src/08-mind-validators.js","src/09-action-option-validation.js","src/09-world-state-authority.js","src/10-game-00-item-mechanics.js","src/10-game-01-validation.js","src/10-game-02-actions.js","src/10-game-api.js","src/11-save-migration.js",
"src/12-character-context.js","src/13-character-memory.js","src/13-verbatim-memory.js","src/14-event-perception.js","src/17-runtime-diagnostics.js","src/21-ai-settings.js","src/21-ai-request-profiles.js",
"src/22-openrouter-client.js","src/23-ai-protocol.js","src/23-world-environment.js","src/24-ai-request-executor.js","src/24-ai-turn-scheduler.js",
"src/20-controllers.js","src/24-memory-consolidator.js","src/24-mind-aux-executor.js","src/23-timelapse-protocol.js","src/24-timelapse-core.js","src/24-daytime-timelapse.js","src/24-night-timelapse.js","src/25-turn-flow.js"
]).forEach(load);

setup.AIRuntimeSettings.save("sk-or-v1-test-daytime-key-1234567890", false, storage, Date.now());

function fresh(aiId) {
    setup.Game.resetWorld(); setup.Game.acceptPlayerDisclaimer(); setup.Game.acknowledgeAISetup(); setup.Game.finalizePlayerSetup({ mode: "generic" });
    const world = setup.Game.getWorld();
    Object.values(world.entities).filter(e=>e&&e.type==="character"&&e.id!=="player").forEach(c=>{
        setup.Game.assignNonHumanController(c.id, c.id===aiId ? "ai" : "dummy");
    });
    setup.AITurnQueue.repair();
    return setup.Game.getWorld();
}

function fakeCharacterClient() {
    return {
        async chat(messages) { return this.chatWithOptions(messages); },
        async chatWithOptions(messages) {
            const mindResponse=mindProtocolResponse(messages); if(mindResponse) return mindResponse;
            const system = String(messages && messages[0] && messages[0].content || "");
            if (system.includes("Generate public world narration for one already-committed")) {
                assert(system.includes("strictly in third person") && system.includes("context.daytimeJob.sponsor.name") && !system.includes("You are the sponsoring character"),
                    "sponsored daytime committed narration must explicitly require third-person world narration rather than sponsor-perspective prose");
                return { ok:true, content:"Harlan keeps the Traveler busy at the bellows and tool rack while he shapes the hot metal himself.", modelId:"test", usage:{} };
            }
            if (system.includes("sponsoring character choosing the reward")) {
                const user = String(messages && messages[1] && messages[1].content || "");
                if (user.includes('"sponsor_items"')) {
                    return { ok:true, content:'{"items":[{"definitionId":"healingSalve","count":2},{"definitionId":"staminaPotion","count":1}]}', modelId:"test", usage:{} };
                }
                return { ok:true, content:'{"gold":5}', modelId:"test", usage:{} };
            }
            if (system.includes("private post-timelapse reflection")) {
                return { ok:true, content:JSON.stringify({memoryUpdates:emptyUpdates()}), modelId:"test", usage:{} };
            }
            if (system.includes("Narrate one coarse round of a solo hunting day")) {
                return { ok:true, content:"The Traveler searches the brush and tree line for signs of small game, moving carefully through the undergrowth.", modelId:"test", usage:{} };
            }
            throw new Error("Unexpected daytime model request: "+system.slice(0,120));
        }
    };
}

function farmRewardClient(rewardResponses, onWorkNarration) {
    let rewardCall = 0;
    return {
        async chat(messages) { return this.chatWithOptions(messages); },
        async chatWithOptions(messages) {
            const mindResponse=mindProtocolResponse(messages); if(mindResponse) return mindResponse;
            const system = String(messages && messages[0] && messages[0].content || "");
            if (system.includes("Generate public world narration for one already-committed")) {
                if (typeof onWorkNarration === "function") onWorkNarration();
                return {ok:true,content:"The sponsor keeps the Traveler occupied with practical work around the farm yard.",modelId:"test",usage:{}};
            }
            if (system.includes("sponsoring character choosing the reward")) {
                const index = Math.min(rewardCall++, rewardResponses.length - 1);
                return {ok:true,content:rewardResponses[index],modelId:"test",usage:{}};
            }
            if (system.includes("private post-timelapse reflection")) {
                return {ok:true,content:JSON.stringify({memoryUpdates:emptyUpdates()}),modelId:"test",usage:{}};
            }
            throw new Error("Unexpected farm daytime model request: "+system.slice(0,120));
        }
    };
}

async function runFarmJobFixture(sponsorId, activityId, rewardResponses, onWorkNarration) {
    let world=fresh(sponsorId);
    world.environment.timePhase="morning";
    ok(setup.TimelapseAPI.moveToLocation(sponsorId,"farmYard"),`${sponsorId} should reach farm yard for job fixture`);
    ok(setup.TimelapseAPI.moveToLocation("player","farmYard"),"Traveler should reach farm yard for job fixture");
    ok(setup.CharacterAPI.perform(sponsorId,{type:"offer_day_work",activity_id:activityId}),`${sponsorId} should offer ${activityId}`);
    ok(setup.DaytimeTimelapse.acceptPendingOffer(),`${activityId} should be accepted`);
    const oldRefresh=setup.WorldEnvironment.refreshWeather;
    setup.WorldEnvironment.refreshWeather=async()=>({ok:true});
    try {
        const result=await setup.DaytimeTimelapse.run(farmRewardClient(rewardResponses,onWorkNarration));
        return {result:result,world:setup.Game.getWorld()};
    } finally {
        setup.WorldEnvironment.refreshWeather=oldRefresh;
    }
}

async function main(){
    // Authored jobs/items and phase gating.
    let world=fresh("blacksmith");
    assert(world.environment.timePhase==="evening","new world should begin in Evening");
    assert(setup.WeeklyRhythm.currentWeekdayName(world)==="Monday","new world should begin on Monday");
    world.environment.timePhase="evening";
    assert(world.dayActivities.maraAssistance&&world.dayActivities.forgeAssistance&&world.dayActivities.soloHunting,"three day activities should be authored");
    assert(world.itemDefinitions.healingSalve&&world.itemDefinitions.staminaPotion&&world.itemDefinitions.squirrelPelt,"daytime output item definitions should exist");
    ok(setup.TimelapseAPI.moveToLocation("player","secludedCottage"),"Traveler should reach a bed for time-phase action gating");
    ok(setup.CharacterAPI.perform("player",{type:"move_within_location",destination_id:"maraCottageBed"}),"Traveler should lie on Mara's bed for action gating");
    assert(setup.CharacterAPI.getView("player").available_actions.sleep,"Human sleep-until-morning entry should exist while lying on a bed in Evening");
    world.environment.timePhase="morning";
    assert(!setup.CharacterAPI.getView("player").available_actions.sleep,"Human sleep-until-morning entry must be absent in Morning");
    ok(setup.TimelapseAPI.moveToLocation("player","villageSmithy"),"Traveler should reach forge for offer test");
    const harlanView=setup.CharacterAPI.getView("blacksmith");
    assert(harlanView.available_actions.offer_day_work&&harlanView.available_actions.offer_day_work.options.activity_ids.includes("forgeAssistance"),"Harlan should receive AI-owned work offer action in Morning while co-located with Traveler");
    ok(setup.CharacterAPI.perform("blacksmith",{type:"offer_day_work",activity_id:"forgeAssistance"}),"Harlan should formally offer work");
    assert(setup.DaytimeTimelapse.hasPendingOffer(),"formal offer should create pending blocking state");
    setup.DaytimeTimelapse.notePausedReactionIds(["blacksmith"]);
    const declined=ok(setup.DaytimeTimelapse.declinePendingOffer(),"decline should resolve pending offer");
    assert(declined.value.reactedCharacterIds.includes("blacksmith")&&!setup.DaytimeTimelapse.hasPendingOffer()&&world.environment.timePhase==="morning","decline should preserve Morning and reacted set");
    assert(world.entities.blacksmith.mind.pendingObservations.some(o=>o.code==="DAY_WORK_DECLINED"),"sponsor should receive grounded decline observation");

    // Daytime timelapse never exposes or accepts sleep, while nighttime validation remains unchanged.
    world=fresh("innkeeper");
    const innkeeperDayCatalog=setup.TimelapseAPI.getReachableCatalog("innkeeper");
    const guestRoomDayCatalog=innkeeperDayCatalog.find(location=>location.id==="guestRoom1");
    assert(guestRoomDayCatalog&&guestRoomDayCatalog.beds.some(bed=>bed.id==="guestRoom1Bed"),"generic reachable catalog should still expose the authored bed before mode filtering");
    assert(!setup.TimelapseCore.validatePlan({steps:[{locationId:"guestRoom1",action:{type:"sleep",bedId:"guestRoom1Bed"}}]},innkeeperDayCatalog,1,"daytime").ok,
        "daytime validation must reject sleep even if a stale/unfiltered catalog contains a valid bed");
    assert(setup.TimelapseCore.validatePlan({steps:[{locationId:"guestRoom1",action:{type:"sleep",bedId:"guestRoom1Bed"}}]},innkeeperDayCatalog,1,"nighttime").ok,
        "nighttime validation must continue accepting a valid final sleep step");
    let capturedDayPlanSystem="", capturedDayPlanPayload=null;
    const oldDayPlanBatch=setup.MemoryConsolidator.compressBatch;
    setup.MemoryConsolidator.compressBatch=async()=>({ok:true,results:[]});
    const dayPlannerClient={
        async chat(messages){ return this.chatWithOptions(messages); },
        async chatWithOptions(messages){
            const mindResponse=mindProtocolResponse(messages); if(mindResponse) return mindResponse;
            const system=String(messages&&messages[0]&&messages[0].content||"");
            if(system.includes("planning coarse activity for exactly one RPG character")){
                capturedDayPlanSystem=system;
                capturedDayPlanPayload=JSON.parse(String(messages&&messages[1]&&messages[1].content||"{}"));
                return {ok:true,content:JSON.stringify({steps:[{locationId:"commonRoom",action:{type:"narrate",text:"Garrick checks the common room and considers the day ahead."}}]}),modelId:"test",usage:{}};
            }
            if(system.includes("private post-timelapse reflection")) return {ok:true,content:JSON.stringify({memoryUpdates:emptyUpdates()}),modelId:"test",usage:{}};
            throw new Error("Unexpected daytime planner contract request: "+system.slice(0,120));
        }
    };
    const oneRoundDay=await setup.TimelapseCore.run(dayPlannerClient,{mode:"daytime",roundCount:1});
    setup.MemoryConsolidator.compressBatch=oldDayPlanBatch;
    ok(oneRoundDay,"one-round daytime planner contract fixture should complete");
    assert(capturedDayPlanSystem&&!capturedDayPlanSystem.includes('sleep = {"type":"sleep"')&&capturedDayPlanSystem.includes("Sleep is not a valid daytime action")&&capturedDayPlanSystem.includes("third person")&&
        capturedDayPlanSystem.includes("AUTHORITATIVE TIME PHASE: Day")&&capturedDayPlanSystem.includes("transition to Evening only after all timelapse rounds")&&
        capturedDayPlanSystem.includes("portions of one continuous abstract day span"),
        "daytime planner system prompt must omit sleep, require third-person committed narration, and forbid model-driven phase advancement");
    const suppliedDayLocations=capturedDayPlanPayload&&capturedDayPlanPayload.context&&capturedDayPlanPayload.context.timelapse&&capturedDayPlanPayload.context.timelapse.reachableLocations||[];
    assert(suppliedDayLocations.length>0&&suppliedDayLocations.every(location=>Array.isArray(location.beds)&&location.beds.length===0),
        "daytime planner context must not expose beds as sleep targets");
    assert(capturedDayPlanPayload.context.timelapse.authoritativeTimePhase==="Day"&&capturedDayPlanPayload.context.timelapse.nextTimePhase==="Evening",
        "daytime planner context should explicitly identify authoritative source and deterministic next phases");
    assert(!JSON.stringify(capturedDayPlanPayload.requiredResponseContract||{}).includes('"type":"sleep"')&&JSON.stringify(capturedDayPlanPayload.requiredResponseContract||{}).includes("authoritative Day phase"),
        "daytime required response contract must omit sleep and restate deterministic phase ownership");

    // Accepted work must not teleport through an unreachable route or consume the day.
    world=fresh("blacksmith");
    world.environment.timePhase="morning";
    ok(setup.TimelapseAPI.moveToLocation("blacksmith","commonRoom"),"Harlan should reach common room for blocked-route fixture");
    ok(setup.TimelapseAPI.moveToLocation("player","commonRoom"),"Traveler should meet Harlan for blocked-route fixture");
    ok(setup.CharacterAPI.perform("blacksmith",{type:"offer_day_work",activity_id:"forgeAssistance"}),"blocked-route job offer should be valid before travel");
    ok(setup.DaytimeTimelapse.acceptPendingOffer(),"blocked-route job should be accepted before preflight");
    const originalReachableCatalog=setup.TimelapseAPI.getReachableCatalog;
    setup.TimelapseAPI.getReachableCatalog=function(characterId){ return originalReachableCatalog(characterId).filter(location=>location.id!=="villageSmithy"); };
    const blockedResult=await setup.DaytimeTimelapse.run(fakeCharacterClient());
    setup.TimelapseAPI.getReachableCatalog=originalReachableCatalog;
    assert(!blockedResult.ok&&blockedResult.error.code==="DAY_WORKSITE_UNREACHABLE","unreachable worksite should fail before round one");
    world=setup.Game.getWorld();
    assert(world.environment.timePhase==="morning"&&!world.daytime.activeActivity,"failed worksite preflight should remain Morning and clear the activity");
    assert(world.entities.blacksmith.locationId==="commonRoom"&&world.entities.player.locationId==="commonRoom","failed preflight should restore both characters to their pre-job positions");

    // Successful sponsored work: five rounds, sponsor-selected salary, Harlan wallet untouched, Evening.
    world=fresh("blacksmith");
    world.environment.timePhase="morning";
    ok(setup.TimelapseAPI.moveToLocation("blacksmith","commonRoom"),"Harlan should be catchable away from the forge");
    ok(setup.TimelapseAPI.moveToLocation("player","commonRoom"),"Traveler should meet Harlan away from the forge");
    ok(setup.CharacterAPI.perform("blacksmith",{type:"offer_day_work",activity_id:"forgeAssistance"}),"offer work for accepted run away from the worksite");
    ok(setup.DaytimeTimelapse.acceptPendingOffer(),"accept should activate job");
    const beforeHumanGold=world.entities.player.wallet, beforeHarlanGold=world.entities.blacksmith.wallet;
    const oldRefresh=setup.WorldEnvironment.refreshWeather;
    setup.WorldEnvironment.refreshWeather=async function(){ world.environment.weatherNarrative="A cool breeze moves through broken cloud."; world.environment.weatherInitialized=true; return {ok:true}; };
    const boundaryPhases=[];
    const dayResult=await setup.DaytimeTimelapse.run(fakeCharacterClient(),{onProgress:function(progress){ if(progress&&progress.stage==="routine-anchors") boundaryPhases.push(setup.Game.getWorld().environment.timePhase); }});
    setup.WorldEnvironment.refreshWeather=oldRefresh;
    ok(dayResult,"forge daytime timelapse should complete");
    world=setup.Game.getWorld();
    assert(dayResult.committedRounds===5&&world.environment.timePhase==="evening"&&State.variables.time==="Evening","successful day should commit five rounds and synchronize canonical/legacy Evening");
    assert(boundaryPhases.length===1&&boundaryPhases[0]==="daytime_timelapse","evening routine anchors must run while the authoritative source phase is still Day, before the deterministic Evening transition");
    assert(world.entities.innkeeper.locationId==="bar"&&world.entities.innkeeper.sublocationId==="barBehindCounter"&&world.entities.nell.locationId==="commonRoom"&&world.entities.nell.sublocationId==="commonRoomFloor", "successful daytime timelapse should apply authored evening routine anchors for Garrick and Nell");
    assert(world.entities.player.wallet===beforeHumanGold+5,"Harlan settlement should mint exactly chosen salary to Traveler");
    assert(world.entities.blacksmith.wallet===beforeHarlanGold,"minted salary must not come from Harlan wallet");
    assert(world.entities.blacksmith.locationId==="villageSmithy"&&world.entities.player.locationId==="villageSmithy","accepted offsite job should move sponsor and Traveler to the authored worksite before work");
    assert(Object.values(world.entities).filter(e=>e&&e.type==="character").every(c=>c.sleeping===false),"all characters must be awake after successful daytime timelapse");

    // Mara-sponsored item settlement uses the same generic job flow and creates only allowed ordinary items.
    world=fresh("hoodedWoman");
    world.environment.timePhase="morning";
    ok(setup.TimelapseAPI.moveToLocation("hoodedWoman","secludedCottage"),"Mara should reach her cottage for test setup");
    ok(setup.TimelapseAPI.moveToLocation("player","secludedCottage"),"Traveler should reach Mara");
    ok(setup.CharacterAPI.perform("hoodedWoman",{type:"offer_day_work",activity_id:"maraAssistance"}),"Mara should formally offer work");
    ok(setup.DaytimeTimelapse.acceptPendingOffer(),"Mara job should be accepted");
    const oldRefreshMara=setup.WorldEnvironment.refreshWeather; setup.WorldEnvironment.refreshWeather=async()=>({ok:true});
    const maraResult=await setup.DaytimeTimelapse.run(fakeCharacterClient());
    setup.WorldEnvironment.refreshWeather=oldRefreshMara;
    ok(maraResult,"Mara daytime timelapse should complete");
    world=setup.Game.getWorld();
    const maraRewards=world.inventories[world.entities.player.inventoryId].itemIds.map(id=>world.entities[id]).filter(e=>e&&(e.definitionId==="healingSalve"||e.definitionId==="staminaPotion"));
    assert(maraRewards.filter(e=>e.definitionId==="healingSalve").length===2&&maraRewards.filter(e=>e.definitionId==="staminaPotion").length===1,"Mara should create the sponsor-selected 2 salves + 1 stamina potion reward");
    assert(world.environment.timePhase==="evening","Mara work should end in Evening");

    // Candidate farm rewards use the generic sponsor_items settlement: 2/3 totals, repeated count, validation failure, and no premature reward creation.
    const farmRewardDefinitions=new Set(["turnip","onion","buckwheatGroats","apple","eggs","farmCheese","breadLoaf"]);
    let narrationChecks=0;
    let farmRun=await runFarmJobFixture("radovan","radovanFarmAssistance",['{"items":[{"definitionId":"turnip","count":2}]}'],function(){
        narrationChecks++;
        const current=setup.Game.getWorld();
        const carried=current.inventories[current.entities.player.inventoryId].itemIds.map(id=>current.entities[id]).filter(Boolean);
        assert(!carried.some(item=>farmRewardDefinitions.has(item.definitionId)),"farm reward items must not exist during the five work narration rounds");
    });
    ok(farmRun.result,"Radovan 2-item repeated-count reward should complete");
    assert(narrationChecks===5,"sponsored farm job should perform five narration rounds before settlement");
    let farmItems=farmRun.world.inventories[farmRun.world.entities.player.inventoryId].itemIds.map(id=>farmRun.world.entities[id]).filter(item=>item&&farmRewardDefinitions.has(item.definitionId));
    assert(farmItems.length===2&&farmItems.every(item=>item.definitionId==="turnip"),"one sponsor_items row with count 2 must create two real Turnip instances");

    farmRun=await runFarmJobFixture("bozhena","bozhenaFarmsteadAssistance",['{"items":[{"definitionId":"eggs","count":1},{"definitionId":"farmCheese","count":1},{"definitionId":"breadLoaf","count":1}]}']);
    ok(farmRun.result,"Bozhena 3-item reward should complete");
    farmItems=farmRun.world.inventories[farmRun.world.entities.player.inventoryId].itemIds.map(id=>farmRun.world.entities[id]).filter(item=>item&&farmRewardDefinitions.has(item.definitionId));
    assert(farmItems.length===3&&new Set(farmItems.map(item=>item.definitionId)).size===3,"valid 3-item household reward must create three real allowed item instances");

    setup.AIRequestExecutor.clearExchangeHistory();
    farmRun=await runFarmJobFixture("radovan","radovanFarmAssistance",['not json','{"items":[{"definitionId":"onion","count":2}]}']);
    ok(farmRun.result,"malformed sponsor reward followed by one valid repair should complete through StructuredAIRequest");
    let settlementHistory=setup.AIRequestExecutor.getExchangeHistory().entries.filter(entry=>entry.request&&entry.request.purpose==="daytime-job-settlement");
    assert(settlementHistory.length===1&&settlementHistory[0].result&&settlementHistory[0].result.repaired===true,"sponsor repair must be one common structured-request execution rather than a second executor lifecycle");
    assert(settlementHistory[0].result.trace&&settlementHistory[0].result.trace.attempts.length===2&&settlementHistory[0].result.trace.attempts[0].kind==="initial"&&settlementHistory[0].result.trace.attempts[1].kind==="repair","sponsor settlement trace must expose exactly initial + one repair attempt");

    setup.AIRequestExecutor.clearExchangeHistory();
    const twiceInvalid=await runFarmJobFixture("radovan","radovanFarmAssistance",['not json','still not json']);
    assert(!twiceInvalid.result.ok&&twiceInvalid.result.error&&twiceInvalid.result.error.code==="DAYTIME_SETTLEMENT_INVALID","two malformed sponsor attempts must fail after the existing one-repair bound");
    settlementHistory=setup.AIRequestExecutor.getExchangeHistory().entries.filter(entry=>entry.request&&entry.request.purpose==="daytime-job-settlement");
    assert(settlementHistory.length===1&&settlementHistory[0].result.trace&&settlementHistory[0].result.trace.attempts.length===2,"failed sponsor settlement must still stop after exactly two total attempts");
    const twiceInvalidCarried=twiceInvalid.world.inventories[twiceInvalid.world.entities.player.inventoryId].itemIds.map(id=>twiceInvalid.world.entities[id]).filter(Boolean);
    assert(!twiceInvalidCarried.some(item=>farmRewardDefinitions.has(item.definitionId)),"failed structured sponsor settlement must not mutate reward inventory");

    for (const invalidCase of [
        {label:"disallowed definition",responses:['{"items":[{"definitionId":"healingSalve","count":2}]}','{"items":[{"definitionId":"healingSalve","count":2}]}']},
        {label:"below minimum",responses:['{"items":[{"definitionId":"onion","count":1}]}','{"items":[{"definitionId":"onion","count":1}]}']},
        {label:"above maximum",responses:['{"items":[{"definitionId":"onion","count":4}]}','{"items":[{"definitionId":"onion","count":4}]}']}
    ]) {
        const failed=await runFarmJobFixture("radovan","radovanFarmAssistance",invalidCase.responses);
        assert(!failed.result.ok&&failed.result.error&&failed.result.error.code==="DAYTIME_SETTLEMENT_INVALID",`${invalidCase.label} farm reward must fail generic settlement validation after repair`);
        const carried=failed.world.inventories[failed.world.entities.player.inventoryId].itemIds.map(id=>failed.world.entities[id]).filter(Boolean);
        assert(!carried.some(item=>farmRewardDefinitions.has(item.definitionId)),`${invalidCase.label} farm reward failure must not create reward items`);
    }

    // Reflection sees canonical grounded character identity, repairs one invalid relationship target,
    // salvages valid mind changes, and maintenance failure does not undo an already committed day.
    world=fresh("hoodedWoman");
    world.environment.timePhase="morning";
    ok(setup.TimelapseAPI.moveToLocation("hoodedWoman","secludedCottage"),"Mara reflection fixture should reach cottage");
    ok(setup.TimelapseAPI.moveToLocation("nell","secludedCottage"),"Nell reflection-context fixture should reach Mara");
    ok(setup.TimelapseAPI.moveToLocation("player","secludedCottage"),"Traveler reflection fixture should reach Mara");
    const nellMaintenanceContext=setup.CharacterContext.buildMaintenance("nell",{pendingObservations:[]});
    assert(nellMaintenanceContext&&nellMaintenanceContext.view.location.characters.some(c=>c.id==="hoodedWoman"&&c.name==="Mara the Hedge Witch"&&typeof c.playerDescription==="string"&&c.playerDescription.length>0),
        "reflection context should reuse the canonical AI-visible character projection, including Mara's stable hoodedWoman ID and visible description");
    ok(setup.CharacterAPI.perform("hoodedWoman",{type:"offer_day_work",activity_id:"maraAssistance"}),"Mara should offer work for reflection repair fixture");
    ok(setup.DaytimeTimelapse.acceptPendingOffer(),"reflection repair fixture should accept Mara's job");
    world.entities.hoodedWoman.mind.beliefs=[{id:"belief_deliberate_lie",text:"I sometimes hide what I mean when I feel exposed.",confidence:0.6,activation:0.2}];
    const beforeReflectionActivation=world.entities.hoodedWoman.mind.beliefs[0].activation;
    let invalidReflectionCalls=0;
    const invalidReflectionClient={
        async chat(messages){ return this.chatWithOptions(messages); },
        async chatWithOptions(messages){
            const mindResponse=mindProtocolResponse(messages); if(mindResponse) return mindResponse;
            const system=String(messages&&messages[0]&&messages[0].content||"");
            if(system.includes("Generate public world narration for one already-committed")) return {ok:true,content:"Mara sorts herbs and keeps the Traveler busy with simple work around the cottage.",modelId:"test",usage:{}};
            if(system.includes("sponsoring character choosing the reward")) return {ok:true,content:'{"items":[{"definitionId":"healingSalve","count":1}]}',modelId:"test",usage:{}};
            if(system.includes("private post-timelapse reflection")){
                invalidReflectionCalls++;
                return {ok:true,content:JSON.stringify({memoryUpdates:{
                    relationshipsToUpsert:[{targetCharacterId:"mara",summary:"This deliberately invalid display-name-derived target should be repaired or dropped."}],
                    activatedBeliefIds:["belief_deliberate_lie"]
                }}),modelId:"test",usage:{}};
            }
            throw new Error("Unexpected reflection repair fixture request: "+system.slice(0,120));
        }
    };
    const oldMaintainTimelapse=setup.MemoryConsolidator.maintainTimelapse;
    const oldReflectionWeather=setup.WorldEnvironment.refreshWeather;
    setup.MemoryConsolidator.maintainTimelapse=async function(characterId){
        if(characterId==="hoodedWoman") return {ok:false,error:{code:"TEST_MAINTENANCE_FAILURE",message:"fixture maintenance failure"}};
        return {ok:true,report:{stages:[],errors:[]}};
    };
    setup.WorldEnvironment.refreshWeather=async()=>({ok:true});
    const partialMindDay=await setup.DaytimeTimelapse.run(invalidReflectionClient);
    setup.MemoryConsolidator.maintainTimelapse=oldMaintainTimelapse;
    setup.WorldEnvironment.refreshWeather=oldReflectionWeather;
    ok(partialMindDay,"invalid relationship target plus maintenance failure should not undo an already committed day");
    world=setup.Game.getWorld();
    assert(partialMindDay.committedRounds===5&&world.environment.timePhase==="evening"&&invalidReflectionCalls===2,
        "reflection should receive one bounded repair attempt and the completed day should still transition to Evening");
    const partialReflection=partialMindDay.reflections.find(r=>r.characterId==="hoodedWoman");
    assert(partialReflection&&partialReflection.partial===true&&partialReflection.droppedRelationshipTargetIds.includes("mara")&&
        world.entities.hoodedWoman.mind.beliefs.find(b=>b.id==="belief_deliberate_lie").activation>beforeReflectionActivation&&
        !world.entities.hoodedWoman.mind.relationships.some(r=>r.targetCharacterId==="mara"),
        "failed relationship-ID repair should drop only the malformed relationship while preserving the separable valid belief-activation reflection signal");
    assert(partialMindDay.mindProcessingErrors.some(e=>e.stage==="maintenance"&&e.error.code==="TEST_MAINTENANCE_FAILURE"),
        "non-fatal maintenance failure should remain explicit in timelapse diagnostics");

    // A reflection request failure itself is also diagnostic-only after five committed rounds.
    world=fresh("blacksmith");
    world.environment.timePhase="morning";
    ok(setup.TimelapseAPI.moveToLocation("blacksmith","villageSmithy"),"Harlan reflection-failure fixture should be at his forge");
    ok(setup.TimelapseAPI.moveToLocation("player","villageSmithy"),"Traveler reflection-failure fixture should reach Harlan");
    ok(setup.CharacterAPI.perform("blacksmith",{type:"offer_day_work",activity_id:"forgeAssistance"}),"Harlan should offer work for reflection failure fixture");
    ok(setup.DaytimeTimelapse.acceptPendingOffer(),"reflection failure fixture should accept Harlan's job");
    const reflectionFailureClient={
        async chat(messages){ return this.chatWithOptions(messages); },
        async chatWithOptions(messages){
            const mindResponse=mindProtocolResponse(messages); if(mindResponse) return mindResponse;
            const system=String(messages&&messages[0]&&messages[0].content||"");
            if(system.includes("Generate public world narration for one already-committed")) return {ok:true,content:"Harlan works the forge while the Traveler handles auxiliary tasks.",modelId:"test",usage:{}};
            if(system.includes("sponsoring character choosing the reward")) return {ok:true,content:'{"gold":3}',modelId:"test",usage:{}};
            if(system.includes("private post-timelapse reflection")) return {ok:false,error:{code:"TEST_REFLECTION_FAILURE",message:"fixture reflection request failure"}};
            throw new Error("Unexpected reflection failure fixture request: "+system.slice(0,120));
        }
    };
    const oldReflectionFailureWeather=setup.WorldEnvironment.refreshWeather; setup.WorldEnvironment.refreshWeather=async()=>({ok:true});
    const reflectionFailureDay=await setup.DaytimeTimelapse.run(reflectionFailureClient);
    setup.WorldEnvironment.refreshWeather=oldReflectionFailureWeather;
    ok(reflectionFailureDay,"reflection request failure should be non-fatal after a fully committed and settled day");
    world=setup.Game.getWorld();
    assert(world.environment.timePhase==="evening"&&reflectionFailureDay.committedRounds===5&&
        reflectionFailureDay.mindProcessingErrors.some(e=>e.stage==="reflection-prepare"&&e.error.code==="TEST_REFLECTION_FAILURE"),
        "completed daytime timelapse must reach Evening while retaining reflection failure diagnostics");

    // Solo hunting entry, deterministic reward range, and one 10% secret-location roll per completed day.
    world=fresh(null);
    world.environment.timePhase="morning";
    ok(setup.TimelapseAPI.moveToLocation("player","forestMountainStream"),"Traveler should reach stream");
    const huntingView=setup.CharacterAPI.getView("player");
    assert(huntingView.available_actions.go_hunting,"Go hunting should be available at stream in Morning");
    ok(setup.CharacterAPI.perform("player",{type:"go_hunting"}),"Go hunting should activate solo daytime activity");
    const oldRefresh2=setup.WorldEnvironment.refreshWeather; setup.WorldEnvironment.refreshWeather=async()=>({ok:true});
    let huntingRandomValues=[0.5,0.91], huntingRandomCalls=0;
    const huntingRandom=function(){ huntingRandomCalls++; return huntingRandomValues.shift(); };
    const huntResult=await setup.DaytimeTimelapse.run(fakeCharacterClient(),{random:huntingRandom});
    ok(huntResult,"solo hunting should complete");
    world=setup.Game.getWorld();
    const pelts=world.inventories[world.entities.player.inventoryId].itemIds.filter(id=>world.entities[id]&&world.entities[id].definitionId==="squirrelPelt");
    assert(pelts.length===3,"0.5 RNG should produce three squirrel pelts from 1-5 inclusive");
    assert(huntingRandomCalls===2&&setup.GameInternals.characterHasDiscoveredLocation("player","trampledGlade",world),
        "a completed undiscovered hunting day should make exactly one reward roll and one generic weighted outcome roll, with the final 10 weight units revealing the glade");
    assert(huntResult.hiddenNarrativeEntries.filter(e=>e.kind==="daytime_hunting"&&e.visibleToHuman).length===5&&
        huntResult.hiddenNarrativeEntries.some(e=>e.kind==="location_discovered"&&e.visibleToHuman&&e.text.includes("concealed way")),
        "successful hunting discovery should add one grounded visible result without moving the Traveler");
    assert(world.entities.player.locationId==="forestMountainStream","hunting discovery must not teleport the Traveler into the secret location");

    world=fresh(null);
    world.environment.timePhase="morning";
    ok(setup.TimelapseAPI.moveToLocation("player","forestMountainStream"),"failed discovery Traveler should reach stream");
    ok(setup.CharacterAPI.perform("player",{type:"go_hunting"}),"failed discovery hunting should activate");
    huntingRandomValues=[0.5,0.89]; huntingRandomCalls=0;
    const failedDiscoveryDay=await setup.DaytimeTimelapse.run(fakeCharacterClient(),{random:huntingRandom});
    ok(failedDiscoveryDay,"hunting day with failed discovery roll should still complete");
    world=setup.Game.getWorld();
    assert(huntingRandomCalls===2&&!setup.GameInternals.characterHasDiscoveredLocation("player","trampledGlade",world)&&
        !failedDiscoveryDay.hiddenNarrativeEntries.some(e=>e.kind==="location_discovered"),
        "the first 90 weight units must select the generic no-outcome bucket and must not reveal Trampled Glade");

    world=fresh(null);
    world.environment.timePhase="morning";
    setup.GameInternals.grantLocationDiscovery("player","trampledGlade",world);
    ok(setup.TimelapseAPI.moveToLocation("player","forestMountainStream"),"already-discovered Traveler should reach stream");
    ok(setup.CharacterAPI.perform("player",{type:"go_hunting"}),"already-discovered hunting should activate");
    huntingRandomValues=[0.5,0.25]; huntingRandomCalls=0;
    const knownDiscoveryDay=await setup.DaytimeTimelapse.run(fakeCharacterClient(),{random:huntingRandom});
    setup.WorldEnvironment.refreshWeather=oldRefresh2;
    ok(knownDiscoveryDay,"hunting after discovery should still complete normally");
    assert(huntingRandomCalls===2&&!knownDiscoveryDay.hiddenNarrativeEntries.some(e=>e.kind==="location_discovered"),
        "once the location is known, the reveal outcome is inapplicable; the generic completion table may still resolve its no-outcome bucket without duplicating discovery");

    // Timelapse study: a keyed room container exposes its contents only to a direct key holder.
    world=fresh(null);
    ok(setup.TimelapseAPI.moveToLocation("hoodedWoman","secludedCottage"),"Mara should reach cottage");
    ok(setup.TimelapseAPI.moveToLocation("nell","secludedCottage"),"Nell should reach cottage while its entrance is canonically unlocked");
    let catalog=setup.TimelapseAPI.getReachableCatalog("hoodedWoman");
    let cottage=catalog.find(x=>x.id==="secludedCottage");
    assert(cottage&&cottage.studyItems.some(x=>x.id==="arcaneKnowledgeSlab_01"),"Mara should see the Slab in her keyed chest during timelapse because she directly carries its key");
    const nellLockedCatalog=setup.TimelapseAPI.getReachableCatalog("nell");
    const nellLockedCottage=nellLockedCatalog.find(x=>x.id==="secludedCottage");
    assert(nellLockedCottage&&!nellLockedCottage.studyItems.some(x=>x.id==="arcaneKnowledgeSlab_01"),"Nell should not receive study_item access to the Slab while it is protected by Mara's chest key");
    ok(setup.CharacterAPI.perform("hoodedWoman",{type:"give_item",target_id:"nell",item_id:"maraChestKey"}),"Mara should be able to transfer the ordinary chest key to Nell");
    const nellUnlockedCatalog=setup.TimelapseAPI.getReachableCatalog("nell");
    const nellUnlockedCottage=nellUnlockedCatalog.find(x=>x.id==="secludedCottage");
    assert(nellUnlockedCottage&&nellUnlockedCottage.studyItems.some(x=>x.id==="arcaneKnowledgeSlab_01"),"transferring the exact key should immediately grant Nell timelapse access to the protected Slab");
    const study=ok(setup.TimelapseAPI.executeAction("nell","secludedCottage",{type:"study_item",itemId:"arcaneKnowledgeSlab_01",inputText:"protective wards"}),"authorized timelapse study should reuse abstract_study");
    assert(study.type==="study_item"&&world.entities.arcaneKnowledgeSlab_01.abstractStudyProgressByCharacterId.nell.depth===1,"study progress should be stored on the Slab per authorized reader");
    const articleStudy=ok(setup.TimelapseAPI.executeAction("nell","secludedCottage",{type:"study_item",itemId:"arcaneKnowledgeSlab_01",inputText:"otherworldly visitors"}),"timelapse study should resolve authored slab articles through the same abstract_study path");
    assert(articleStudy.studyStage==="article"&&articleStudy.knowledgeEntryId==="outer_world_construct_hypothesis"&&
        articleStudy.privateExperienceText.includes("archmages of Veyra")&&!articleStudy.text.includes("archmages of Veyra"),
        "timelapse article content should be private reader experience while public activity remains a generic consultation description");

    // Timelapse passage traversal respects persistent lock state without synthesizing unlock/relock.
    world=fresh(null);
    ok(setup.TimelapseAPI.moveToLocation("innkeeper","upstairsCorridor"),"Garrick should reach the upstairs corridor");
    const lockedBefore=world.entities.upstairsCorridor.exits.guestRoom1.locked;
    assert(lockedBefore===true,"Guest Room 1 should begin canonically locked");
    const innkeeperLockedCatalog=setup.TimelapseAPI.getReachableCatalog("innkeeper");
    assert(innkeeperLockedCatalog.some(x=>x.id==="guestRoom1"),"a timelapse actor carrying the matching passage key should treat a locked passage as traversable");
    ok(setup.TimelapseAPI.moveToLocation("innkeeper","guestRoom1"),"Garrick should traverse the locked room door during timelapse without a synthetic unlock action");
    assert(world.entities.upstairsCorridor.exits.guestRoom1.locked===true&&world.entities.guestRoom1.exits.upstairsCorridor.locked===true,"key-holder timelapse traversal must not mutate persistent canonical lock state");
    ok(setup.TimelapseAPI.moveToLocation("nell","upstairsCorridor"),"Nell should reach the corridor for no-key traversal fixture");
    assert(!setup.TimelapseAPI.getReachableCatalog("nell").some(x=>x.id==="guestRoom1"),"a locked passage should remain unavailable in timelapse to a character without its key");
    ok(setup.CharacterAPI.perform("innkeeper",{type:"unlock",destination_id:"upstairsCorridor"}),"Garrick should formally unlock the room in ordinary gameplay");
    assert(world.entities.upstairsCorridor.exits.guestRoom1.locked===false&&world.entities.guestRoom1.exits.upstairsCorridor.locked===false,"ordinary unlock should persistently update both directions of the canonical passage");
    assert(setup.TimelapseAPI.getReachableCatalog("nell").some(x=>x.id==="guestRoom1"),"once canonically unlocked, the passage should remain traversable to Nell without a key across timelapse pathfinding");

    // Fresh-world weather initialization must resolve before first gameplay through the same refresh/fallback pipeline.
    world=fresh(null);
    setup.AIRuntimeSettings.forget(storage);
    let startupWeatherFetchCalls=0;
    const startupFallback=await setup.WorldEnvironment.ensureWeatherInitialized(null,{fetchImpl:async function(){startupWeatherFetchCalls++;throw new Error("startup weather fetch should not run without an AI key");}});
    assert(!startupFallback.ok&&startupFallback.fallbackUsed===true&&startupWeatherFetchCalls===0&&
        world.environment.weatherInitialized===true&&world.environment.weatherSource==="fallback"&&world.environment.weatherNarrative===setup.WorldEnvironment.FALLBACK_WEATHER,
        "fresh world without an API key should commit the canonical shared weather fallback without blocking startup or making unnecessary network calls");
    const initializedWeather=await setup.WorldEnvironment.ensureWeatherInitialized(null,{fetchImpl:async function(){throw new Error("already initialized weather must not refresh");}});
    assert(initializedWeather.ok&&initializedWeather.skipped===true,"once startup weather is initialized, reopening gameplay should not refetch it");
    setup.AIRuntimeSettings.save("sk-or-v1-test-daytime-key-1234567890", false, storage, Date.now());


    // A startup weather request that becomes stale may finish its network work but must not mutate canonical weather or fall back into a newer period.
    world=fresh(null);
    world.environment.weatherInitialized=false;
    world.environment.weatherNarrative=setup.WorldEnvironment.FALLBACK_WEATHER;
    world.environment.weatherSource="fallback";
    let startupApplicable=true, releaseStartupGeo;
    const startupGeoGate=new Promise(resolve=>{releaseStartupGeo=resolve;});
    let staleStartupFetchCalls=0;
    const staleStartupFetch=async function(url){
        staleStartupFetchCalls++;
        if(url===setup.WorldEnvironment.IP_GEOLOCATION_URL){
            await startupGeoGate;
            return {ok:true,status:200,statusText:"OK",json:async()=>({success:true,latitude:50.45,longitude:30.52})};
        }
        return {ok:true,status:200,statusText:"OK",json:async()=>({current:{temperature_2m:12,precipitation:0,rain:0,snowfall:0,cloud_cover:20,weather_code:1,wind_speed_10m:4}})};
    };
    const staleWeatherClient={async chat(){return {ok:true,content:"A light breeze moves beneath scattered cloud.",modelId:"test",usage:{}};}};
    const staleStartupPromise=setup.WorldEnvironment.ensureWeatherInitialized(staleWeatherClient,{inFlightKey:"startup-test",fetchImpl:staleStartupFetch,shouldCommit:()=>startupApplicable});
    await Promise.resolve();
    startupApplicable=false;
    releaseStartupGeo();
    const staleStartupResult=await staleStartupPromise;
    assert(staleStartupResult&&staleStartupResult.stale===true&&staleStartupResult.skipped===true&&staleStartupFetchCalls===2&&
        world.environment.weatherInitialized===false&&world.environment.weatherSource==="fallback"&&world.environment.weatherNarrative===setup.WorldEnvironment.FALLBACK_WEATHER,
        "a stale startup weather result must be discarded without committing real weather or canonical fallback into the advanced simulation state");

    // Weather: CORS-friendly IP lookup -> Open-Meteo -> narrator, independent of the optional presentation Narrator toggle.
    world=fresh(null);
    setup.RuntimeDiagnostics.clear();
    setup.NarratorService={isEnabled:function(){return false;}};
    let capturedMessages=null, weatherCall=0; const weatherUrls=[];
    const fetchImpl=async function(url){ weatherUrls.push(url); weatherCall++; if(weatherCall===1)return{ok:true,status:200,statusText:"OK",json:async()=>({success:true,ip:"203.0.113.9",latitude:50.45,longitude:30.52})}; return{ok:true,status:200,statusText:"OK",json:async()=>({current:{temperature_2m:12,precipitation:0.4,rain:0.4,snowfall:0,cloud_cover:90,weather_code:61,wind_speed_10m:14}})}; };
    const weatherClient={async chat(messages){capturedMessages=messages;return{ok:true,content:"Cool rain falls beneath low cloud while a brisk breeze stirs the wet grass.",modelId:"test",usage:{}};}};
    const weatherResult=await setup.WorldEnvironment.refreshWeather(weatherClient,{fetchImpl});
    ok(weatherResult,"real weather pipeline should initialize from fake public APIs");
    assert(weatherUrls[0]===setup.WorldEnvironment.IP_GEOLOCATION_URL&&weatherUrls[0]==="https://ipwho.is/"&&weatherUrls[1].startsWith(setup.WorldEnvironment.WEATHER_URL),"weather should use the browser-CORS IP lookup followed by Open-Meteo");
    assert(world.environment.weatherNarrative.includes("Cool rain")&&world.environment.weatherInitialized&&world.environment.weatherSource==="real_weather","narrated weather should be canonical state even when the presentation Narrator is disabled");
    assert(!JSON.stringify(capturedMessages).toLowerCase().includes('"morning"')&&!JSON.stringify(capturedMessages).toLowerCase().includes('"evening"'),"weather narrator must not receive game time phase");
    const networkLog=setup.RuntimeDiagnostics.getNetworkLog();
    assert(networkLog.count===2&&networkLog.entries[0].stage==="ip-geolocation"&&networkLog.entries[1].stage==="weather-fetch"&&!JSON.stringify(networkLog).includes("203.0.113.9"),"external weather fetches should be logged without exporting the caller IP");
    const weatherDiagnostics=setup.WorldEnvironment.getWeatherDiagnostics();
    assert(weatherDiagnostics.ok===true&&weatherDiagnostics.stage==="weather-commit"&&weatherDiagnostics.failedStage===null,"successful weather refresh should retain pipeline diagnostics");
    const savedWeather=world.environment.weatherNarrative;
    const failed=await setup.WorldEnvironment.refreshWeather(weatherClient,{fetchImpl:async()=>{throw new Error("offline");}});
    assert(!failed.ok&&failed.failedStage==="ip-geolocation"&&world.environment.weatherNarrative===savedWeather,"weather failure should preserve previous narrative and identify the failed stage");
    const failedWeatherDiagnostics=setup.WorldEnvironment.getWeatherDiagnostics();
    const failedNetworkLog=setup.RuntimeDiagnostics.getNetworkLog();
    assert(failedWeatherDiagnostics.ok===false&&failedWeatherDiagnostics.failedStage==="ip-geolocation"&&failedNetworkLog.entries.slice(-1)[0].ok===false,"weather/network diagnostics should preserve the concrete failed external stage");

    // Legacy migration preserves saved weather when present and defaults phase if absent.
    world=fresh(null);
    const saved=JSON.parse(JSON.stringify(world));
    saved.schemaVersion=9;
    saved.environment={timePhase:"morning",weatherNarrative:"A dry wind moves through pale cloud.",weatherInitialized:true,weatherSource:"saved"};
    State.variables.world=saved;
    ok(setup.SaveMigration.migrate(),"schema 9 save should migrate to current runtime");
    world=setup.Game.getWorld();
    assert(world.environment.timePhase==="morning"&&world.environment.weatherNarrative==="A dry wind moves through pale cloud.","migration should preserve existing environment state");

    const schedulerSource=fs.readFileSync(path.join(root,"src/24-ai-turn-scheduler.js"),"utf8");
    assert(schedulerSource.includes("pausedForDayOffer")&&schedulerSource.includes("alreadyReactedCharacterIds"),"scheduler must pause on formal work offer and support resume without duplicate reactions");
    const uiSource=fs.readFileSync(path.join(root,"src/30-game-ui.js"),"utf8");
    assert(uiSource.includes("framework-day-work-overlay")&&uiSource.includes("framework-global-emergency-dump"),"custom blocking offer overlay and globally available Emergency Dump must exist");
    console.log("All daytime, jobs, environment, and weather tests passed.");
}

main().catch(error=>{console.error(error&&error.stack||error);process.exitCode=1;});
