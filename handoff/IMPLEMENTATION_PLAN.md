# Implementation Plan — CityMETER · Pharmacy 0.1

คู่กับ `implementation-plan.json` (schema 1.5.0)

## 1. สถาปัตยกรรม

Static HTML/CSS/JavaScript ES modules ไม่มี framework ไม่มี build step Node ≥ 20 สำหรับ tests และสคริปต์ Python 3.11 + openpyxl และ mapshaper 0.6 สำหรับสร้างข้อมูล ห้องสมุดภายนอก: MapLibre GL 5.6.2 (unpkg, pinned ใน `js/vendors.js`) และ earcut 3.2.4 (vendored) บริการภายนอก: OpenFreeMap (tiles + glyphs) ข้อมูลหลักโหลดภายใน 45 วินาที ขอบเขตรายจังหวัดโหลดแยก

```sh
npm start                                   # http://127.0.0.1:4173/
npm test                                    # node --test บนข้อมูลจริง
npm run check:lds -- --lds <LDS 0.9.7 file> # LDS parity (ไฟล์ LDS ไม่อยู่ใน repository)
npm run handoff:manifest                    # hash ทุกไฟล์จาก git ls-files
npm run verify:live                         # เทียบไบต์บนเว็บจริงกับ manifest
```

## 2. โมดูล

| ไฟล์ | หน้าที่ |
|---|---|
| `js/app.js` | ประกอบทุกส่วน: row scopes, หน่วยนับและจำนวนในตัวเลือก, โหมดโฟกัส, แผงและ back stack (คืนจังหวัด), URL, ขอบเขตตามต้องการ (`wantedProvinces`, `ensureFramesInView`), วงจรแผนที่และธีม, กล้อง (`fitRecord` กรอบสำรอง, `fitMap`, `fitCountry`), ลำดับการกด, hover, ป้ายพื้นที่ข้าง ๆ, join อาคาร, legend ตามซูม, ตัวนับ/ตาราง |
| `js/frames.js` | ที่เก็บขอบเขตรายจังหวัด (idempotent, concurrency 2, tag ตามรุ่น, ไม่จำความล้มเหลว) + locator จังหวัด |
| `js/model.js` | ถอดข้อมูล, จังหวัดจากดัชนี, `unitWords`, `filterRows`, `summarize`, `mixOf`, ป้ายหลักฐาน, `productionLink` |
| `js/areas.js` | ดัชนีพื้นที่ (ไม่มีเรขาคณิต), `attachFrames`, คำระดับ, สรุปรายพื้นที่, Σ/Σ, `recordBounds`, `areaLocator` (ป้ายเท่านั้น) |
| `js/area-insight.js` | ข้อค้นพบแรก (จังหวัดที่นำ ฐานเทียบ นอกจังหวัด โหมดจำนวน) |
| `js/scales.js` | LUT 41 ค่า `density.area`/`count`, `geometricBreaks`, การจัดระดับ, EVID-05 |
| `js/cues.js` | กลุ่ม → series + รูปทรง, ร้านยาคุณภาพ series 10 |
| `js/map-layers.js` | choropleth บนขอบเขตที่รวมแล้ว (`setFrames`), มุมมองจังหวัด (จังหวัดที่เลือกตั้งแต่ซูม 4), `area-hit`, hover, เส้นอำเภอ, ป้าย |
| `js/provinces.js` | กรอบจังหวัด (count) ต่ำกว่าซูม 8 เมื่อไม่ได้เลือกจังหวัด |
| `js/pins.js` | สัญลักษณ์โฟกัส จุดบริบท (เฉพาะแถวที่มีจุด) หมุด HTML |
| `js/building-join.js` | จุดของร้าน × ขอบอาคารที่วาด |
| `js/massing.js` · `js/geometry.js` · `js/mvt.js` · `js/map-style.js` · `js/camera.js` · `js/vendors.js` | สืบจาก Luxury Brands/Restaurants; 0.1.1 เปลี่ยนเฉพาะ `massing.js`: ไทล์ ≤ 16 ที่ใกล้กล้องที่สุด และ focus tier จากซูม 12 ใน 3D เมื่อไทล์ครบ |
| `js/breadcrumb.js` · `js/profile-model.js` · `js/panel.js` · `js/chart-model.js` · `js/charts.js` · `js/navigation.js` · `js/launch.js` | breadcrumb, view models, HTML ของแผง, กราฟ, nav-7 และ help, หน้าโหลด |
| `scripts/build-boundaries.py` · `scripts/build-data.py` · `scripts/check-lds-parity.mjs` · `scripts/build-handoff.mjs` · `scripts/verify-live.mjs` | สร้างขอบเขต/ข้อมูล, ตรวจ LDS, manifest/bundle, ตรวจเว็บจริง |

## 3. Selection

ตัวกรอง: `search`, `group`, `quality`, `province`, `brand`, `count` · URL: + `district`, `area`, `areas`, `view`, `store`, `view3d` · scopes ตาม Product Brief §3 · actions ตาม `panel.actions`

## 4. งาน (รุ่น 0.1.0 → 0.1.1)

