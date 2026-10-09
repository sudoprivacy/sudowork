export type OntologyQualityRuleScalar = string | number | boolean | null;

export type OntologyQualityRuleExpressionErrorCode =
  | "empty"
  | "unexpected_token"
  | "unknown_attribute";

export interface IOntologyQualityRuleExpressionValidation {
  isValid: boolean;
  referencedAttributes: string[];
  errorCode?: OntologyQualityRuleExpressionErrorCode;
  errorMessage?: string;
  errorToken?: string;
  errorPosition?: number;
}

export interface ICompiledOntologyQualityRuleExpression {
  referencedAttributes: string[];
  evaluate: (values: Readonly<Record<string, unknown>>) => boolean;
}

type TokenType =
  | "word"
  | "number"
  | "string"
  | "operator"
  | "leftParen"
  | "rightParen"
  | "comma"
  | "eof";

interface IToken {
  type: TokenType;
  value: string;
  position: number;
}

type Operand =
  | { type: "attribute"; name: string }
  | { type: "literal"; value: OntologyQualityRuleScalar };

type ExpressionNode =
  | { type: "and"; left: ExpressionNode; right: ExpressionNode }
  | { type: "or"; left: ExpressionNode; right: ExpressionNode }
  | { type: "not"; expression: ExpressionNode }
  | { type: "null_check"; operand: Operand; isNegated: boolean }
  | {
      type: "comparison";
      left: Operand;
      operator: "=" | "!=" | "<>" | ">" | ">=" | "<" | "<=";
      right: Operand;
    }
  | { type: "in"; operand: Operand; values: Operand[]; isNegated: boolean }
  | { type: "like"; operand: Operand; pattern: Operand; isNegated: boolean };

export class OntologyQualityRuleExpressionError extends Error {
  constructor(
    readonly code: OntologyQualityRuleExpressionErrorCode,
    message: string,
    readonly position: number,
    readonly token?: string,
  ) {
    super(message);
    this.name = "OntologyQualityRuleExpressionError";
  }
}

export function compileQualityRuleExpression(
  expression: string,
  allowedAttributes?: Iterable<string>,
): ICompiledOntologyQualityRuleExpression {
  const trimmed = expression.trim();
  if (!trimmed) {
    throw new OntologyQualityRuleExpressionError(
      "empty",
      "Quality rule expression is required.",
      0,
    );
  }
  const parsed = new QualityRuleParser(tokenize(trimmed)).parse();
  const references = collectReferences(parsed);
  const allowedByLowercase = allowedAttributes
    ? new Map(
        Array.from(allowedAttributes, (attribute) => [
          attribute.toLowerCase(),
          attribute,
        ]),
      )
    : null;
  const normalizedReferences = references.map((attribute) => {
    if (!allowedByLowercase) return attribute;
    const normalized = allowedByLowercase.get(attribute.toLowerCase());
    if (!normalized) {
      throw new OntologyQualityRuleExpressionError(
        "unknown_attribute",
        `Unknown ontology attribute "${attribute}".`,
        0,
        attribute,
      );
    }
    return normalized;
  });
  const attributeAliases = new Map(
    normalizedReferences.map((attribute, index) => [
      references[index].toLowerCase(),
      attribute,
    ]),
  );
  return {
    referencedAttributes: [...new Set(normalizedReferences)],
    evaluate: (values) =>
      evaluateExpression(parsed, values, attributeAliases) === true,
  };
}

export function validateQualityRuleExpression(
  expression: string,
  allowedAttributes?: Iterable<string>,
): IOntologyQualityRuleExpressionValidation {
  try {
    const compiled = compileQualityRuleExpression(
      expression,
      allowedAttributes,
    );
    return {
      isValid: true,
      referencedAttributes: compiled.referencedAttributes,
    };
  } catch (error) {
    if (error instanceof OntologyQualityRuleExpressionError) {
      return {
        isValid: false,
        referencedAttributes: [],
        errorCode: error.code,
        errorMessage: error.message,
        errorToken: error.token,
        errorPosition: error.position,
      };
    }
    throw error;
  }
}

