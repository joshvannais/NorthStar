'use strict';

const {
  MESSAGE_REQUEST_SCHEMA,
  buildContextResponse,
  validateMessageRequest,
} = require('../../src/polaris/assistantContract');
const {
  boundedInterceptedResponse,
  buildRuntimeEnvelope,
} = require('../../src/polaris/assistantRuntime');
const { createOpenAIRuntime } = require('../../src/polaris/openaiRuntime');
const professionalTextPolicy = require('../../public/js/polaris-professional-text');
const cardRenderer = require('../../public/js/polaris-native-card');

const ORG = '9a000000-0000-4000-8000-000000000001';
const USER = '9b000000-0000-4000-8000-000000000001';
const CUSTOMER = '9c000000-0000-4000-8000-000000000001';
const LEAD = '9d000000-0000-4000-8000-000000000001';
const GRAPH = '9e000000-0000-4000-8000-000000000001';
const SNAPSHOT = '9f000000-0000-4000-8000-000000000001';
const FACT = '91000000-0000-4000-8000-000000000001';
const KEY = '92000000-0000-4000-8000-000000000001';

const HOSTILE_GRAMMARS = Object.freeze([
  ['POSIX escaped executable token', 'Recommended action: g\\it status'],
  ['multiply escaped executable token', 'Recommended action: g\\i\\t status'],
  ['bare SELECT FROM statement', 'SELECT * FROM customers'],
  ['bare DELETE statement', 'DELETE FROM customers'],
  ['bare SQL session scalar', 'SELECT current_user'],
  ['qualified bare SELECT statement', 'SELECT customer_id, status FROM public.customers'],
  ['Python class body', 'class Example:\n    pass'],
  ['Python inherited class body', 'class Example(Base):\n    def run(self): return 1'],
  ['C# using directive', 'using System;'],
  ['Java import directive', 'import java.util.*;'],
  ['Java static import directive', 'import static java.util.Collections.*;'],
  ['PowerShell quoted call operator', "Recommended action: & 'C:\\tools\\deploy.exe' --force"],
  ['PowerShell relative quoted call operator', 'Recommended action: & ".\\deploy.ps1" -Force'],
  ['POSIX shell loop', 'for f in a b; do printf ok; done'],
  ['POSIX while loop', 'while true; do printf ok; done'],
  ['POSIX shell function', 'deploy() { echo ok; }'],
  ['SQL aggregate without terminator', 'SELECT count(*) FROM customers'],
  ['SQL aggregate with qualified table', 'select COUNT(*) from public.customers'],
  ['SQL scalar literal without terminator', 'SELECT 1'],
  ['SQL scalar decimal and alias', 'SELECT -12.50 AS test_value'],
  ['SQL scalar function without terminator', 'SELECT pg_sleep(1)'],
  ['SQL common table expression', 'WITH recent AS (SELECT * FROM customers) SELECT * FROM recent'],
  ['SQL recursive common table expression', 'WITH RECURSIVE items AS (SELECT 1) SELECT * FROM items'],
  ['SQL describe without terminator', 'DESCRIBE customers'],
  ['SQL desc with qualified table', 'DESC public.customers'],
  ['SQL transaction setting without terminator', 'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE'],
  ['SQL session transaction characteristics', 'SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY'],
  ['SQL aggregate with tabs and newlines', 'SELECT\tcount(*)\nFROM\tcustomers'],
  ['SQL aggregate after delimiter', 'Query:\nSELECT sum(total) FROM invoices'],
  ['SQL aggregate with comment obfuscation', 'SELECT/**/count(*)/**/FROM/**/customers'],
  ['SQL aggregate with NFKC keywords', 'ＳＥＬＥＣＴ count(*) ＦＲＯＭ customers'],
  ['SQL aggregate with invisible formatting', 'SE\u200bLECT count(*) FR\u2060OM customers'],
  ['Python docstring class', 'class Example:\n    """Service model."""'],
  ['Python single-quoted docstring class', "class Example:\n    '''Service model.'''"] ,
  ['Python annotated class', 'class Example:\n    value: int'],
  ['Python decorated annotated class', '@dataclass\nclass Example:\n    value: int'],
  ['Python decorator call and class', '@registry.register("example")\nclass Example:\n    value: int'],
  ['Python lambda assignment', 'handler = lambda value: value'],
  ['Python annotated lambda assignment', 'handler: Callable = lambda value: value'],
  ['Python NFKC class declaration', 'ｃｌａｓｓ Example:\n    value: int'],
  ['Java package declaration', 'package com.example;'],
  ['Java record declaration', 'record Example(int value) {}'],
  ['Java public record declaration', 'public record Example(int value) {}'],
  ['Java enum declaration', 'enum Example { ONE, TWO }'],
  ['Java package with invisible formatting', 'pack\u200bage com.example;'],
  ['C# namespace declaration', 'namespace Example;'],
  ['C# braced namespace declaration', 'namespace Example { class Service {} }'],
  ['C# extern alias declaration', 'extern alias Example;'],
  ['C# NFKC namespace declaration', 'ｎａｍｅｓｐａｃｅ Example;'],
  ['POSIX if statement', 'if true; then :; fi'],
  ['POSIX newline if statement', 'if command -v deploy\nthen\n  deploy\nfi'],
  ['POSIX case statement', 'case value in one) : ;; esac'],
  ['POSIX newline case statement', 'case "$value" in\n  one) deploy ;;\nesac'],
  ['POSIX newline until loop', 'until false\ndo\n  :\ndone'],
  ['POSIX newline while loop', 'while true\ndo\n  deploy\ndone'],
  ['POSIX brace compound command', '{ command -v deploy; deploy; }'],
  ['POSIX subshell compound command', '(cd /tmp && deploy)'],
  ['POSIX NFKC control statement', 'ｉｆ true; ｔｈｅｎ :; ｆｉ'],
  ['PowerShell arbitrary quoted call', "Recommended action: & 'deploy' --force"],
  ['PowerShell arbitrary double-quoted call', 'Recommended action: & "deploy" --target production'],
  ['PowerShell dynamic expression call', "Recommended action: & ('deploy' + '.exe') --force"],
  ['PowerShell variable call', 'Recommended action: & $handler --force'],
  ['PowerShell environment variable call', 'Recommended action: & $env:DEPLOY_TOOL --force'],
  ['PowerShell command-discovery call', 'Recommended action: & (Get-Command deploy) --force'],
  ['PowerShell NFKC call operator', "Recommended action: ＆ 'deploy' --force"],
]);

