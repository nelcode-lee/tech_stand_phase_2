"""Extract plain text from DOCX, PDF, and legacy .doc files."""
import os
import tempfile
from io import BytesIO

# DOCX
try:
    from docx import Document as DocxDocument
except ImportError:
    DocxDocument = None

# PDF
try:
    from pypdf import PdfReader
except ImportError:
    PdfReader = None

# Legacy .doc (via Word COM on Windows, or pypandoc if available)
try:
    import win32com.client
    _WIN32COM_AVAILABLE = True
except ImportError:
    _WIN32COM_AVAILABLE = False


def extract_text_from_docx(file_bytes: bytes) -> str | None:
    """Extract plain text from a DOCX file."""
    if DocxDocument is None:
        return None
    try:
        doc = DocxDocument(BytesIO(file_bytes))
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        for table in doc.tables:
            for row in table.rows:
                for cell in row.cells:
                    if cell.text.strip():
                        paragraphs.append(cell.text.strip())
        return "\n\n".join(paragraphs) if paragraphs else None
    except Exception:
        return None


def extract_text_from_pdf(file_bytes: bytes) -> str | None:
    """Extract plain text from a PDF file."""
    if PdfReader is None:
        return None
    try:
        reader = PdfReader(BytesIO(file_bytes))
        parts = []
        for page in reader.pages:
            text = page.extract_text()
            if text and text.strip():
                parts.append(text.strip())
        return "\n\n".join(parts) if parts else None
    except Exception:
        return None


def extract_text_from_doc(file_bytes: bytes) -> str | None:
    """Extract plain text from a legacy .doc file. Uses Word COM on Windows if available."""
    if not _WIN32COM_AVAILABLE:
        return None
    try:
        with tempfile.NamedTemporaryFile(suffix=".doc", delete=False) as tmp:
            tmp.write(file_bytes)
            tmp_path = tmp.name
        try:
            word = win32com.client.Dispatch("Word.Application")
            word.Visible = False
            doc = word.Documents.Open(tmp_path)
            text = doc.Content.Text
            doc.Close(False)
            word.Quit()
            return text.strip() if text else None
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
    except Exception:
        return None


def extract_text(file_bytes: bytes, filename: str) -> str | None:
    """
    Extract plain text from a file. Supports .docx, .pdf, and legacy .doc.
    Returns None if format is unsupported or extraction fails.
    """
    if not filename:
        return None
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if ext == "docx":
        return extract_text_from_docx(file_bytes)
    if ext == "pdf":
        return extract_text_from_pdf(file_bytes)
    if ext == "doc":
        return extract_text_from_doc(file_bytes)
    return None


def supported_extensions() -> list[str]:
    """Return list of supported file extensions."""
    exts = []
    if DocxDocument:
        exts.append("docx")
    if PdfReader:
        exts.append("pdf")
    if _WIN32COM_AVAILABLE:
        exts.append("doc")
    return exts
