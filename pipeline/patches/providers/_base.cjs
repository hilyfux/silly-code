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
  // Exact-key match first: lets explicit provider slugs (e.g. 'gpt-5.4-mini')
  // pass through untouched, even when the alias table also contains a shorter
  // prefix that would otherwise substring-match ('gpt-5.4').
  if (Object.prototype.hasOwnProperty.call(table, model)) return table[model];
  for (const [k, v] of Object.entries(table)) {
    if (k !== 'default' && model.includes(k)) return v;
  }
  return table.default || model;
}

/**
 * Decide whether the current request should run on OpenAI's priority tier.
 * Single-gear toggle that mirrors Codex CLI's /fast command. Claude Code's
 * multi-gear /effort maps as: high/xhigh → priority, else default.
 *
 * Overrides (highest wins): SILLY_CODEX_FAST env var (any truthy → on; '0'|
 * 'false'|'off'|'no' → off; else → fall through to effort check).
 * n8z is upstream's effort getter; wrapped in typeof+try so a future rename
 * degrades gracefully to env-only mode.
 */
function sillyFastTier(effortGetter) {
  const _env = process.env.SILLY_CODEX_FAST;
  if (_env != null && _env !== '') return /^(1|true|on|yes)$/i.test(_env);
  try {
    const _e = typeof effortGetter === 'function' ? effortGetter() : undefined;
    return _e === 'high' || _e === 'xhigh';
  } catch { return false; }
}

/**
 * Provider-agnostic context budget tracker — P0 of the agent core.
 *
 * Pure function: given only the protocol-level signals (messages, system
 * prompt, tools, context window size), returns the best estimate of token
 * usage for the current conversation. No provider-specific branches; works
 * for any adapter that normalises assistant messages into the Anthropic
 * Messages shape with usage blocks.
 *
 * Algorithm:
 *   1. Walk messages backwards to the most recent assistant whose message
 *      carries a usage block; sum input_tokens + cache_creation +
 *      cache_read + output_tokens (matches upstream's ey6 / vJ semantics).
 *   2. Estimate byte size of any trailing messages after that anchor
 *      (user + tool_result + etc.) and add a rough 3.5-char-per-token
 *      conversion.
 *   3. If no assistant usage exists at all, fall back to whole-message
 *      byte estimate plus system + tools byte count.
 *
 * Output: { used, total, remaining, usedPct, compactAt, blockingAt, source }
 *   - source: 'assistant_usage' | 'byte_estimate' | 'mixed'
 *   - compactAt = total - 33000 (matches upstream's v38 = Yn - t_7 math)
 *   - blockingAt = total - 3000 (matches upstream's Yn - e_7)
 */
function agentBudgetTrack({ messages, systemPrompt, tools, contextWindow }) {
  const _total = Math.max(1, Number(contextWindow) || 200000);
  const _compactAt = Math.max(0, _total - 33000);
  const _blockingAt = Math.max(0, _total - 3000);
  const _bytesToTokens = (b) => Math.ceil(b / 3.5);
  const _strBytes = (s) => typeof s === 'string' ? s.length : 0;
  const _blockBytes = (p) => {
    if (!p) return 0;
    if (typeof p === 'string') return p.length;
    if (p.type === 'text') return _strBytes(p.text);
    if (p.type === 'tool_use') return _strBytes(p.name) + _strBytes(JSON.stringify(p.input || {}));
    if (p.type === 'tool_result') {
      if (typeof p.content === 'string') return p.content.length;
      if (Array.isArray(p.content)) return p.content.reduce((n, c) => n + _blockBytes(c), 0);
      return 0;
    }
    if (p.type === 'thinking' || p.type === 'redacted_thinking') return _strBytes(p.thinking) + _strBytes(p.data);
    if (p.type === 'image') return 512;
    return _strBytes(JSON.stringify(p));
  };
  const _msgBytes = (m) => {
    if (!m) return 0;
    if (typeof m.content === 'string') return m.content.length;
    if (Array.isArray(m.content)) return m.content.reduce((n, c) => n + _blockBytes(c), 0);
    return 0;
  };
  let _anchorUsage = null, _anchorIdx = -1;
  if (Array.isArray(messages)) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m && m.role === 'assistant' && m.usage && typeof m.usage.input_tokens === 'number') {
        _anchorUsage = m.usage; _anchorIdx = i; break;
      }
    }
  }
  let _used = 0, _source = 'byte_estimate';
  if (_anchorUsage) {
    _used = (_anchorUsage.input_tokens || 0)
          + (_anchorUsage.cache_creation_input_tokens || 0)
          + (_anchorUsage.cache_read_input_tokens || 0)
          + (_anchorUsage.output_tokens || 0);
    _source = 'assistant_usage';
    let _tailBytes = 0;
    for (let j = _anchorIdx + 1; j < messages.length; j++) _tailBytes += _msgBytes(messages[j]);
    if (_tailBytes > 0) {
      _used += _bytesToTokens(_tailBytes);
      _source = 'mixed';
    }
  } else {
    let _all = 0;
    if (Array.isArray(messages)) for (const m of messages) _all += _msgBytes(m);
    if (typeof systemPrompt === 'string') _all += systemPrompt.length;
    else if (Array.isArray(systemPrompt)) for (const p of systemPrompt) _all += _strBytes(p && p.text);
    if (Array.isArray(tools)) _all += tools.reduce((n, t) => n + _strBytes(t && t.name) + _strBytes(t && t.description) + _strBytes(JSON.stringify((t && t.input_schema) || {})), 0);
    _used = _bytesToTokens(_all);
  }
  const _remaining = Math.max(0, _total - _used);
  const _usedPct = Math.min(100, Math.max(0, Math.round((_used / _total) * 100)));
  return { used: _used, total: _total, remaining: _remaining, usedPct: _usedPct, compactAt: _compactAt, blockingAt: _blockingAt, source: _source };
}

