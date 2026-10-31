#!/usr/bin/env python3
"""SMASH ARCH 지도 타일 만들기

한국 OSM 파일(.osm.pbf)에서 건축사사무소 주변만 잘라 작은 타일 파일로 저장한다.
게임(game.js)은 tiles/ 를 먼저 읽고, 없는 곳만 공개 지도 서버(Overpass)에 요청한다.

  python tools/build_tiles.py --pbf filtered.osm.pbf --out out

- 셀: 위도 0.004° × 경도 0.005° (약 440m × 440m). 파일: out/tiles/{ci}/{cj}.bin (gzip JSON)
- 사무소 목록: config.js 의 API_URL(?action=firms) → 실패하면 data/firms.json
- 셀 내용은 게임의 Overpass 질의(osmQuery)와 같은 종류만 담는다.
"""
import argparse, gzip, json, math, os, re, sys, time, urllib.request
import osmium
from array import array

CELL_LAT, CELL_LON = 0.004, 0.005
HIGHWAY = re.compile(r'^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|service|living_street|pedestrian)(_link)?$')
LANDUSE = {'grass','meadow','forest','recreation_ground','village_green','cemetery','reservoir','basin'}
LEISURE = {'park','garden','pitch','playground','golf_course'}
NATURAL = {'water','wood','scrub','grassland','sand','beach'}
ARCH_NODE = re.compile(r'건축사|건축사무소|architect', re.I)
ARCH_WAY = re.compile(r'건축사|건축사무소')
KEEP_B = ('building','height','building:levels','name')
KEEP_ARCH = ('name','office','addr:street','addr:housenumber')


def log(*a):
    print(*a, flush=True)


def load_firms(root, api):
    rows = None
    if api:
        try:
            u = api + ('&' if '?' in api else '?') + 'action=firms'
            with urllib.request.urlopen(u, timeout=120) as r:
                d = json.loads(r.read().decode('utf-8'))
            rows = (d.get('rows') or d.get('firms')) if isinstance(d, dict) else d
            log(f'사무소 목록: 웹앱에서 {len(rows)}곳')
        except Exception as e:
            log('웹앱에서 목록을 못 받음 → data/firms.json 사용:', e)
    if rows is None:
        with open(os.path.join(root, 'data', 'firms.json'), encoding='utf-8') as f:
            d = json.load(f)
        rows = (d.get('rows') or d.get('firms')) if isinstance(d, dict) else d
        log(f'사무소 목록: data/firms.json {len(rows)}곳')
    pts = []
    for r in rows:
        try:
            la, ln = r[2], r[3]
            st = r[4] if len(r) > 4 else 0
            if la is None or ln is None or st == 2:
                continue
            la, ln = float(la), float(ln)
            if 32.5 < la < 39.5 and 124 < ln < 132.5:
                pts.append((la, ln))
        except Exception:
            pass
    return pts


def api_from_config(root):
    try:
        s = open(os.path.join(root, 'config.js'), encoding='utf-8').read()
        m = re.search(r"API_URL\s*:\s*['\"]([^'\"]+)['\"]", s)
        return m.group(1) if m else ''
    except Exception:
        return ''


def needed_cells(pts, radius):
    cells = set()
    for la, ln in pts:
        dla = radius / 110540
        dln = radius / (111320 * math.cos(math.radians(la)))
        for ci in range(math.floor((la - dla) / CELL_LAT), math.floor((la + dla) / CELL_LAT) + 1):
            for cj in range(math.floor((ln - dln) / CELL_LON), math.floor((ln + dln) / CELL_LON) + 1):
                cells.add((ci, cj))
    return cells


def cell_of(la, ln):
    return (math.floor(la / CELL_LAT), math.floor(ln / CELL_LON))


def pick(tags, keys):
    return {k: tags[k] for k in keys if k in tags}


def way_tags(t):
    """게임이 쓰는 웨이면 저장할 태그(dict), 아니면 None"""
    name = t.get('name')
    arch = (t.get('office') == 'architect' and name) or (name and ARCH_WAY.search(name))
    b = t.get('building')
    if b and b != 'no':
        d = pick(t, KEEP_B)
        if arch:
            d.update(pick(t, KEEP_ARCH))
        elif 'name' in d and len(d['name']) > 40:
            del d['name']
        return d
    if arch:
        return pick(t, KEEP_ARCH)
    hw = t.get('highway')
    if hw and HIGHWAY.match(hw):
        return {'highway': hw}
    lu = t.get('landuse')
    if lu in LANDUSE:
        return {'landuse': lu}
    le = t.get('leisure')
    if le in LEISURE:
        return {'leisure': le}
    na = t.get('natural')
    if na in NATURAL:
        return {'natural': na}
    return None


