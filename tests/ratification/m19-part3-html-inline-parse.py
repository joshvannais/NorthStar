"""Parse every changed HTML document and syntax-check each complete inline script."""

from html.parser import HTMLParser
import json
import os
from pathlib import Path
import subprocess


PAGES = (
    "public/dashboard.html",
    "public/dashboard/calendar.html",
    "public/dashboard/command-center.html",
    "public/dashboard/communications.html",
    "public/dashboard/executive-brief.html",
    "public/dashboard/lead.html",
    "public/dashboard/leads.html",
    "public/dashboard/polaris.html",
)


class DocumentParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.inline_scripts = []
        self._script = None

    def handle_starttag(self, tag, attrs):
        if tag.lower() != "script":
            return
        attributes = dict(attrs)
        self._script = None if attributes.get("src") else []

    def handle_data(self, data):
        if self._script is not None:
            self._script.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "script" and self._script is not None:
            self.inline_scripts.append("".join(self._script))
            self._script = None

    def finish(self):
        self.close()
        if self._script is not None:
            raise ValueError("unterminated inline script")


def main():
    root = Path(__file__).resolve().parents[2]
    node = os.environ.get("NORTHSTAR_NODE_EXE", "node")
    script_count = 0
    for relative in PAGES:
        parser = DocumentParser()
        parser.feed((root / relative).read_text(encoding="utf-8"))
        parser.finish()
        for index, script in enumerate(parser.inline_scripts, start=1):
            result = subprocess.run(
                [node, "--check", "-"],
                input=script.encode("utf-8"),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
            if result.returncode:
                raise RuntimeError(
                    f"{relative} inline script {index} failed: "
                    + result.stderr.decode("utf-8", errors="replace")
                )
        script_count += len(parser.inline_scripts)
    print(json.dumps({"documents": len(PAGES), "inlineScripts": script_count, "exitCode": 0}))


if __name__ == "__main__":
    main()