// Exact immutable corpus from the independent 7d23da7 final audit. Keep this separate
// from the earlier writer corpus so future reviews can prove every discovered adjacent
// executable grammar remains closed rather than relying on representative examples.
const FINAL_AUDIT_EXECUTABLE_GRAMMARS = Object.freeze([
  ['nested SQL aggregate', 'SELECT coalesce(sum(total), 0) FROM invoices'],
  ['SQL FILTER aggregate', 'SELECT count(*) FILTER (WHERE active) FROM customers'],
  ['SQL window aggregate', 'SELECT count(*) OVER () FROM customers'],
  ['parenthesized SQL scalar', 'SELECT (1)'],
  ['VALUES CTE', 'WITH recent AS (VALUES (1)) SELECT * FROM recent'],
  ['extended DESCRIBE', 'DESCRIBE FORMATTED customers'],
  ['SET LOCAL transaction', 'SET LOCAL TRANSACTION ISOLATION LEVEL SERIALIZABLE'],
  ['transaction snapshot', "SET TRANSACTION SNAPSHOT '0001'"],
  ['single-segment Java package', 'package example;'],
  ['spaced Java package', 'package com . example;'],
  ['C# global alias import', 'using Alias = global::Example.Tools;'],
  ['inline Python class body', 'class Example: "Service model"'],
  ['multiline Python base list', 'class Example(\n    Base\n):\n    pass'],
  ['parenthesized Python lambda', 'handler = (lambda value: value)'],
  ['bare Python lambda', 'lambda value: value'],
  ['POSIX arithmetic for', 'for ((i=0; i<3; i++)); do echo ok; done'],
  ['POSIX newline compound', '{ echo ok\n}'],
  ['novel command redirection', 'deploy production > output.txt'],
  ['NFKC nested aggregate', 'ＳＥＬＥＣＴ coalesce(sum(total), 0) ＦＲＯＭ invoices'],
  ['invisible nested aggregate', 'SE\u200bLECT coalesce(sum(total), 0) FR\u2060OM invoices'],
]);

const STRUCTURAL_MUTATION_GRAMMARS = Object.freeze([
  ['SQL mixed case and tabs', 'sElEcT\tCOALESCE(SUM(total), 0)\tFrOm\tinvoices'],
  ['SQL comments and delimiter', 'Query:\nSELECT/* bounded */coalesce(sum(total), 0)/* source */FROM invoices'],
  ['SQL nested scalar alias', 'SELECT (coalesce(sum(total), 0)) AS invoice_total FROM invoices'],
  ['SQL VALUES CTE whitespace', 'with recent(value) as (\n values (1), (2)\n)\nselect * from recent'],
  ['SQL transaction comma modes', 'SET LOCAL TRANSACTION READ ONLY, DEFERRABLE'],
  ['SQL transaction snapshot semicolon', "SET TRANSACTION SNAPSHOT 'snapshot-1';"],
  ['Java package tabs', 'package\tcom .\texample ;'],
  ['C# alias whitespace', 'using\tAlias\t=\tglobal :: Example.Tools ;'],
  ['Python class string body', "class SurveyJob:\n    'Executable source body'"],
  ['Python multiline bases and ellipsis', 'class SurveyJob(\n    Base,\n    MixIn\n):\n    ...'],
  ['Python parenthesized annotated lambda', 'handler: Callable = ( lambda value : value )'],
  ['Python bare lambda NFKC', 'ｌａｍｂｄａ value: value'],
  ['POSIX arithmetic loop multiline', 'for (( i = 0; i < 3; i++ ))\ndo\n  echo ok\ndone'],
  ['POSIX brace compound semicolonless', '{\n echo ok\n}'],
  ['generic stderr redirection', 'deploy production 2> errors.txt'],
  ['generic append redirection', 'deploy production >> output.txt'],
]);

