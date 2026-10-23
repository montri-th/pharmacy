# CityMETER: Pharmacy

**ร้านยาแน่นที่สุดอยู่ตรงไหน และเป็นร้านแบบไหน** — เดโมแผนที่ 3 มิติของร้านยาในประเทศไทย ที่อ่านร้านยาที่มีใบอนุญาตขายยาแผนปัจจุบัน (ขย1) 18,136 ร้านทั้ง 77 จังหวัดเป็นความหนาแน่นระดับแขวง/ตำบล พร้อมประเภทร้าน เครือร้าน ร้านยาคุณภาพ และที่มาของทุกตัวเลข

- เว็บ: https://montri-th.github.io/pharmacy/
- ระบบจริงของ CityMETER: https://landometer.com/v3/citymeter
- รุ่น 0.1.1 · 23 ตุลาคม 2569 · ทะเบียน ขย1 ข้อมูล ณ 28 พฤษภาคม 2569 · ตรวจแหล่ง 22 ตุลาคม 2569

ข้อค้นพบแรก (snapshot ปัจจุบัน ไม่กรอง): **14.5 ร้าน/ตร.กม. ใน 3 แขวงที่ร้านยาแน่นที่สุด — ดินแดง คลองเตยเหนือ ลุมพินี** เทียบ 2.1 ร้าน/ตร.กม. ของทั้งกรุงเทพมหานคร · นอกกรุงเทพฯ แน่นที่สุดที่ตำบลหมากแข้ง อุดรธานี 11.7 ร้าน/ตร.กม. · จัดอันดับเฉพาะพื้นที่ที่มีอย่างน้อย 30 ร้าน

> ชุดข้อมูล CityMETER Pharmacy · แหล่ง ทะเบียนผู้รับอนุญาตขายยาแผนปัจจุบัน (ขย1) อย. · ทะเบียน ณ 28 พ.ค. 2569 · ตรวจแหล่ง 22 ต.ค. 2569 · ขอบเขต แขวง/ตำบลของ CityMETER ทั่วประเทศ — ร้าน = ใบอนุญาตหนึ่งใบ สถานะตามทะเบียนไม่ได้ยืนยันว่าร้านเปิดอยู่วันนี้ ไม่ใช่สำมะโนร้านยา

## ใช้งาน

```sh
npm start   # http://127.0.0.1:4173/
npm test    # unit tests บนข้อมูลจริง (node --test)
```

เป็น static site ไม่มี build step และไม่ต้อง `npm install` (Node ≥ 20 สำหรับ tests, Python 3 สำหรับ server) แผนที่โหลด MapLibre GL 5.6.2 จาก unpkg และ tiles/glyphs จาก OpenFreeMap; basemap สร้างเองใน `js/map-style.js` กราฟไม่ใช้ไลบรารีภายนอก ถ้าแผนที่โหลดไม่ได้ ข้อค้นพบ แผง กราฟ และตารางยังใช้ได้ การเปิด `index.html` เป็นไฟล์จะพาไปเว็บสาธารณะ

## สิ่งที่สำรวจได้

