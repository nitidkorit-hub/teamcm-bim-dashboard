/* engine/data/provinces.js — province table (all 77).
 * seismicZone2564: zone 1/2/3 per กฎกระทรวงแผ่นดินไหว 2564 (as listed by ASA, via coordinator override) ->
 *   seismicZoneVerified:true; null = not in a regulated zone.
 * V50 / windZone / Ss / S1: PLACEHOLDERS ONLY (13 seed provinces, all others null). verified:false. Do NOT use for real
 * permit work until replaced from มยผ. 1311-50 and มยผ. 1301/1302-61 tables. */
(function (root) {
  const SD = root.SD = root.SD || {};
  const Z1 = ['กระบี่', 'ชุมพร', 'สงขลา', 'สุราษฎร์ธานี', 'ตรัง', 'นครพนม', 'นครศรีธรรมราช', 'บึงกาฬ', 'ประจวบคีรีขันธ์', 'พิษณุโลก', 'เพชรบุรี', 'เลย', 'สตูล', 'หนองคาย'];
  const Z2 = ['กรุงเทพมหานคร', 'นนทบุรี', 'ปทุมธานี', 'สมุทรปราการ', 'สมุทรสาคร', 'พังงา', 'ภูเก็ต', 'ระนอง', 'กำแพงเพชร', 'ชัยนาท', 'นครปฐม', 'นครสวรรค์', 'พระนครศรีอยุธยา', 'ราชบุรี', 'สมุทรสงคราม', 'สุพรรณบุรี', 'อุทัยธานี'];
  const Z3 = ['กาญจนบุรี', 'เชียงราย', 'เชียงใหม่', 'ตาก', 'น่าน', 'พะเยา', 'แพร่', 'แม่ฮ่องสอน', 'ลำปาง', 'ลำพูน', 'สุโขทัย', 'อุตรดิตถ์'];
  const zoneOf = (th) => Z1.indexOf(th) >= 0 ? 1 : Z2.indexOf(th) >= 0 ? 2 : Z3.indexOf(th) >= 0 ? 3 : null;

  const ALL = [
    ['Bangkok', 'กรุงเทพมหานคร'], ['Amnat Charoen', 'อำนาจเจริญ'], ['Ang Thong', 'อ่างทอง'], ['Bueng Kan', 'บึงกาฬ'], ['Buriram', 'บุรีรัมย์'],
    ['Chachoengsao', 'ฉะเชิงเทรา'], ['Chai Nat', 'ชัยนาท'], ['Chaiyaphum', 'ชัยภูมิ'], ['Chanthaburi', 'จันทบุรี'], ['Chiang Mai', 'เชียงใหม่'],
    ['Chiang Rai', 'เชียงราย'], ['Chonburi', 'ชลบุรี'], ['Chumphon', 'ชุมพร'], ['Kalasin', 'กาฬสินธุ์'], ['Kamphaeng Phet', 'กำแพงเพชร'],
    ['Kanchanaburi', 'กาญจนบุรี'], ['Khon Kaen', 'ขอนแก่น'], ['Krabi', 'กระบี่'], ['Lampang', 'ลำปาง'], ['Lamphun', 'ลำพูน'], ['Loei', 'เลย'],
    ['Lopburi', 'ลพบุรี'], ['Mae Hong Son', 'แม่ฮ่องสอน'], ['Maha Sarakham', 'มหาสารคาม'], ['Mukdahan', 'มุกดาหาร'], ['Nakhon Nayok', 'นครนายก'],
    ['Nakhon Pathom', 'นครปฐม'], ['Nakhon Phanom', 'นครพนม'], ['Nakhon Ratchasima', 'นครราชสีมา'], ['Nakhon Sawan', 'นครสวรรค์'],
    ['Nakhon Si Thammarat', 'นครศรีธรรมราช'], ['Nan', 'น่าน'], ['Narathiwat', 'นราธิวาส'], ['Nong Bua Lamphu', 'หนองบัวลำภู'], ['Nong Khai', 'หนองคาย'],
    ['Nonthaburi', 'นนทบุรี'], ['Pathum Thani', 'ปทุมธานี'], ['Pattani', 'ปัตตานี'], ['Phang Nga', 'พังงา'], ['Phatthalung', 'พัทลุง'],
    ['Phayao', 'พะเยา'], ['Phetchabun', 'เพชรบูรณ์'], ['Phetchaburi', 'เพชรบุรี'], ['Phichit', 'พิจิตร'], ['Phitsanulok', 'พิษณุโลก'],
    ['Phra Nakhon Si Ayutthaya', 'พระนครศรีอยุธยา'], ['Phrae', 'แพร่'], ['Phuket', 'ภูเก็ต'], ['Prachinburi', 'ปราจีนบุรี'],
    ['Prachuap Khiri Khan', 'ประจวบคีรีขันธ์'], ['Ranong', 'ระนอง'], ['Ratchaburi', 'ราชบุรี'], ['Rayong', 'ระยอง'], ['Roi Et', 'ร้อยเอ็ด'],
    ['Sa Kaeo', 'สระแก้ว'], ['Sakon Nakhon', 'สกลนคร'], ['Samut Prakan', 'สมุทรปราการ'], ['Samut Sakhon', 'สมุทรสาคร'], ['Samut Songkhram', 'สมุทรสงคราม'],
    ['Saraburi', 'สระบุรี'], ['Satun', 'สตูล'], ['Sing Buri', 'สิงห์บุรี'], ['Sisaket', 'ศรีสะเกษ'], ['Songkhla', 'สงขลา'], ['Sukhothai', 'สุโขทัย'],
    ['Suphan Buri', 'สุพรรณบุรี'], ['Surat Thani', 'สุราษฎร์ธานี'], ['Surin', 'สุรินทร์'], ['Tak', 'ตาก'], ['Trang', 'ตรัง'], ['Trat', 'ตราด'],
    ['Ubon Ratchathani', 'อุบลราชธานี'], ['Udon Thani', 'อุดรธานี'], ['Uthai Thani', 'อุทัยธานี'], ['Uttaradit', 'อุตรดิตถ์'], ['Yala', 'ยะลา'], ['Yasothon', 'ยโสธร']
  ];

  // PLACEHOLDER hazard values for the 13 seed provinces: [windZone, Ss, S1]
  const WIND_V50 = { 1: 25, 2: 27, 3: 29, 4: 31 };
  const SEED = {
    'Bangkok': [1, 0.10, 0.05], 'Nonthaburi': [1, 0.10, 0.05], 'Samut Prakan': [1, 0.10, 0.05], 'Pathum Thani': [1, 0.10, 0.05],
    'Chiang Mai': [1, 0.60, 0.20], 'Chiang Rai': [1, 0.55, 0.20], 'Kanchanaburi': [1, 0.45, 0.15], 'Tak': [1, 0.50, 0.17],
    'Phuket': [2, 0.15, 0.07], 'Songkhla': [2, 0.08, 0.04], 'Khon Kaen': [1, 0.05, 0.03], 'Nakhon Ratchasima': [1, 0.05, 0.03], 'Chonburi': [2, 0.08, 0.04]
  };
  const PH = 'PLACEHOLDER - not from an official table; replace from มยผ. 1311-50 / 1301-61 before real use';

  SD.provinces = ALL.map(([province, provinceTh]) => {
    const z = zoneOf(provinceTh), s = SEED[province];
    return {
      province, provinceTh,
      V50: s ? WIND_V50[s[0]] : null, windZone: s ? s[0] : null, Ss: s ? s[1] : null, S1: s ? s[2] : null,
      seismicZone2564: z, seismicZoneVerified: true, seismicZoneSource: 'กฎกระทรวงแผ่นดินไหว 2564 per ASA',
      placeholder: !!s, source: s ? PH : 'no hazard data seeded', verified: false
    };
  });
  SD.provinces.byName = (name) => SD.provinces.find(p => p.province === name || p.provinceTh === name) || null;
  SD.provinces.seedNames = Object.keys(SEED);

  if (typeof module !== 'undefined' && module.exports) module.exports = SD.provinces;
})(typeof globalThis !== 'undefined' ? globalThis : this);
