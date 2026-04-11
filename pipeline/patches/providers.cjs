/**
 * providers.cjs — Patches 10-15: Multi-provider support
 *
 * Injects OpenAI Codex and GitHub Copilot as additional providers.
 * Includes SSE stream translation, message format conversion,
 * model mapping, and fetch adapters.
 */

// ── Adapter functions (serialised and injected into the binary) ──

function _makeSseStream(oaiResp, model) {
  const _enc=new TextEncoder(),_dec=new TextDecoder();
  const _msgId='msg_sc_'+Date.now();
  let _sentStart=false,_blockIdx=0,_blockOpen=false,_outTok=0;
  return new ReadableStream({async start(ctrl){
    const _rd=oaiResp.body.getReader();let _buf='';
    const _send=(ev,d)=>ctrl.enqueue(_enc.encode('event: '+ev+'\ndata: '+JSON.stringify(d)+'\n\n'));
    try{while(true){
      const{done,value}=await _rd.read();if(done)break;
      _buf+=_dec.decode(value,{stream:true});
      const _lines=_buf.split('\n');_buf=_lines.pop()||'';
      for(const line of _lines){
        if(!line.startsWith('data: '))continue;
        const _d=line.slice(6).trim();
        if(_d==='[DONE]'){
          if(_blockOpen)_send('content_block_stop',{type:'content_block_stop',index:_blockIdx});
          _send('message_delta',{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:_outTok}});
          _send('message_stop',{type:'message_stop'});ctrl.close();return;
        }
        let _chunk;try{_chunk=JSON.parse(_d)}catch{continue}
        if(!_sentStart){_sentStart=true;_send('message_start',{type:'message_start',message:{id:_msgId,type:'message',role:'assistant',content:[],model,stop_reason:null,usage:{input_tokens:0,output_tokens:0}}});}
        const _ch=_chunk.choices?.[0];if(!_ch)continue;
        const _dt=_ch.delta||{};
        if(_dt.content!=null){
          if(!_blockOpen){_blockOpen=true;_send('content_block_start',{type:'content_block_start',index:_blockIdx,content_block:{type:'text',text:''}});}
          _outTok++;_send('content_block_delta',{type:'content_block_delta',index:_blockIdx,delta:{type:'text_delta',text:_dt.content}});
        }
        if(_dt.tool_calls){
          for(const tc of _dt.tool_calls){
            const ti=tc.index||0;
            if(_blockOpen){_send('content_block_stop',{type:'content_block_stop',index:_blockIdx});_blockIdx++;_blockOpen=false;}
            if(tc.function?.name)_send('content_block_start',{type:'content_block_start',index:_blockIdx+ti,content_block:{type:'tool_use',id:'tc_'+(tc.id||ti+'_'+Date.now()),name:tc.function.name,input:{}}});
            if(tc.function?.arguments)_send('content_block_delta',{type:'content_block_delta',index:_blockIdx+ti,delta:{type:'input_json_delta',partial_json:tc.function.arguments}});
          }
        }
        if(_ch.finish_reason){
          if(_blockOpen)_send('content_block_stop',{type:'content_block_stop',index:_blockIdx});
          _send('message_delta',{type:'message_delta',delta:{stop_reason:_ch.finish_reason==='tool_calls'?'tool_use':'end_turn'},usage:{output_tokens:_outTok}});
          _send('message_stop',{type:'message_stop'});ctrl.close();return;
        }
      }
    }}catch(e){ctrl.error(e);}
  }});
}