- **ข้อค้นพบแรกแบบ 3 มิติ:** หน้าแรกโฟกัส 3 แขวง/ตำบลที่ร้านยาแน่นที่สุดของจังหวัดที่นำ (ร้าน/ตร.กม.) เทียบทั้งจังหวัด และบอกพื้นที่ที่แน่นที่สุดนอกจังหวัดนั้น — “ดูทุกพื้นที่” เปิดทุกพื้นที่เท่ากัน
- **หน่วยนับ:** ค่าเริ่มต้นนับร้านที่มีใบอนุญาต ขย1 (หนึ่งใบอนุญาต = หนึ่งร้าน ไม่นับซ้ำ) · “ทุกรายการ” รวมรายชื่อของสภาเภสัชกรรมและหน้าสาขาของเครือด้วย ซึ่งอาจซ้ำ คำบนจอเปลี่ยนเป็น “รายการ”
- **เส้นทางพื้นที่แบบ production:** ประเทศไทย › จังหวัด › เขต/อำเภอ › แขวง/ตำบล ทุกระดับลิงก์ไปพื้นที่เดียวกันใน CityMETER (`/v3/citymeter/{จังหวัด}/D/{อำเภอ}` · `/S/{ตำบล}`)
- **สีพื้นที่:** ความหนาแน่น LDS `density.area` 5 ระดับเรขาคณิต 1–2–5 (ช่วงตัวเลขในคำอธิบายแผนที่) · 0 ตามทะเบียนมีเส้นขอบศูนย์ · ซูมออกทั้งประเทศ จังหวัดมีสีตามจำนวนร้าน กดเพื่อเจาะลง · เลือกจังหวัดแล้วเห็นทั้งจังหวัดพร้อมสีรายแขวง/ตำบลทุกระดับซูม · ขอบเขตแขวง/ตำบลโหลดทีละจังหวัดเมื่อซูมเข้า
- **ร้าน:** 1 สัญลักษณ์ = 1 ร้านที่แหล่งเผยแพร่พิกัด สีและรูปทรงตามประเภทร้าน (LDS series พร้อมรูปทรงประจำ) ทะเบียนไม่มีพิกัด ร้านส่วนใหญ่จึงไม่มีหมุด แต่ยังนับในสีของพื้นที่และในรายชื่อ · ซูมใกล้เลือกร้านด้วยเมาส์หรือคีย์บอร์ดได้
- **โปรไฟล์:** แขวง/ตำบลและเขต/อำเภอ (ร้าน ร้าน/ตร.กม. ร้านยาคุณภาพ มีพิกัดจากแหล่ง ประเภทร้าน เครือร้าน รายชื่อ) · ร้าน (เครือ ใบอนุญาต ร้านยาคุณภาพ พื้นที่และวิธีจับคู่ พิกัดและที่มา แหล่งข้อมูล)
- **อาคาร:** จุดของร้านจับกับอาคารที่แผนที่วาด (“จุดตกในอาคาร”) กดอาคารเพื่อเปิดร้านหรือรายการร้านที่จุดตกในอาคารนั้น อาคารที่เปิดอยู่เป็นสีข้อมูล
- **ย้ายพื้นที่:** กดแขวง/ตำบลใดก็ได้บนแผนที่ (หรือป้ายของมัน) เพื่อย้ายไป ทุกระดับซูมตั้งแต่ระดับแขวง/ตำบล และทุกระดับซูมภายในจังหวัดที่เลือก
- **กราฟและตาราง:** ความหนาแน่น · ประเภทร้าน (matrix ช่องเท่ากัน) · ร้านยาคุณภาพ (สัดส่วนต่อพื้นที่) · ตารางร้าน (เครือร้านก่อน แล้วเรียงตามชื่อ)
- **ตัวกรอง:** ค้นหา (ชื่อ เครือ เลขใบอนุญาต พื้นที่) · ประเภทร้าน · ร้านยาคุณภาพ · จังหวัด · เครือร้าน · หน่วยนับ — ทุกสถานะอยู่ใน URL (`search`, `group`, `quality`, `province`, `brand`, `count`, `district`, `area`, `areas`, `view`, `store`, `view3d`)
- **ธีม:** Auto / Light / Dark — สีข้อมูลเป็น HEX เดียวกันทั้งสองธีมตาม LDS 0.9.7

## Data and method

- หนึ่งแถว = หนึ่งแถวของชีตวิจัย (outlet candidate หลังรวมหลักฐานตามกติกาของชีต) 23,246 แถว: 18,136 มีใบอนุญาต ขย1 · 3,384 จากรายชื่อของสภาเภสัชกรรม · 1,726 จากหน้าสาขาของเครือ (`data/pharmacies.json`)
- ความเป็นสมาชิกพื้นที่คือรหัสของ production ที่จับคู่จากชื่อจังหวัด/อำเภอ/ตำบลของแถว (หรือจุดของแหล่งเมื่อไม่มีชื่อที่ใช้ได้) วิธีที่ใช้บันทึกในทุกแถว · ความหนาแน่น = ร้าน ÷ ตร.กม. ของ production
- พิกัดมีเพียง 3,974 แถว (17%) เป็นจุดที่แหล่งเผยแพร่ ไม่ใช่ทางเข้าร้าน
- เครือร้าน 32 เครือเฉพาะชื่อที่ชีตยืนยัน ไม่มีโลโก้ในรอบนี้ การจับจุดกับอาคารเป็นผลตอนแสดงผล ไม่เปลี่ยนตัวเลขใด
- ไม่คัดลอกเบอร์โทร ที่อยู่ หมายเหตุ หรือระเบียนดิบ
- รายละเอียด: [DATA_METHOD.md](DATA_METHOD.md) · [docs/AREA_METHOD.md](docs/AREA_METHOD.md) · [docs/CHART_SELECTION.md](docs/CHART_SELECTION.md) · [docs/BUILD_CARD.md](docs/BUILD_CARD.md) · Product Statement: [PRODUCT_STATEMENT.md](PRODUCT_STATEMENT.md)

