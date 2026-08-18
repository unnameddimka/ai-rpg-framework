"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.resolve(__dirname, "..");

function memoryStorage() {
    const values = new Map();
    return { getItem:k=>values.has(k)?values.get(k):null, setItem:(k,v)=>values.set(k,String(v)), removeItem:k=>values.delete(k) };
}
const storage = memoryStorage();
global.window = { localStorage: storage };
global.localStorage = storage;
global.setup = {};
global.State = { variables: {}, passage: "The Tavern" };
global.Engine = { play:function(){}, show:function(){} };
function load(file) { vm.runInThisContext(fs.readFileSync(path.join(root,file),"utf8"), { filename:file }); }
function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
function assert(v,m) { if(!v) throw new Error(m); }
function close(a,b,eps,m) { assert(Math.abs(a-b) <= (eps||1e-9), `${m}: ${a} vs ${b}`); }
function ok(r,m) { assert(r && r.ok, `${m}: ${JSON.stringify(r)}`); return r; }
function sleep(ms) { return new Promise(resolve=>setTimeout(resolve,ms)); }

function stm(id, topic, summary, importance, protectedFlag) {
    return { id, topic:topic||`Topic ${id}`, summary:summary||`Summary ${id}`, importance:importance===undefined?0.5:importance, protected:protectedFlag===true };
}
function belief(id,text,confidence,activation) {
    return { id, text:text||id, confidence:confidence===undefined?0.6:confidence, activation:activation===undefined?0.4:activation };
}
function verbatim(i, prefix) {
    return { id:`verbatim_test_${prefix||"v"}_${i}`, turn:i+1, kind:"observation", actorId:"traveler", text:`${prefix||"observation"} ${i}` };
}
function emptyStmResult(overrides) {
    return Object.assign({ shortTermMemoriesToUpsert:[], shortTermMemoriesToAdd:[], beliefEffects:[], beliefsToAdd:[], activatedBeliefIds:[] }, overrides||{});
}
function emptyLtmResult(overrides) {
    return Object.assign({ longTermMemoriesToUpsert:[], longTermMemoriesToAdd:[], retirementGroups:[], higherOrderBeliefEffects:[], beliefsToAdd:[], activatedBeliefIds:[] }, overrides||{});
}
function emptyReconciliation(overrides) {
    return Object.assign({ resolutions:[], activatedBeliefIds:[] }, overrides||{});
}
function addTestLtmEvidence(value, payload) {
    if (!value || typeof value !== "object" || !payload || payload.stage !== "mind-v3-ltm") return value;
    const output=clone(value);
    const skip=output.__noAutoLtmEvidence===true;
    delete output.__noAutoLtmEvidence;
    if (skip) return output;
    const defaultStm=(payload.shortTermMemories||[]).slice(0,1).map(m=>m.id);
    const defaultLtm=(payload.existingLongTermMemories||[]).slice(0,1).map(m=>m.id);
    ["longTermMemoriesToUpsert","longTermMemoriesToAdd"].forEach(key=>{
        (output[key]||[]).forEach(record=>{
            if (!Object.prototype.hasOwnProperty.call(record,"sourceStmIds")) record.sourceStmIds=defaultStm.slice();
            if (!Object.prototype.hasOwnProperty.call(record,"sourceLtmIds")) record.sourceLtmIds=defaultStm.length?[]:defaultLtm.slice();
        });
    });
    (output.retirementGroups||[]).forEach(group=>{
        if (group.disposition==="safe_to_forget" && !Object.prototype.hasOwnProperty.call(group,"reason")) group.reason="routine";
    });
    return output;
}
function scriptedClient(handler, seen) {
    return { enforceRequestTiming:false, chat:async function(messages) {
        const payload = JSON.parse(messages[1].content);
        if (seen) seen.push({ messages:clone(messages), payload:clone(payload) });
        let value = await handler(payload, messages);
        if (value && value.__failure) return { ok:false, modelId:"test", error:value.error||{code:"TEST_FAILURE",message:"failed"} };
        if (value && value.__raw !== undefined) return { ok:true, modelId:"test", content:value.__raw, usage:null };
        value=addTestLtmEvidence(value,payload);
        return { ok:true, modelId:"test", content:JSON.stringify(value), usage:{prompt_tokens:10,completion_tokens:5} };
    }};
}

[
"src/00-model-list.js","src/generated/world-data.js","src/07-mind-v3.js","src/08-mind-validators.js","src/10-game-api.js","src/11-save-migration.js",
"src/12-character-context.js","src/13-character-memory.js","src/13-verbatim-memory.js","src/14-event-perception.js","src/21-ai-settings.js","src/21-ai-request-profiles.js",
"src/22-openrouter-client.js","src/23-ai-protocol.js","src/24-ai-request-executor.js","src/24-ai-turn-scheduler.js","src/20-controllers.js","src/24-memory-consolidator.js","src/24-mind-aux-executor.js"
].forEach(load);

function resetMind() {
    setup.Game.resetWorld();
    setup.Game.acceptPlayerDisclaimer();
    setup.Game.finalizePlayerSetup({ mode:"generic" });
    const world=setup.Game.getWorld();
    const actor=world.entities.hoodedWoman;
    actor.mind.schemaVersion=3;
    actor.mind.verbatimObservations=[];
    actor.mind.shortTermMemories=[];
    actor.mind.longTermMemories=[];
    actor.mind.beliefs=[];
    actor.mind.relationships=[];
    actor.mind.pendingObservations=[];
    actor.mindRevision=0;
    actor.mindDiagnostics={beliefHistoryById:{}};
    actor.mindMaintenanceSnapshots=[];
    return {world,actor};
}