// Exact terminal-audit corpus. This remains immutable evidence of the language
// families that bypassed policy v7; the correction below must not special-case
// only the representative strings from the audit report.
const TERMINAL_AUDIT_EXECUTABLE_GRAMMARS = Object.freeze([
  ['SQL derived table', 'SELECT * FROM (SELECT 1) AS x'],
  ['SQL derived table newline', 'SELECT id\nFROM (SELECT id FROM jobs) AS recent'],
  ['SQL TABLE command', 'TABLE invoices'],
  ['SQL VALUES command', "VALUES (1, 'open'), (2, 'closed')"],
  ['SQL SET LOCAL', "SET LOCAL work_mem TO '64MB'"],
  ['SQL SET timeout', 'SET statement_timeout = 5000'],
  ['SQL SHOW', 'SHOW search_path'],
  ['SQL RESET', 'RESET ALL'],
  ['SQL EXPLAIN', 'EXPLAIN SELECT * FROM invoices'],
  ['SQL VACUUM options', 'VACUUM (ANALYZE) jobs'],
  ['SQL TRUNCATE', 'TRUNCATE TABLE invoice_items'],
  ['SQL GRANT', 'GRANT SELECT ON invoices TO analyst'],
  ['SQL REVOKE', 'REVOKE UPDATE ON jobs FROM contractor'],
  ['SQL DO block', "DO $$ BEGIN RAISE NOTICE 'x'; END $$"],
  ['SQL PREPARE', 'PREPARE q(int) AS SELECT * FROM jobs WHERE id = $1'],
  ['SQL EXECUTE', 'EXECUTE q(42)'],
  ['SQL DEALLOCATE', 'DEALLOCATE q'],
  ['SQL MERGE', 'MERGE INTO jobs j USING staging s ON j.id=s.id WHEN MATCHED THEN UPDATE SET status=s.status'],
  ['SQL window', 'SELECT sum(amount) OVER (PARTITION BY customer_id) FROM invoices'],
  ['SQL subquery', 'SELECT id FROM jobs WHERE id IN (SELECT job_id FROM invoices)'],
  ['JavaScript return', 'return total + tax'],
  ['JavaScript yield', 'yield invoice'],
  ['JavaScript await', 'await sendInvoice(customer)'],
  ['JavaScript arrow', 'items.map(item => item.total)'],
  ['JavaScript class', 'class Invoice extends Record { total() { return 1; } }'],
  ['JavaScript side-effect import', "import './billing.js'"],
  ['JavaScript export', 'export default function quote() { return 42 }'],
  ['CommonJS module', 'module.exports = { quote: () => 42 }'],
  ['Java module', 'module com.northstar.billing { requires java.sql; }'],
  ['Java record', 'record Invoice(int id, double total) {}'],
  ['Java annotation', '@Override public String toString() { return "invoice"; }'],
  ['C# record struct', 'record struct Job(int Id, decimal Total);'],
  ['C# using alias', 'using Money = System.Decimal;'],
  ['C# property', 'public decimal Total { get; init; }'],
  ['Go function', 'func quote(total float64) float64 { return total * 1.2 }'],
  ['Go switch', 'switch status { case "open": closeJob() }'],
  ['Rust function', 'fn quote(total: f64) -> f64 { total * 1.2 }'],
  ['Rust use', 'use std::collections::HashMap;'],
  ['Python comprehension', '[item.total for item in invoices if item.open]'],
  ['Python dict comprehension', '{job.id: job.total for job in jobs}'],
  ['Python generator', '(item for item in invoices if item.paid)'],
  ['Python match', 'match status:\n    case "open":\n        close_job()'],
  ['Python decorator', '@dataclass\nclass Invoice:\n    total: float'],
  ['Python with', "with open('invoice.txt') as handle:\n    data = handle.read()"],
  ['Python raise', "raise ValueError('invalid quote')"],
  ['Python yield from', 'yield from invoices'],
  ['Python assert', 'assert total >= 0'],
  ['Python del', 'del invoices[0]'],
  ['Python async for', 'async for job in jobs:\n    await process(job)'],
  ['shell assignment command', 'RATE=125 calculate_quote job-42'],
  ['shell assignment', 'RATE=125'],
  ['shell substitution', 'total=$(calculate_quote job-42)'],
  ['shell pipeline', 'cat invoices.csv | awk -F, \'{sum += $4} END {print sum}\''],
  ['shell and-or', 'test -f invoice.pdf && sendmail customer@example.com'],
  ['shell case', 'case "$status" in open) close_job ;; esac'],
  ['shell until', 'until test -f ready; do sleep 1; done'],
  ['shell function', 'quote() { printf "%s\\n" "$1"; }'],
  ['shell here-document', "cat <<'EOF' > invoice.txt\namount=42\nEOF"],
  ['shell process substitution', 'diff <(sort expected) <(sort actual)'],
  ['shell arithmetic', 'total=$(( labor + materials ))'],
  ['PowerShell static call', "[System.IO.File]::ReadAllText('invoice.txt')"],
  ['PowerShell pipeline', 'Get-Content invoice.txt | Set-Content copy.txt'],
  ['PowerShell variable', '$total = $labor + $materials'],
  ['PowerShell foreach', 'foreach ($job in $jobs) { Invoke-Quote $job }'],
  ['PowerShell if', 'if ($paid) { Send-Invoice } else { Write-Warning "unpaid" }'],
  ['PowerShell function', 'function Get-Quote { param($Job) return $Job.Total }'],
  ['batch set', 'set TOTAL=125'],
  ['batch if', 'if exist invoice.txt del invoice.txt'],
  ['batch for', 'for %%f in (*.csv) do type %%f'],
  ['POSIX path redirection', './quote --job 42 > ./invoice.txt'],
  ['Windows path redirection', 'quote.exe --job 42 > C:\\Temp\\invoice.txt'],
  ['fullwidth SQL', 'ＳＥＬＥＣＴ * ＦＲＯＭ invoices'],
  ['fullwidth shell', 'ｃａｔ invoice.txt | ｓｏｒｔ'],
  ['zero-width SQL', 'SEL\u200bECT * FROM invoices'],
  ['zero-width shell', 'c\u200bat invoice.txt | sort'],
  ['split SQL token', 'SEL\nECT * FROM invoices'],
  ['comment-split import', 'im/**/port java.util.List;'],
  ['nested command', '(cd /tmp && ./quote) > invoice.txt'],
  ['quoted eval', 'eval("SELECT * FROM invoices")'],
  ['SQL comment prefix', '-- execute below\nSELECT * FROM invoices'],
  ['Python comment prefix', '# execute below\nprint(calculate_quote(job))'],
]);

