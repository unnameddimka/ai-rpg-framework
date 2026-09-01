"use strict";
const fs=require("fs"),path=require("path"),vm=require("vm");
const root=path.resolve(__dirname,"..");
global.setup={};global.State={variables:{},passage:"The Tavern"};global.Engine={play:function(){},show:function(){}};
function load(file){vm.runInThisContext(fs.readFileSync(path.join(root,file),"utf8"),{filename:file});}
function assert(v,m){if(!v)throw new Error(m);} function ok(v,m){assert(v&&v.ok,`${m}: ${JSON.stringify(v)}`);} function clone(v){return JSON.parse(JSON.stringify(v));}
[
"src/00-model-list.js","src/generated/world-data.js","src/07-mind-v3.js","src/08-mind-validators.js","src/09-action-option-validation.js","src/09-world-state-authority.js","src/09-passage-rules.js","src/09-world-derived-state.js","src/10-game-00-item-mechanics.js","src/10-game-01-validation.js","src/10-game-02-actions.js","src/10-game-api.js","src/10-trade-lifecycle.js","src/10-weekly-rhythm.js","src/10-presence.js","src/10-authored-effects.js","src/10-triggered-events.js","src/11-save-migration.js","src/12-character-context.js","src/13-character-memory.js","src/13-verbatim-memory.js","src/14-event-perception.js","src/17-runtime-diagnostics.js","src/21-ai-settings.js","src/21-ai-request-profiles.js","src/22-openrouter-client.js","src/23-ai-protocol.js","src/23-structured-ai-request.js","src/24-ai-request-executor.js","src/24-mind-semantic-retrieval.js","src/24-ai-turn-scheduler.js","src/20-controllers.js"
].forEach(load);
function fresh(){setup.Game.resetWorld();ok(setup.Game.acceptPlayerDisclaimer(),"accept disclaimer");ok(setup.Game.acknowledgeAISetup(),"ack AI setup");ok(setup.Game.finalizePlayerSetup({mode:"generic"}),"finalize player");return setup.Game.getWorld();}
function emptyMind(){return {beliefIds:[],stmIds:[],ltmIds:[]};}
(async function(){
 let world=fresh();
 const authored=JSON.parse(fs.readFileSync(path.join(root,"data/world.json"),"utf8"));
 assert(authored.secrets.medallion&&authored.secrets.medallion.enabled===true,"medallion secret should be authored and enabled");
 assert(authored.locations.chortsRock&&!authored.locations.chortsRock.secretId,"Chort's Rock may be materialized by later world content but must remain ordinary non-secret geography");
 assert(authored.locations.villageSmithy.sublocations.smithyMedallionDisplay.secretId==="medallion","display frame must belong to medallion secret");
 assert(authored.locations.villageSmithy.sublocations.smithyMedallionDisplay.transparent===true,"display frame must be transparent");
 assert(authored.items.medallionDisplayKey.inventoryId==="inventory_blacksmith"&&authored.items.medallionDisplayKey.secretId==="medallion","frame key must start in Harlan's direct inventory and belong to the secret");
 for(const id of ["hoodedWoman","innkeeper","nell","blacksmith"]){assert(authored.characters[id].initialMind.knownFacts.some(f=>f.id==="chorts_rock_common"&&!f.secretId),`${id} must have common Chort's Rock knowledge`);}
 assert(authored.characters.blacksmith.initialMind.knownFacts.some(f=>f.id==="medallion_worthy"&&f.secretId==="medallion"),"Harlan must have secret medallion motivation");

 ok(setup.CharacterAPI.perform("player",{type:"move",destination_id:"street"}),"move to street");
 ok(setup.CharacterAPI.perform("player",{type:"move",destination_id:"villageSmithy"}),"move to smithy");
 let view=setup.CharacterAPI.getView("player");
 let glass=view.visible_inaccessible_inventories.find(x=>x.id==="inventory_smithyMedallionDisplay");
 assert(glass&&glass.items.some(i=>i.id==="harlanIronMedallion"),"medallion must be visible behind glass from forge floor");
 assert(!view.accessible_inventories.some(x=>x.id==="inventory_smithyMedallionDisplay"),"glass display must not be physically accessible from forge floor without key");
 assert(!(view.available_actions.take_item&&view.available_actions.take_item.options.item_ids||[]).includes("harlanIronMedallion"),"visible medallion must not become takeable");
 ok(setup.CharacterAPI.perform("blacksmith",{type:"give_item",item_id:"medallionDisplayKey",target_id:"player"}),"Harlan gives frame key for access test");
 ok(setup.CharacterAPI.perform("player",{type:"move_within_location",destination_id:"smithyMedallionDisplay"}),"step to display");
 view=setup.CharacterAPI.getView("player");
 assert(view.accessible_inventories.some(x=>x.id==="inventory_smithyMedallionDisplay"&&x.items.some(i=>i.id==="harlanIronMedallion")),"exact key plus physical position must grant ordinary access");
 assert((view.available_actions.take_item&&view.available_actions.take_item.options.item_ids||[]).includes("harlanIronMedallion"),"medallion should become takeable only with ordinary key access");

 world=fresh();
 assert(world.entities.nell.routineAnchors.evening.locationId==="commonRoom"&&world.entities.nell.routineAnchors.evening.sublocationId==="commonRoomFloor","Nell evening routine anchor must remain canonical");
 assert(!world.entities.nell.routineAnchors.morning,"Nell must not receive a morning anchor");
 assert(world.entities.nell.aiDescription.includes("Morning is generally your own")&&world.entities.innkeeper.aiDescription.includes("does not receive ordinary wages"),"Nell/Garrick authoring must encode morning freedom and unequal compensation");

 // Directional/private state primitives.
 const a1={impulse:"Choose the next turn herself.",imaginedMoments:["See the Traveler relax beside her.","Share a quiet moment by the hearth."],openAnticipations:["Hear something sincere.","Notice whether trust feels easier."]};
 const a2={impulse:"Tease Nell into laughing.",imaginedMoments:["See Nell grin without self-consciousness.","Share a comfortable silence together."],openAnticipations:["Hear Nell speak honestly.","Feel whether Nell is comfortable."]};
 ok(setup.AIIntimacy.applyUpdates("hoodedWoman",{enablePartnerIds:["player"],disablePartnerIds:[],anticipationReplacements:[]},{player:a1}),"seed Mara->Traveler");
 ok(setup.AIIntimacy.applyUpdates("hoodedWoman",{enablePartnerIds:["nell"],disablePartnerIds:[],anticipationReplacements:[]},{nell:a2}),"seed Mara->Nell");
 ok(setup.AIIntimacy.applyUpdates("player",{enablePartnerIds:["hoodedWoman"],disablePartnerIds:[],anticipationReplacements:[]},{hoodedWoman:a2}),"seed Traveler->Mara");
 assert(Object.keys(setup.AIIntimacy.getContextsForCharacter("hoodedWoman")).length===2,"one character may have multiple partner contexts");
 assert(Object.keys(setup.AIIntimacy.getContextsForCharacter("hoodedWoman").player).includes("impulse")&&setup.AIIntimacy.getContextsForCharacter("hoodedWoman").player.imaginedMoments.length===2&&setup.AIIntimacy.getContextsForCharacter("hoodedWoman").player.openAnticipations.length===2,"each directed relation must expose exactly one impulse plus two imagined moments and two open anticipations");
 assert(Object.keys(setup.AIIntimacy.getContextsForCharacter("player")).length===1,"reverse direction must remain separate");
 let ctx=setup.ContextBuilder.build("hoodedWoman",{pendingObservations:[]});
 assert(ctx.intimateContexts.player&&ctx.intimateContexts.nell&&!ctx.intimateContexts.hoodedWoman,"Character context must expose only the actor's own directed intimate contexts");
 let retrievalRuntime=setup.CharacterContext.buildRetrievalRuntime("hoodedWoman",{pendingObservations:[]});
 assert(retrievalRuntime.intimateContexts.player&&retrievalRuntime.intimateContexts.nell,"semantic retrieval runtime must receive active intimate motivation");
 ok(setup.AIIntimacy.clearAll(world),"clear intimate state");
 assert(Object.keys(world.ai.intimateContexts).length===0,"clearAll must remove every intimate context");
 assert(fs.readFileSync(path.join(root,"src/24-timelapse-core.js"),"utf8").includes("setup.AIIntimacy.clearAll"),"shared timelapse core must clear intimate state before coarse simulation");

 // Full enable lifecycle: ordinary retrieval + decision, then dedicated retrieval + Character motivation generation.
 world=fresh();
 ok(setup.Game.assignNonHumanController("blacksmith","dummy"),"disable Harlan AI");
 ok(setup.Game.assignNonHumanController("nell","dummy"),"disable Nell AI");
 ok(setup.Game.assignNonHumanController("roadMerchant","dummy"),"disable Maksym AI");
 ok(setup.CharacterAPI.perform("player",{type:"move",destination_id:"commonRoom"}),"player enters common room");
 ok(setup.CharacterAPI.narrate("player",{text:"Mara, I want to be close to you.",target_id:"hoodedWoman"}),"queue Mara intimate scene");
 const calls=[];
 const client={chat:async function(messages){
   calls.push(clone(messages));
   const n=calls.length;
   if(n===1||n===3)return {ok:true,content:JSON.stringify(emptyMind()),usage:null};
   if(n===2)return {ok:true,content:JSON.stringify({action:null,publicNarrative:"She studies the Traveler's face for a long moment.",spokenText:"Then stay close.",spokenTargetId:"player",spokenLoudness:"hidden",continuation:null,memoryUpdates:{relationshipsToUpsert:[],activatedBeliefIds:[]},intimateUpdates:{enablePartnerIds:["player"],disablePartnerIds:[],anticipationReplacements:[]}}),usage:null};
   if(n===4)return {ok:true,content:JSON.stringify(a1),usage:null};
   throw new Error(`unexpected model call ${n}`);
 }};
 const turn=await setup.AIController.takeQueuedTurn("hoodedWoman",client);
 ok(turn,"intimate enable AI turn");
 assert(calls.length===4,"new intimate enable must add exactly one retrieval preflight and one Character intimate-motivation request after the normal decision pipeline");
 assert(JSON.stringify(setup.AIIntimacy.getContextsForCharacter("hoodedWoman").player)===JSON.stringify(Object.assign({partnerId:"player",partnerName:setup.Game.getWorld().entities.player.name},a1)),"generated structured motivation must commit atomically to the directed context");
 const dedicatedPayload=JSON.parse(calls[3].find(m=>m.role==="user").content);
 assert(dedicatedPayload.context.mind&&dedicatedPayload.context.intimateGeneration.partner.id==="player","dedicated generation must receive selected full character context and focused partner");

 console.log("All 0.1.4a medallion/intimacy tests passed.");
})().catch(err=>{console.error(err&&err.stack||err);process.exit(1);});
