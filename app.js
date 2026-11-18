'use strict';
const apiBase = location.hostname.endsWith('.github.io') ? 'http://127.0.0.1:8765' : '';
const $ = id => document.getElementById(id);
let shared, entryType = '', draft = {}, chemicals = [], settingsDraft = {}, previewTimer, previewSequence = 0, nameAction, printing = false;
const labels = {antigen:'Antigen', host:'Host', conjugate:'Conjugate', cat:'Catalogue number', name:'Name', product:'Product', dilution:'Dilution', volume:'Volume (mL)', ph:'pH', hazard:'Hazard / pictograms', title:'Title', body:'Label text', cells:'Cells'};
const icons = {'Antibodies':'◈','Buffer/Solution':'◉','Fresh Buffers':'◇','Staining Solutions':'◌','Antibiotics':'✧','Plasmids':'⌘','Label':'▤'};

function el(tag, text, className) { const n=document.createElement(tag); if(text!==undefined)n.textContent=text; if(className)n.className=className; return n; }
function message(text, error=false) { $('notice').textContent=text; $('notice').classList.toggle('error',error); $('notice').hidden=false; }
function fail(error) { message(error.message || String(error),true); }
async function api(path, data) {
  const response=await fetch(apiBase + path, data===undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json','X-Lab-Token':shared.csrf_token},body:JSON.stringify(data)});
  if(!response.ok) { let msg;try{msg=(await response.json()).error;}catch{} throw new Error(msg || `Request failed (${response.status}).`); }
  return response;
}
function setOptions(select, options, selected) { select.replaceChildren(); for(const [value,label] of options){const o=el('option',label);o.value=value;select.append(o);} if(options.some(o=>o[0]===selected))select.value=selected; }
function listValues(id, values) { const list=$(id); list.replaceChildren(); for(const value of values){const o=el('option');o.value=value;list.append(o);} }
function optionsForLayout() { if(entryType==='Antibodies')return $('format').value==='75x50'?['4x2','4x4']:['1','2'];return ['Buffer/Solution','Fresh Buffers','Staining Solutions','Antibiotics','Plasmids'].includes(entryType)?['Full size','4x2']:['Full size']; }
function layoutLabel(value) { if(value==='4x2')return '4 rows × 2 columns';if(value==='4x4')return '4 rows × 4 columns';if(value==='1')return '1 label';if(value==='2')return '2 labels side by side';return value; }
function currentSettings() { const key=$('format').value; if(!settingsDraft[key]) { const f=shared.config.formats[key];settingsDraft[key]={x:f.x_offset_dots||0,y:f.y_offset_dots||0,media:f.media_mode||'thermal-transfer',layouts:{}}; }return settingsDraft[key]; }
function payload() {
  const data={...draft, type:entryType, format:$('format').value,label_layout:$('layout').value,print_quantity:$('copies').value,user:entryType==='Label'?'':$('user').value,chem_list:chemicals.filter(c=>Object.values(c).some(v=>v.trim()))};
  const s=currentSettings();return {entry_type:entryType,data,printer:$('printer').value,offsets:{x:s.x,y:s.y},media_mode:s.media,layouts:s.layouts,revision:shared.revision};
}
function updateShared(value) {
  shared=value;
  $('manage-config').disabled=false;
  $('host').textContent=value.host; $('host-note').textContent=`Jobs are sent to the printer on ${value.host}. Keep the host app running.`;
  const previous=$('printer').value;
  setOptions($('printer'),value.printers.length?value.printers.map(p=>[p,p]):[['','No printers found on host PC']],previous||value.config.settings.default_printer);
  $('printer-help').textContent=value.printer_error||`${value.printers.length} printer${value.printers.length===1?'':'s'} on ${value.host}`;
  listValues('users',value.config.users||[]);
  renderNavigation();updatePrintButtons();
  if(value.printer_error)message(value.printer_error,true);
}
function renderNavigation() {
  $('types').replaceChildren();
  for(const [name,config] of Object.entries(shared.config.entry_types)){
    const b=el('button',undefined,'nav-item');b.classList.toggle('active',name===entryType);b.setAttribute('aria-current',name===entryType?'page':'false');
    b.append(el('span',icons[name]||'◇'),el('span',name),el('span',String(Object.keys(config.presets||{}).length),'nav-count'));
    b.onclick=()=>selectType(name);$('types').append(b);
  }
}
function refreshPresets(selected='') {setOptions($('preset'),[['','＋ New label'],...Object.keys(shared.config.entry_types[entryType].presets||{}).map(p=>[p,p])],selected);$('preset').disabled=entryType==='Label';$('rename-preset').disabled=!selected||entryType==='Label';$('save-preset').disabled=entryType==='Label';}
function selectType(name) {
  entryType=name;draft={};chemicals=[];renderNavigation();$('editor-heading').textContent=name;refreshPresets();
  const config=shared.config.entry_types[name],formats=config.allowed_formats||Object.keys(shared.config.formats);
  setOptions($('format'),formats.map(f=>[f,shared.config.formats[f].name]),config.default_format);
  $('copies').value=1;$('user-field').hidden=name==='Label';
  if(!$('user').value)$('user').value=shared.config.settings.default_user||'';
  setLayout();renderFields();updateSettingsUI();schedulePreview();
}
function setLayout(value) { const layouts=optionsForLayout();setOptions($('layout'),layouts.map(l=>[l,layoutLabel(l)]),value||layouts[0]); }
function loadPreset() {
  const preset=shared.config.entry_types[entryType].presets[$('preset').value];
  draft=preset?structuredClone(preset):{};chemicals=structuredClone(draft.chem_list||[]);
  if(preset?.format)$('format').value=preset.format;
  setLayout(preset?.label_layout);$('copies').value=preset?.print_quantity||1;
  // The current preparer is a session choice, separate from the saved label.
  renderFields();updateSettingsUI();$('rename-preset').disabled=!preset;schedulePreview();
}
function visibleFields() {
  if(entryType==='Antibodies')return ['antigen','host','conjugate','cat'];
  if(entryType==='Plasmids')return ['name','cat','cells'];
  if(entryType==='Label')return ['title','body','hazard'];
  if(['Staining Solutions','Antibiotics'].includes(entryType))return ['name','product','dilution','hazard'];
  if(entryType==='Fresh Buffers')return ['name','volume','ph','hazard'];
  return ['name','ph','cat','hazard'];
}
function renderFields() {
  const container=$('fields');container.replaceChildren();
  for(const key of visibleFields()){
    const field=el('label',labels[key]||key,'field');if(['antigen','name','title','body','hazard','cells'].includes(key))field.classList.add('wide');
    const input=el(key==='body'?'textarea':'input');input.value=draft[key]||'';input.id='field-'+key;input.placeholder=key==='hazard'?'None, GHS02, GHS07…':`Enter ${(labels[key]||key).toLowerCase()}`;
    if(['host','conjugate'].includes(key)){const id='list-'+key;input.setAttribute('list',id);const datalist=el('datalist');datalist.id=id;for(const v of shared.config[key==='host'?'hosts':'conjugates']||[]){const o=el('option');o.value=v;datalist.append(o);}field.append(datalist);}
    input.addEventListener('input',()=>{draft[key]=input.value;schedulePreview();});field.append(input);container.append(field);
  }
  const composition=!['Antibodies','Plasmids','Label'].includes(entryType);$('composition-section').hidden=!composition;renderChemicals();
  $('hazards').replaceChildren();$('hazards').hidden=!visibleFields().includes('hazard');
  if(!$('hazards').hidden)for(const code of Object.keys(shared.config.pictogram_assets||{})){
    const b=el('button','＋ '+code,'hazard-chip');b.title='Add '+code+' pictogram';b.onclick=()=>{let values=String(draft.hazard||'').split(',').map(v=>v.trim()).filter(v=>v&&v.toLowerCase()!=='none');if(!values.includes(code))values.push(code);draft.hazard=values.join(', ');$('field-hazard').value=draft.hazard;schedulePreview();};$('hazards').append(b);
  }
}
function renderChemicals() {
  $('composition').replaceChildren();
  chemicals.forEach((chemical,index)=>{
    const row=el('div',undefined,'chemical-row');
    for(const key of ['concentration','name']){const input=el('input',undefined,key==='name'?'chemical-name':'');input.placeholder=key==='name'?'Component':'Concentration';input.setAttribute('aria-label',`${input.placeholder}, row ${index+1}`);input.value=chemical[key]||'';input.oninput=()=>{chemical[key]=input.value;schedulePreview();};row.append(input);}
    const extras=el('div',undefined,'chem-extra');for(const [key,title] of [['amount','Amount'],['mw','MW g/mol'],['cas','CAS']]){const input=el('input');input.placeholder=title;input.setAttribute('aria-label',`${title}, row ${index+1}`);input.value=chemical[key]||'';input.oninput=()=>{chemical[key]=input.value;schedulePreview();};extras.append(input);}row.append(extras);
    const remove=el('button','×','remove-chemical');remove.setAttribute('aria-label',`Remove component ${index+1}`);remove.onclick=()=>{chemicals.splice(index,1);renderChemicals();schedulePreview();};row.append(remove);$('composition').append(row);
  });
}
function schedulePreview() { clearTimeout(previewTimer);previewSequence++;previewTimer=setTimeout(renderPreview,220);updateMeta(); }
function updateMeta() {
  if(!shared||!entryType)return;const fmt=shared.config.formats[$('format').value],layout=$('layout').value;
  $('size-meta').textContent=`${fmt.width_mm} × ${fmt.height_mm} mm · 203 dpi`;
  const labelsPerSheet=layout==='4x2'?8:layout==='4x4'?16:layout==='2'?2:1;
  $('sheet-meta').textContent=`${labelsPerSheet} label${labelsPerSheet===1?'':'s'} per sheet`;
  const copies=Number($('copies').value)||1;$('output-meta').textContent=`${copies} sheet${copies===1?'':'s'} · ${copies*labelsPerSheet} label${copies*labelsPerSheet===1?'':'s'}`;
}
async function renderPreview() {
  const sequence=previewSequence;
  try{const result=await(await api('/api/preview',payload())).json();if(sequence!==previewSequence)return;$('preview').src=result.image;$('preview').hidden=false;$('preview-empty').hidden=true;$('date').textContent=result.date;}
  catch(error){if(sequence!==previewSequence)return;$('preview').hidden=true;$('preview-empty').hidden=false;$('preview-empty').textContent=error.message;}
}
function updatePrintButtons() { const disabled=printing||!$('printer').value;$('print').disabled=disabled;$('print-grid').disabled=disabled;$('print').firstChild.textContent=printing?'Sending… ':'Print label '; }
async function printJob(calibrate=false) {
  if(printing)return;printing=true;updatePrintButtons();
  try{const body=payload();body.job_id=globalThis.crypto?.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`;const result=await(await api(calibrate?'/api/calibrate':'/api/print',body)).json();if(result.error)throw new Error(result.error);message(result.message);}
  catch(error){fail(error);}finally{printing=false;updatePrintButtons();}
}
function defaultName(){return entryType==='Antibodies'?`${draft.antigen||''} ${draft.host||''}`.trim():draft.name||'';}
function showNameDialog(action){nameAction=action;$('name-title').textContent=action==='rename'?'Rename preset':'Save preset';$('preset-name').value=$('preset').value||defaultName();$('name-dialog').showModal();$('preset-name').focus();$('preset-name').select();}
async function saveNamed(event){event.preventDefault();const newName=$('preset-name').value.trim();if(!newName)return;const button=event.submitter;if(button)button.disabled=true;try{const body=payload();let path;if(nameAction==='rename'){path='/api/rename';body.old_name=$('preset').value;body.new_name=newName;}else{path='/api/preset';body.preset_name=newName;body.overwrite=newName===$('preset').value;}const result=await(await api(path,body)).json();updateShared(result.state);refreshPresets(newName);$('name-dialog').close();message(result.message);}catch(error){fail(error);$('name-dialog').close();}finally{if(button)button.disabled=false;}}
function relevantSections(){const fmt=$('format').value,layout=$('layout').value;if(entryType==='Antibodies')return fmt==='38x12'?['antibody_layout']:layout==='4x2'?['antibody_4x2_layout']:[];if(entryType==='Plasmids')return [layout==='4x2'?'plasmid_4x2_layout':'plasmid_layout'];if(entryType==='Label')return [];return [layout==='4x2'?(['Staining Solutions','Antibiotics'].includes(entryType)?'staining_4x2_layout':'solution_4x2_layout'):'buffer_layout'];}
function updateSettingsUI(){const s=currentSettings();$('offset-x').value=s.x;$('offset-y').value=s.y;$('media').value=s.media;const sections=relevantSections();setOptions($('layout-section'),sections.map(k=>[k,k.replaceAll('_',' ')]));$('layout-details').hidden=!sections.length;renderLayoutControls();}
function renderLayoutControls(){const section=$('layout-section').value;$('layout-controls').replaceChildren();if(!section)return;const s=currentSettings(),values=s.layouts[section]||shared.layouts[$('format').value][section];for(const [key,value] of Object.entries(values)){const label=el('label',key.replaceAll('_',' '),'field'),input=el('input');input.type='number';input.min=0;input.max=2000;input.value=value;input.oninput=()=>{s.layouts[section]??=structuredClone(shared.layouts[$('format').value][section]);s.layouts[section][key]=input.value;schedulePreview();};label.append(input);$('layout-controls').append(label);}}
async function saveSettings(){const button=$('save-settings');button.disabled=true;try{const result=await(await api('/api/settings',payload())).json();updateShared(result.state);delete settingsDraft[$('format').value];updateSettingsUI();$('settings-dialog').close();message(result.message);schedulePreview();}catch(error){fail(error);$('settings-dialog').close();}finally{button.disabled=false;}}
async function downloadZpl(){try{const response=await api('/api/zpl',payload()),blob=await response.blob(),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='label.zpl';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){fail(error);}}
async function refresh(sharedData=false){try{const result=await(await api('/api/state')).json();if(sharedData){settingsDraft={};updateShared(result);refreshPresets($('preset').value);updateSettingsUI();schedulePreview();message('Shared data reloaded. Your current label fields are kept.');}else{updateShared(result);message('Host printer list refreshed.');}}catch(error){fail(error);}}

$('preset').onchange=loadPreset;
$('format').onchange=()=>{setLayout();updateSettingsUI();schedulePreview();};
$('layout').onchange=()=>{updateSettingsUI();schedulePreview();};
$('user').oninput=schedulePreview;$('copies').oninput=schedulePreview;
$('printer').onchange=updatePrintButtons;
$('new-label').onclick=()=>selectType(entryType);
$('add-chemical').onclick=()=>{if(chemicals.length>=50){message('At most 50 composition rows are supported.',true);return;}chemicals.push({concentration:'',name:'',amount:'',mw:'',cas:''});renderChemicals();};
$('save-preset').onclick=()=>showNameDialog('save');$('rename-preset').onclick=()=>showNameDialog('rename');
$('name-form').onsubmit=saveNamed;$('cancel-name').onclick=()=>$('name-dialog').close();
$('settings').onclick=()=>{updateSettingsUI();$('settings-dialog').showModal();};
for(const axis of ['x','y'])$('offset-'+axis).oninput=()=>{currentSettings()[axis]=$('offset-'+axis).value;schedulePreview();};
$('media').onchange=()=>{currentSettings().media=$('media').value;schedulePreview();};
$('layout-section').onchange=renderLayoutControls;
$('discard-settings').onclick=()=>{delete settingsDraft[$('format').value];updateSettingsUI();schedulePreview();};
$('save-settings').onclick=saveSettings;$('print-grid').onclick=()=>printJob(true);
$('print').onclick=()=>printJob();$('download-zpl').onclick=downloadZpl;
$('reload').onclick=()=>refresh(true);$('refresh-printers').onclick=()=>refresh(false);
(async()=>{try{const response=await api('/api/state');updateShared(await response.json());selectType(Object.keys(shared.config.entry_types)[0]);}catch(error){fail(error);$('preview-empty').textContent='Start the local Label Printer helper, allow local network access if prompted, then reload this page.';}})();

let configRevision;

function downloadFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = el('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('export-excel').onclick = async event => {
  event.preventDefault();
  try {
    downloadFile(await (await api('/api/export')).blob(), 'label_config_export.xlsx');
  } catch (error) {
    fail(error);
  }
};

$('manage-config').onclick = async () => {
  try {
    const result = await (await api('/api/config')).json();
    configRevision = result.revision;
    $('config-file').value = '';
    $('config-text').value = result.text;
    $('config-status').textContent = '';
    $('config-dialog').showModal();
  } catch (error) {
    fail(error);
  }
};

$('config-file').onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const text = (await file.text()).replace(/^\uFEFF/, '');
    JSON.parse(text);
    $('config-text').value = text;
    $('config-status').textContent = 'File loaded. Save to apply it to this PC.';
  } catch (error) {
    $('config-status').textContent = error.message;
  }
};

$('config-download').onclick = () => {
  const text = $('config-text').value;
  try {
    JSON.parse(text);
    downloadFile(new Blob([text], {type: 'application/json'}), 'label_config.json');
  } catch (error) {
    $('config-status').textContent = error.message;
  }
};

$('config-save').onclick = async () => {
  const button = $('config-save');
  button.disabled = true;
  try {
    const config = JSON.parse($('config-text').value);
    const result = await (await api('/api/config', {config, revision: configRevision})).json();
    settingsDraft = {};
    updateShared(result.state);
    selectType(Object.hasOwn(shared.config.entry_types, entryType) ? entryType : Object.keys(shared.config.entry_types)[0]);
    $('config-dialog').close();
    message(result.message);
  } catch (error) {
    $('config-status').textContent = error.message;
  } finally {
    button.disabled = false;
  }
};