// Independently reasoned families beyond either audit corpus. These exercise a
// general positive presentation contract across declarative source, build and
// configuration formats, additional control-flow grammars, and evasive layout.
const POSITIVE_CONTRACT_HOSTILE_GRAMMARS = Object.freeze([
  ['SQL TABLE ONLY', 'TABLE ONLY invoice_archive'],
  ['SQL SET ROLE', 'SET ROLE reporting_user'],
  ['SQL COPY', "COPY invoices TO '/tmp/invoices.csv' CSV HEADER"],
  ['SQL CREATE VIEW', 'CREATE VIEW open_jobs AS SELECT id FROM jobs'],
  ['SQL function block', 'DO $body$ BEGIN PERFORM refresh_jobs(); END $body$'],
  ['SQL cursor', 'DECLARE invoice_cursor CURSOR FOR SELECT id FROM invoices'],
  ['TypeScript interface', 'interface Invoice { total: number; }'],
  ['TypeScript type alias', 'type InvoiceId = string | number;'],
  ['JavaScript try catch', 'try { sendInvoice() } catch (error) { retry(error) }'],
  ['JavaScript object literal', 'const invoice = { total: 42, paid: false }'],
  ['JavaScript optional chain call', 'invoice?.customer?.notify()'],
  ['JavaScript delete expression', 'delete invoice.internalNotes'],
  ['Python async function', 'async def send_invoice(job):\n    await client.send(job)'],
  ['Python try except', 'try:\n    send_invoice()\nexcept RuntimeError:\n    retry()'],
  ['Python walrus', 'while job := queue.next():\n    process(job)'],
  ['Python import from', 'from billing.invoice import calculate_total'],
  ['Python f-string assignment', 'message = f"Total: {invoice.total}"'],
  ['PowerShell binding', '[CmdletBinding()]\nparam([string]$InvoiceId)'],
  ['PowerShell script block', '$jobs | Where-Object { $_.Status -eq "open" }'],
  ['PowerShell try catch', 'try { Send-Invoice } catch { Write-Error $_ }'],
  ['PowerShell splat', 'Send-Invoice @invoiceParameters'],
  ['batch echo off', '@echo off\nsetlocal enabledelayedexpansion'],
  ['batch call', 'call :calculate_total invoice.csv'],
  ['batch goto', 'if errorlevel 1 goto failed'],
  ['batch delayed variable', 'echo !INVOICE_TOTAL!'],
  ['POSIX shebang', '#!/usr/bin/env sh\nprintf "%s\\n" "$TOTAL"'],
  ['POSIX command group', '( calculate_quote "$job" )'],
  ['POSIX parameter expansion', 'total=${subtotal:-0}'],
  ['POSIX conditional', '[[ -f invoice.pdf ]] && send_invoice'],
  ['POSIX select loop', 'select invoice in *.csv; do process "$invoice"; done'],
  ['Kotlin function', 'fun quote(total: Double): Double = total * 1.2'],
  ['Swift declaration', 'let total = invoices.reduce(0) { $0 + $1.total }'],
  ['Rust implementation', 'impl Invoice { fn total(&self) -> f64 { self.total } }'],
  ['Go defer', 'defer invoice.Close()'],
  ['C preprocessor', '#define TAX_RATE 0.08'],
  ['C function prototype', 'double quote_total(double subtotal);'],
  ['Java method', 'public BigDecimal total() { return subtotal.add(tax); }'],
  ['C# expression property', 'public decimal Total => Subtotal + Tax;'],
  ['Jinja expression', '{{ customer.invoice.total }}'],
  ['Jinja control', '{% if invoice.open %}Send{% endif %}'],
  ['ERB expression', '<%= invoice.total %>'],
  ['GitHub expression', '${{ secrets.DEPLOY_TOKEN }}'],
  ['Handlebars block', '{{#each invoices}}{{total}}{{/each}}'],
  ['YAML source', 'services:\n  app:\n    image: northstar:latest'],
  ['TOML source', '[server]\nport = 8080'],
  ['INI source', '[billing]\nretry_count=3'],
  ['dotenv source', 'BILLING_MODE=live\nRETRY_COUNT=3'],
  ['Terraform source', 'resource "aws_s3_bucket" "invoices" { bucket = "records" }'],
  ['Dockerfile source', 'FROM node:24\nRUN npm ci\nCMD ["node", "server.js"]'],
  ['Make source', 'invoice.pdf: invoice.csv\n\trender-invoice invoice.csv'],
  ['GraphQL source', 'query Invoice($id: ID!) { invoice(id: $id) { total } }'],
  ['JSONata expression', '$sum(invoices.total)'],
  ['regex source', '/^(paid|open)$/i'],
  ['SQL token split with tabs', 'SE\tLE\tCT * FR\tOM invoices'],
  ['JavaScript comment split', 'ret/**/urn invoice.total'],
  ['PowerShell backtick split', 'Get-`\nContent invoice.txt'],
  ['batch caret split', 'fo^r %%f in (*.csv) do ty^pe %%f'],
  ['templating whitespace evasion', '{ { invoice.total } }'],
  ['source after label', 'Result source:\nreturn invoice.total'],
  ['configuration after label', 'Configuration:\nretries: 3\ntimeout: 10'],
]);

