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
    '(?:^|[\\n:;])\\s*(?!net\\s+(?:15|30|45|60|90)\\b)(?!(?:copy|move|type|start|stop|set|wait|watch|sort|cut|fold|join|split|path|tree|choice|pause|recover|replace|mode|service|command|builtin|env|export|nohup|time|nice|strace|ltrace|setsid|doas|exec|powershell(?:\\.exe)?|python(?:\\d+(?:\\.\\d+)?)?|py|node|ruby|perl|php|deno|java|javac|jshell|dotnet|go|rscript|lua|luajit|julia|groovy|scala|swift|gcc|g\\+\\+|clang|rustc)\\b)' +
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
  // Adjacent query grammar is parsed as complete line/delimiter-bounded statements. Projection
  // and tail shapes are deliberately constrained so real sentences such as "Select the approved
  // service from the menu before scheduling" remain professional prose.
  var SQL_PROJECTION_ITEM = '(?:\\*|-?(?:0|[1-9]\\d*)(?:\\.\\d+)?|true|false|null|current_(?:user|role|schema|catalog|database|date|time|timestamp)|session_user|system_user|user|[A-Za-z_]\\w*(?:\\.[A-Za-z_*][\\w$]*)?|[A-Za-z_]\\w*\\s*\\([^()\\n]{0,240}\\))';
  var SQL_TABLE_REFERENCE = '(?:[A-Za-z_]\\w*(?:\\.[A-Za-z_]\\w*)?|"[^"]+"|`[^`]+`|\\[[^\\]]+\\])';
  var SQL_SELECT_SOURCE = new RegExp(
    '(?:^|[\\n:;])\\s*select\\s+(?:(?:distinct|all)\\s+)?(?:' +
    SQL_PROJECTION_ITEM + '(?:\\s*,\\s*' + SQL_PROJECTION_ITEM + ')*)\\s+from\\s+' +
    SQL_TABLE_REFERENCE + '(?:\\s+(?:as\\s+)?[A-Za-z_]\\w*)?' +
    '(?:\\s+(?:where|join|left\\s+join|right\\s+join|inner\\s+join|outer\\s+join|group\\s+by|order\\s+by|having|limit|offset|union)\\b[^;\\n]{0,500})?\\s*;?\\s*(?:$|\\n)' +
    '|(?:^|[\\n:;])\\s*select\\s+(?:-?(?:0|[1-9]\\d*)(?:\\.\\d+)?|true|false|null|current_(?:user|role|schema|catalog|database|date|time|timestamp)|session_user|system_user|user|[A-Za-z_]\\w*\\s*\\([^()\\n]{0,240}\\))' +
    '(?:\\s+(?:as\\s+)?[A-Za-z_]\\w*)?\\s*;?\\s*(?:$|\\n)',
    'i'
  );
  var SQL_CTE_SOURCE = /(?:^|[\n:;])\s*with(?:\s+recursive)?\s+[A-Za-z_]\w*(?:\s*\([^\n)]{1,240}\))?\s+as\s*\([\s\S]{0,1000}\b(?:select|insert|update|delete)\b[\s\S]{0,1000}\)\s*(?:select|insert|update|delete)\b[^;\n]{0,1000};?\s*(?:$|\n)/i;
  var SQL_DESCRIBE_SOURCE = /(?:^|[\n:;])\s*(?:describe|desc)\s+(?:table\s+)?(?:[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?|"[^"]+"|`[^`]+`|\[[^\]]+\])\s*;?\s*(?:$|\n)/i;
  var SQL_TRANSACTION_MODE = '(?:isolation\\s+level\\s+(?:serializable|repeatable\\s+read|read\\s+committed|read\\s+uncommitted)|read\\s+(?:only|write)|deferrable|not\\s+deferrable)';
  var SQL_TRANSACTION_SOURCE = new RegExp(
    '(?:^|[\\n:;])\\s*set\\s+(?:transaction\\s+|session\\s+characteristics\\s+as\\s+transaction\\s+)' +
    SQL_TRANSACTION_MODE + '(?:\\s*,\\s*' + SQL_TRANSACTION_MODE + ')*\\s*;?\\s*(?:$|\\n)',
    'i'
  );
  // These forms are executable or query grammar even without a semicolon, wrapper, or
  // explanatory cue. Keep them line-bounded so ordinary service instructions that happen to
  // use words such as select, delete, class, import, using, or for remain valid prose.
  var BARE_SQL_STATEMENT = /(?:^|\n)\s*(?:select\s+(?:distinct\s+)?(?:\*|[A-Za-z_]\w*(?:\.[A-Za-z_*][\w$]*)?(?:\s*,\s*[A-Za-z_]\w*(?:\.[A-Za-z_*][\w$]*)?)*)\s+from\s+(?:[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?|"[^"]+"|`[^`]+`|\[[^\]]+\])|delete\s+from\s+(?:[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?|"[^"]+"|`[^`]+`|\[[^\]]+\])|select\s+(?:current_(?:user|role|schema|catalog|database|date|time|timestamp)|session_user|system_user|user))\s*;?\s*(?:$|\n)/im;
  var PYTHON_CLASS_SOURCE = /(?:^|\n)[ \t]*class\s+[A-Za-z_]\w*(?:\([^\n)]*\))?\s*:[ \t]*(?:\n[ \t]+\S[^\n]*(?:\n[ \t]+[^\n]*)*|(?:pass|(?:async\s+)?def\b|return\b|raise\b|["']{3}|[A-Za-z_]\w*\s*:\s*[A-Za-z_]|[A-Za-z_]\w*\s*=|\.\.\.)[^\n]*)/m;
  var PYTHON_LAMBDA_SOURCE = /(?:^|\n)\s*[A-Za-z_]\w*(?:\s*:\s*[A-Za-z_][\w.\[\], |]*)?\s*=\s*lambda\b[^\n:]{0,300}:\s*[^\n]+/im;
  var MANAGED_IMPORT_SOURCE = /(?:^|\n)\s*(?:(?:global\s+)?using\s+(?:static\s+)?(?:global::)?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*(?:\s*=\s*[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)?|import\s+(?:static\s+)?[A-Za-z_]\w*(?:\.[A-Za-z_*][\w$]*)*)\s*;\s*(?:$|\n)/im;
  var MANAGED_DECLARATION_SOURCE = /(?:^|\n)\s*(?:(?:package\s+[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+\s*;)|(?:(?:(?:public|protected|private|internal|static|final|sealed|abstract|partial)\s+)*record\s+[A-Za-z_]\w*(?:\s*<[^\n>{}]+>)?\s*\([^\n)]*\)\s*(?:\{|;))|(?:(?:(?:public|protected|private|internal|static|final|sealed|abstract|partial)\s+)*enum\s+[A-Za-z_]\w*(?:\s*:\s*[A-Za-z_]\w*)?(?:\s+implements\s+[^\n{]+)?\s*\{)|(?:namespace\s+[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\s*(?:;|\{))|(?:extern\s+alias\s+[A-Za-z_]\w*\s*;))/im;
  var POWERSHELL_QUOTED_CALL = /(?:^|[\n:;])\s*&\s*(?:["'][^"'\n]{1,300}["']|\((?:[^()\n]|\([^()\n]*\)){1,300}\)|\$(?:env:)?[A-Za-z_]\w*)(?=\s|[;&|<>]|$)/i;
  var POSIX_CONTROL_SOURCE = /(?:^|[\n:;])\s*(?:(?:(?:for\s+[A-Za-z_]\w*\s+in|select\s+[A-Za-z_]\w*\s+in|while|until)\b[\s\S]{0,500}(?:;|\n)\s*do\b[\s\S]{0,500}(?:;|\n)\s*done\b)|(?:if\b[\s\S]{0,500}(?:;|\n)\s*then\b[\s\S]{0,700}(?:;|\n)\s*fi\b)|(?:case\b[^\n;]{1,300}\s+in(?:\s|\n)[\s\S]{0,700}\besac\b)|(?:(?:function\s+)?[A-Za-z_]\w*\s*\(\s*\)\s*\{[\s\S]{0,500}\})|(?:\{\s*(?:[A-Za-z_][\w.-]*|:)(?:\s+[^{}\n;]{0,240})?\s*;[\s\S]{0,500}\}))/i;
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
    Object.freeze({ id: 'sql-select-source', pattern: SQL_SELECT_SOURCE }),
    Object.freeze({ id: 'sql-cte-source', pattern: SQL_CTE_SOURCE }),
    Object.freeze({ id: 'sql-describe-source', pattern: SQL_DESCRIBE_SOURCE }),
    Object.freeze({ id: 'sql-transaction-source', pattern: SQL_TRANSACTION_SOURCE }),
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
    Object.freeze({ id: 'python-lambda-source', pattern: PYTHON_LAMBDA_SOURCE }),
    Object.freeze({ id: 'managed-import-source', pattern: MANAGED_IMPORT_SOURCE }),
    Object.freeze({ id: 'managed-declaration-source', pattern: MANAGED_DECLARATION_SOURCE }),
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
      .replace(/([A-Za-z_$][A-Za-z0-9_$]*)\/\*[\s\S]*?\*\/([A-Za-z_$][A-Za-z0-9_$]*)/g,
        function (_whole, left, right) {
          return inventoryHas(SOURCE_WORDS, left + right) ? left + right : left + ' ' + right;
        })
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
    // Source keywords can be split with horizontal whitespace to evade lexical checks. Join
    // only all-uppercase fragment runs whose concatenation is a reviewed source word. This
    // deliberately leaves ordinary prose such as "for each customer" unchanged.
    normalized = normalized.replace(/\b(?:[A-Z]{1,4}[ \t]+){1,7}[A-Z]{1,4}\b/g, function (candidate) {
      var joined = candidate.replace(/[ \t]+/g, '');
      return inventoryHas(SOURCE_WORDS, joined) ? joined : candidate;
    });
    return normalized;
  }

  // Positive presentation contract
  // ------------------------------
  // Polaris display values are human-facing prose or compact business labels. They are not
  // an arbitrary source-code transport. Instead of making acceptance depend on recognizing
  // every language or executable name, this classifier requires a bounded display-text shape
  // and weighs natural-language evidence against language-independent source structure.
  // The older explicit rules remain defense in depth after this contract.
  var SOURCE_WORDS = '|abstract|alias|alter|analyze|assert|async|await|begin|break|case|catch|checkpoint|' +
    'class|commit|const|continue|copy|create|deallocate|declare|def|defer|delete|del|describe|detach|' +
    'discard|do|drop|elif|else|enum|esac|except|exec|execute|explain|export|extends|extern|fi|finally|' +
    'fn|for|foreach|from|func|function|goto|grant|if|implements|impl|import|in|insert|interface|lambda|' +
    'let|lock|match|merge|module|namespace|package|param|pragma|prepare|public|raise|record|refresh|' +
    'reindex|reset|resource|return|revoke|rollback|select|set|show|static|struct|switch|table|then|' +
    'throw|trait|truncate|try|type|union|until|update|use|using|values|var|vacuum|when|where|while|' +
    'with|yield|';
  var PROSE_FUNCTION_WORDS = '|a|an|and|are|as|at|because|before|by|can|could|does|during|for|from|' +
    'has|have|if|in|includes|into|is|may|must|not|of|on|or|our|should|than|that|the|their|this|to|' +
    'until|was|were|when|where|which|while|will|with|without|would|you|your|';
  var SENTENCE_ENDING = /[.!?…][\s\])}"'’”]*$/u;
  var DISPLAY_CHARACTER = /^[\p{L}\p{N}\p{Zs}\t\n\r.,!?…:;()\[\]{}'"“”‘’/@#$%&*+=_\\|<>`~^–—-]*$/u;
  var OPAQUE_DISPLAY_TOKEN = /^[\p{L}\p{N}][\p{L}\p{N}._\[\],:@+%'’–—-]{31,}$/u;

  function inventoryHas(inventory, word) {
    return inventory.indexOf('|' + word.toLowerCase() + '|') >= 0;
  }

  function lexicalWords(value) {
    return value.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu) || [];
  }

  function sourceStructureScore(value) {
    var score = 0;
    // These shapes carry execution/configuration structure across language families; none is
    // needed to render a professional Polaris sentence or ordinary business label.
    if (/\{\s*\{|\}\s*\}|\{%|%\}|<%|%>|\$\s*\{\s*\{/u.test(value)) score += 6;
    if (/[A-Za-z0-9_$]\/\*[\s\S]{0,300}?\*\/[A-Za-z0-9_$]/u.test(value)) score += 4;
    if (/(?:^|\n)\s*(?:#!|#\s*(?:define|include|pragma)\b|@echo\s+off\b|--\s*[^\n]*$)/im.test(value)) score += 5;
    if (/=>|->|::|\?\.|&&|\|\||===?|!==?|>=|<=|\+\+|--|<<|>>/u.test(value)) score += 4;
    if (/\$\{[^}\n]+\}|\$[A-Za-z_][\w]*|%[A-Za-z_~][\w~]*%|%%[A-Za-z]|!\w+!/u.test(value)) score += 5;
    if (/(?:^|[\s({,])@[A-Za-z_]\w*(?=\s|$)/u.test(value)) score += 4;
    if (/(?:^|\n)\s*(?:[A-Za-z_][\w.-]*\s*=|[A-Z_][A-Z0-9_]*=|\[[^\]\n]+\]\s*$)/m.test(value)) score += 4;
    if (/(?:^|\n)[ \t]+\S/u.test(value) && /(?:^|\n)\s*[^\n.!?]{0,120}(?:[:{]|\b(?:do|then|else|case|except|catch)\b)\s*$/im.test(value)) score += 4;
    if (/(?:^|\n)\s*[\w.-]+:\s*(?:$|\n)/m.test(value) ||
      /(?:^|\n)\s*[\w.-]+:\s*(?:\d+|true|false|null|[\w./:-]+)\s*$/im.test(value)) score += 4;
    if (/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\([^()\n]{0,300}\)/u.test(value)) score += 4;
    if (/[A-Za-z_$][\w$]*\s*\[[^\]\n]{0,200}\]/u.test(value)) score += 3;
    if (/\{[\s\S]{0,500}\}|\[[\s\S]{0,500}\]\s*(?:;|$)/u.test(value)) score += 3;
    if (/(?:^|\s)(?:--?[A-Za-z][\w-]*|\/[A-Za-z?][\w?]*)(?:\s|=|$)/u.test(value)) score += 3;
    if (/(?:^|\s)(?:\.{0,2}[\\/]|[A-Za-z]:\\)[^\s]+/u.test(value)) score += 3;
    if (/(?:^|\s)(?:\d*>>?|\d*<<?)\s*(?:[./~\\$%]|[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\S*|(?:^|\s)(?:\||&\s*(?:['"(]|\$)|<<<|\$\(|<\()/u.test(value)) score += 4;
    if (/^\s*\/(?:\\.|[^/\n]){1,300}\/[dgimsuvy]*\s*$/u.test(value)) score += 5;
    if (/(?:^|\n)\s*(?:FROM|RUN|CMD|ENTRYPOINT|ENV|ARG|COPY|WORKDIR|EXPOSE|VOLUME|USER|LABEL)\b/im.test(value) &&
      !SENTENCE_ENDING.test(value)) score += 3;
    if (/(?:^|\n)\s*(?:call|goto)\s+:[A-Za-z_]\w*(?:\s|$)/im.test(value)) score += 4;
    if (/(?:^|\n)[^\n]{1,120}:\n\t\S/u.test(value)) score += 5;
    return score;
  }

  function positivePresentationViolation(value) {
    var trimmed = value.trim();
    if (!trimmed) return 'presentation-empty';
    if (!DISPLAY_CHARACTER.test(trimmed)) return 'presentation-character';
    if (OPAQUE_DISPLAY_TOKEN.test(trimmed)) return null;

    var words = lexicalWords(trimmed);
    if (!words.length) return 'presentation-no-words';
    var sourceWordCount = 0;
    var functionWordCount = 0;
    for (var index = 0; index < words.length; index += 1) {
      if (inventoryHas(SOURCE_WORDS, words[index])) sourceWordCount += 1;
      if (inventoryHas(PROSE_FUNCTION_WORDS, words[index])) functionWordCount += 1;
    }

    var firstMatch = /^\s*([A-Za-z_][\w-]*)/.exec(trimmed);
    var firstWord = firstMatch ? firstMatch[1] : '';
    var sourceLead = Boolean(firstWord && inventoryHas(SOURCE_WORDS, firstWord));
    var sourceStyledLead = sourceLead &&
      (firstWord === firstWord.toLowerCase() || firstWord === firstWord.toUpperCase());
    var sentenceLike = words.length >= 4 && SENTENCE_ENDING.test(trimmed) && functionWordCount >= 1;
    var explicitProseOpening = /^(?:the|this|that|these|those|a|an|our|your|their|its|please|would|could|should|unknown|evidence|advisory)\b/i.test(trimmed);
    var structureScore = sourceStructureScore(trimmed);

    // Complete natural-language sentences may legitimately discuss SQL, exports, classes, or
    // formulas. They remain valid when no source structure is being transported.
    if (sentenceLike && structureScore === 0 && (explicitProseOpening || sourceWordCount <= 1)) return null;

    // A source-styled leading keyword is not a business label unless natural-language sentence
    // evidence outweighs it. This closes bare word-only forms such as TABLE invoices, yield
    // invoice, and GRANT SELECT ON invoices TO analyst without rejecting title-cased labels such
    // as Export documentation or Class A materials.
    if (sourceStyledLead && !sentenceLike) return 'presentation-source-lead';
    if (structureScore >= 4) return 'presentation-source-structure';
    if (sourceWordCount >= 2 && !sentenceLike) return 'presentation-source-vocabulary';

    // Multiline display prose uses complete sentences or explicit business labels on each line.
    // Indented blocks, bare key/value maps, and token-split source do not meet that contract.
    if (trimmed.indexOf('\n') >= 0) {
      var lines = trimmed.split('\n').filter(function (line) { return line.trim(); });
      var proseLines = lines.every(function (line) {
        var lineWords = lexicalWords(line);
        return SENTENCE_ENDING.test(line.trim()) && lineWords.length >= 3;
      });
      if (!proseLines) return 'presentation-multiline-structure';
    }

    return null;
  }

  // Display fields accept professional prose, not source-language statements. The older
  // inventory below remains defense in depth for embedded fragments, but a source statement
  // should not depend on enumerating every function, modifier, command name, or whitespace
  // spelling. These helpers classify the bounded structure of complete line/delimiter-bounded
  // statements after NFKC and invisible-character normalization.
  function statementCandidates(value) {
    var candidates = [];
    var seen = Object.create(null);
    function add(candidate) {
      var trimmed = candidate.trim();
      if (!trimmed || seen[trimmed]) return;
      seen[trimmed] = true;
      candidates.push(trimmed);
    }

    add(value);
    for (var index = 0; index < value.length; index += 1) {
      if (value.charAt(index) === '\n') add(value.slice(index + 1));
      if (value.charAt(index) === ':' && /(?:^|\s)(?:query|command|script|source|code)\s*$/i.test(value.slice(0, index))) {
        add(value.slice(index + 1));
      }
    }
    return candidates;
  }

  function stripStatementTerminator(value) {
    return value.replace(/\s*;\s*$/, '').trim();
  }

  function isIdentifierBoundary(character) {
    return !character || !/[A-Za-z0-9_$]/.test(character);
  }

  function findTopLevelWord(value, word) {
    var lower = value.toLowerCase();
    var depth = 0;
    var quote = '';
    for (var index = 0; index <= value.length - word.length; index += 1) {
      var character = value.charAt(index);
      if (quote) {
        if (character === quote) {
          if (value.charAt(index + 1) === quote) index += 1;
          else quote = '';
        } else if (character === '\\') index += 1;
        continue;
      }
      if (character === '"' || character === "'" || character === '`') {
        quote = character;
        continue;
      }
      if (character === '(') {
        depth += 1;
        continue;
      }
      if (character === ')') {
        if (depth > 0) depth -= 1;
        continue;
      }
      if (depth === 0 && lower.slice(index, index + word.length) === word &&
        isIdentifierBoundary(value.charAt(index - 1)) &&
        isIdentifierBoundary(value.charAt(index + word.length))) return index;
    }
    return -1;
  }

  function matchingParenthesis(value, openIndex) {
    var depth = 0;
    var quote = '';
    for (var index = openIndex; index < value.length; index += 1) {
      var character = value.charAt(index);
      if (quote) {
        if (character === quote) {
          if (value.charAt(index + 1) === quote) index += 1;
          else quote = '';
        } else if (character === '\\') index += 1;
        continue;
      }
      if (character === '"' || character === "'" || character === '`') {
        quote = character;
        continue;
      }
      if (character === '(') depth += 1;
      else if (character === ')') {
        depth -= 1;
        if (depth === 0) return index;
        if (depth < 0) return -1;
      }
    }
    return -1;
  }

  var SQL_IDENTIFIER = '(?:[A-Za-z_]\\w*(?:\\.[A-Za-z_]\\w*)?|"[^"]+"|`[^`]+`|\\[[^\\]]+\\])';
  var SQL_SOURCE_TAIL = new RegExp(
    '^' + SQL_IDENTIFIER + '(?:\\s+(?:as\\s+)?[A-Za-z_]\\w*)?' +
    '(?:\\s+(?:where|join|left\\s+join|right\\s+join|full\\s+join|inner\\s+join|outer\\s+join|cross\\s+join|group\\s+by|order\\s+by|having|limit|offset|union|intersect|except|fetch|for)\\b[\\s\\S]*)?$',
    'i'
  );

  function isStructuredSqlSelect(value) {
    var statement = stripStatementTerminator(value).replace(/\s+/g, ' ');
    var selectMatch = /^select\s+([\s\S]+)$/i.exec(statement);
    if (!selectMatch) return false;
    var body = selectMatch[1].trim();
    var fromIndex = findTopLevelWord(body, 'from');
    if (fromIndex >= 0) {
      var projection = body.slice(0, fromIndex).trim();
      var source = body.slice(fromIndex + 4).trim();
      if (!projection || !SQL_SOURCE_TAIL.test(source)) return false;
      // Once FROM resolves to a SQL source/tail, even a single identifier projection is a
      // complete query. Ordinary instructions such as "Select service from the menu" do not
      // satisfy the SQL source tail because their remaining words are prose, not SQL clauses.
      return true;
    }

    var scalar = body.replace(/\s+(?:as\s+)?[A-Za-z_]\w*$/i, '').trim();
    if (/^\([\s\S]+\)$/.test(scalar) && matchingParenthesis(scalar, 0) === scalar.length - 1) return true;
    if (/^[A-Za-z_]\w*\s*\(/.test(scalar)) {
      var openIndex = scalar.indexOf('(');
      return matchingParenthesis(scalar, openIndex) === scalar.length - 1;
    }
    return /^(?:\*|-?(?:0|[1-9]\d*)(?:\.\d+)?|true|false|null|current_[A-Za-z_]\w*|session_user|system_user|user)$/i.test(scalar);
  }

  function isStructuredSqlCte(value) {
    var statement = stripStatementTerminator(value);
    var header = /^with(?:\s+recursive)?\s+[A-Za-z_]\w*(?:\s*\([^)]*\))?\s+as\s*\(/i.exec(statement);
    if (!header) return false;
    var openIndex = header[0].lastIndexOf('(');
    var closeIndex = matchingParenthesis(statement, openIndex);
    if (closeIndex < 0) return false;
    var body = statement.slice(openIndex + 1, closeIndex).trim();
    var tail = statement.slice(closeIndex + 1).trim();
    return /^(?:select|values|insert|update|delete|merge)\b/i.test(body) &&
      /^(?:select|insert|update|delete|merge)\b/i.test(tail);
  }

  function classifyStructuredSql(value) {
    var compact = value.replace(/\s+/g, ' ').trim();
    if (isStructuredSqlSelect(value)) return 'structured-sql-select';
    if (isStructuredSqlCte(value)) return 'structured-sql-cte';
    if (/^(?:describe|desc)\s+(?:(?:formatted|extended|table)\s+)*[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?\s*;?$/i.test(compact)) {
      return 'structured-sql-describe';
    }
    if (/^set\s+(?:local\s+)?transaction\s+(?:snapshot\s+(?:'[^']+'|"[^"]+")|(?:isolation\s+level\s+(?:serializable|repeatable\s+read|read\s+committed|read\s+uncommitted)|read\s+(?:only|write)|deferrable|not\s+deferrable)(?:\s*,\s*(?:isolation\s+level\s+(?:serializable|repeatable\s+read|read\s+committed|read\s+uncommitted)|read\s+(?:only|write)|deferrable|not\s+deferrable))*)\s*;?$/i.test(compact)) {
      return 'structured-sql-transaction';
    }
    return null;
  }

  function classifyManagedSource(value) {
    var compact = value.replace(/\s+/g, ' ').trim();
    if (/^package\s+[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*\s*;$/i.test(compact)) {
      return 'structured-managed-package';
    }
    if (/^(?:global\s+)?using\s+[A-Za-z_]\w*\s*=\s*(?:global\s*::\s*)?[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*\s*;$/i.test(compact)) {
      return 'structured-managed-alias';
    }
    return null;
  }

  function classifyPythonSource(value) {
    // Python keywords are case-sensitive. Keeping that property preserves legitimate business
    // prose such as "Class Example: review the service plan" while rejecting actual source.
    var classMatch = /^class\s+[A-Za-z_]\w*(?:\s*\([\s\S]{0,500}\))?\s*:\s*([\s\S]+)$/.exec(value);
    if (classMatch) {
      var classBody = classMatch[1];
      if (/^(?:["'][\s\S]*["']|pass\b|\.\.\.|(?:async\s+)?def\b|return\b|raise\b|[A-Za-z_]\w*\s*(?::|=))/.test(classBody.trim()) ||
        /^\n?[ \t]+\S/m.test(classBody)) return 'structured-python-class';
    }
    if (/^(?:(?:[A-Za-z_]\w*(?:\s*:\s*[^=\n]+)?\s*=\s*)?\(\s*)?lambda\b[^:\n]{0,300}:\s*\S[\s\S]*(?:\))?$/.test(value.trim())) {
      return 'structured-python-lambda';
    }
    return null;
  }

  function classifyShellSource(value) {
    var trimmed = value.trim();
    if (/^for\s*\(\([\s\S]{1,500}\)\)\s*;?\s*do\b[\s\S]{1,700}\bdone\s*$/i.test(trimmed)) {
      return 'structured-posix-arithmetic-loop';
    }
    if (/^\{[\s\S]*\}$/.test(trimmed) && /(?:\n|;)/.test(trimmed) && /[A-Za-z_$][\w$.-]*(?:\s+[^{}\n;]+)?/.test(trimmed.slice(1, -1))) {
      return 'structured-posix-compound';
    }
    if (/^[a-z_$][\w$.-]*(?:\s+[^\s<>|;&]+)+\s+\d*(?:>>?|<<?|<>|>&|<&)\s*(?:[.&$%\\/]|[^\s]+\.[A-Za-z0-9]{1,12}\b)\S*\s*$/i.test(trimmed)) {
      return 'structured-command-redirection';
    }
    return null;
  }

  function structuralSourceViolation(value) {
    var candidates = statementCandidates(value);
    for (var index = 0; index < candidates.length; index += 1) {
      var candidate = candidates[index];
      var violationId = classifyStructuredSql(candidate) || classifyManagedSource(candidate) ||
        classifyPythonSource(candidate) || classifyShellSource(candidate);
      if (violationId) return violationId;
    }
    return null;
  }

  function violation(value) {
    if (typeof value !== 'string') return 'not-string';
    if (UNSAFE_CONTROLS.test(value)) return 'unsafe-control';
    var inspected = normalizedForInspection(value);
    var presentationViolation = positivePresentationViolation(inspected);
    if (presentationViolation) return presentationViolation;
    var sourceViolation = structuralSourceViolation(inspected);
    if (sourceViolation) return sourceViolation;
    for (var index = 0; index < RULES.length; index += 1) {
      if (RULES[index].pattern.test(inspected)) return RULES[index].id;
    }
    return null;
  }

  return Object.freeze({
    POLICY_VERSION: 'northstar.polaris.professional-text.v8',
    isProfessionalText: function (value) { return violation(value) === null; }
  });
});
