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
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function assert(v,m) { if(!v) throw new Error(m); }
function ok(r,m) { assert(r && r.ok, `${m}: ${JSON.stringify(r)}`); return r; }
function memory(id, summary, importance, protectedFlag) { return { id, summary:summary||id, importance:importance===undefined?0.5:importance, protected:protectedFlag===true }; }
function belief(id,text,confidence) { return { id, text:text||id, confidence:confidence||"medium" }; }
function fillRecent(character,count,prefix) { character.mind.recentMemories=Array.from({length:count},(_,i)=>memory(`${prefix}_${i+1}`,`${prefix} memory ${i+1}`,0.5)); }
function stageFrom(messages) { return JSON.parse(messages[1].content).stage; }
function scriptedClient(handler,seen) {
    return { enforceRequestTiming:false, chat:async function(messages) {
        if(seen) seen.push(clone(messages));
        const payload=JSON.parse(messages[1].content);
        const value=await handler(payload.stage,payload.context,messages);
        if(value && value.__failure) return {ok:false,modelId:"test",error:value.error};
        return {ok:true,modelId:"test",content:JSON.stringify(value),usage:{prompt_tokens:100,completion_tokens:20}};
    }};
}
const keepBatch = context => ({groups:[],archiveOnlyRecentMemoryIds:[],keepActiveRecentMemoryIds:context.sourceRecentMemories.map(m=>m.id)});
const noConflicts = () => ({conflicts:[]});
const keepConflict = () => ({resolution:"keep_conflict",beliefReplacement:null,memoryReplacement:null});

[
"src/00-model-list.js","src/generated/world-data.js","src/08-mind-validators.js","src/10-game-api.js","src/11-save-migration.js",
"src/12-character-context.js","src/13-character-memory.js","src/14-event-perception.js","src/21-ai-settings.js","src/21-ai-request-profiles.js",
"src/22-openrouter-client.js","src/23-ai-protocol.js","src/24-ai-request-executor.js","src/24-ai-turn-scheduler.js","src/20-controllers.js","src/24-memory-consolidator.js"
].forEach(load);