class QualityRuleParser {
  private index = 0;

  constructor(private readonly tokens: IToken[]) {}

  parse(): ExpressionNode {
    const expression = this.parseOr();
    this.expect("eof");
    return expression;
  }

  private parseOr(): ExpressionNode {
    let expression = this.parseAnd();
    while (this.matchWord("OR")) {
      expression = { type: "or", left: expression, right: this.parseAnd() };
    }
    return expression;
  }

  private parseAnd(): ExpressionNode {
    let expression = this.parseNot();
    while (this.matchWord("AND")) {
      expression = { type: "and", left: expression, right: this.parseNot() };
    }
    return expression;
  }

  private parseNot(): ExpressionNode {
    if (this.matchWord("NOT"))
      return { type: "not", expression: this.parseNot() };
    if (this.match("leftParen")) {
      const expression = this.parseOr();
      this.expect("rightParen");
      return expression;
    }
    return this.parsePredicate();
  }

  private parsePredicate(): ExpressionNode {
    const operand = this.parseOperand(true);
    if (this.matchWord("IS")) {
      const isNegated = this.matchWord("NOT");
      this.expectWord("NULL");
      return { type: "null_check", operand, isNegated };
    }
    const isNegated = this.matchWord("NOT");
    if (this.matchWord("IN")) {
      this.expect("leftParen");
      const values = [this.parseOperand(false)];
      while (this.match("comma")) values.push(this.parseOperand(false));
      this.expect("rightParen");
      return { type: "in", operand, values, isNegated };
    }
    if (this.matchWord("LIKE")) {
      return {
        type: "like",
        operand,
        pattern: this.parseOperand(false),
        isNegated,
      };
    }
    if (isNegated)
      this.fail(this.current(), 'Expected "IN" or "LIKE" after "NOT".');
    const operator = this.expect("operator").value as Extract<
      ExpressionNode,
      { type: "comparison" }
    >["operator"];
    return {
      type: "comparison",
      left: operand,
      operator,
      right: this.parseOperand(false),
    };
  }

  private parseOperand(isAttributeRequired: boolean): Operand {
    const token = this.current();
    if (token.type === "word") {
      this.index += 1;
      const keyword = token.value.toUpperCase();
      if (!isAttributeRequired && keyword === "NULL")
        return { type: "literal", value: null };
      if (!isAttributeRequired && keyword === "TRUE")
        return { type: "literal", value: true };
      if (!isAttributeRequired && keyword === "FALSE")
        return { type: "literal", value: false };
      if (["AND", "OR", "NOT", "IS", "IN", "LIKE"].includes(keyword)) {
        this.fail(token, `Unexpected keyword "${token.value}".`);
      }
      return { type: "attribute", name: token.value };
    }
    if (!isAttributeRequired && token.type === "number") {
      this.index += 1;
      return { type: "literal", value: Number(token.value) };
    }
    if (!isAttributeRequired && token.type === "string") {
      this.index += 1;
      return { type: "literal", value: token.value };
    }
    this.fail(
      token,
      isAttributeRequired
        ? "Expected an ontology attribute code."
        : "Expected an attribute or literal value.",
    );
  }

  private current(): IToken {
    return this.tokens[this.index];
  }

  private match(type: TokenType): boolean {
    if (this.current().type !== type) return false;
    this.index += 1;
    return true;
  }

  private matchWord(value: string): boolean {
    const token = this.current();
    if (token.type !== "word" || token.value.toUpperCase() !== value)
      return false;
    this.index += 1;
    return true;
  }

  private expect(type: TokenType): IToken {
    const token = this.current();
    if (token.type !== type) this.fail(token, `Expected ${tokenLabel(type)}.`);
    this.index += 1;
    return token;
  }

