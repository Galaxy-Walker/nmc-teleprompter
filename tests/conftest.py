import io
import os
import zipfile

import pytest

# app.main resolves the access password at import time. Pin it for tests so
# they never depend on a developer's environment or write data/.access-password.
os.environ["TELEPROMPTER_PASSWORD"] = "test-pass"

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
MC = "http://schemas.openxmlformats.org/markup-compatibility/2006"

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"""

RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""

DOCUMENT = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="{W}" xmlns:mc="{MC}"
  xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
  xmlns:v="urn:schemas-microsoft-com:vml"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<w:body>
  <w:p><w:r><w:t>第一段</w:t></w:r></w:p>
  <w:p>
    <w:r>
      <mc:AlternateContent>
        <mc:Choice Requires="wps">
          <w:drawing>
            <wp:anchor>
              <a:graphic>
                <a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
                  <wps:wsp>
                    <wps:txbx>
                      <w:txbxContent>
                        <w:p><w:r><w:t>文本框内容</w:t></w:r></w:p>
                      </w:txbxContent>
                    </wps:txbx>
                  </wps:wsp>
                </a:graphicData>
              </a:graphic>
            </wp:anchor>
          </w:drawing>
        </mc:Choice>
        <mc:Fallback>
          <w:pict>
            <v:shape>
              <v:textbox>
                <w:txbxContent>
                  <w:p><w:r><w:t>文本框内容</w:t></w:r></w:p>
                </w:txbxContent>
              </v:textbox>
            </v:shape>
          </w:pict>
        </mc:Fallback>
      </mc:AlternateContent>
    </w:r>
  </w:p>
  <w:p><w:r><w:t>第三段</w:t></w:r></w:p>
</w:body>
</w:document>"""


def make_docx_bytes() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", CONTENT_TYPES)
        archive.writestr("_rels/.rels", RELS)
        archive.writestr("word/document.xml", DOCUMENT)
    return buffer.getvalue()


def make_zip_bytes(files: dict[str, str]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return buffer.getvalue()


@pytest.fixture
def docx_bytes() -> bytes:
    return make_docx_bytes()


@pytest.fixture
def docx_missing_document_bytes() -> bytes:
    return make_zip_bytes({"[Content_Types].xml": "<Types/>"})