async function main() {
    setup.AIRuntimeSettings.save("sk-or-v1-test-memory-consolidation-key-1234567890", false, storage, Date.now());

    // v2.1 exact recent schema remains, while v2.2 exposes explicit discovery/resolution contracts.
    const recentPayload=JSON.parse(setup.AIProtocol.memoryMaintenanceMessages("memory-consolidation-recent",{sourceRecentMemories:[memory("old_1")],newerReadOnlyRecentMemories:[memory("new_1")]} )[1].content);
    assert(Object.keys(recentPayload.requiredResponseShape.groups[0].replacement).sort().join(",")==="importance,summary" && !recentPayload.requiredResponseShape.groups[0].replacement.protected,
        "recent schema must keep engine-owned fields out of model replacements");
    const discoveryPayload=JSON.parse(setup.AIProtocol.memoryMaintenanceMessages("memory-consolidation-reconciliation-discovery",{currentBeliefs:[belief("b")],activeLongTermMemories:[memory("m")]} )[1].content);
    assert(Object.keys(discoveryPayload.requiredResponseShape.conflicts[0]).sort().join(",")==="beliefId,longTermMemoryId,strength" && discoveryPayload.responseRules.join(" ").includes("direct, strong, or possible"),
        "discovery must expose an exact read-only conflict schema with strength enum");
    const resolutionMessages=setup.AIProtocol.memoryMaintenanceMessages("memory-consolidation-reconciliation-resolution",{selectedBelief:belief("b"),selectedLongTermMemory:memory("m")});
    const resolutionPayload=JSON.parse(resolutionMessages[1].content);
    assert(Object.keys(resolutionPayload.requiredResponseShape).sort().join(",")==="beliefReplacement,memoryReplacement,resolution" && resolutionMessages[0].content.includes("belief is not automatically more authoritative") && resolutionMessages[0].content.includes("memory is not automatically more authoritative"),
        "resolution must be exact and explicitly deny belief/memory supremacy");
    const longTermPayload=JSON.parse(setup.AIProtocol.memoryMaintenanceMessages("memory-consolidation-longterm",{longTermMemories:[]})[1].content);
    assert(longTermPayload.responseRules.some(rule=>rule.includes("merge:null")),"long-term merge must remain optional");

    // Repair repeats the exact new-stage contract.
    let repairAttempt=0; const repairSeen=[];
    const repaired=await setup.AIProtocol.requestValidated(resolutionMessages,"memory-consolidation-reconciliation-resolution",{chat:async function(messages){
        repairSeen.push(clone(messages)); repairAttempt++;
        if(repairAttempt===1) return {ok:true,modelId:"test",content:JSON.stringify({resolution:"revise_belief",beliefReplacement:{id:"illegal",text:"x",confidence:"high"},memoryReplacement:null})};
        return {ok:true,modelId:"test",content:JSON.stringify({resolution:"keep_conflict",beliefReplacement:null,memoryReplacement:null})};
    }});
    ok(repaired,"resolution repair");
    assert(repairSeen[1][repairSeen[1].length-1].content.includes("Exact response shape") && repairSeen[1][repairSeen[1].length-1].content.includes("beliefReplacement"),"repair must repeat exact resolution contract");

    // Recent consolidation still archives sources and snapshots once; reconciliation scans after it.
    setup.Game.resetWorld(); let world=setup.Game.getWorld(); let mara=world.entities.hoodedWoman;
    fillRecent(mara,15,"recent"); mara.mind.beliefs=[belief("a_belief","Current view")]; mara.mind.longTermMemories=[memory("protected_ltm","Never rewrite this",0.95,true)];
    const before=clone(mara.mind); const seen=[];
    const recentResult=await setup.MemoryConsolidator.compress("hoodedWoman",scriptedClient((stage,context)=>{
        if(stage==="memory-consolidation-recent") return {groups:[{sourceRecentMemoryIds:context.sourceRecentMemories.map(m=>m.id),replacement:{summary:"Five early encounters became one durable episode.",importance:0.8}}],archiveOnlyRecentMemoryIds:[],keepActiveRecentMemoryIds:[]};
        if(stage==="memory-consolidation-reconciliation-discovery") return noConflicts();
        throw new Error(`unexpected stage ${stage}`);
    },seen));
    ok(recentResult,"recent maintenance"); world=setup.Game.getWorld(); mara=world.entities.hoodedWoman;
    assert(mara.mind.recentMemories.length===10 && mara.mind.maintenanceArchive.memories.length===5,"recent consolidation must archive five old sources and retain newest ten");
    assert(mara.mindMaintenanceSnapshots.length===1 && JSON.stringify(mara.mindMaintenanceSnapshots[0].mind)===JSON.stringify(before),"one successful mind change must keep one full pre-maintenance snapshot");
    assert(seen.map(stageFrom).join(",")==="memory-consolidation-recent,memory-consolidation-reconciliation-discovery","bounded maintenance must run recent then reconciliation discovery");

    // Newest ten remain read-only correction evidence.
    setup.Game.resetWorld(); world=setup.Game.getWorld(); mara=world.entities.hoodedWoman;
    mara.mind.beliefs=[]; mara.mind.longTermMemories=[];
    mara.mind.recentMemories=[memory("tea_old","Dmytro made tea for Mara.")].concat(Array.from({length:9},(_,i)=>memory(`mid_${i}`,`Middle ${i}`))).concat([memory("tea_correction","Dmytro corrected Mara: Mara actually made the tea.")]);
    ok(await setup.MemoryConsolidator.compress("hoodedWoman",scriptedClient((stage,context)=>{
        assert(stage==="memory-consolidation-recent","correction fixture only needs recent stage");
        assert(context.sourceRecentMemories.length===1 && context.sourceRecentMemories[0].id==="tea_old","only old source is actionable");
        assert(context.newerReadOnlyRecentMemories.length===10 && context.newerReadOnlyRecentMemories.some(m=>m.id==="tea_correction"),"newest ten must be read-only correction evidence");
        return {groups:[{sourceRecentMemoryIds:["tea_old"],replacement:{summary:"Mara made the tea; she later realized she had initially remembered it incorrectly.",importance:0.5}}],archiveOnlyRecentMemoryIds:[],keepActiveRecentMemoryIds:[]};
    })),"recent correction-context maintenance");

    // Exact old failure class remains transactional.
    setup.Game.resetWorld(); world=setup.Game.getWorld(); fillRecent(world.entities.hoodedWoman,11,"illegal"); world.entities.hoodedWoman.mind.beliefs=[]; world.entities.hoodedWoman.mind.longTermMemories=[];
    const illegalBefore=clone(world.entities.hoodedWoman.mind);
    const illegalResult=await setup.MemoryConsolidator.compress("hoodedWoman",{chat:async function(messages){const c=JSON.parse(messages[1].content).context;return {ok:true,modelId:"test",content:JSON.stringify({groups:[{sourceRecentMemoryIds:c.sourceRecentMemories.map(m=>m.id),replacement:{summary:"bad",importance:0.5,protected:false}}],archiveOnlyRecentMemoryIds:[],keepActiveRecentMemoryIds:[]})};}});
    assert(!illegalResult.ok && JSON.stringify(setup.Game.getWorld().entities.hoodedWoman.mind)===JSON.stringify(illegalBefore) && setup.Game.getWorld().entities.hoodedWoman.mindMaintenanceSnapshots.length===0,
        "illegal model-owned protected field must still fail without mutation/snapshot");

    // Cursor is per-character, deterministic, persists as world state, and advances on successful no-change scans without snapshots.
    setup.Game.resetWorld(); world=setup.Game.getWorld();
    for(const id of ["hoodedWoman","blacksmith"]) {
        const c=world.entities[id]; c.mind.beliefs=[belief("a"),belief("b"),belief("c"),belief("d"),belief("e"),belief("f")]; c.mind.longTermMemories=[memory("lt")]; c.mind.recentMemories=[]; c.mindMaintenanceSnapshots=[]; c.mindMaintenanceState={reconciliationCursor:{afterBeliefId:null}};
    }
    const cursorBatches=[];
    ok(await setup.MemoryConsolidator.compress("hoodedWoman",scriptedClient((stage,context)=>{assert(stage==="memory-consolidation-reconciliation-discovery","cursor fixture only discovers");cursorBatches.push(context.currentBeliefs.map(b=>b.id));return noConflicts();})),"cursor pass 1");
    world=setup.Game.getWorld();
    assert(cursorBatches[0].join(",")==="a,b,c,d,e" && world.entities.hoodedWoman.mindMaintenanceState.reconciliationCursor.afterBeliefId==="e" && world.entities.blacksmith.mindMaintenanceState.reconciliationCursor.afterBeliefId===null,"cursor must be per-character and advance through first five");
    assert(world.entities.hoodedWoman.mindMaintenanceSnapshots.length===0,"cursor-only progress must not create personality snapshot");
    ok(await setup.MemoryConsolidator.compress("hoodedWoman",scriptedClient((stage,context)=>{cursorBatches.push(context.currentBeliefs.map(b=>b.id));return noConflicts();})),"cursor pass 2");
    world=setup.Game.getWorld();
    assert(cursorBatches[1].join(",")==="f,a,b,c,d" && world.entities.hoodedWoman.mindMaintenanceState.reconciliationCursor.afterBeliefId==="d","cursor must wrap deterministically without skipping forever");
    const savedClone=clone(world); State.variables.world=savedClone; ok(setup.Game.bootstrap(),"bootstrap cloned current world");
    assert(setup.Game.getWorld().entities.hoodedWoman.mindMaintenanceState.reconciliationCursor.afterBeliefId==="d","cursor must survive ordinary save/load state cloning");

    // Missing anchor resumes at the next deterministic ID.
    world=setup.Game.getWorld(); mara=world.entities.hoodedWoman; mara.mind.beliefs=[belief("a"),belief("c"),belief("d"),belief("e"),belief("f"),belief("g")]; mara.mindMaintenanceState={reconciliationCursor:{afterBeliefId:"b"}};
    let anchorBatch=null;
    ok(await setup.MemoryConsolidator.compress("hoodedWoman",scriptedClient((stage,context)=>{anchorBatch=context.currentBeliefs.map(b=>b.id);return noConflicts();})),"missing anchor pass");
    assert(anchorBatch.join(",")==="c,d,e,f,g","deleted cursor anchor must resume from next deterministic belief ID");

    // Discovery validation and deterministic strongest-two resolution.
    const discoveryContext={currentBeliefs:[belief("a"),belief("b")],activeLongTermMemories:[memory("m1"),memory("m2"),memory("m3")]};
    assert(!setup.AIProtocol.validateReconciliationDiscovery({conflicts:Array.from({length:9},(_,i)=>({beliefId:"a",longTermMemoryId:`m${(i%3)+1}`,strength:"possible"}))},discoveryContext).ok,"discovery must cap candidates");
    assert(!setup.AIProtocol.validateReconciliationDiscovery({conflicts:[{beliefId:"missing",longTermMemoryId:"m1",strength:"direct"}]},discoveryContext).ok,"discovery may only reference current batch beliefs");

    setup.Game.resetWorld(); world=setup.Game.getWorld(); mara=world.entities.hoodedWoman;
    mara.mind.beliefs=[belief("a","A"),belief("b","B"),belief("c","C"),belief("d","D"),belief("e","E")];
    mara.mind.longTermMemories=[memory("m1","M1"),memory("m2","M2"),memory("m3","M3")]; mara.mind.recentMemories=[];
    const resolvedPairs=[];
    ok(await setup.MemoryConsolidator.compress("hoodedWoman",scriptedClient((stage,context)=>{
        if(stage==="memory-consolidation-reconciliation-discovery") return {conflicts:[
            {beliefId:"a",longTermMemoryId:"m1",strength:"possible"},
            {beliefId:"b",longTermMemoryId:"m2",strength:"direct"},
            {beliefId:"c",longTermMemoryId:"m3",strength:"strong"}
        ]};
        if(stage==="memory-consolidation-reconciliation-resolution") { resolvedPairs.push(`${context.selectedBelief.id}/${context.selectedLongTermMemory.id}`); return keepConflict(); }
        throw new Error(`unexpected ${stage}`);
    })),"strongest two reconciliation");
    assert(resolvedPairs.join(",")==="b/m2,c/m3","engine must resolve direct before strong and ignore weaker third candidate this run");

    // Tea fixture: neither record type is privileged; explicit later evidence can justify revising the stale LT only.
    setup.Game.resetWorld(); world=setup.Game.getWorld(); mara=world.entities.hoodedWoman;
    mara.mind.beliefs=[belief("a_filler","Unrelated"),belief("b_tea","I mistakenly thought Dmytro made me tea, but actually I made it.","high")];
    mara.mind.longTermMemories=[memory("tea_ltm","He is the first lover who made me tea first.",0.8),memory("other_ltm","Unrelated durable memory",0.5)];
    mara.mind.recentMemories=[memory("tea_correction","Dmytro corrected me: it was actually me who made the tea, not him.",0.5)];
    const teaBeforeBelief=clone(mara.mind.beliefs[1]);
    ok(await setup.MemoryConsolidator.compress("hoodedWoman",scriptedClient((stage,context)=>{
        if(stage==="memory-consolidation-reconciliation-discovery") return {conflicts:[{beliefId:"b_tea",longTermMemoryId:"tea_ltm",strength:"direct"}]};
        if(stage==="memory-consolidation-reconciliation-resolution") {
            assert(context.activeRecentMemories.some(m=>m.id==="tea_correction"),"resolver must receive recent evidence including explicit correction");
            return {resolution:"revise_memory",beliefReplacement:null,memoryReplacement:{summary:"At the cottage, I made tea; I had initially misremembered Dmytro as making it.",importance:0.8}};
        }
        throw new Error(`unexpected ${stage}`);
    })),"tea dissonance resolution");
    world=setup.Game.getWorld(); mara=world.entities.hoodedWoman;
    assert(mara.mind.longTermMemories.find(m=>m.id==="tea_ltm").summary.startsWith("At the cottage, I made tea") && JSON.stringify(mara.mind.beliefs.find(b=>b.id==="b_tea"))===JSON.stringify(teaBeforeBelief),"tea evidence may correct stale memory without changing already-correct belief");
    assert(mara.mind.maintenanceArchive.memories.some(e=>e.record.id==="tea_ltm" && e.record.summary.includes("made me tea")),"stale LT source must remain recoverable in archive");

    // Uncertainty and protected-memory behavior.
    const protectedContext={selectedBelief:belief("b"),selectedLongTermMemory:memory("p","protected",1,true)};
    assert(!setup.AIProtocol.validateReconciliationResolution({resolution:"revise_memory",beliefReplacement:null,memoryReplacement:{summary:"x",importance:0.5}},protectedContext).ok,"protected selected memory may not be revised");
    assert(setup.AIProtocol.validateReconciliationResolution({resolution:"revise_belief",beliefReplacement:{text:"I may be remembering this incorrectly.",confidence:"low"},memoryReplacement:null},protectedContext).ok,"protected memory may still serve as read-only evidence for belief revision");
    assert(setup.AIProtocol.validateReconciliationResolution({resolution:"keep_conflict",beliefReplacement:null,memoryReplacement:null},protectedContext).ok,"keep_conflict must be a first-class valid outcome");

    // Identical proposed revisions are true no-ops: no archive/snapshot, cursor still advances.
    setup.Game.resetWorld(); world=setup.Game.getWorld(); mara=world.entities.hoodedWoman;
    mara.mind.beliefs=[belief("a_same","Same","high")]; mara.mind.longTermMemories=[memory("m_same","Same memory",0.7)]; mara.mind.recentMemories=[];
    ok(await setup.MemoryConsolidator.compress("hoodedWoman",scriptedClient((stage)=>{
        if(stage==="memory-consolidation-reconciliation-discovery") return {conflicts:[{beliefId:"a_same",longTermMemoryId:"m_same",strength:"direct"}]};
        return {resolution:"revise_both",beliefReplacement:{text:"Same",confidence:"high"},memoryReplacement:{summary:"Same memory",importance:0.7}};
    })),"no-op resolution");
    world=setup.Game.getWorld(); mara=world.entities.hoodedWoman;
    assert(mara.mind.maintenanceArchive.memories.length===0 && mara.mind.maintenanceArchive.beliefs.length===0 && mara.mindMaintenanceSnapshots.length===0 && mara.mindMaintenanceState.reconciliationCursor.afterBeliefId==="a_same","identical replacements must not archive/snapshot but successful scan must advance cursor");

    // Failure after one candidate resolution rolls the whole transaction back, including cursor and archive.
    setup.Game.resetWorld(); world=setup.Game.getWorld(); mara=world.entities.hoodedWoman;
    mara.mind.beliefs=[belief("a","old A"),belief("b","old B")]; mara.mind.longTermMemories=[memory("m1","old M1"),memory("m2","old M2")]; mara.mind.recentMemories=[];
    const rollbackMind=clone(mara.mind), rollbackState=clone(mara.mindMaintenanceState); let resolveCount=0;
    const rollback=await setup.MemoryConsolidator.compress("hoodedWoman",scriptedClient((stage)=>{
        if(stage==="memory-consolidation-reconciliation-discovery") return {conflicts:[{beliefId:"a",longTermMemoryId:"m1",strength:"direct"},{beliefId:"b",longTermMemoryId:"m2",strength:"direct"}]};
        resolveCount++; if(resolveCount===1) return {resolution:"revise_belief",beliefReplacement:{text:"new A",confidence:"high"},memoryReplacement:null};
        return {__failure:true,error:{code:"SYNTHETIC_FAILURE",message:"second resolver failed"}};
    }));
    assert(!rollback.ok && JSON.stringify(setup.Game.getWorld().entities.hoodedWoman.mind)===JSON.stringify(rollbackMind) && JSON.stringify(setup.Game.getWorld().entities.hoodedWoman.mindMaintenanceState)===JSON.stringify(rollbackState) && setup.Game.getWorld().entities.hoodedWoman.mindMaintenanceSnapshots.length===0,"later resolver failure must roll back earlier candidate changes and cursor");

    // Long-term merge remains tiny and archival; with no beliefs there is no reconciliation stage.
    setup.Game.resetWorld(); world=setup.Game.getWorld(); mara=world.entities.hoodedWoman;
    mara.mind.beliefs=[]; mara.mind.recentMemories=[]; mara.mind.longTermMemories=Array.from({length:30},(_,i)=>memory(`lt_${i}`,`Topic ${i}`,0.5,i===29)); let ltCalls=0;
    ok(await setup.MemoryConsolidator.compress("hoodedWoman",scriptedClient((stage)=>{assert(stage==="memory-consolidation-longterm","LT-only fixture should use LT stage");ltCalls++;return {merge:{sourceLongTermMemoryIds:["lt_0","lt_1","lt_2"],replacement:{summary:"Topics zero through two as one durable thread.",importance:0.7}}};})),"LT merge");
    world=setup.Game.getWorld(); mara=world.entities.hoodedWoman;
    assert(ltCalls===1 && mara.mind.longTermMemories.length===28 && mara.mind.maintenanceArchive.memories.length===3 && mara.mind.longTermMemories.some(m=>m.id==="lt_29"&&m.protected),"bounded LT merge must archive sources and preserve protected memory");

    // Stale live maintenance state is protected just like mind partitions.
    setup.Game.resetWorld(); world=setup.Game.getWorld(); mara=world.entities.hoodedWoman;
    mara.mind.beliefs=[belief("a")]; mara.mind.longTermMemories=[memory("m")]; mara.mind.recentMemories=[];
    const stale=await setup.MemoryConsolidator.compress("hoodedWoman",scriptedClient((stage)=>{if(stage==="memory-consolidation-reconciliation-discovery"){setup.Game.getWorld().entities.hoodedWoman.mindMaintenanceState.reconciliationCursor.afterBeliefId="external";return noConflicts();} return keepConflict();}));
    assert(!stale.ok && stale.error.code==="MEMORY_CONSOLIDATION_STALE" && setup.Game.getWorld().entities.hoodedWoman.mindMaintenanceState.reconciliationCursor.afterBeliefId==="external","concurrent cursor mutation must reject stale candidate without overwriting live state");

    // Snapshot FIFO remains five and captures full mind, not operational cursor state.
    setup.Game.resetWorld();
    for(let i=0;i<7;i++) { const actor=setup.Game.getWorld().entities.hoodedWoman; actor.mind.beliefs=[belief(`snap_${i}`,`snapshot ${i}`,"high")]; actor.mind.maintenanceArchive={memories:[],beliefs:[]}; ok(setup.AIMemory.recordMaintenanceSnapshot("hoodedWoman",i%2?"automatic":"manual"),"record snapshot"); }
    const snapshots=setup.Game.getWorld().entities.hoodedWoman.mindMaintenanceSnapshots;
    assert(snapshots.length===5 && snapshots[0].mind.beliefs[0].id==="snap_2" && !Object.prototype.hasOwnProperty.call(snapshots[0].mind,"mindMaintenanceState"),"snapshot FIFO keeps newest five full minds but excludes operational cursor state");

    // Portable mind remains identity-only and excludes the world-local cursor.
    const exported=setup.CharacterMindTransfer.exportMind("hoodedWoman");
    ok(exported,"portable export");
    assert(!Object.prototype.hasOwnProperty.call(exported.document,"mindMaintenanceState") && !Object.prototype.hasOwnProperty.call(exported.document.mind,"mindMaintenanceState"),"portable mind must not carry reconciliation cursor");
    setup.Game.getWorld().entities.hoodedWoman.mindMaintenanceState.reconciliationCursor.afterBeliefId="stale_portable_anchor";
    ok(setup.CharacterMindTransfer.importMind("hoodedWoman",exported.document),"portable re-import");
    assert(setup.Game.getWorld().entities.hoodedWoman.mindMaintenanceState.reconciliationCursor.afterBeliefId===null,"portable import must reset world-local reconciliation cursor to the beginning");

    console.log("All character memory consolidation tests passed.");
}
main().catch(error=>{console.error(error&&error.stack||error);process.exit(1);});
