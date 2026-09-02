(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NorthStarPolarisProfessionalText = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // This is the single reviewed policy inventory for both the server authority and browser defense.
  // Rules target structured implementation text, not ordinary words that happen to name a technology.
  var UNSAFE_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
  // Inspect through the complete reviewed default-invisible inventory. This does not rewrite
  // displayed prose; it only prevents format and variation selectors from splitting a token.
  var INVISIBLE_FORMATTING_BMP = /[\u00ad\u034f\u061c\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufe00-\ufe0f\ufeff]/g;
  var INVISIBLE_FORMATTING_ASTRAL = /[\u{1bca0}-\u{1bca3}\u{1d173}-\u{1d17a}\u{e0001}\u{e0020}-\u{e007f}\u{e0100}-\u{e01ef}]/gu;
  var RULES = Object.freeze([
    Object.freeze({
      id: 'internal-error-code',
      pattern: /\b(?:POLARIS|CANONICAL|NORTHSTAR|BROWSER_FIXTURE|OPENAI|PROVIDER)_[A-Z0-9][A-Z0-9_]{2,}\b|\b(?:rate_limit_exceeded|invalid_request_error|insufficient_quota|server_error|authentication_error|permission_denied|model_not_found)\b/i
    }),
    Object.freeze({
      id: 'provider-or-internal-id',
      pattern: /\b(?:req|resp|chatcmpl|thread|run|call|file|msg)_[a-z0-9][a-z0-9_-]{2,}\b/i
    }),
    Object.freeze({ id: 'internal-contract', pattern: /\bnorthstar\.polaris\.[a-z0-9_.-]+\b/i }),
    Object.freeze({
      id: 'raw-json',
      pattern: /\{\s*"(?:[^"\\]|\\.)+"\s*:|\[\s*(?:"(?:[^"\\]|\\.)*"|-?(?:0|[1-9]\d*)(?:\.\d+)?|true|false|null|\{|\[)\s*(?:,|\])/i
    }),
    Object.freeze({
      id: 'json-schema',
      pattern: /\bjson_schema\b|\bJSON\s+Schema\b|\badditionalProperties\b|"(?:required|\$schema|properties|items)"\s*:/i
    }),
    Object.freeze({ id: 'code-fence-or-span', pattern: /```|~~~|`[^`\n]{1,500}`/ }),
    Object.freeze({
      id: 'markup',
      pattern: /<!DOCTYPE\b|<!--[\s\S]*?-->|<\?(?:xml|php)\b[\s\S]*?\?>|<\/?[A-Za-z][A-Za-z0-9:-]*(?:\s+[^<>]*?)?\/?>|<\s*\/?\s*(?:script|style|iframe|object|embed|svg|math|link|meta|img|form|input|button|section|div|span|html|body)\b[^<>]*>|&lt;\s*\/?\s*[A-Za-z][A-Za-z0-9:-]*(?:\s+[^&]*?)?&gt;/i
    }),
    Object.freeze({
      id: 'javascript-declaration',
      pattern: /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=|\bfunction\s+[A-Za-z_$][\w$]*\s*\(|\bthrow\s+new\s+[A-Za-z_$][\w$]*\s*\(|=>/
    }),
    Object.freeze({
      id: 'javascript-runtime',
      pattern: /\b(?:document|window|globalThis|console|process|module|exports|require|os|subprocess|child_process|Deno)\s*(?:\.\s*[A-Za-z_$]|\[|\()|\b(?:alert|confirm|prompt|fetch|eval|importScripts|setTimeout|setInterval)\s*\(/i
    }),
    Object.freeze({
      id: 'program-control-flow',
      pattern: /\b(?:if|for|while|switch|catch)\s*\([^\n)]*\)\s*\{|\bclass\s+[A-Za-z_$][\w$]*(?:\s+extends\s+[A-Za-z_$][\w$]*)?\s*\{/i
    }),
    Object.freeze({
      id: 'program-call-or-assignment',
      pattern: /(?:^|\n|[;:{}])\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\([^()\n]{0,300}\)\s*;|(?:^|\n)\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\([^()\n]{0,300}\)\s*;?\s*(?:$|\n)|\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*=\s*(?:new\s+|[A-Za-z_$][\w$]*\s*\(|["'`]\S[\s\S]{0,300}["'`]|\[[^\]\n]*\]|\{[^}\n]*\}|[A-Za-z_$][\w$]*\s*[+*/-]\s*[A-Za-z_$0-9])[^;\n]*;/m
    }),
    Object.freeze({
      id: 'sql-select',
      pattern: /\bselect\s+(?:distinct\s+)?[A-Za-z0-9_.*"`\[\],\s]+\s+from\s+[A-Za-z0-9_."`\[\]-]+(?:\s*(?:;|$)|\s+(?:where|join|left\s+join|right\s+join|inner\s+join|outer\s+join|group\s+by|order\s+by|having|limit|offset|union)\b)/i
    }),
    Object.freeze({
      id: 'sql-scalar-query',
      pattern: /\bselect\s+(?:-?(?:0|[1-9]\d*)(?:\.\d+)?|true|false|null|current_(?:date|time|timestamp)|version\s*\(\s*\)|count\s*\([^\n)]*\))\s*;/i
    }),
    Object.freeze({
      id: 'sql-write-or-schema',
      pattern: /\binsert\s+into\s+[A-Za-z_][\w.$"`\[\]-]*\s*(?:\([^)]*\))?\s+values\s*\(|\bupdate\s+[A-Za-z_][\w.$"`\[\]-]*\s+set\s+[A-Za-z_][\w.$"`\[\]-]*\s*=|\bdelete\s+from\s+[A-Za-z_][\w.$"`\[\]-]*(?:\s+where\b|\s*;)|\b(?:drop|alter|create|truncate)\s+(?:table|database|schema|index|view)\b/i
    }),
    Object.freeze({
      id: 'shell-network-command',
      pattern: /\b(?:curl|wget)\s+(?:https?:\/\/|-[A-Za-z]+\b)/i
    }),
    Object.freeze({
      id: 'shell-interpreter-command',
      pattern: /\b(?:powershell(?:\.exe)?|pwsh)\s+-[A-Za-z]+\b|\bcmd(?:\.exe)?\s+\/(?:c|k)\b|(?:^|[\n:;])\s*(?:bash|sh|zsh)\s+(?:-[A-Za-z]+\s+)?(?:["']|[^\s"']+\.sh\b)/i
    }),
    Object.freeze({
      id: 'shell-command',
      pattern: /\b(?:Get|Set|New|Remove|Invoke|Start|Stop|Restart|Test|Select|Where|ForEach|Import|Export|Write|Read|Add|Clear|Copy|Move|Rename|Out|Format)-[A-Z][A-Za-z]+\b|\b(?:npm|npx|yarn|pnpm)\s+(?:install|run|test|exec|audit)\b|\bgit\s+(?:clone|checkout|switch|reset|clean|push|pull|fetch|commit|status|diff|log|show|rev-parse)\b|(?:^|[\n:;])\s*(?:rm|del|erase|rmdir)\s+(?:-[A-Za-z]+|\/[A-Za-z]+|[.~\\/])|\$(?:env:)?[A-Za-z_]\w*\s*=/i
    }),
    Object.freeze({
      id: 'shell-command-line',
      pattern: /\b(?:ls\s+(?:-[A-Za-z]+|[.~\\/])|(?:cat|head|tail)\s+(?:-[A-Za-z]+\s+)?[.~\\/]|(?:grep|sed|awk|find)\s+(?:-[A-Za-z]+\s+|[.~\\/]|["'])|(?:echo|printf)\s+[^\n]*(?:>|\|)|sudo\s+[A-Za-z][\w-]*(?:\s+|$)|(?:systemctl|service)\s+(?:start|stop|restart|enable|disable|status)\b|(?:docker|podman)\s+(?:run|exec|build|pull|push|compose|rm|stop|start)\b|(?:kubectl|helm)\s+(?:get|apply|delete|create|install|upgrade|exec|logs|describe)\b|(?:ssh|scp|rsync)\s+(?:-[A-Za-z]+\s+)*(?:[\w.-]+@|[.~\\/])|(?:python(?:3)?|node|ruby|perl)\s+(?:-[A-Za-z]+\s+)*[^\s]+\.(?:py|js|mjs|cjs|rb|pl)\b|chmod\s+(?:-[A-Za-z]+\s+)*(?:[0-7]{3,4}|[ugoa]*[+=-][rwxXst]+)\s+|chown\s+(?:-[A-Za-z]+\s+)*(?:[\w.-]+(?::[\w.-]+)?)\s+)/i
    }),
    Object.freeze({
      id: 'python-source',
      pattern: /\b(?:async\s+)?def\s+[A-Za-z_]\w*\s*\([^)]*\)\s*:|(?:^|\n)\s*(?:from\s+[A-Za-z_][\w.]*\s+import\s+|import\s+[A-Za-z_][\w.]*(?:\s*,\s*[A-Za-z_][\w.]*)*(?:\s+as\s+[A-Za-z_]\w*)?\s*(?:$|\n))|\bprint\s*\([^\n)]*\)/m
    }),
    Object.freeze({
      id: 'stylesheet-source',
      pattern: /(?:^|\n)\s*(?:[.#][A-Za-z_-][\w-]*|[A-Za-z][\w-]*(?:\s+[A-Za-z][\w-]*)*)\s*\{\s*(?:--?[\w-]+|[A-Za-z-]+)\s*:\s*[^{};]+;|(?:^|\n)\s*@(?:media|supports|keyframes|font-face|import|layer)\b/im
    }),
    Object.freeze({
      id: 'compiled-language-source',
      pattern: /(?:^|\n)\s*#\s*include\s*[<"][^>"]+[>"]|(?:^|\n)\s*(?:int|void|char|double|float|bool|string)\s+[A-Za-z_]\w*\s*\([^)]*\)\s*\{/m
    }),
    Object.freeze({
      id: 'provider-body-or-header',
      pattern: /\bHTTP\/[12](?:\.\d)?\s+[45]\d{2}\b|(?:^|\n)\s*(?:x-request-id|openai-(?:organization|project|processing-ms|version)|retry-after|content-type)\s*:/i
    }),
    Object.freeze({
      id: 'stack-trace',
      pattern: /(?:^|\n)\s*at\s+\S+(?:\s+\(|:)|\b(?:TypeError|ReferenceError|SyntaxError|RangeError|URIError|EvalError):|Traceback\s+\(most\s+recent\s+call\s+last\):|Exception\s+in\s+thread/i
    }),
    Object.freeze({ id: 'uuid', pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i }),
    Object.freeze({ id: 'digest', pattern: /\b[0-9a-f]{64}\b/i })
  ]);

  function normalizedForInspection(value) {
    var normalized = typeof value.normalize === 'function' ? value.normalize('NFKC') : value;
    return normalized.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ')
      .replace(INVISIBLE_FORMATTING_BMP, '').replace(INVISIBLE_FORMATTING_ASTRAL, '');
  }

  function violation(value) {
    if (typeof value !== 'string') return 'not-string';
    if (UNSAFE_CONTROLS.test(value)) return 'unsafe-control';
    var inspected = normalizedForInspection(value);
    for (var index = 0; index < RULES.length; index += 1) {
      if (RULES[index].pattern.test(inspected)) return RULES[index].id;
    }
    return null;
  }

  return Object.freeze({
    POLICY_VERSION: 'northstar.polaris.professional-text.v2',
    isProfessionalText: function (value) { return violation(value) === null; }
  });
});
