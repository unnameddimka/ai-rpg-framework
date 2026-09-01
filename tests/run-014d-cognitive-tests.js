"use strict";

const fs=require("fs"),path=require("path"),vm=require("vm");
const root=path.resolve(__dirname,"..");
const runtimeFiles=require("./runtime-files");
global.setup={};global.State={variables:{},passage:"The Tavern"};global.Engine={play:function(){},show:function(){}};
global.window={localStorage:{getItem:function(){return null;},setItem:function(){},removeItem:function(){}}};
global.localStorage=global.window.localStorage;
function load(file){vm.runInThisContext(fs.readFileSync(path.join(root,file),"utf8"),{filename:file});}
function assert(v,m){if(!v)throw new Error(m);} function ok(v,m){assert(v&&v.ok,`${m}: ${JSON.stringify(v)}`);return v;} function clone(v){return JSON.parse(JSON.stringify(v));}
function belief(id,text,confidence,activation){return{id:id,text:text||id,confidence:confidence===undefined?0.6:confidence,activation:activation===undefined?0.4:activation};}
function fresh(){setup.Game.resetWorld();ok(setup.Game.acceptPlayerDisclaimer(),"accept");ok(setup.Game.acknowledgeAISetup(),"ack");ok(setup.Game.finalizePlayerSetup({mode:"generic"}),"finalize");return setup.Game.getWorld();}
function resetMaraBeliefs(count){const world=fresh(),actor=world.entities.hoodedWoman;actor.mind.schemaVersion=3;actor.mind.verbatimObservations=[];actor.mind.shortTermMemories=[];actor.mind.longTermMemories=[];actor.mind.relationships=[];actor.mind.pendingObservations=[];actor.mind.beliefs=Array.from({length:count},(_,i)=>belief(`belief_bal_${i+1}`,`Durable interpretation ${i+1}`,0.55+i*0.01,0.2+i*0.01));actor.mindRevision=0;actor.mindDiagnostics={beliefHistoryById:{}};actor.mindMaintenanceSnapshots=[];return{world,actor};}
function jsonClient(handler,seen){return{enforceRequestTiming:false,chat:async function(messages){const payload=JSON.parse(messages[1].content);if(seen)seen.push({payload:clone(payload),messages:clone(messages)});const value=await handler(payload,messages);return{ok:true,modelId:"test",content:JSON.stringify(value),usage:{prompt_tokens:1,completion_tokens:1}};}};}

runtimeFiles.augment([
"src/00-model-list.js","src/generated/world-data.js","src/07-mind-v3.js","src/08-mind-validators.js","src/09-action-option-validation.js","src/09-world-state-authority.js","src/10-game-00-item-mechanics.js","src/10-game-01-validation.js","src/10-game-02-actions.js","src/10-game-api.js","src/11-save-migration.js",
"src/12-character-context.js","src/13-character-memory.js","src/13-verbatim-memory.js","src/14-event-perception.js","src/16-emergency-diagnostics.js","src/17-runtime-diagnostics.js",
"src/21-ai-settings.js","src/21-ai-request-profiles.js","src/22-openrouter-client.js","src/23-ai-protocol.js","src/24-ai-request-executor.js","src/24-ai-turn-scheduler.js","src/20-controllers.js","src/24-memory-consolidator.js","src/24-mind-aux-executor.js"
]).forEach(load);

