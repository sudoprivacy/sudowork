import { describe, expect, it } from 'vitest';
import { compileQualityRuleExpression, validateQualityRuleExpression } from '@sudowork/ontology-common';

describe('ontology quality rule expressions', () => {
  it('evaluates SQL-style comparisons, boolean operators, and numeric CSV values', () => {
    const expression = compileQualityRuleExpression("amount > 0 AND status IN ('paid', 'pending')", ['amount', 'status']);

    expect(expression.referencedAttributes).toEqual(['amount', 'status']);
    expect(expression.evaluate({ amount: '12.5', status: 'paid' })).toBe(true);
    expect(expression.evaluate({ amount: '-1', status: 'paid' })).toBe(false);
    expect(expression.evaluate({ amount: 10, status: 'cancelled' })).toBe(false);
  });

  it('supports null checks, LIKE, NOT, parentheses, and attribute comparisons', () => {
    const expression = compileQualityRuleExpression("email IS NOT NULL AND (email LIKE '%@example.com' OR NOT score < minimum_score)", ['email', 'score', 'minimum_score']);

    expect(expression.evaluate({ email: 'a@example.com', score: 1, minimum_score: 5 })).toBe(true);
    expect(expression.evaluate({ email: 'a@other.com', score: 7, minimum_score: 5 })).toBe(true);
    expect(expression.evaluate({ email: null, score: 7, minimum_score: 5 })).toBe(false);
    expect(compileQualityRuleExpression("status NOT IN ('cancelled')", ['status']).evaluate({ status: null })).toBe(false);
  });

  it('reports unknown attributes and malformed expressions without evaluating code', () => {
    expect(validateQualityRuleExpression('missing > 0', ['amount'])).toMatchObject({
      isValid: false,
      errorCode: 'unknown_attribute',
      errorToken: 'missing',
    });
    expect(validateQualityRuleExpression('amount > 0; process.exit(1)', ['amount'])).toMatchObject({
      isValid: false,
      errorCode: 'unexpected_token',
      errorToken: ';',
    });
    expect(validateQualityRuleExpression('amount IN ()', ['amount'])).toMatchObject({
      isValid: false,
      errorCode: 'unexpected_token',
    });
  });
});
