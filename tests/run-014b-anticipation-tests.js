"use strict";
const fs=require("fs"),path=require("path"),vm=require("vm");
const root=path.resolve(__dirname,"..");
global.setup={};global.State={variables:{},passage:"The Tavern"};global.Engine={play:function(){},show:function(){}};
function load(file){vm.runInThisContext(fs.readFileSync(path.join(root,file),"utf8"),{filename:file});}
function assert(v,m){if(!v)throw new Error(m);} function ok(v,m){assert(v&&v.ok,`${m}: ${JSON.stringify(v)}`);} function clone(v){return JSON.parse(JSON.stringify(v));}
[
"src/00-model-list.js","src/generated/world-data.js","src/07-mind-v3.js","src/08-mind-validators.js","src/09-action-option-validation.js","src/09-world-state-authority.js","src/09-passage-rules.js","src/09-world-derived-state.js","src/10-game-00-item-mechanics.js","src/10-game-01-validation.js","src/10-game-02-actions.js","src/10-game-api.js","src/10-trade-lifecycle.js","src/10-weekly-rhythm.js","src/10-presence.js","src/10-authored-effects.js","src/10-triggered-events.js","src/11-save-migration.js","src/12-character-context.js","src/13-character-memory.js","src/13-verbatim-memory.js","src/14-event-perception.js","src/16-emergency-diagnostics.js","src/17-runtime-diagnostics.js","src/21-ai-settings.js","src/21-ai-request-profiles.js","src/22-openrouter-client.js","src/23-ai-protocol.js","src/23-structured-ai-request.js","src/24-ai-request-executor.js","src/24-mind-semantic-retrieval.js","src/24-ai-turn-scheduler.js","src/20-controllers.js"
].forEach(load);
function fresh(){setup.Game.resetWorld();ok(setup.Game.acceptPlayerDisclaimer(),"accept disclaimer");ok(setup.Game.acknowledgeAISetup(),"ack AI setup");ok(setup.Game.finalizePlayerSetup({mode:"generic"}),"finalize player");return setup.Game.getWorld();}
function emptyMind(){return {beliefIds:[],stmIds:[],ltmIds:[]};}
const oldMotivation={impulse:"old impulse",imaginedMoments:["old imagined one","old imagined two"],openAnticipations:["old open one","old open two"]};
const newMotivation={impulse:"new impulse",imaginedMoments:["new imagined one","new imagined two"],openAnticipations:["new open one","new open two"]};
function baseDecision(replacements){return {action:{type:"move_within_location",destination_id:"commonRoomFloor"},publicNarrative:"She glances toward the hearth before getting up.",spokenText:null,spokenTargetId:null,spokenLoudness:null,continuation:"Stay near the Traveler.",memoryUpdates:{relationshipsToUpsert:[],activatedBeliefIds:[]},intimateUpdates:{enablePartnerIds:[],disablePartnerIds:[],anticipationReplacements:replacements}};}
(async function(){
  let world=fresh();
  const promptContext=setup.ContextBuilder.build("hoodedWoman",{pendingObservations:[]});
  const decisionMessages=setup.AIProtocol.decisionMessages(promptContext);
  const canonical=setup.AIProtocol.ANTICIPATION_REPLACEMENT_SHAPE;
  assert(decisionMessages[0].content.includes(canonical),"decision prompt must expose the exact canonical anticipation replacement shape");
  const repairMessages=setup.AIProtocol.buildRepairMessages(decisionMessages,JSON.stringify(baseDecision({player:newMotivation})),"decision",["response.intimateUpdates.anticipationReplacements must be an array."],promptContext.view.available_actions);
  assert(repairMessages[repairMessages.length-1].content.includes(canonical)&&repairMessages[repairMessages.length-1].content.includes("Do not return a partner-keyed object")&&repairMessages[repairMessages.length-1].content.includes("legacy five-string anticipation shape"),"repair prompt must expose the same exact replacement shape and reject observed malformed forms");

  // A malformed replacement followed by another malformed repair must degrade only intimate maintenance.
  world=fresh();
  ok(setup.AIIntimacy.applyUpdates("hoodedWoman",{enablePartnerIds:["player"],disablePartnerIds:[],anticipationReplacements:[]},{player:oldMotivation}),"seed active intimate context");
  ok(setup.CharacterAPI.perform("player",{type:"move",destination_id:"commonRoom"}),"player enters common room for fallback case");
  ok(setup.CharacterAPI.narrate("player",{text:"Mara, stay with me a moment.",target_id:"hoodedWoman"}),"queue Mara fallback case");
  let calls=[];
  const fallbackClient={chat:async function(messages){
    calls.push(clone(messages));
    if(calls.length===1)return {ok:true,content:JSON.stringify(emptyMind()),usage:null};
    if(calls.length===2)return {ok:true,content:JSON.stringify(baseDecision({player:newMotivation})),usage:null};
    if(calls.length===3)return {ok:true,content:JSON.stringify(baseDecision(newMotivation)),usage:null};
    throw new Error(`unexpected fallback model call ${calls.length}`);
  }};
  const fallbackTurn=await setup.AIController.takeQueuedTurn("hoodedWoman",fallbackClient);
  ok(fallbackTurn,"ordinary turn must survive malformed anticipation replacement after failed repair");
  assert(calls.length===3,"failed anticipation replacement must use exactly one bounded repair attempt");
  assert(setup.Game.getWorld().entities.hoodedWoman.sublocationId==="commonRoomFloor","valid ordinary action must still execute after intimate maintenance fallback");
  assert(JSON.stringify(setup.AIIntimacy.getContextsForCharacter("hoodedWoman").player.impulse)===JSON.stringify(oldMotivation.impulse)&&JSON.stringify(setup.AIIntimacy.getContextsForCharacter("hoodedWoman").player.imaginedMoments)===JSON.stringify(oldMotivation.imaginedMoments)&&JSON.stringify(setup.AIIntimacy.getContextsForCharacter("hoodedWoman").player.openAnticipations)===JSON.stringify(oldMotivation.openAnticipations),"failed replacement must preserve the previous structured motivation unchanged");
  assert(fallbackTurn.intimateMaintenanceFallback&&fallbackTurn.intimateMaintenanceFallback.previousMotivationPreserved===true&&fallbackTurn.intimateMaintenanceFallback.ordinaryDecisionContinued===true&&fallbackTurn.intimateMaintenanceFallback.repairAttempted===true,"turn result must expose non-fatal intimate maintenance fallback diagnostics");
  const diagnostics=setup.EmergencyDiagnostics.getRecentErrors();
  const intimateDiagnostic=diagnostics.find(function(entry){return entry.kind==="intimate-maintenance-fallback";});
  assert(intimateDiagnostic&&intimateDiagnostic.details&&intimateDiagnostic.details.actorId==="hoodedWoman"&&intimateDiagnostic.details.previousMotivationPreserved===true,"emergency diagnostics must record actor and preservation/continuation details");

  // If bounded repair produces the canonical shape, commit the new motivation block normally.
  world=fresh();
  ok(setup.AIIntimacy.applyUpdates("hoodedWoman",{enablePartnerIds:["player"],disablePartnerIds:[],anticipationReplacements:[]},{player:oldMotivation}),"seed active context for repaired replacement");
  ok(setup.CharacterAPI.perform("player",{type:"move",destination_id:"commonRoom"}),"player enters common room for repaired case");
  ok(setup.CharacterAPI.narrate("player",{text:"Mara, stay with me a moment.",target_id:"hoodedWoman"}),"queue Mara repaired case");
  calls=[];
  const repairedClient={chat:async function(messages){
    calls.push(clone(messages));
    if(calls.length===1)return {ok:true,content:JSON.stringify(emptyMind()),usage:null};
    if(calls.length===2)return {ok:true,content:JSON.stringify(baseDecision({player:newMotivation})),usage:null};
    if(calls.length===3)return {ok:true,content:JSON.stringify(baseDecision([{partnerId:"player",motivation:newMotivation}])),usage:null};
    throw new Error(`unexpected repaired model call ${calls.length}`);
  }};
  const repairedTurn=await setup.AIController.takeQueuedTurn("hoodedWoman",repairedClient);
  ok(repairedTurn,"valid repaired anticipation replacement turn");
  assert(!repairedTurn.intimateMaintenanceFallback,"successful repair must not use the fallback path");
  assert(setup.Game.getWorld().entities.hoodedWoman.sublocationId==="commonRoomFloor","ordinary action must execute with a valid repaired replacement");
  assert(JSON.stringify(setup.AIIntimacy.getContextsForCharacter("hoodedWoman").player.impulse)===JSON.stringify(newMotivation.impulse)&&JSON.stringify(setup.AIIntimacy.getContextsForCharacter("hoodedWoman").player.imaginedMoments)===JSON.stringify(newMotivation.imaginedMoments)&&JSON.stringify(setup.AIIntimacy.getContextsForCharacter("hoodedWoman").player.openAnticipations)===JSON.stringify(newMotivation.openAnticipations),"valid repaired replacement must atomically replace the full structured motivation block");

  // Transition semantics remain strict and are intentionally outside this hotfix.
  const activeContext=setup.ContextBuilder.build("hoodedWoman",{pendingObservations:[]});
  const transitionDecision=baseDecision(newMotivation);
  transitionDecision.intimateUpdates.enablePartnerIds=["nell"];
  const transitionValidation=setup.AIProtocol.validateDecision(transitionDecision,activeContext.view.available_actions,[],[],[],setup.AIProtocol.intimateValidationContextFromMessages(setup.AIProtocol.decisionMessages(activeContext)));
  assert(!transitionValidation.ok,"malformed intimate motivation data combined with an intimate transition must remain strict rather than being silently normalized");

  console.log("All 0.1.4b anticipation hardening tests passed.");
})().catch(err=>{console.error(err&&err.stack||err);process.exit(1);});