  private expectWord(value: string): void {
    const token = this.current();
    if (!this.matchWord(value)) this.fail(token, `Expected "${value}".`);
  }

  private fail(token: IToken, message: string): never {
    throw new OntologyQualityRuleExpressionError(
      "unexpected_token",
      message,
      token.position,
      token.value || undefined,
    );
  }
}

function tokenize(expression: string): IToken[] {
  const tokens: IToken[] = [];
  let position = 0;
  while (position < expression.length) {
    const character = expression[position];
    if (/\s/.test(character)) {
      position += 1;
      continue;
    }
    if (character === "(") {
      tokens.push({ type: "leftParen", value: character, position });
      position += 1;
      continue;
    }
    if (character === ")") {
      tokens.push({ type: "rightParen", value: character, position });
      position += 1;
      continue;
    }
    if (character === ",") {
      tokens.push({ type: "comma", value: character, position });
      position += 1;
      continue;
    }
    const operator = expression
      .slice(position)
      .match(/^(?:>=|<=|!=|<>|=|>|<)/)?.[0];
    if (operator) {
      tokens.push({ type: "operator", value: operator, position });
      position += operator.length;
      continue;
    }
    if (character === "'" || character === '"') {
      const quote = character;
      const start = position;
      let value = "";
      let isClosed = false;
      position += 1;
      while (position < expression.length) {
        const current = expression[position];
        if (current === quote) {
          if (expression[position + 1] === quote) {
            value += quote;
            position += 2;
            continue;
          }
          position += 1;
          isClosed = true;
          break;
        }
        if (current === "\\" && position + 1 < expression.length) {
          value += expression[position + 1];
          position += 2;
          continue;
        }
        value += current;
        position += 1;
      }
      if (!isClosed)
        throw new OntologyQualityRuleExpressionError(
          "unexpected_token",
          "Unterminated string literal.",
          start,
          quote,
        );
      tokens.push({ type: "string", value, position: start });
      continue;
    }
    const number = expression
      .slice(position)
      .match(/^-?(?:\d+(?:\.\d*)?|\.\d+)/)?.[0];
    if (number) {
      tokens.push({ type: "number", value: number, position });
      position += number.length;
      continue;
    }
    const word = expression
      .slice(position)
      .match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0];
    if (word) {
      tokens.push({ type: "word", value: word, position });
      position += word.length;
      continue;
    }
    throw new OntologyQualityRuleExpressionError(
      "unexpected_token",
      `Unexpected token "${character}".`,
      position,
      character,
    );
  }
  tokens.push({ type: "eof", value: "", position: expression.length });
  return tokens;
}

function collectReferences(expression: ExpressionNode): string[] {
  const references: string[] = [];
  const visitOperand = (operand: Operand) => {
    if (operand.type === "attribute") references.push(operand.name);
  };
  const visit = (node: ExpressionNode): void => {
    if (node.type === "and" || node.type === "or") {
      visit(node.left);
      visit(node.right);
    } else if (node.type === "not") {
      visit(node.expression);
    } else if (node.type === "null_check") {
      visitOperand(node.operand);
    } else if (node.type === "comparison") {
      visitOperand(node.left);
      visitOperand(node.right);
    } else if (node.type === "in") {
      visitOperand(node.operand);
      node.values.forEach(visitOperand);
    } else {
      visitOperand(node.operand);
      visitOperand(node.pattern);
    }
  };
  visit(expression);
  return [...new Set(references)];
}

