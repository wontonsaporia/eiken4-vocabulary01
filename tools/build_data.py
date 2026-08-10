#!/usr/bin/env python3
"""
Update data/data.js from the Excel master.
Usage:
    python tools/build_data.py downloads/eiken4_vocabulary.xlsx
"""
from pathlib import Path
import zipfile, xml.etree.ElementTree as ET, re, json, sys, datetime

xlsx = Path(sys.argv[1] if len(sys.argv)>1 else "downloads/eiken4_vocabulary.xlsx")
root_dir = Path(__file__).resolve().parents[1]
out = root_dir / "data" / "data.js"

NS_MAIN={"a":"http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
NS_PKG={"p":"http://schemas.openxmlformats.org/package/2006/relationships"}
RID="{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"

def colnum(ref):
    letters=re.match(r"[A-Z]+",ref).group()
    n=0
    for ch in letters:n=n*26+ord(ch)-64
    return n

with zipfile.ZipFile(xlsx) as z:
    shared=[]
    if "xl/sharedStrings.xml" in z.namelist():
        sr=ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in sr.findall("a:si",NS_MAIN):
            shared.append("".join(t.text or "" for t in si.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")))
    wb=ET.fromstring(z.read("xl/workbook.xml"))
    rel=ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    relmap={x.attrib["Id"]:x.attrib["Target"] for x in rel.findall("p:Relationship",NS_PKG)}
    paths={}
    for s in wb.find("a:sheets",NS_MAIN):
        target=relmap[s.attrib[RID]].lstrip("/")
        paths[s.attrib["name"]]=target if target.startswith("xl/") else "xl/"+target

    def sheet_rows(name):
        sr=ET.fromstring(z.read(paths[name]))
        rows=[]
        for row in sr.findall(".//a:sheetData/a:row",NS_MAIN):
            cells={};maxc=0
            for c in row.findall("a:c",NS_MAIN):
                cnum=colnum(c.attrib["r"]);maxc=max(maxc,cnum)
                typ=c.attrib.get("t");v=c.find("a:v",NS_MAIN)
                if typ=="s" and v is not None: val=shared[int(v.text)]
                elif typ=="inlineStr": val="".join(t.text or "" for t in c.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t"))
                elif v is not None: val=v.text or ""
                else: val=""
                cells[cnum]=val
            if maxc: rows.append([cells.get(i,"") for i in range(1,maxc+1)])
        return rows

    wr=sheet_rows("全単語一覧")
    pr=sheet_rows("熟語・表現")

word_map={"英単語":"word","日本語":"meaning","主品詞":"main_pos","品詞（複数用法）":"pos","分類":"category","名詞区分":"countability","名詞語法メモ":"noun_note","他の用法":"other_usage","優先度":"priority","語法参照":"reference"}
phrase_map={"熟語・表現":"phrase","日本語":"meaning","分類":"category","優先度":"priority","チェック":"check","照合資料URL":"reference"}

wh=wr[0];words=[]
for i,row in enumerate(wr[1:],1):
    row=row+[""]*(len(wh)-len(row))
    if not row[0]:continue
    d={word_map.get(k,k):v for k,v in zip(wh,row)}
    d["id"]=f"w{i:04d}"
    words.append(d)

ph=pr[0];phrases=[]
for i,row in enumerate(pr[1:],1):
    row=row+[""]*(len(ph)-len(row))
    if not row[0]:continue
    d={phrase_map.get(k,k):v for k,v in zip(ph,row)}
    d["id"]=f"p{i:04d}"
    phrases.append(d)

meta={
    "appVersion":"1.0.0",
    "generated":datetime.date.today().isoformat(),
    "wordCount":len(words),
    "phraseCount":len(phrases),
    "totalCount":len(words)+len(phrases),
    "priorityA":sum(1 for w in words if w.get("priority")=="A"),
    "priorityB":sum(1 for w in words if w.get("priority")=="B"),
}
out.write_text("window.EIKEN4_DATA="+json.dumps({"meta":meta,"words":words,"phrases":phrases},ensure_ascii=False,separators=(",",":"))+";\n",encoding="utf-8")
print(f"Updated {out}: {len(words)} words, {len(phrases)} phrases")
