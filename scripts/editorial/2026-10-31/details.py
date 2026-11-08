import importlib.util,json
s=importlib.util.spec_from_file_location('r','scripts/editorial/2026-10-24/research.py');r=importlib.util.module_from_spec(s);s.loader.exec_module(r);r.directory=r.editorial_directory('2026-10-31')
sources={
'christmas':'https://www.glcap.org/sandusky-county-community-christmas/',
'jobs':'https://eriehealthohio.com/jobs/job-openings/',
'utility':'https://www.glcap.org/programs/utility-payment-assistance/utility-bill-assistance/',
'huron-library':'https://www.huronlibrary.org/',
'bgsu':'https://www.bgsu.edu/firelands/news.html',
'cacehr':'https://www.cacehr.org/winter-crisis-program',
'buyback':'https://eriemetroparks.org/buyback/',
'norwalk':'https://www.norwalkoh.com/city-calendar',
'hayes':'https://www.rbhayes.org/news/',
'oak-harbor':'https://www.oakharbor.oh.us/newslist.php',
}
with r.concurrent.futures.ThreadPoolExecutor(max_workers=8) as e: out=list(e.map(r.fetch,sources.items()))
(r.directory/'evidence'/'details.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
for x in out: print(x['key'],x.get('status',x.get('error')))
