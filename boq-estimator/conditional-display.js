// ============================================================================
// PATCH B — conditional_display JS-dialect support   (multicalci.com BOQ)
// ----------------------------------------------------------------------------
// WHY: 1,168 of 1,180 fields in the 114-schema library carry conditional_display
// as a RAW JS STRING, e.g.  "equipment_subtype.includes('Transformer')".
// applyConditions() read it as an object (cd.show_if), got undefined, and
// evalShowIf(undefined) returns true -> EVERY conditional field rendered for
// EVERY sub-type, and currentValues() therefore posted them. Measured effect on
// SCHEMA-TRANSFORMER-POWER: up to 6.739x overprice at T3 via legal selections
// (drive_type_factor 4.5x + cooling_factor 1.28x + fault_level_factor 1.17x
// applied to items those fields do not belong to).
//
// WHAT THIS DOES: adds a real tokeniser + recursive-descent parser for the JS
// dialect. NO eval(), NO new Function() — CSP-safe, injection-safe.
// Supported:  a.includes('x') | a.startsWith('x') | a.endsWith('x')
//             a === 'x' | a == 'x' | a !== 'x' | a != 'x'
//             a > 5 | a < 5 | a >= 5 | a <= 5
//             ! <expr> | ( grouping ) | && | ||  | bare truthiness
// Comparison semantics deliberately mirror api/boq.js evalClause(): numeric
// compare only when both sides parse as numbers AND the RHS literal is not a
// quoted string — so frequency === 50 is true for the dropdown value "50".
//
// Back-compat preserved: legacy object form {show_if, operator, value} and
// expression form {show_if:"a IN ['x','y']"} both still work unchanged.
// ============================================================================

// ── tokeniser ───────────────────────────────────────────────────────────────
function _jsxTokens(src){
  const out = [];
  let i = 0;
  while(i < src.length){
    const c = src[i];
    if(/\s/.test(c)){ i++; continue; }
    if(c === "'" || c === '"'){
      const q = c; let j = i + 1, buf = '';
      while(j < src.length && src[j] !== q){
        if(src[j] === '\\' && j + 1 < src.length){ buf += src[j+1]; j += 2; continue; }
        buf += src[j++];
      }
      if(j >= src.length) throw new Error('unterminated string');
      out.push({t:'str', v:buf}); i = j + 1; continue;
    }
    if(/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i+1] || ''))){
      let j = i; while(j < src.length && /[0-9.eE+\-]/.test(src[j])){
        if((src[j] === '+' || src[j] === '-') && !/[eE]/.test(src[j-1] || '')) break;
        j++;
      }
      out.push({t:'num', v:parseFloat(src.slice(i, j))}); i = j; continue;
    }
    if(/[A-Za-z_$]/.test(c)){
      let j = i; while(j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j++;
      out.push({t:'id', v:src.slice(i, j)}); i = j; continue;
    }
    const three = src.substr(i,3), two = src.substr(i,2);
    if(three === '===' || three === '!=='){ out.push({t:'op', v:three}); i += 3; continue; }
    if(['==','!=','>=','<=','&&','||'].includes(two)){ out.push({t:'op', v:two}); i += 2; continue; }
    if('><!().,'.includes(c)){ out.push({t:'op', v:c}); i++; continue; }
    throw new Error('unexpected character ' + JSON.stringify(c));
  }
  return out;
}

// ── evaluation helpers (mirror api/boq.js) ──────────────────────────────────
function _jsxTruthy(v){
  return v !== undefined && v !== null && v !== '' && v !== false && v !== 0;
}
function _jsxCompare(op, a, b, bIsQuoted){
  if(a === undefined || a === null || a === '') return false;
  const an = parseFloat(a), bn = parseFloat(b);
  const bothNum = Number.isFinite(an) && Number.isFinite(bn) && !bIsQuoted;
  switch(op){
    case '===': case '==': return bothNum ? an === bn : String(a) === String(b);
    case '!==': case '!=': return bothNum ? an !== bn : String(a) !== String(b);
    case '>':  return Number.isFinite(an) && Number.isFinite(bn) && an >  bn;
    case '<':  return Number.isFinite(an) && Number.isFinite(bn) && an <  bn;
    case '>=': return Number.isFinite(an) && Number.isFinite(bn) && an >= bn;
    case '<=': return Number.isFinite(an) && Number.isFinite(bn) && an <= bn;
  }
  return false;
}

