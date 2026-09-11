import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { classifySchema, derefSchema } from './schema-walk.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../../..');

function readSchema() {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, 'scripts/create-video/config.schema.json'), 'utf8'));
}

function walkFields(schema, visitor, node = schema, fieldPath = []) {
  const { node: resolved } = derefSchema(node, schema);
  if (!isPlainObject(resolved) || !isPlainObject(resolved.properties)) {
    return;
  }

  for (const [key, child] of Object.entries(resolved.properties)) {
    const childPath = [...fieldPath, key];
    visitor(child, childPath);
    const kind = classifySchema(child, childPath, schema);
    if (kind === 'object' || kind === 'box') {
      walkFields(schema, visitor, child, childPath);
    }
  }
}

describe('schema walk classification', () => {
  it('classifies every rendered schema field without unknown nodes', () => {
    const schema = readSchema();
    const unknown = [];

    walkFields(schema, (node, fieldPath) => {
      if (fieldPath[0] === '$schema') {
        return;
      }
      const kind = classifySchema(node, fieldPath, schema);
      if (kind === 'unknown') {
        unknown.push(fieldPath.join('.'));
      }
    });

    assert.deepEqual(unknown, []);
  });

  it('keeps the special createVideo controls on their dedicated kinds', () => {
    const schema = readSchema();

    assert.equal(classifySchema(schema.properties.telops.properties.title.properties.color, ['telops', 'title', 'color'], schema), 'color');
    assert.equal(classifySchema(schema.properties.telops.properties.title.properties.align, ['telops', 'title', 'align'], schema), 'align');
    assert.equal(classifySchema(schema.properties.telops.properties.title.properties.size, ['telops', 'title', 'size'], schema), 'size');
    assert.equal(classifySchema(schema.properties.telops.properties.title.properties.fade, ['telops', 'title', 'fade'], schema), 'fade');
    assert.equal(classifySchema(schema.properties.telops.properties.title.properties.font, ['telops', 'title', 'font'], schema), 'nullable');
    assert.equal(classifySchema(schema.properties.telops.properties.title.properties.box, ['telops', 'title', 'box'], schema), 'box');
  });
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}