function _msgToOai(msg){
  if(typeof msg.content==='string')return[{role:msg.role,content:msg.content}];
  if(!Array.isArray(msg.content))return[{role:msg.role,content:String(msg.content||'')}];
  // Separate content into: text/image parts, tool_use calls, and tool_results
  const _texts=[], _toolCalls=[], _toolResults=[];
  for(const p of msg.content){
    if(p.type==='text')_texts.push({type:'text',text:p.text});
    else if(p.type==='image')_texts.push({type:'image_url',image_url:{url:'data:'+p.source.media_type+';base64,'+p.source.data}});
    else if(p.type==='tool_use')_toolCalls.push({id:p.id||'tc_'+Date.now(),type:'function',function:{name:p.name,arguments:JSON.stringify(p.input||{})}});
    else if(p.type==='tool_result'){
      const _c=typeof p.content==='string'?p.content:(p.content||[]).map(c=>c.text||'').join('');
      _toolResults.push({role:'tool',tool_call_id:p.tool_use_id,content:_c});
    }
    else _texts.push({type:'text',text:JSON.stringify(p)});
  }
  const _out=[];
  // Assistant message with text + tool_calls
  if(_toolCalls.length>0){
    const _am={role:'assistant',tool_calls:_toolCalls};
    if(_texts.length>0)_am.content=_texts.length===1&&_texts[0].type==='text'?_texts[0].text:_texts;
    else _am.content=null;
    _out.push(_am);
  } else if(_texts.length>0){
    _out.push({role:msg.role==='user'?'user':'assistant',content:_texts.length===1&&_texts[0].type==='text'?_texts[0].text:_texts});
  }
  // Tool result messages (one per result)
  for(const tr of _toolResults)_out.push(tr);
  return _out;
}

function _mapModel(model){
  // For Chat Completions API (API key / Copilot)
  const _mm={'claude-opus':'gpt-4o','claude-sonnet':'gpt-4o','claude-haiku':'gpt-4o-mini'};
  for(const[k,v]of Object.entries(_mm)){if(model&&model.includes(k))return v;}
  return'gpt-4o';
}
function _mapModelCodex(model){
  // For Codex Responses API (ChatGPT OAuth) — only gpt-5.x / gpt-5.x-codex models
  const _mm={'claude-opus':'gpt-5.4','claude-sonnet':'gpt-5.4','claude-haiku':'gpt-5.3-codex'};
  for(const[k,v]of Object.entries(_mm)){if(model&&model.includes(k))return v;}
  return'gpt-5.4';
}