def node_tags(t):
    if t.get('natural') == 'tree':
        return {'natural': 'tree'}
    name = t.get('name')
    if (t.get('office') == 'architect') or (name and ARCH_NODE.search(name)):
        d = pick(t, KEEP_ARCH)
        return d if d.get('name') or d.get('office') else None
    return None


class H(osmium.SimpleHandler):
    def __init__(self, cells):
        super().__init__()
        self.cells = cells
        self.data = {c: [] for c in cells}
        self.nw = self.nn = 0

    def node(self, n):
        if not n.tags:
            return
        tg = node_tags(n.tags)
        if tg is None or not n.location.valid():
            return
        la, ln = n.location.lat, n.location.lon
        c = cell_of(la, ln)
        if c in self.cells:
            self.data[c].append((0, n.id, tg, array('i', (round(la * 1e6), round(ln * 1e6)))))
            self.nn += 1

    def way(self, w):
        tg = way_tags(w.tags)
        if tg is None:
            return
        pts = array('i')   # 위도·경도 ×1e6 정수를 번갈아 (메모리 절약)
        try:
            for nd in w.nodes:
                loc = nd.location
                if not loc.valid():
                    return
                pts.append(round(loc.lat * 1e6))
                pts.append(round(loc.lon * 1e6))
        except osmium.InvalidLocationError:
            return
        if len(pts) < 4:
            return
        hit = {cell_of(pts[k] / 1e6, pts[k + 1] / 1e6) for k in range(0, len(pts), 2)} & self.cells
        if not hit:
            return
        el = (1, w.id, tg, pts)
        for c in hit:
            self.data[c].append(el)
        self.nw += 1


def encode(c, els):
    ci, cj = c
    o = [round(ci * CELL_LAT * 1e6), round(cj * CELL_LON * 1e6)]
    out = []
    for t, i, tg, pts in els:
        flat, pa, pb = [], o[0], o[1]
        for k in range(0, len(pts), 2):
            a, b = pts[k], pts[k + 1]
            flat += [a - pa, b - pb]
            pa, pb = a, b
        out.append([t, i, tg, flat])
    return json.dumps({'v': 1, 'o': o, 'e': out}, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pbf', required=True)
    ap.add_argument('--out', default='out')
    ap.add_argument('--root', default='.')
    ap.add_argument('--radius', type=float, default=750, help='사무소 주변 몇 m까지 (기본 750)')
    ap.add_argument('--api', default=None)
    ap.add_argument('--osm-date', default='')
    a = ap.parse_args()
    t0 = time.time()
    api = a.api if a.api is not None else api_from_config(a.root)
    pts = load_firms(a.root, api)
    if not pts:
        sys.exit('좌표 있는 사무소가 없어요')
    cells = needed_cells(pts, a.radius)
    log(f'사무소 {len(pts)}곳 → 셀 {len(cells)}개 (반경 {a.radius:.0f}m)')
    h = H(cells)
    h.apply_file(a.pbf, locations=True, idx='flex_mem')
    log(f'웨이 {h.nw} · 노드 {h.nn} · {time.time()-t0:.0f}초')
    tot = 0
    for c, els in h.data.items():
        d = os.path.join(a.out, 'tiles', str(c[0]))
        os.makedirs(d, exist_ok=True)
        b = gzip.compress(encode(c, els), 9)
        with open(os.path.join(d, f'{c[1]}.bin'), 'wb') as f:
            f.write(b)
        tot += len(b)
    meta = {'v': 1, 'cellLat': CELL_LAT, 'cellLon': CELL_LON, 'cells': len(cells), 'radius': a.radius,
            'firms': len(pts), 'bytes': tot, 'osmDate': a.osm_date,
            'built': time.strftime('%Y-%m-%d %H:%M', time.gmtime()) + ' UTC'}
    with open(os.path.join(a.out, 'tiles', 'meta.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False)
    log(f'완료: 셀 {len(cells)}개 · {tot/1e6:.1f} MB · {time.time()-t0:.0f}초')


if __name__ == '__main__':
    main()
