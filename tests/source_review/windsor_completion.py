"""Focused offline transport-completion controls; no provider or database access."""
from pathlib import Path
from email.message import Message
import importlib.util, json, tempfile, argparse
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('windsor_review',ROOT/'tools/source_review/windsor_review.py')
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
BODY=b'<p>Rate 6.35 percent.</p>'
class Response:
    def __init__(self,body=BODY,length=None,chunk=7,fail_at=None):
        self.body=body;self.cursor=0;self.chunk=chunk;self.fail_at=fail_at;self.url=r.ALLOW['rate'][0];self.status=200
        self.headers=Message();self.headers['Content-Type']='text/html';self.closed=False
        if length is not None:self.headers['Content-Length']=str(length)
    def read(self,n):
        if self.fail_at is not None and self.cursor>=self.fail_at:raise OSError('Synthetic interrupted transport')
        data=self.body[self.cursor:self.cursor+min(n,self.chunk)];self.cursor+=len(data);return data
    def __enter__(self):return self
    def __exit__(self,*args):self.closed=True
class Opener:
    def __init__(self,response):self.response=response
    def open(self,*args,**kwargs):return self.response

def run():
    cases=[]
    with tempfile.TemporaryDirectory(prefix='northstar-review-completion-') as directory:
        r.OUT=Path(directory)
        def acquire(response):return r.acquire('rate',r.ALLOW['rate'][0],Opener(response))
        def reject(label,response):
            # Existing successful artifacts must remain untouched on rejection.
            before={p.name:p.read_bytes() for p in r.OUT.iterdir()}
            try:acquire(response)
            except (ValueError,OSError):pass
            else:raise AssertionError(label+' accepted')
            assert response.closed
            assert before=={p.name:p.read_bytes() for p in r.OUT.iterdir()}
            cases.append({'case':label,'rejected':True,'outputsUnchanged':True})
        reject('declares100 supplies19 then EOF',Response(b'<p>6.35 percent</p>',100))
        complete=Response(length=len(BODY));result=acquire(complete)
        assert result['declaredLengthVerified'] is True and result['completion']=='declared-length-and-transport-eof'
        assert complete.closed and (r.OUT/'rate.html').read_bytes()==BODY
        cases.append({'case':'exact declared body with partial reads accepted','result':result})
        reject('shorter than declared preserves prior artifacts',Response(length=len(BODY)+1))
        reject('longer than declared rejected',Response(length=len(BODY)-1))
        reject('invalid negative length',Response(length=-1))
        reject('malformed length',Response(length='24, 24'))
        reject('declared above cap',Response(length=65537))
        reject('absent length observed above cap',Response(body=b'x'*65537,chunk=16384))
        reject('absent length transport exception',Response(fail_at=7))
        reject('declared transport exception',Response(length=len(BODY),fail_at=7))
        absent=Response();result=acquire(absent)
        assert result['declaredLength'] is None and result['declaredLengthVerified'] is False
        assert result['completion']=='transport-eof-without-declared-length' and absent.closed
        cases.append({'case':'absent length records EOF only, no declared-size verification','result':result})
    return {'pass':True,'cases':cases,'networkCalls':0,'publicationWrites':0,'runtimeChanges':0}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',required=True,type=Path);args=parser.parse_args()
    assert not args.output.exists()
    result=run();args.output.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'pass':result['pass'],'cases':len(result['cases'])}))
