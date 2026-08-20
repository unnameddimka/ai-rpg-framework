#!/usr/bin/env node
"use strict";
const fs=require("fs");const path=require("path");
const root=path.resolve(__dirname,"..");
const editorPath=path.join(root,"editor","world-editor.html");
const validatorPath=path.join(root,"tools","world-authored-validator.js");
const begin="<!-- BEGIN GENERATED AUTHORED VALIDATOR -->";const end="<!-- END GENERATED AUTHORED VALIDATOR -->";
let html=fs.readFileSync(editorPath,"utf8");const validator=fs.readFileSync(validatorPath,"utf8").trimEnd();
const start=html.indexOf(begin),finish=html.indexOf(end);if(start<0||finish<start)throw new Error("Editor shared-validator markers are missing.");
const replacement=begin+"\n<script id=\"world-authored-validator\">\n"+validator+"\n</script>\n"+end;
html=html.slice(0,start)+replacement+html.slice(finish+end.length);fs.writeFileSync(editorPath,html);
console.log("Embedded shared authored validator into "+editorPath);
