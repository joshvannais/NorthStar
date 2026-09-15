"""Local source review only. Not imported by the application or its workers."""
from pathlib import Path
from html.parser import HTMLParser
import datetime, hashlib, json, re, urllib.request

OUT = Path(__file__).resolve().parent
PRIOR = OUT.parent / 'm24-windsor-reviewed-56c923d'
LIMIT = 65536
ALLOW = {
    'rate': ('https://portal.ct.gov/drs/sales-tax/tax-information', ('6.35', 'permit', 'local sales')),
    'exemption': ('https://portal.ct.gov/drs/sales-tax/exemptions-from-sales-and-use-taxes', ('CERT-121', 'total disability', 'landscaping')),
}
def digest(data): return hashlib.sha256(data).hexdigest()
def save(name, value): (OUT / name).write_text(json.dumps(value, indent=2, ensure_ascii=False)+'\n', encoding='utf-8')

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Redirect rejected')

class Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True); self.hidden=0; self.parts=[]; self.positions=[]
    def handle_starttag(self, tag, attrs):
        if tag in ('script','style'): self.hidden += 1
    def handle_endtag(self, tag):
        if tag in ('script','style'): self.hidden=max(0,self.hidden-1)
    def handle_data(self, data):
        if not self.hidden and data.strip(): self.parts.append(data.strip()); self.positions.append(self.getpos())

def extract(raw, needles):
    decoded=raw.decode('utf-8', errors='strict')
    parser=Text(); parser.feed(decoded)
    lines=decoded.splitlines(keepends=True)
    full='\n'.join(parser.parts)
    selected=[]
    for index, part in enumerate(parser.parts):
        if any(needle.casefold() in part.casefold() for needle in needles):
            start=max(0,index-1); end=min(len(parser.parts),index+2)
            text='\n'.join(parser.parts[start:end])
            line,column=parser.positions[index]
            rawStart=len((''.join(lines[:line-1])+lines[line-1][:column]).encode('utf-8'))
            selected.append({'text':text,'textStart':full.index(text),'textEnd':full.index(text)+len(text),'rawTextNodeStartByte':rawStart,
                             'matchingText':part, 'textNodeIndex':index})
    if not selected: raise ValueError('Required source anchors absent')
    carrier={'version':'review-only-html-extract-v1','rawSha256':digest(raw),
             'decodedTextSha256':digest(full.encode('utf-8')),'anchors':selected,
             'reviewStatus':'candidate-not-validated-or-published'}
    if len(json.dumps(carrier,ensure_ascii=False).encode('utf-8')) >= 32768:
        raise ValueError('Extracted carrier exceeds runtime boundary')
    return carrier

def acquire(name, url, opener=None):
    if name not in ALLOW or url != ALLOW[name][0]: raise ValueError('Source not allowlisted')
    opener=opener or urllib.request.build_opener(NoRedirect())
    with opener.open(urllib.request.Request(url,headers={'Accept':'text/html','User-Agent':'NorthStar-Local-Review/1'}),timeout=8) as response:
        if response.url != url or response.status != 200: raise ValueError('Unexpected source response')
        if response.headers.get_content_type() != 'text/html': raise ValueError('Unexpected content type')
        declared=response.headers.get('Content-Length')
        if declared is not None:
            if not re.fullmatch(r'[0-9]+',declared.strip(' \t')): raise ValueError('Invalid declared source length')
            declared=int(declared)
            if declared>LIMIT: raise ValueError('Declared source exceeds review limit')
        chunks=[]; observed=0
        while True:
            chunk=response.read(min(16384,LIMIT+1-observed))
            if not chunk: break
            chunks.append(chunk); observed+=len(chunk)
            if observed>LIMIT: raise ValueError('Source exceeds review limit')
        raw=b''.join(chunks)
        if declared is not None and len(raw)!=declared:
            raise ValueError('Source body does not match declared length')
    carrier=extract(raw,ALLOW[name][1])
    (OUT/(name+'.html')).write_bytes(raw)
    save(name+'-candidate.json',carrier)
    return {'url':url,'bytes':len(raw),'sha256':digest(raw),'carrierBytes':len((OUT/(name+'-candidate.json')).read_bytes()),'state':'review-candidate',
            'declaredLength':declared,'declaredLengthVerified':declared is not None,
            'completion':'declared-length-and-transport-eof' if declared is not None else 'transport-eof-without-declared-length'}

def regulation():
    from pypdf import PdfReader
    raw=(PRIOR/'regulation.pdf').read_bytes()
    assert digest(raw)=='43d26dd3f75242c6d37c6a5acd1874fd19975fd3dee8c3fdb730a4bb260ca4cc'
    independent='\n\n'.join('PAGE '+str(i+1)+'\n'+page.extract_text() for i,page in enumerate(PdfReader(PRIOR/'regulation.pdf').pages))
    text=(PRIOR/'regulation-text.txt').read_text(encoding='utf-8')
    assert independent == text
    previous=json.loads((PRIOR/'REGULATION_EXTRACTION_CANDIDATE.json').read_text(encoding='utf-8'))
    assert previous['text'].count('\u00c2')==4 and text.count('\u00c2')==0
    assert previous['text'].replace('\u00c2\u00a7','\u00a7')==text
    previous.update(text=text,textDigest=digest(text.encode('utf-8')),sourceExtractionVersion='explicit-utf8-independent-pypdf-equality')
    save('REGULATION_EXTRACTION_CANDIDATE.json',previous)
    return {'rawSha256':digest(raw),'textSha256':digest(text.encode('utf-8')),'independentEquality':True,'removedEncodingArtifacts':4,'substantiveChanges':0}

if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description='Local reviewed-source candidates only; no publication.')
    parser.add_argument('--output',required=True,type=Path)
    parser.add_argument('--prior',required=True,type=Path)
    args=parser.parse_args();OUT=args.output.resolve();PRIOR=args.prior.resolve()
    OUT.mkdir(parents=True,exist_ok=True)
    result={'accessedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'regulation':regulation(),'html':{}}
    for name,(url,_) in ALLOW.items():
        try: result['html'][name]=acquire(name,url)
        except Exception as error: result['html'][name]={'state':'unavailable','cause':str(error)}
    save('SOURCE_RESULTS.json',result)
    print(json.dumps(result))