const POSITIVE_CONTRACT_PROSE = Object.freeze([
  'Export documentation may affect the delivery date.',
  'The export documentation may affect the delivery date.',
  'The SQL SELECT statement is described in the approved engineering review.',
  'The billing team may return the invoice to draft status after review.',
  'The grant covers equipment, installation labor, and safety training.',
  'The table shows invoice totals for the selected reporting period.',
  'The values in this estimate remain planning assumptions.',
  'The set includes three replacement filters and one thermostat.',
  'The customer asked us to show the labor and material totals separately.',
  'The reset procedure is documented for the licensed technician.',
  'The batch of invoices is scheduled for review on Friday.',
  'The shell of the damaged unit requires replacement.',
  'The interface design is ready for customer review.',
  'The function of the relay is explained in the technician notes.',
  'The module price includes installation and a two-year warranty.',
  'The class of service is commercial, not residential.',
  'The record remains pending because customer approval is unknown.',
  'The invoice total equals labor + materials for planning purposes.',
  'Revenue / active customers is presented as a monthly planning ratio.',
  'The 8% allowance covers ordinary material waste.',
  'The approved range is $1,200–$1,500 before optional work.',
  'The address is 42 Main Street, Suite 3.',
  'Contact billing@example.test if the remittance address changes.',
  'The private 10.0.0.0/24 network is used only during commissioning.',
  'Version 2.1 of the controller firmware is listed in the equipment record.',
  'Café façade repair — weather permitting — should take three working days.',
  'Materials: exterior primer and two finish coats.\nLabor: preparation, application, and cleanup.',
  'Would you like labor, materials, and taxes grouped separately?',
  'Unknown: permit timing may affect the projected start date.',
  'Evidence: the signed estimate lists the approved replacement unit.',
  'Advisory only: confirm structural requirements with a licensed engineer.',
  'Net 30 terms remain available after credit approval.',
  'Class A materials',
  'Export documentation',
  'PostgreSQL compatibility review',
  'HVAC, CRM, SMS, and API service review',
  'Tree service',
  'Customer statement',
  'Invoice total',
  'Monday appointment',
]);

const LEGITIMATE_PROSE = Object.freeze([
  'Node compatibility is verified for this service.',
  'Java compatibility is not yet verified.',
  'PowerShell maintenance remains a future engineering task.',
  'The Class A electrical service includes panel labeling.',
  'Select service from the menu before scheduling.',
  'Delete the duplicate customer note after approval.',
  'Using system availability records, schedule the appointment.',
  'Using System; schedule the approved service after confirming availability.',
  'The team imports equipment data through an approved integration.',
  'Import Java; compatibility can be reviewed next quarter.',
  'For each customer in the renewal group, confirm the selected plan.',
  'The deployment function is managed by the engineering team.',
  'Class Example: review the sample service plan with the customer.',
  'Select current user preferences from the customer profile.',
  'Delete from the estimate any optional work the customer declined.',
  'Run a diagnostic inspection at the scheduled visit.',
  'The shell-style awning requires two installers.',
  'Recommended action: contact the customer to confirm availability.',
  'The customer approved the add-on and asked for Tuesday.',
  'Net 30 payment terms apply to this estimate.',
  'The approved estimate uses Net 30 payment terms.',
  'Net 30 applies; the deposit is $1,250.00 and the balance is due September 15, 2026 at 3:30 PM.',
  'The HVAC diagnostic found a low-voltage control fault.',
  'The CRM API uses HTTPS and returns appointment availability.',
  'SMS delivery remains configured but not verified.',
  'PostgreSQL compatibility remains under review.',
  'Java compatibility is verified for this control panel.',
  'Ruby finish is required for the cabinet.',
  'The replacement node is scheduled for Friday.',
  'Select the approved service before preparing the estimate.',
  'Reset the customer filters before reviewing the new list.',
  'Checkpoint the project with the customer before ordering equipment.',
  'Cluster service calls by region for the monthly review.',
  'The equipment package includes the approved thermostat.',
  'Record the serial number after installation.',
  'The enum label appears only in the engineering specification.',
  'The namespace description belongs in the integration documentation.',
  'Describe the repair options in plain language for the customer.',
  'Set transaction expectations before collecting the deposit.',
  'The record count is included in the monthly operating report.',
  'The SQL report presents the coalesced invoice total as a business metric.',
  'The billing package includes one monthly invoice review.',
  'The customer class is listed as commercial service.',
  'The formatted customer description is ready for the estimate.',
  'The transaction snapshot is described in the approved engineering review.',
  'The implementation uses a global alias described in the integration notes.',
]);