let _sillyCodData=null;
async function _refreshCodex(){
  if(!_sillyCodData){
    const{readFileSync}=await import('node:fs');const{join}=await import('node:path');
    const _dir=process.env.SILLY_CODE_DATA||join(process.env.HOME||'~','.silly-code');
    try{_sillyCodData=JSON.parse(readFileSync(join(_dir,'codex-oauth.json'),'utf8'))}
    catch(e){throw new Error('Codex: no auth token. Run: node pipeline/login.mjs codex')}
  }
  if(!_sillyCodData.access_token)throw new Error('Codex: invalid token file');
  // Check JWT expiry (payload is base64url between first two dots)
  try{
    const _parts=_sillyCodData.access_token.split('.');
    if(_parts.length===3){
      const _pay=JSON.parse(atob(_parts[1].replace(/-/g,'+').replace(/_/g,'/')));
      if(_pay.exp&&Date.now()<(_pay.exp*1000-120000))return _sillyCodData.access_token;
    }
  }catch{}
  // Token expired or unreadable — try refresh
  if(!_sillyCodData.refresh_token){return _sillyCodData.access_token;}
  try{
    const _r=await fetch('https://auth.openai.com/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:'app_EMoamEEZ73f0CkXaXp7hrann',refresh_token:_sillyCodData.refresh_token}).toString()});
    if(_r.ok){
      const _d=await _r.json();
      _sillyCodData.access_token=_d.access_token||_sillyCodData.access_token;
      if(_d.refresh_token)_sillyCodData.refresh_token=_d.refresh_token;
      _sillyCodData.savedAt=new Date().toISOString();
      try{const{writeFileSync}=await import('node:fs');const{join}=await import('node:path');const _dir=process.env.SILLY_CODE_DATA||join(process.env.HOME||'~','.silly-code');writeFileSync(join(_dir,'codex-oauth.json'),JSON.stringify(_sillyCodData,null,2))}catch{}
    }
  }catch{}
  return _sillyCodData.access_token;
}
// Translate Responses API SSE → Anthropic Messages API SSE
function _makeResponsesSseStream(oaiResp, model) {
  const _enc=new TextEncoder(),_dec=new TextDecoder();
  const _msgId='msg_sc_'+Date.now();
  let _blockIdx=0,_blockOpen=false,_outTok=0,_sentStart=false;
  return new ReadableStream({async start(ctrl){
    const _rd=oaiResp.body.getReader();let _buf='';
    const _send=(ev,d)=>ctrl.enqueue(_enc.encode('event: '+ev+'\ndata: '+JSON.stringify(d)+'\n\n'));
    try{while(true){
      const{done,value}=await _rd.read();if(done)break;
      _buf+=_dec.decode(value,{stream:true});
      const _lines=_buf.split('\n');_buf=_lines.pop()||'';
      for(const line of _lines){
        if(!line.startsWith('data: '))continue;
        const _d=line.slice(6).trim();
        if(_d==='[DONE]'){
          if(_blockOpen)_send('content_block_stop',{type:'content_block_stop',index:_blockIdx});
          _send('message_delta',{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:_outTok}});
          _send('message_stop',{type:'message_stop'});ctrl.close();return;
        }
        let _ev;try{_ev=JSON.parse(_d)}catch{continue}
        const _t=_ev.type;
        // response.created → message_start
        if(_t==='response.created'&&!_sentStart){
          _sentStart=true;
          _send('message_start',{type:'message_start',message:{id:_ev.response?.id||_msgId,type:'message',role:'assistant',content:[],model,stop_reason:null,usage:{input_tokens:_ev.response?.usage?.input_tokens||0,output_tokens:0}}});
        }
        // response.output_text.delta → content_block_delta (text)
        if(_t==='response.output_text.delta'){
          if(!_sentStart){_sentStart=true;_send('message_start',{type:'message_start',message:{id:_msgId,type:'message',role:'assistant',content:[],model,stop_reason:null,usage:{input_tokens:0,output_tokens:0}}});}
          if(!_blockOpen){_blockOpen=true;_send('content_block_start',{type:'content_block_start',index:_blockIdx,content_block:{type:'text',text:''}});}
          _outTok++;
          _send('content_block_delta',{type:'content_block_delta',index:_blockIdx,delta:{type:'text_delta',text:_ev.delta||''}});
        }
        // response.output_item.added with type=function_call → content_block_start (tool_use)
        if(_t==='response.output_item.added'&&_ev.item?.type==='function_call'){
          if(_blockOpen){_send('content_block_stop',{type:'content_block_stop',index:_blockIdx});_blockIdx++;_blockOpen=false;}
          _send('content_block_start',{type:'content_block_start',index:_blockIdx,content_block:{type:'tool_use',id:_ev.item.call_id||'tc_'+Date.now(),name:_ev.item.name||'',input:{}}});
          _blockOpen=true;
        }
        // response.function_call_arguments.delta → content_block_delta (input_json_delta)
        if(_t==='response.function_call_arguments.delta'){
          _send('content_block_delta',{type:'content_block_delta',index:_blockIdx,delta:{type:'input_json_delta',partial_json:_ev.delta||''}});
        }
        // response.function_call_arguments.done → close tool block
        if(_t==='response.function_call_arguments.done'){
          if(_blockOpen){_send('content_block_stop',{type:'content_block_stop',index:_blockIdx});_blockIdx++;_blockOpen=false;}
        }
        // response.output_text.done → close text block
        if(_t==='response.output_text.done'){
          if(_blockOpen){_send('content_block_stop',{type:'content_block_stop',index:_blockIdx});_blockIdx++;_blockOpen=false;}
        }
        // response.completed → message_delta + message_stop
        if(_t==='response.completed'){
          if(_blockOpen){_send('content_block_stop',{type:'content_block_stop',index:_blockIdx});}
          const _u=_ev.response?.usage||{};
          const _sr='end_turn';
          _send('message_delta',{type:'message_delta',delta:{stop_reason:_sr},usage:{output_tokens:_u.output_tokens||_outTok}});
          _send('message_stop',{type:'message_stop'});ctrl.close();return;
        }
      }
    }}catch(e){ctrl.error(e);}
  }});
}
// Convert Anthropic messages to Responses API input format
function _msgsToResponsesInput(system, messages) {
  const _parts=[];
  if(system){_parts.push({type:'message',role:'developer',content:typeof system==='string'?system:(system||[]).map(p=>p.text||'').join('')});}
  for(const m of (messages||[])){
    if(typeof m.content==='string'){_parts.push({type:'message',role:m.role==='assistant'?'assistant':'user',content:m.content});continue;}
    if(!Array.isArray(m.content)){_parts.push({type:'message',role:m.role==='user'?'user':'assistant',content:String(m.content||'')});continue;}
    // Flatten content blocks into text (Responses API input only accepts message items)
    const _text=m.content.map(p=>{
      if(p.type==='text')return p.text;
      if(p.type==='tool_result')return '[Tool result id='+p.tool_use_id+']: '+(typeof p.content==='string'?p.content:(p.content||[]).map(c=>c.text||'').join(''));
      if(p.type==='tool_use')return '[Tool call '+p.name+': '+JSON.stringify(p.input)+']';
      return JSON.stringify(p);
    }).join('');
    _parts.push({type:'message',role:m.role==='user'?'user':'assistant',content:_text});
  }
  return _parts;
}
async function _sillyCodFetch(url,init){
  const _tok=await _refreshCodex();
  const _b=JSON.parse(init.body);
  // Detect token type: JWT (ChatGPT OAuth) vs API key (sk-xxx)
  const _isOAuth=_tok.startsWith('ey');
  if(_isOAuth){
    // ChatGPT OAuth → Responses API at chatgpt.com/backend-api/codex/responses
    // Requirements: instructions field required, store:false required, stream:true required
    const _om=_mapModelCodex(_b.model);
    const _sysText=typeof _b.system==='string'?_b.system:(_b.system||[]).map(p=>p.text||'').join('');
    const _input=_msgsToResponsesInput(null,_b.messages);
    const _req={model:_om,instructions:_sysText||'You are a helpful coding assistant.',input:_input,store:false,stream:true};
    if(_b.tools&&_b.tools.length){_req.tools=_b.tools.map(t=>({type:'function',name:t.name,description:t.description||'',parameters:t.input_schema||{type:'object',properties:{}}}));}
    const _r=await fetch('https://chatgpt.com/backend-api/codex/responses',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+_tok},body:JSON.stringify(_req)});
    if(!_r.ok){const _e=await _r.text();throw new Error('Codex API error '+_r.status+': '+_e);}
    // Always streaming (Codex requires stream:true)
    return new Response(_makeResponsesSseStream(_r,_b.model),{status:200,headers:{'Content-Type':'text/event-stream','Cache-Control':'no-cache'}});
  } else {
    // API key → Chat Completions at api.openai.com
    const _om=_mapModel(_b.model);
    const _msgs=[];
    if(_b.system)_msgs.push({role:'system',content:typeof _b.system==='string'?_b.system:(_b.system||[]).map(p=>p.text||'').join('')});
    for(const m of (_b.messages||[]))_msgs.push(..._msgToOai(m));
    const _req={model:_om,messages:_msgs,stream:!!_b.stream,max_tokens:_b.max_tokens||4096,temperature:_b.temperature!=null?_b.temperature:1};
    if(_b.tools&&_b.tools.length){_req.tools=_b.tools.map(t=>({type:'function',function:{name:t.name,description:t.description||'',parameters:t.input_schema||{type:'object',properties:{}}}}));_req.tool_choice='auto';}
    const _r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+_tok},body:JSON.stringify(_req)});
    if(!_r.ok){const _e=await _r.text();throw new Error('OpenAI API error '+_r.status+': '+_e);}
    if(_b.stream)return new Response(_makeSseStream(_r,_b.model),{status:200,headers:{'Content-Type':'text/event-stream','Cache-Control':'no-cache'}});
    const _d=await _r.json();const _c=_d.choices?.[0],_mg=_c?.message,_ct=[];
    if(_mg?.content)_ct.push({type:'text',text:_mg.content});
    if(_mg?.tool_calls)for(const tc of _mg.tool_calls){let _i={};try{_i=JSON.parse(tc.function.arguments||'{}')}catch{}_ct.push({type:'tool_use',id:tc.id||'tc_'+Date.now(),name:tc.function.name,input:_i});}
    return new Response(JSON.stringify({id:'msg_'+(_d.id||Date.now()),type:'message',role:'assistant',content:_ct,model:_b.model,stop_reason:_c?.finish_reason==='tool_calls'?'tool_use':'end_turn',usage:{input_tokens:_d.usage?.prompt_tokens||0,output_tokens:_d.usage?.completion_tokens||0}}),{status:200,headers:{'Content-Type':'application/json'}});
  }
}

