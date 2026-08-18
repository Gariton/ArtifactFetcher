import assert from 'node:assert/strict';
import test from 'node:test';
import { ByteBudget } from '../src/lib/resourceLimits';

test('ByteBudget rejects a bundle as soon as its cumulative size exceeds the limit', () => {
    const budget = new ByteBudget(10);
    budget.consume(4);
    budget.consume(6);
    assert.equal(budget.used, 10);
    assert.throws(() => budget.consume(1), /size exceeds limit/);
});