const DISPLAY_FIELDS = Object.freeze([
  {
    label: 'response answer',
    response: (response, value) => { response.answer.text = value; },
    provider: (_envelope, payload, value) => { payload.answer.text = value; },
  },
  {
    label: 'card title',
    response: (response, value) => { response.cards[0].title = value; },
    provider: (_envelope, payload, value) => { payload.cards[0].title = value; },
  },
  {
    label: 'card subtitle',
    response: (response, value) => { response.cards[0].subtitle = value; },
    provider: (_envelope, payload, value) => { payload.cards[0].subtitle = value; },
  },
  {
    label: 'card answer',
    response: (response, value) => { response.cards[0].answer = value; },
    provider: (_envelope, payload, value) => { payload.cards[0].answer = value; },
  },
  {
    label: 'evidence label',
    response: (response, value) => { response.cards[0].evidence[0].label = value; },
    provider: (envelope, payload, value) => {
      envelope.untrustedContext.cards[0].evidence[0].label = value;
      payload.cards[0].evidence[0].label = value;
    },
  },
  {
    label: 'evidence value',
    response: (response, value) => { response.cards[0].evidence[0].value = value; },
    provider: (envelope, payload, value) => {
      envelope.untrustedContext.cards[0].evidence[0].value = value;
      payload.cards[0].evidence[0].value = value;
    },
  },
  {
    label: 'unknown label',
    response: (response, value) => { response.cards[0].unknowns[0].label = value; },
    provider: (envelope, payload, value) => {
      envelope.untrustedContext.cards[0].unknowns[0].label = value;
      payload.cards[0].unknowns[0].label = value;
    },
  },
  {
    label: 'confidence basis',
    response: (response, value) => { response.cards[0].confidence.basis = value; },
    provider: (envelope, payload, value) => {
      envelope.untrustedContext.cards[0].confidence.basis = value;
      payload.cards[0].confidence.basis = value;
    },
  },
]);

const ADJACENT_FAMILY_REPRESENTATIVES = Object.freeze([
  ['SQL aggregate', 'SELECT count(*) FROM customers'],
  ['Python annotated class', 'class Example:\n    value: int'],
  ['Java record', 'record Example(int value) {}'],
  ['C# namespace', 'namespace Example;'],
  ['POSIX if', 'if true; then :; fi'],
  ['PowerShell dynamic call', "Recommended action: & ('deploy' + '.exe') --force"],
]);

const CROSS_BOUNDARY_CASES = Object.freeze(DISPLAY_FIELDS.flatMap(field =>
  ADJACENT_FAMILY_REPRESENTATIVES.map(([family, value]) => [family, field.label, field, value])
));

const LEGITIMATE_FIELD_CASES = Object.freeze(DISPLAY_FIELDS.flatMap(field =>
  LEGITIMATE_PROSE.map(value => [field.label, value, field])
));

const FINAL_AUDIT_FIELD_CASES = Object.freeze(FINAL_AUDIT_EXECUTABLE_GRAMMARS.flatMap(([family, value]) =>
  DISPLAY_FIELDS.map(field => [family, field.label, field, value])
));

const STRUCTURAL_MUTATION_FIELD_CASES = Object.freeze(STRUCTURAL_MUTATION_GRAMMARS.flatMap(([family, value]) =>
  DISPLAY_FIELDS.map(field => [family, field.label, field, value])
));

const POSITIVE_CONTRACT_FIELD_REPRESENTATIVES = Object.freeze([
  POSITIVE_CONTRACT_HOSTILE_GRAMMARS[0],
  POSITIVE_CONTRACT_HOSTILE_GRAMMARS[4],
  POSITIVE_CONTRACT_HOSTILE_GRAMMARS[6],
  POSITIVE_CONTRACT_HOSTILE_GRAMMARS[12],
  POSITIVE_CONTRACT_HOSTILE_GRAMMARS[17],
  POSITIVE_CONTRACT_HOSTILE_GRAMMARS[21],
  POSITIVE_CONTRACT_HOSTILE_GRAMMARS[25],
  POSITIVE_CONTRACT_HOSTILE_GRAMMARS[30],
  POSITIVE_CONTRACT_HOSTILE_GRAMMARS[34],
  POSITIVE_CONTRACT_HOSTILE_GRAMMARS[38],
  POSITIVE_CONTRACT_HOSTILE_GRAMMARS[43],
  POSITIVE_CONTRACT_HOSTILE_GRAMMARS[47],
  POSITIVE_CONTRACT_HOSTILE_GRAMMARS[50],
  POSITIVE_CONTRACT_HOSTILE_GRAMMARS[53],
  POSITIVE_CONTRACT_HOSTILE_GRAMMARS[57],
  POSITIVE_CONTRACT_HOSTILE_GRAMMARS[59],
]);

const POSITIVE_CONTRACT_FIELD_CASES = Object.freeze(POSITIVE_CONTRACT_FIELD_REPRESENTATIVES.flatMap(
  ([family, value]) => DISPLAY_FIELDS.map(field => [family, field.label, field, value])
));

const POSITIVE_CONTRACT_PROSE_FIELD_CASES = Object.freeze(POSITIVE_CONTRACT_PROSE.flatMap(value =>
  DISPLAY_FIELDS.map(field => [field.label, value, field])
));

function authority() {
  return { organizationId: ORG, userId: USER, role: 'owner' };
}

function selected() {
  return { kind: 'lead', id: LEAD };
}