let _sillyCopData=null;
async function _refreshCopilot(){
  if(!_sillyCopData){
    const{readFileSync}=await import('node:fs');const{join}=await import('node:path');
    const _dir=process.env.SILLY_CODE_DATA||join(process.env.HOME||'~','.silly-code');
    try{_sillyCopData=JSON.parse(readFileSync(join(_dir,'copilot-oauth.json'),'utf8'))}
    catch(e){throw new Error('Copilot: no auth token. Run: silly /login copilot')}
  }
  if(_sillyCopData.copilotToken&&_sillyCopData.copilotExpiresAt&&Date.now()<_sillyCopData.copilotExpiresAt-60000)return _sillyCopData.copilotToken;
  const _r=await fetch('https://api.github.com/copilot_internal/v2/token',{method:'GET',headers:{'Authorization':'Bearer '+_sillyCopData.githubToken,'Editor-Version':'vscode/1.85.0','Copilot-Integration-Id':'vscode-chat'}});
  if(!_r.ok)throw new Error('Copilot token refresh failed: '+_r.status);
  const _d=await _r.json();
  _sillyCopData.copilotToken=_d.token;_sillyCopData.copilotExpiresAt=(_d.expires_at||0)*1000;
  try{const{writeFileSync}=await import('node:fs');const{join}=await import('node:path');const _dir=process.env.SILLY_CODE_DATA||join(process.env.HOME||'~','.silly-code');writeFileSync(join(_dir,'copilot-oauth.json'),JSON.stringify(_sillyCopData))}catch{}
  return _sillyCopData.copilotToken;
}

