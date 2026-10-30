import importlib.util,json
s=importlib.util.spec_from_file_location('r','scripts/editorial/2026-10-24/research.py');r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
r.directory=r.editorial_directory('2026-10-30')
sources={'school-grant':'https://www.scs-k12.net/protected/ArticleView.aspx?dasi=3GGI&iid=6IIYYUY','warmchoice':'https://www.glcap.org/blog/weatherization-day-showcases-warmchoice-program/','perkins-leaf':'https://perkinstownship.com/leaf-pickup/','huron':'https://www.cityofhuron.org/','parish':'https://sanduskycatholic.org/','cacehr':'https://www.cacehr.org/winter-crisis-program','bgsu':'https://www.bgsu.edu/firelands/news.html','oakharbor':'https://www.oakharbor.oh.us/newslist.php','port-schools':'https://www.pccsd.net/'}
with r.concurrent.futures.ThreadPoolExecutor(max_workers=8) as e: out=list(e.map(r.fetch,sources.items()))
(r.directory/'evidence'/'additional-sources.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
for x in out: print(x['key'],x.get('status',x.get('error')))