function canonicalItem() {
  return {
    ids: { graph: GRAPH, customer: CUSTOMER, opportunity: LEAD, appointment: null, polarisSnapshot: SNAPSHOT },
    customer: { name: 'Professional Grammar Customer' },
    opportunity: { serviceType: 'HVAC', scope: 'Inspect the selected unit.' },
    estimate: { customerPrice: null },
    appointment: { scheduledStart: null },
    facts: [{
      id: FACT,
      variable: 'job_scope',
      status: 'accepted',
      normalizedValue: 'Inspect the selected unit.',
      evidenceText: 'The customer requested an inspection.',
      confidence: 0.8,
    }],
    snapshot: { notCalculated: ['Price is unknown.'] },
    snapshotDigest: 'a'.repeat(64),
    projectionDigest: 'b'.repeat(64),
    calculationVersion: 'p6-professional-grammar-correction-v1',
    readModelVersion: 'm22-part1-read-v1',
  };
}

function requestContract() {
  return validateMessageRequest({
    schemaVersion: MESSAGE_REQUEST_SCHEMA,
    idempotencyKey: KEY,
    message: 'Summarize the selected record.',
    selected: selected(),
  });
}

function localResponse() {
  return buildContextResponse(canonicalItem(), selected(), authority(), KEY);
}

function interceptedResponseWith(value) {
  const response = JSON.parse(JSON.stringify(localResponse()));
  response.responseId = 'professional-grammar-interceptor-response';
  response.source = 'interceptor';
  response.answer.text = value;
  return response;
}

function providerPayload(envelope) {
  const cards = JSON.parse(JSON.stringify(envelope.untrustedContext.cards));
  cards[0].answer = 'Inspect the selected unit and confirm the approved visit details.';
  return {
    answer: {
      evidenceCount: cards.reduce((sum, card) => sum + card.evidence.length, 0),
      text: cards[0].answer,
      unknownCount: cards.reduce((sum, card) => sum + card.unknowns.length, 0),
    },
    cards,
  };
}

function fakeProviderResponse(payload) {
  return {
    id: 'resp_professional_grammar_fake',
    status: 'completed',
    incomplete_details: null,
    output_text: JSON.stringify(payload),
    output: [],
    usage: {
      input_tokens: 20,
      output_tokens: 20,
      total_tokens: 40,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    },
  };
}

function mutableEnvelope() {
  return buildRuntimeEnvelope(
    requestContract(),
    authority(),
    JSON.parse(JSON.stringify(localResponse()))
  );
}

function assertServerAndBrowserReject(response) {
  expect(() => boundedInterceptedResponse(response, requestContract(), authority()))
    .toThrow(expect.objectContaining({ code: 'POLARIS_INTERCEPTED_RESPONSE_INVALID', statusCode: 502 }));
  expect(() => cardRenderer.validateAssistantResponse(response, {
    requestId: KEY,
    authority: authority(),
    selected: selected(),
    source: 'interceptor',
  })).toThrow('Unsupported Polaris structured contract.');
}