(async function(){
  // Reconciliation must accept canonical belief-length replacement text rather than the old hidden 500-char limit.
  let fixture=resetMaraBeliefs(1);
  const longText="x".repeat(682);
  let validation=setup.MindConsolidationProtocols.validateReconciliationResponse({resolutions:[{beliefIds:["belief_bal_1"],outcome:"contextualize",survivorBeliefId:"belief_bal_1",replacementText:longText,evidenceEffect:null,strength:null}],activatedBeliefIds:[]},{mind:clone(fixture.actor.mind)},clone(fixture.actor.mind.beliefs));
  assert(validation.ok,"contextualize replacementText between 501 and 2000 chars must validate");
  validation=setup.MindConsolidationProtocols.validateReconciliationResponse({resolutions:[{beliefIds:["belief_bal_1"],outcome:"contextualize",survivorBeliefId:"belief_bal_1",replacementText:"x".repeat(2001),evidenceEffect:null,strength:null}],activatedBeliefIds:[]},{mind:clone(fixture.actor.mind)},clone(fixture.actor.mind.beliefs));
  assert(!validation.ok,"replacementText above canonical 2000-char belief limit must reject");

  // Clustering validates only structure/IDs and never allows one belief to belong to multiple clusters.
  fixture=resetMaraBeliefs(6);
  const snapshot={mind:clone(fixture.actor.mind)};
  validation=setup.MindConsolidationProtocols.validateBeliefClusteringResponse({clusters:[{beliefIds:["belief_bal_1","belief_bal_2"]},{beliefIds:["belief_bal_2"]}]},snapshot);
  assert(!validation.ok,"clustering must reject duplicated membership across clusters");
  validation=setup.MindConsolidationProtocols.validateBeliefClusteringResponse({clusters:[{beliefIds:["belief_bal_missing"]}]},snapshot);
  assert(!validation.ok,"clustering must reject unknown belief IDs");

  // Below five total beliefs: skip preflight entirely.
  fixture=resetMaraBeliefs(4); let seen=[];
  let result=await setup.MemoryConsolidator.consolidateBeliefsBalanced("hoodedWoman",jsonClient(()=>{throw new Error("model must not be called");},seen),{});
  ok(result,"balanced total-count skip");
  assert(result.skipped===true&&result.reason==="insufficient_total_beliefs"&&seen.length===0,"fewer than five total beliefs must not spend a model call");

  // Preflight may determine that no narrow cluster reaches five; then no second request is made.
  fixture=resetMaraBeliefs(5); seen=[];
  result=await setup.MemoryConsolidator.consolidateBeliefsBalanced("hoodedWoman",jsonClient((payload)=>{
    if(payload.stage==="mind-v3-belief-clustering")return{clusters:[{beliefIds:["belief_bal_1","belief_bal_2","belief_bal_3"]},{beliefIds:["belief_bal_4","belief_bal_5"]}]};
    throw new Error(`unexpected stage ${payload.stage}`);
  },seen),{});
  ok(result,"balanced semantic threshold skip");
  assert(result.skipped===true&&result.reason==="no_cluster_meets_threshold"&&seen.length===1,"all clusters below five must skip the consolidation request");

  // Successful balanced consolidation is semantic, full-coverage, atomic, and does not bump activation/confidence.
  fixture=resetMaraBeliefs(6); seen=[];
  const beforeById=new Map(fixture.actor.mind.beliefs.map(b=>[b.id,clone(b)]));
  result=await setup.MemoryConsolidator.consolidateBeliefsBalanced("hoodedWoman",jsonClient((payload)=>{
    if(payload.stage==="mind-v3-belief-clustering")return{clusters:[{beliefIds:["belief_bal_1","belief_bal_2","belief_bal_3","belief_bal_4","belief_bal_5"]},{beliefIds:["belief_bal_6"]}]};
    if(payload.stage==="mind-v3-belief-balanced-consolidation")return{results:[
      {operation:"merge",sourceBeliefIds:["belief_bal_1","belief_bal_2"],survivorBeliefId:"belief_bal_1",replacementText:"Merged durable interpretation."},
      {operation:"revise",sourceBeliefIds:["belief_bal_3"],survivorBeliefId:null,replacementText:"Revised durable interpretation."},
      {operation:"keep",sourceBeliefIds:["belief_bal_4"],survivorBeliefId:null,replacementText:null},
      {operation:"remove_as_non_belief",sourceBeliefIds:["belief_bal_5"],survivorBeliefId:null,replacementText:null}
    ]};
    throw new Error(`unexpected stage ${payload.stage}`);
  },seen),{});
  ok(result,"balanced successful commit");
  assert(seen.length===2&&result.selectedClusterSize===5,"one qualifying cluster must cause exactly one clustering and one consolidation request");
  const after=setup.Game.getWorld().entities.hoodedWoman.mind.beliefs;
  const afterById=new Map(after.map(b=>[b.id,b]));
  assert(!afterById.has("belief_bal_2")&&!afterById.has("belief_bal_5")&&after.length===4,"merge/remove must change only selected cluster membership");
  assert(afterById.get("belief_bal_1").text==="Merged durable interpretation."&&afterById.get("belief_bal_3").text==="Revised durable interpretation.","merge/revise must use validated replacement text");
  for(const id of ["belief_bal_1","belief_bal_3","belief_bal_4"]){assert(afterById.get(id).activation===beforeById.get(id).activation&&afterById.get(id).confidence===beforeById.get(id).confidence,`housekeeping must not alter confidence/activation for ${id}`);assert(Number.isInteger(afterById.get(id).lastConsolidatedAt),`successful reviewed survivor ${id} must receive housekeeping marker`);}
  assert(afterById.get("belief_bal_6").lastConsolidatedAt===undefined,"unselected beliefs must remain untouched");
  const projectedMind=setup.CharacterContext.buildMind("hoodedWoman");
  assert(projectedMind.beliefs.every(function(b){return !Object.prototype.hasOwnProperty.call(b,"lastConsolidatedAt");}),"engine-owned consolidation freshness metadata must not leak into ordinary Character mind context");
  const clusteringRequest=seen.find(function(r){return r.payload.stage==="mind-v3-belief-clustering";});
  assert(clusteringRequest&&clusteringRequest.payload.beliefs.length===6,"clustering preflight must receive the complete current belief catalog");

  // Invalid consolidation after bounded repair must preserve the complete source cluster.
  fixture=resetMaraBeliefs(5); const beforeInvalid=clone(fixture.actor.mind); seen=[]; let badCalls=0;
  result=await setup.MemoryConsolidator.consolidateBeliefsBalanced("hoodedWoman",jsonClient((payload)=>{
    if(payload.stage==="mind-v3-belief-clustering")return{clusters:[{beliefIds:["belief_bal_1","belief_bal_2","belief_bal_3","belief_bal_4","belief_bal_5"]}]};
    if(payload.stage==="mind-v3-belief-balanced-consolidation"){badCalls++;return{results:[{operation:"keep",sourceBeliefIds:["belief_bal_1"],survivorBeliefId:null,replacementText:null}]};}
    throw new Error(`unexpected stage ${payload.stage}`);
  },seen),{});
  assert(!result.ok&&badCalls===2,"invalid balanced result must get one bounded repair then fail");
  assert(JSON.stringify(setup.Game.getWorld().entities.hoodedWoman.mind)===JSON.stringify(beforeInvalid),"failed balanced consolidation must be fully atomic");

  // Timelapse integration: daytime never asks for balanced clustering; overnight does after successful ordinary reconciliation.
  fixture=resetMaraBeliefs(5); seen=[];
  const maintenanceClient=jsonClient((payload)=>{
    if(payload.stage==="mind-v3-reconciliation")return{resolutions:[],activatedBeliefIds:[]};
    if(payload.stage==="mind-v3-belief-clustering")return{clusters:[{beliefIds:["belief_bal_1","belief_bal_2","belief_bal_3"]},{beliefIds:["belief_bal_4","belief_bal_5"]}]};
    if(payload.stage==="mind-v3-stm")return{shortTermMemoriesToUpsert:[],shortTermMemoriesToAdd:[],stmRepartitions:[],beliefEffects:[],beliefsToAdd:[],activatedBeliefIds:[]};
    if(payload.stage==="mind-v3-ltm-preflight")return{relevantLtmIds:[]};
    if(payload.stage==="mind-v3-ltm")return{longTermMemoriesToUpsert:[],longTermMemoriesToAdd:[],retirementGroups:[],higherOrderBeliefEffects:[],beliefsToAdd:[],activatedBeliefIds:[]};
    throw new Error(`unexpected stage ${payload.stage}`);
  },seen);
  result=await setup.MemoryConsolidator.maintainTimelapse("hoodedWoman",maintenanceClient,{mode:"daytime",elapsedMaintenanceUnits:1});
  ok(result,"daytime maintenance");
  assert(!seen.some(r=>r.payload.stage==="mind-v3-belief-clustering"),"daytime maintenance must not run balanced clustering");
  fixture=resetMaraBeliefs(5); seen.length=0;
  result=await setup.MemoryConsolidator.maintainTimelapse("hoodedWoman",maintenanceClient,{mode:"overnight",elapsedMaintenanceUnits:1});
  ok(result,"overnight maintenance");
  assert(seen.some(r=>r.payload.stage==="mind-v3-belief-clustering"),"overnight maintenance must run balanced clustering after successful reconciliation");

  // Prompt hardening: belief induction is durable interpretation; relationships carry standing current facts.
  const stmPrompt=setup.MindConsolidationProtocols.stmSystem();
  const ltmPrompt=setup.MindConsolidationProtocols.ltmSystem();
  assert(stmPrompt.includes("BELIEF INDUCTION IS INTERPRETATION, NOT EVENT STORAGE")&&ltmPrompt.includes("event memory is not belief content"),"STM/LTM induction prompts must reject pure event storage as beliefs");
  const ctx=setup.ContextBuilder.build("hoodedWoman",{pendingObservations:[]});
  const decisionPrompt=setup.AIProtocol.decisionMessages(ctx)[0].content;
  assert(decisionPrompt.includes("standing arrangements")&&decisionPrompt.includes("living together")&&decisionPrompt.includes("durable standing facts materially changes"),"ordinary Character prompt must make relationship summaries self-contained current standing state");
  const reflectionSource=fs.readFileSync(path.join(root,"src/23-timelapse-protocol.js"),"utf8");
  assert(reflectionSource.includes("standing arrangements such as living together or ongoing work")&&reflectionSource.includes("Do not turn it into a chronological event log"),"timelapse relationship reflection must use the same hardened summary semantics");

  // Legacy flat-five intimate runtime state is discarded on migration; valid v2 state is preserved.
  let world=fresh();
  world.authoringRevision="legacy-test-revision";
  world.ai.intimateContexts.hoodedWoman={
    player:{anticipations:["one","two","three","four","five"]},
    nell:{impulse:"Keep the interaction playful.",imaginedMoments:["See Nell laugh.","Share a quiet cup together."],openAnticipations:["Hear her honest reaction.","Notice whether she relaxes."]}
  };
  State.variables.world=world;
  result=setup.SaveMigration.migrate();
  ok(result,"v2 intimate migration");
  const migrated=setup.Game.getWorld().ai.intimateContexts.hoodedWoman||{};
  assert(!migrated.player&&migrated.nell&&migrated.nell.impulse==="Keep the interaction playful.","migration must discard legacy flat-five contexts without semantic conversion and preserve valid v2 contexts");

  console.log("All 0.1.4d cognitive/intimate v2 tests passed.");
})().catch(err=>{console.error(err&&err.stack||err);process.exit(1);});