async function main() {
    setup.AIRuntimeSettings.save("sk-or-v1-test-memory-consolidation-key-1234567890", false, storage, Date.now());

    const stmProfile=setup.AIRequestProfiles.resolve("mind-v3-stm",{actorId:"hoodedWoman"});
    const genericMaintenanceProfile=setup.AIRequestProfiles.resolve("memory-consolidation",{actorId:"hoodedWoman"});
    const ltmProfile=setup.AIRequestProfiles.resolve("mind-v3-ltm",{actorId:"hoodedWoman"});
    assert(stmProfile.modelRole==="utility" && stmProfile.maxTokens===6000 && stmProfile.reasoningMaxTokens===0 && stmProfile.reasoningEffort==="none", "Mind v3 STM must use dedicated high-headroom Utility profile");
    assert(genericMaintenanceProfile.maxTokens===2400, "generic maintenance/reconciliation profile must retain existing budget");
    assert(ltmProfile.modelRole==="utility" && ltmProfile.maxTokens===12000 && ltmProfile.reasoningMaxTokens===0, "Mind v3 LTM must use dedicated 12k Utility profile");

    // Shared semantics and engine-owned math.
    assert(setup.MindV3.BELIEF_SEMANTICS.includes("not objective facts") && setup.MindV3.BELIEF_SEMANTICS.includes("activation"), "belief semantics must distinguish subjective beliefs and activation");
    const p=0.72;
    const supported=setup.MindV3.updateConfidence(p,"supports",0.8);
    const contradicted=setup.MindV3.updateConfidence(p,"contradicts",0.8);
    assert(supported>p && supported<1, "support must raise confidence without certainty");
    assert(contradicted<p && contradicted>0, "contradiction must lower confidence without zero");
    close(setup.MindV3.updateConfidence(p,"ambiguous",1),p,1e-12,"ambiguous evidence must not move confidence");
    assert((setup.MindV3.updateConfidence(0.99,"supports",0.8)-0.99) < (setup.MindV3.updateConfidence(0.55,"supports",0.8)-0.55), "log-odds update must saturate near certainty");
    const lowBump=setup.MindV3.bumpActivation(0.2,0.8,false)-0.2;
    const highBump=setup.MindV3.bumpActivation(0.8,0.8,false)-0.8;
    assert(lowBump>highBump && highBump>0, "activation bump must saturate");

    // Verbatim records are compact experienced history, not scheduler envelopes.
    let fixture=resetMind();
    const appended=setup.VerbatimMemory.appendFromObservation("hoodedWoman",{id:"pending_1",turn:9,kind:"speech",actorId:"traveler",text:"Hello Mara",data:{secretSchedulerField:"nope"}},fixture.world);
    assert(appended && appended.text==="Hello Mara", "delivered observation must append to verbatim");
    assert(!("data" in appended) && !("secretSchedulerField" in appended), "verbatim must omit scheduler metadata");
    const own=setup.VerbatimMemory.appendOwnEvent("hoodedWoman",{id:123,type:"speech",actorId:"hoodedWoman",text:"Hello back"},fixture.world);
    assert(own && own.sourceEventId===123, "own committed event must append to verbatim");
    assert(setup.VerbatimMemory.appendOwnEvent("hoodedWoman",{id:124,type:"speech",actorId:"traveler",text:"not mine"},fixture.world)===null, "another actor's raw event must not become own verbatim");

    // Strict threshold: 40 is idle, 41 uses the complete snapshot and evicts 21.
    fixture=resetMind(); fixture.actor.mind.verbatimObservations=Array.from({length:40},(_,i)=>verbatim(i,"forty"));
    let calls=0;
    let result=await setup.MemoryConsolidator.consolidateSTM("hoodedWoman",scriptedClient(()=>{calls++;return emptyStmResult();}));
    ok(result,"40 observation no-op");
    assert(result.nothingToConsolidate===true && calls===0 && fixture.actor.mind.verbatimObservations.length===40, "40 observations must not trigger ordinary consolidation");

    fixture=resetMind(); fixture.actor.mind.verbatimObservations=Array.from({length:41},(_,i)=>verbatim(i,"fortyone"));
    const seen41=[];
    result=await setup.MemoryConsolidator.consolidateSTM("hoodedWoman",scriptedClient(payload=>{
        assert(payload.stage==="mind-v3-stm", "STM request stage must be Mind v3");
        assert(payload.completeVerbatimSnapshot.length===41, "41-trigger must send all 41 observations");
        assert(payload.evictionObservationIds.length===21 && payload.retainedObservationIds.length===20, "41-trigger must evict 21 and retain newest 20");
        assert(payload.beliefSemantics===setup.MindV3.BELIEF_SEMANTICS, "STM request must carry shared belief semantics");
        return emptyStmResult({shortTermMemoriesToAdd:[{topic:"Recent encounter",summary:"The older part of the encounter remains remembered.",importance:0.7}]});
    },seen41));
    ok(result,"41 observation consolidation");
    let actor=setup.Game.getWorld().entities.hoodedWoman;
    assert(actor.mind.verbatimObservations.length===20 && actor.mind.verbatimObservations[0].id==="verbatim_test_fortyone_21", "successful STM commit must remove exact older 21");
    assert(actor.mind.shortTermMemories.length===1 && actor.mind.shortTermMemories[0].topic==="Recent encounter", "STM add must commit thematically");
    assert(seen41[0].messages[0].content.includes("ONLY evictionObservationIds are newly consumed evidence") && seen41[0].messages[0].content.includes("Retained observations remain verbatim"), "prompt must explicitly distinguish eviction evidence from retained context");
    assert(seen41[0].messages[0].content.includes("Group related observations into a small number of thematic memories") && seen41[0].messages[0].content.includes("importance MUST be a numeric decimal in the inclusive range 0..1") && seen41[0].messages[0].content.includes("do NOT use a 1..10 scale"), "STM prompt must require thematic grouping and canonical importance scale");
    const stmExchange=setup.AIRequestExecutor.getExchangeHistory().entries.slice(-1)[0];
    assert(stmExchange.request.stage==="mind-v3-stm" && stmExchange.request.requestOptions.profile==="mind-v3-stm" && stmExchange.request.requestOptions.maxTokens===6000, "STM execution must use dedicated request profile");

    // Production write-set regression: a developed migrated mind must produce a bounded delta, not rewrite all existing STM.
    fixture=resetMind();
    fixture.actor.mind.verbatimObservations=Array.from({length:48},(_,i)=>verbatim(i,"developed"));
    fixture.actor.mind.shortTermMemories=Array.from({length:61},(_,i)=>stm(`memory_ai_${3000+i}`,`Legacy topic ${i}`,`Legacy summary ${i}`,0.4+(i%5)*0.1,false));
    const developedBefore=clone(fixture.actor.mind.shortTermMemories);
    const developedSeen=[];
    result=await setup.MemoryConsolidator.consolidateSTM("hoodedWoman",scriptedClient(payload=>{
        assert(payload.stmWritePolicy && payload.stmWritePolicy.mode==="delta-only", "STM payload must expose delta-only write policy");
        assert(payload.stmWritePolicy.maxMemoryWrites===setup.MindV3.CONFIG.STM_WRITE_SET_LIMIT && payload.stmWritePolicy.maxBeliefEffects===setup.MindV3.CONFIG.STM_BELIEF_EFFECT_LIMIT, "STM payload write limits must derive from centralized Mind v3 config");
        assert(payload.stmWritePolicy.unchangedExistingStm==="omit" && payload.stmWritePolicy.legacyCleanup==="forbidden", "STM payload must forbid legacy cleanup and require omission of unchanged STM");
        assert(payload.existingShortTermMemories.length===61 && payload.completeVerbatimSnapshot.length===48 && payload.evictionObservationIds.length===28, "developed-mind request must retain full existing STM context and full-buffer eviction semantics");
        return emptyStmResult({
            shortTermMemoriesToUpsert:[{id:"memory_ai_3030",topic:"Legacy topic 30",summary:"Legacy summary 30, extended by the newly consumed conversation.",importance:0.7}],
            shortTermMemoriesToAdd:[{topic:"Current transition conversation",summary:"The recent conversation established a new distinct thread without rewriting unrelated older memories.",importance:0.8}]
        });
    },developedSeen));
    ok(result,"developed-mind bounded STM delta");
    actor=setup.Game.getWorld().entities.hoodedWoman;
    assert(actor.mind.verbatimObservations.length===20 && actor.mind.shortTermMemories.length===62, "bounded developed-mind delta must commit exact eviction plus one add");
    for (let i=0;i<61;i++) {
        if (i===30) continue;
        assert(JSON.stringify(actor.mind.shortTermMemories[i])===JSON.stringify(developedBefore[i]), `unrelated existing STM ${i} must remain byte-for-byte unchanged`);
    }
    assert(developedSeen[0].messages[0].content.includes("DELTA-ONLY WRITE SET") && developedSeen[0].messages[0].content.includes("Never retopic, beautify") && developedSeen[0].messages[0].content.includes(`MUST be <= ${setup.MindV3.CONFIG.STM_WRITE_SET_LIMIT}`), "STM prompt must explicitly require bounded delta-only writes and forbid cleanup rewrites");

    // Oversized memory write sets are invalid as a whole; never truncate them into a partial commit.
    fixture=resetMind(); fixture.actor.mind.verbatimObservations=Array.from({length:41},(_,i)=>verbatim(i,"oversizedwrites"));
    const oversizedSourceIds=fixture.actor.mind.verbatimObservations.map(v=>v.id);
    result=await setup.MemoryConsolidator.consolidateSTM("hoodedWoman",scriptedClient(()=>emptyStmResult({
        shortTermMemoriesToAdd:Array.from({length:setup.MindV3.CONFIG.STM_WRITE_SET_LIMIT+1},(_,i)=>({topic:`Too many ${i}`,summary:`Oversized write ${i}`,importance:0.5}))
    })));
    assert(!result.ok,"STM response above combined write-set limit must fail validation");
    actor=setup.Game.getWorld().entities.hoodedWoman;
    assert(actor.mind.shortTermMemories.length===0 && actor.mind.verbatimObservations.map(v=>v.id).join("|")===oversizedSourceIds.join("|"), "oversized write-set failure must preserve all source verbatim and commit no partial STM");

    // Belief-effect output is independently bounded to prevent another completion blow-up channel.
    fixture=resetMind(); fixture.actor.mind.verbatimObservations=Array.from({length:41},(_,i)=>verbatim(i,"oversizedeffects"));
    fixture.actor.mind.beliefs=Array.from({length:setup.MindV3.CONFIG.STM_BELIEF_EFFECT_LIMIT+1},(_,i)=>belief(`belief_effect_${i}`,`Belief effect ${i}`,0.6,0.5));
    const oversizedEffectIds=fixture.actor.mind.verbatimObservations.map(v=>v.id);
    result=await setup.MemoryConsolidator.consolidateSTM("hoodedWoman",scriptedClient(()=>emptyStmResult({
        beliefEffects:fixture.actor.mind.beliefs.map(b=>({beliefId:b.id,effect:"supports",strength:0.2}))
    })));
    assert(!result.ok,"STM response above belief-effect limit must fail validation");
    actor=setup.Game.getWorld().entities.hoodedWoman;
    assert(actor.mind.verbatimObservations.map(v=>v.id).join("|")===oversizedEffectIds.join("|") && actor.mind.beliefs.every(b=>b.confidence===0.6), "oversized belief-effect failure must be atomic");

    // Exact no-op upserts are protocol noise and must be omitted rather than re-emitted.
    fixture=resetMind(); fixture.actor.mind.verbatimObservations=Array.from({length:41},(_,i)=>verbatim(i,"noopupsert"));
    fixture.actor.mind.shortTermMemories=[stm("memory_ai_3900","Already persisted","Nothing changed",0.5,false)];
    const noopBefore=clone(fixture.actor.mind);
    result=await setup.MemoryConsolidator.consolidateSTM("hoodedWoman",scriptedClient(()=>emptyStmResult({
        shortTermMemoriesToUpsert:[{id:"memory_ai_3900",topic:"Already persisted",summary:"Nothing changed",importance:0.5}]
    })));
    assert(!result.ok && JSON.stringify(setup.Game.getWorld().entities.hoodedWoman.mind)===JSON.stringify(noopBefore), "exact no-op STM upsert must fail and preserve source state");

    // 57 means full 57 snapshot and first 37 evicted, not a fixed 40 chunk.
    fixture=resetMind(); fixture.actor.mind.verbatimObservations=Array.from({length:57},(_,i)=>verbatim(i,"fiftyseven"));
    result=await setup.MemoryConsolidator.consolidateSTM("hoodedWoman",scriptedClient(payload=>{
        assert(payload.completeVerbatimSnapshot.length===57 && payload.evictionObservationIds.length===37 && payload.retainedObservationIds.length===20, "57 observations must use full-buffer 37/20 split");
        return emptyStmResult();
    }));
    ok(result,"57 observation consolidation");
    assert(setup.Game.getWorld().entities.hoodedWoman.mind.verbatimObservations.length===20, "57 consolidation must leave 20 verbatim");

    // New observations arriving in flight survive; exact snapshot can still commit.
    fixture=resetMind(); fixture.actor.mind.verbatimObservations=Array.from({length:41},(_,i)=>verbatim(i,"inflight"));
    result=await setup.MemoryConsolidator.consolidateSTM("hoodedWoman",scriptedClient(async payload=>{
        const current=setup.Game.getWorld().entities.hoodedWoman;
        current.mind.verbatimObservations.push(verbatim(100,"newarrival"));
        return emptyStmResult();
    }));
    ok(result,"in-flight append consolidation");
    actor=setup.Game.getWorld().entities.hoodedWoman;
    assert(actor.mind.verbatimObservations.length===21 && actor.mind.verbatimObservations.some(v=>v.id==="verbatim_test_newarrival_100"), "new in-flight observation must never be removed by old job");

    // Ordinary gameplay may raise belief activation while background STM is in flight.
    // That salience-only change must merge with the eventual consolidation rather than starving it as stale.
    fixture=resetMind(); fixture.actor.mind.verbatimObservations=Array.from({length:41},(_,i)=>verbatim(i,"activationrace"));
    fixture.actor.mind.beliefs=[belief("belief_focus","The Traveler respects my boundaries.",0.85,0.4)];
    let liveActivationAfterTurn=null;
    result=await setup.MemoryConsolidator.consolidateSTM("hoodedWoman",scriptedClient(async()=>{
        const turnUpdate=setup.AIMemory.applyTurnUpdates("hoodedWoman",{relationshipsToUpsert:[],activatedBeliefIds:["belief_focus"]});
        ok(turnUpdate,"activation-only ordinary turn update during STM request");
        const current=setup.Game.getWorld().entities.hoodedWoman;
        liveActivationAfterTurn=current.mind.beliefs[0].activation;
        assert(current.mindRevision===1,"ordinary activation update should still increment the coarse mind revision");
        return emptyStmResult({activatedBeliefIds:["belief_focus"]});
    }));
    ok(result,"activation-compatible in-flight STM consolidation");
    actor=setup.Game.getWorld().entities.hoodedWoman;
    const mergedBelief=actor.mind.beliefs.find(b=>b.id==="belief_focus");
    assert(actor.mind.verbatimObservations.length===20,"activation-compatible STM commit must still evict the exact older source observations");
    assert(mergedBelief && mergedBelief.activation>liveActivationAfterTurn,"STM activation must apply on top of the live activation, not restore snapshot salience");
    close(mergedBelief.activation,setup.MindV3.bumpActivation(liveActivationAfterTurn,0.35,false),1e-12,"STM activation must merge onto current activation deterministically");

    // Provider/invalid/stale results preserve all sources and commit nothing.
    fixture=resetMind(); fixture.actor.mind.verbatimObservations=Array.from({length:41},(_,i)=>verbatim(i,"providerfail"));
    const beforeFail=clone(fixture.actor.mind);
    result=await setup.MemoryConsolidator.consolidateSTM("hoodedWoman",scriptedClient(()=>({__failure:true,error:{code:"RATE_LIMITED",message:"429"}})));
    assert(!result.ok && JSON.stringify(setup.Game.getWorld().entities.hoodedWoman.mind)===JSON.stringify(beforeFail), "provider failure must preserve complete source mind");

    fixture=resetMind(); fixture.actor.mind.verbatimObservations=Array.from({length:41},(_,i)=>verbatim(i,"invalid"));
    const invalidBefore=clone(fixture.actor.mind);
    result=await setup.MemoryConsolidator.consolidateSTM("hoodedWoman",scriptedClient(()=>({__raw:"{bad"})));
    assert(!result.ok && JSON.stringify(setup.Game.getWorld().entities.hoodedWoman.mind)===JSON.stringify(invalidBefore), "invalid output after repair must preserve source mind");

    fixture=resetMind(); fixture.actor.mind.verbatimObservations=Array.from({length:41},(_,i)=>verbatim(i,"staleconfidence"));
    fixture.actor.mind.beliefs=[belief("belief_stale","A belief whose certainty changes.",0.6,0.4)];
    let staleIds=fixture.actor.mind.verbatimObservations.map(v=>v.id);
    result=await setup.MemoryConsolidator.consolidateSTM("hoodedWoman",scriptedClient(async()=>{
        const current=setup.Game.getWorld().entities.hoodedWoman;
        current.mind.beliefs[0].confidence=0.7;
        return emptyStmResult({shortTermMemoriesToAdd:[{topic:"Should not commit",summary:"Stale output",importance:0.9}]});
    }));
    assert(!result.ok && result.error.code==="MIND_V3_STALE", "concurrent belief confidence mutation must reject stale STM result even without relying on the coarse revision counter");
    actor=setup.Game.getWorld().entities.hoodedWoman;
    assert(actor.mind.verbatimObservations.map(v=>v.id).join("|")===staleIds.join("|") && actor.mind.shortTermMemories.length===0 && actor.mind.beliefs[0].confidence===0.7, "belief-content stale failure must preserve both source observations and the newer canonical belief state");

    fixture=resetMind(); fixture.actor.mind.verbatimObservations=Array.from({length:41},(_,i)=>verbatim(i,"stalestm"));
    fixture.actor.mind.shortTermMemories=[stm("memory_ai_70","Existing topic","Before concurrent change",0.5,false)];
    staleIds=fixture.actor.mind.verbatimObservations.map(v=>v.id);
    result=await setup.MemoryConsolidator.consolidateSTM("hoodedWoman",scriptedClient(async()=>{
        setup.Game.getWorld().entities.hoodedWoman.mind.shortTermMemories[0].summary="Changed by another canonical mind operation";
        return emptyStmResult({shortTermMemoriesToAdd:[{topic:"Should not commit",summary:"Stale output",importance:0.9}]});
    }));
    assert(!result.ok && result.error.code==="MIND_V3_STALE", "concurrent STM content mutation must reject stale STM result");
    actor=setup.Game.getWorld().entities.hoodedWoman;
    assert(actor.mind.verbatimObservations.map(v=>v.id).join("|")===staleIds.join("|") && actor.mind.shortTermMemories.length===1 && actor.mind.shortTermMemories[0].summary.includes("Changed by another"), "STM-content stale failure must preserve newer canonical STM and all source observations");

    fixture=resetMind(); fixture.actor.mind.verbatimObservations=Array.from({length:41},(_,i)=>verbatim(i,"stalerelationship"));
    fixture.actor.mind.relationships=[{targetCharacterId:"traveler",summary:"Earlier relationship state."}];
    staleIds=fixture.actor.mind.verbatimObservations.map(v=>v.id);
    result=await setup.MemoryConsolidator.consolidateSTM("hoodedWoman",scriptedClient(async()=>{
        setup.Game.getWorld().entities.hoodedWoman.mind.relationships[0].summary="Newer relationship state.";
        return emptyStmResult({shortTermMemoriesToAdd:[{topic:"Should not commit",summary:"Stale output",importance:0.9}]});
    }));
    assert(!result.ok && result.error.code==="MIND_V3_STALE", "concurrent relationship mutation must reject stale STM result");
    actor=setup.Game.getWorld().entities.hoodedWoman;
    assert(actor.mind.verbatimObservations.map(v=>v.id).join("|")===staleIds.join("|") && actor.mind.shortTermMemories.length===0 && actor.mind.relationships[0].summary==="Newer relationship state.", "relationship stale failure must preserve newer canonical relationship and all source observations");

    // Existing STM is upserted by stable ID; no duplicate is created.
    fixture=resetMind(); fixture.actor.mind.verbatimObservations=Array.from({length:41},(_,i)=>verbatim(i,"upsert"));
    fixture.actor.mind.shortTermMemories=[stm("memory_ai_7","Tavern banter","Old jokes",0.4,false)];
    result=await setup.MemoryConsolidator.consolidateSTM("hoodedWoman",scriptedClient(()=>emptyStmResult({shortTermMemoriesToUpsert:[{id:"memory_ai_7",topic:"Tavern banter",summary:"Old jokes plus the newer foam-technique jokes.",importance:0.65}]})));
    ok(result,"STM upsert");
    actor=setup.Game.getWorld().entities.hoodedWoman;
    assert(actor.mind.shortTermMemories.length===1 && actor.mind.shortTermMemories[0].summary.includes("foam-technique"), "matching STM must update rather than duplicate");

    // Common model 1..10 importance output is normalized only at protocol ingress.
    fixture=resetMind(); fixture.actor.mind.verbatimObservations=Array.from({length:41},(_,i)=>verbatim(i,"importanceadd"));
    result=await setup.MemoryConsolidator.consolidateSTM("hoodedWoman",scriptedClient(()=>emptyStmResult({shortTermMemoriesToAdd:[{topic:"Normalized add",summary:"Model used a 1..10 scale.",importance:7}]})));
    ok(result,"STM importance normalization add"); actor=setup.Game.getWorld().entities.hoodedWoman;
    close(actor.mind.shortTermMemories[0].importance,0.7,1e-12,"STM importance 7 must normalize to 0.7");

    fixture=resetMind(); fixture.actor.mind.verbatimObservations=Array.from({length:41},(_,i)=>verbatim(i,"importanceupsert"));
    fixture.actor.mind.shortTermMemories=[stm("memory_ai_71","Normalization","Existing",0.4,false)];
    result=await setup.MemoryConsolidator.consolidateSTM("hoodedWoman",scriptedClient(()=>emptyStmResult({shortTermMemoriesToUpsert:[{id:"memory_ai_71",topic:"Normalization",summary:"Updated",importance:8}]})));
    ok(result,"STM importance normalization upsert"); actor=setup.Game.getWorld().entities.hoodedWoman;
    close(actor.mind.shortTermMemories[0].importance,0.8,1e-12,"STM importance 8 must normalize to 0.8");

    fixture=resetMind(); fixture.actor.mind.verbatimObservations=Array.from({length:41},(_,i)=>verbatim(i,"importanceone"));
    result=await setup.MemoryConsolidator.consolidateSTM("hoodedWoman",scriptedClient(()=>emptyStmResult({shortTermMemoriesToAdd:[{topic:"Canonical one",summary:"Canonical maximum importance.",importance:1}]})));
    ok(result,"STM canonical importance one"); actor=setup.Game.getWorld().entities.hoodedWoman;
    close(actor.mind.shortTermMemories[0].importance,1,1e-12,"canonical importance 1 must remain 1, not normalize to 0.1");

    for (const invalidImportance of [11,-1,"7"]) {
        fixture=resetMind(); fixture.actor.mind.verbatimObservations=Array.from({length:41},(_,i)=>verbatim(i,`importancebad${String(invalidImportance)}`));
        const invalidIds=fixture.actor.mind.verbatimObservations.map(v=>v.id);
        result=await setup.MemoryConsolidator.consolidateSTM("hoodedWoman",scriptedClient(()=>emptyStmResult({shortTermMemoriesToAdd:[{topic:"Bad importance",summary:"Must reject.",importance:invalidImportance}]})));
        assert(!result.ok,"invalid importance must fail validation"); actor=setup.Game.getWorld().entities.hoodedWoman;
        assert(actor.mind.shortTermMemories.length===0 && actor.mind.verbatimObservations.map(v=>v.id).join("|")===invalidIds.join("|"),"invalid importance must preserve all source observations");
    }

    // Size tuning must never silently evict autobiographical memory.
    fixture=resetMind();
    fixture.actor.mind.shortTermMemories=Array.from({length:81},(_,i)=>stm(`memory_ai_${1000+i}`,`STM ${i}`,`Preserve STM ${i}`,0.5,false));
    fixture.actor.mind.verbatimObservations=Array.from({length:41},(_,i)=>verbatim(i,"nocapstm"));
    result=await setup.MemoryConsolidator.consolidateSTM("hoodedWoman",scriptedClient(()=>emptyStmResult()));
    ok(result,"STM no silent cap eviction"); actor=setup.Game.getWorld().entities.hoodedWoman;
    assert(actor.mind.shortTermMemories.length===81 && actor.mind.shortTermMemories.every((m,i)=>m.summary===`Preserve STM ${i}`), "STM count tuning must not silently delete existing autobiographical memories");

    fixture=resetMind();
    fixture.actor.mind.shortTermMemories=[stm("memory_ai_2000","Current STM","Still awaiting durable representation",0.5,false)];
    fixture.actor.mind.longTermMemories=Array.from({length:81},(_,i)=>stm(`memory_ai_${2100+i}`,`LTM ${i}`,`Preserve LTM ${i}`,0.5,false));
    result=await setup.MemoryConsolidator.consolidateLTM("hoodedWoman",scriptedClient(()=>emptyLtmResult()),{force:true});
    ok(result,"LTM no silent cap eviction"); actor=setup.Game.getWorld().entities.hoodedWoman;
    assert(actor.mind.longTermMemories.length===81 && actor.mind.longTermMemories.every((m,i)=>m.summary===`Preserve LTM ${i}`), "LTM count tuning must not silently delete existing autobiographical memories");

    // Direct evidence drives confidence through engine math and also raises activation.
    fixture=resetMind(); fixture.actor.mind.verbatimObservations=Array.from({length:41},(_,i)=>verbatim(i,"beliefsupport"));
    fixture.actor.mind.beliefs=[belief("belief_price","Price is unsettling.",0.6,0.2)];
    const expectedSupport=setup.MindV3.updateConfidence(0.6,"supports",0.7);
    result=await setup.MemoryConsolidator.consolidateSTM("hoodedWoman",scriptedClient(()=>emptyStmResult({beliefEffects:[{beliefId:"belief_price",effect:"supports",strength:0.7}]})));
    ok(result,"belief support"); actor=setup.Game.getWorld().entities.hoodedWoman;
    close(actor.mind.beliefs[0].confidence,expectedSupport,1e-12,"engine must own support confidence math");
    assert(actor.mind.beliefs[0].activation>0.2, "relevant evidence must activate belief");

    fixture=resetMind(); fixture.actor.mind.verbatimObservations=Array.from({length:41},(_,i)=>verbatim(i,"beliefcontradict"));
    fixture.actor.mind.beliefs=[belief("belief_price","Price is cruel.",0.85,0.25)];
    result=await setup.MemoryConsolidator.consolidateSTM("hoodedWoman",scriptedClient(()=>emptyStmResult({beliefEffects:[{beliefId:"belief_price",effect:"contradicts",strength:0.9}]})));
    ok(result,"belief contradiction"); actor=setup.Game.getWorld().entities.hoodedWoman;
    assert(actor.mind.beliefs[0].confidence<0.85 && actor.mind.beliefs[0].activation>0.25, "contradiction may lower confidence while increasing activation");

    // Model cannot bypass confidence protocol by returning a replacement confidence field.
    fixture=resetMind(); fixture.actor.mind.verbatimObservations=Array.from({length:41},(_,i)=>verbatim(i,"overwrite"));
    fixture.actor.mind.beliefs=[belief("belief_x","X",0.5,0.5)];
    const overwriteBefore=clone(fixture.actor.mind);
    result=await setup.MemoryConsolidator.consolidateSTM("hoodedWoman",scriptedClient(()=>emptyStmResult({beliefEffects:[{beliefId:"belief_x",effect:"supports",strength:0.5,confidence:0.999}]})));
    assert(!result.ok && JSON.stringify(setup.Game.getWorld().entities.hoodedWoman.mind)===JSON.stringify(overwriteBefore), "extra direct confidence replacement must fail exact protocol validation");

    // New beliefs receive bounded engine-normalized confidence/activation and engine IDs.
    fixture=resetMind(); fixture.actor.mind.verbatimObservations=Array.from({length:41},(_,i)=>verbatim(i,"newbelief"));
    result=await setup.MemoryConsolidator.consolidateSTM("hoodedWoman",scriptedClient(()=>emptyStmResult({beliefsToAdd:[{text:"Authority is dangerous.",initialConfidence:0.72,initialActivation:null}]})));
    ok(result,"new belief induction"); actor=setup.Game.getWorld().entities.hoodedWoman;
    assert(actor.mind.beliefs.length===1 && /^belief_ai_/.test(actor.mind.beliefs[0].id) && actor.mind.beliefs[0].confidence>0 && actor.mind.beliefs[0].confidence<1 && actor.mind.beliefs[0].activation>0 && actor.mind.beliefs[0].activation<1, "new belief must get engine ID and bounded numeric state");

    // Forced pre-timelapse boundary evicts the entire snapshot, even below 40.
    fixture=resetMind(); fixture.actor.mind.verbatimObservations=Array.from({length:3},(_,i)=>verbatim(i,"boundary"));
    result=await setup.MemoryConsolidator.consolidateSTM("hoodedWoman",scriptedClient(payload=>{
        assert(payload.completeVerbatimSnapshot.length===3 && payload.evictionObservationIds.length===3 && payload.retainedObservationIds.length===0, "forceAll boundary must mark entire snapshot for eviction");
        return emptyStmResult({shortTermMemoriesToAdd:[{topic:"Before sleep",summary:"Three pre-sleep experiences.",importance:0.5}]});
    }),{forceAll:true,trigger:"timelapse-boundary"});
    ok(result,"forced boundary");
    assert(setup.Game.getWorld().entities.hoodedWoman.mind.verbatimObservations.length===0, "successful boundary must clear all pre-timelapse verbatim");

    // LTM: thematic upsert/add + retirement; protected autobiographical memory cannot be silently altered/retired.
    fixture=resetMind();
    fixture.actor.mind.shortTermMemories=[stm("memory_ai_1","Price and Nell","Several warm exchanges",0.7,false),stm("memory_ai_2","Protected promise","A promise to remember",1,true)];
    fixture.actor.mind.longTermMemories=[stm("memory_ai_3","Tavern relationships","Earlier durable history",0.8,false),stm("memory_ai_4","Protected history","Never rewrite this",1,true)];
    fixture.actor.mind.beliefs=[belief("belief_kindness","Nell is kind.",0.65,0.5)];
    const ltmSeen=[];
    result=await setup.MemoryConsolidator.consolidateLTM("hoodedWoman",scriptedClient(payload=>{
        assert(payload.beliefSemantics===setup.MindV3.BELIEF_SEMANTICS && payload.shortTermMemories.length===2, "LTM request must receive belief semantics and STM evidence");
        return emptyLtmResult({
            longTermMemoriesToUpsert:[{id:"memory_ai_3",topic:"Tavern relationships",summary:"Nell and Price have a durable warmth amid tavern banter.",importance:0.9}],
            longTermMemoriesToAdd:[{topic:"New durable pattern",summary:"A pattern worth carrying forward.",importance:0.75}],
            retirementGroups:[{stmIds:["memory_ai_1"],disposition:"represented",representedByLtmRefs:["memory_ai_3"]}],
            higherOrderBeliefEffects:[{beliefId:"belief_kindness",effect:"supports",strength:0.4}]
        });
    },ltmSeen),{force:true});
    ok(result,"LTM consolidation"); actor=setup.Game.getWorld().entities.hoodedWoman;
    assert(actor.mind.shortTermMemories.some(m=>m.id==="memory_ai_2") && !actor.mind.shortTermMemories.some(m=>m.id==="memory_ai_1"), "LTM may retire represented unprotected STM but preserve protected STM");
    assert(actor.mind.longTermMemories.some(m=>m.id==="memory_ai_4"&&m.summary==="Never rewrite this") && actor.mind.longTermMemories.length===3, "protected LTM must remain untouched while new durable topic is added");
    assert(ltmSeen[0].messages[0].content.includes("Do NOT blindly count STM events as fresh direct belief evidence again") && ltmSeen[0].messages[0].content.includes("importance MUST be a numeric decimal in the inclusive range 0..1"), "LTM prompt must forbid double-counting and require canonical importance scale");
    assert(ltmSeen[0].messages[0].content.includes("NO arbitrary numeric limits") && ltmSeen[0].messages[0].content.includes("sourceStmIds") && ltmSeen[0].messages[0].content.includes("safe_to_forget") && ltmSeen[0].payload.ltmWritePolicy.operationCountLimits==="none", "LTM prompt/payload must expose evidence-driven unbounded operation semantics");
    const ltmExchange=setup.AIRequestExecutor.getExchangeHistory().entries.slice(-1)[0];
    assert(ltmExchange.request.stage==="mind-v3-ltm" && ltmExchange.request.requestOptions.profile==="mind-v3-ltm" && ltmExchange.request.requestOptions.maxTokens===12000, "LTM must use dedicated 12k request profile");

    fixture=resetMind(); fixture.actor.mind.shortTermMemories=[stm("memory_ai_80","Source","Source STM",0.5,false)];
    result=await setup.MemoryConsolidator.consolidateLTM("hoodedWoman",scriptedClient(()=>emptyLtmResult({longTermMemoriesToAdd:[{topic:"Normalized LTM",summary:"Model used 1..10 importance.",importance:9}]})),{force:true});
    ok(result,"LTM importance normalization"); actor=setup.Game.getWorld().entities.hoodedWoman;
    close(actor.mind.longTermMemories[0].importance,0.9,1e-12,"LTM importance 9 must normalize to 0.9");

    // Production LTM ingress adapters salvage unambiguous model shape mistakes without guessing identity.
    fixture=resetMind(); fixture.actor.mind.shortTermMemories=[stm("memory_ai_431","Morning watch","I watched the road for two travelers.",0.5,false)];
    const promotedSeen=[];
    result=await setup.MemoryConsolidator.consolidateLTM("hoodedWoman",scriptedClient(()=>emptyLtmResult({
        longTermMemoriesToUpsert:[{id:"memory_ai_431",topic:"Morning watch for the travelers",summary:"I spent a morning watching the road for the travelers and saw no sign of them.",importance:0.6}]
    }),promotedSeen),{force:true});
    ok(result,"STM-ID LTM promotion adapter"); actor=setup.Game.getWorld().entities.hoodedWoman;
    assert(actor.mind.longTermMemories.length===1&&actor.mind.longTermMemories[0].topic==="Morning watch for the travelers","an LTM upsert using a supplied STM ID should become a new durable-memory add");
    assert(actor.mind.shortTermMemories.some(m=>m.id==="memory_ai_431"),"STM-ID promotion must not implicitly retire the source STM");
    assert(promotedSeen[0].messages[0].content.includes("ID SPACES ARE DISTINCT")&&promotedSeen[0].messages[0].content.includes("beliefsToAdd contain exactly text,initialConfidence,initialActivation"),"LTM prompt must explicitly separate ID spaces and canonical belief-add shape");

    fixture=resetMind(); fixture.actor.mind.shortTermMemories=[stm("memory_ai_6000","Source","Durable source",0.6,false)]; fixture.actor.mind.longTermMemories=[stm("memory_ai_6001","Existing durable topic","Earlier durable summary",0.5,false)];
    result=await setup.MemoryConsolidator.consolidateLTM("hoodedWoman",scriptedClient(()=>emptyLtmResult({
        longTermMemoriesToUpsert:[{id:"memory_ai_6001",summary:"Earlier durable summary plus one materially new consequence.",importance:0.7}]
    })),{force:true});
    ok(result,"known LTM missing-topic adapter"); actor=setup.Game.getWorld().entities.hoodedWoman;
    assert(actor.mind.longTermMemories[0].topic==="Existing durable topic"&&actor.mind.longTermMemories[0].summary.includes("materially new consequence"),"missing topic may inherit only the known persisted LTM topic");

    fixture=resetMind(); fixture.actor.mind.shortTermMemories=[stm("memory_ai_6010","Source","Durable source",0.6,false)]; fixture.actor.mind.longTermMemories=[stm("memory_ai_6011","Existing durable","Exactly unchanged",0.6,false)];
    result=await setup.MemoryConsolidator.consolidateLTM("hoodedWoman",scriptedClient(()=>emptyLtmResult({
        longTermMemoriesToUpsert:[{id:"memory_ai_6011",topic:"Existing durable",summary:"Exactly unchanged",importance:0.6}],
        longTermMemoriesToAdd:[{topic:"Independent useful durable memory",summary:"This useful write should survive the no-op upsert.",importance:0.7}],
        beliefsToAdd:[{topic:"Kindness from strangers can be genuine",summary:"Observed generosity supports this durable interpretation.",confidence:0.6,activation:0.5}]
    })),{force:true});
    ok(result,"no-op LTM and observed belief-add salvage"); actor=setup.Game.getWorld().entities.hoodedWoman;
    assert(actor.mind.longTermMemories.length===2&&actor.mind.longTermMemories.some(m=>m.topic==="Independent useful durable memory"),"exact no-op LTM upsert should be stripped without discarding independent writes");
    assert(actor.mind.beliefs.length===1&&actor.mind.beliefs[0].text==="Kindness from strangers can be genuine"&&actor.mind.beliefs[0].confidence===0.6,"observed topic/summary/confidence/activation belief shape should adapt narrowly to canonical belief fields");

    fixture=resetMind(); fixture.actor.mind.shortTermMemories=[stm("memory_ai_6020","Source","Source STM",0.5,false)];
    const unknownLtmBefore=clone(fixture.actor.mind);
    result=await setup.MemoryConsolidator.consolidateLTM("hoodedWoman",scriptedClient(()=>emptyLtmResult({longTermMemoriesToUpsert:[{id:"memory_ai_999999",topic:"Unknown",summary:"Must remain invalid.",importance:0.5}]})),{force:true});
    assert(!result.ok&&JSON.stringify(setup.Game.getWorld().entities.hoodedWoman.mind)===JSON.stringify(unknownLtmBefore),"LTM upsert ID absent from both supplied LTM and STM must remain invalid");

    fixture=resetMind(); fixture.actor.mind.shortTermMemories=[stm("memory_ai_6030","Source","Source STM",0.5,false)];
    const malformedBeliefAddBefore=clone(fixture.actor.mind);
    result=await setup.MemoryConsolidator.consolidateLTM("hoodedWoman",scriptedClient(()=>emptyLtmResult({beliefsToAdd:[{topic:"Almost",summary:"Missing activation must remain malformed.",confidence:0.6}]})),{force:true});
    assert(!result.ok&&JSON.stringify(setup.Game.getWorld().entities.hoodedWoman.mind)===JSON.stringify(malformedBeliefAddBefore),"belief-add shapes outside the exact observed adapter must remain invalid");

    // Invalid attempt to retire protected STM or overwrite protected LTM is rejected atomically.
    fixture=resetMind(); fixture.actor.mind.shortTermMemories=[stm("memory_ai_10","Protected STM","Keep",1,true)]; fixture.actor.mind.longTermMemories=[stm("memory_ai_11","Protected LTM","Keep forever",1,true)];
    const protectedBefore=clone(fixture.actor.mind);
    result=await setup.MemoryConsolidator.consolidateLTM("hoodedWoman",scriptedClient(()=>emptyLtmResult({retirementGroups:[{stmIds:["memory_ai_10"],disposition:"safe_to_forget",representedByLtmRefs:[],reason:"routine"}],longTermMemoriesToUpsert:[{id:"memory_ai_11",topic:"Changed",summary:"Should fail",importance:0.2}]})),{force:true});
    assert(!result.ok && JSON.stringify(setup.Game.getWorld().entities.hoodedWoman.mind)===JSON.stringify(protectedBefore), "protected memory mutation must fail before commit");

    // Reconciliation receives autobiographical evidence and may contextualize or deliberately leave dissonance unresolved.
    fixture=resetMind();
    fixture.actor.mind.beliefs=[belief("belief_creepy","Price is creepy.",0.8,0.9),belief("belief_kind","Price seems genuinely kind to Nell.",0.7,0.85)];
    fixture.actor.mind.shortTermMemories=[stm("memory_ai_20","Price and Nell","Price was warm toward Nell despite Mara's unease.",0.9,false)];
    const recSeen=[];
    result=await setup.MemoryConsolidator.reconcileBeliefs("hoodedWoman",scriptedClient(payload=>{
        assert(payload.relevantAutobiographicalMemory.length>0 && payload.beliefSemantics===setup.MindV3.BELIEF_SEMANTICS, "reconciliation must receive memory evidence and shared semantics");
        return emptyReconciliation({resolutions:[{beliefIds:["belief_creepy","belief_kind"],outcome:"contextualize",survivorBeliefId:"belief_creepy",replacementText:"I still find Price unsettling, but his warmth toward Nell seems genuine.",evidenceEffect:"ambiguous",strength:0.4}]});
    },recSeen));
    ok(result,"contextualizing reconciliation"); actor=setup.Game.getWorld().entities.hoodedWoman;
    assert(actor.mind.beliefs.length===1 && actor.mind.beliefs[0].text.includes("warmth toward Nell"), "contextualization may merge tension into richer surviving interpretation");

    fixture=resetMind(); fixture.actor.mind.beliefs=[belief("belief_a","A",0.6,0.9),belief("belief_b","B",0.6,0.8)]; fixture.actor.mind.shortTermMemories=[stm("memory_ai_21","Tension","Both remain psychologically live.",0.8,false)];
    result=await setup.MemoryConsolidator.reconcileBeliefs("hoodedWoman",scriptedClient(()=>emptyReconciliation({resolutions:[{beliefIds:["belief_a","belief_b"],outcome:"leave_unresolved",survivorBeliefId:null,replacementText:null,evidenceEffect:null,strength:null}]})));
    ok(result,"unresolved reconciliation"); actor=setup.Game.getWorld().entities.hoodedWoman;
    assert(actor.mind.beliefs.length===2, "leave_unresolved must preserve cognitive dissonance");

    // STM ingress normalizes harmless duplicate belief references without amplifying evidence.
    fixture=resetMind(); fixture.actor.mind.verbatimObservations=Array.from({length:41},(_,i)=>verbatim(i,"dupsupport"));
    fixture.actor.mind.beliefs=[belief("belief_dup","Repeated support should count once.",0.6,0.2)];
    const expectedMaxSupport=setup.MindV3.updateConfidence(0.6,"supports",0.7);
    result=await setup.MemoryConsolidator.consolidateSTM("hoodedWoman",scriptedClient(()=>emptyStmResult({
        beliefEffects:[
            {beliefId:"belief_dup",effect:"supports",strength:0.4},
            {beliefId:"belief_dup",effect:"supports",strength:0.7},
            {beliefId:"belief_dup",effect:"supports",strength:0.5}
        ],
        activatedBeliefIds:["belief_dup","belief_dup"]
    })));
    ok(result,"duplicate support normalization"); actor=setup.Game.getWorld().entities.hoodedWoman;
    close(actor.mind.beliefs[0].confidence,expectedMaxSupport,1e-12,"duplicate support must apply only strongest evidence once");

    fixture=resetMind(); fixture.actor.mind.verbatimObservations=Array.from({length:41},(_,i)=>verbatim(i,"conflictingeffect"));
    fixture.actor.mind.beliefs=[belief("belief_conflict","The evidence pulls both ways.",0.73,0.2)];
    result=await setup.MemoryConsolidator.consolidateSTM("hoodedWoman",scriptedClient(()=>emptyStmResult({beliefEffects:[
        {beliefId:"belief_conflict",effect:"supports",strength:0.8},
        {beliefId:"belief_conflict",effect:"contradicts",strength:0.6}
    ]})));
    ok(result,"conflicting effect normalization"); actor=setup.Game.getWorld().entities.hoodedWoman;
    close(actor.mind.beliefs[0].confidence,0.73,1e-12,"support plus contradiction in one STM response must normalize to ambiguous confidence evidence");
    assert(actor.mind.beliefs[0].activation>0.2,"conflicting evidence must still raise activation");
    const conflictHistory=actor.mindDiagnostics.beliefHistoryById.belief_conflict||[];
    assert(conflictHistory.some(entry=>entry.source==="stm-consolidation"&&entry.effect==="ambiguous"),"normalized conflicting evidence must be visible diagnostically as ambiguous");

    fixture=resetMind(); fixture.actor.mind.verbatimObservations=Array.from({length:41},(_,i)=>verbatim(i,"dupactivation"));
    fixture.actor.mind.beliefs=[belief("belief_activation_once","Repeated activation IDs should bump once.",0.6,0.3)];
    const expectedSingleActivation=setup.MindV3.bumpActivation(0.3,0.35,false);
    result=await setup.MemoryConsolidator.consolidateSTM("hoodedWoman",scriptedClient(()=>emptyStmResult({activatedBeliefIds:["belief_activation_once","belief_activation_once","belief_activation_once"]})));
    ok(result,"duplicate activation normalization"); actor=setup.Game.getWorld().entities.hoodedWoman;
    close(actor.mind.beliefs[0].activation,expectedSingleActivation,1e-12,"duplicate activatedBeliefIds must apply one activation bump");

    fixture=resetMind(); fixture.actor.mind.verbatimObservations=Array.from({length:41},(_,i)=>verbatim(i,"unknownduplicate"));
    const unknownDuplicateIds=fixture.actor.mind.verbatimObservations.map(v=>v.id);
    result=await setup.MemoryConsolidator.consolidateSTM("hoodedWoman",scriptedClient(()=>emptyStmResult({beliefEffects:[
        {beliefId:"belief_missing",effect:"supports",strength:0.5},
        {beliefId:"belief_missing",effect:"supports",strength:0.7}
    ]})));
    ok(result,"unknown duplicate belief IDs are safely separable");
    assert(setup.Game.getWorld().entities.hoodedWoman.mind.verbatimObservations.length===setup.MindV3.CONFIG.VERBATIM_RETAIN_COUNT,"unknown syntactically valid auxiliary belief refs should be dropped while STM eviction may commit");

    // Production hardening: a syntactically valid but unknown belief reference is safely separable.
    fixture=resetMind(); fixture.actor.mind.verbatimObservations=Array.from({length:41},(_,i)=>verbatim(i,"unknownrefsalvage"));
    fixture.actor.mind.beliefs=[belief("traveler_respects_boundaries","The traveler respects my physical boundaries.",0.7,0.3),belief("belief_valid_support","A separate valid belief.",0.6,0.2)];
    result=await setup.MemoryConsolidator.consolidateSTM("hoodedWoman",scriptedClient(()=>emptyStmResult({
        shortTermMemoriesToAdd:[{topic:"Valid autobiography survives",summary:"The autobiographical write is valid even though one auxiliary belief ID was hallucinated.",importance:0.7}],
        beliefEffects:[
            {beliefId:"belief_valid_support",effect:"supports",strength:0.6},
            {beliefId:"dmytro_respects_boundaries",effect:"supports",strength:0.4}
        ],
        activatedBeliefIds:["belief_valid_support","dmytro_respects_boundaries"]
    })));
    ok(result,"unknown belief reference salvage"); actor=setup.Game.getWorld().entities.hoodedWoman;
    assert(actor.mind.shortTermMemories.some(m=>m.topic==="Valid autobiography survives"),"unknown auxiliary belief ID must not discard valid STM autobiography");
    assert(actor.mind.beliefs.find(b=>b.id==="belief_valid_support").confidence>0.6,"valid belief effect must still apply");
    close(actor.mind.beliefs.find(b=>b.id==="traveler_respects_boundaries").confidence,0.7,1e-12,"engine must not fuzzy-map an unknown model ID onto a similar canonical belief ID");

    fixture=resetMind(); fixture.actor.mind.verbatimObservations=Array.from({length:41},(_,i)=>verbatim(i,"crosslistactivation"));
    fixture.actor.mind.beliefs=[belief("belief_effect_and_activation","One belief may be evidence-relevant and explicitly salient.",0.6,0.25)];
    result=await setup.MemoryConsolidator.consolidateSTM("hoodedWoman",scriptedClient(()=>emptyStmResult({
        beliefEffects:[{beliefId:"belief_effect_and_activation",effect:"supports",strength:0.5}],
        activatedBeliefIds:["belief_effect_and_activation"]
    })));
    ok(result,"effect and activation overlap"); actor=setup.Game.getWorld().entities.hoodedWoman;
    const overlapHistory=actor.mindDiagnostics.beliefHistoryById.belief_effect_and_activation||[];
    assert(overlapHistory.filter(entry=>entry.source==="stm-consolidation").length===1,"effect plus activatedBeliefIds overlap must not double-bump the same belief");

    fixture=resetMind(); fixture.actor.mind.verbatimObservations=Array.from({length:41},(_,i)=>verbatim(i,"malformedeffect"));
    const malformedEffectBefore=clone(fixture.actor.mind);
    result=await setup.MemoryConsolidator.consolidateSTM("hoodedWoman",scriptedClient(()=>emptyStmResult({beliefEffects:[{beliefId:"belief_missing",effect:"supports"}]})));
    assert(!result.ok&&JSON.stringify(setup.Game.getWorld().entities.hoodedWoman.mind)===JSON.stringify(malformedEffectBefore),"malformed belief effect must still reject atomically rather than being silently dropped");

    // LTM is evidence-driven delta over durable memory, not a full-store rewrite opportunity.
    fixture=resetMind();
    fixture.actor.mind.shortTermMemories=[stm("memory_ai_5000","Eligible STM","New durable evidence to integrate.",0.8,false)];
    fixture.actor.mind.longTermMemories=Array.from({length:61},(_,i)=>stm(`memory_ai_${5100+i}`,`Legacy LTM ${i}`,`Preserve durable memory ${i}`,0.5,false));
    const largeLtmBefore=clone(fixture.actor.mind.longTermMemories);
    const largeLtmSeen=[];
    result=await setup.MemoryConsolidator.consolidateLTM("hoodedWoman",scriptedClient(payload=>{
        assert(payload.ltmWritePolicy.mode==="evidence-driven-delta"&&payload.ltmWritePolicy.operationCountLimits==="none"&&payload.ltmWritePolicy.provenanceRequired===true,"LTM payload must expose evidence-driven delta policy without arbitrary operation caps");
        return emptyLtmResult({
            longTermMemoriesToUpsert:[{id:"memory_ai_5130",topic:"Legacy LTM 30",summary:"Preserve durable memory 30 plus one newly durable consequence.",importance:0.7}],
            longTermMemoriesToAdd:[{topic:"One new durable theme",summary:"A genuinely new durable pattern from current STM.",importance:0.75}]
        });
    },largeLtmSeen),{force:true});
    ok(result,"large-mind evidence-driven LTM delta"); actor=setup.Game.getWorld().entities.hoodedWoman;
    assert(actor.mind.longTermMemories.length===62,"evidence-driven LTM delta should add only the requested new durable topic");
    for(let i=0;i<61;i++){
        if(i===30) continue;
        assert(JSON.stringify(actor.mind.longTermMemories[i])===JSON.stringify(largeLtmBefore[i]),`unrelated LTM ${i} must remain byte-for-byte unchanged`);
    }
    assert(largeLtmSeen[0].messages[0].content.includes("EVIDENCE-DRIVEN DELTA")&&largeLtmSeen[0].messages[0].content.includes("Never retopic, beautify"),"LTM prompt must forbid broad cleanup rewrites while allowing justified volume");

    fixture=resetMind(); fixture.actor.mind.shortTermMemories=[stm("memory_ai_5200","Source","Source STM",0.5,false)];
    result=await setup.MemoryConsolidator.consolidateLTM("hoodedWoman",scriptedClient(()=>emptyLtmResult({
        longTermMemoriesToAdd:Array.from({length:12},(_,i)=>({ref:`new_ltm_many_${i}`,topic:`LTM ${i}`,summary:`Distinct justified durable write ${i}`,importance:0.5,sourceStmIds:["memory_ai_5200"],sourceLtmIds:[]})),
        beliefsToAdd:Array.from({length:8},(_,i)=>({text:`Higher-order belief ${i}`,initialConfidence:0.55,initialActivation:0.6}))
    })),{force:true});
    ok(result,"unbounded justified LTM writes"); actor=setup.Game.getWorld().entities.hoodedWoman;
    assert(actor.mind.longTermMemories.length===12&&actor.mind.beliefs.length===8,"LTM operation counts must not be rejected solely for exceeding former numeric caps");

    fixture=resetMind(); fixture.actor.mind.shortTermMemories=Array.from({length:67},(_,i)=>stm(`memory_ai_${5300+i}`,`STM ${i}`,`Retirement source ${i}`,0.5,false));
    result=await setup.MemoryConsolidator.consolidateLTM("hoodedWoman",scriptedClient(()=>emptyLtmResult({
        longTermMemoriesToAdd:[{ref:"new_ltm_bulk",topic:"A durable combined history",summary:"The durable content of the full mature STM set is represented here.",importance:0.9,sourceStmIds:fixture.actor.mind.shortTermMemories.map(m=>m.id),sourceLtmIds:[]}],
        retirementGroups:[{stmIds:fixture.actor.mind.shortTermMemories.map(m=>m.id),disposition:"represented",representedByLtmRefs:["new_ltm_bulk"]}]
    })),{force:true});
    ok(result,"unbounded represented STM retirement"); actor=setup.Game.getWorld().entities.hoodedWoman;
    assert(actor.mind.shortTermMemories.length===0&&actor.mind.longTermMemories.length===1,"one LTM pass may retire all 67 STM when one coverage group explicitly represents them");
    assert(actor.mind.longTermMemories[0].ref===undefined&&/^memory_ai_/.test(actor.mind.longTermMemories[0].id),"model-local LTM add refs must not persist into canonical memory");

    fixture=resetMind(); fixture.actor.mind.shortTermMemories=[stm("memory_ai_5370","Routine detail","I drank an ordinary mug of ale.",0.15,false),stm("memory_ai_5371","Protected promise","Never forget this promise.",1,true)];
    result=await setup.MemoryConsolidator.consolidateLTM("hoodedWoman",scriptedClient(()=>emptyLtmResult({retirementGroups:[{stmIds:["memory_ai_5370"],disposition:"safe_to_forget",representedByLtmRefs:[],reason:"routine"}]})),{force:true});
    ok(result,"safe-to-forget retirement"); actor=setup.Game.getWorld().entities.hoodedWoman;
    assert(!actor.mind.shortTermMemories.some(m=>m.id==="memory_ai_5370")&&actor.mind.shortTermMemories.some(m=>m.id==="memory_ai_5371"),"routine unprotected STM may be explicitly forgotten while protected STM remains");

    fixture=resetMind(); fixture.actor.mind.shortTermMemories=[stm("memory_ai_5380","Protected","Protected autobiographical memory.",1,true)];
    const protectedRetireBefore=clone(fixture.actor.mind);
    result=await setup.MemoryConsolidator.consolidateLTM("hoodedWoman",scriptedClient(()=>emptyLtmResult({retirementGroups:[{stmIds:["memory_ai_5380"],disposition:"safe_to_forget",representedByLtmRefs:[],reason:"routine"}]})),{force:true});
    assert(!result.ok&&JSON.stringify(setup.Game.getWorld().entities.hoodedWoman.mind)===JSON.stringify(protectedRetireBefore),"protected STM may never be retired even as safe_to_forget");

    fixture=resetMind(); fixture.actor.mind.shortTermMemories=[stm("memory_ai_5390","Meaningful","Meaningful memory needing representation.",0.8,false)];
    const badCoverageBefore=clone(fixture.actor.mind);
    result=await setup.MemoryConsolidator.consolidateLTM("hoodedWoman",scriptedClient(()=>emptyLtmResult({retirementGroups:[{stmIds:["memory_ai_5390"],disposition:"represented",representedByLtmRefs:["nonexistent_ltm"]}]})),{force:true});
    assert(!result.ok&&JSON.stringify(setup.Game.getWorld().entities.hoodedWoman.mind)===JSON.stringify(badCoverageBefore),"represented retirement must point only to existing or proposed LTM refs");

    fixture=resetMind(); fixture.actor.mind.shortTermMemories=[stm("memory_ai_5391","Keep me","This STM is intentionally not yet mature enough for LTM.",0.7,false),stm("memory_ai_5392","Forget me","A trivial passing detail.",0.1,false)];
    result=await setup.MemoryConsolidator.consolidateLTM("hoodedWoman",scriptedClient(()=>emptyLtmResult({retirementGroups:[{stmIds:["memory_ai_5392"],disposition:"safe_to_forget",representedByLtmRefs:[],reason:"routine"}]})),{force:true});
    ok(result,"unmentioned STM retained"); actor=setup.Game.getWorld().entities.hoodedWoman;
    assert(actor.mind.shortTermMemories.some(m=>m.id==="memory_ai_5391")&&!actor.mind.shortTermMemories.some(m=>m.id==="memory_ai_5392"),"STM omitted from retirementGroups must remain available for later consolidation");

    fixture=resetMind(); fixture.actor.mind.shortTermMemories=[stm("memory_ai_5393","Duplicate","One source cannot be retired twice.",0.5,false)]; fixture.actor.mind.longTermMemories=[stm("memory_ai_5394","Existing","Existing durable representation.",0.7,false)];
    const duplicateGroupBefore=clone(fixture.actor.mind);
    result=await setup.MemoryConsolidator.consolidateLTM("hoodedWoman",scriptedClient(()=>emptyLtmResult({retirementGroups:[
        {stmIds:["memory_ai_5393"],disposition:"represented",representedByLtmRefs:["memory_ai_5394"]},
        {stmIds:["memory_ai_5393"],disposition:"safe_to_forget",representedByLtmRefs:[],reason:"routine"}
    ]})),{force:true});
    assert(!result.ok&&JSON.stringify(setup.Game.getWorld().entities.hoodedWoman.mind)===JSON.stringify(duplicateGroupBefore),"the same STM may not appear in multiple retirement groups");

    fixture=resetMind(); fixture.actor.mind.shortTermMemories=[stm("memory_ai_5395","Bad forget","Forgettable shape must not claim representation.",0.2,false)]; fixture.actor.mind.longTermMemories=[stm("memory_ai_5396","Existing","Existing durable memory.",0.7,false)];
    const badForgetBefore=clone(fixture.actor.mind);
    result=await setup.MemoryConsolidator.consolidateLTM("hoodedWoman",scriptedClient(()=>emptyLtmResult({retirementGroups:[{stmIds:["memory_ai_5395"],disposition:"safe_to_forget",representedByLtmRefs:["memory_ai_5396"]}]})),{force:true});
    assert(!result.ok&&JSON.stringify(setup.Game.getWorld().entities.hoodedWoman.mind)===JSON.stringify(badForgetBefore),"safe_to_forget groups must not claim LTM representation");

    fixture=resetMind(); fixture.actor.mind.shortTermMemories=[stm("memory_ai_5400","Source","Source STM",0.5,false)]; fixture.actor.mind.longTermMemories=[stm("memory_ai_5401","Existing durable","Exactly unchanged",0.6,false)];
    const noopLtmBefore=clone(fixture.actor.mind);
    result=await setup.MemoryConsolidator.consolidateLTM("hoodedWoman",scriptedClient(()=>emptyLtmResult({longTermMemoriesToUpsert:[{id:"memory_ai_5401",topic:"Existing durable",summary:"Exactly unchanged",importance:0.6}]})),{force:true});
    ok(result,"exact no-op LTM ingress stripping");
    assert(JSON.stringify(setup.Game.getWorld().entities.hoodedWoman.mind)===JSON.stringify(noopLtmBefore),"exact no-op LTM upsert must be stripped without creating revision churn");

    // LTM provenance is mandatory and machine-validated; safe forgetting requires an explicit reason code.
    fixture=resetMind(); fixture.actor.mind.shortTermMemories=[stm("memory_ai_5410","Source","Source STM",0.5,false)];
    const missingProvBefore=clone(fixture.actor.mind);
    result=await setup.MemoryConsolidator.consolidateLTM("hoodedWoman",scriptedClient(()=>Object.assign(emptyLtmResult({longTermMemoriesToAdd:[{ref:"new_ltm_missing_prov",topic:"Missing provenance",summary:"Must reject.",importance:0.5}]}),{__noAutoLtmEvidence:true})),{force:true});
    assert(!result.ok&&JSON.stringify(setup.Game.getWorld().entities.hoodedWoman.mind)===JSON.stringify(missingProvBefore),"material LTM writes without provenance must reject atomically");

    fixture=resetMind(); fixture.actor.mind.shortTermMemories=[stm("memory_ai_5411","Source","Source STM",0.5,false)];
    const unknownProvBefore=clone(fixture.actor.mind);
    result=await setup.MemoryConsolidator.consolidateLTM("hoodedWoman",scriptedClient(()=>Object.assign(emptyLtmResult({longTermMemoriesToAdd:[{ref:"new_ltm_bad_prov",topic:"Bad provenance",summary:"Unknown source must reject.",importance:0.5,sourceStmIds:["memory_ai_999999"],sourceLtmIds:[]}]}),{__noAutoLtmEvidence:true})),{force:true});
    assert(!result.ok&&JSON.stringify(setup.Game.getWorld().entities.hoodedWoman.mind)===JSON.stringify(unknownProvBefore),"unknown provenance IDs must reject atomically");

    fixture=resetMind(); fixture.actor.mind.shortTermMemories=[stm("memory_ai_5412","Transient","I was waiting for Garrick, but he has returned.",0.2,false)];
    result=await setup.MemoryConsolidator.consolidateLTM("hoodedWoman",scriptedClient(()=>Object.assign(emptyLtmResult({retirementGroups:[{stmIds:["memory_ai_5412"],disposition:"safe_to_forget",representedByLtmRefs:[],reason:"transient"}]}),{__noAutoLtmEvidence:true})),{force:true});
    ok(result,"explicit transient forgetting reason");

    fixture=resetMind(); fixture.actor.mind.shortTermMemories=[stm("memory_ai_5413","Bad reason","Should remain if reason is not allowed.",0.2,false)];
    const badReasonBefore=clone(fixture.actor.mind);
    result=await setup.MemoryConsolidator.consolidateLTM("hoodedWoman",scriptedClient(()=>Object.assign(emptyLtmResult({retirementGroups:[{stmIds:["memory_ai_5413"],disposition:"safe_to_forget",representedByLtmRefs:[],reason:"unimportant"}]}),{__noAutoLtmEvidence:true})),{force:true});
    assert(!result.ok&&JSON.stringify(setup.Game.getWorld().entities.hoodedWoman.mind)===JSON.stringify(badReasonBefore),"unknown safe_to_forget reason must reject atomically");

    // Reconciliation has one canonical shape plus a narrow single-ID alias adapter.
    fixture=resetMind(); fixture.actor.mind.beliefs=[belief("belief_alias","One belief needs reflection.",0.6,0.9)]; fixture.actor.mind.shortTermMemories=[stm("memory_ai_5500","Evidence","Relevant autobiographical evidence.",0.7,false)];
    const aliasSeen=[];
    result=await setup.MemoryConsolidator.reconcileBeliefs("hoodedWoman",scriptedClient(()=>emptyReconciliation({resolutions:[{beliefId:"belief_alias",outcome:"leave_unresolved",survivorBeliefId:null,replacementText:null,evidenceEffect:null,strength:null}]}),aliasSeen));
    ok(result,"singular beliefId reconciliation adapter");
    assert(aliasSeen[0].messages[0].content.includes("beliefIds is ALWAYS an array")&&aliasSeen[0].payload.reconciliationPolicy.maxResolutions===setup.MindV3.CONFIG.RECONCILIATION_RESOLUTION_LIMIT,"reconciliation prompt and payload must expose the canonical array-ID contract");

    fixture=resetMind(); fixture.actor.mind.beliefs=[belief("belief_candidate_alias","Candidate alias needs reflection.",0.6,0.9)]; fixture.actor.mind.shortTermMemories=[stm("memory_ai_5501","Evidence","Relevant evidence.",0.7,false)];
    result=await setup.MemoryConsolidator.reconcileBeliefs("hoodedWoman",scriptedClient(()=>emptyReconciliation({resolutions:[{candidateBeliefId:"belief_candidate_alias",outcome:"leave_unresolved",survivorBeliefId:null,replacementText:null,evidenceEffect:null,strength:null}]})));
    ok(result,"singular candidateBeliefId reconciliation adapter");

    fixture=resetMind(); fixture.actor.mind.beliefs=[belief("belief_merge_a","A",0.6,0.9),belief("belief_merge_b","B",0.6,0.8)]; fixture.actor.mind.shortTermMemories=[stm("memory_ai_5502","Evidence","Merge evidence.",0.7,false)];
    const ambiguousMergeBefore=clone(fixture.actor.mind);
    result=await setup.MemoryConsolidator.reconcileBeliefs("hoodedWoman",scriptedClient(()=>emptyReconciliation({resolutions:[{outcome:"merge",survivorBeliefId:"belief_merge_a",replacementText:"Combined",evidenceEffect:null,strength:null}]})));
    assert(!result.ok&&JSON.stringify(setup.Game.getWorld().entities.hoodedWoman.mind)===JSON.stringify(ambiguousMergeBefore),"reconciliation must not infer missing merge participants from survivorBeliefId or text");

    fixture=resetMind(); fixture.actor.mind.beliefs=Array.from({length:6},(_,i)=>belief(`belief_resolution_${i}`,`Resolution ${i}`,0.6,0.99-i*0.01)); fixture.actor.mind.shortTermMemories=[stm("memory_ai_5503","Evidence","Many candidate beliefs.",0.7,false)];
    const tooManyResolutionsBefore=clone(fixture.actor.mind);
    result=await setup.MemoryConsolidator.reconcileBeliefs("hoodedWoman",scriptedClient(()=>emptyReconciliation({resolutions:Array.from({length:setup.MindV3.CONFIG.RECONCILIATION_RESOLUTION_LIMIT+1},(_,i)=>({beliefIds:[`belief_resolution_${i}`],outcome:"leave_unresolved",survivorBeliefId:null,replacementText:null,evidenceEffect:null,strength:null}))})));
    assert(!result.ok&&JSON.stringify(setup.Game.getWorld().entities.hoodedWoman.mind)===JSON.stringify(tooManyResolutionsBefore),"more than configured reconciliation resolution limit must reject atomically");

    // Timelapse reflective stages are dependency-gated, while activation decay always reflects elapsed time.
    fixture=resetMind(); fixture.actor.mind.verbatimObservations=Array.from({length:21},(_,i)=>verbatim(i,"gatingstmfail")); fixture.actor.mind.shortTermMemories=[stm("memory_ai_5600","Existing STM","Should not feed LTM after STM failure.",0.6,false)]; fixture.actor.mind.beliefs=[belief("belief_decay_after_stm_fail","Still decays after failed reflection.",0.7,0.8)];
    const stmFailSeen=[];
    const stmFailBeforeActivation=fixture.actor.mind.beliefs[0].activation;
    result=await setup.MemoryConsolidator.maintainTimelapse("hoodedWoman",scriptedClient(payload=>{ stmFailSeen.push(payload.stage); return {__failure:true,error:{code:"TEST_STM_FAIL",message:"stm failed"}}; }),{elapsedMaintenanceUnits:1});
    assert(!result.ok&&stmFailSeen.join("|")==="mind-v3-stm","STM failure must make no LTM or reconciliation provider request");
    assert(result.report.stages.some(s=>s.stage==="ltm"&&s.result.skipped&&s.result.reason==="skipped_due_to_stm_failure")&&result.report.stages.some(s=>s.stage==="reconciliation"&&s.result.skipped),"STM failure diagnostics must distinguish skipped dependent stages");
    actor=setup.Game.getWorld().entities.hoodedWoman;
    assert(actor.mind.verbatimObservations.length===21&&actor.mind.beliefs[0].activation<stmFailBeforeActivation,"STM failure must preserve verbatim while activation decay still runs");

    fixture=resetMind(); fixture.actor.mind.verbatimObservations=Array.from({length:21},(_,i)=>verbatim(i,"gatingltmfail")); fixture.actor.mind.shortTermMemories=[stm("memory_ai_5601","Existing STM","Eligible for LTM.",0.6,false)]; fixture.actor.mind.beliefs=[belief("belief_decay_after_ltm_fail","Decay still applies.",0.7,0.8)];
    const ltmFailSeen=[];
    result=await setup.MemoryConsolidator.maintainTimelapse("hoodedWoman",scriptedClient(payload=>{
        ltmFailSeen.push(payload.stage);
        if(payload.stage==="mind-v3-stm") return emptyStmResult();
        if(payload.stage==="mind-v3-ltm") return {__failure:true,error:{code:"TEST_LTM_FAIL",message:"ltm failed"}};
        throw new Error(`unexpected stage ${payload.stage}`);
    }),{elapsedMaintenanceUnits:1});
    assert(!result.ok&&ltmFailSeen.join("|")==="mind-v3-stm|mind-v3-ltm","LTM failure must skip reconciliation provider request");
    assert(result.report.stages.some(s=>s.stage==="reconciliation"&&s.result.skipped&&s.result.reason==="skipped_due_to_ltm_failure"),"LTM failure must record reconciliation skip reason");

    fixture=resetMind(); fixture.actor.mind.verbatimObservations=Array.from({length:21},(_,i)=>verbatim(i,"gatingrecfail")); fixture.actor.mind.shortTermMemories=[stm("memory_ai_5602","Existing STM","Eligible durable source.",0.6,false)]; fixture.actor.mind.beliefs=[belief("belief_rec_fail","Reconciliation may fail later.",0.7,0.8)];
    const recFailSeen=[];
    result=await setup.MemoryConsolidator.maintainTimelapse("hoodedWoman",scriptedClient(payload=>{
        recFailSeen.push(payload.stage);
        if(payload.stage==="mind-v3-stm") return emptyStmResult();
        if(payload.stage==="mind-v3-ltm") return emptyLtmResult({longTermMemoriesToAdd:[{topic:"Committed before reconciliation",summary:"This durable memory must survive later reconciliation failure.",importance:0.7}]});
        if(payload.stage==="mind-v3-reconciliation") return {__failure:true,error:{code:"TEST_REC_FAIL",message:"reconciliation failed"}};
        throw new Error(`unexpected stage ${payload.stage}`);
    }),{elapsedMaintenanceUnits:1});
    assert(!result.ok&&recFailSeen.join("|")==="mind-v3-stm|mind-v3-ltm|mind-v3-reconciliation","reconciliation failure occurs only after successful upstream stages");
    actor=setup.Game.getWorld().entities.hoodedWoman;
    assert(actor.mind.longTermMemories.some(m=>m.topic==="Committed before reconciliation"),"reconciliation failure must not roll back successfully committed LTM");

    // Timelapse activation decay lowers salience only, not confidence or memory.
    fixture=resetMind(); fixture.actor.mind.beliefs=[belief("belief_decay","Garrick is greedy.",0.91,0.8)]; fixture.actor.mind.longTermMemories=[stm("memory_ai_30","Garrick","History with Garrick",0.8,true)];
    const beforeConfidence=fixture.actor.mind.beliefs[0].confidence;
    const beforeActivation=fixture.actor.mind.beliefs[0].activation;
    result=setup.MemoryConsolidator.decayActivation("hoodedWoman",1,"timelapse");
    ok(result,"activation decay"); actor=setup.Game.getWorld().entities.hoodedWoman;
    close(actor.mind.beliefs[0].confidence,beforeConfidence,1e-12,"time alone must not decay confidence");
    assert(actor.mind.beliefs[0].activation<beforeActivation && actor.mind.longTermMemories[0].summary==="History with Garrick", "decay must lower activation without deleting memory");

    // Background purpose is globally visible but does not set gameplay's blocking busy flag.
    let release;
    const deferred=new Promise(resolve=>{release=resolve;});
    const concurrentClient={enforceRequestTiming:false,chat:async()=>{await deferred;return {ok:true,modelId:"test",content:JSON.stringify(emptyStmResult()),usage:null};}};
    fixture=resetMind(); fixture.actor.mind.verbatimObservations=Array.from({length:41},(_,i)=>verbatim(i,"background"));
    const backgroundPromise=setup.MemoryConsolidator.consolidateSTM("hoodedWoman",concurrentClient,{purpose:"mind-background",concurrent:true});
    await sleep(0);
    let status=setup.AIRequestExecutor.getStatus();
    assert(status.busy===true && status.blockingBusy===false, "active background mind request must never create gameplay blocking Thinking state");
    release(); ok(await backgroundPromise,"background completion");

    // MindAux enforces at most one queued/active job per character and invalidation preserves sources.
    setup.MindAuxExecutor.invalidateForTimelapse();
    fixture=resetMind(); fixture.actor.mind.verbatimObservations=Array.from({length:41},(_,i)=>verbatim(i,"aux"));
    let auxRelease;
    const auxDeferred=new Promise(resolve=>{auxRelease=resolve;});
    setup.OpenRouterClient={enforceRequestTiming:false,chat:async()=>{await auxDeferred;return {ok:true,modelId:"test",content:JSON.stringify(emptyStmResult()),usage:null};}};
    const first=setup.MindAuxExecutor.schedule("hoodedWoman");
    const second=setup.MindAuxExecutor.schedule("hoodedWoman");
    assert(first.scheduled===true && second.scheduled===false, "only one background mind job per character may exist");
    await sleep(5);
    status=setup.MindAuxExecutor.getStatus();
    assert(status.jobs.filter(j=>j.characterId==="hoodedWoman").length===1, "aux executor must expose exactly one job for actor");
    const auxBeforeIds=setup.Game.getWorld().entities.hoodedWoman.mind.verbatimObservations.map(v=>v.id);
    setup.MindAuxExecutor.invalidateForTimelapse();
    auxRelease(); await sleep(5);
    actor=setup.Game.getWorld().entities.hoodedWoman;
    assert(actor.mind.verbatimObservations.map(v=>v.id).join("|")===auxBeforeIds.join("|"), "safe auxiliary invalidation must leave source observations intact");

    // In-flight auxiliary state is transient: the canonical world contains no job serialization.
    assert(!JSON.stringify(setup.Game.getWorld()).includes("queuedAt") && !JSON.stringify(setup.Game.getWorld()).includes("mind-background"), "auxiliary job lifecycle must not be serialized into canonical world state");

    console.log("Mind v3 memory consolidation tests passed.");
}

main().catch(error=>{ console.error(error && error.stack || error); process.exit(1); });
