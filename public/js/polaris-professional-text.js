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
  var TOKEN_SEPARATING_MARKS = /[\u115f\u1160\u3164\p{Cf}\p{Mn}\p{Me}]/gu;
  // Executable names are evaluated only with command syntax or an explicit execution cue.
  // Ambiguous business nouns such as branch, package, select, and run are intentionally absent;
  // runtime names such as node are considered only in explicit command contexts below.
  var EXECUTABLE_NAME = '(?:bash|sh|zsh|fish|powershell(?:\\.exe)?|pwsh|cmd(?:\\.exe)?|wsl(?:\\.exe)?' +
    '|python(?:\\d+(?:\\.\\d+)?)?|py|node|ruby|perl|php|deno|java|javac|jshell|dotnet|go' +
    '|rscript|lua|luajit|julia|groovy|scala|swift|gcc|g\\+\\+|clang|rustc' +
    '|npm|npx|pnpm|yarn|bun|pip(?:\\d+(?:\\.\\d+)?)?|gem|cargo|composer|mvn|gradle' +
    '|poetry|uv|conda|mamba|git|gh|hg|svn|pipx|nuget|msbuild' +
    '|ls|cat|head|tail|grep|sed|awk|find|printf|echo|cp|mv|rm|chmod|chown|whoami|id|pwd' +
    '|cd|pushd|popd|which|whereis|locate|history|alias|unalias|jobs|fg|bg|wait|set|unset' +
    '|declare|typeset|readonly|shift|trap|ulimit|umask' +
    '|ps|pgrep|pidof|pstree|kill|pkill|printenv|env|export|source|touch|mkdir|rmdir|ln|stat|du|df|mount|umount' +
    '|uname|hostname|groups|who|users|last|lastlog|uptime|top|free|vmstat|iostat|sar|watch|nohup|renice|timeout|sleep' +
    '|time|nice|strace|ltrace|setsid|socat|busybox|eval|exec|doas|command|builtin' +
    '|tee|xargs|uniq|wc|tr|sort|cut|fold|fmt|nl|pr|split|csplit|join|expand|unexpand' +
    '|readlink|realpath|basename|dirname|mktemp|mkfifo|paste|comm|diff|cmp|od|hexdump|xxd|strings|jq|base64' +
    '|md5sum|sha1sum|sha224sum|sha256sum|sha384sum|sha512sum|tar|gzip|gunzip|zip|unzip|openssl' +
    '|getfacl|setfacl|chattr|lsattr|lsblk|blkid|fdisk|parted|mkfs|fsck' +
    '|dd|make|cmake|dmesg|sysctl|getent|passwd|useradd|usermod|userdel|groupadd|groupmod|groupdel' +
    '|sudo|su|apt|apt-get|dpkg|rpm|yum|dnf|apk|brew|winget|choco|scoop' +
    '|snap|flatpak|certbot' +
    '|ssh|scp|sftp|rsync|ftp|telnet|curl|wget|ping|traceroute|nslookup|dig|host|nc|netcat' +
    '|ifconfig|netstat|ss|ip|arp|route|iptables|nft|ethtool|nmcli|lsof|systemctl|service|journalctl|crontab' +
    '|docker|podman|podman-compose|kubectl|helm|terraform|tofu|ansible|ansible-playbook|ansible-vault|packer|vagrant' +
    '|aws|az|gcloud|psql|mysql|mariadb|sqlite3|redis-cli|mongosh' +
    '|dir|copy|move|del|erase|type|where|tasklist|taskkill|ipconfig|sc|reg|schtasks|wmic' +
    '|robocopy|xcopy|certutil|bitsadmin|start|net|netsh|wevtutil|msiexec|rundll32|setx|systeminfo' +
    '|ver|vol|cls|findstr|fc|comp|compact|doskey|driverquery|mode|path|pause|recover|replace|subst|tree' +
    '|choice|clip|forfiles|openfiles|quser|qwinsta' +
    '|assoc|ftype|mklink|attrib|icacls|takeown|diskpart|bcdedit|dism|sfc|shutdown|logoff|runas' +
    '|cscript|wscript|launchctl|defaults|system_profiler|iex|iwr)';
  var EXECUTABLE_TOKEN = EXECUTABLE_NAME + '(?:\\.exe|\\.cmd|\\.bat)?';
  var EXECUTABLE_REFERENCE = '(?:(?:(?:[A-Za-z]:)?[\\\\/](?:[A-Za-z0-9_.-]+[\\\\/])*|\\.{1,2}[\\\\/])?' +
    EXECUTABLE_TOKEN + ')';
  var EXECUTION_CUE = new RegExp(
    '\\b(?:run|execute|invoke|launch|issue|enter|type)\\s+' +
    '(?:(?:(?:the|this|a|an|following)\\s+)?(?:command|tool|utility|program|script)\\s+)?' +
    '(?:sudo\\s+)?' + EXECUTABLE_REFERENCE + '\\b',
    'i'
  );
  // A direct execution clause is command authority even when the program is new to the reviewed
  // executable inventory. Natural business requests begin with a determiner or a bounded
  // service-work noun (for example, "run a diagnostic inspection"). Requiring a sentence or
  // delimiter boundary avoids treating descriptive prose about a future operational run as code.
  var POLITE_DIRECT_EXECUTION = /(?:^|[.!?:,]\s+)(?:please\s+)?(?:run|execute|invoke|launch|issue|enter|type)\s+(?!(?:a|an|the|this|that|another|some|any|each|all|more|fewer|one|two|three|approved|authorized|scheduled|routine|detailed|daily|weekly|monthly|quarterly|annual|diagnostic|diagnostics|inspection|inspections|assessment|assessments|check|checks|test|tests|report|reports|review|reviews|analysis|analyses|calibration|calibrations|maintenance|service|services|job|jobs|visit|visits|payroll|inventory|availability|appointment|appointments|estimate|estimates|campaign|campaigns|process|processes|workflow|workflows)\b)(?:&\s*)?(?:\$\([^\n)]{1,240}\)|%[A-Za-z_]\w*%[\\/][^\s]+|\$env:[A-Za-z_]\w*[\\/][^\s]+|'[A-Za-z0-9_$.-]+'[A-Za-z0-9_$.-]+|[A-Za-z_$](?:[\w$.-]|\\(?=[A-Za-z0-9_$]))*)(?=\s|[.;!?]|$)/i;
  var REQUIREMENT_EXECUTION = new RegExp(
    '\\brequires?\\s+(?:sudo\\s+)?' + EXECUTABLE_REFERENCE +
    '(?:\\s+(?!(?:compatibility|finish|replacement|material|support|integration|configuration|version|training|certification|experience)\\b)\\S+|(?=\\s*(?:[.;!?]|$)))',
    'i'
  );
  var USE_COMMAND_CUE = /\buse\s+(?:sudo\s+)?(?:whoami|printf|cp|mv|rm|chmod|chown|printenv|mkdir|rmdir|mktemp|sha(?:1|224|256|384|512)sum)\b/i;
  var EXECUTABLE_WITH_SHELL_OPERATOR = new RegExp(
    '(?:^|[\\s:;(])' + EXECUTABLE_REFERENCE + '\\b[^\\n]{0,300}(?:\\|[|&]?|>>?|<<?|\\$\\()',
    'i'
  );
  var LABELED_EXECUTABLE = new RegExp(
    '\\b(?:recommended\\s+action|next\\s+(?:step|action)|action|command|diagnostic)\\s*' +
    '(?::|\\bis\\b)\\s*(?:sudo\\s+)?' + EXECUTABLE_REFERENCE + '\\b',
    'i'
  );
  var PARENTHETICAL_EXECUTABLE = new RegExp(
    '\\b(?:diagnostic|instruction|command|script|terminal|console)\\s*\\(\\s*' +
    '(?:sudo\\s+)?' + EXECUTABLE_REFERENCE + '\\b',
    'i'
  );
  var SCRIPT_EXECUTION_CUE = /\b(?:run|execute|invoke|launch|enter|use)\s+(?:&\s+)?(?:(?:[A-Za-z]:)?[\\/]|\.{1,2}[\\/])(?:[^\s"'`|;()]+[\\/])*[^\s"'`|;()]+\.(?:sh|bash|zsh|fish|ps1|bat|cmd|com|exe|py|pyw|js|mjs|cjs|rb|pl|php)\b/i;
  var CUED_PROGRAM_CALL = /\b(?:run|execute|invoke|enter|type|use)\s+[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\([^()\n]{0,300}\)/i;
  var LABELED_SQL_STATEMENT = /\b(?:recommended\s+action|next\s+(?:step|action)|action|query|command)\s*(?::|\bis\b)\s*(?:with|select|insert|update|delete|merge|replace|upsert|create|alter|drop|truncate|grant|revoke|call|exec(?:ute)?|vacuum|analyze|copy|comment|explain|begin|commit|rollback|show|describe|desc|pragma|use|attach|detach)\b[^\n;]{0,500};/i;
  var LABELED_SHELL_AUTHORITY = /\b(?:recommended\s+action|next\s+(?:step|action)|action|command|suggested\s+shell\s+step)\s*(?::|\bis\b)\s*(?:\$\([^\n)]{1,240}\)|%[A-Za-z_]\w*%[\\/][^\s]+|\$env:[A-Za-z_]\w*[\\/][^\s]+|&\s*[A-Za-z_$][\w$.-]*|source\s+[^\s.;]+)/i;
  var LABELED_DIRECT_EXECUTION = /\b(?:recommended\s+action|next\s+(?:step|action)|action|command|suggested\s+shell\s+step)\s*(?::|\bis\b)\s*(?!(?:a|an|the|schedule|reschedule|call|contact|review|inspect|replace|repair|send|confirm|update|select|choose|arrange|prepare|notify|ask|explain|check|test|dispatch|install|remove|move|grant|revoke|record|document|customer|technician|team|service|appointment|estimate|diagnostic|HVAC|CRM|SMS|API)\b)(?:&\s*)?[A-Za-z_$][\w$.-]*\s+(?:[A-Za-z0-9_$%][\w$%.-]*|--?\w+|\/[A-Za-z?]\w*|[.\\/]|\$\(|%[A-Za-z_]\w*%|\$env:)/i;
  var SHELL_SUBSTITUTION = /\$\([^\n)]{1,500}\)|(?<![A-Za-z0-9_])`[^`\n]{1,500}`/;
  // A named program can be novel and therefore absent from the reviewed executable inventory.
  // Require command-shaped arguments (switches, paths, assignments, substitutions, or explicit
  // command labels) so ordinary phrases such as "run a diagnostic inspection" remain prose.
  var GENERIC_COMMAND_SYNTAX = /\b(?:run|execute|invoke|launch|issue|enter|type|use)\s+(?:(?:the|this|a|an|following)\s+(?:command|tool|utility|program|script)\s+)?(?:sudo\s+)?[A-Za-z_$][\w$.-]*(?:\.exe|\.cmd|\.bat)?\s+(?:--?[A-Za-z][\w-]*(?:[=\s]\S+)?|\/[A-Za-z?][\w?]*|(?:(?:[A-Za-z]:)?[\\/]|\.{1,2}[\\/])\S+|\$\(?[A-Za-z_{]|%[A-Za-z_]\w*%|[A-Za-z_][\w.-]*=\S+|[+][%A-Za-z0-9_-]+|["'`][^\n"'`]{0,200}["'`])/i;
  var EXPLICIT_GENERIC_COMMAND = /\b(?:(?:run|execute|invoke|launch|issue|enter|type)\s+(?:(?:the|this|a|an|following)\s+)?(?:command|tool|utility|program|script)\s+(?:sudo\s+)?[A-Za-z_$][\w$.-]*|use\s+(?:(?:the|this|a|an|following)\s+)?(?:command|tool|utility|program|script)\s+(?:sudo\s+)?[A-Za-z_$][\w$]*[._-][\w$.-]*|(?:command|tool|utility|program|script)\s*:\s*(?:sudo\s+)?[A-Za-z_$][\w$.-]*)(?:\s+(?:[^\n]{0,240}))?(?:[.;]|$)/i;
  var COMMAND_SHAPED_FRAGMENT = /(?:^|[\n:;(])\s*(?:sudo\s+)?[A-Za-z_$][\w$.-]*(?:\.exe|\.cmd|\.bat)?\s+(?:--?[A-Za-z][\w-]*(?:[=\s]\S+)?|\/[A-Za-z?][\w?]*|(?:(?:[A-Za-z]:)?[\\/]|\.{1,2}[\\/])\S+|\$\(?[A-Za-z_{]|%[A-Za-z_]\w*%|[A-Za-z_][\w.-]*=\S+|[+][%A-Za-z0-9_-]+|["'`][^\n"'`]{0,200}["'`])/i;
  var DIRECT_COMMAND_LINE = new RegExp(
    // Language/runtime names are ordinary technology nouns in professional labels. They are
    // authoritative only when an execution cue or runtime-specific argument grammar is present.
    '(?:^|[\\n:;])\\s*(?!(?:copy|move|type|start|stop|set|wait|watch|sort|cut|fold|join|split|path|tree|choice|pause|recover|replace|mode|service|command|builtin|env|nohup|time|nice|strace|ltrace|setsid|doas|exec|powershell(?:\\.exe)?|python(?:\\d+(?:\\.\\d+)?)?|py|node|ruby|perl|php|deno|java|javac|jshell|dotnet|go|rscript|lua|luajit|julia|groovy|scala|swift|gcc|g\\+\\+|clang|rustc)\\b)' +
    '(?:&\\s*)?' + EXECUTABLE_REFERENCE +
    '(?=\\s|[;&|<>]|$)(?:\\s+|[;&|<>]|$)',
    'i'
  );
  var JVM_RUNTIME_COMMAND = /(?:^|[\n:;])\s*(?:java(?:\.exe)?\s+(?:-[A-Za-z][\w-]*(?:=\S+)?|[^\s"'`]+\.(?:jar|class)\b|(?:[A-Za-z_$][\w$]*\.)+[A-Za-z_$][\w$]*\b|[A-Z_$][\w$]*(?=\s*(?:$|[;&|])))|javac(?:\.exe)?\s+(?:-[A-Za-z][\w-]*(?:=\S+)?|[^\s"'`]+\.java\b)|jshell(?:\.exe)?\s+(?:-[A-Za-z][\w-]*(?:=\S+)?|[^\s"'`]+\.(?:jsh|java)\b))/m;
  var POWERSHELL_DIRECT_COMMAND = new RegExp(
    '(?:^|[\\n:;])\\s*(?:powershell(?:\\.exe)?|pwsh)\\s+(?:&\\s*)?' + EXECUTABLE_REFERENCE + '\\b',
    'i'
  );
  var QUOTED_EXECUTABLE_LINE = new RegExp(
    '(?:^|[\\n:;])\\s*["\']' + EXECUTABLE_REFERENCE + '["\'](?=\\s|[;&|<>]|$)',
    'i'
  );
  var EXECUTABLE_PATH_LINE = /(?:^|[\n:;])\s*(?:(?:[A-Za-z]:\\|\\\\|\.{1,2}[\\/]|\/[A-Za-z0-9_.-]+\/|\$(?:env:)?[A-Za-z_]\w*[\\/]|%[A-Za-z_]\w*%[\\/])(?:[^\s"'`|;&<>]+[\\/])*[^\s"'`|;&<>]+(?:\.(?:exe|com|cmd|bat|ps1|sh|bash|zsh|fish|py|pyw|js|mjs|cjs|rb|pl|php))?)(?=\s|[;&|<>]|$)/i;
  var SQL_STATEMENT = /(?:^|[\n:])\s*(?:with\b[^;\n]{0,500}\bselect\b|select\b|show\b|describe\b|desc\b|pragma\b|use\b|attach\b|detach\b|set\s+(?:role|session|transaction)\b|reset\b|alter\s+system\b|reindex\b|cluster\b|refresh\s+materialized\s+view\b|lock\s+table\b|discard\b|values\s*\(|vacuum\b|analyze\b|checkpoint\b|copy\b|insert\b|update\b|delete\b|merge\b|replace\b|upsert\b|create\b|alter\b|drop\b|truncate\b|grant\b|revoke\b|call\b|exec(?:ute)?\b|comment\b|explain\b|begin\b|commit\b|rollback\b)[^;\n]{0,1000};(?:\s|$)/i;
  // Administrative SQL has an executable grammar regardless of the prose that precedes it.
  // Keep ambiguous service verbs such as "describe" and "use" in the clause-boundary rule above.
  var EMBEDDED_SQL_ADMIN = /\b(?:show\s+(?:all|[A-Za-z_]\w*)|pragma\s+[A-Za-z_]\w*(?:\s*(?:\([^;\n]*\)|=\s*[^;\n]+))?|attach\s+database\s+[^;\n]+\s+as\s+[A-Za-z_]\w*|detach\s+database\s+[A-Za-z_]\w*|set\s+(?:role|session\s+authorization)\s+[^;\n]+|reset\s+(?:all|[A-Za-z_]\w*)|alter\s+system\s+[^;\n]+|reindex(?:\s+(?:database|system|schema|table|index))?\s+[A-Za-z_]\w*|cluster\s+[A-Za-z_]\w*|refresh\s+materialized\s+view\s+[A-Za-z_]\w*|lock\s+table\s+[A-Za-z_]\w*|discard\s+(?:all|plans|sequences|temporary|temp)|values\s*\([^;\n]*\)|vacuum(?:\s+(?:full|freeze|analyze|verbose))*|analyze|checkpoint|copy\s+(?:\([^;\n]*\)|[A-Za-z_]\w*)\s+(?:to|from)\s+[^;\n]+|select\s+(?:'(?:[^']|'')*'|"(?:[^"]|"")*"))\s*;(?:\s|$)/i;
  var SHELL_AUTHORITY = /\$\{[^}\n]{1,240}\}|\$(?:env:)?[A-Za-z_]\w*(?:[\\/][^\s]+)?|%[A-Za-z_]\w*%(?:[\\/][^\s]+)?|(?:^|[\n:;])\s*(?:\.\s+[^\s.;]+|&\s*\{[^}\n]{1,500}\}|\.\s*\{[^}\n]{1,500}\}|[A-Za-z_$][\w$.-]*\s*<<<[^\n]{1,500})/i;
  var GENERIC_PIPELINE = /(?:^|[\n:;])\s*[A-Za-z_$][\w$.-]*(?:\s+[^\n|]{0,240})?\|(?:\||&)?\s*(?:bash|sh|zsh|fish|powershell|pwsh|cmd(?:\.exe)?|wsl(?:\.exe)?|[A-Za-z_$][\w$.-]*\s+(?:-[A-Za-z]|\/[A-Za-z]))/i;
  var COMMAND_WRAPPER_LINE = new RegExp(
    '(?:^|[\\n:;])\\s*(?:env|nohup|time|nice|strace|ltrace|setsid|doas|command|builtin|exec)\\s+' +
    '(?:sudo\\s+)?' + EXECUTABLE_REFERENCE + '\\b',
    'i'
  );
  var PROGRAM_SOURCE = /(?:^|\n)\s*(?:(?:puts|system|require)\s*(?:\(|\s)(?:["'][^\n"']*["']|[A-Za-z_$][\w$./-]*)|[A-Za-z_$][\w$]*(?:::|\.)[A-Za-z_$][\w$]*\s*(?:\(|\s+["'])|public\s+static\s+void\s+main\s*\([^)]*\)\s*\{)/i;
  // These forms are executable or query grammar even without a semicolon, wrapper, or
  // explanatory cue. Keep them line-bounded so ordinary service instructions that happen to
  // use words such as select, delete, class, import, using, or for remain valid prose.
  var BARE_SQL_STATEMENT = /(?:^|\n)\s*(?:select\s+(?:distinct\s+)?(?:\*|[A-Za-z_]\w*(?:\.[A-Za-z_*][\w$]*)?(?:\s*,\s*[A-Za-z_]\w*(?:\.[A-Za-z_*][\w$]*)?)*)\s+from\s+(?:[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?|"[^"]+"|`[^`]+`|\[[^\]]+\])|delete\s+from\s+(?:[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?|"[^"]+"|`[^`]+`|\[[^\]]+\])|select\s+(?:current_(?:user|role|schema|catalog|database|date|time|timestamp)|session_user|system_user|user))\s*;?\s*(?:$|\n)/im;
  var PYTHON_CLASS_SOURCE = /(?:^|\n)\s*class\s+[A-Za-z_]\w*(?:\([^\n)]*\))?\s*:\s*(?:\n[ \t]+)?(?:pass|(?:async\s+)?def\b|return\b|raise\b|[A-Za-z_]\w*\s*=)/im;
  var MANAGED_IMPORT_SOURCE = /(?:^|\n)\s*(?:(?:global\s+)?using\s+(?:static\s+)?(?:global::)?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*(?:\s*=\s*[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)?|import\s+(?:static\s+)?[A-Za-z_]\w*(?:\.[A-Za-z_*][\w$]*)*)\s*;\s*(?:$|\n)/im;
  var POWERSHELL_QUOTED_CALL = /(?:^|[\n:;])\s*&\s*["'](?:(?:(?:[A-Za-z]:)?[\\/]|\.{1,2}[\\/])[^"'\n]{1,300}|[A-Za-z_$][\w$.-]*\.(?:exe|com|cmd|bat|ps1))["'](?=\s|[;&|<>]|$)/i;
  var POSIX_CONTROL_SOURCE = /(?:^|[\n:;])\s*(?:(?:(?:for\s+[A-Za-z_]\w*\s+in|while|until)\b[^\n]{0,500};\s*do\b[\s\S]{0,500};\s*done\b)|(?:(?:function\s+)?[A-Za-z_]\w*\s*\(\s*\)\s*\{[\s\S]{0,500}\}))/i;
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
      pattern: /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=|\bfunction\s+[A-Za-z_$][\w$]*\s*\(|\bthrow\s+new\s+[A-Za-z_$][\w$]*\s*\(|=>/i
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
      pattern: /(?:^|[^A-Za-z0-9_$])[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\([^()\n]{0,300}\)\s*;|(?:^|\n)\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\([^()\n]{0,300}\)\s*;?\s*(?:$|\n)|\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*=\s*(?:new\s+|[A-Za-z_$][\w$]*\s*\(|["'`]\S[\s\S]{0,300}["'`]|\[[^\]\n]*\]|\{[^}\n]*\}|[A-Za-z_$][\w$]*\s*[+*/-]\s*[A-Za-z_$0-9])[^;\n]*;/m
    }),
    Object.freeze({
      id: 'sql-select',
      pattern: /\bselect\s+(?:distinct\s+)?[A-Za-z0-9_.*"`\[\],\s]+\s+from\s+(?:[A-Za-z_][\w$-]*(?:\.[A-Za-z_][\w$-]*)?|"[^"]+"|`[^`]+`|\[[^\]]+\])(?:\s*;|\s+(?:where|join|left\s+join|right\s+join|inner\s+join|outer\s+join|group\s+by|order\s+by|having|limit|offset|union)\b)/i
    }),
    Object.freeze({ id: 'labeled-sql-statement', pattern: LABELED_SQL_STATEMENT }),
    Object.freeze({ id: 'sql-statement', pattern: SQL_STATEMENT }),
    Object.freeze({ id: 'bare-sql-statement', pattern: BARE_SQL_STATEMENT }),
    Object.freeze({ id: 'embedded-sql-admin', pattern: EMBEDDED_SQL_ADMIN }),
    Object.freeze({
      id: 'sql-scalar-query',
      pattern: /\bselect\s+(?:(?:\*|-?(?:0|[1-9]\d*)(?:\.\d+)?|true|false|null|current_(?:date|time|timestamp))|[A-Za-z_]\w*_[A-Za-z_]\w*|[A-Za-z_]\w*\s*\([^;\n]*\))(?:\s+(?:as\s+)?[A-Za-z_]\w*)?\s*;/i
    }),
    Object.freeze({
      id: 'labeled-sql-scalar',
      pattern: /\b(?:recommended\s+action|next\s+(?:step|action)|action|query|command|run|execute|enter|issue)\s*(?::|\bis\b)?\s*select\s+(?:[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?|"[^"]+"|\[[^\]]+\])(?:\s+as\s+[A-Za-z_]\w*)?\s*;/i
    }),
    Object.freeze({
      id: 'sql-write-or-schema',
      pattern: /\binsert\s+into\s+[A-Za-z_][\w.$"`\[\]-]*\s*(?:\([^)]*\))?\s+(?:values\s*\(|select\b)|\b(?:merge|replace|upsert)\s+into\s+[A-Za-z_][\w.$"`\[\]-]*\b|\bupdate\s+[A-Za-z_][\w.$"`\[\]-]*\s+set\s+[A-Za-z_][\w.$"`\[\]-]*\s*=|\bdelete\s+from\s+[A-Za-z_][\w.$"`\[\]-]*(?:\s+where\b|\s*;)|\b(?:drop|alter)\s+(?:table|database|schema|index|materialized\s+view|view|function|procedure|trigger|sequence|extension|type|policy|role|user)\b|\bcreate\s+(?:(?:or\s+replace|temporary|temp|unique)\s+)*(?:table|database|schema|index|materialized\s+view|view|function|procedure|trigger|sequence|extension|type|policy|role|user)\b|\btruncate(?:\s+table)?\s+[A-Za-z_][\w.$"`\[\]-]*(?:\s*(?:,|;)|\s*$)|\bgrant\s+(?:(?:all(?:\s+privileges)?|select|insert|update|delete|truncate|references|trigger|usage|execute|connect|create|temporary)(?:\s*,\s*|\s+))*\s+on\s+[A-Za-z_."`\[\]-]+\s+to\s+[A-Za-z_."`\[\]-]+|\brevoke\s+(?:(?:all(?:\s+privileges)?|select|insert|update|delete|truncate|references|trigger|usage|execute|connect|create|temporary)(?:\s*,\s*|\s+))*\s+on\s+[A-Za-z_."`\[\]-]+\s+from\s+[A-Za-z_."`\[\]-]+|\bcall\s+[A-Za-z_][\w.$]*\s*\([^;\n]*\)\s*;|\bexec(?:ute)?\s+[A-Za-z_][\w.$]*(?:\s+[^;\n]*)?\s*;|\b(?:vacuum|analyze)\s+[A-Za-z_][\w.$"`\[\]-]*\s*;|\bcopy\s+[A-Za-z_][\w.$"`\[\]-]*(?:\s*\([^)]*\))?\s+(?:to|from)\s+[^;\n]+;|\bcomment\s+on\s+(?:table|column|view|function|schema)\b|\bexplain(?:\s+analyze)?\s+(?:select|insert|update|delete)\b|\b(?:begin|commit|rollback)\s*;/i
    }),
    Object.freeze({
      id: 'interpreter-command',
      pattern: /\b(?:python(?:\d+(?:\.\d+)?)?|node|ruby|perl|php|deno)(?:\.exe)?\s+(?:(?:-[A-Za-z]|--[A-Za-z][\w-]*)\b|(?:eval|run|task)\b|[^\s"'`]+\.(?:py|pyw|js|mjs|cjs|rb|pl|php)\b)/i
    }),
    Object.freeze({
      id: 'package-command',
      pattern: /\b(?:npm|npx|pnpm|yarn|bun|pip(?:\d+(?:\.\d+)?)?|gem|cargo|composer|dotnet|go)(?:\.exe|\.cmd|\.bat)?\s+(?:ci|install|uninstall|remove|add|update|upgrade|exec|dlx|run|test|audit|publish|pack|prune|rebuild|start|stop|restart|init|create|get|build|restore)\b/i
    }),
    Object.freeze({
      id: 'git-command',
      pattern: /\bgit(?:\.exe|\.cmd|\.bat)?\s+(?:(?:-C|--git-dir|--work-tree)\s+\S+\s+)*(?:add|am|apply|archive|bisect|blame|branch|cat-file|checkout|cherry-pick|clean|clone|commit|config|describe|diff|fetch|for-each-ref|fsck|gc|grep|init|log|ls-files|merge|mv|pull|push|rebase|reflog|remote|reset|restore|rev-list|rev-parse|rm|show|stash|status|submodule|switch|symbolic-ref|tag|update-ref|verify-commit|verify-tag|worktree)\b/i
    }),
    Object.freeze({
      id: 'remote-or-network-command',
      pattern: /\b(?:ssh|sftp|ftp|telnet)\s+(?:-[A-Za-z][\w-]*(?:[=\s]\S+)?\s+)*(?:[A-Za-z0-9_.-]+@)?[A-Za-z0-9_.-]+(?::\d+)?\b|\b(?:scp|rsync)\s+(?:-[A-Za-z][\w-]*(?:[=\s]\S+)?\s+)*\S+\s+\S+|\b(?:curl|wget)\s+(?:-[A-Za-z][\w-]*(?:[=\s]\S+)?\s+)*(?:https?:\/\/|[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:[\/:]|\b))|\b(?:ping|traceroute|nslookup|dig|nc|netcat)\s+(?:-[A-Za-z][\w-]*(?:[=\s]\S+)?\s+)*(?:[A-Za-z0-9.-]+\.[A-Za-z]{2,}|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?\b/i
    }),
    Object.freeze({ id: 'execution-cue-command', pattern: EXECUTION_CUE }),
    Object.freeze({ id: 'direct-command-line', pattern: DIRECT_COMMAND_LINE }),
    Object.freeze({ id: 'jvm-runtime-command', pattern: JVM_RUNTIME_COMMAND }),
    Object.freeze({ id: 'powershell-direct-command', pattern: POWERSHELL_DIRECT_COMMAND }),
    Object.freeze({ id: 'quoted-executable-line', pattern: QUOTED_EXECUTABLE_LINE }),
    Object.freeze({ id: 'executable-path-line', pattern: EXECUTABLE_PATH_LINE }),
    Object.freeze({ id: 'polite-direct-execution', pattern: POLITE_DIRECT_EXECUTION }),
    Object.freeze({ id: 'requirement-execution', pattern: REQUIREMENT_EXECUTION }),
    Object.freeze({ id: 'use-cue-command', pattern: USE_COMMAND_CUE }),
    Object.freeze({ id: 'generic-command-syntax', pattern: GENERIC_COMMAND_SYNTAX }),
    Object.freeze({ id: 'explicit-generic-command', pattern: EXPLICIT_GENERIC_COMMAND }),
    Object.freeze({ id: 'command-shaped-fragment', pattern: COMMAND_SHAPED_FRAGMENT }),
    Object.freeze({ id: 'script-execution-cue', pattern: SCRIPT_EXECUTION_CUE }),
    Object.freeze({ id: 'cued-program-call', pattern: CUED_PROGRAM_CALL }),
    Object.freeze({ id: 'labeled-command', pattern: LABELED_EXECUTABLE }),
    Object.freeze({ id: 'parenthetical-command', pattern: PARENTHETICAL_EXECUTABLE }),
    Object.freeze({ id: 'shell-operator-command', pattern: EXECUTABLE_WITH_SHELL_OPERATOR }),
    Object.freeze({ id: 'labeled-shell-authority', pattern: LABELED_SHELL_AUTHORITY }),
    Object.freeze({ id: 'labeled-direct-execution', pattern: LABELED_DIRECT_EXECUTION }),
    Object.freeze({ id: 'shell-substitution', pattern: SHELL_SUBSTITUTION }),
    Object.freeze({ id: 'shell-authority', pattern: SHELL_AUTHORITY }),
    Object.freeze({ id: 'generic-pipeline', pattern: GENERIC_PIPELINE }),
    Object.freeze({ id: 'command-wrapper-line', pattern: COMMAND_WRAPPER_LINE }),
    Object.freeze({ id: 'program-source', pattern: PROGRAM_SOURCE }),
    Object.freeze({ id: 'python-class-source', pattern: PYTHON_CLASS_SOURCE }),
    Object.freeze({ id: 'managed-import-source', pattern: MANAGED_IMPORT_SOURCE }),
    Object.freeze({ id: 'powershell-quoted-call', pattern: POWERSHELL_QUOTED_CALL }),
    Object.freeze({ id: 'posix-control-source', pattern: POSIX_CONTROL_SOURCE }),
    Object.freeze({
      id: 'code-shaped-call',
      pattern: /(?:^|[^A-Za-z0-9_$])(?:[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*|[A-Za-z_$][\w$]*_[A-Za-z_$][\w$]*|[a-z][A-Za-z0-9_$]*[A-Z][A-Za-z0-9_$]*)\([^()\n]{0,300}\)/
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
      id: 'powershell-cmdlet',
      pattern: /\b(?:Get|Set|New|Remove|Invoke|Start|Stop|Restart|Test|Select|Where|ForEach|Import|Export|Write|Read|Add|Clear|Copy|Move|Rename|Out|Format)-[A-Z][A-Za-z]+\b/
    }),
    Object.freeze({
      id: 'shell-command',
      pattern: /\b(?:npm|npx|yarn|pnpm)\s+(?:install|run|test|exec|audit)\b|\bgit\s+(?:clone|checkout|switch|reset|clean|push|pull|fetch|commit|status|diff|log|show|rev-parse)\b|(?:^|[\n:;])\s*(?:rm|del|erase|rmdir)\s+(?:-[A-Za-z]+|\/[A-Za-z]+|[.~\\/])|\$(?:env:)?[A-Za-z_]\w*\s*=/i
    }),
    Object.freeze({
      id: 'shell-command-line',
      pattern: /\b(?:ls\s+(?:-[A-Za-z]+|[.~\\/])|(?:cat|head|tail)\s+(?:-[A-Za-z]+\s+)?[.~\\/]|(?:grep|sed|awk|find)\s+(?:-[A-Za-z]+\s+|[.~\\/]|["'])|(?:echo|printf)\s+[^\n]*(?:>|\|)|sudo\s+[A-Za-z][\w-]*(?:\s+|$)|(?:systemctl|service)\s+(?:start|stop|restart|enable|disable|status)\b|(?:docker|podman)\s+(?:run|exec|build|pull|push|compose|rm|stop|start)\b|(?:kubectl|helm)\s+(?:get|apply|delete|create|install|upgrade|exec|logs|describe)\b|(?:ssh|scp|rsync)\s+(?:-[A-Za-z]+\s+)*(?:[\w.-]+@|[.~\\/])|(?:python(?:3)?|node|ruby|perl)\s+(?:-[A-Za-z]+\s+)*[^\s]+\.(?:py|js|mjs|cjs|rb|pl)\b|chmod\s+(?:-[A-Za-z]+\s+)*(?:[0-7]{3,4}|[ugoa]*[+=-][rwxXst]+)\s+|chown\s+(?:-[A-Za-z]+\s+)*(?:[\w.-]+(?::[\w.-]+)?)\s+)/i
    }),
    Object.freeze({
      id: 'python-source',
      pattern: /\b(?:async\s+)?def\s+[A-Za-z_]\w*\s*\([^)]*\)\s*:|(?:^|\n)\s*(?:from\s+[A-Za-z_][\w.]*\s+import\s+|import\s+[A-Za-z_][\w.]*(?:\s*,\s*[A-Za-z_][\w.]*)*(?:\s+as\s+[A-Za-z_]\w*)?\s*(?:$|\n))|\bprint\s*\([^\n)]*\)/im
    }),
    Object.freeze({
      id: 'stylesheet-source',
      pattern: /(?:^|\n)\s*(?:[.#][A-Za-z_-][\w-]*|[A-Za-z][\w-]*(?:\s+[A-Za-z][\w-]*)*)\s*\{\s*(?:--?[\w-]+|[A-Za-z-]+)\s*:\s*[^{};]+;|(?:^|\n)\s*@(?:media|supports|keyframes|font-face|import|layer)\b/im
    }),
    Object.freeze({
      id: 'compiled-language-source',
      pattern: /(?:^|\n)\s*#\s*include\s*[<"][^>"]+[>"]|(?:^|\n)\s*(?:int|void|char|double|float|bool|string)\s+[A-Za-z_]\w*\s*\([^)]*\)\s*\{/im
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
    normalized = normalized.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ')
      .replace(INVISIBLE_FORMATTING_BMP, '').replace(INVISIBLE_FORMATTING_ASTRAL, '')
      .replace(TOKEN_SEPARATING_MARKS, '')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\\[ \t]*\n[ \t]*/g, '')
      .replace(/[`^][ \t]*\n[ \t]*/g, '')
      .replace(/([A-Za-z0-9_$])(?:`|\^)(?=[A-Za-z0-9_$])/g, '$1')
      .replace(/(["'])([A-Za-z0-9_$.-]+)\1(?=[A-Za-z0-9_$])/g, '$2');
    // Shells concatenate adjacent quoted/unquoted token fragments. Canonicalize only
    // bounded token-shaped quotes for inspection; displayed prose is never rewritten.
    for (var pass = 0; pass < 3; pass += 1) {
      normalized = normalized
        .replace(/([A-Za-z0-9_$])\\(?=[A-Za-z0-9_$])/g, '$1')
        .replace(/(["'])([A-Za-z0-9_$.-]*)\1(?=[A-Za-z0-9_$])/g, '$2')
        .replace(/([A-Za-z0-9_$])(["'])([A-Za-z0-9_$.-]+)\2/g, '$1$3');
    }
    return normalized;
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
    POLICY_VERSION: 'northstar.polaris.professional-text.v6',
    isProfessionalText: function (value) { return violation(value) === null; }
  });
});
