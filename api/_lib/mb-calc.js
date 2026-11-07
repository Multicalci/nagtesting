// ============================================================================
// mb-calc.js — STEP 34: the expression language of the flowsheet calculator
// blocks. A small, safe arithmetic language — no access to JavaScript, no
// loops, numbers only — parsed by recursive descent into a tree and
// evaluated against a table of variables.
//
//   program    statements separated by new lines or ';'
//              name = expression            (assignment)
//              # comment   // comment
//   expression numbers (1, 2.5, 1e-3), variables, + − * / % ^ (power,
//              right-associative), unary − and +, ( … ),
//              comparisons < <= > >= == != (true = 1, false = 0),
//              and, or, not
//   functions  sqrt exp ln log log10 abs min max pow sin cos tan asin acos
//              atan atan2 sinh cosh tanh floor ceil round sign hypot
//              clamp(x, lo, hi)   if(condition, a, b)   (lazy)
//   constants  pi, e, g (9.80665 m/s²), R (8.314462618 J/mol·K)
//
// Every value must stay finite: a division by zero or ln of a negative
// number stops the calculator with the line number.
//
// Plain ES module, no dependencies. (c) multicalci.com
// ============================================================================

export const CALC_VERSION = 'mb-calc 1.0.0';
export const CALC_LIMITS = { chars: 6000, statements: 200, depth: 60 };

const FUNCS = {
  sqrt: [1, Math.sqrt], exp: [1, Math.exp], ln: [1, Math.log], log: [1, Math.log], log10: [1, Math.log10], abs: [1, Math.abs],
  sin: [1, Math.sin], cos: [1, Math.cos], tan: [1, Math.tan], asin: [1, Math.asin], acos: [1, Math.acos], atan: [1, Math.atan],
  sinh: [1, Math.sinh], cosh: [1, Math.cosh], tanh: [1, Math.tanh], floor: [1, Math.floor], ceil: [1, Math.ceil],
  round: [1, Math.round], sign: [1, Math.sign],
  pow: [2, Math.pow], atan2: [2, Math.atan2], hypot: [-2, Math.hypot],
  min: [-1, Math.min], max: [-1, Math.max],
  clamp: [3, (x, lo, hi) => Math.min(Math.max(x, lo), hi)],
  if: [3, null],
};
const CONSTS = { pi: Math.PI, e: Math.E, g: 9.80665, R: 8.314462618 };
const WORDS = new Set(['and', 'or', 'not']);
export const RESERVED = new Set([...Object.keys(FUNCS), ...Object.keys(CONSTS), ...WORDS]);
export const FUNCTION_NAMES = Object.keys(FUNCS);

class CalcError extends Error { constructor(msg, line) { super(line ? `line ${line}: ${msg}` : msg); this.line = line || null; } }

function tokenize(src) {
  const toks = [];
  let i = 0, line = 1;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '\n') { toks.push({ t: 'nl', line }); line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '#' || (c === '/' && src[i + 1] === '/')) { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === ';') { toks.push({ t: 'nl', line }); i++; continue; }
    if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
      toks.push({ t: 'num', v: parseFloat(m[0]), line }); i += m[0].length; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
      toks.push({ t: WORDS.has(m[0]) ? 'op' : 'id', v: m[0], line }); i += m[0].length; continue;
    }
    const two = src.slice(i, i + 2);
    if (['<=', '>=', '==', '!=', '**'].includes(two)) { toks.push({ t: 'op', v: two === '**' ? '^' : two, line }); i += 2; continue; }
    if ('+-*/%^()<>=,'.includes(c)) { toks.push({ t: 'op', v: c, line }); i++; continue; }
    throw new CalcError(`unexpected character '${c}'`, line);
  }
  toks.push({ t: 'eof', line });
  return toks;
}

/**
 * Parse a calculator program.
 * @param {string} src
 * @returns {{statements:{name:string, ast:object, line:number, refs:string[]}[]}}
 */
