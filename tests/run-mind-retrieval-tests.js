"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.resolve(__dirname, "..");
const runtimeFiles = require("./runtime-files");

global.setup = {};
global.State = { variables: {}, passage: "The Tavern" };
global.Engine = { play:function(){}, show:function(){} };
function load(file) { vm.runInThisContext(fs.readFileSync(path.join(root,file),"utf8"), { filename:file }); }
function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
function assert(v,m) { if(!v) throw new Error(m); }
function ok(r,m) { assert(r && r.ok, `${m}: ${JSON.stringify(r)}`); return r; }

runtimeFiles.augment([
  "src/00-model-list.js","src/generated/world-data.js","src/07-mind-v3.js","src/08-mind-validators.js","src/10-game-api.js","src/11-save-migration.js",
  "src/12-character-context.js","src/13-character-memory.js","src/13-verbatim-memory.js","src/14-event-perception.js","src/17-runtime-diagnostics.js",
  "src/21-ai-settings.js","src/21-ai-request-profiles.js","src/22-openrouter-client.js","src/23-ai-protocol.js","src/24-ai-request-executor.js",
  "src/24-ai-turn-scheduler.js","src/20-controllers.js","src/24-memory-consolidator.js","src/24-mind-aux-executor.js"
]).forEach(load);

function fresh() {
  setup.Game.resetWorld();
  setup.Game.acceptPlayerDisclaimer();
  setup.Game.acknowledgeAISetup();
  setup.Game.finalizePlayerSetup({ mode:"generic" });
  return setup.Game.getWorld();
}
function client(handler, seen) {
  return { enforceRequestTiming:false, chat:async function(messages) {
    const payload=JSON.parse(messages[1].content);
    if(seen) seen.push(clone(payload));
    const value=await handler(payload,messages);
    if(value && value.__failure) return {ok:false,error:value.error||{code:"TEST_FAILURE",message:"failed"},modelId:"test"};
    if(value && value.__raw !== undefined) return {ok:true,content:value.__raw,usage:null,modelId:"test"};
    return {ok:true,content:JSON.stringify(value),usage:{prompt_tokens:20,completion_tokens:4},modelId:"test"};
  }};
}

