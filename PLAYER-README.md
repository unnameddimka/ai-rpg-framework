# Mallowstead

Mallowstead is a free, open-source AI-driven role-playing game created by **Dmytro Turovskiy** and released under the MIT License.

## Run the game

1. Extract the release ZIP.
2. Open `mallowstead.html` in a modern browser.
3. Follow the startup screens to choose your Traveler and configure AI.

There is no installer and no Mallowstead game server.

## OpenRouter and AI models

AI interactions require your own OpenRouter API key. You can enter it during startup or later in **Settings**. The game does not contain a shared API key. If you choose **Remember for 7 days**, the key is retained locally in your browser for up to seven days.

OpenRouter requests may consume paid credits. Cost depends on the models you select and how much you play; timelapse and memory maintenance can make multiple AI requests.

The defaults are:

- **Character:** DeepSeek V4 Flash
- **Utility / maintenance:** DeepSeek V4 Flash
- **Narrator:** a separate optional model role used for presentation and bounded rendering tasks

Models can be changed in Settings.

## Passing time

- **To skip the night:** sleep in any bed and continue sleeping until morning.
- **To skip the day:** in the morning, ask **Mara the Hedge Witch** or **Harlan the Blacksmith** for work and accept a day job, or go hunting squirrels. Whether Mara or Harlan offers work still depends on the situation and their AI-controlled decision.

## Saves, exports, and bug reports

Game state and character memory are stored locally in the browser and can be exported in saves and diagnostics. Exported files may contain conversations, character memories, generated content, and other game state, so review them before sharing them publicly.

API keys and authorization headers are excluded from diagnostic exports. If something breaks, **Settings → Emergency dump** creates a diagnostic ZIP that is useful for a bug report.

Compatible saves from the earlier AI RPG Framework MVP/POC builds can be imported into Mallowstead.

## Network and privacy

Mallowstead currently has no game server and no telemetry service.

- AI requests are sent through OpenRouter and may be processed by the selected third-party model provider.
- Weather uses `ipwho.is` for approximate IP-based location and Open-Meteo for current weather at those approximate coordinates.
- Save data and character memory are not sent to the weather services.

If you share sensitive real-life information with AI characters, relevant conversation or memory context may be included in requests to third-party AI services.
