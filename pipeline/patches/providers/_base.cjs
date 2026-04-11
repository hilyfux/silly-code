/**
 * _base.cjs — Shared protocol functions for provider adapters
 *
 * These functions are serialized as strings and injected alongside provider
 * fetch adapters into the patched binary (pipeline/build/cli-patched.js).
 * They run in the client factory scope and cannot access outer module variables.
 *
 * Exports:
 *   mapModel              — Map Claude model name via provider-supplied table
 *   msgToOai              — Convert Anthropic message to OpenAI Chat Completions format
 *   msgsToResponsesInput  — Convert Anthropic messages to Responses API input format
 *   makeSseStream         — OpenAI Chat Completions SSE → Anthropic Messages SSE stream
 *   makeResponsesSseStream — OpenAI Responses API SSE → Anthropic Messages SSE stream
 */

/**
 * Map a Claude model name to a provider model using a lookup table.
 * Table keys are matched with model.includes(key); 'default' is the fallback.
 * If no table or no model is supplied, the original value is passed through.
 *
 * @param {string|null} model - Incoming Claude model name
 * @param {Object|null} table - e.g. { 'claude-opus': 'gpt-5.4', default: 'gpt-5.4' }
 * @returns {string|null}
 */
function mapModel(model, table) {
  if (!table || !model) return model;
  for (const [k, v] of Object.entries(table)) {
    if (k !== 'default' && model.includes(k)) return v;
  }
  return table.default || model;
}

/**
 * Convert an Anthropic Messages API message to one or more OpenAI
 * Chat Completions messages.
 *
 * Handles: string content, text blocks, image blocks,
 *          tool_use → tool_calls, tool_result → tool role messages.
 *
 * @param {{ role: string, content: string|Array }} msg
 * @returns {Array}
 */
