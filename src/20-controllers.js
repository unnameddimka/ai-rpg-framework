(function () {
    "use strict";

    function log(controllerId, actorId, message) {
        setup.Game.logController({
            controllerId: controllerId,
            actorId: actorId,
            message: message
        });
    }

    setup.Controllers = {
        human: {
            id: "human",

            takeTurn: function (actorId) {
                log("human", actorId, "Waiting for browser input.");
                return {
                    ok: true,
                    waitingForHumanInput: true,
                    actions: []
                };
            },

            onEvent: function (actorId, event) {
                log("human", actorId, `Observed event ${event.id}: ${event.type}.`);
                return { processed: true, actions: [] };
            }
        },

        dummy: {
            id: "dummy",

            takeTurn: function (actorId) {
                log("dummy", actorId, "DummyController took no action.");
                return { ok: true, actions: [] };
            },

            onEvent: function (actorId, event) {
                log("dummy", actorId, `Ignored event ${event.id}: ${event.type}.`);
                return { processed: true, actions: [] };
            }
        },

        ai: {
            id: "ai",
            implemented: false,

            takeTurn: function (actorId) {
                log("ai", actorId, "AIController is not implemented yet.");
                return {
                    ok: false,
                    error: {
                        code: "AI_CONTROLLER_NOT_IMPLEMENTED",
                        message: "AIController is reserved for a later phase."
                    },
                    actions: []
                };
            },

            onEvent: function (actorId, event) {
                log("ai", actorId, `Queued event ${event.id}; AI is not implemented.`);
                return { processed: false, actions: [] };
            }
        }
    };
}());
