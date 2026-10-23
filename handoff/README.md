# เริ่มงานต่อ — CityMETER Pharmacy

รุ่นส่งต่อ 0.1.1 · 23 ตุลาคม 2569 · ทะเบียน ขย1 ข้อมูล ณ 28 พฤษภาคม 2569 · ตรวจแหล่ง 22 ตุลาคม 2569

ชุดนี้ส่งต่อให้ developer หรือ coding agent พัฒนาต่อจาก repository ที่ใช้งานจริง หลักของรุ่นนี้คือ **นับร้านยาที่มีใบอนุญาตละครั้ง แล้วเห็นเมือง 3 มิติที่โฟกัส 3 แขวง/ตำบลที่ร้านยาแน่นที่สุดของจังหวัดที่นำก่อน (ร้าน/ตร.กม.) เทียบทั้งจังหวัด แสดงรายละเอียดเฉพาะส่วนที่โฟกัส ส่วนอื่นเงียบ และขยายได้ทั้งประเทศด้วยขอบเขตรายจังหวัด** โดยคงสัญญากล้อง basemap และมวลอาคารของ CityMETER · Luxury Brands 0.5 / Restaurants 0.2.1

Live: [Pharmacy](https://montri-th.github.io/pharmacy/) · Source: [GitHub](https://github.com/montri-th/pharmacy) · ระบบจริง: [CityMETER](https://landometer.com/v3/citymeter)

## อ่านตามลำดับนี้

| คนอ่าน | เครื่องอ่าน | ใช้ทำอะไร |
|---|---|---|
| [../PRODUCT_STATEMENT.md](../PRODUCT_STATEMENT.md) | [product-statement.json](product-statement.json) | Winning strategy: Who / What / Which / How, quality bar, ป้ายหลักฐาน, hypotheses — อ่านก่อนเปลี่ยนสิ่งที่หน้าแรกบอก |
| [PRODUCT_BRIEF.md](PRODUCT_BRIEF.md) | [product-brief.json](product-brief.json) | row scopes, หน่วยนับ, first Aha, ตัวชี้วัด ความครอบคลุม ขอบเขตรายจังหวัด รูปทรงประเภท แผนที่ focus/quiet, breadcrumb, แผงห้าโหมด, อาคาร, กราฟ, invariants INV01–INV24 |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | [implementation-plan.json](implementation-plan.json) | โมดูล งาน P01–P11 acceptance AC01–AC27 backlog N01–N12 วิธีทำงานต่อ |
| [VERIFICATION.md](VERIFICATION.md) | `handoff-manifest.json` (ใน bundle) | ผลตรวจแยกระดับ (unit / LDS parity / rendered / live) และ hash ของทุกไฟล์ |
| README นี้ | [handoff.schema.json](handoff.schema.json) | สัญญาโครงสร้างของ JSON (schema 1.5.0) |

`product-statement.json`, `product-brief.json` และ `implementation-plan.json` แก้คู่กับ Markdown ส่วน `handoff-manifest.json` สร้างด้วย `npm run handoff:manifest` เท่านั้น ไม่ถูก track ใน git ห้ามแก้ hash ด้วยมือ

บริบทข้อมูล: [DATA_METHOD.md](../DATA_METHOD.md) · [docs/AREA_METHOD.md](../docs/AREA_METHOD.md) · [docs/CHART_SELECTION.md](../docs/CHART_SELECTION.md) · [docs/BUILD_CARD.md](../docs/BUILD_CARD.md)

## เปิดในเครื่อง

```sh
npm start      # http://127.0.0.1:4173/
npm test       # unit tests บนข้อมูลจริง
```

เป็น static site ไม่มี build step ไม่ต้อง `npm install` ต้องมี Node ≥ 20 และ Python 3 แผนที่ต้องเข้าถึง unpkg.com (MapLibre) และ tiles.openfreemap.org (tiles + glyphs) กราฟไม่ใช้ไลบรารีภายนอก การเปิด `index.html` เป็นไฟล์โดยตรงจะพาไปเว็บสาธารณะ

สร้างข้อมูลใหม่ต้องใช้อินพุตภายใน (xlsx ของชีตวิจัย, responses ของ production API) ซึ่งไม่อยู่ใน repository — ดู DATA_METHOD §10 · ตรวจ LDS parity ต้องมีไฟล์ LDS 0.9.7 ของเจ้าของ (`npm run check:lds -- --lds <file>`)

## สิ่งที่ห้ามทำหล่น

- หน่วยนับ: ค่าเริ่มต้นนับเฉพาะแถวที่มีใบอนุญาต ขย1 (หนึ่งใบอนุญาต = หนึ่งร้าน) · ทุกรายการใช้คำว่า “รายการ” ทุกที่ · ห้ามผสมสองหน่วยในตัวเลขเดียว
- ขอบเขตข้อมูลสามชั้น: `scopeRows` ขับข้อค้นพบ choropleth กราฟ และอันดับในโปรไฟล์; `rows` ขับสัญลักษณ์ที่มีรายละเอียด ตัวนับ และตาราง
- ความเป็นสมาชิกพื้นที่ = รหัสที่จับคู่จากชื่อพื้นที่ของแถวตอน build (`row.admin`) ห้าม point-in-polygon ตอนแสดงผล ห้ามเดาจากชื่อร้าน
- ความหนาแน่น = แถว ÷ ตร.กม. ของ production; หลายพื้นที่ใช้ Σ/Σ; ไม่จัดอันดับพื้นที่ที่มีน้อยกว่า 30 แถว; การเลือกเล็กเปลี่ยนเป็นจำนวนและบอกเหตุผล
- 0 ตามทะเบียน (เส้นขอบศูนย์ + วันที่ของทะเบียน) ≠ ไม่มีข้อมูล ≠ ไม่มีพิกัด; ไม่สร้างพิกัด
- ขอบเขตโหลดทีละจังหวัด ห้ามโหลดทั้ง 77 ไฟล์ตอนเริ่ม; ทุกอย่างนอกแผนที่ต้องใช้ได้โดยไม่มีขอบเขต
- โฟกัสแล้วเงียบ, ภาพแรก 3 มิติ, สีข้อมูล HEX เดียวกันทั้งสองธีม, รูปทรงประจำ series คู่กับสี
- เครือเฉพาะชื่อที่ชีตยืนยัน; “อาจเป็นร้านเดียวกัน”; “จุดตกในอาคาร” ไม่ใช่ “ตั้งอยู่ใน”; สถานะใบอนุญาตไม่ใช่การยืนยันว่าเปิด
- ไม่คัดลอกเบอร์โทร ที่อยู่ หมายเหตุ ระเบียนดิบ; ไม่มีลิงก์เอกสารส่วนตัว credential หรือไลบรารี LDS เต็มใน repository
- ทุกมุมมองของแผงจบด้วย dataset · source · date · boundary และหน่วยนับ

## เริ่มด้วยงานหนึ่งชิ้น

เลือกงานจาก backlog (N01–N12) ที่เจ้าของจัดลำดับ ทำทีละงาน เพิ่ม test บนข้อมูลจริง ตรวจหน้าจอทั้งสองธีมที่ 390 px และ desktop แล้วเผยแพร่และรัน `npm run verify:live` ก่อนรายงาน

## ตรวจความครบก่อนรับช่วง

```sh
npm test                       # ทุก test ผ่าน
npm run handoff:manifest       # manifest ตรงกับ commit
npm run verify:live            # ไบต์บนเว็บตรง manifest
```