// ── recursive-descent parser/evaluator ──────────────────────────────────────
function _jsxParse(tokens, values){
  let p = 0;
  const peek = () => tokens[p];
  const eat  = (v) => {
    const t = tokens[p];
    if(!t || (v !== undefined && t.v !== v)) throw new Error('expected ' + v);
    p++; return t;
  };

  function parseOr(){
    let left = parseAnd();
    while(peek() && peek().v === '||'){ eat('||'); const right = parseAnd(); left = left || right; }
    return left;
  }
  function parseAnd(){
    let left = parseUnary();
    while(peek() && peek().v === '&&'){ eat('&&'); const right = parseUnary(); left = left && right; }
    return left;
  }
  function parseUnary(){
    if(peek() && peek().v === '!'){ eat('!'); return !parseUnary(); }
    return parseCompare();
  }
  function parseCompare(){
    const left = parseOperand();
    const t = peek();
    if(t && t.t === 'op' && ['===','!==','==','!=','>','<','>=','<='].includes(t.v)){
      eat(t.v);
      const right = parseOperand();
      return _jsxCompare(t.v, left.value, right.value, right.quoted);
    }
    return left.bool !== undefined ? left.bool : _jsxTruthy(left.value);
  }
  // returns {value, quoted, bool}
  function parseOperand(){
    const t = peek();
    if(!t) throw new Error('unexpected end of expression');
    if(t.v === '('){
      eat('('); const b = parseOr(); eat(')');
      return {value: b, quoted: false, bool: b};
    }
    if(t.t === 'str'){ eat(); return {value: t.v, quoted: true}; }
    if(t.t === 'num'){ eat(); return {value: t.v, quoted: false}; }
    if(t.t === 'id'){
      eat();
      let cur = values[t.v];
      // method chain:  .includes('x') / .startsWith('x') / .endsWith('x')
      while(peek() && peek().v === '.'){
        eat('.');
        const m = eat();
        if(m.t !== 'id') throw new Error('bad method name');
        eat('(');
        const args = [];
        while(peek() && peek().v !== ')'){
          const a = parseOperand();
          args.push(a.value);
          if(peek() && peek().v === ',') eat(',');
        }
        eat(')');
        const hay = cur === undefined || cur === null ? '' : String(cur);
        const needle = args.length ? String(args[0]) : '';
        let r;
        switch(m.v){
          case 'includes':   r = hay.includes(needle); break;
          case 'startsWith': r = hay.startsWith(needle); break;
          case 'endsWith':   r = hay.endsWith(needle); break;
          case 'toLowerCase': cur = hay.toLowerCase(); continue;
          case 'toUpperCase': cur = hay.toUpperCase(); continue;
          case 'trim':        cur = hay.trim(); continue;
          default: throw new Error('unsupported method .' + m.v + '()');
        }
        return {value: r, quoted: false, bool: r};
      }
      return {value: cur, quoted: false};
    }
    throw new Error('unexpected token ' + JSON.stringify(t.v));
  }

  const result = parseOr();
  if(p !== tokens.length) throw new Error('trailing tokens');
  return !!result;
}

// Returns true/false, or null when the expression is not the JS dialect / is
// unparseable — the caller decides the fallback.
function evalJsExpr(expr, values){
  try{ return _jsxParse(_jsxTokens(String(expr)), values); }
  catch(e){ _cdWarn(String(expr), e.message); return null; }
}

// ── telemetry: surface parse failures instead of silently failing open ──────
const _cdSeen = new Set();
function _cdWarn(expr, why){
  if(_cdSeen.has(expr)) return;
  _cdSeen.add(expr);
  console.warn('[conditional_display] unparseable, field left VISIBLE:', expr, '—', why);
}

// ── unified dispatcher across all three schema forms ────────────────────────
function evalDisplay(cd, values){
  if(!cd) return true;

  // 1) legacy object form {show_if:<key>, operator, value}
  if(typeof cd === 'object' && (cd.operator !== undefined || Array.isArray(cd.value))){
    const cur = values[cd.show_if];
    const op = (cd.operator || 'in').toLowerCase();
    if(op === 'in' && Array.isArray(cd.value)) return cd.value.includes(cur);
    if(op === '==' || op === 'equals')         return String(cur) === String(cd.value);
    if(op === '!=')                            return String(cur) !== String(cd.value);
    return cur != null && cur !== '';
  }

  // 2) object expression form {show_if:"a IN ['x','y']"}  → mini-language
  if(typeof cd === 'object') return evalShowIf(cd.show_if, values);

  // 3) STRING form. Route by dialect: mini-language tokens vs JS operators.
  const s = String(cd);
  const looksJs   = /(\|\||&&|===|!==|\.\s*(includes|startsWith|endsWith)\s*\()/.test(s);
  const looksMini = /\s(IN|NOT\s+IN|AND|OR)\s/.test(s);
  if(looksJs || !looksMini){
    const r = evalJsExpr(s, values);
    if(r !== null) return r;
    return evalShowIf(s, values);   // last resort: try the mini-language
  }
  return evalShowIf(s, values);
}

// ── patched applyConditions(): dispatcher + settle loop ─────────────────────
// The settle loop matters because currentValues() drops hidden fields, so
// hiding field A can change a condition that depends on A. Capped at 4 passes;
// converges in 1 for every schema in the current library.
function applyConditions(){
  for(let pass = 0; pass < 4; pass++){
    const v = currentValues();
    let changed = false;
    FIELDS.forEach(f => {
      const cd = f.conditional_display;
      if(!cd) return;
      const holder = $('form-body').querySelector(`[data-fid="${CSS.escape(f.field_id)}"]`);
      if(!holder) return;
      const want = evalDisplay(cd, v) ? '' : 'none';
      if(holder.style.display !== want){ holder.style.display = want; changed = true; }
    });
    if(!changed) break;
  }
}
