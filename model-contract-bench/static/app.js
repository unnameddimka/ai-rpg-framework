let cases=[], candidates=[], candidateDoc={}, kind='benchmark';
const pct=v=>v==null?'—':`${v.toFixed(1)}%`;
const money=v=>v==null?'—':`$${Number(v).toFixed(Number(v)<0.1?3:2)}`;
const context=v=>v>=1000000?`${(v/1048576).toFixed(0)}M`:`${Math.round(v/1024)}K`;
async function load(){
  [cases,candidateDoc]=await Promise.all([fetch('/api/cases').then(r=>r.json()),fetch('/api/candidates').then(r=>r.json())]);
  candidates=candidateDoc.models||[]; renderCandidates(); renderCases(); await loadSummary()
}
async function loadSummary(){const rows=await fetch(`/api/summary?kind=${kind}`).then(r=>r.json());const tb=document.querySelector('#models tbody');tb.innerHTML='';for(const m of rows){const role=n=>m.roles[n]?pct(m.roles[n].clean_rate):'—';const tr=document.createElement('tr');tr.innerHTML=`<td>${esc(m.model_id)}</td><td>${pct(m.sort_score)}</td><td>${role('utility')}</td><td>${role('character')}</td><td>${role('narrator')}</td><td>${m.clean}/${m.total} (${pct(m.clean_rate)})</td><td>${m.repaired}</td><td>${m.avg_duration_ms==null?'—':(m.avg_duration_ms/1000).toFixed(1)+'s'}</td><td>$${m.cost.toFixed(4)}</td><td>${Object.entries(m.fails).map(([k,v])=>`<span class="pill">${esc(k)} ${v}</span>`).join('')||'—'}</td>`;tb.appendChild(tr)}}
function renderCandidates(){
  const dl=document.querySelector('#candidateModels'); dl.innerHTML='';
  const tb=document.querySelector('#candidates tbody'); tb.innerHTML='';
  for(const m of candidates){
    const opt=document.createElement('option'); opt.value=m.model_id; opt.label=`${m.name} · ${m.focus} · ${money(m.input_per_m)}/${money(m.output_per_m)}`; dl.appendChild(opt);
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${m.priority}</td><td><strong>${esc(m.name)}</strong><br><span class="muted">${esc(m.model_id)}</span>${m.version_pinned?' <span class="pill">pinned</span>':''}</td><td>${esc(m.focus)}</td><td>${money(m.input_per_m)}</td><td>${money(m.output_per_m)}</td><td>${context(m.context_tokens)}</td><td>${esc(m.why)}</td><td><button class="use-model" data-model="${esc(m.model_id)}">Use</button></td>`;
    tb.appendChild(tr)
  }
  document.querySelectorAll('.use-model').forEach(b=>b.onclick=()=>{document.querySelector('#model').value=b.dataset.model;document.querySelector('#model').focus();window.scrollTo({top:0,behavior:'smooth'})})
}
function renderCases(){const tb=document.querySelector('#cases tbody');tb.innerHTML='';const counts={};for(const c of cases){counts[c.role]=(counts[c.role]||0)+1;const tr=document.createElement('tr');tr.innerHTML=`<td>${esc(c.id)} <span class="muted">#${c.exchange_id}</span></td><td>${esc(c.role)}</td><td>${esc(c.stage)}</td><td>${esc(c.size_bucket)}</td><td>${c.original_prompt_tokens??'—'}</td><td>${esc(c.original_model||'—')}</td>`;tb.appendChild(tr)}document.querySelector('#corpusStats').innerHTML=`${cases.length} cases · ${Object.entries(counts).map(([k,v])=>`<span class="pill">${k} ${v}</span>`).join('')}`}
async function run(){const model=document.querySelector('#model').value.trim(),apiKey=document.querySelector('#key').value.trim(),reps=Math.max(1,Math.min(10,+document.querySelector('#reps').value||1)),force=document.querySelector('#force').checked,roles=[...document.querySelectorAll('.roles input[type=checkbox][value]:checked')].map(x=>x.value);if(!model||!apiKey||!roles.length){alert('Model, API key and at least one role are required.');return}const selected=cases.filter(c=>roles.includes(c.role));const total=selected.length*reps;if(!confirm(`Run ${total} case invocation(s) for ${model}? Cached results are reused unless “Rerun cached” is checked.`))return;let n=0;const p=document.querySelector('#progress'),btn=document.querySelector('#run');btn.disabled=true;try{for(const c of selected){for(let rep=1;rep<=reps;rep++){p.textContent=`${n}/${total} · ${c.role} · ${c.stage}`;const r=await fetch('/api/run-one',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({caseId:c.id,modelId:model,apiKey,repetition:rep,force})});const body=await r.json();if(!r.ok)console.error(body);n++;await loadSummary()}}}finally{btn.disabled=false;p.textContent=`Done: ${n}/${total}`}}
function esc(x){return String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
document.querySelector('#run').onclick=run;document.querySelector('#refresh').onclick=load;document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');kind=b.dataset.kind;loadSummary()});load();