| งาน | สิ่งที่ทำ | AC | สถานะ |
|---|---|---|---|
| P01 | ได้ไฟล์ชีตของจริง (xlsx ผ่านเบราว์เซอร์ของเจ้าของ) และบันทึก hash | AC23 | done |
| P02 | ดึง base info และขอบเขตจาก production พร้อมใบรับ; สร้างดัชนี ขอบเขตรายจังหวัด จังหวัด | AC23 AC13 | done |
| P03 | สร้าง `pharmacies.json`: จับคู่พื้นที่ หน่วยนับ ตัดข้อมูลส่วนตัว ตรวจกับแท็บความครอบคลุม | AC23 AC06 AC07 | done |
| P04 | ดัชนี ที่เก็บขอบเขต ชั้นพื้นที่ระดับประเทศ | AC13 AC12 | done |
| P05 | ข้อค้นพบแรก | AC02 AC05 | done |
| P06 | แผง provenance คำตามหน่วย | AC06–AC10 AC27 | done |
| P07 | แผนที่: choropleth จังหวัด หมุด มวลอาคาร join กล้อง ป้าย | AC03 AC04 AC16–AC18 AC26 | done |
| P08 | กราฟและตาราง | AC14 AC15 | done |
| P09 | tests, LDS parity, เอกสาร, handoff | AC23 AC24 | done |
| P10 | เผยแพร่ GitHub Pages และตรวจเว็บจริง | AC25 AC19 AC20 | ดูสถานะใน `implementation-plan.json` และผลใน VERIFICATION.md |
| P11 | แก้สิ่งที่พบจากการเดินตรวจเว็บจริง (0.1.1): มวลอาคารในภาพแรก มุมมองจังหวัด ป้ายระดับสูงสุด แถบเครื่องมือบนมือถือ หน่วยไม่แยกบรรทัด คำของจุดนอกโฟกัส | AC03 AC12 AC20 | เหมือน P10 |

## 5. Acceptance criteria

AC01 โหลดครั้งแรก · AC02 ข้อค้นพบเริ่มต้น · AC03 ภาพแรก 3D · AC04 ดูทุกพื้นที่ · AC05 เปลี่ยนตัวกรอง · AC06 หน่วยนับ · AC07 ศูนย์และแถวที่ระบุไม่ถึงตำบล · AC08 แขวง/ตำบล · AC09 เขต/อำเภอ · AC10 ร้าน · AC11 breadcrumb · AC12 ทั้งประเทศและมุมมองจังหวัด · AC13 ขอบเขตตามต้องการ · AC14 กราฟ · AC15 ตาราง · AC16 ซูมใกล้ · AC17 อาคาร · AC18 ย้ายพื้นที่ข้าง ๆ · AC19 ธีม · AC20 มือถือ 390 px · AC21 แผนที่ล้มเหลว · AC22 URL · AC23 ความถูกต้องของข้อมูล · AC24 LDS parity · AC25 เว็บจริง · AC26 attribution · AC27 การเลือกที่ว่าง — รายละเอียดและผลใน `implementation-plan.json` และ VERIFICATION.md

## 6. วิธีทำงานต่อ

1. อ่าน AGENTS.md แล้ว handoff/README.md, PRODUCT_STATEMENT.md และ brief คู่ human/machine
2. รัน `npm test` ก่อนแก้; รักษา row scopes หน่วยนับ โหมดโฟกัส ตัวชี้วัด ขอบเขต ความครอบคลุม และสัญญา panel action
3. แก้ทีละงาน รักษา INV01–INV24
4. ตรวจการคำนวณด้วยข้อมูลจริงใน tests/
5. ตรวจภาษาไทยที่ 390 px และ desktop สองธีม; เมื่อ tiles ถูกบล็อกใช้ harness ในเครื่องดู layout แล้วยืนยันภาพจริงบนเว็บ
6. ปรับกล้องและชั้นสดผ่าน `window.__citymeter` ก่อนเปลี่ยนค่าคงที่
7. เผยแพร่เฉพาะที่ได้รับอนุญาต รอ Pages แล้วรัน `npm run verify:live` ก่อนรายงานรุ่น
8. สร้าง manifest และ bundle จาก working tree ที่สะอาด ห้ามแก้ hash ด้วยมือ

## 7. Backlog

N01 refresh ทะเบียนตามรอบพร้อม diff · N02 ตรวจเงื่อนไขการใช้ข้อมูลของแต่ละแหล่งก่อนใช้เชิงพาณิชย์ · N03 ร้านต่อประชากร 1,000 คน (Population) · N04 แก้ 1,221 คู่ตัวตนข้ามแหล่ง · N05 ขย2 เป็นหน่วยแยก · N06 geocoding ที่เจ้าของอนุมัติพร้อมป้ายความแม่น · N07 สุ่มตรวจภาคสนาม · N08 โลโก้เครือพร้อม registry · N09 Playwright ใน CI · N10 ชุดข้อมูลร้านยาใน production (`?d=pharmacy`) · N11 vector tiles ของขอบเขตทั้งประเทศ · N12 วันหมดอายุของรายชื่อร้านยาคุณภาพ
