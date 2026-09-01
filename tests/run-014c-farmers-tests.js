"use strict";
const fs=require("fs"),path=require("path"),vm=require("vm");
const root=path.resolve(__dirname,"..");
global.setup={};global.State={variables:{},passage:"The Tavern"};global.Engine={play:function(){},show:function(){}};
function load(file){vm.runInThisContext(fs.readFileSync(path.join(root,file),"utf8"),{filename:file});}
function assert(v,m){if(!v)throw new Error(m);} function ok(v,m){assert(v&&v.ok,`${m}: ${JSON.stringify(v)}`);}
[
"src/00-model-list.js","src/generated/world-data.js","src/07-mind-v3.js","src/08-mind-validators.js","src/09-action-option-validation.js","src/09-world-state-authority.js","src/09-passage-rules.js","src/09-world-derived-state.js","src/10-game-00-item-mechanics.js","src/10-game-01-validation.js","src/10-game-02-actions.js","src/10-game-api.js","src/10-trade-lifecycle.js","src/10-weekly-rhythm.js","src/10-presence.js","src/10-authored-effects.js","src/10-triggered-events.js","src/11-save-migration.js","src/12-character-context.js","src/13-character-memory.js","src/13-verbatim-memory.js","src/14-event-perception.js"
].forEach(load);
function fresh(){setup.Game.resetWorld();ok(setup.Game.acceptPlayerDisclaimer(),"accept disclaimer");ok(setup.Game.acknowledgeAISetup(),"ack AI setup");ok(setup.Game.finalizePlayerSetup({mode:"generic"}),"finalize player");return setup.Game.getWorld();}
(function(){
 const authored=JSON.parse(fs.readFileSync(path.join(root,"data/world.json"),"utf8"));
 const L=authored.locations,C=authored.characters;
 assert(L.villageEdge.exits.farmYard==="farmYard","farm must be reachable from Village Edge");
 assert(!L.street.exits.farmYard,"farm must not be directly connected from Street");
 assert(L.farmYard.exits.villageEdge==="villageEdge"&&L.farmYard.exits.farmhouseUtility==="farmhouseUtility"&&L.farmYard.exits.farmField==="farmField","farm yard topology must match spec");
 assert(L.farmhouseUtility.exits.farmYard==="farmYard"&&L.farmhouseUtility.exits.farmhouseLiving==="farmhouseLiving"&&L.farmhouseLiving.exits.farmhouseUtility==="farmhouseUtility","farmhouse entrance must reach Utility Room before Living Room");
 assert(L.farmField.exits.chortsRock==="chortsRock"&&L.farmField.exits.farmStreamCrossing==="farmStreamCrossing","field must connect to Chort's Rock and lower stream crossing");
 assert(L.chortsRock.type==="location"&&!L.chortsRock.secretId,"Chort's Rock must be a full non-secret location");
 assert(L.farmStreamCrossing.type==="location"&&L.farmStreamCrossing.sublocations.farmStreamRestingPlace.capacity>=1,"lower stream crossing must be a full location with a place to sit");
 assert(authored.secrets.medallion&&C.blacksmith.initialMind.knownFacts.some(f=>f.id==="medallion_iron_provenance"&&f.secretId==="medallion"),"materializing Chort's Rock must not declassify medallion provenance");
 for(const id of ["radovan","bozhena","zlata"]){assert(C[id]&&C[id].initialControllerId==="ai",`${id} must be a full AI character`);}
 assert(C.zlata.adult===false&&C.zlata.aiDescription.includes("You are a minor"),"Zlata must be explicitly authored as a fifteen-year-old minor");
 assert(C.radovan.aiDescription.includes("slightly overweight")&&C.radovan.aiDescription.includes("harmlessly flirt with Nell"),"Radovan characterization must preserve cheerful family-centered flirting boundary");
 assert(C.bozhena.aiDescription.includes("inclined to scold")&&C.bozhena.aiDescription.includes("not serious jealousy"),"Bozhena characterization must preserve practical scolding without serious jealousy");
 assert(C.zlata.aiDescription.includes("self-conscious")&&C.zlata.aiDescription.includes("overthinking"),"Zlata must combine stubbornness/liveliness with adolescent nervousness");
 assert(!Object.keys(C).some(id=>/^farmChild|youngerChild/i.test(id)),"younger farm children must remain non-agent household background");
 assert(C.radovan.initialMind.knownFacts.some(f=>f.id==="farm_younger_children")&&C.bozhena.initialMind.knownFacts.some(f=>f.id==="farm_younger_children")&&C.zlata.initialMind.knownFacts.some(f=>f.id==="farm_younger_children"),"active household members must know the younger background children exist");
 assert(L.farmhouseLiving.sublocations.farmhouseStoveBed.capabilities.includes("sleep")&&L.farmhouseLiving.sublocations.zlataBench.capabilities.includes("sleep"),"parents' stove platform and Zlata's bench must be grounded sleep places");
 assert(!C.radovan.routineAnchors&&!C.bozhena.routineAnchors&&!C.zlata.routineAnchors,"farmers must not gain a new deterministic profession/night scheduler");
 assert(C.nell.initialMind.relationships.some(r=>r.targetCharacterId==="zlata"&&r.summary.includes("protective"))&&C.nell.initialMind.knownFacts.some(f=>f.id==="farm_family_loss_echo"),"Nell must carry the protective lost-family association toward the farm household");
 assert(C.hoodedWoman.initialMind.knownFacts.some(f=>f.id==="farm_family_distance")&&C.hoodedWoman.initialMind.relationships.some(r=>r.targetCharacterId==="bozhena"&&r.summary.includes("do not press for closeness")),"Mara must understand the family's fear and keep compassionate distance");
 assert(C.innkeeper.initialMind.knownFacts.some(f=>f.id==="farm_suppliers")&&C.blacksmith.initialMind.knownFacts.some(f=>f.id==="farm_customers")&&C.roadMerchant.initialMind.knownFacts.some(f=>f.id==="farm_customers"),"Garrick/Harlan/Maksym economic links to the farm must be authored");
 assert(L.street.sublocations.villageWell&&L.street.sublocations.villageWellBench&&L.street.sublocations.villageWellBench.capacity===3,"Street must contain the public well and a multi-seat bench");
 const wellTable=authored.randomOutcomeTables.villageWellBucketDraw;
 assert(wellTable&&wellTable.noOutcomeWeight===0&&wellTable.outcomes.length===1&&wellTable.outcomes[0].effects.length===1&&wellTable.outcomes[0].effects[0].type==="emit_observation","normal village well must deterministically yield only ordinary water with no created item/random treasure");

 const world=fresh();
 assert(world.entities.chortsRock&&world.entities.farmStreamCrossing&&world.entities.radovan&&world.entities.bozhena&&world.entities.zlata,"fresh runtime world must materialize farm locations and three active farmers");
 world.entities.player.locationId="street"; world.entities.player.sublocationId="villageWell";
 let view=setup.CharacterAPI.getView("player");
 assert(view.available_actions.authored_interaction.options.interaction_ids.includes("raiseVillageWellBucket"),"normal well must expose the grounded Raise bucket interaction");
 const beforeWallet=world.entities.player.wallet;
 const itemCountBefore=Object.keys(world.entities).filter(id=>world.entities[id]&&world.entities[id].type==="item").length;
 ok(setup.CharacterAPI.perform("player",{type:"authored_interaction",interaction_id:"raiseVillageWellBucket"}),"raise normal village well bucket");
 assert(world.entities.player.wallet===beforeWallet&&Object.keys(world.entities).filter(id=>world.entities[id]&&world.entities[id].type==="item").length===itemCountBefore,"normal well must not create gold, wine, bucket, or water items");

 // First authored minor must not be eligible to activate intimate mode as an actor.
 world.entities.zlata.locationId="farmhouseLiving"; world.entities.zlata.sublocationId="farmhouseLivingFloor";
 world.entities.radovan.locationId="farmhouseLiving"; world.entities.radovan.sublocationId="farmhouseLivingFloor";
 const zctx=setup.ContextBuilder.build("zlata",{pendingObservations:[]});
 assert(Array.isArray(zctx.intimateEligiblePartnerIds)&&zctx.intimateEligiblePartnerIds.length===0,"minor Character context must expose no intimate enable targets");
 const minorEnable=setup.AIIntimacy.applyUpdates("zlata",{enablePartnerIds:["radovan"],disablePartnerIds:[],anticipationReplacements:[]},{radovan:{impulse:"a",imaginedMoments:["b","c"],openAnticipations:["d","e"]}});
 assert(!minorEnable.ok&&minorEnable.error.code==="INTIMATE_MINOR_NOT_ALLOWED","engine must defensively reject direct intimate enable for a minor actor");
 const minorTargetEnable=setup.AIIntimacy.applyUpdates("radovan",{enablePartnerIds:["zlata"],disablePartnerIds:[],anticipationReplacements:[]},{zlata:{impulse:"a",imaginedMoments:["b","c"],openAnticipations:["d","e"]}});
 assert(!minorTargetEnable.ok&&minorTargetEnable.error.code==="INTIMATE_MINOR_NOT_ALLOWED","engine must defensively reject intimate enable toward a minor target");

 console.log("All 0.1.4c farmers world tests passed.");
})();
