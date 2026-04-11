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
  const _c = oaiJson.choices?.[0], _mg = _c?.message, _ct = [];
  if (_mg?.content) _ct.push({ type: 'text', text: _mg.content });
  if (_mg?.tool_calls) for (const tc of _mg.tool_calls) {
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

module.exports = { mapModel, msgToOai, msgsToResponsesInput, makeSseStream, makeResponsesSseStream, flattenSystem, oaiToAnthropicResponse };