function msgToOai(msg){
  if(typeof msg.content==='string')return[{role:msg.role,content:msg.content}];
  if(!Array.isArray(msg.content))return[{role:msg.role,content:String(msg.content||'')}];
  if(msg.content.length===0)return[{role:msg.role,content:''}];
  const _texts=[], _toolCalls=[], _toolResults=[];
  for(const p of msg.content){
    if(p.type==='text')_texts.push({type:'text',text:p.text});
    else if(p.type==='image')_texts.push({type:'image_url',image_url:{url:'data:'+p.source.media_type+';base64,'+p.source.data}});
    else if(p.type==='tool_use')_toolCalls.push({id:p.id||'tc_'+Date.now(),type:'function',function:{name:p.name,arguments:JSON.stringify(p.input||{})}});
    else if(p.type==='tool_result'){
      let _c=typeof p.content==='string'?p.content:(p.content||[]).map(c=>c.text||'').join('');
      if(p.is_error)_c='[ERROR] '+_c;
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

/**
 * Convert Anthropic system + messages to Responses API input format.
 * System prompt → developer role message.
 * tool_use / tool_result blocks are flattened to text (Responses API only
 * accepts message items in input).
 *
 * @param {string|Array|null} system
 * @param {Array} messages
 * @returns {Array}
 */
function msgsToResponsesInput(system, messages) {
  const _parts=[];
  if(system){_parts.push({type:'message',role:'developer',content:typeof system==='string'?system:(system||[]).map(p=>p.text||'').join('')});}
  for(const m of (messages||[])){
    if(typeof m.content==='string'){_parts.push({type:'message',role:m.role==='assistant'?'assistant':'user',content:m.content});continue;}
    if(!Array.isArray(m.content)){_parts.push({type:'message',role:m.role==='user'?'user':'assistant',content:String(m.content||'')});continue;}
    // Split content blocks: text→message, tool_use→function_call, tool_result→function_call_output
    const _texts=[];
    for(const p of m.content){
      if(p.type==='text'){_texts.push(p.text);}
      else if(p.type==='tool_use'){
        if(_texts.length>0){_parts.push({type:'message',role:'assistant',content:_texts.join('')});_texts.length=0;}
        _parts.push({type:'function_call',call_id:p.id||'tc_'+Date.now(),name:p.name,arguments:JSON.stringify(p.input||{})});
      }
      else if(p.type==='tool_result'){
        if(_texts.length>0){_parts.push({type:'message',role:m.role==='user'?'user':'assistant',content:_texts.join('')});_texts.length=0;}
        let _c=typeof p.content==='string'?p.content:(p.content||[]).map(c=>c.text||'').join('');
        if(p.is_error)_c='[ERROR] '+_c;
        _parts.push({type:'function_call_output',call_id:p.tool_use_id,output:_c});
      }
      else{_texts.push(JSON.stringify(p));}
    }
    if(_texts.length>0){_parts.push({type:'message',role:m.role==='user'?'user':'assistant',content:_texts.join('')});}
  }
  return _parts;
}

/**
 * Convert an OpenAI Chat Completions SSE response to an Anthropic Messages
 * SSE ReadableStream.
 *
 * @param {Response} oaiResp - Streaming fetch response from Chat Completions
 * @param {string} model - Model name to embed in message_start event
 * @returns {ReadableStream}
 */
function makeSseStream(oaiResp, model) {
  const _enc=new TextEncoder(),_dec=new TextDecoder();
  const _msgId='msg_sc_'+Date.now();
  let _sentStart=false,_blockIdx=0,_blockOpen=false,_outTok=0,_hasTools=false;
  // Track active tool block indices to properly close them
  const _openToolBlocks=new Set();
  return new ReadableStream({async start(ctrl){
    const _rd=oaiResp.body.getReader();let _buf='';
    const _send=(ev,d)=>ctrl.enqueue(_enc.encode('event: '+ev+'\ndata: '+JSON.stringify(d)+'\n\n'));
    const _closeAll=()=>{
      if(_blockOpen){_send('content_block_stop',{type:'content_block_stop',index:_blockIdx});_blockOpen=false;}
      for(const bi of _openToolBlocks){_send('content_block_stop',{type:'content_block_stop',index:bi});}_openToolBlocks.clear();
    };
    const _finish=(reason)=>{
      _closeAll();
      _send('message_delta',{type:'message_delta',delta:{stop_reason:reason,stop_sequence:null},usage:{output_tokens:_outTok}});
      _send('message_stop',{type:'message_stop'});ctrl.close();
    };
    try{while(true){
      const{done,value}=await _rd.read();if(done)break;
      _buf+=_dec.decode(value,{stream:true});
      const _lines=_buf.split('\n');_buf=_lines.pop()||'';
      for(const line of _lines){
        if(!line.startsWith('data: '))continue;
        const _d=line.slice(6).trim();
        if(_d==='[DONE]'){_finish(_hasTools?'tool_use':'end_turn');return;}
        let _chunk;try{_chunk=JSON.parse(_d)}catch{continue}
        if(!_sentStart){_sentStart=true;_send('message_start',{type:'message_start',message:{id:_msgId,type:'message',role:'assistant',content:[],model,stop_reason:null,stop_sequence:null,usage:{input_tokens:0,output_tokens:0}}});}
        const _ch=_chunk.choices?.[0];if(!_ch)continue;
        const _dt=_ch.delta||{};
        if(_dt.content!=null){
          if(!_blockOpen){_blockOpen=true;_send('content_block_start',{type:'content_block_start',index:_blockIdx,content_block:{type:'text',text:''}});}
          _outTok++;_send('content_block_delta',{type:'content_block_delta',index:_blockIdx,delta:{type:'text_delta',text:_dt.content}});
        }
        if(_dt.tool_calls){
          // Close text block before first tool call
          if(_blockOpen){_send('content_block_stop',{type:'content_block_stop',index:_blockIdx});_blockIdx++;_blockOpen=false;}
          for(const tc of _dt.tool_calls){
            _hasTools=true;
            const ti=tc.index!=null?tc.index:0;
            const _bi=_blockIdx+ti;
            if(tc.function?.name&&!_openToolBlocks.has(_bi)){
              // Use OpenAI's native ID (e.g. call_abc123) — do NOT prepend tc_
              const _tcId=tc.id||('toolu_'+ti+'_'+Date.now());
              _send('content_block_start',{type:'content_block_start',index:_bi,content_block:{type:'tool_use',id:_tcId,name:tc.function.name,input:{}}});
              _openToolBlocks.add(_bi);
            }
            if(tc.function?.arguments)_send('content_block_delta',{type:'content_block_delta',index:_bi,delta:{type:'input_json_delta',partial_json:tc.function.arguments}});
          }
        }
        if(_ch.finish_reason){_finish(_ch.finish_reason==='tool_calls'?'tool_use':'end_turn');return;}
      }
    }
    // Stream ended without [DONE] or finish_reason — clean up
    if(_sentStart){_finish(_hasTools?'tool_use':'end_turn');}else{ctrl.close();}
    }catch(e){ctrl.error(e);}
  }});
}

/**
 * Convert an OpenAI Responses API SSE response to an Anthropic Messages
 * SSE ReadableStream.
 *
 * @param {Response} oaiResp - Streaming fetch response from Responses API
 * @param {string} model - Model name to embed in message_start event
 * @returns {ReadableStream}
 */
function makeResponsesSseStream(oaiResp, model) {
  const _enc=new TextEncoder(),_dec=new TextDecoder();
  const _msgId='msg_sc_'+Date.now();
  let _blockIdx=0,_blockOpen=false,_outTok=0,_sentStart=false,_hasTools=false;
  return new ReadableStream({async start(ctrl){
    const _rd=oaiResp.body.getReader();let _buf='';
    const _send=(ev,d)=>ctrl.enqueue(_enc.encode('event: '+ev+'\ndata: '+JSON.stringify(d)+'\n\n'));
    const _ensureStart=()=>{if(!_sentStart){_sentStart=true;_send('message_start',{type:'message_start',message:{id:_msgId,type:'message',role:'assistant',content:[],model,stop_reason:null,stop_sequence:null,usage:{input_tokens:0,output_tokens:0}}});}};
    const _finish=(sr,usage)=>{
      if(_blockOpen){_send('content_block_stop',{type:'content_block_stop',index:_blockIdx});_blockOpen=false;}
      _send('message_delta',{type:'message_delta',delta:{stop_reason:sr,stop_sequence:null},usage:{output_tokens:usage||_outTok}});
      _send('message_stop',{type:'message_stop'});ctrl.close();
    };
    try{while(true){
      const{done,value}=await _rd.read();if(done)break;
      _buf+=_dec.decode(value,{stream:true});
      const _lines=_buf.split('\n');_buf=_lines.pop()||'';
      for(const line of _lines){
        if(!line.startsWith('data: '))continue;
        const _d=line.slice(6).trim();
        if(_d==='[DONE]'){_ensureStart();_finish(_hasTools?'tool_use':'end_turn');return;}
        let _ev;try{_ev=JSON.parse(_d)}catch{continue}
        const _t=_ev.type;
        if(_t==='response.created'&&!_sentStart){
          _sentStart=true;
          _send('message_start',{type:'message_start',message:{id:_ev.response?.id||_msgId,type:'message',role:'assistant',content:[],model,stop_reason:null,stop_sequence:null,usage:{input_tokens:_ev.response?.usage?.input_tokens||0,output_tokens:0}}});
        }
        if(_t==='response.output_text.delta'){
          _ensureStart();
          if(!_blockOpen){_blockOpen=true;_send('content_block_start',{type:'content_block_start',index:_blockIdx,content_block:{type:'text',text:''}});}
          _outTok++;
          _send('content_block_delta',{type:'content_block_delta',index:_blockIdx,delta:{type:'text_delta',text:_ev.delta||''}});
        }
        if(_t==='response.output_item.added'){
          _ensureStart();
          if(_ev.item?.type==='function_call'){
            _hasTools=true;
            if(_blockOpen){_send('content_block_stop',{type:'content_block_stop',index:_blockIdx});_blockIdx++;_blockOpen=false;}
            _send('content_block_start',{type:'content_block_start',index:_blockIdx,content_block:{type:'tool_use',id:_ev.item.call_id||('toolu_'+Date.now()),name:_ev.item.name||'',input:{}}});
            _blockOpen=true;
          } else if(_ev.item?.type==='message'){
            // New text output item — close previous block if open, start fresh text block
            if(_blockOpen){_send('content_block_stop',{type:'content_block_stop',index:_blockIdx});_blockIdx++;_blockOpen=false;}
          }
        }
        if(_t==='response.function_call_arguments.delta'){
          _send('content_block_delta',{type:'content_block_delta',index:_blockIdx,delta:{type:'input_json_delta',partial_json:_ev.delta||''}});
        }
        if(_t==='response.function_call_arguments.done'){
          if(_blockOpen){_send('content_block_stop',{type:'content_block_stop',index:_blockIdx});_blockIdx++;_blockOpen=false;}
        }
        if(_t==='response.output_text.done'){
          if(_blockOpen){_send('content_block_stop',{type:'content_block_stop',index:_blockIdx});_blockIdx++;_blockOpen=false;}
        }
        if(_t==='response.completed'){
          if(_blockOpen){_send('content_block_stop',{type:'content_block_stop',index:_blockIdx});_blockOpen=false;}
          const _u=_ev.response?.usage||{};
          const _ht=_hasTools||(_ev.response?.output||[]).some(o=>o.type==='function_call');
          _finish(_ev.response?.status==='incomplete'?'max_tokens':_ht?'tool_use':'end_turn',_u.output_tokens||_outTok);return;
        }
      }
    }
    // Stream ended without response.completed — clean up
    if(_sentStart){_finish(_hasTools?'tool_use':'end_turn');}else{ctrl.close();}
    }catch(e){ctrl.error(e);}
  }});
}

/**
 * Flatten Anthropic system prompt to a plain string.
 * Handles both string and array-of-blocks formats.
 */
function flattenSystem(sys) {
  if (!sys) return '';
  return typeof sys === 'string' ? sys : (sys || []).map(p => p.text || '').join('');
}

/**
 * Convert an OpenAI Chat Completions non-streaming response to an
 * Anthropic Messages API response body (as a Response object).
 *
 * @param {Object} oaiJson - Parsed JSON from Chat Completions
 * @param {string} model - Model name to embed in response
 * @returns {Response}
 */
function oaiToAnthropicResponse(oaiJson, model) {
  const _c = oaiJson.choices?.[0], _mg = _c?.message;
  if (!_c || !_mg) {
    const _err = oaiJson.error?.message || 'No valid completion in response';
    return new Response(JSON.stringify({
      id: 'msg_' + (oaiJson.id || Date.now()), type: 'error',
      error: { type: 'api_error', message: _err }
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  const _ct = [];
  if (_mg.content) _ct.push({ type: 'text', text: _mg.content });
  if (_mg.tool_calls) for (const tc of _mg.tool_calls) {
    let _i = {}; try { _i = JSON.parse(tc.function.arguments || '{}') } catch {}
    _ct.push({ type: 'tool_use', id: tc.id || 'tc_' + Date.now(), name: tc.function.name, input: _i });
  }
  return new Response(JSON.stringify({
    id: 'msg_' + (oaiJson.id || Date.now()), type: 'message', role: 'assistant',
    content: _ct, model,
    stop_reason: _c?.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn',
    usage: { input_tokens: oaiJson.usage?.prompt_tokens || 0, output_tokens: oaiJson.usage?.completion_tokens || 0 }
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Tone down aggressive skill activation instructions for third-party models.
 * GPT models follow "ABSOLUTELY MUST" / "1% chance" too literally, causing
 * skills to fire on every turn and block autonomous loop execution.
 *
 * Operates on message content strings — strips or rewrites the most
 * problematic patterns while preserving skill descriptions.
 *
 * @param {string} text - Message text (may contain system-reminder tags)
 * @returns {string}
 */
function tameSkillPrompts(text) {
  if (!text || typeof text !== 'string') return text;
  // Strip the EXTREMELY-IMPORTANT blocks that force skill invocation
  text = text.replace(/<EXTREMELY-IMPORTANT>[\s\S]*?<\/EXTREMELY-IMPORTANT>/g, '');
  text = text.replace(/<EXTREMELY_IMPORTANT>[\s\S]*?<\/EXTREMELY_IMPORTANT>/g, '');
  // Remove HARD-GATE blocks that block autonomous execution
  text = text.replace(/<HARD-GATE>[\s\S]*?<\/HARD-GATE>/g, '');
  // Remove SUBAGENT-STOP blocks
  text = text.replace(/<SUBAGENT-STOP>[\s\S]*?<\/SUBAGENT-STOP>/g, '');
  // Tone down remaining aggressive directives
  text = text.replace(/you ABSOLUTELY MUST invoke the skill/gi, 'consider invoking the skill if relevant');
  text = text.replace(/IF A SKILL APPLIES TO YOUR TASK, YOU DO NOT HAVE A CHOICE\. YOU MUST USE IT\./gi, '');
  text = text.replace(/This is not negotiable\. This is not optional\. You cannot rationalize your way out of this\./gi, '');
  text = text.replace(/even a 1% chance a skill might apply/gi, 'a skill clearly applies');
  // Remove the "Red Flags" table that makes models paranoid about skipping skills
  text = text.replace(/## Red Flags[\s\S]*?(?=## |\n---|\Z)/g, '');
  return text;
}

/**
 * Clean Claude-specific identity content from system/message text for
 * third-party models. The upstream binary constructs system prompts with
 * many hardcoded Claude/Anthropic references beyond what the identity
 * patches can cover. This function strips or rewrites them so GPT models
 * don't get confused about who they are.
 *
 * @param {string} text - System prompt or message text
 * @param {string} providerName - e.g. "OpenAI GPT", "GitHub Copilot"
 * @returns {string}
 */
function cleanIdentityForProvider(text, providerName) {
  if (!text || typeof text !== 'string') return text;
  // Co-author attribution (before other Claude replacements to match original text)
  text = text.replace(/Co-Authored-By: Claude[^\n]*/g, `Co-Authored-By: Silly Code (${providerName}) <noreply@silly-code.dev>`);
  // Core identity replacements
  text = text.replace(/\bClaude Code\b/g, 'Silly Code');
  text = text.replace(/Anthropic's official CLI for Claude/g, 'a multi-provider AI coding assistant');
  // Model name references — don't confuse GPT about what model it is
  text = text.replace(/You are powered by the model named [^\n]+?\.\s/g, `You are powered by ${providerName}. `);
  text = text.replace(/The exact model ID is [^\n]+?\.\s/g, '');
  // Remove entire sentences about Claude model family/IDs
  text = text.replace(/The most recent Claude model family[^\n]*\n?/g, '');
  text = text.replace(/Model IDs[^\n]*\n?/g, '');
  // Claude model name references (e.g. "Claude Opus 4.6", "Claude Sonnet 4.6")
  text = text.replace(/\bClaude (Opus|Sonnet|Haiku) [\d.]+/g, providerName);
  // Specific phrases before generic Claude replacement
  text = text.replace(/the latest and most capable Claude models/g, 'the latest and most capable models');
  // Possessive Claude's, then remaining standalone Claude
  text = text.replace(/\bClaude's\b/g, "the AI model's");
  text = text.replace(/\bClaude\b(?!\.md|\.ai|_CODE|-code)/g, 'the AI model');
  // Anthropic references in non-URL contexts (not in URLs or SDK imports)
  text = text.replace(/\bAnthropic\b(?!\.com|\/|_ai|-ai)/g, 'the provider');
  return text;
}

module.exports = { mapModel, msgToOai, msgsToResponsesInput, makeSseStream, makeResponsesSseStream, flattenSystem, oaiToAnthropicResponse, tameSkillPrompts, cleanIdentityForProvider };