function evaluateExpression(
  expression: ExpressionNode,
  values: Readonly<Record<string, unknown>>,
  attributeAliases: ReadonlyMap<string, string>,
): boolean | null {
  if (expression.type === "and") {
    const left = evaluateExpression(expression.left, values, attributeAliases);
    const right = evaluateExpression(
      expression.right,
      values,
      attributeAliases,
    );
    if (left === false || right === false) return false;
    return left === null || right === null ? null : true;
  }
  if (expression.type === "or") {
    const left = evaluateExpression(expression.left, values, attributeAliases);
    const right = evaluateExpression(
      expression.right,
      values,
      attributeAliases,
    );
    if (left === true || right === true) return true;
    return left === null || right === null ? null : false;
  }
  if (expression.type === "not") {
    const value = evaluateExpression(
      expression.expression,
      values,
      attributeAliases,
    );
    return value === null ? null : !value;
  }
  if (expression.type === "null_check") {
    const value = operandValue(expression.operand, values, attributeAliases);
    return expression.isNegated
      ? value !== null && value !== undefined
      : value === null || value === undefined;
  }
  if (expression.type === "comparison") {
    return compareValues(
      operandValue(expression.left, values, attributeAliases),
      operandValue(expression.right, values, attributeAliases),
      expression.operator,
    );
  }
  if (expression.type === "in") {
    const value = operandValue(expression.operand, values, attributeAliases);
    if (value === null || value === undefined) return null;
    const comparisons = expression.values.map((item) =>
      compareValues(value, operandValue(item, values, attributeAliases), "="),
    );
    const isIncluded = comparisons.includes(true);
    if (!isIncluded && comparisons.includes(null)) return null;
    return expression.isNegated ? !isIncluded : isIncluded;
  }
  const value = operandValue(expression.operand, values, attributeAliases);
  const pattern = operandValue(expression.pattern, values, attributeAliases);
  if (
    value !== null &&
    value !== undefined &&
    pattern !== null &&
    pattern !== undefined
  ) {
    const isMatch = likePattern(String(pattern)).test(String(value));
    return expression.isNegated ? !isMatch : isMatch;
  }
  return null;
}

function operandValue(
  operand: Operand,
  values: Readonly<Record<string, unknown>>,
  attributeAliases: ReadonlyMap<string, string>,
): unknown {
  if (operand.type === "literal") return operand.value;
  const attribute =
    attributeAliases.get(operand.name.toLowerCase()) ?? operand.name;
  return values[attribute];
}

function compareValues(
  left: unknown,
  right: unknown,
  operator: Extract<ExpressionNode, { type: "comparison" }>["operator"],
): boolean | null {
  if (
    left === null ||
    left === undefined ||
    right === null ||
    right === undefined
  )
    return null;
  const [normalizedLeft, normalizedRight] = normalizeComparablePair(
    left,
    right,
  );
  if (operator === "=") return normalizedLeft === normalizedRight;
  if (operator === "!=" || operator === "<>")
    return normalizedLeft !== normalizedRight;
  if (operator === ">") return normalizedLeft > normalizedRight;
  if (operator === ">=") return normalizedLeft >= normalizedRight;
  if (operator === "<") return normalizedLeft < normalizedRight;
  return normalizedLeft <= normalizedRight;
}

function normalizeComparablePair(
  left: unknown,
  right: unknown,
): [string | number | boolean, string | number | boolean] {
  if (typeof left === "number" || typeof right === "number") {
    const leftNumber = numericValue(left);
    const rightNumber = numericValue(right);
    if (leftNumber !== null && rightNumber !== null)
      return [leftNumber, rightNumber];
  }
  if (typeof left === "boolean" || typeof right === "boolean") {
    const leftBoolean = booleanValue(left);
    const rightBoolean = booleanValue(right);
    if (leftBoolean !== null && rightBoolean !== null)
      return [leftBoolean, rightBoolean];
  }
  return [String(left), String(right)];
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;
  return null;
}

function likePattern(pattern: string): RegExp {
  const source = Array.from(pattern)
    .map((character) => {
      if (character === "%") return ".*";
      if (character === "_") return ".";
      return character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  return new RegExp(`^${source}$`, "s");
}

function tokenLabel(type: TokenType): string {
  if (type === "leftParen") return '"("';
  if (type === "rightParen") return '")"';
  if (type === "comma") return '","';
  if (type === "operator") return "a comparison operator";
  if (type === "eof") return "the end of the expression";
  return type;
}