/**
 * Append one budget-track observation line to the local ndjson log.
 * Only writes when SILLY_AGENT_CORE=1. All IO errors swallowed — the
 * observation layer must never interfere with request flow.
 */
async function agentBudgetLog(entry) {
  if (process.env.SILLY_AGENT_CORE !== '1') return;
  try {
    const { appendFileSync, mkdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { homedir } = await import('node:os');
    const _dir = process.env.SILLY_CODE_DATA || join(homedir(), '.silly-code');
    mkdirSync(_dir, { recursive: true });
    const _path = process.env.SILLY_BUDGET_LOG || join(_dir, 'budget-log.ndjson');
    appendFileSync(_path, JSON.stringify({ ts: Date.now(), ...entry }) + '\n');
  } catch { /* intentionally silent */ }
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
    // Skip Claude-internal reasoning blocks when resuming cross-provider sessions —
    // their signature base64 payload pollutes the GPT context otherwise.
    if(p.type==='thinking'||p.type==='redacted_thinking')continue;
    if(p.type==='text')_texts.push({type:'text',text:p.text});
    else if(p.type==='image')_texts.push({type:'image_url',image_url:{url:'data:'+p.source.media_type+';base64,'+p.source.data}});
    else if(p.type==='tool_use')_toolCalls.push({id:p.id||'tc_'+Date.now(),type:'function',function:{name:p.name,arguments:JSON.stringify(p.input||{})}});
    else if(p.type==='tool_result'){
      // Tool results can contain mixed content: text + images + documents.
      // Extract all content types — images from tool results (e.g., screenshots)
      // are critical for GPT Pro to reason about visual output.
      let _trContent;
      if(typeof p.content==='string'){_trContent=p.content;}
      else if(Array.isArray(p.content)){
        const _parts=[];
        for(const c of p.content){
          if(c.type==='text')_parts.push({type:'text',text:c.text||''});
          else if(c.type==='image')_parts.push({type:'image_url',image_url:{url:'data:'+(c.source?.media_type||'image/png')+';base64,'+(c.source?.data||'')}});
          else _parts.push({type:'text',text:c.text||JSON.stringify(c)});
        }
        _trContent=_parts.length===1&&_parts[0].type==='text'?_parts[0].text:_parts;
      }else{_trContent=String(p.content||'');}
      if(p.is_error){
        if(typeof _trContent==='string')_trContent='[ERROR] '+_trContent;
        else if(Array.isArray(_trContent))_trContent=[{type:'text',text:'[ERROR]'},..._trContent];
      }
      _toolResults.push({role:'tool',tool_call_id:p.tool_use_id,content:_trContent});
    }
    // Handle MCP/server tool blocks — serialize to text so GPT sees the data
    else if(p.type==='server_tool_use'||p.type==='mcp_tool_use')_texts.push({type:'text',text:'[Tool call: '+((p.name||p.tool_name||'unknown'))+'] '+JSON.stringify(p.input||p.arguments||{})});
    else if(p.type==='server_tool_result'||p.type==='mcp_tool_result'){
      const _rc=typeof p.content==='string'?p.content:(p.content||[]).map(c=>c.text||'').join('');
      _texts.push({type:'text',text:'[Tool result: '+((p.name||p.tool_name||''))+'] '+_rc});
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
    const _role=m.role==='assistant'?'assistant':'user';
    if(typeof m.content==='string'){_parts.push({type:'message',role:_role,content:m.content});continue;}
    if(!Array.isArray(m.content)){_parts.push({type:'message',role:_role,content:String(m.content||'')});continue;}
    // Accumulated message-mode content (supports text+image multi-part for user msgs)
    const _mc=[];
    const _flush=()=>{
      if(_mc.length===0)return;
      // Single plain text → string; otherwise multi-part array (user only)
      if(_mc.length===1&&_mc[0].type==='input_text'){_parts.push({type:'message',role:_role,content:_mc[0].text});}
      else if(_role==='user'){_parts.push({type:'message',role:'user',content:[..._mc]});}
      else{_parts.push({type:'message',role:'assistant',content:_mc.filter(x=>x.type==='input_text').map(x=>x.text).join('')});}
      _mc.length=0;
    };
    for(const p of m.content){
      // Drop Claude-internal reasoning blocks (thinking/redacted_thinking) —
      // their signature payload would otherwise leak into GPT context on resume.
      if(p.type==='thinking'||p.type==='redacted_thinking')continue;
      if(p.type==='text'){_mc.push({type:'input_text',text:p.text});}
      else if(p.type==='image'){
        const _mt=p.source?.media_type||'image/png';
        const _dt=p.source?.data||'';
        _mc.push({type:'input_image',image_url:'data:'+_mt+';base64,'+_dt});
      }
      else if(p.type==='tool_use'){
        _flush();
        _parts.push({type:'function_call',call_id:p.id||'tc_'+Date.now(),name:p.name,arguments:JSON.stringify(p.input||{})});
      }
      else if(p.type==='tool_result'){
        _flush();
        // Extract text + image content from tool results (e.g., screenshots).
        // Responses API function_call_output.output is string-only — so we
        // emit any text inline, then append a follow-up user message carrying
        // the actual image(s) as input_image multi-part so GPT Pro can see them.
        // Truncating data URLs (old behavior) loses the image entirely.
        let _c;
        const _trailingImages=[];
        if(typeof p.content==='string'){_c=p.content;}
        else if(Array.isArray(p.content)){
          const _txts=[];
          for(const c of p.content){
            if(c.type==='text')_txts.push(c.text||'');
            else if(c.type==='image'){
              const _mt=c.source?.media_type||'image/png';
              const _dt=c.source?.data||'';
              if(_dt){
                _txts.push('[image attached — see next user message]');
                _trailingImages.push({type:'input_image',image_url:'data:'+_mt+';base64,'+_dt});
              }
            }
            else _txts.push(c.text||JSON.stringify(c));
          }
          _c=_txts.join('\n');
        }else{_c=String(p.content||'');}
        if(p.is_error)_c='[ERROR] '+_c;
        _parts.push({type:'function_call_output',call_id:p.tool_use_id,output:_c});
        if(_trailingImages.length){_parts.push({type:'message',role:'user',content:_trailingImages});}
      }
      // Handle MCP/server tool blocks in Responses API path
      else if(p.type==='server_tool_use'||p.type==='mcp_tool_use'){
        _flush();_mc.push({type:'input_text',text:'[Tool call: '+((p.name||p.tool_name||'unknown'))+'] '+JSON.stringify(p.input||p.arguments||{})});
      }
      else if(p.type==='server_tool_result'||p.type==='mcp_tool_result'){
        _flush();
        const _rc=typeof p.content==='string'?p.content:(p.content||[]).map(c=>c.text||'').join('');
        _mc.push({type:'input_text',text:'[Tool result: '+((p.name||p.tool_name||''))+'] '+_rc});
      }
      else{_mc.push({type:'input_text',text:JSON.stringify(p)});}
    }
    _flush();
  }
  return _parts;
}

/**
 * Parse a raw JSON tool-arguments string, strip empty-string and null values
 * that GPT emits for optional params (e.g. pages:""), and return the cleaned
 * object. Returns null if parsing fails — caller decides the fallback.
 */
function _cleanToolArgs(raw) {
  let obj;
  try { obj = JSON.parse(raw || '{}'); } catch { return null; }
  for (const k of Object.keys(obj)) { if (obj[k] === '' || obj[k] === null) delete obj[k]; }
  return obj;
}

/**
 * Translate an OpenAI finish_reason to an Anthropic stop_reason.
 * Shared by streaming + non-streaming + Responses API paths so all three
 * agree on the mapping (previously copy-pasted in three places).
 */
function mapOaiStopReason(finishReason, hasTools) {
  const _m={'tool_calls':'tool_use','function_calls':'tool_use','stop':'end_turn','length':'max_tokens','content_filter':'end_turn'};
  return _m[finishReason] || (hasTools ? 'tool_use' : 'end_turn');
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
  let _sentStart=false,_blockIdx=0,_blockOpen=false,_outTok=0,_inTok=0,_hasTools=false,_finished=false,_pendingStop=null,_usageRead=false;
  // Track active tool block indices to properly close them
  const _openToolBlocks=new Set();
  // Buffer tool args per block index — send cleaned JSON at finish_reason
  const _argsMap=new Map();
  return new ReadableStream({async start(ctrl){
    const _rd=oaiResp.body.getReader();let _buf='';
    const _send=(ev,d)=>ctrl.enqueue(_enc.encode('event: '+ev+'\ndata: '+JSON.stringify(d)+'\n\n'));
    const _closeAll=()=>{
      // Flush buffered tool args — clean empty-string params before sending
      for(const[bi,rawArgs]of _argsMap){const _ca=_cleanToolArgs(rawArgs);_send('content_block_delta',{type:'content_block_delta',index:bi,delta:{type:'input_json_delta',partial_json:_ca?JSON.stringify(_ca):rawArgs}});}_argsMap.clear();
      if(_blockOpen){_send('content_block_stop',{type:'content_block_stop',index:_blockIdx});_blockOpen=false;}
      for(const bi of _openToolBlocks){_send('content_block_stop',{type:'content_block_stop',index:bi});}_openToolBlocks.clear();
    };
    const _finish=(reason)=>{
      if(_finished)return;
      _finished=true;
      _closeAll();
      _send('message_delta',{type:'message_delta',delta:{stop_reason:_pendingStop||reason,stop_sequence:null},usage:{input_tokens:_inTok,output_tokens:_outTok}});
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
        // Trailing usage chunk arrives exactly once when stream_options.include_usage=true.
        if(!_usageRead&&_chunk.usage){_usageRead=true;_inTok=_chunk.usage.prompt_tokens||_inTok;_outTok=_chunk.usage.completion_tokens||_outTok;}
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
            if(tc.function?.arguments)_argsMap.set(_bi,(_argsMap.get(_bi)||'')+tc.function.arguments);
          }
        }
        // Defer finish so the trailing usage chunk (OpenAI's include_usage) still gets processed.
        if(_ch.finish_reason)_pendingStop=mapOaiStopReason(_ch.finish_reason,_hasTools);
      }
    }
    // Stream ended without [DONE] — _pendingStop preserves finish_reason if we got one.
    if(_sentStart){_finish(_pendingStop||(_hasTools?'tool_use':'end_turn'));}else{ctrl.close();}
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
  let _blockIdx=0,_blockOpen=false,_outTok=0,_inTok=0,_sentStart=false,_hasTools=false,_thinkOpen=false,_argsBuf='',_finished=false;
  return new ReadableStream({async start(ctrl){
    const _rd=oaiResp.body.getReader();let _buf='';
    const _send=(ev,d)=>ctrl.enqueue(_enc.encode('event: '+ev+'\ndata: '+JSON.stringify(d)+'\n\n'));
    const _ensureStart=()=>{if(!_sentStart){_sentStart=true;_send('message_start',{type:'message_start',message:{id:_msgId,type:'message',role:'assistant',content:[],model,stop_reason:null,stop_sequence:null,usage:{input_tokens:0,output_tokens:0}}});}};
    // Idempotent — response.completed may race with [DONE] or response.incomplete.
    const _finish=(sr,usage)=>{
      if(_finished)return;
      _finished=true;
      if(_blockOpen){_send('content_block_stop',{type:'content_block_stop',index:_blockIdx});_blockOpen=false;}
      _send('message_delta',{type:'message_delta',delta:{stop_reason:sr,stop_sequence:null},usage:{input_tokens:_inTok,output_tokens:usage||_outTok}});
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
        // o-series reasoning events → Anthropic thinking blocks.
        // This gives GPT Pro o3/o1 models the SAME thinking visibility as Claude
        // in the TUI — something Claude Code can't do because it never runs o-series.
        if(_t==='response.reasoning_summary_part.added'){
          _ensureStart();
          if(_blockOpen){_send('content_block_stop',{type:'content_block_stop',index:_blockIdx});_blockIdx++;_blockOpen=false;}
          _send('content_block_start',{type:'content_block_start',index:_blockIdx,content_block:{type:'thinking',thinking:''}});
          _thinkOpen=true;_blockOpen=true;
        }
        if(_t==='response.reasoning_summary_text.delta'){
          _ensureStart();
          if(!_thinkOpen){
            if(_blockOpen){_send('content_block_stop',{type:'content_block_stop',index:_blockIdx});_blockIdx++;_blockOpen=false;}
            _send('content_block_start',{type:'content_block_start',index:_blockIdx,content_block:{type:'thinking',thinking:''}});
            _thinkOpen=true;_blockOpen=true;
          }
          _send('content_block_delta',{type:'content_block_delta',index:_blockIdx,delta:{type:'thinking_delta',thinking:_ev.delta||''}});
        }
        if(_t==='response.reasoning_summary_text.done'||_t==='response.reasoning_summary_part.done'){
          if(_thinkOpen&&_blockOpen){_send('content_block_stop',{type:'content_block_stop',index:_blockIdx});_blockIdx++;_blockOpen=false;_thinkOpen=false;}
        }
        if(_t==='response.output_text.delta'){
          _ensureStart();
          // Close thinking block if still open before starting text
          if(_thinkOpen&&_blockOpen){_send('content_block_stop',{type:'content_block_stop',index:_blockIdx});_blockIdx++;_blockOpen=false;_thinkOpen=false;}
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
            _blockOpen=true;_argsBuf='';
          } else if(_ev.item?.type==='message'){
            // New text output item — close previous block if open, start fresh text block
            if(_blockOpen){_send('content_block_stop',{type:'content_block_stop',index:_blockIdx});_blockIdx++;_blockOpen=false;}
          }
        }
        if(_t==='response.function_call_arguments.delta'){
          // Buffer args — send cleaned JSON on done instead of streaming raw deltas.
          // Prevents GPT's empty-string optional params (e.g. pages:"") from reaching the harness.
          _argsBuf+=(_ev.delta||'');
        }
        if(_t==='response.function_call_arguments.done'){
          if(_argsBuf){const _ca=_cleanToolArgs(_argsBuf);_send('content_block_delta',{type:'content_block_delta',index:_blockIdx,delta:{type:'input_json_delta',partial_json:_ca?JSON.stringify(_ca):_argsBuf}});_argsBuf='';}
          if(_blockOpen){_send('content_block_stop',{type:'content_block_stop',index:_blockIdx});_blockIdx++;_blockOpen=false;}
        }
        if(_t==='response.output_text.done'){
          if(_blockOpen){_send('content_block_stop',{type:'content_block_stop',index:_blockIdx});_blockIdx++;_blockOpen=false;}
        }
        if(_t==='response.completed'){
          if(_blockOpen){_send('content_block_stop',{type:'content_block_stop',index:_blockIdx});_blockOpen=false;}
          const _u=_ev.response?.usage||{};
          _inTok=_u.input_tokens||_inTok;
          const _ht=_hasTools||(_ev.response?.output||[]).some(o=>o.type==='function_call');
          _finish(_ev.response?.status==='incomplete'?'max_tokens':_ht?'tool_use':'end_turn',_u.output_tokens||_outTok);return;
        }
        // Handle API-level failures — response.failed / response.error / response.incomplete
        // Without this, the stream silently hangs until done=true, killing the agent loop.
        if(_t==='response.failed'||_t==='response.error'){
          const _em=_ev.response?.error?.message||_ev.error?.message||('Codex stream '+_t);
          ctrl.error(new Error('[silly] Codex API: '+_em));return;
        }
        if(_t==='response.incomplete'){
          // incomplete without a reason → treat as max_tokens, let upstream handle continuation
          if(_blockOpen){_send('content_block_stop',{type:'content_block_stop',index:_blockIdx});_blockOpen=false;}
          _finish('max_tokens',_outTok);return;
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
  if (typeof sys === 'string') return sys;
  // Flatten system blocks to text, stripping cache_control metadata.
  // Anthropic uses cache_control: {type:'ephemeral'} on system blocks for
  // prompt caching — irrelevant for GPT Pro and causes issues in some APIs.
  return (sys || []).map(p => p.text || '').join('');
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
    const _i = _cleanToolArgs(tc.function.arguments) || {};
    _ct.push({ type: 'tool_use', id: tc.id || 'tc_' + Date.now(), name: tc.function.name, input: _i });
  }
  return new Response(JSON.stringify({
    id: 'msg_' + (oaiJson.id || Date.now()), type: 'message', role: 'assistant',
    content: _ct, model,
    stop_reason: mapOaiStopReason(_c?.finish_reason, !!_mg.tool_calls),
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
  // Strip Anthropic billing header injected at the top of system prompts —
  // this is internal Claude Code telemetry and confuses GPT about its identity.
  text = text.replace(/^x-anthropic-billing-header:[^\n]*\n?/m, '');
  // Rewrite deferred-tool schema notices from Claude Code protocol → GPT-usable format.
  // Original text tells Claude to call ToolSearch with "select:Name" syntax before
  // using a deferred tool. GPT Pro can follow this exact same protocol — it just needs
  // the instructions in plain language without Claude-specific jargon.
  text = text.replace(
    /<system-reminder>\s*The following deferred tools are now available via ToolSearch\.([\s\S]*?)<\/system-reminder>/g,
    (_evt, body) => {
      // Extract tool names from the body (one per line after the header).
      // Claude hook/tool ecosystems may render names as bullets, code spans,
      // or namespaced MCP identifiers, all of which GPT still needs intact.
      const names = [];
      const re = /^\s*(?:[-*]\s*)?`?([A-Za-z][\w:-]*)`?\s*$/gm;
      let m;
      while ((m = re.exec(body))) names.push(m[1]);
      if (!names.length) return '';
      return '[TOOL LOADING REQUIRED] Load these via ToolSearch before use: ' +
        names.join(', ') + '. ' +
        'Use ToolSearch({query:"select:ToolName"}), then call the tool.';
    }
  );
  // UserPromptSubmit hooks are mixed: legacy PUA/frustration hooks are harmful
  // noise for GPT, but modern hook ecosystems use the same channel for skill,
  // verifier, MCP-tool, and project-specific routing context. Default-preserve
  // non-toxic context so sillyx doesn't silently break hook-based workflows.
  text = text.replace(/<system-reminder>\s*UserPromptSubmit hook([\s\S]*?)<\/system-reminder>/g, (_all, body) => {
    const raw = String(body || '').replace(/^\s*(additional context|hook additional context)\s*:\s*/i, '').trim();
    if (!raw) return '';
    if (/\b(PUA|frustration|rage bait|emotional coercion)\b/i.test(raw)) return '';
    return '[HOOK CONTEXT] UserPromptSubmit: ' + raw +
      (/\bSkill\b/.test(raw) ? ' If the Skill schema is not loaded, call ToolSearch({query:"select:Skill"}) first.' : '');
  });
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
  // Remove the "Red Flags" table header + its markdown pipe-table body.
  // Precise termination (stops at the first non-pipe line) so we don't
  // accidentally eat surrounding skill prose. The earlier version used
  // \Z which JS regex doesn't support — it silently matched a literal "Z",
  // fizzled when input had none, and left the table intact.
  text = text.replace(/## Red Flags\n(?:\|[^\n]*\n?)+/g, '');
  // Strip the "Triggers on: '...', '...', ..." tails the harness appends to
  // each auto-injected skill catalog entry. GPT Pro picks skills from the
  // name + leading description; the exhaustive alias list is pure noise.
  // Scope: any occurrence in prose. Non-greedy up to the next period or
  // newline; handles both English and Chinese tail punctuation.
  text = text.replace(/Triggers on: ?[^\n]+?[\.\n]/g, '');
  // Strip GraphViz `digraph` / ```dot fenced blocks — the superpowers skill
  // embeds a flow-control DOT graph that GPT parses as noise. Keep the
  // surrounding skill prose; just drop the graph body.
  text = text.replace(/```dot[\s\S]*?```/g, '');
  text = text.replace(/^digraph\s+\w+\s*\{[\s\S]*?^\}\s*$/gm, '');
  // Compress a few generic upstream system-guide sentences that add token
  // weight for third-party providers without changing tool semantics.
  text = text.replace(
    /All text you output outside of tool use is displayed to the user\. Output text to communicate with the user\. You can use Github-flavored markdown for formatting, and will be rendered in a monospace font using the CommonMark specification\./g,
    'Write user-facing text normally; markdown is supported.'
  );
  text = text.replace(
    /Tools are executed in a user-selected permission mode\. When you attempt to call a tool that is not automatically allowed by the user's permission mode or permission settings, the user will be prompted so that they can approve or deny the execution\. If the user denies a tool you call, do not re-attempt the exact same tool call\. Instead, think about why the user has denied the tool call and adjust your approach\./g,
    'Tool calls may require user approval; if denied, adjust your approach instead of retrying the same call.'
  );
  text = text.replace(
    /Tool results and user messages may include <system-reminder> or other tags\. Tags contain information from the system\. They bear no direct relation to the specific tool results or user messages in which they appear\./g,
    'Treat <system-reminder> tags as system context, not user intent.'
  );
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
 * @param {string} providerName - e.g. "OpenAI GPT", "OpenAI Codex"
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

/**
 * Scan recent messages for the most recent TodoWrite tool_use and return any
 * todos that are still pending or in_progress. These are the canonical "open
 * items" from the model's own planning — far stronger signal than parsing
 * narration text.
 */
function findOpenTodos(messages) {
  if (!Array.isArray(messages)) return [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    for (let j = m.content.length - 1; j >= 0; j--) {
      const p = m.content[j];
      if (p && p.type === 'tool_use' && typeof p.name === 'string' && p.name.toLowerCase() === 'todowrite') {
        const todos = p.input && Array.isArray(p.input.todos) ? p.input.todos : null;
        if (todos) return todos.filter(t => t && t.status && t.status !== 'completed');
      }
    }
  }
  return [];
}

/**
 * Inject a continuation-discipline block into the system prompt so third-party
 * models (Codex) don't stop mid-task with narration-only responses.
 *
 * Observed pattern: GPT writes "我下一步继续 X" or "I'll do Y next" then emits
 * finish_reason=stop without calling the next tool. Agent loop respects the
 * stop → user has to manually say "continue". This block tells the model to
 * act instead of narrating future actions.
 *
 * If `messages` is provided and contains an active TodoWrite list with open
 * items, the open-todo reminder is appended inside the same discipline block
 * for a sharper signal than pure narration-pattern matching.
 *
 * Append-only (doesn't alter upstream prompt semantics).
 */
function enforceContinuation(text, messages, tools) {
  if (!text || typeof text !== 'string') return text;
  const open = findOpenTodos(messages);
  let openBlock = '';
  if (open.length) {
    const lines = open.slice(0, 8).map(t => '  - [' + (t.status || '?') + '] ' + (t.activeForm || t.content || '')).join('\n');
    openBlock = '\n\nYour own TodoWrite list currently has ' + open.length + ' unfinished item(s):\n' + lines + '\nThese items are NOT done. You cannot end the turn until every one is completed or explicitly blocked.';
  }
  // Detect ScheduleWakeup in tools — /loop sessions require it to be called every turn
  const _toolNames = Array.isArray(tools) ? tools.map(t => t.name || '') : [];
  const _hasScheduleWakeup = _toolNames.includes('ScheduleWakeup');
  let _isActiveLoop = false;
  if (_hasScheduleWakeup && Array.isArray(messages)) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== 'assistant') continue;
      const blocks = Array.isArray(m.content) ? m.content : [];
      if (blocks.some(b => b.type === 'tool_use' && b.name === 'ScheduleWakeup')) { _isActiveLoop = true; break; }
    }
  }
  const _loopBlock = _isActiveLoop
    ? '\n\nLOOP ENFORCEMENT: This is a /loop session. ScheduleWakeup is available. You MUST call ScheduleWakeup before ending your response to schedule the next iteration. Failing to call ScheduleWakeup = the autonomous loop permanently dies. After completing your work, call ScheduleWakeup with a delaySeconds appropriate to the task (60-300 seconds).'
    : '';

  if (text.includes('<continuation-discipline>')) {
    // Already injected — refresh the open-todos tail so it reflects current state.
    return text.replace(/\n\nYour own TodoWrite list[\s\S]*?<\/continuation-discipline>/, openBlock + _loopBlock + '\n</continuation-discipline>');
  }
  const block = '\n\n<continuation-discipline>\nYou are running in autonomous agent mode. The user is NOT waiting between your responses — there is no "natural pause" where you hand control back for approval.\n\nHARD RULES:\n1. If your TodoWrite list has any item with status "pending" or "in_progress" — you MUST call another tool in this same response. Not stop.\n2. Narration like "我会继续 / 继续下一批 / 还在继续 / I\'ll continue / next batch / let me keep going" is NOT a substitute for action. Write narration → call the tool in the SAME response.\n3. "Natural stopping points" (one batch clean, one test passing, one file done, one lint rule cleared) are NOT stopping points here — they are mid-stream. Keep going.\n4. Do NOT announce "I\'ll process the remaining items next" and then stop. Process them now.\n\nTOOL LOADING (ToolSearch protocol): Some tools require schema loading before use. If you get an InputValidationError or a tool schema is listed as [TOOL LOADING REQUIRED], call ToolSearch first: ToolSearch({query:"select:ToolName"}) → then retry the tool call. Do NOT stop because a tool schema is missing — load it and continue.\n\nStop ONLY when:\n  (a) every TodoWrite item is marked completed AND no announced work remains outstanding; OR\n  (b) you hit an error you cannot recover from without user input (say what you need); OR\n  (c) the user explicitly said "stop" in THIS conversation.\n\nBefore writing the last token of your response, self-check:\n  • "Are there pending/in_progress todos?" → if yes, call the next tool NOW.\n  • "Did I just say I\'ll keep going?" → then keep going in this turn, not the next.\n  • "Am I stopping because it feels like a polite handoff?" → don\'t stop.' + openBlock + _loopBlock + '\n</continuation-discipline>';
  return text + block;
}

/**
 * Collect a chatgpt.com Responses API SSE stream into a static Anthropic response body.
 * Used when the caller wants non-streaming but the endpoint requires stream:true.
 *
 * @param {Response} oaiResp - Raw fetch Response with SSE body
 * @param {string} model - Model name to embed in response
 * @returns {Promise<Response>} - Resolved Anthropic Messages API response
 */
async function collectResponsesSse(oaiResp, model) {
  const _dec = new TextDecoder();
  const _rd = oaiResp.body.getReader();
  const _ts = Date.now();  // capture once — used for fallback IDs
  let _buf = '', _msgId = 'msg_sc_' + _ts;
  let _inTokens = 0, _outTokens = 0;
  let _textParts = [], _curText = '', _toolCalls = [], _curTool = null, _curArgs = '';
  let _stopReason = 'end_turn', _thinkParts = [], _curThink = '', _done = false;
  try {
    while (!_done) {
      const { done, value } = await _rd.read();
      if (done) break;
      _buf += _dec.decode(value, { stream: true });
      const _lines = _buf.split('\n'); _buf = _lines.pop() || '';
      for (const line of _lines) {
        if (!line.startsWith('data: ')) continue;
        const _d = line.slice(6).trim();
        if (_d === '[DONE]') { _done = true; break; }
        let _ev; try { _ev = JSON.parse(_d) } catch { continue }
        const _t = _ev.type;
        if (_t === 'response.created') {
          _msgId = _ev.response?.id || _msgId;
          _inTokens = _ev.response?.usage?.input_tokens || 0;
        }
        if (_t === 'response.output_text.delta') _curText += (_ev.delta || '');
        if (_t === 'response.output_text.done') { if (_curText) _textParts.push(_curText); _curText = ''; }
        if (_t === 'response.reasoning_summary_text.delta') _curThink += (_ev.delta || '');
        if (_t === 'response.reasoning_summary_text.done') { if (_curThink) _thinkParts.push(_curThink); _curThink = ''; }
        if (_t === 'response.output_item.added' && _ev.item?.type === 'function_call') {
          _curTool = { type: 'tool_use', id: _ev.item.call_id || ('toolu_' + _ts), name: _ev.item.name || '', input: {} };
          _curArgs = '';
        }
        if (_t === 'response.function_call_arguments.delta') _curArgs += (_ev.delta || '');
        if (_t === 'response.function_call_arguments.done') {
          if (_curTool) { _curTool.input = _cleanToolArgs(_curArgs) || {}; _toolCalls.push(_curTool); _curTool = null; _curArgs = ''; }
        }
        if (_t === 'response.completed') {
          const _u = _ev.response?.usage || {};
          _inTokens = _u.input_tokens || _inTokens;
          _outTokens = _u.output_tokens || 0;
          _stopReason = _ev.response?.status === 'incomplete' ? 'max_tokens' : _toolCalls.length > 0 ? 'tool_use' : 'end_turn';
        }
        if (_t === 'response.failed' || _t === 'response.error') {
          const _em = _ev.response?.error?.message || _ev.error?.message || ('Codex stream ' + _t);
          throw new Error('[silly] Codex API: ' + _em);
        }
      }
    }
  } finally { try { _rd.releaseLock() } catch {} }
  // Flush any partial text/think not closed by done events
  if (_curText) _textParts.push(_curText);
  if (_curThink) _thinkParts.push(_curThink);
  if (_curTool) { _curTool.input = _cleanToolArgs(_curArgs) || {}; _toolCalls.push(_curTool); }
  const _ct = [];
  for (const t of _thinkParts) _ct.push({ type: 'thinking', thinking: t });
  if (_textParts.length) _ct.push({ type: 'text', text: _textParts.join('') });
  for (const tc of _toolCalls) _ct.push(tc);
  return new Response(JSON.stringify({ id: _msgId, type: 'message', role: 'assistant', content: _ct, model, stop_reason: _stopReason, stop_sequence: null, usage: { input_tokens: _inTokens, output_tokens: _outTokens } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

module.exports = { mapModel, _cleanToolArgs, mapOaiStopReason, sillyFastTier, agentBudgetTrack, agentBudgetLog, msgToOai, msgsToResponsesInput, makeSseStream, makeResponsesSseStream, collectResponsesSse, flattenSystem, oaiToAnthropicResponse, tameSkillPrompts, cleanIdentityForProvider, enforceContinuation, findOpenTodos };