export function compile(src) {
  if (typeof src !== 'string') throw new CalcError('the code must be text');
  if (src.length > CALC_LIMITS.chars) throw new CalcError(`the code is longer than ${CALC_LIMITS.chars} characters`);
  const toks = tokenize(src);
  let k = 0, depth = 0;
  const peek = () => toks[k];
  const next = () => toks[k++];
  const isOp = (v) => peek().t === 'op' && peek().v === v;
  const expect = (v) => { const t = next(); if (!(t.t === 'op' && t.v === v)) throw new CalcError(`expected '${v}'${t.t === 'eof' ? ' before the end' : ''}`, t.line); };
  const deeper = (line) => { if (++depth > CALC_LIMITS.depth) throw new CalcError('expression nested too deeply', line); };
  let refs;
  const expr = () => orE();
  const bin = (sub, ops) => () => {
    let a = sub();
    while (peek().t === 'op' && ops.includes(peek().v)) { const o = next(); a = { op: o.v, a, b: sub() }; }
    return a;
  };
  const unary = () => {
    const t = peek();
    if (t.t === 'op' && (t.v === '-' || t.v === '+' || t.v === 'not')) { next(); deeper(t.line); const u = { op: t.v === '-' ? 'neg' : t.v === '+' ? 'pos' : 'not', a: unary() }; depth--; return u; }
    return power();
  };
  const power = () => {
    const a = primary();
    if (isOp('^')) { const t = next(); deeper(t.line); const r = { op: '^', a, b: unary() }; depth--; return r; }
    return a;
  };
  const primary = () => {
    const t = next();
    if (t.t === 'num') return { num: t.v };
    if (t.t === 'id') {
      if (isOp('(')) {
        next();
        const f = FUNCS[t.v];
        if (!f) throw new CalcError(`unknown function '${t.v}'`, t.line);
        const args = [];
        deeper(t.line);
        if (!isOp(')')) { args.push(expr()); while (isOp(',')) { next(); args.push(expr()); } }
        expect(')');
        depth--;
        const ar = f[0];
        if (ar > 0 && args.length !== ar) throw new CalcError(`${t.v}() takes ${ar} argument${ar > 1 ? 's' : ''}`, t.line);
        if (ar < 0 && args.length < -ar) throw new CalcError(`${t.v}() needs at least ${-ar} argument${-ar > 1 ? 's' : ''}`, t.line);
        return { fn: t.v, args, line: t.line };
      }
      if (FUNCS[t.v]) throw new CalcError(`'${t.v}' is a function — write ${t.v}( … )`, t.line);
      if (!(t.v in CONSTS)) refs.add(t.v);
      return { id: t.v, line: t.line };
    }
    if (t.t === 'op' && t.v === '(') { deeper(t.line); const e = expr(); expect(')'); depth--; return e; }
    throw new CalcError(t.t === 'eof' || t.t === 'nl' ? 'expression incomplete' : `unexpected '${t.v}'`, t.line);
  };
  const mulE = bin(unary, ['*', '/', '%']);
  const addE = bin(mulE, ['+', '-']);
  const cmpE = () => { const a = addE(); if (peek().t === 'op' && ['<', '<=', '>', '>=', '==', '!='].includes(peek().v)) { const o = next(); return { op: o.v, a, b: addE() }; } return a; };
  const andE = bin(cmpE, ['and']);
  const orE = bin(andE, ['or']);
  const statements = [];
  while (peek().t !== 'eof') {
    if (peek().t === 'nl') { next(); continue; }
    const t = next();
    if (t.t !== 'id') throw new CalcError(`a statement starts with a variable name (name = expression)`, t.line);
    if (RESERVED.has(t.v)) throw new CalcError(`'${t.v}' is reserved and cannot be assigned`, t.line);
    if (!isOp('=')) throw new CalcError(`expected '=' after '${t.v}'`, t.line);
    next();
    refs = new Set(); depth = 0;
    const ast = expr();
    if (!(peek().t === 'nl' || peek().t === 'eof')) throw new CalcError(`unexpected '${peek().v}' — one assignment per line`, peek().line);
    statements.push({ name: t.v, ast, line: t.line, refs: [...refs] });
    if (statements.length > CALC_LIMITS.statements) throw new CalcError(`more than ${CALC_LIMITS.statements} statements`, t.line);
  }
  return { statements };
}

function ev(n, env, line) {
  if (n.num !== undefined) return n.num;
  if (n.id !== undefined) {
    if (n.id in CONSTS) return CONSTS[n.id];
    if (!Object.prototype.hasOwnProperty.call(env, n.id)) throw new CalcError(`'${n.id}' has no value (import it or assign it on an earlier line)`, n.line || line);
    return env[n.id];
  }
  if (n.fn) {
    if (n.fn === 'if') return ev(n.args[0], env, line) ? ev(n.args[1], env, line) : ev(n.args[2], env, line);
    return FUNCS[n.fn][1](...n.args.map((a) => ev(a, env, line)));
  }
  const a = ev(n.a, env, line);
  switch (n.op) {
    case 'neg': return -a;
    case 'pos': return a;
    case 'not': return a ? 0 : 1;
    case 'and': return a ? (ev(n.b, env, line) ? 1 : 0) : 0;
    case 'or': return a ? 1 : (ev(n.b, env, line) ? 1 : 0);
    default: break;
  }
  const b = ev(n.b, env, line);
  switch (n.op) {
    case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return a / b; case '%': return a % b;
    case '^': return Math.pow(a, b);
    case '<': return a < b ? 1 : 0; case '<=': return a <= b ? 1 : 0; case '>': return a > b ? 1 : 0; case '>=': return a >= b ? 1 : 0;
    case '==': return a === b ? 1 : 0; case '!=': return a !== b ? 1 : 0;
    default: throw new CalcError(`unknown operator ${n.op}`, line);
  }
}

/**
 * Run a compiled program.
 * @param {{statements}} prog from compile()
 * @param {object} inputs name → number
 * @returns {object} every variable after the run (inputs included)
 */
export function run(prog, inputs) {
  const env = Object.assign(Object.create(null), inputs || {});
  for (const s of prog.statements) {
    const v = ev(s.ast, env, s.line);
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new CalcError(`${s.name} = ${v} is not a finite number`, s.line);
    env[s.name] = v;
  }
  return env;
}

/** names used before they are assigned or imported (static check) */
export function undefinedRefs(prog, known) {
  const have = new Set(known);
  const out = [];
  for (const s of prog.statements) {
    for (const r of s.refs) if (!have.has(r)) out.push({ name: r, line: s.line });
    have.add(s.name);
  }
  return out;
}

export { CalcError };
export default { CALC_VERSION, CALC_LIMITS, compile, run, undefinedRefs, RESERVED, FUNCTION_NAMES, CalcError };
