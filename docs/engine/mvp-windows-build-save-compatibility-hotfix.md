# AI RPG — MVP Windows Build Save Compatibility Hotfix

## Status

Hotfix for the MVP backward-compatible SugarCube save identity change.

## Problem

The MVP build accepts legacy `ai-rpg-framework-poc` saves by postprocessing SugarCube's generated `unmarshal` ID guard after compilation.

`build.sh` invoked `tools/postprocess-product-title.js`, but `build.bat` did not. On Windows, rebuilding with Tweego therefore regenerated a clean SugarCube runtime and silently removed the legacy POC load alias. Valid POC `.save` files then failed with `Save is from the wrong game.`

## Fix

After Tweego compilation, `build.bat` must run:

```text
node tools\postprocess-product-title.js
```

and fail the build if that postprocess fails.

The Windows and POSIX build paths must preserve the same final product/save compatibility semantics:

- current story/save identity: `ai-rpg-framework-mvp`;
- accepted legacy load alias: `ai-rpg-framework-poc`;
- new saves remain MVP saves.

## Regression

Generator/build tests assert that `build.bat` invokes the compatibility postprocess. The compiled `dist/game.html` continues to contain the legacy load alias.
