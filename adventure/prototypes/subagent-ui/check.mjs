import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { visibleWidth } from '@earendil-works/pi-tui';
import { prepare } from './prepare.mjs';
import { fixture, KINDS } from './fixtures.mjs';
import { resultTheme } from './styles.mjs';
import { stripVTControlCharacters } from 'node:util';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
await mkdir(join(repo,'.tmp'),{recursive:true});
const root=await mkdtemp(join(repo,'.tmp/ui-check-'));
const theme={fg:(_tone,text)=>text,bold:text=>text};
try {
 await prepare(repo,root);
 const before=await import(pathToFileURL(join(root,'before/renderers.js')));
 const after=await import(pathToFileURL(join(root,'after/renderers.js')));
 const render=(renderer,kind,outcome,expanded,width,style="after")=>{
  const {args,result}=fixture(kind,outcome,true);
  const state={};
  const context={state,lastComponent:undefined,isPartial:outcome==='hold',isError:outcome==='error'};
  const call=renderer.renderSubagentCall(kind,args,theme,context);
  const body=renderer.renderSubagentResult(kind,args,result,{expanded,isPartial:outcome==='hold'},resultTheme(style,theme),context);
  return [...call.render(width),...body.render(width)];
 };
 let count=0;
 for(const style of ["after","neutral","soft","quiet"]) for(const kind of KINDS) for(const outcome of ['success','error','hold',...(kind==='wait'?['timeout','interrupted']:[])]) for(const expanded of [false,true]) {
  const original=render(before,kind,outcome,expanded,400);
  const candidate=render(after,kind,outcome,expanded,400,style);
  const content=lines=>lines.map(line=>stripVTControlCharacters(line).replace(/^[•⏺] /,'').replace(/^  [│└] |^    /,'')).join('\n');
  assert.equal(content(candidate),content(original),`${kind}/${outcome}: preserve information`);
  for(const width of [0,1,2,12,40,80,120]) for(const line of render(after,kind,outcome,expanded,width,style)) assert.ok(visibleWidth(line)<=width,`${kind}/${outcome}: width ${width}`);
  count++;
 }
 console.log(JSON.stringify({passed:true,scenarios:count,widths:[0,1,2,12,40,80,120],informationPreserved:true}));
} finally { await rm(root,{recursive:true,force:true}); }