describe('P6 professional-text executable grammar correction', () => {
  test.each(TERMINAL_AUDIT_EXECUTABLE_GRAMMARS)(
    'rejects terminal-audit executable source %s under the shared policy',
    (_label, value) => {
      expect(professionalTextPolicy.isProfessionalText(value)).toBe(false);
    }
  );

  test.each(POSITIVE_CONTRACT_HOSTILE_GRAMMARS)(
    'rejects independently reasoned positive-contract source %s under the shared policy',
    (_label, value) => {
      expect(professionalTextPolicy.isProfessionalText(value)).toBe(false);
    }
  );

  test.each(POSITIVE_CONTRACT_FIELD_CASES)(
    'rejects positive-contract %s in the server/browser %s before any partial response',
    (_family, _fieldLabel, field, value) => {
      const response = interceptedResponseWith('The selected record is ready for review.');
      field.response(response, value);
      assertServerAndBrowserReject(response);
    }
  );

  test.each(POSITIVE_CONTRACT_FIELD_CASES)(
    'rejects positive-contract %s in the fake-provider %s',
    async (_family, _fieldLabel, field, value) => {
      const envelope = mutableEnvelope();
      const payload = providerPayload(envelope);
      field.provider(envelope, payload, value);
      let calls = 0;
      const runtime = createOpenAIRuntime({
        configured: true,
        enabled: true,
        client: {
          responses: {
            create: async () => {
              calls += 1;
              return fakeProviderResponse(payload);
            },
          },
        },
        logger: () => {},
      });

      await expect(runtime.respond(envelope)).rejects.toMatchObject({
        code: 'POLARIS_PROVIDER_RESPONSE_INVALID',
        statusCode: 502,
      });
      expect(calls).toBe(1);
    }
  );

  test.each(POSITIVE_CONTRACT_PROSE)(
    'preserves independently reasoned positive-contract prose: %s',
    value => {
      expect(professionalTextPolicy.isProfessionalText(value)).toBe(true);
    }
  );

  test.each(POSITIVE_CONTRACT_PROSE_FIELD_CASES)(
    'preserves independently reasoned positive-contract prose in the %s: %s',
    (_fieldLabel, value, field) => {
      const response = interceptedResponseWith('The selected record is ready for review.');
      field.response(response, value);
      expect(boundedInterceptedResponse(response, requestContract(), authority())).toBe(response);
      expect(cardRenderer.validateAssistantResponse(response, {
        requestId: KEY,
        authority: authority(),
        selected: selected(),
        source: 'interceptor',
      })).toBe(response);
    }
  );

  test.each(HOSTILE_GRAMMARS)('rejects %s at the shared, server, and browser boundaries', (_label, value) => {
    expect(professionalTextPolicy.isProfessionalText(value)).toBe(false);

    const response = interceptedResponseWith(value);
    expect(() => boundedInterceptedResponse(response, requestContract(), authority()))
      .toThrow(expect.objectContaining({ code: 'POLARIS_INTERCEPTED_RESPONSE_INVALID', statusCode: 502 }));
    expect(() => cardRenderer.validateAssistantResponse(response, {
      requestId: KEY,
      authority: authority(),
      selected: selected(),
      source: 'interceptor',
    })).toThrow('Unsupported Polaris structured contract.');
  });

  test.each(HOSTILE_GRAMMARS)('rejects %s from a fully intercepted fake Responses client', async (_label, value) => {
    const envelope = mutableEnvelope();
    const payload = providerPayload(envelope);
    payload.answer.text = value;
    let calls = 0;
    const runtime = createOpenAIRuntime({
      configured: true,
      enabled: true,
      client: {
        responses: {
          create: async () => {
            calls += 1;
            return fakeProviderResponse(payload);
          },
        },
      },
      logger: () => {},
    });
    await expect(runtime.respond(envelope)).rejects.toMatchObject({
      code: 'POLARIS_PROVIDER_RESPONSE_INVALID',
      statusCode: 502,
    });
    expect(calls).toBe(1);
  });

  test.each(FINAL_AUDIT_EXECUTABLE_GRAMMARS)(
    'rejects exact independent-audit %s through the shared policy',
    (_label, value) => {
      expect(professionalTextPolicy.isProfessionalText(value)).toBe(false);
    }
  );

  test.each(FINAL_AUDIT_FIELD_CASES)(
    'rejects exact independent-audit %s in the server/browser %s',
    (_family, _fieldLabel, field, value) => {
      const response = interceptedResponseWith('The selected record is ready for review.');
      field.response(response, value);
      assertServerAndBrowserReject(response);
    }
  );

  test.each(FINAL_AUDIT_FIELD_CASES)(
    'rejects exact independent-audit %s in the fake-provider %s',
    async (_family, _fieldLabel, field, value) => {
      const envelope = mutableEnvelope();
      const payload = providerPayload(envelope);
      field.provider(envelope, payload, value);
      let calls = 0;
      const runtime = createOpenAIRuntime({
        configured: true,
        enabled: true,
        client: {
          responses: {
            create: async () => {
              calls += 1;
              return fakeProviderResponse(payload);
            },
          },
        },
        logger: () => {},
      });

      await expect(runtime.respond(envelope)).rejects.toMatchObject({
        code: 'POLARIS_PROVIDER_RESPONSE_INVALID',
        statusCode: 502,
      });
      expect(calls).toBe(1);
    }
  );

  test.each(STRUCTURAL_MUTATION_GRAMMARS)(
    'rejects structurally mutated %s through the shared policy',
    (_label, value) => {
      expect(professionalTextPolicy.isProfessionalText(value)).toBe(false);
    }
  );

  test.each(STRUCTURAL_MUTATION_FIELD_CASES)(
    'rejects structurally mutated %s in the server/browser %s',
    (_family, _fieldLabel, field, value) => {
      const response = interceptedResponseWith('The selected record is ready for review.');
      field.response(response, value);
      assertServerAndBrowserReject(response);
    }
  );

  test.each(CROSS_BOUNDARY_CASES)(
    'rejects adjacent %s grammar in the server/browser %s before any partial response',
    (_family, _fieldLabel, field, value) => {
      const response = interceptedResponseWith('The selected record is ready for review.');
      field.response(response, value);
      assertServerAndBrowserReject(response);
    }
  );

  test.each(CROSS_BOUNDARY_CASES)(
    'rejects adjacent %s grammar in the intercepted-provider %s',
    async (_family, _fieldLabel, field, value) => {
      const envelope = mutableEnvelope();
      const payload = providerPayload(envelope);
      field.provider(envelope, payload, value);
      let calls = 0;
      const runtime = createOpenAIRuntime({
        configured: true,
        enabled: true,
        client: {
          responses: {
            create: async () => {
              calls += 1;
              return fakeProviderResponse(payload);
            },
          },
        },
        logger: () => {},
      });

      await expect(runtime.respond(envelope)).rejects.toMatchObject({
        code: 'POLARIS_PROVIDER_RESPONSE_INVALID',
        statusCode: 502,
      });
      expect(calls).toBe(1);
    }
  );

  test.each(LEGITIMATE_PROSE)('preserves legitimate professional prose: %s', value => {
    expect(professionalTextPolicy.isProfessionalText(value)).toBe(true);

    const response = interceptedResponseWith(value);
    expect(boundedInterceptedResponse(response, requestContract(), authority())).toBe(response);
    expect(cardRenderer.validateAssistantResponse(response, {
      requestId: KEY,
      authority: authority(),
      selected: selected(),
      source: 'interceptor',
    })).toBe(response);
  });

  test.each(LEGITIMATE_FIELD_CASES)(
    'preserves ordinary professional prose in the %s: %s',
    (_fieldLabel, value, field) => {
      const response = interceptedResponseWith('The selected record is ready for review.');
      field.response(response, value);
      expect(boundedInterceptedResponse(response, requestContract(), authority())).toBe(response);
      expect(cardRenderer.validateAssistantResponse(response, {
        requestId: KEY,
        authority: authority(),
        selected: selected(),
        source: 'interceptor',
      })).toBe(response);
    }
  );
});
