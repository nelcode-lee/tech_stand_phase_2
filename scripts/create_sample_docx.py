"""Create a minimal sample DOCX from sample_sop.txt for testing the ingest/file endpoint."""
from pathlib import Path

try:
    from docx import Document
except ImportError:
    print("Install python-docx: pip install python-docx")
    exit(1)

ROOT = Path(__file__).resolve().parent.parent
SAMPLE_TXT = ROOT / "sample_docs" / "sample_sop.txt"
OUT = ROOT / "sample_docs" / "sample_sop.docx"


def main():
    content = SAMPLE_TXT.read_text(encoding="utf-8")
    doc = Document()
    for para in content.split("\n"):
        doc.add_paragraph(para)
    doc.save(OUT)
    print(f"Created {OUT}")


if __name__ == "__main__":
    main()
