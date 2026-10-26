/* engine/data/codes.js — standards / law registry (PURE DATA + helpers).
 * Researched rows verified 2026-10-25 from gazette scans hosted by ASA / Mahidol / yotathai (ratchakitcha.soc.go.th
 * returned 403 during research). Rows with lastVerifiedDate:null were NOT verified — the UI shows a badge.
 * Never invent deep links: URLs are only those actually seen during research, or root domains. */
(function (root) {
  const SD = root.SD = root.SD || {};
  const U = { ratchakitcha: 'https://ratchakitcha.soc.go.th', dpt: 'https://www.dpt.go.th', eit: 'https://eit.or.th', coe: 'https://www.coe.or.th' };
  const row = (id, titleTh, titleEn, issuer, type, editionYear, supersedes, mods, url, notes) => ({
    id, titleTh, titleEn, issuer, type, editionYear, status: 'unknown', supersedes, appliesToModules: mods,
    officialUrl: url, altUrls: [], lastVerifiedDate: null, verifiedBy: null, notes
  });
  // Researched 2026-10-25 (web research of gazette scans hosted by ASA / Mahidol / yotathai).
  // ratchakitcha.soc.go.th returned 403 during research, so URLs below are the copies actually seen.
  // status 'current' = in force per the text read; 'unknown' = edition/status could not be confirmed.
  const VERIFIED = '2026-10-25';
  const BY = 'web research (coordinator)';
  const registry = [
    // ---- researched rows ----
    {
      id: 'MR2566-STRUCT',
      titleTh: 'กฎกระทรวงกำหนดการออกแบบโครงสร้างอาคาร และลักษณะและคุณสมบัติของวัสดุที่ใช้ในงานโครงสร้างอาคาร พ.ศ. 2566',
      titleEn: 'Ministerial Regulation on Building Structural Design and Structural Materials B.E. 2566 (2023)',
      issuer: 'กระทรวงมหาดไทย (ราชกิจจานุเบกษา เล่ม 140 ตอนที่ 54 ก, 6 ก.ย. 2566)',
      type: 'regulation', editionYear: 2566, status: 'current',
      supersedes: 'MR6-2527', supersedesAll: ['MR6-2527', 'MR48-2540', 'MR60-2549'],
      appliesToModules: ['loads', 'rc-sdm', 'rc-wsd', 'steel', 'wind', 'report'],
      effectiveDate: '2024-03-04',
      officialUrl: 'http://download.asa.or.th/03media/04law/cba/mr/mr66-70h.pdf',
      altUrls: ['https://stang.sc.mahidol.ac.th/pdf/Construction_act_2566.pdf'],
      lastVerifiedDate: VERIFIED, verifiedBy: BY,
      notes: 'ข้อ 6 load combinations WSD, ข้อ 7 SDM (1.4D+1.7L ...), φ with/without QC, ข้อ 11 live loads, ข้อ 13–14 LL reduction, ข้อ 16 impact, ข้อ 17 simplified wind, ข้อ 18 seismic → MR2564, ข้อ 25 transitional (applications before 4 มี.ค. 2567 use ฉ.6).'
    },
    {
      id: 'MOI-2567-STRUCT',
      titleTh: 'ประกาศกระทรวงมหาดไทย เรื่อง การออกแบบโครงสร้างอาคารและลักษณะและคุณสมบัติของวัสดุที่ใช้ในงานโครงสร้างอาคาร (2567)',
      titleEn: 'MOI Notification on structural design and materials (2024), issued under MR2566',
      issuer: 'กระทรวงมหาดไทย (ราชกิจจานุเบกษา เล่ม 141 ตอนพิเศษ 237 ง, 30 ส.ค. 2567)',
      type: 'regulation', editionYear: 2567, status: 'current', supersedes: null,
      appliesToModules: ['rc-sdm', 'rc-wsd', 'steel', 'loads', 'report'],
      effectiveDate: '2024-08-31',
      officialUrl: 'https://download.asa.or.th/03media/04law/cba/ma/ma67-03.pdf',
      altUrls: ['https://www.yotathai.com/yotanews/30-08-67-3'],
      lastVerifiedDate: VERIFIED, verifiedBy: BY,
      notes: 'ให้ใช้มาตรฐาน กรมโยธาธิการฯ หรือ วสท. หรือมาตรฐานอื่นที่คณะกรรมการควบคุมอาคารเห็นชอบ (WSD, SDM, ASD, LRFD); deflection L/360, L/240; unit weights.'
    },
    {
      id: 'MR2566-FOUND',
      titleTh: 'กฎกระทรวงกำหนดฐานรากของอาคารและพื้นดินที่รองรับอาคาร พ.ศ. 2566',
      titleEn: 'Ministerial Regulation on Building Foundations and Supporting Ground B.E. 2566',
      issuer: 'กระทรวงมหาดไทย', type: 'regulation', editionYear: 2566, status: 'current', supersedes: 'MR6-2527',
      appliesToModules: ['rc-sdm', 'rc-wsd'], effectiveDate: '2024-02-27',
      officialUrl: 'http://download.asa.or.th/03media/04law/cba/mr/mr66-70g.pdf',
      altUrls: ['https://download.asa.or.th/03media/04law/cba/ma/ma67-04.pdf'],
      lastVerifiedDate: VERIFIED, verifiedBy: BY,
      notes: 'แยกเรื่องฐานรากออกจากกฎกระทรวงฉบับที่ 6 เดิม; มีประกาศ มท. ประกอบ (ma67-04). ค่ารับน้ำหนักดินให้ใช้ผลเจาะสำรวจดิน/ทดสอบ.'
    },
    {
      id: 'MR2564-SEISMIC',
      titleTh: 'กฎกระทรวงกำหนดการรับน้ำหนัก ความต้านทาน ความคงทนของอาคาร และพื้นดินที่รองรับอาคารในการต้านทานแรงสั่นสะเทือนของแผ่นดินไหว พ.ศ. 2564',
      titleEn: 'Ministerial Regulation on Seismic Resistance of Buildings B.E. 2564 (2021)',
      issuer: 'กระทรวงมหาดไทย (ราชกิจจานุเบกษา เล่ม 138 ตอนที่ 16 ก, 4 มี.ค. 2564)',
      type: 'regulation', editionYear: 2564, status: 'current', supersedes: 'MR-SEISMIC-2550',
      appliesToModules: ['seismic', 'loads', 'report'], effectiveDate: '2021-08-31',
      officialUrl: 'http://download.asa.or.th/03media/04law/cba/mr/mr64-68b.pdf',
      altUrls: ['https://asa.or.th/laws/news20210305/', 'http://download.asa.or.th/03media/04law/cba/ma/ma64-02.pdf'],
      lastVerifiedDate: VERIFIED, verifiedBy: BY,
      notes: 'เขต 1 (14 จ.), เขต 2 (17 จ. รวม กทม.), เขต 3 (12 จ.). ไม่พบการแก้ไขที่ประกาศในราชกิจจาฯ ถึง ต.ค. 2569; กรมโยธาฯ แจ้ง (พ.ค. 2568) ว่าจะปรับปรุงหลังแผ่นดินไหวเมียนมา — ควรตรวจซ้ำ. ประกาศ มท. ประกอบ 29 ก.ย. 2564 (ma64-02). เกณฑ์ประเภท/ขนาดอาคารใน ข้อ 4 ยังไม่ได้อ่าน.'
    },
    {
      id: 'MR6-2527',
      titleTh: 'กฎกระทรวงฉบับที่ 6 (พ.ศ. 2527) ออกตามความในพระราชบัญญัติควบคุมอาคาร พ.ศ. 2522',
      titleEn: 'Ministerial Regulation No. 6 (1984) — repealed',
      issuer: 'กระทรวงมหาดไทย', type: 'regulation', editionYear: 2527, status: 'superseded', supersedes: null,
      supersededBy: 'MR2566-STRUCT',
      appliesToModules: ['loads'],
      officialUrl: 'https://asa.or.th/laws-and-regulations/cba/', altUrls: [],
      lastVerifiedDate: VERIFIED, verifiedBy: BY,
      notes: 'ยกเลิกโดยกฎกระทรวง 2566 ข้อ 2; ใช้ได้เฉพาะคำขออนุญาตที่ยื่นก่อน 4 มี.ค. 2567 (ข้อ 25).'
    },
    {
      id: 'DPT-1301-1302-61',
      titleTh: 'มยผ. 1301/1302-61 มาตรฐานการออกแบบอาคารต้านทานการสั่นสะเทือนของแผ่นดินไหว',
      titleEn: 'DPT 1301/1302-61 Seismic Design Standard',
      issuer: 'กรมโยธาธิการและผังเมือง', type: 'standard', editionYear: 2561, status: 'current',
      supersedes: 'DPT-1301-54', supersedesAll: ['DPT-1301-54', 'DPT-1302-52'], appliesToModules: ['seismic'],
      officialUrl: 'https://www.yotathai.com/yotanews/myp-1301-1302', altUrls: ['https://www.dpt.go.th'],
      lastVerifiedDate: VERIFIED, verifiedBy: BY,
      notes: 'ไม่พบฉบับปรับปรุง 2568/2569. ลิงก์หลักเป็นแหล่งรอง (yotathai) — ยังไม่พบหน้าดาวน์โหลดบน dpt.go.th. ค่า Ss/S1 รายอำเภอ และตาราง Fa/Fv ในโปรแกรมยังไม่ได้ถอดจากมาตรฐานฉบับจริง.'
    },
    {
      id: 'DPT-1311-50',
      titleTh: 'มยผ. 1311-50 มาตรฐานการคำนวณแรงลมและการตอบสนองของอาคาร',
      titleEn: 'DPT 1311-50 Wind Loading Standard',
      issuer: 'กรมโยธาธิการและผังเมือง', type: 'standard', editionYear: 2550, status: 'current', supersedes: null,
      appliesToModules: ['wind'], officialUrl: 'https://www.dpt.go.th', altUrls: [],
      lastVerifiedDate: VERIFIED, verifiedBy: BY,
      notes: 'ยังใช้อยู่ (งานวิจัยปี 2567 ยังอ้างอิง) ไม่พบฉบับใหม่; ไม่พบลิงก์ทางการโดยตรง. ค่า V50 รายจังหวัดในโปรแกรมยังไม่ได้ตรวจสอบ.'
    },
    {
      id: 'EIT-011008',
      titleTh: 'วสท. 011008 มาตรฐานสำหรับอาคารคอนกรีตเสริมเหล็กโดยวิธีกำลัง (เดิม วสท. 1008-38)',
      titleEn: 'EIT 011008 RC Strength Design Standard',
      issuer: 'วิศวกรรมสถานแห่งประเทศไทย ในพระบรมราชูปถัมภ์ (วสท.)', type: 'standard', editionYear: null, status: 'unknown',
      supersedes: 'EIT-1008-38', appliesToModules: ['rc-sdm', 'rc-wsd'],
      officialUrl: 'https://eit.or.th/order/book/view/173', altUrls: [],
      lastVerifiedDate: VERIFIED, verifiedBy: BY,
      notes: 'ร้านหนังสือ วสท. ระบุฉบับปรับปรุงอิง ACI 318-11 (มีแหล่งอ้าง "2564") — ยังยืนยันรหัส/ปีฉบับไม่ได้. ไม่พบฉบับที่อิง ACI 318-19.'
    },
    {
      id: 'EIT-1007-34',
      titleTh: 'วสท. 1007-34 มาตรฐานสำหรับอาคารคอนกรีตเสริมเหล็กโดยวิธีหน่วยแรงใช้งาน',
      titleEn: 'EIT 1007-34 RC Working Stress Design Standard',
      issuer: 'วสท.', type: 'standard', editionYear: 2534, status: 'unknown', supersedes: null,
      appliesToModules: ['rc-sdm', 'rc-wsd'], officialUrl: 'https://eit.or.th', altUrls: [],
      lastVerifiedDate: null, verifiedBy: null,
      notes: 'ยังไม่ได้ตรวจสอบสถานะ/ฉบับ.'
    },
    {
      id: 'EIT-011038',
      titleTh: 'วสท. 011038 มาตรฐานการออกแบบอาคารเหล็กรูปพรรณ',
      titleEn: 'EIT 011038 Structural Steel Design Standard',
      issuer: 'วสท.', type: 'standard', editionYear: null, status: 'unknown', supersedes: null,
      appliesToModules: ['steel'], officialUrl: 'https://eit.or.th', altUrls: [],
      lastVerifiedDate: null, verifiedBy: null,
      notes: 'ยังยืนยันฉบับ/ปีไม่ได้. สูตรในโปรแกรมอิง AISC 360-16 (ใช้ φ ตามกฎกระทรวง 2566).'
    },
    {
      id: 'AISC-360-16',
      titleTh: 'AISC 360-16 Specification for Structural Steel Buildings',
      titleEn: 'AISC 360-16', issuer: 'American Institute of Steel Construction', type: 'international',
      editionYear: 2016, status: 'current', supersedes: null, appliesToModules: ['steel'],
      officialUrl: 'https://www.aisc.org', altUrls: [], lastVerifiedDate: null, verifiedBy: null,
      notes: 'ใช้เป็นฐานสูตร (มาตรฐานอื่นที่เป็นที่ยอมรับ ตามประกาศ มท. 2567). มีฉบับ 360-22 ออกแล้ว.'
    },
    {
      id: 'ACI-318',
      titleTh: 'ACI 318 Building Code Requirements for Structural Concrete',
      titleEn: 'ACI 318', issuer: 'American Concrete Institute', type: 'international',
      editionYear: 2019, status: 'current', supersedes: null, appliesToModules: ['rc-sdm', 'rc-wsd', 'loads'],
      officialUrl: 'https://www.concrete.org', altUrls: [], lastVerifiedDate: null, verifiedBy: null,
      notes: 'ใช้เป็นทางเลือก/ตรวจทานเท่านั้น; กฎกระทรวง 2566 ไม่ได้บังคับใช้ชุด 1.2D+1.6L.'
    },
    {
      id: 'BCA-2522',
      titleTh: 'พระราชบัญญัติควบคุมอาคาร พ.ศ. 2522 และที่แก้ไขเพิ่มเติม (ล่าสุด ฉบับที่ 5 พ.ศ. 2558)',
      titleEn: 'Building Control Act B.E. 2522 (as amended to No. 5, 2015)',
      issuer: 'รัฐสภา / ราชกิจจานุเบกษา', type: 'law', editionYear: 2522, status: 'current', supersedes: null,
      appliesToModules: ['licensing', 'report'], officialUrl: 'https://asa.or.th/laws-and-regulations/cba/', altUrls: [],
      lastVerifiedDate: VERIFIED, verifiedBy: BY,
      notes: 'กรมโยธาฯ แจ้ง พ.ค. 2568 ว่าจะยกร่างปรับปรุง — ยังไม่พบการประกาศใช้.'
    },
    {
      id: 'ENG-ACT-2542',
      titleTh: 'พระราชบัญญัติวิศวกร พ.ศ. 2542',
      titleEn: 'Engineer Act B.E. 2542 (1999)', issuer: 'สภาวิศวกร', type: 'law', editionYear: 2542, status: 'current',
      supersedes: null, appliesToModules: ['licensing', 'report'], officialUrl: 'https://www.coe.or.th', altUrls: [],
      lastVerifiedDate: null, verifiedBy: null,
      notes: 'ผู้ออกแบบ/คำนวณงานวิศวกรรมควบคุมต้องได้รับใบอนุญาต (กว.) สาขาวิศวกรรมโยธา.'
    },
    {
      id: 'MR2565-ENG-CONTROL',
      titleTh: 'กฎกระทรวงกำหนดสาขาวิชาชีพวิศวกรรมและวิชาชีพวิศวกรรมควบคุม พ.ศ. 2565',
      titleEn: 'Ministerial Regulation on Controlled Engineering Professions B.E. 2565 (2022)',
      issuer: 'กระทรวงมหาดไทย', type: 'regulation', editionYear: 2565, status: 'current', supersedes: 'MR2550-ENG-CONTROL',
      appliesToModules: ['licensing', 'report'], effectiveDate: '2023-01-02',
      officialUrl: 'https://yotathai.com/yotanews/law-engineering-65', altUrls: [],
      lastVerifiedDate: VERIFIED, verifiedBy: BY,
      notes: 'แทนฉบับ 2550. งานควบคุม (สรุปจากแหล่งรอง): ≥3 ชั้น, ความสูงชั้น ≥4 ม., ช่วงคาน ≥5 ม., ยื่น ≥2 ม., อาคารสาธารณะ, ≥150 ตร.ม. บนลาดชัน ≥35°.'
    },
    {
      id: 'COE-CIVIL-2566',
      titleTh: 'ข้อบังคับสภาวิศวกร ว่าด้วยหลักเกณฑ์และคุณสมบัติของผู้ประกอบวิชาชีพวิศวกรรมควบคุมแต่ละระดับ สาขาวิศวกรรมโยธา พ.ศ. 2566',
      titleEn: 'COE Regulation on licence levels — Civil Engineering B.E. 2566',
      issuer: 'สภาวิศวกร (ราชกิจจานุเบกษา เล่ม 140 ตอนพิเศษ 146 ง, 21 มิ.ย. 2566)', type: 'regulation', editionYear: 2566,
      status: 'current', supersedes: 'COE-CIVIL-2551', appliesToModules: ['licensing', 'report'], effectiveDate: '2023-06-22',
      officialUrl: 'https://download.asa.or.th/03media/04law/ea/cr66.pdf', altUrls: [],
      lastVerifiedDate: VERIFIED, verifiedBy: BY,
      notes: 'วุฒิ/สามัญ: ออกแบบคำนวณได้ทุกขนาด. ภาคี: อาคารสูงไม่เกิน 4 ชั้น หรือความสูงชั้นไม่เกิน 5 ม. (ยกเว้นอาคารสาธารณะ; งานตามกฎกระทรวงแผ่นดินไหวต้องผ่านการอบรม).'
    },
    {
      id: 'BMA-2544',
      titleTh: 'ข้อบัญญัติกรุงเทพมหานคร เรื่อง ควบคุมอาคาร พ.ศ. 2544',
      titleEn: 'Bangkok Building Control Ordinance B.E. 2544', issuer: 'กรุงเทพมหานคร', type: 'regulation',
      editionYear: 2544, status: 'unknown', supersedes: null, appliesToModules: ['loads', 'report'],
      officialUrl: 'https://www.bangkok.go.th', altUrls: [], lastVerifiedDate: null, verifiedBy: null,
      notes: 'ยังไม่ได้ตรวจสอบข้อกำหนดน้ำหนัก/หน่วยแรง และความสัมพันธ์กับกฎกระทรวง 2566 — โครงการใน กทม. ต้องตรวจสอบเพิ่ม.'
    },
    // ---- not yet researched (material standards / fallback) ----
    row('TIS-1227', 'มอก. 1227 เหล็กรูปพรรณรีดร้อน', 'Hot-rolled structural steel', 'สมอ.', 'standard', null, null, ['steel'], U.ratchakitcha, '[VERIFY]'),
    row('TIS-1228', 'มอก. 1228 เหล็กรูปพรรณ', 'Structural steel', 'สมอ.', 'standard', null, null, ['steel'], U.ratchakitcha, '[VERIFY]'),
    row('TIS-20', 'มอก. 20 เหล็กเส้นกลม', 'Round steel bars', 'สมอ.', 'standard', null, null, ['rc-sdm', 'rc-wsd'], U.ratchakitcha, '[VERIFY]'),
    row('TIS-24', 'มอก. 24 เหล็กข้ออ้อย', 'Deformed steel bars', 'สมอ.', 'standard', null, null, ['rc-sdm', 'rc-wsd'], U.ratchakitcha, '[VERIFY]'),
    row('ASCE-7-10', 'ASCE 7-10', 'Minimum Design Loads for Buildings', 'ASCE', 'international', 2010, null, ['seismic', 'loads'], U.eit, 'Fallback for Fa/Fv tables; no official link seeded')
  ];

  const MS_DAY = 86400000;
  SD.codes = {
    registry,
    staleDays: 180,
    forModule: (moduleId) => registry.filter(r => r.appliesToModules.indexOf(moduleId) >= 0),
    /** today: Date | ISO string (default now). Returns {never, days, stale, badge}; badge true => show "not verified in last 180 days". */
    staleness: function (r, today) {
      const t = today ? new Date(today) : new Date();
      if (!r.lastVerifiedDate) return { never: true, days: null, stale: true, badge: true };
      const d = Math.floor((t - new Date(r.lastVerifiedDate)) / MS_DAY);
      const stale = !(d >= 0 && d <= SD.codes.staleDays);
      return { never: false, days: d, stale, badge: stale };
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = SD.codes;
})(typeof globalThis !== 'undefined' ? globalThis : this);
