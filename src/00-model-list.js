(function () {
    "use strict";
    setup.GeneratedModelList = {
    "schemaVersion": 2,
    "defaultModelId": "deepseek/deepseek-v4-flash",
    "defaultNarratorModelId": "sao10k/l3.3-euryale-70b:nitro",
    "defaultUtilityModelId": "deepseek/deepseek-v4-flash",
    "defaultFallbackModelIds": {
        "character": [],
        "utility": [],
        "narrator": [
            "sao10k/l3.1-euryale-70b"
        ]
    },
    "models": [
        {
            "id": "deepseek/deepseek-v4-pro",
            "name": "DeepSeek V4 Pro",
            "roles": [
                "character"
            ]
        },
        {
            "id": "deepseek/deepseek-v4-flash",
            "name": "DeepSeek V4 Flash",
            "roles": [
                "character",
                "utility"
            ]
        },
        {
            "id": "sao10k/l3.3-euryale-70b:nitro",
            "name": "Llama 3.3 Euryale 70B (Nitro)",
            "roles": [
                "narrator"
            ]
        },
        {
            "id": "sao10k/l3.1-euryale-70b",
            "name": "Llama 3.1 Euryale 70B",
            "roles": [
                "narrator"
            ]
        }
    ]
};
}());
