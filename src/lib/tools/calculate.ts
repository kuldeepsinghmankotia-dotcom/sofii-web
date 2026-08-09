// A real arithmetic evaluator, deliberately NOT eval()/Function().
//
// Two reasons this exists at all: language models are genuinely unreliable
// at multi-step arithmetic (they pattern-match plausible digits rather
// than computing), and the input here is model-generated text derived from
// user input — handing that to eval() would be straightforward remote code
// execution. This is a bounded recursive-descent parser over a fixed
// grammar: numbers, the operators below, and a closed allowlist of
// functions. Nothing else can be reached, by construction.

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  ln: Math.log,
  log: Math.log10,
  log2: Math.log2,
  exp: Math.exp,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  min: (...a) => Math.min(...a),
  max: (...a) => Math.max(...a),
  pow: (a, b) => a ** b
}

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E
}

type Token = { type: 'num'; value: number } | { type: 'name'; value: string } | { type: 'op'; value: string }

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < input.length) {
    const ch = input[i]

    if (/\s/.test(ch)) {
      i++
      continue
    }

    if (/[0-9.]/.test(ch)) {
      // Thousands separators are matched as part of the number itself
      // (1,250) rather than stripped globally. Stripping them globally
      // looked simpler but split "1,250" into two adjacent numbers, and
      // made argument commas vanish — which meant max(3, 9, 2) only
      // parsed by accident. Grouped form is tried first so the plain
      // alternative can't match just the "1" of "1,250".
      const match = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?|^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(input.slice(i))
      if (!match) throw new Error(`Malformed number at position ${i}`)
      tokens.push({ type: 'num', value: Number(match[0].replace(/,/g, '')) })
      i += match[0].length
      continue
    }

    if (/[a-zA-Z_]/.test(ch)) {
      const match = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(input.slice(i))!
      tokens.push({ type: 'name', value: match[0].toLowerCase() })
      i += match[0].length
      continue
    }

    // ',' is a real token (function argument separator), not noise.
    if ('+-*/%^(),'.includes(ch)) {
      tokens.push({ type: 'op', value: ch })
      i++
      continue
    }

    throw new Error(`Unsupported character "${ch}"`)
  }

  return tokens
}

class Parser {
  private pos = 0
  constructor(private tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos]
  }

  private eat(value: string): boolean {
    const token = this.peek()
    if (token && token.type === 'op' && token.value === value) {
      this.pos++
      return true
    }
    return false
  }

  parse(): number {
    const value = this.parseAddSub()
    if (this.pos < this.tokens.length) throw new Error('Unexpected trailing input')
    return value
  }

  private parseAddSub(): number {
    let left = this.parseMulDiv()
    for (;;) {
      if (this.eat('+')) left += this.parseMulDiv()
      else if (this.eat('-')) left -= this.parseMulDiv()
      else return left
    }
  }

  private parseMulDiv(): number {
    let left = this.parseUnary()
    for (;;) {
      if (this.eat('*')) left *= this.parseUnary()
      else if (this.eat('/')) {
        const right = this.parseUnary()
        if (right === 0) throw new Error('Division by zero')
        left /= right
      } else if (this.eat('%')) {
        const right = this.parseUnary()
        if (right === 0) throw new Error('Division by zero')
        left %= right
      } else return left
    }
  }

  private parseUnary(): number {
    if (this.eat('-')) return -this.parseUnary()
    if (this.eat('+')) return this.parseUnary()
    return this.parsePower()
  }

  // Right-associative, matching normal maths notation: 2^3^2 is 2^(3^2).
  private parsePower(): number {
    const base = this.parseAtom()
    if (this.eat('^')) return base ** this.parseUnary()
    return base
  }

  private parseAtom(): number {
    const token = this.peek()
    if (!token) throw new Error('Unexpected end of expression')

    if (token.type === 'num') {
      this.pos++
      return token.value
    }

    if (token.type === 'name') {
      this.pos++
      const name = token.value

      if (this.eat('(')) {
        const args: number[] = []
        if (!this.eat(')')) {
          for (;;) {
            args.push(this.parseAddSub())
            if (this.eat(')')) break
            if (!this.eat(',')) throw new Error(`Expected "," or ")" in call to ${name}`)
          }
        }
        const fn = FUNCTIONS[name]
        if (!fn) throw new Error(`Unknown function "${name}"`)
        return fn(...args)
      }

      if (name in CONSTANTS) return CONSTANTS[name]
      throw new Error(`Unknown name "${name}"`)
    }

    if (this.eat('(')) {
      const value = this.parseAddSub()
      if (!this.eat(')')) throw new Error('Missing closing parenthesis')
      return value
    }

    throw new Error(`Unexpected token "${token.value}"`)
  }
}

const MAX_EXPRESSION_LENGTH = 500

export function calculate(expression: string): number {
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    throw new Error('Expression is too long')
  }

  // "50% of 200" and "20% off" are how people actually write these; the
  // grammar has no notion of a trailing percent, so it's normalised to a
  // plain multiplication before parsing.
  const normalized = expression
    .replace(/(\d+(?:\.\d+)?)\s*%\s*of\s+/gi, '($1/100)*')
    .replace(/(\d+(?:\.\d+)?)\s*%/g, '($1/100)')

  const result = new Parser(tokenize(normalized)).parse()

  if (!Number.isFinite(result)) throw new Error('Result is not a finite number')
  return result
}
