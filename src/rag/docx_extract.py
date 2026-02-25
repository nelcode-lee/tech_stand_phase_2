"""Extract plain text from DOCX files."""
from io import BytesIO

try:
    from docx import Document
except ImportError:
    Document = None


def extract_text_from_docx(file_bytes: bytes) -> str | None:
    """
    Extract plain text from a DOCX file.
    Returns None if extraction fails or python-docx is not installed.
    """
    if Document is None:
        return None
    try:
        doc = Document(BytesIO(file_bytes))
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        # Also extract text from tables
        for table in doc.tables:
            for row in table.rows:
                for cell in row.cells:
                    if cell.text.strip():
                        paragraphs.append(cell.text.strip())
        return "\n\n".join(paragraphs) if paragraphs else None
    except Exception:
        return None