async function _sillyCopFetch(url,init){
  const _tok=await _refreshCopilot();
  const _b=JSON.parse(init.body);
  const _msgs=[];
  if(_b.system)_msgs.push({role:'system',content:typeof _b.system==='string'?_b.system:(_b.system||[]).map(p=>p.text||'').join('')});
  for(const m of (_b.messages||[]))_msgs.push(..._msgToOai(m));
  const _om=_mapModel(_b.model);
  const _req={model:_om,messages:_msgs,stream:!!_b.stream,max_tokens:_b.max_tokens||4096};
  if(_b.tools&&_b.tools.length){_req.tools=_b.tools.map(t=>({type:'function',function:{name:t.name,description:t.description||'',parameters:t.input_schema||{type:'object',properties:{}}}}));_req.tool_choice='auto';}
  const _r=await fetch('https://api.githubcopilot.com/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+_tok,'Copilot-Integration-Id':'vscode-chat','Editor-Version':'vscode/1.85.0'},body:JSON.stringify(_req)});
  if(!_r.ok){const _e=await _r.text();throw new Error('Copilot API error '+_r.status+': '+_e);}
  if(_b.stream)return new Response(_makeSseStream(_r,_b.model),{status:200,headers:{'Content-Type':'text/event-stream','Cache-Control':'no-cache'}});
  const _d=await _r.json();const _c=_d.choices?.[0],_mg=_c?.message,_ct=[];
  if(_mg?.content)_ct.push({type:'text',text:_mg.content});
  if(_mg?.tool_calls)for(const tc of _mg.tool_calls){let _i={};try{_i=JSON.parse(tc.function.arguments||'{}')}catch{}_ct.push({type:'tool_use',id:tc.id||'tc_'+Date.now(),name:tc.function.name,input:_i});}
  return new Response(JSON.stringify({id:'msg_'+(_d.id||Date.now()),type:'message',role:'assistant',content:_ct,model:_b.model,stop_reason:_c?.finish_reason==='tool_calls'?'tool_use':'end_turn',usage:{input_tokens:_d.usage?.prompt_tokens||0,output_tokens:_d.usage?.completion_tokens||0}}),{status:200,headers:{'Content-Type':'application/json'}});
}

// Serialise helpers for injection into the binary
// Module-level variables must be prepended as string declarations
const ADAPTER_HELPERS = 'let _sillyCodData=null;let _sillyCopData=null;' +
  [_makeSseStream, _makeResponsesSseStream, _msgToOai, _msgsToResponsesInput, _mapModel, _mapModelCodex, _refreshCodex, _sillyCodFetch, _refreshCopilot, _sillyCopFetch]
  .map(f => f.toString()).join(';')
const CODEX_ADAPTER = '_sillyCodFetch'
const COPILOT_ADAPTER = '_sillyCopFetch'

module.exports = function applyProviders({ patch }) {
  // Patch 10: Provider detection — add openai + copilot branches
  patch('10-provider-detection',
    'return F6(process.env.CLAUDE_CODE_USE_BEDROCK)?"bedrock"',
    'return F6(process.env.CLAUDE_CODE_USE_OPENAI)?"openai":F6(process.env.CLAUDE_CODE_USE_COPILOT)?"copilot":F6(process.env.CLAUDE_CODE_USE_BEDROCK)?"bedrock"'
  )

  // Patch 13: Model resolution — treat openai/copilot like firstParty
  patch('13-model-resolution',
    'function D$(q=dq()){return q==="firstParty"||q==="anthropicAws"}',
    'function D$(q=dq()){return q==="firstParty"||q==="anthropicAws"||q==="openai"||q==="copilot"}'
  )

  // Patch 14: Provider family — include openai/copilot in known set
  patch('14-provider-family',
    'function lg(q=dq()){return q==="firstParty"||q==="anthropicAws"||q==="foundry"||q==="mantle"}',
    'function lg(q=dq()){return q==="firstParty"||q==="anthropicAws"||q==="foundry"||q==="mantle"||q==="openai"||q==="copilot"}'
  )

  // Patch 11-12: Inject fetch adapters before bedrock branch
  patch('11-12-provider-adapters',
    'P=cX(_);if(P==="bedrock")',
    `P=cX(_);${ADAPTER_HELPERS};` +
    `if(P==="openai"){return new gL({...M,apiKey:'codex-placeholder',fetch:${CODEX_ADAPTER}});}` +
    `if(P==="copilot"){return new gL({...M,apiKey:'copilot-placeholder',fetch:${COPILOT_ADAPTER}});}` +
    `if(P==="bedrock")`
  )

  // Patch 15: Model defaults — ensure model string is never undefined
  patch('15-model-defaults',
    '// Version: 2.1.101',
    '// Version: 2.1.101\n' +
    'if(!process.env.ANTHROPIC_DEFAULT_SONNET_MODEL)process.env.ANTHROPIC_DEFAULT_SONNET_MODEL="claude-sonnet-4-6";\n' +
    'if(!process.env.ANTHROPIC_DEFAULT_OPUS_MODEL)process.env.ANTHROPIC_DEFAULT_OPUS_MODEL="claude-opus-4-6";\n' +
    'if(!process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL)process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL="claude-haiku-4-5";'
  )
}
