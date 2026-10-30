import importlib.util,json
s=importlib.util.spec_from_file_location('r','scripts/editorial/2026-10-24/research.py');r=importlib.util.module_from_spec(s);s.loader.exec_module(r);r.directory=r.editorial_directory('2026-10-30')
sources={'perkins-leaf-detail':'https://perkinstownship.com/leaf-pickup-2/','warmchoice-service':'https://www.glcap.org/warmchoice','sandusky-sings':'https://www.sanduskysings.com/','perkins-yard':'https://perkinstownship.com/yard-waste/'}
with r.concurrent.futures.ThreadPoolExecutor(max_workers=4) as e: out=list(e.map(r.fetch,sources.items()))
(r.directory/'evidence'/'detail-sources.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
for x in out: print(x['key'],x.get('status',x.get('error')))
