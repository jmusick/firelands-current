import importlib.util,json
spec=importlib.util.spec_from_file_location('r','scripts/editorial/2026-10-24/research.py');r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
r.directory=r.editorial_directory('2026-10-29')
sources={'shrink':'https://ohioseagrant.osu.edu/news/2026/l3b0q/ohio-clean-marinas-program-partners-divert-66000-pounds-boat','winter':'https://www.cacehr.org/winter-crisis-program','glcap-winter':'https://www.glcap.org/programs/utility-payment-assistance/','huron':'https://www.cityofhuron.org/','parish':'https://sanduskycatholic.org/','bgsu':'https://www.bgsu.edu/firelands/news.html','oak-harbor':'https://www.oakharbor.oh.us/newslist.php','norwalk':'https://www.norwalkoh.com/city-calendar','huron-health':'https://www.huroncohealth.com/public-information'}
with r.concurrent.futures.ThreadPoolExecutor(max_workers=8) as e: out=list(e.map(r.fetch,sources.items()))
(r.directory/'evidence'/'additional-sources.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
for x in out: print(x['key'],x.get('status',x.get('error')))