async function main() {
  let world=fresh();
  const actor=world.entities.hoodedWoman;
  assert(setup.MindValidators.retrievalBriefValid("B".repeat(600)) && !setup.MindValidators.retrievalBriefValid("B".repeat(601)) && !setup.MindValidators.retrievalBriefValid("",{requireNonEmpty:true}),"STM/LTM retrieval briefs must share one <=600-character validator with optional non-empty backfill enforcement");
  actor.mind.beliefs = Array.from({length:18},(_,i)=>({id:`belief_r_${i}`,text:`Belief semantic ${i}`,confidence:0.5+(i%4)*0.1,activation:0.2+(i%5)*0.1}));
  actor.mind.shortTermMemories = Array.from({length:13},(_,i)=>({id:`stm_r_${i}`,topic:`STM topic ${i}`,summary:`Full STM summary secret ${i}`,retrievalBrief:i===0?"":"STM brief "+i,importance:0.5,protected:false}));
  actor.mind.longTermMemories = Array.from({length:9},(_,i)=>({id:`ltm_r_${i}`,topic:`LTM topic ${i}`,summary:`Full LTM summary secret ${i}`,retrievalBrief:i===0?"":"LTM brief "+i,importance:0.6,protected:false}));
  actor.mind.verbatimObservations = [{id:"verb_r_1",turn:1,kind:"observation",text:"Recent trust-related observation."}];
  actor.recentDialogue = [];
  world.ai.continuations.hoodedWoman="Continue the trust conversation.";

  const catalog=setup.MindSemanticRetrieval.buildCatalog("hoodedWoman");
  assert(catalog.longTermMemories[0].retrievalBrief==="" && !Object.prototype.hasOwnProperty.call(catalog.longTermMemories[0],"summary"),"preflight catalog must keep empty brief and never expose full LTM summary");
  assert(!Object.prototype.hasOwnProperty.call(catalog.shortTermMemories[0],"summary"),"preflight catalog must never expose full STM summary");
  assert(catalog.beliefs[0].text && typeof catalog.beliefs[0].confidence==="number" && typeof catalog.beliefs[0].activation==="number","belief catalog must use text/confidence/activation without retrievalBrief");

  const seen=[];
  const chosen={beliefIds:["belief_r_17","belief_r_3"],stmIds:["stm_r_0","stm_r_12"],ltmIds:["ltm_r_0","ltm_r_8"]};
  let result=await setup.MindSemanticRetrieval.select("hoodedWoman",[{id:"p1",kind:"speech",turn:2,text:"Why is trust difficult?"}],client(payload=>{
    assert(payload.runtime.continuation==="Continue the trust conversation.","preflight runtime must include continuation");
    assert(payload.catalog.longTermMemories[0].topic==="LTM topic 0" && payload.catalog.longTermMemories[0].retrievalBrief==="","topic-only legacy memory must remain semantically selectable");
    assert(!JSON.stringify(payload.catalog).includes("Full LTM summary secret"),"selector payload must not contain full LTM summaries");
    assert(!JSON.stringify(payload.catalog).includes("Full STM summary secret"),"selector payload must not contain full STM summaries");
    return chosen;
  },seen));
  ok(result,"semantic selector succeeds");
  assert(result.semantic===true && result.fallbackUsed===false && JSON.stringify(result.selection)===JSON.stringify(chosen),"semantic selector must return chosen IDs without padding quotas");
  const context=setup.ContextBuilder.build("hoodedWoman",{pendingObservations:[],mindSelection:result.selection});
  assert(context.mind.longTermMemories.length===2 && context.mind.longTermMemories.some(m=>m.summary==="Full LTM summary secret 0"),"expensive decision context must fetch full selected LTM records by ID");
  assert(context.mind.shortTermMemories.length===2 && context.mind.beliefs.length===2,"selected STM/beliefs must be fetched under configured budgets");

  // Production hardening: salvage useful semantic selections even when Flash returns
  // unknown/wrong-type/duplicate/over-budget IDs alongside valid memories.
  const noisySelection={
    beliefIds:Array.from({length:18},(_,i)=>`belief_r_${i}`).concat(["belief_missing","ltm_r_0","belief_r_0",null]),
    stmIds:Array.from({length:13},(_,i)=>`stm_r_${i}`).concat(["stm_missing","belief_r_0","stm_r_0"]),
    ltmIds:Array.from({length:9},(_,i)=>`ltm_r_${i}`).concat(["ltm_missing","stm_r_0","ltm_r_0"])
  };
  result=await setup.MindSemanticRetrieval.select("hoodedWoman",[],client((payload,messages)=>{
    assert(messages[0].content.includes("beliefs 16, STM 12, LTM 8")&&messages[0].content.includes("smallest sufficient set"),"selector prompt must state dynamic maxima and discourage quota filling");
    return noisySelection;
  }));
  ok(result,"noisy semantic selector result is salvaged");
  assert(result.semantic===true&&result.fallbackUsed===false,"safe read-path sanitation must not force deterministic fallback");
  assert(result.selection.beliefIds.length===16&&result.selection.beliefIds[0]==="belief_r_0"&&result.selection.beliefIds[15]==="belief_r_15","belief selection must preserve model order and trim after sanitation");
  assert(result.selection.stmIds.length===12&&result.selection.stmIds[11]==="stm_r_11"&&result.selection.ltmIds.length===8&&result.selection.ltmIds[7]==="ltm_r_7","STM/LTM selections must trim to configured budgets");
  let noisyDiagnostic=setup.MindSemanticRetrieval.getDiagnostics().slice(-1)[0];
  assert(noisyDiagnostic.semanticResultUsed===true&&noisyDiagnostic.fallbackUsed===false,"diagnostics must distinguish salvaged semantic output from fallback");
  assert(noisyDiagnostic.droppedUnknownIds.some(x=>x.id==="belief_missing")&&noisyDiagnostic.droppedWrongTypeIds.some(x=>x.id==="ltm_r_0"&&x.category==="beliefIds")&&noisyDiagnostic.droppedDuplicateIds.some(x=>x.id==="belief_r_0"),"diagnostics must expose unknown, wrong-category and duplicate IDs");
  assert(noisyDiagnostic.trimmedCounts.beliefs===2&&noisyDiagnostic.trimmedCounts.stm===1&&noisyDiagnostic.trimmedCounts.ltm===1,"diagnostics must expose valid over-budget trimming");

  result=await setup.MindSemanticRetrieval.select("hoodedWoman",[],client(()=>({beliefIds:[],stmIds:[],ltmIds:[]})));
  ok(result,"empty semantic selection is valid");
  assert(result.semantic===true&&result.fallbackUsed===false&&result.selection.beliefIds.length===0&&result.selection.stmIds.length===0&&result.selection.ltmIds.length===0,"valid empty selection must not be replaced by deterministic memory");

  const deterministic=setup.CharacterContext.selectMindDeterministically("hoodedWoman",[]);
  let failedSelectorCalls=0;
  result=await setup.MindSemanticRetrieval.select("hoodedWoman",[],client(()=>{failedSelectorCalls++;return {__raw:"{bad json"};}));
  ok(result,"selector parse failure degrades safely");
  assert(result.fallbackUsed===true && JSON.stringify(result.selection)===JSON.stringify(deterministic),"selector parse failure must use current deterministic bounded fallback");
  assert(failedSelectorCalls===1,"malformed selector JSON must not trigger a model repair request");

  let truncatedCalls=0;
  result=await setup.MindSemanticRetrieval.select("hoodedWoman",[],client(()=>{truncatedCalls++;return {__failure:true,error:{code:"MODEL_OUTPUT_TRUNCATED",message:"truncated"}};}));
  ok(result,"selector truncation degrades safely");
  assert(result.fallbackUsed===true&&truncatedCalls===1,"selector truncation must fall back immediately without retry/repair");

  result=await setup.MindSemanticRetrieval.select("hoodedWoman",[],client(()=>({beliefIds:[],stmIds:[]})));
  ok(result,"fundamentally incomplete selector structure degrades safely");
  assert(result.fallbackUsed===true,"missing required selection arrays must still use deterministic fallback");
  const diagnostics=setup.MindSemanticRetrieval.getDiagnostics();
  assert(diagnostics.some(d=>d.fallbackUsed===false) && diagnostics.some(d=>d.fallbackUsed===true),"selector diagnostics must record semantic success and fallback use");

  world=setup.Game.getWorld();
  const target=world.entities.hoodedWoman;
  target.mind.shortTermMemories=[{id:"stm_backfill",topic:"A legacy topic",summary:"A legacy memory summary",retrievalBrief:"",importance:0.5,protected:false}];
  target.mind.longTermMemories=[{id:"ltm_backfill",topic:"Another legacy topic",summary:"Another legacy memory summary",retrievalBrief:"",importance:0.7,protected:false}];
  const snapshotsBefore=(target.mindMaintenanceSnapshots||[]).length;
  const backfillSeen=[];
  result=await setup.RetrievalBriefBackfill.runNow("hoodedWoman",client((payload,messages)=>{
    backfillSeen.push(clone(payload));
    assert(messages[0].content.includes("same semantics for STM and LTM")&&messages[0].content.includes("600 characters or fewer")&&messages[0].content.includes("NOT a second summary")&&messages[0].content.includes("do not chronologically retell"),"ambient backfill must reuse the same common retrievalBrief guidance as STM/LTM consolidation");
    return {briefs:payload.memories.map(m=>({id:m.id,retrievalBrief:`Brief for ${m.topic}`}))};
  }));
  ok(result,"ambient retrieval brief backfill succeeds");
  world=setup.Game.getWorld();
  assert(world.entities.hoodedWoman.mind.shortTermMemories[0].retrievalBrief==="Brief for A legacy topic" && world.entities.hoodedWoman.mind.longTermMemories[0].retrievalBrief==="Brief for Another legacy topic","backfill must fill every empty STM/LTM brief");
  assert((world.entities.hoodedWoman.mindMaintenanceSnapshots||[]).length===snapshotsBefore,"brief-only recovery must not create full mind recovery snapshots");
  assert(backfillSeen.length===1 && backfillSeen[0].memories.length===2,"backfill request must include all and only current empty-brief memories");
  result=await setup.RetrievalBriefBackfill.runNow("hoodedWoman",client(()=>{throw new Error("model should not be called when no briefs are empty");}));
  ok(result,"filled mind makes backfill idempotent no-op");
  assert(result.nothingToBackfill===true,"filled mind must not issue another backfill request");

  // Full AIController path performs semantic preflight first, then the expensive decision with only fetched selected records.
  world=fresh();
  const liveActor=world.entities.hoodedWoman;
  liveActor.mind.beliefs=[{id:"belief_keep",text:"Relevant belief",confidence:0.8,activation:0.7},{id:"belief_drop",text:"Irrelevant belief",confidence:0.8,activation:0.7}];
  liveActor.mind.shortTermMemories=[{id:"stm_keep",topic:"Relevant STM",summary:"FULL SELECTED STM",retrievalBrief:"Useful for the current exchange",importance:0.7,protected:false},{id:"stm_drop",topic:"Irrelevant STM",summary:"FULL UNSELECTED STM",retrievalBrief:"Unrelated",importance:0.7,protected:false}];
  liveActor.mind.longTermMemories=[{id:"ltm_keep",topic:"Relevant LTM",summary:"FULL SELECTED LTM",retrievalBrief:"Useful durable context",importance:0.8,protected:false},{id:"ltm_drop",topic:"Irrelevant LTM",summary:"FULL UNSELECTED LTM",retrievalBrief:"Unrelated durable context",importance:0.8,protected:false}];
  liveActor.mind.pendingObservations=[]; world.ai.turnQueue=[];
  setup.EventPerception.enqueueObservation("hoodedWoman",{kind:"speech",turn:2,actorId:"player",targetId:"hoodedWoman",text:"Remember the relevant thing."},world);
  const callKinds=[]; let decisionPayload=null;
  const integratedClient={enforceRequestTiming:false,chat:async function(messages){
    const payload=JSON.parse(messages[1].content);
    if(payload.stage==="mind-retrieval-preflight"){ callKinds.push("preflight"); return {ok:true,modelId:"test",content:JSON.stringify({beliefIds:["belief_keep"],stmIds:["stm_keep"],ltmIds:["ltm_keep"]}),usage:null}; }
    callKinds.push("decision"); decisionPayload=payload;
    return {ok:true,modelId:"test",content:JSON.stringify({action:null,publicNarrative:null,spokenText:null,spokenTargetId:null,spokenLoudness:null,continuation:null,memoryUpdates:{relationshipsToUpsert:[],activatedBeliefIds:[]}}),usage:null};
  }};
  result=await setup.AIController.takeQueuedTurn("hoodedWoman",integratedClient);
  ok(result,"integrated semantic retrieval AI turn");
  assert(callKinds.join("|")==="preflight|decision","ordinary AI turn must execute cheap semantic preflight before expensive decision");
  const decisionJson=JSON.stringify(decisionPayload);
  assert(decisionJson.includes("FULL SELECTED STM")&&decisionJson.includes("FULL SELECTED LTM")&&!decisionJson.includes("FULL UNSELECTED STM")&&!decisionJson.includes("FULL UNSELECTED LTM"),"expensive decision must receive full selected memories and omit unselected full summaries");

  let pokes=0;
  const originalPoke=setup.MindAuxExecutor.pokeEligible;
  setup.MindAuxExecutor.pokeEligible=function(){pokes+=1;return ["hoodedWoman"];};
  const toggle=setup.AITurnScheduler.setAutoMemoryCompressionEnabled(true);
  setup.MindAuxExecutor.pokeEligible=originalPoke;
  assert(toggle.ok&&pokes===1&&toggle.scheduledCharacterIds[0]==="hoodedWoman","enabling automatic consolidation must immediately poke already-eligible background mind work");

  console.log("All semantic mind retrieval tests passed.");
}

main().catch(error=>{ console.error(error&&error.stack||error); process.exitCode=1; });
