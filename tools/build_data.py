#!/usr/bin/env python3
"""Build public/data.js from the Excel source-of-truth workbook.

Usage:
    python tools/build_data.py
    python tools/build_data.py source/eiken4_learning_master.xlsx

The workbook is human-editable. data/data.js is generated and should not be edited by hand.
"""
from pathlib import Path
import zipfile, xml.etree.ElementTree as ET, re, json, sys, datetime

ROOT = Path(__file__).resolve().parents[1]
XLSX = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "source" / "eiken4_learning_master.xlsx"
if not XLSX.is_absolute(): XLSX = ROOT / XLSX
OUT = ROOT / "data" / "data.js"

NS_MAIN={"a":"http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
NS_PKG={"p":"http://schemas.openxmlformats.org/package/2006/relationships"}
RID="{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"

def colnum(ref):
    letters=re.match(r"[A-Z]+",ref).group();n=0
    for ch in letters:n=n*26+ord(ch)-64
    return n

def split_multi(v):
    if not v:return []
    return [x.strip() for x in re.split(r"[;；|\n]+",str(v)) if x.strip()]

with zipfile.ZipFile(XLSX) as z:
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

def rows(name):
    if name not in paths:return []
    with zipfile.ZipFile(XLSX) as z2:
        sr=ET.fromstring(z2.read(paths[name]));out=[]
    for row in sr.findall(".//a:sheetData/a:row",NS_MAIN):
        cells={};maxc=0
        for c in row.findall("a:c",NS_MAIN):
            n=colnum(c.attrib["r"]);maxc=max(maxc,n);typ=c.attrib.get("t");v=c.find("a:v",NS_MAIN)
            if typ=="s" and v is not None:val=shared[int(v.text)]
            elif typ=="inlineStr":val="".join(t.text or "" for t in c.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t"))
            elif v is not None:val=v.text or ""
            else:val=""
            cells[n]=val
        if maxc:out.append([cells.get(i,"") for i in range(1,maxc+1)])
    return out

def dict_rows(raw):
    if not raw:return []
    h=[str(x or "").strip() for x in raw[0]];out=[]
    for r in raw[1:]:
        r=r+[""]*(len(h)-len(r))
        if not any(str(x).strip() for x in r):continue
        out.append({k:(v if v is not None else "") for k,v in zip(h,r) if k})
    return out

vrows=dict_rows(rows("Vocabulary_Master"))
prows=dict_rows(rows("Phrase_Master"))
qrows=dict_rows(rows("Question_Master"))
if not vrows:
    raise SystemExit("Vocabulary_Master sheet was not found or is empty.")

words=[]
seen_ids=set()
for r in vrows:
    wid=str(r.get("ID","")).strip();word=str(r.get("英単語","")).strip()
    if not wid or not word:continue
    if wid in seen_ids:raise SystemExit(f"Duplicate vocabulary ID: {wid}")
    seen_ids.add(wid)
    words.append({
        "id":wid,"word":word,"meaning":str(r.get("日本語","")).strip(),"level":str(r.get("レベル","4")).strip() or "4",
        "priority":str(r.get("優先度","")).strip(),"main_pos":str(r.get("主品詞","")).strip(),"pos":str(r.get("品詞（複数用法）","")).strip(),
        "category":str(r.get("分類","")).strip(),"countability":str(r.get("名詞区分","")).strip(),"noun_note":str(r.get("名詞語法メモ","")).strip(),
        "other_usage":str(r.get("他の用法","")).strip(),"ipa_us":str(r.get("IPA_US","")).strip(),"ipa_uk":str(r.get("IPA_UK","")).strip(),
        "accepted_answers":split_multi(r.get("許容解答","")),"example":str(r.get("例文","")).strip(),"collocation":str(r.get("コロケーション","")).strip(),
        "reference":str(r.get("語法参照","")).strip()
    })

phrases=[];seen_p=set()
for r in prows:
    pid=str(r.get("ID","")).strip();phrase=str(r.get("熟語・表現","")).strip()
    if not pid or not phrase:continue
    if pid in seen_p:raise SystemExit(f"Duplicate phrase ID: {pid}")
    seen_p.add(pid)
    phrases.append({
        "id":pid,"phrase":phrase,"meaning":str(r.get("日本語","")).strip(),"level":str(r.get("レベル","4")).strip() or "4",
        "priority":str(r.get("優先度","")).strip(),"category":str(r.get("分類","")).strip(),"accepted_answers":split_multi(r.get("許容解答","")),
        "example":str(r.get("例文","")).strip(),"reference":str(r.get("照合資料URL","")).strip()
    })

questions=[];seen_q=set()
for r in qrows:
    status=str(r.get("status","")).strip().lower()
    if status!="published":continue
    qid=str(r.get("ID","")).strip()
    if not qid:continue
    if qid in seen_q:raise SystemExit(f"Duplicate question ID: {qid}")
    seen_q.add(qid)
    questions.append({
        "id":qid,"level":str(r.get("レベル","")).strip(),"type":str(r.get("問題種別","")).strip(),"question":str(r.get("問題文","")).strip(),
        "choices":[str(r.get(f"選択肢{i}","")).strip() for i in range(1,5) if str(r.get(f"選択肢{i}","")).strip()],
        "answer":str(r.get("正答","")).strip(),"explanation":str(r.get("解説","")).strip(),"target_ids":split_multi(r.get("target_ids","")),
        "tags":split_multi(r.get("tags","")),"source":str(r.get("source","")).strip()
    })

meta={
    "appVersion":"2.0.0","generated":datetime.date.today().isoformat(),"wordCount":len(words),"phraseCount":len(phrases),"questionCount":len(questions),
    "totalCount":len(words)+len(phrases),"priorityA":sum(1 for w in words if w["priority"]=="A"),"priorityB":sum(1 for w in words if w["priority"]=="B")
}
payload={"meta":meta,"words":words,"phrases":phrases,"questions":questions}
OUT.write_text("window.EIKEN4_DATA="+json.dumps(payload,ensure_ascii=False,separators=(",",":"))+";\n",encoding="utf-8")
print(f"Built {OUT}: {len(words)} words / {len(phrases)} phrases / {len(questions)} published questions")
