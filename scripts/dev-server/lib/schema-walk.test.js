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
    if (kind === 'object' || kind === 'box' || (kind === 'nullable' && derefSchema(child, schema).node.properties)) {
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

  it('Shorts の reframe と nullable split の内側まで分類する', () => {
    const schema = readSchema();
    const fields = new Map();
    walkFields(schema, (node, path) => fields.set(path.join('.'), classifySchema(node, path, schema)));
    assert.equal(fields.get('effects.reframe'), 'object');
    assert.equal(fields.get('effects.reframe.frames'), 'number');
    assert.equal(fields.get('effects.reframe.pick'), 'enum');
    assert.equal(fields.get('effects.reframe.target'), 'object');
    assert.equal(fields.get('effects.reframe.target.y'), 'number');
    assert.equal(fields.get('effects.reframe.maxZoom'), 'number');
    assert.equal(fields.get('effects.reframe.minFaceHeight'), 'number');
    assert.equal(fields.get('effects.reframe.fill'), 'enum');
    assert.equal(fields.get('telops.title.layout'), 'enum');
    assert.equal(fields.get('telops.serif.layout'), 'enum');
    assert.equal(fields.get('telops.title.box.anchor'), 'enum');
    assert.equal(fields.get('telops.serif.faceRange'), 'object');
    assert.equal(fields.get('telops.serif.faceRange.enabled'), 'boolean');
    assert.equal(fields.get('telops.serif.faceRange.minHeight'), 'number');
    assert.equal(fields.get('telops.serif.faceRange.maxHeight'), 'number');
    assert.equal(fields.get('telops.serif.faceRange.fallbackBottom'), 'number');
    assert.equal(fields.get('effects.reframe.x'), 'nullable');
    assert.equal(fields.get('output.split'), 'nullable');
    assert.equal(fields.get('output.split.by'), 'enum');
    assert.equal(fields.get('output.split.minSec'), 'number');
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
