# Windsor review acquisition

This standalone review tool is not imported by the application. It does not publish a rule or change the runtime 32,768-byte ingestion limit.

Run `windsor_review.py --output <new-review-directory> --prior <pinned-regulation-directory>` only when source acquisition is authorized. Its HTML allowlist remains the two exact approved Connecticut URLs, capped at 65,536 bytes.

Capture reads through transport EOF. If Content-Length is present, the observed byte count must match it exactly; invalid lengths, shorter or longer bodies, interruption, and oversize responses fail before either output file is written. Without Content-Length, successful EOF is recorded as `transport-eof-without-declared-length` with `declaredLengthVerified: false`. This reports the available transport evidence, not proof against an origin ending a response prematurely without a declared size. Every result remains a review candidate.

Offline focused tests: `python tests/source_review/windsor_completion.py --output <new-result-file>`.
