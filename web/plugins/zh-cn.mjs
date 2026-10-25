// Build-time UI localization for the Agent Vault web client.
//
// The upstream project has no i18n layer and hard-codes English copy across
// ~55 TSX files. Translating the source in place would make every future
// upstream merge conflict. Instead this Vite plugin rewrites display strings
// during the build using a dictionary, leaving the checked-in source as close
// to upstream as possible.
//
// It only touches:
//   - JSX text nodes
//   - display-only attributes (placeholder/title/aria-label/alt/label/description)
//   - display object properties (label/header/description/...)
//   - arguments to user-facing helpers (toast/setError/alert/...)
//   - standalone string literals that look like sentences
//
// API payload values, object keys, imports, routes, class names and other
// logic strings are never rewritten.

import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
import generateModule from "@babel/generator";
import dict from "./zh-cn-dict.mjs";

const traverse = traverseModule.default ?? traverseModule;
const generate = generateModule.default ?? generateModule;

const DISPLAY_ATTRS = new Set([
  "placeholder",
  "title",
  "aria-label",
  "alt",
  "label",
  "description",
  "emptyMessage",
  "emptyText",
  "emptyTitle",
  "emptyDescription",
  "confirmText",
  "cancelText",
  "confirmLabel",
  "successText",
  "successMessage",
  "errorText",
  "inputLabel",
  "helperText",
  "message",
  "subtitle",
  "hint",
  "tooltip",
  "heading",
  "note",
]);

const DISPLAY_KEYS = new Set([
  "label",
  "title",
  "description",
  "placeholder",
  "header",
  "emptyText",
  "emptyMessage",
  "confirmText",
  "cancelText",
  "successText",
  "errorMessage",
  "error_title",
  "error_message",
  "subtitle",
  "hint",
  "tooltip",
  "message",
  "helpText",
  "text",
  "note",
  "heading",
  "success",
]);

// Attributes whose string values are code/data, never display copy.
const CODE_ATTRS = new Set([
  "id",
  "name",
  "value",
  "defaultValue",
  "type",
  "to",
  "href",
  "src",
  "htmlFor",
  "for",
  "role",
  "method",
  "action",
  "target",
  "rel",
  "className",
  "style",
  "key",
  "autoComplete",
  "inputMode",
  "pattern",
  "form",
  "accept",
  "download",
  "as",
  "autoFocus",
  "readOnly",
  "tabIndex",
]);

const DISPLAY_CALLS = new Set([
  "toast",
  "setError",
  "setFormError",
  "setToast",
  "setBanner",
  "alert",
  "confirm",
]);

const CJK = /[\u3400-\u9fff]/;

function zh(value) {
  if (typeof value !== "string" || !value || CJK.test(value)) return null;
  return dict[value] ?? null;
}

function translate_template(node) {
  // Only translate template literals without interpolation. Interpolated
  // messages are handled in source where the grammar needs reordering.
  if (!node || node.type !== "TemplateLiteral" || node.expressions.length > 0) {
    return false;
  }
  const quasi = node.quasis[0];
  const next = zh(quasi.value.cooked);
  if (!next) return false;
  quasi.value.cooked = next;
  quasi.value.raw = next;
  return true;
}

export default function zhCN() {
  return {
    name: "agent-vault-zh-cn",
    enforce: "pre",
    transform(code, id) {
      if (!/[\\/]src[\\/].*\.(tsx|ts)$/.test(id)) return null;

      let ast;
      try {
        ast = parse(code, {
          sourceType: "module",
          plugins: ["jsx", "typescript"],
          errorRecovery: true,
        });
      } catch {
        return null;
      }

      let changed = false;

      traverse(ast, {
        JSXText(path) {
          const raw = path.node.value;
          const trimmed = raw.trim();
          const normalized = trimmed.replace(/\s+/g, " ");
          const exact = zh(raw);
          if (exact) {
            path.node.value = exact;
            changed = true;
            return;
          }
          const next = zh(normalized) ?? zh(trimmed);
          if (!next) return;
          const lead = raw.match(/^\s*/)[0];
          const trail = raw.match(/\s*$/)[0];
          path.node.value = lead + next + trail;
          changed = true;
        },

        JSXAttribute(path) {
          if (path.node.name?.type !== "JSXIdentifier") return;
          const attr = path.node.name.name;
          if (CODE_ATTRS.has(attr) || attr.startsWith("data-")) return;
          const value = path.node.value;
          if (value?.type !== "StringLiteral") return;
          const next = zh(value.value) ?? zh(value.value.trim());
          if (!next) return;
          value.value = next;
          changed = true;
        },

        ObjectProperty(path) {
          const key = path.node.key;
          const keyName =
            key.type === "Identifier"
              ? key.name
              : key.type === "StringLiteral"
                ? key.value
                : "";
          if (!DISPLAY_KEYS.has(keyName)) return;
          const value = path.node.value;
          if (value?.type === "StringLiteral") {
            const next = zh(value.value);
            if (next) {
              value.value = next;
              changed = true;
            }
          } else if (translate_template(value)) {
            changed = true;
          }
        },

        CallExpression(path) {
          const callee = path.node.callee;
          const name =
            callee.type === "Identifier"
              ? callee.name
              : callee.type === "MemberExpression" &&
                  callee.property.type === "Identifier"
                ? callee.property.name
                : "";
          if (!DISPLAY_CALLS.has(name)) return;
          for (const arg of path.node.arguments) {
            const next = zh(arg.value);
            if (arg.type === "StringLiteral" && next) {
              arg.value = next;
              changed = true;
            } else if (translate_template(arg)) {
              changed = true;
            }
          }
        },

        StringLiteral(path) {
          const value = path.node.value;
          let next = zh(value);
          let trimmed = false;
          if (!next && value.trim() !== value) {
            next = zh(value.trim());
            trimmed = !!next;
          }
          if (!next) return;
          const parent = path.parent;
          if (
            parent.type === "ImportDeclaration" ||
            parent.type === "ExportNamedDeclaration" ||
            parent.type === "TSLiteralType"
          ) {
            return;
          }
          if (
            (parent.type === "ObjectProperty" ||
              parent.type === "ObjectMethod" ||
              parent.type === "ClassProperty") &&
            parent.key === path.node
          ) {
            return;
          }
          if (parent.type === "JSXAttribute") return;
          if (trimmed) {
            const lead = value.match(/^\s*/)[0];
            const trail = value.match(/\s*$/)[0];
            path.node.value = lead + next + trail;
          } else {
            path.node.value = next;
          }
          changed = true;
        },

        TemplateElement(path) {
          // Static fragments inside interpolated messages (e.g. " min ago",
          // "Remove ") can be translated too; whitespace is preserved so
          // spacing around CJK text stays as authored.
          const raw = path.node.value.raw;
          const cooked = path.node.value.cooked ?? raw;
          const trimmed = cooked.trim();
          const normalized = trimmed.replace(/\s+/g, " ");
          const unquoted = trimmed.replace(/^"/, "");
          const next =
            zh(cooked) ?? zh(trimmed) ?? zh(normalized) ?? zh(unquoted);
          if (!next) return;
          const lead = cooked.match(/^\s*/)[0];
          const translated = lead + next;
          path.node.value.cooked = translated;
          path.node.value.raw = translated;
          changed = true;
        },
      });

      if (!changed) return null;

      const output = generate(
        ast,
        {
          retainLines: true,
          comments: true,
          jsescOption: { minimal: true },
        },
        code
      );

      return { code: output.code, map: null };
    },
  };
}
