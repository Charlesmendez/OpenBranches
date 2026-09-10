import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { productionPackages } from './notices.mjs';

describe('third-party notices', () => {
  it('walks the locked production graph with hoisted and nested dependencies', () => {
    const lock = {
      packages: {
        '': { dependencies: { alpha: '1.0.0', beta: '1.0.0' } },
        'node_modules/alpha': {
          version: '1.0.0',
          license: 'MIT',
          dependencies: { shared: '2.0.0' },
        },
        'node_modules/alpha/node_modules/shared': { version: '2.0.0', license: 'ISC' },
        'node_modules/beta': {
          version: '1.0.0',
          license: 'MIT',
          dependencies: { shared: '1.0.0' },
        },
        'node_modules/shared': { version: '1.0.0', license: 'BSD-3-Clause' },
        'node_modules/dev-only': { version: '9.0.0', license: 'MIT' },
      },
    };
    assert.deepEqual(productionPackages(lock), [
      { key: 'node_modules/alpha', name: 'alpha', version: '1.0.0', license: 'MIT' },
      {
        key: 'node_modules/beta',
        name: 'beta',
        version: '1.0.0',
        license: 'MIT',
      },
      {
        key: 'node_modules/shared',
        name: 'shared',
        version: '1.0.0',
        license: 'BSD-3-Clause',
      },
      {
        key: 'node_modules/alpha/node_modules/shared',
        name: 'shared',
        version: '2.0.0',
        license: 'ISC',
      },
    ]);
  });

  it('fails when a declared production dependency cannot be resolved', () => {
    assert.throws(
      () => productionPackages({ packages: { '': { dependencies: { missing: '1.0.0' } } } }),
      /does not resolve missing/,
    );
  });
});
