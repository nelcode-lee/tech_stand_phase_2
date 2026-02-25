"""Find which document contains a given term."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from src.rag.file_extract import extract_text

FOLDER = Path(__file__).resolve().parent.parent / "sample_docs"
TERM = sys.argv[1] if len(sys.argv) > 1 else "Julian"


def main():
    for path in sorted(FOLDER.iterdir()):
        if not path.is_file():
            continue
        ext = path.suffix.lower()
        if ext == ".txt":
            content = path.read_text(encoding="utf-8", errors="replace")
        elif ext in (".docx", ".pdf"):
            raw = path.read_bytes()
            content = extract_text(raw, path.name) or ""
        else:
            continue
        if TERM.lower() in content.lower():
            # Find line(s) containing the term
            lines = content.split("\n")
            for i, line in enumerate(lines):
                if TERM.lower() in line.lower():
                    print(f"\n=== {path.name} (line ~{i+1}) ===")
                    print(line.strip()[:200])
        else:
            print(f"  (not in {path.name})")


if __name__ == "__main__":
    main()