## โครงสร้าง

```
index.html            หน้าเดียว (header, map, chart tray, table, reading panel, help)
styles.css            layout + panel + map chrome + charts + สี series ของประเภทร้าน (ใช้ token จาก assets/theme.css)
navigation.css        ไอคอน nav-7, help dialog
assets/theme.css      ค่า LDS 0.9.7 ที่ใช้ (foundation, map roles, dataState, series 1–10, count 5 ระดับ, basemap tokens)
js/app.js             ประกอบทุกส่วน: selection, หน่วยนับ, URL, panel modes, camera, map click, โหลดขอบเขตรายจังหวัด
js/model.js           ถอดข้อมูล, ตัวกรอง, หน่วยนับ, สรุป, ลิงก์ production
js/areas.js           ดัชนีแขวง/ตำบล เขต/อำเภอ จังหวัด (ไม่มีเรขาคณิต) + ผูกขอบเขตที่โหลดแล้ว
js/frames.js          โหลดขอบเขตทีละจังหวัด + locator จังหวัด
js/area-insight.js    ข้อค้นพบแรก (พื้นที่แน่นที่สุดของจังหวัดที่นำ + นอกจังหวัด)
js/scales.js          LUT 41 ค่าของ density.area / count + การจัดระดับเรขาคณิต และ EVID-05
js/cues.js            ประเภทร้าน → LDS series + รูปทรงประจำ series
js/map-layers.js      choropleth แขวง/ตำบล + ป้ายบนแผนที่
js/provinces.js       กรอบจังหวัดในมุมมองประเทศ
js/pins.js            สัญลักษณ์ร้าน, จุดบริบท, หมุด HTML ที่ซูมใกล้
js/building-join.js   จุดของร้าน × อาคารที่แผนที่วาด
js/massing.js · js/geometry.js · js/mvt.js · js/map-style.js · js/camera.js · js/vendors.js
                      มวลอาคารเมือง, basemap, กล้อง, MapLibre loader (ใช้ร่วมกับ Luxury Brands / Restaurants)
js/profile-model.js · js/panel.js · js/chart-model.js · js/charts.js · js/breadcrumb.js · js/navigation.js · js/launch.js
data/                 pharmacies.json, area-index.json, frames/{CODE}.json (77 จังหวัด), provinces.geojson, boundary-receipts.json
scripts/              build-boundaries.py, build-data.py, build-handoff.mjs, verify-live.mjs, check-lds-parity.mjs, build-pictogram-font.py
tests/                node --test บนข้อมูลจริง
handoff/              Product Brief, Implementation Plan, Verification, JSON + schema
```

## Assets and verification

- สีทุกค่าตรง LDS 0.9.7 (`v0.9.7-owner.1`, `color-srgb-10`, SHA-256 `d3085cbc…96`) — ตรวจด้วย `npm run check:lds` กับไฟล์ LDS ต้นฉบับ (ไฟล์ LDS ไม่อยู่ใน repository) ผลบันทึกใน [handoff/VERIFICATION.md](handoff/VERIFICATION.md)
- ฟอนต์และไอคอนจาก LDS build kit (`assets/lds/build-kit/`), ไอคอน nav-7 และ pictogram 8 ตัว (Apache-2.0)
- ขอบเขตจาก CityMETER production (ใบรับ 7,514 ใบใน `data/boundary-receipts.json`); อาคาร © OpenStreetMap contributors (ODbL 1.0); basemap © OpenFreeMap / OpenMapTiles / OpenStreetMap
- ข้อมูลร้านจากแหล่งสาธารณะ: ทะเบียน ขย1 ของ อย. (open data catalogue), รายชื่อของสภาเภสัชกรรม, หน้าสาขาของเครือ — สิทธิ์การใช้ของแต่ละแหล่งยังไม่ได้ตรวจ (DATA_METHOD §11)
- `npm run handoff:manifest` สร้าง hash ของทุกไฟล์ · `npm run verify:live` เทียบไบต์บนเว็บจริงกับ manifest

ส่งต่อให้ developer หรือ coding agent: เริ่มที่ [handoff/README.md](handoff/README.md) และอ่าน [AGENTS.md](AGENTS.md) ก่อนแก้ไข
