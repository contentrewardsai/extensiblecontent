/**
 * Minimal JSON diff/patch (RFC 6902-style) for Fabric/ShotStack state trees.
 * Handles plain objects and arrays; no functions, symbols, or circular refs.
 * Exposed as window.__CFS_jsonPatch = { diff, patch }.
 */
(function (global) {
  'use strict';

  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  /**
   * Produce an array of RFC 6902-style ops that, when applied to `source`, yield `target`.
   * Walks both trees recursively. Arrays are compared index-by-index (no move detection).
   */
  function cfsJsonDiff(source, target, prefix) {
    if (prefix === undefined) prefix = '';
    if (source === target) return [];
    if (source == null && target == null) return [];

    var ops = [];

    if (Array.isArray(source) && Array.isArray(target)) {
      var maxLen = Math.max(source.length, target.length);
      for (var i = 0; i < maxLen; i++) {
        var p = prefix + '/' + i;
        if (i >= source.length) {
          ops.push({ op: 'add', path: p, value: deepClone(target[i]) });
        } else if (i >= target.length) {
          // Remove from end first (collected below)
        } else if (!deepEqual(source[i], target[i])) {
          if (isObj(source[i]) && isObj(target[i])) {
            ops = ops.concat(cfsJsonDiff(source[i], target[i], p));
          } else if (Array.isArray(source[i]) && Array.isArray(target[i])) {
            ops = ops.concat(cfsJsonDiff(source[i], target[i], p));
          } else {
            ops.push({ op: 'replace', path: p, value: deepClone(target[i]) });
          }
        }
      }
      if (target.length < source.length) {
        for (var r = source.length - 1; r >= target.length; r--) {
          ops.push({ op: 'remove', path: prefix + '/' + r });
        }
      }
      return ops;
    }

    if (isObj(source) && isObj(target)) {
      var allKeys = {};
      var k;
      for (k in source) if (Object.prototype.hasOwnProperty.call(source, k)) allKeys[k] = true;
      for (k in target) if (Object.prototype.hasOwnProperty.call(target, k)) allKeys[k] = true;
      var keys = Object.keys(allKeys);
      for (var j = 0; j < keys.length; j++) {
        k = keys[j];
        var p2 = prefix + '/' + escapePointer(k);
        var inS = Object.prototype.hasOwnProperty.call(source, k);
        var inT = Object.prototype.hasOwnProperty.call(target, k);
        if (inS && !inT) {
          ops.push({ op: 'remove', path: p2 });
        } else if (!inS && inT) {
          ops.push({ op: 'add', path: p2, value: deepClone(target[k]) });
        } else if (!deepEqual(source[k], target[k])) {
          if (isObj(source[k]) && isObj(target[k])) {
            ops = ops.concat(cfsJsonDiff(source[k], target[k], p2));
          } else if (Array.isArray(source[k]) && Array.isArray(target[k])) {
            ops = ops.concat(cfsJsonDiff(source[k], target[k], p2));
          } else {
            ops.push({ op: 'replace', path: p2, value: deepClone(target[k]) });
          }
        }
      }
      return ops;
    }

    // Primitive or type mismatch at root
    ops.push({ op: 'replace', path: prefix || '', value: deepClone(target) });
    return ops;
  }

  /**
   * Deep-clone obj, apply ops array, return result.
   */
  function cfsJsonPatch(obj, ops) {
    var result = deepClone(obj);
    if (!Array.isArray(ops) || !ops.length) return result;
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      var path = op.path || '';
      var tokens = parsePath(path);
      if (op.op === 'replace') {
        setAtPath(result, tokens, deepClone(op.value));
      } else if (op.op === 'add') {
        addAtPath(result, tokens, deepClone(op.value));
      } else if (op.op === 'remove') {
        removeAtPath(result, tokens);
      }
    }
    return result;
  }

  function escapePointer(s) {
    return String(s).replace(/~/g, '~0').replace(/\//g, '~1');
  }

  function unescapePointer(s) {
    return String(s).replace(/~1/g, '/').replace(/~0/g, '~');
  }

  function parsePath(path) {
    if (!path || path === '') return [];
    if (path.charAt(0) === '/') path = path.slice(1);
    return path.split('/').map(unescapePointer);
  }

  function resolveParent(root, tokens) {
    var node = root;
    for (var i = 0; i < tokens.length - 1; i++) {
      var t = tokens[i];
      if (Array.isArray(node)) node = node[Number(t)];
      else node = node[t];
      if (node == null) return null;
    }
    return node;
  }

  function setAtPath(root, tokens, value) {
    if (!tokens.length) return;
    var parent = resolveParent(root, tokens);
    if (parent == null) return;
    var key = tokens[tokens.length - 1];
    if (Array.isArray(parent)) parent[Number(key)] = value;
    else parent[key] = value;
  }

  function addAtPath(root, tokens, value) {
    if (!tokens.length) return;
    var parent = resolveParent(root, tokens);
    if (parent == null) return;
    var key = tokens[tokens.length - 1];
    if (Array.isArray(parent)) {
      var idx = (key === '-') ? parent.length : Number(key);
      parent.splice(idx, 0, value);
    } else {
      parent[key] = value;
    }
  }

  function removeAtPath(root, tokens) {
    if (!tokens.length) return;
    var parent = resolveParent(root, tokens);
    if (parent == null) return;
    var key = tokens[tokens.length - 1];
    if (Array.isArray(parent)) parent.splice(Number(key), 1);
    else delete parent[key];
  }

  function deepClone(v) {
    if (v == null || typeof v !== 'object') return v;
    try { return JSON.parse(JSON.stringify(v)); } catch (_) { return v; }
  }

  function deepEqual(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (typeof a !== typeof b) return false;
    if (typeof a !== 'object') return false;
    var aArr = Array.isArray(a), bArr = Array.isArray(b);
    if (aArr !== bArr) return false;
    if (aArr) {
      if (a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) {
        if (!deepEqual(a[i], b[i])) return false;
      }
      return true;
    }
    var aKeys = Object.keys(a), bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (var j = 0; j < aKeys.length; j++) {
      var k = aKeys[j];
      if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
      if (!deepEqual(a[k], b[k])) return false;
    }
    return true;
  }

  global.__CFS_jsonPatch = {
    diff: cfsJsonDiff,
    patch: cfsJsonPatch,
  };
})(typeof window !== 'undefined' ? window : globalThis);
