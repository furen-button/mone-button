const SPECIAL_DEFS = new Map([
  ['color', 'color'],
  ['align', 'align'],
  ['size', 'size'],
  ['font', 'font'],
  ['box', 'box'],
  ['fadeMs', 'fade'],
  ['fadeSec', 'fade'],
]);

export function derefSchema(node, root) {
  if (!isPlainObject(node)) {
    return { node, defName: null };
  }

  if (typeof node.$ref === 'string') {
    return resolveRef(node.$ref, root);
  }

  if (
    Array.isArray(node.allOf)
    && node.allOf.length === 1
    && isPlainObject(node.allOf[0])
    && typeof node.allOf[0].$ref === 'string'
  ) {
    return resolveRef(node.allOf[0].$ref, root);
  }

  return { node, defName: null };
}

export function classifySchema(node, path, root) {
  const derefed = derefSchema(node, root);
  const schema = derefed.node;
  if (!isPlainObject(schema)) {
    return 'unknown';
  }

  const type = schema.type;
  if (Array.isArray(type) && type.includes('null')) {
    return 'nullable';
  }

  const special = derefed.defName ? SPECIAL_DEFS.get(derefed.defName) : null;
  if (special) {
    return special;
  }

  if (Array.isArray(schema.enum)) {
    return 'enum';
  }
  if (type === 'boolean') {
    return 'boolean';
  }
  if (type === 'number' || type === 'integer') {
    return 'number';
  }
  if (type === 'array' && isPlainObject(schema.items) && schema.items.type === 'string') {
    return 'stringList';
  }
  if (
    type === 'object'
    && isPlainObject(schema.additionalProperties)
    && schema.additionalProperties.type === 'string'
    && !isPlainObject(schema.properties)
  ) {
    return 'stringMap';
  }
  if (type === 'object' && isPlainObject(schema.properties)) {
    return 'object';
  }
  if (type === 'string') {
    return 'string';
  }

  return 'unknown';
}

function resolveRef(ref, root) {
  const prefix = '#/$defs/';
  if (!ref.startsWith(prefix) || !isPlainObject(root.$defs)) {
    return { node: {}, defName: null };
  }

  const defName = ref.slice(prefix.length);
  const node = root.$defs[defName];
  return { node: isPlainObject(node) ? node : {}, defName };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}
